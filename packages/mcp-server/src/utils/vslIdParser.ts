/**
 * VSL ID Parser Utility
 * 
 * Парсит VSL ID из формата `${tag}_${indexPath.join("_")}` в структуру { tag, indexPath }.
 * Корректно обрабатывает теги с underscore (file_input, custom_widget и т.д.).
 * 
 * Примеры:
 * - "button_0_1" → { tag: "button", indexPath: [0, 1] }
 * - "file_input_0_1" → { tag: "file_input", indexPath: [0, 1] }
 * - "custom_widget_2_3_4" → { tag: "custom_widget", indexPath: [2, 3, 4] }
 * - "h1_0_1" → { tag: "h1", indexPath: [0, 1] }
 * 
 * @module vslIdParser
 */

/**
 * Результат парсинга VSL ID
 */
export interface ParsedVslId {
  tag: string;
  indexPath: number[];
}

/**
 * Парсит VSL ID в формат { tag, indexPath }.
 * 
 * VSL ID имеет формат `${tag}_${indexPath.join("_")}`, где:
 * - tag — тип элемента (может содержать underscore: file_input, custom_widget и т.д.,
 *   а также цифры: h1, h2 и т.д.)
 * - indexPath — массив числовых индексов, разделённых underscore
 * 
 * Regex: tag начинается с буквы, может содержать буквы/цифры, underscore только перед
 * сегментом, начинающимся с буквы (не перед числом). indexPath чисто числовой.
 */
export function parseVslId(id: string): ParsedVslId | null {
  const match = id.match(/^([a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*)_(\d+(?:_\d+)*)$/);
  if (!match) return null;
  
  const tag = match[1]!;
  const indexPath = match[2]!.split('_').map(Number);
  
  return { tag, indexPath };
}