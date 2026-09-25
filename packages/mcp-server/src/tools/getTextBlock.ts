/**
 * Tool: vsl_get_text_block (M1.7, DEC-026).
 *
 * Получает полный текст по txt_ref из text_blocks кэша VSL документа.
 * Используется для lazy text loading — когда текст > 200 символов,
 * в VSL JSON хранится только txt_preview + txt_ref, а полный текст
 * отдаётся по запросу через этот tool.
 *
 * Flow:
 *  1. Валидация block_id
 *  2. Получение текущего VSL snapshot через ServerSession
 *  3. Поиск block_id в text_blocks
 *  4. Возврат полного текста или ошибка
 */

import type { ServerSession } from '../session/serverSession.js';

/** Аргументы vsl_get_text_block. */
export interface GetTextBlockArgs {
  block_id: string;
}

/** Результат vsl_get_text_block. */
export interface GetTextBlockResult {
  status: 'success' | 'error';
  data?: {
    block_id: string;
    text: string;
  };
  error?: string;
}

/**
 * Обработчик vsl_get_text_block.
 *
 * @param args - Аргументы инструмента
 * @param session - Server Session (хранит текущий VSL snapshot)
 */
export async function handleGetTextBlock(
  args: GetTextBlockArgs,
  session: ServerSession,
): Promise<GetTextBlockResult> {
  try {
    // 1. Валидация block_id
    if (!args.block_id || typeof args.block_id !== 'string') {
      return {
        status: 'error',
        error: 'block_id is required and must be a string',
      };
    }

    // 2. Получаем текущий snapshot
    if (!session.hasSnapshot()) {
      return {
        status: 'error',
        error: 'No VSL snapshot available. Call vsl_get_snapshot first.',
      };
    }

    const snapshot = session.getSnapshot();

    // 3. Проверяем наличие text_blocks
    if (!snapshot.text_blocks) {
      return {
        status: 'error',
        error: 'No text blocks in current snapshot. The document may not contain long texts.',
      };
    }

    // 4. Ищем block_id в text_blocks
    const fullText = snapshot.text_blocks[args.block_id];
    if (fullText === undefined) {
      return {
        status: 'error',
        error: `Text block not found: ${args.block_id}`,
      };
    }

    // 5. Возвращаем полный текст
    return {
      status: 'success',
      data: {
        block_id: args.block_id,
        text: fullText,
      },
    };
  } catch (error) {
    return {
      status: 'error',
      error: `vsl_get_text_block failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}