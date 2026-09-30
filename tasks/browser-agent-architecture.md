# Browser Agent Architecture

## Overview

Полноценный браузерный агент с чатом, историей сессий, записной книжкой и циклом апдейта памяти. Работает на нескольких вкладках одновременно, выполняет задачи автономно, общается с пользователем через Side Panel.

## Architecture Components

### 1. UI Layer (Side Panel)

**Side Panel** — постоянная панель сбоку браузера (не влияет на верстку страницы).

**Вкладки:**
- **Chat** — активная сессия (чат + визуализация действий агента)
- **Sessions** — список всех сессий (метаданные, статус, переключение)

**Компоненты Chat:**
- `Chat.tsx` — основной контейнер чата
- `MessageBubble.tsx` — сообщение (пользователь/агент/система)
- `AgentStatus.tsx` — статус агента (thinking/executing/waiting)
- `ActionOverlay.tsx` — визуализация действий агента на странице (подсветка элементов)

**Компоненты Sessions:**
- `SessionList.tsx` — список сессий
- `SessionCard.tsx` — карточка сессии (название, дата, статус, URL)
- `NewSessionButton.tsx` — создание новой сессии

### 2. Agent Layer (Offscreen Document)

**Offscreen Document** — фоновая вкладка, не видна пользователю, не замораживается Chrome.

**Компоненты:**
- `AgentLoop.ts` — непрерывный цикл выполнения задачи
- `TaskPlanner.ts` — декомпозиция задачи на шаги
- `LLMClient.ts` — работа с LLM (стриминг, retry, function calling)
- `UpdateAgent.ts` — цикл апдейта памяти (отдельная модель)

**AgentLoop:**
while (task not complete) {
  snapshot = await contentScript.getSnapshot()
  action = await llm.decide(snapshot, history, notes)
  
  if (action.type === 'reply_to_user') {
    await sendToUI(action.message)
  } else if (action.type === 'ask_user') {
    response = await askUser(action.question)  // блокируется
    history.add({ role: 'user', content: response })
  } else if (action.type === 'write_note') {
    note = notes.create(action.note, action.tags)  // получает ID автоматически
    history.add({ role: 'assistant', content: action, metadata: { note_id: note.id } })
  } else if (action.type === 'comment_note') {
    history.add({ role: 'assistant', content: action, metadata: { note_id: action.note_id, comment: action.comment } })
  } else {
    await contentScript.execute(action)
  }
  
  if (history.length >= X + O) {
    await updateCycle()
  }
}
**Псевдотулы агента (function calling):**
type AgentTools = {
  // Коммуникация с пользователем
  reply_to_user: (message: string) => void;
  ask_user: (question: string, options?: string[]) => Promise<string>;  // блокируется
  
  // Записная книжка
  write_note: (note: string, tags?: string[]) => void;
  comment_note: (note_id: string, comment: string) => void;
  
  // Стандартные действия (из SDK)
  click: (target_id: string) => void;
  type: (target_id: string, text: string) => void;
  scroll: (direction: 'up' | 'down') => void;
  // ...
}
**Логика работы с нотами:**

1. **write_note** — создаёт новую заметку. Заметка получает уникальный ID автоматически (генерируется системой). Заметка НЕ добавляется непосредственно в записную книжку — она сохраняется в истории сообщений с метаданными (note_id, tags, content).

2. **comment_note** — добавляет комментарий к существующей заметке по ID. Комментарий также сохраняется в истории сообщений с метаданными (note_id, comment).

3. **Записная книжка инжектится в промпт** — агент видит текущее состояние записной книжки в системном промпте (перед историей). Это стабильный контекст, который кэшируется LLM. Агент НЕ читает ноты отдельно — они всегда перед глазами в промпте.

4. **Пример работы:**
   - Агент получает задачу → вызывает `write_note("1. Открыть форму\n2. Заполнить поля\n3. Отправить", ['plan'])` → заметка получает ID `note_123`
   - Агент выполняет шаг 1 → вызывает `comment_note("note_123", "Шаг 1 выполнен: форма открыта")`
   - Агент выполняет шаг 2 → вызывает `comment_note("note_123", "Шаг 2 выполнен: поля заполнены")`
   - Все заметки и комментарии лежат в истории сообщений (не в записной книжке)

5. **После апдейт-цикла:**
   - Ноты и комментарии агента **детерминированно** переносятся в записную книжку (без LLM)
   - Update Agent добавляет **свои** ноты и комментарии (на случай если агент что-то не вписал)
   - Записная книжка обновлена, история обрезана до O последних сообщений

### 3. Content Script Layer

**Content Script** — инжектится на каждую страницу, выполняет действия агента.

**Компоненты:**
- `snapshot.ts` — создание снапшота страницы (DOM tree, accessibility tree)
- `executor.ts` — выполнение действий (click, type, scroll)
- `overlay.ts` — визуализация действий агента (подсветка элементов)

**Визуализация действий:**
- Подсветка элемента, на котором агент работает (border + tooltip)
- Анимация клика (ripple effect)
- Лог действий в правом нижнем углу (опционально)

### 4. Storage Layer

**Хранение данных:**
- `chrome.storage.local` — метаданные сессий, настройки (до 10 MB)
- IndexedDB — история сообщений, записная книжка (больше данных)

**Структура данных:**
interface Session {
  id: string;
  title: string;
  created: Date;
  status: 'active' | 'completed' | 'failed';
  url: string;
  tabId: number;
}

interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: {
    action?: Action;
    note_id?: string;
    comment?: string;
    note_tags?: string[];
  };
}

interface Note {
  id: string;
  sessionId: string;
  tags: string[];  // например: ['plan'], ['fact'], ['decision'], ['error']
  content: string;
  comments: Array<{ id: string; text: string; timestamp: Date; source: 'agent' | 'update_agent' }>;
  timestamp: Date;
}
### 5. Background Layer (Service Worker)

**Service Worker** — координация между компонентами, keep-alive.

**Компоненты:**
- `ServiceWorker.ts` — координация сообщений
- `MessageRouter.ts` — маршрутизация между UI, Agent, Content Script
- `KeepAlive.ts` — ping каждые 20 секунд (не даёт service worker заснуть)

## Memory Management

### Записная книжка (Notes)

**Структура промпта:**
[System Prompt]
[Записная книжка — извлечённые факты, план, решения с комментариями]
[История сообщений (последние O)]
**Теги нот:**
Теги используются для классификации заметок. В системном промпте указывается, какие теги когда добавлять:

- `plan` — план выполнения задачи (декомпозиция на шаги)
- `fact` — факты о странице (например, "кнопка 'Submit' находится внизу формы")
- `decision` — решения пользователя (например, "пользователь предпочитает английский язык")
- `error` — ошибки и их причины (например, "selector '#btn' не работает, использовать '.submit-btn'")

**Пример промпта для агента:**
Используй следующие теги для заметок:
- 'plan' — когда составляешь план выполнения задачи
- 'fact' — когда обнаруживаешь факты о странице
- 'decision' — когда пользователь принимает решение
- 'error' — когда сталкиваешься с ошибкой
**Инжекция в промпт:**
- Записная книжка всегда перед историей (стабильный контекст)
- Кэш хинт: записная книжка не меняется часто → LLM кэширует этот блок
- Агент видит записную книжку в промпте — не нужен отдельный тул для чтения

**Формат записной книжки в промпте:**
## Notes

### note_123 [plan]
1. Открыть форму
2. Заполнить поля
3. Отправить
  - [comment] Шаг 1 выполнен: форма открыта
  - [comment] Шаг 2 выполнен: поля заполнены

### note_124 [fact]
Кнопка 'Submit' находится внизу формы
### Цикл апдейта (Update Cycle)

**Триггер:** история достигла X + O сообщений (X и O — настраиваемые параметры)

**Процесс:**

1. **Детерминированный перенос нот агента:**
   - Из истории извлекаются все вызовы `write_note` и `comment_note`
   - Новые заметки (write_note) добавляются в записную книжку (клеятся снизу)
   - Комментарии (comment_note) приклеиваются к соответствующим заметкам по ID
   - Этот процесс НЕ использует LLM — просто парсинг истории

2. **Update Agent (отдельная модель) добавляет свои заметки:**
   - Input: записная книжка + вся история (X + O сообщений)
   - Задача: извлечь дополнительную информацию, которую агент мог пропустить
   - Output: новые заметки и комментарии от Update Agent
   - Update Agent знает, что история обрежется до O последних сообщений, поэтому должен тщательно извлечь всё важное

3. **Обрезка истории:**
   - История обрезается до O последних сообщений
   - Агент больше не увидит старые сообщения — вся важная информация должна быть в записной книжке

4. **Окно растёт линейно до X + O → снова цикл апдейта**

**Update Agent промпт:**
Ты — Update Agent. Твоя задача — проанализировать историю диалога и добавить
дополнительные заметки и комментарии, которые основной агент мог пропустить.

ВАЖНО: История будет обрезана до последних {O} сообщений. Агент больше не увидит
старые сообщения. Извлеки ВСЁ важное, что должно остаться в записной книжке.

Текущая записная книжка (уже содержит заметки агента):
{notes}

История диалога (последние {X + O} сообщений):
{history}

Проанализируй историю и добавь:
1. Новые факты о странице, которые агент не записал
2. Решения пользователя, которые агент не зафиксировал
3. Ошибки и их причины, которые агент не отметил
4. Комментарии к существующим заметкам (если агент что-то сделал неправильно)

Если основной агент извлёк что-то неправильно — добавь комментарий прямо в ноту.

Верни новые заметки и комментарии в формате JSON.
**Настройки памяти:**
interface MemoryConfig {
  // Окно истории
  updateThreshold: number;  // X — количество сообщений до цикла апдейта (default: 20)
  historyWindow: number;    // O — количество сообщений после обрезки (default: 6)
  
  // Update Agent
  updateModel: string;      // модель для Update Agent (default: 'gpt-4o-mini')
  updateTemperature: number; // температура для Update Agent (default: 0.3)
  updateMaxTokens: number;   // макс. токенов для ответа Update Agent (default: 2000)
  
  // Лимиты
  maxNotes: number;         // макс. количество нот в записной книжке (default: 100)
  maxCommentsPerNote: number; // макс. комментариев к одной ноте (default: 20)
}
## LLM Configuration

### Провайдеры LLM

Пользователь выбирает провайдера из 3 вариантов:

type LLMProvider = 'openai' | 'anthropic' | 'custom';

interface LLMProviderConfig {
  provider: LLMProvider;
  
  // OpenAI
  openaiApiKey?: string;
  
  // Anthropic
  anthropicApiKey?: string;
  
  // Custom (OpenAI-compatible endpoint)
  customBaseUrl?: string;
  customApiKey?: string;
}
### Основной агент

interface MainAgentConfig {
  provider: LLMProvider;       // 'openai' | 'anthropic' | 'custom'
  model: string;               // название модели (пользователь вводит сам)
  temperature: number;         // температура (default: 0.7)
  maxTokens: number;           // макс. токенов для ответа (default: 4000)
  topP: number;                // top-p sampling (default: 1.0)
  frequencyPenalty: number;    // штраф за частоту (default: 0.0)
  presencePenalty: number;     // штраф за повторение (default: 0.0)
}
### Update Agent

interface UpdateAgentConfig {
  provider: LLMProvider;       // 'openai' | 'anthropic' | 'custom'
  model: string;               // название модели (пользователь вводит сам)
  temperature: number;         // температура (default: 0.3) — ниже для более детерминированного извлечения
  maxTokens: number;           // макс. токенов для ответа (default: 2000)
  topP: number;                // top-p sampling (default: 1.0)
}
**Разделение настроек:**
- Основной агент: более высокая температура для креативности и адаптивности
- Update Agent: низкая температура для детерминированного извлечения фактов
- Провайдеры и модели могут быть разными (основной — мощный, Update — дешёвый)
- Нет жёстко зашитых моделей — пользователь вводит название модели сам
- Поддержка 3 провайдеров: OpenAI, Anthropic, Custom (OpenAI-compatible endpoint)

## Tool System

### Как тулы попадают в системный промпт

Все тулы (псевдотулы агента + VSL SDK тулы) инжектятся в системный промпт в формате function calling:

{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "write_note",
        "description": "Создать новую заметку в записной книжке. Заметка получит уникальный ID автоматически.",
        "parameters": {
          "type": "object",
          "properties": {
            "note": {
              "type": "string",
              "description": "Текст заметки"
            },
            "tags": {
              "type": "array",
              "items": { "type": "string" },
              "description": "Теги для классификации (plan, fact, decision, error)"
            }
          },
          "required": ["note"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "comment_note",
        "description": "Добавить комментарий к существующей заметке по ID",
        "parameters": {
          "type": "object",
          "properties": {
            "note_id": {
              "type": "string",
              "description": "ID заметки (например, note_123)"
            },
            "comment": {
              "type": "string",
              "description": "Текст комментария"
            }
          },
          "required": ["note_id", "comment"]
        }
      }
    },
    // ... VSL SDK тулы (click, type, scroll, etc.)
  ]
}
### Парсинг ответов от LLM

1. LLM возвращает ответ с `tool_calls` (function calling)
2. Парсер извлекает `tool_calls` из ответа
3. Для каждого `tool_call`:
   - Извлекается `name` (имя тула) и `arguments` (JSON-строка)
   - Парсится `arguments` в объект
   - Вызывается соответствующая функция
4. Результат выполнения добавляется в историю

**Пример парсинга:**
const response = await llm.chat(messages, tools);

if (response.tool_calls) {
  for (const toolCall of response.tool_calls) {
    const toolName = toolCall.function.name;
    const toolArgs = JSON.parse(toolCall.function.arguments);
    
    if (toolName === 'write_note') {
      const note = notes.create(toolArgs.note, toolArgs.tags);
      history.add({ role: 'assistant', content: toolCall, metadata: { note_id: note.id } });
    } else if (toolName === 'comment_note') {
      history.add({ role: 'assistant', content: toolCall, metadata: { note_id: toolArgs.note_id, comment: toolArgs.comment } });
    } else if (toolName === 'click') {
      await contentScript.execute({ type: 'click', target_id: toolArgs.target_id });
    }
    // ...
  }
}
## Error Handling & Retries

### Политика обработки ошибок

**1. Ошибки LLM API:**
- **Timeout** (сеть медленная): retry с exponential backoff (1s, 2s, 4s, 8s, макс. 3 попытки)
- **Rate limit** (слишком много запросов): retry после задержки из заголовка `Retry-After` (или 60 секунд)
- **Server error** (5xx): retry с exponential backoff (макс. 3 попытки)
- **Client error** (4xx): НЕ retry, уведомить пользователя об ошибке
- **Invalid response** (невалидный JSON, нет tool_calls): retry 1 раз, если не помогло — уведомить пользователя

**2. Ошибки выполнения тулов:**
- **Невалидный target_id** (элемент не найден): добавить ошибку в историю, агент попробует другой selector
- **Ошибка выполнения действия** (click не сработал): добавить ошибку в историю, агент попробует другой подход
- **Ошибка парсинга tool arguments**: retry LLM с исправленным промптом (добавить пример правильного формата)

**3. Ошибки Update Agent:**
- **Ошибка LLM**: retry с exponential backoff (макс. 2 попытки)
- **Невалидный JSON в ответе**: использовать только детерминированно перенесённые ноты агента (без дополнительных заметок от Update Agent)
- **Таймаут**: пропустить цикл апдейта, продолжить работу с текущей записной книжкой

### Retry логика

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt <maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}
### Уведомления пользователя об ошибках

- **Критические ошибки** (LLM недоступен, API key невалиден): показать в чате системное сообщение с описанием ошибки
- **Временные ошибки** (timeout, rate limit): показать статус "Повторная попытка..." в AgentStatus
- **Ошибки выполнения тулов**: показать в чате как сообщение агента ("Не удалось кликнуть на элемент, пробую другой подход")

## Streaming & UI Feedback

### Стриминг ответов в чат

**1. Стриминг текстовых ответов (reply_to_user):**
- LLM возвращает ответ потоком (streaming)
- Каждый чанк текста отправляется в Side Panel через service worker
- Side Panel обновляет MessageBubble в реальном времени
- Пользователь видит, как агент "печатает" ответ

**2. Стриминг работы с тулами:**
- Когда агент вызывает тул (click, type, write_note, etc.), в чате появляется сообщение:
    🔧 Выполняю: click на элемент "Submit Button"
  - После выполнения тула сообщение обновляется:
    ✅ Выполнено: click на элемент "Submit Button"
  - Если тул вызвал ошибку:
    ❌ Ошибка: элемент "Submit Button" не найден
  **3. Стриминг ошибок:**
- Ошибки LLM показываются в чате как системные сообщения:
    ⚠️ Ошибка подключения к LLM. Повторная попытка через 2 секунды...
  - Ошибки выполнения тулов показываются как сообщения агента:
    Не удалось кликнуть на кнопку "Submit". Попробую другой selector.
  **4. Стриминг статуса агента:**
- **Thinking**: агент думает (ожидает ответ от LLM)
- **Executing**: агент выполняет действие (click, type, etc.)
- **Waiting**: агент ждёт ответа от пользователя (ask_user)
- **Updating**: агент выполняет цикл апдейта памяти

**Пример UI:**
[AgentStatus: Thinking...]

[MessageBubble: assistant]
🔧 Выполняю: write_note "1. Открыть форму\n2. Заполнить поля\n3. Отправить" [plan]

[MessageBubble: assistant]
✅ Выполнено: write_note (ID: note_123)

[MessageBubble: assistant]
🔧 Выполняю: click на элемент "Form Input"

[MessageBubble: assistant]
✅ Выполнено: click на элемент "Form Input"

[MessageBubble: assistant]
🔧 Выполняю: type "John Doe" в элемент "Form Input"

[MessageBubble: assistant]
✅ Выполнено: type "John Doe" в элемент "Form Input"

[MessageBubble: assistant]
🔧 Выполняю: comment_note "note_123" "Шаг 2 выполнен: поля заполнены"

[MessageBubble: assistant]
✅ Выполнено: comment_note (note_id: note_123)

[AgentStatus: Thinking...]

[MessageBubble: assistant]
Я заполнил форму. Отправить?
## Multi-Tab Support

**Физическая работа:**

1. **Новая вкладка = новая сессия:**
   - Пользователь открывает новую вкладку
   - Расширение автоматически создаёт новую сессию для этой вкладки
   - Сессия привязана к tabId (идентификатору вкладки)
   - Каждая сессия имеет свой AgentLoop, свою историю, свою записную книжку

2. **Агент работает на вкладке:**
   - Content script инжектится на страницу вкладки
   - Content script создаёт снапшоты страницы и выполняет действия агента
   - AgentLoop работает в offscreen document, координирует действия через service worker

3. **Пользователь переключается на другую вкладку/окно:**
   - Агент продолжает работать на исходной вкладке
   - Content script на исходной вкладке активен
   - Offscreen document держит AgentLoop
   - **Side Panel автоматически переключается на активную сессию** (привязанную к текущей вкладке)
   - Пользователь видит прогресс текущей вкладки в чате

4. **Переключение между сессиями в Side Panel:**
   - Вкладка "Sessions" показывает список всех активных сессий
   - Каждая сессия показывает: название, URL вкладки, статус (active/completed)
   - Пользователь может вручную переключиться между сессиями в чате
   - При переключении вкладки — Side Panel автоматически показывает сессию этой вкладки

**Пример сценария:**
1. Пользователь открыл вкладку A (example.com), создал сессию A
2. Пользователь открыл вкладку B (another.com), создалась сессия B
3. Side Panel показывает сессию B (активная вкладка)
4. Пользователь переключился на вкладку A → Side Panel автоматически переключился на сессию A
5. Агент продолжает работать на обеих вкладках параллельно

**Ограничения:**
- Если вкладка закрыта — агент останавливается (нет content script)
- Если Chrome "убил" offscreen document (крайне редко) — агент останавливается
- Content script работает только на вкладках, где он инжектен (не на системных страницах Chrome)

## Implementation Phases

### Phase 1: Infrastructure (5-7 дней)

1. **Side Panel setup**
   - Настроить Side Panel API (Manifest V3)
   - Базовый UI (Chat, Sessions вкладки)
   - Интеграция с React/Vue (опционально)

2. **Offscreen Document setup**
   - Настроить offscreen document API
   - Базовый AgentLoop (snapshot → LLM → action)
   - Интеграция с VSL SDK

3. **Storage setup**
   - Настроить chrome.storage.local + IndexedDB
   - CRUD для сессий, сообщений, нот

4. **Service Worker setup**
   - Координация между компонентами
   - Keep-alive ping

### Phase 2: Agent Core (7-10 дней)

1. **AgentLoop implementation**
   - Непрерывный цикл выполнения задачи
   - Псевдотулы (reply_to_user, ask_user, write_note, comment_note)
   - Интеграция с VSL SDK (click, type, scroll)

2. **TaskPlanner implementation**
   - Декомпозиция задачи на шаги
   - Запись плана в ноты (write_note с тегом 'plan')

3. **LLMClient implementation**
   - Стриминг ответов из LLM
   - Function calling (псевдотулы)
   - Retry logic с exponential backoff

### Phase 3: Memory Management (5-7 дней)

1. **Notes system**
   - Записная книжка (CRUD)
   - Инжекция в промпт (формат с тегами и комментариями)
   - Автоматическая генерация ID для нот

2. **Update Cycle**
   - Детерминированный перенос нот агента из истории
   - Update Agent (отдельная модель) для дополнительных заметок
   - Триггер по количеству сообщений (X + O)
   - Обрезка истории до O сообщений

3. **Кэш хинт оптимизация**
   - Стабильный контекст (записная книжка) → кэширование
   - Динамический контекст (история) → без кэширования

### Phase 4: UI/UX (5-7 дней)

1. **Chat UI**
   - MessageBubble (пользователь/агент/система)
   - Стриминг ответов из LLM
   - Стриминг работы с тулами (🔧 Выполняю → ✅ Выполнено)
   - Стриминг ошибок (❌ Ошибка)
   - Визуализация действий агента (overlay)

2. **Sessions UI**
   - SessionList (список сессий)
   - SessionCard (метаданные, статус)
   - Переключение между сессиями
   - Автоматическое переключение при смене вкладки

3. **Visual Feedback**
   - AgentStatus (Thinking, Executing, Waiting, Updating)
   - Подсветка элементов, на которых агент работает
   - Анимация клика
   - Лог действий (опционально)

### Phase 5: Multi-Tab & Polish (3-5 дней)

1. **Multi-tab support**
   - Автоматическое создание сессии для новой вкладки
   - Привязка сессии к tabId
   - Координация через offscreen document
   - Автоматическое переключение Side Panel при смене вкладки

2. **Error handling**
   - Retry logic для LLM (exponential backoff)
   - Обработка ошибок выполнения тулов
   - Уведомления пользователя об ошибках

3. **Settings**
   - Настройки основного агента (модель, temperature, maxTokens)
   - Настройки Update Agent (модель, temperature, maxTokens)
   - Настройки памяти (X, O, maxNotes, maxCommentsPerNote)
   - Настройки UI (тема, язык)

## Risks & Mitigations

### Risk 1: Chrome Extension limitations

**Проблема:** Service worker засыпает через 30 секунд, offscreen document может быть "убит" Chrome.

**Митигация:**
- Keep-alive ping каждые 20 секунд
- Мониторинг состояния offscreen document
- Автоматический перезапуск при падении

### Risk 2: Tab freezing

**Проблема:** Chrome может замораживать неактивные вкладки через ~5 минут.

**Митигация:**
- Content script работает на активной вкладке
- Offscreen document не замораживается
- Если вкладка заморожена — агент останавливается (без content script)

### Risk 3: LLM cost

**Проблема:** Цикл апдейта + основной агент = много LLM-вызовов.

**Митигация:**
- Update Agent — дешёвая модель (gpt-4o-mini)
- Кэш хинт для стабильного контекста (записная книжка)
- Настройка X и O (баланс между стоимостью и качеством)

### Risk 4: Memory management

**Проблема:** История растёт, записная книжка может стать слишком большой.

**Митигация:**
- Обрезка истории до O сообщений
- Лимит на размер записной книжки (maxNotes)
- Лимит на комментарии к одной ноте (maxCommentsPerNote)
- Архивация старых сессий (перенос в IndexedDB)

### Risk 5: LLM errors

**Проблема:** LLM может сбоить (timeout, rate limit, invalid response).

**Митигация:**
- Retry logic с exponential backoff
- Обработка rate limit (Retry-After header)
- Уведомления пользователя об ошибках
- Fallback при критических ошибках

## Dependencies

- **VSL SDK** — snapshot, LLM decision, action execution
- **Chrome Extension APIs** — Side Panel, Offscreen Document, Service Worker, Content Script
- **LLM Provider** — OpenAI/Anthropic/etc. (стриминг, function calling)
- **Storage** — chrome.storage.local + IndexedDB

## Future Enhancements

1. **Voice input** — распознавание голоса для ввода задач
2. **Multi-agent collaboration** — несколько агентов работают вместе
3. **Custom actions** — пользователь может добавлять свои действия
4. **Integration with external tools** — API-вызовы, базы данных
5. **Offline mode** — локальная модель для работы без интернета

## Conclusion

Архитектура браузерного агента основана на:
- **Side Panel** для UI (не ломает верстку)
- **Offscreen Document** для агента (работает в фоне)
- **Content Script** для выполнения действий на странице
- **Memory Management** с записной книжкой и циклом апдейта (ноты и комментарии детерминированно переносятся из истории, Update Agent добавляет свои заметки)
- **Tool System** с function calling и парсингом ответов
- **Error Handling** с retry логикой и уведомлениями пользователя
- **Streaming** для отображения работы агента в реальном времени
- **Multi-tab support** для параллельной работы (новая вкладка = новая сессия, автоматическое переключение)

Реализация занимает ~25-36 дней (5 фаз).