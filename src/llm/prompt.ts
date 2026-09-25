/**
 * Промпты LLM (T1.3.4): system prompt (VSL-формат + Action Model + 3 few-shot)
 * и user-промпт по каноническому шаблону ARCHITECTURE.md §2.5.
 *
 * Промпты провайдер-независимы: few-shot включены ТЕКСТОМ в system prompt,
 * поэтому OpenAI (function calling) и Anthropic (tool use) получают идентичную
 * инструкцию; само действие модель возвращает через tool «execute_action»
 * (см. schema.ts). Список действий рендерится из VALID_ACTIONS (actions.ts) —
 * единый источник правды для промпта и enum в JSON Schema.
 *
 * Примечание (neg note f48a9bda4bd5): llm_prompts_examples.md из корня —
 * примеры домена scene editing (Phase 4), НЕ заготовка для этого промпта;
 * текст построен с нуля из ARCHITECTURE §2.5 + §7.
 */

import { isVslDiff } from '../session/snapshotSession';
import { VALID_ACTIONS } from './actions';
import type { VslObject } from '../types/vsl';
import type { VslInput, VisualFragmentData, VisualFragmentStore } from './types';

/** Few-shot пример: заголовок, компактный VSL-фрагмент, цель, действие. */
export interface FewShotExample {
  title: string;
  /** Компактный VSL JSON (иллюстративный фрагмент). */
  vsl: string;
  goal: string;
  /** Ожидаемый ответ модели — JSON действия (формат §7.4). */
  action: string;
}

/** Три few-shot примера (T1.3.4): клик по кнопке, заполнение формы, навигация. */
export const FEW_SHOT_EXAMPLES: readonly FewShotExample[] = [
  {
    title: 'Example 1 — click a button (full document)',
    vsl: '{"vsl_version":"1.0.0","objects":[{"id":"header_0","t":"header","ch":[{"id":"link_0_0","t":"link","txt":"Войти","act":["click"]},{"id":"link_0_1","t":"link","txt":"Регистрация","act":["click"]}]}]}',
    goal: 'Войти в аккаунт',
    action: '{"action":"click","target_id":"link_0_0","value":null,"reasoning":"Ссылка «Войти» открывает форму входа"}',
  },
  {
    title: 'Example 2 — fill a form (diff input)',
    vsl: '{"diff_version":2,"base_version":1,"changes":{"added":[{"id":"form_1_0","t":"input","txt":"Поиск","act":["click","type"]}],"modified":[],"removed":[],"unchanged_refs":["button_1_1"]}}',
    goal: 'Найти «vsl json»',
    action: '{"action":"type","target_id":"form_1_0","value":"vsl json","reasoning":"Ввожу запрос в новое поле поиска из диффа; затем нажму button_1_1 из unchanged_refs"}',
  },
  {
    title: 'Example 3 — navigation',
    vsl: '{"vsl_version":"1.0.0","objects":[{"id":"main_0","t":"main","ch":[{"id":"header_0_0","t":"header","txt":"Настройки"}]}]}',
    goal: 'Открыть страницу настроек по прямой ссылке',
    action: '{"action":"navigate","value":"https://example.com/settings","reasoning":"Целевой URL известен — прямая навигация быстрее"}',
  },
];

/** Свод правил параметров в едином формате {action, target_id, value, reasoning}. */
const PARAMETER_CONVENTIONS = [
  '- click, hover, focus, blur, clear, check, uncheck, open, close, expand, collapse — target_id;',
  '- type — target_id + value (text to type);',
  '- select — target_id + value (option);',
  '- scroll — value: "up" | "down" (optional amount: "down:300");',
  '- drag — target_id: source element, value: destination element id;',
  '- submit, reset — target_id: form id;',
  '- wait — value: condition (e.g. a selector or "idle");',
  '- navigate — value: URL;',
  '- download — target_id (element to click) OR value (URL to download directly);',
  '- go_back, go_forward, refresh — no parameters.',
].join('\n');

/**
 * Строит system prompt: описание VSL-формата (включая семантику диффа §6.2),
 * правила ответа через tool «execute_action», Action Model и 3 few-shot.
 */
export function buildSystemPrompt(): string {
  const actions = VALID_ACTIONS.join(' | ');
  const examples = FEW_SHOT_EXAMPLES.map(
    (example) =>
      `${example.title}\nVSL JSON: ${example.vsl}\nUser goal: ${example.goal}\nAction: ${example.action}`,
  ).join('\n\n');

  return [
    "You are a screen understanding agent. You receive a VSL JSON representation of the current screen. Analyze the structure and decide what action to take to accomplish the user's goal.",
    '',
    '## VSL JSON format',
    '',
    'Elements form a tree via "ch" (children). Element keys:',
    '- "id" — deterministic unique element id; the ONLY valid value for target_id;',
    '- "t" — semantic type: button | input | link | nav | header | main | container | image | select | textarea | modal | tab;',
    '- "r" — ARIA role (clarifies semantics);',
    '- "p" — position [x, y], relative 0.0–1.0 of the viewport;',
    '- "s" — size [width, height] in pixels;',
    '- "st" — state: checked | expanded | disabled;',
    '- "txt" — visible text or accessible label;',
    '- "act" — actions the element supports (e.g. ["click"]);',
    '- "vf" / "vf_meta" — optional visual fragment reference; matching image content, if provided, is attached as separate image blocks.',
    '',
    'The input is either a full document:',
    '{"vsl_version": "...", "canvas": {...}, "objects": [...]}',
    'or a diff (diff-first mode):',
    '{"diff_version": N, "base_version": M, "changes": {"added": [...], "modified": [...], "removed": [...], "unchanged_refs": [...]}}',
    '',
    'Diff semantics:',
    '- "added" — new subtrees, fully described;',
    '- "modified" — objects carrying ONLY the changed fields;',
    '- "removed" — ids that no longer exist: NEVER target them;',
    '- "unchanged_refs" — known unchanged elements: valid targets.',
    '',
    '## Lazy text loading (M1.7)',
    '',
    'When an element text exceeds 200 characters, the VSL JSON contains only:',
    '- "txt_preview" — first ~50 characters of the text (with ellipsis);',
    '- "txt_ref" — reference to the full text block (format: tb_xxx, e.g. tb_001).',
    '',
    'The full text is stored in "text_blocks" at the document root. To retrieve it, call the MCP tool vsl_get_text_block with {block_id: "<txt_ref value>"}.',
    '',
    'When to fetch full text: only when the user goal REQUIRES reading the content of a long text (e.g. "find the paragraph about X", "click the link in the article about Y"). For navigation by headings/titles — txt_preview is sufficient.',
    '',
    '## Actions',
    '',
    'Respond with exactly ONE next action. Allowed actions:',
    actions + '.',
    '',
    'Unified parameter format {action, target_id, value, reasoning}:',
    PARAMETER_CONVENTIONS,
    '',
    '## Response rules',
    '',
    '1. Respond ONLY by calling the execute_action tool with one object:',
    '   {"action": "...", "target_id": "...", "value": null, "reasoning": "..."}',
    '2. When required, target_id MUST be an id present in the provided VSL JSON (document or diff, including unchanged_refs).',
    '3. Never target removed ids; never invent ids or actions outside the allowed list.',
    '4. Prefer the smallest action that moves toward the goal; explain briefly in "reasoning".',
    '',
    '## Examples',
    '',
    examples,
  ].join('\n');
}

/** Строит user-промпт по шаблону §2.5: Current screen (VSL JSON) + User goal. */
export function buildUserPrompt(vslJson: VslInput, goal: string): string {
  return `Current screen (VSL JSON):\n${JSON.stringify(vslJson)}\n\nUser goal: ${goal}`;
}

/**
 * Собирает данные изображений для vf-ссылок входа (DESIGN_SYSTEM §4.4, AC[7]):
 * обходит VslDocument (или дифф: added рекурсивно + modified), собирает `vf`-ссылки
 * и возвращает данные только тех, что есть в сторе (lazy loading: нет данных —
 * нет image-блока). Порядок стабильный (порядок первого вхождения ссылок).
 */
export function collectFragmentData(
  vslJson: VslInput,
  store?: VisualFragmentStore,
): VisualFragmentData[] {
  if (store === undefined || store.size === 0) return [];
  const refs = new Set<string>();
  const visit = (objects: readonly VslObject[]): void => {
    for (const object of objects) {
      const vf = (object as { vf?: unknown }).vf;
      if (typeof vf === 'string') refs.add(vf);
      visit(object.ch ?? []);
    }
  };
  if (isVslDiff(vslJson)) {
    visit(vslJson.changes.added);
    for (const modified of vslJson.changes.modified) {
      const vf = (modified as { vf?: unknown }).vf;
      if (typeof vf === 'string') refs.add(vf);
    }
  } else {
    visit(vslJson.objects);
  }
  const fragments: VisualFragmentData[] = [];
  for (const ref of refs) {
    const data = store.get(ref);
    if (data !== undefined) fragments.push(data);
  }
  return fragments;
}
