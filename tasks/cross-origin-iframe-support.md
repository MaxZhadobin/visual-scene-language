# Cross-Origin Iframe Support via `all_frames: true`

## Контекст и проблема

VSL extension не может взаимодействовать с элементами внутри cross-origin iframe (например, reCAPTCHA, Google Sign-In, Stripe Elements). Причина:

- **Content script** инжектится только в **топ-фрейм** страницы (manifest.json не содержит `"all_frames": true`)
- **VSL snapshot** видит iframe как контейнер (`div_0` или `iframe_0_0`), но не раскрывает внутреннюю DOM-структуру
- **Action executor** не может резолвить `target_id` для элементов внутри iframe — они отсутствуют в VSL JSON
- **Результат**: агент может "видеть" капчу через скриншот (`vsl_get_visual`), но не может кликать элементы внутри неё

## Решение: `all_frames: true` + Frame-Aware Messaging

Chrome extension поддерживает запуск content script в **каждом** iframe (включая cross-origin) через настройку `"all_frames": true` в manifest.json. Это даёт:

1. **Каждый iframe** получает свой инстанс content script со своим `VslSnapshotSession`
2. **Content script внутри iframe** строит VSL JSON с `target_id` для элементов этого iframe
3. **Background** собирает snapshot'ы со всех фреймов и объединяет их в единый VSL документ
4. **LLM** видит полную структуру страницы включая элементы внутри iframe
5. **Действия** маршрутизируются в нужный фрейм по frame-префиксу в `target_id`

**Это надёжный, детерминированный способ** — полноценное чтение DOM, не координаты.

---

## Архитектура решения

### 1. Manifest.json — инжект в все фреймы

{
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["dist/content.global.js"],
      "run_at": "document_idle",
      "all_frames": true  // ← ключевое изменение
    }
  ]
}
**Эффект**: Chrome инжектит `content.global.js` в каждый iframe на странице. Каждый iframe работает в isolated world с полным DOM-доступом к своему документу.

### 2. Content Script — Frame-Aware Session

Текущий `content.ts` уже использует `document.body` как корень. При `all_frames: true`:

- **Топ-фрейм**: `document.body` = body главной страницы
- **Iframe**: `document.body` = body документа внутри iframe

**Никаких изменений в логике snapshot/execute не требуется** — каждый инстанс content script работает со своим DOM.

**Дополнительно**: content script должен определить свой `frameId` и зарегистрироваться в background:

// content.ts
const frameId = getFrameId(); // 0 для топ-фрейма, >0 для iframe

chrome.runtime.sendMessage({
  type: 'vsl/frameRegister',
  frameId,
  url: window.location.href,
});
### 3. Background — Frame Registry и Snapshot Aggregation

**Frame Registry**: background трекирует все активные фреймы на каждой вкладке:

// background.ts
interface FrameInfo {
  frameId: number;
  url: string;
  tabId: number;
}

const frameRegistry = new Map<number, Map<number, FrameInfo>>(); // tabId → frameId → FrameInfo
**Snapshot Aggregation**: при запросе `vsl/snapshot` background:

1. Отправляет `vsl/snapshot` во **все** фреймы вкладки (через `chrome.tabs.sendMessage(tabId, msg, {frameId})`)
2. Собирает ответы от каждого фрейма
3. Объединяет snapshot'ы в единый VSL документ с frame-префиксами в `target_id`

// Объединённый snapshot
{
  "canvas": { "viewport": {...}, "url": "https://example.com" },
  "objects": [
    // Топ-фрейм (frameId=0): target_id без префикса
    { "id": "div_0_1", "type": "container", ... },
    { "id": "button_0_2", "type": "button", "t": "Submit", ... },
    
    // Iframe (frameId=3): target_id с префиксом "frame_3:"
    { "id": "frame_3:input_0_0", "type": "input", "t": "Search", ... },
    { "id": "frame_3:button_0_1", "type": "button", "t": "Submit", ... }
  ]
}
### 4. Protocol — Frame-Aware Messages

**Новые сообщения**:

// content → background: регистрация фрейма
interface FrameRegisterRequest {
  type: 'vsl/frameRegister';
  frameId: number;
  url: string;
}

// background → content: snapshot с указанием frameId
interface SnapshotRequest {
  type: typeof MSG_SNAPSHOT;
  vision?: boolean;
  frameId?: number; // опционально: если null, то для всех фреймов
}

// background → content: execute с frame-префиксом
interface ExecuteRequest {
  type: typeof MSG_EXECUTE;
  action: LlmAction;
  targetFrameId?: number; // извлекается из frame-префикса target_id
}
### 5. Target ID — Frame Prefix Convention

**Формат**: `frame_{frameId}:{original_target_id}`

Примеры:
- Топ-фрейм: `button_0_2` (без префикса, frameId=0 implied)
- Iframe: `frame_3:input_0_0` (frameId=3, элемент `input_0_0` внутри iframe)

**Парсинг**:

function parseTargetId(targetId: string): { frameId: number; localId: string } {
  const frameMatch = targetId.match(/^frame_(\d+):(.+)$/);
  if (frameMatch) {
    return { frameId: parseInt(frameMatch[1], 10), localId: frameMatch[2] };
  }
  return { frameId: 0, localId: targetId }; // топ-фрейм по умолчанию
}
### 6. Action Executor — Frame Routing

**Background** извлекает `frameId` из `target_id` и маршрутизирует `vsl/execute` в нужный фрейм:

// background.ts
async function handleExecute(action: LlmAction, tabId: number): Promise<ActionResult> {
  const { frameId, localId } = parseTargetId(action.target_id);
  
  // Модифицируем action: убираем frame-префикс
  const localAction = { ...action, target_id: localId };
  
  // Отправляем в конкретный фрейм
  return await chrome.tabs.sendMessage(tabId, {
    type: MSG_EXECUTE,
    action: localAction,
  }, { frameId });
}
**Content script** внутри iframe получает `localAction` без frame-префикса и исполняет его на своём DOM (текущая логика `resolveTarget` работает без изменений).

### 7. MCP Server — Frame-Aware Tools

**vsl_get_snapshot**: возвращает объединённый snapshot со всеми фреймами. LLM видит полную структуру.

**vsl_execute_action**: принимает `target_id` с frame-префиксом (например `frame_3:button_0_1`). MCP server передаёт его в extension без изменений — background сам маршрутизирует.

**vsl_get_visual**: для элементов внутри iframe можно получить скриншот iframe через `chrome.tabs.captureVisibleTab` + crop по bbox iframe-контейнера.

---

## План реализации

### Этап 1: Manifest и Content Script (1-2 дня)

1. **manifest.json**: добавить `"all_frames": true`
2. **content.ts**: 
   - Определить `frameId` (топ-фрейм = 0, iframe = `window.frameElement` через `chrome.webNavigation.getFrame`)
   - Зарегистрироваться в background при загрузке
   - Отвечать на `vsl/snapshot` и `vsl/execute` как обычно (логика не меняется)

**Тест**: открыть страницу с iframe, проверить что content script запустился в обоих фреймах (console.log с frameId).

### Этап 2: Background — Frame Registry (2-3 дня)

1. **protocol.ts**: добавить `FrameRegisterRequest`, `MSG_FRAME_REGISTER`
2. **background.ts**:
   - Обработать `vsl/frameRegister`: сохранить `FrameInfo` в `frameRegistry`
   - При unload вкладки/фрейма — удалить из registry
   - Добавить `getAllFrames(tabId)` helper

**Тест**: открыть страницу с 3 iframe, проверить что `frameRegistry` содержит 4 записи (1 топ + 3 iframe).

### Этап 3: Snapshot Aggregation (3-4 дня)

1. **background.ts**:
   - Модифицировать `vsl/snapshot` handler: отправить запрос во все фреймы
   - Собрать ответы, объединить в единый VSL документ
   - Добавить frame-префикс к `target_id` элементов из iframe
   - Сохранить bbox iframe-контейнера в топ-фрейме (для визуализации)

2. **vslBuilder.ts** (опционально): добавить `mergeFrames(topFrame, iframeFrames)` helper

**Тест**: получить snapshot страницы с iframe, проверить что элементы из iframe имеют `frame_N:` префикс.

### Этап 4: Action Routing (2-3 дня)

1. **background.ts**:
   - Модифицировать `vsl/execute` handler: извлечь `frameId` из `target_id`
   - Убрать frame-префикс из `target_id` перед отправкой в content
   - Отправить `vsl/execute` в конкретный фрейм через `{frameId}`

2. **resolveTarget.ts**: без изменений (работает с `localId` без префикса)

**Тест**: кликнуть элемент внутри iframe, проверить что действие исполнилось на правильном DOM.

### Этап 5: MCP Server Update (1-2 дня)

1. **MCP tools**: без изменений в API (target_id уже принимает строку)
2. **Документация**: добавить примеры с frame-префиксом
3. **vsl_get_visual**: для iframe-элементов — crop по bbox iframe-контейнера

**Тест**: через MCP server получить snapshot страницы с iframe, кликнуть элемент внутри iframe.

### Этап 6: Edge Cases и Testing (2-3 дня)

1. **Nested iframes**: iframe внутри iframe (frameId hierarchy)
2. **Dynamic iframes**: iframe добавляется/удаляется динамически
3. **Cross-origin restrictions**: некоторые iframe могут блокировать content script (CSP)
4. **Performance**: aggregation latency для страниц с 10+ iframe
5. **Error handling**: что делать если фрейм исчез между snapshot и execute

---

## Acceptance Criteria

- [ ] Content script инжектится в cross-origin iframe (проверено на reCAPTCHA demo)
- [ ] VSL snapshot страницы с iframe содержит элементы из iframe с frame-префиксом
- [ ] Action executor может кликнуть элемент внутри iframe по `frame_N:target_id`
- [ ] Nested iframes поддерживаются (iframe внутри iframe)
- [ ] Dynamic iframes регистрируются/удаляются из frame registry
- [ ] MCP tools работают с frame-qualified target_id без изменений в API
- [ ] Performance: snapshot aggregation < 500ms для страницы с 5 iframe

---

## Риски и ограничения

1. **CSP (Content Security Policy)**: некоторые сайты могут блокировать инжект content script через CSP. Решение: нет (Chrome extension имеет приоритет над CSP, но некоторые фреймворки могут блокировать DOM-модификации).

2. **Nested iframes**: если iframe внутри iframe, нужно рекурсивно собирать snapshot'ы. Решение: frameId hierarchy (например `frame_3:frame_5:button_0_1`).

3. **Performance**: aggregation 10+ iframe может быть медленной. Решение: параллельные запросы ко всем фреймам, кэширование неизменённых iframe.

4. **Dynamic iframes**: iframe добавляется после загрузки страницы. Решение: content script регистрируется при `DOMContentLoaded`, background обновляет registry.

5. **Cross-origin iframe URL**: background не может прочитать `iframe.contentWindow.location.href` из-за same-origin policy. Решение: content script внутри iframe сам сообщает свой URL через `vsl/frameRegister`.

---

## Альтернативы (отклонены)

### click_at (координатный клик)

**Идея**: добавить действие `click_at` с координатами x,y через `document.elementFromPoint(x, y)`.

**Почему отклонено**:
- `elementFromPoint` на родительской странице вернёт сам `<iframe>` элемент, а не элемент внутри него
- Cross-origin iframe недоступен для `elementFromPoint` из родительского контекста
- Координаты нестабильны при resize/scroll
- Это обходной путь, не решение проблемы

**Вывод**: `all_frames: true` — единственный надёжный способ.

---

## Заключение

Реализация `all_frames: true` — это **архитектурно правильное решение** для поддержки cross-origin iframe в VSL. Оно использует стандартные возможности Chrome extension, не требует обходных путей, и даёт полноценный DOM-доступ ко всем фреймам страницы.

**Оценка сложности**: 10-15 дней (6 этапов)
**Приоритет**: High (блокирует взаимодействие с reCAPTCHA, Google Sign-In, Stripe и другими популярными виджетами)