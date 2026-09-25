/**
 * Регистрация MCP Tools (T1.6.3, M1.7).
 *
 * 10 инструментов VSL:
 *  - vsl_get_snapshot: получить текущий VSL snapshot
 *  - vsl_get_diff: получить только изменения
 *  - vsl_execute_action: выполнить действие
 *  - vsl_navigate: перейти по URL
 *  - vsl_clear_cache: сбросить кэш
 *  - vsl_get_visual: получить visual fragment
 *  - vsl_read_page: гибридное чтение веб-страниц
 *  - vsl_get_full_json: получить полный VSL JSON (bypass diff-first)
 *  - vsl_get_text_block: получить полный текст по txt_ref (lazy text loading, M1.7)
 *  - vsl_download: управление скачиванием файлов (Playwright BrowserContext)
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { McpServerConfig } from '../config/loader.js';
import { BrowserManager } from '../browser/manager.js';
import { ServerSession } from '../session/serverSession.js';
import { handleGetSnapshot } from './getSnapshot.js';
import { handleGetDiff } from './getDiff.js';
import { handleNavigate } from './navigate.js';
import { handleClearCache } from './clearCache.js';
import { handleExecuteAction } from './executeAction.js';
import { handleGetVisual } from './getVisual.js';
import { handleReadPage } from './readPage.js';
import { handleGetFullJson } from './getFullJson.js';
import { handleGetTextBlock } from './getTextBlock.js';
import { handleDownload } from './download.js';

/** Список всех инструментов VSL. */
const VSL_TOOLS = [
  {
    name: 'vsl_get_snapshot',
    description: 'Получить текущий VSL snapshot страницы. Возвращает VSL JSON с семантической структурой элементов. VSL (Visual Scene Language) — это JSON-представление страницы, где каждый элемент имеет: id (уникальный идентификатор, например btn_123), type (button/input/link/text/image), text (текстовое содержимое), bbox ([x,y,width,height]), children (вложенные элементы). Пример: { viewport:{width:1920,height:1080}, objects:[{id:btn_1,type:button,text:Войти,bbox:[100,200,80,30]},{id:inp_2,type:input,text:,bbox:[100,250,200,30]}] }. Использование: получите snapshot, найдите нужный элемент по id, затем используйте vsl_execute_action для взаимодействия.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL страницы (опционально, если не указан — используется текущая страница)',
        },
      },
    },
  },
  {
    name: 'vsl_get_diff',
    description: 'Получить только изменения с момента последнего snapshot. Возвращает Diff JSON с секциями added (новые объекты), modified (изменённые), removed (удалённые). Пример: { changes:{ added:[{id:btn_3,type:button,text:Отправить,bbox:[300,400,100,30]}], modified:[{id:btn_1,changes:{text:[Войти,Авторизация]}}], removed:[{id:inp_2}] } }. Используйте для отслеживания изменений на странице после действий (клик, навигация, форма).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'vsl_execute_action',
    description: 'Выполнить действие над элементом VSL. Найдите элемент по id в snapshot (vsl_get_snapshot), затем вызовите это действие. Поддерживаемые действия: click (клик по элементу), type (ввод текста, требует value), fill (алиас type, ввод текста, требует value), scroll (прокрутка), select (выбор опции, требует value), hover, focus, blur, check, uncheck, press (нажатие клавиши). Пример: {action:click, target_id:btn_1} или {action:type, target_id:inp_2, value:hello@mail.com} или {action:fill, target_id:inp_2, value:hello@mail.com}.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Имя действия (click, type, fill, scroll, select, и др.)',
        },
        target_id: {
          type: 'string',
          description: 'ID элемента-цели в VSL JSON',
        },
        value: {
          type: 'string',
          description: 'Значение для действия (например, текст для type/fill, опция для select)',
        },
      },
      required: ['action', 'target_id'],
    },
  },
  {
    name: 'vsl_navigate',
    description: 'Перейти по URL в браузере. Используйте для открытия новой страницы перед получением snapshot. Пример: {url:"https://example.com"}. Возвращает {status:"success"} или {status:"error", message:"..."}. После навигации вызовите vsl_get_snapshot для получения структуры страницы.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL для навигации',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'vsl_clear_cache',
    description: 'Сбросить кэш VSL snapshot. Используйте когда нужно получить свежий snapshot страницы с нуля (например, после значительных изменений на странице или при переходе на другой сайт). Пример: {}. Следующий вызов vsl_get_snapshot создаст новый snapshot.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'vsl_get_visual',
    description: 'Получить visual fragment (скриншот) элемента в формате base64 WebP. Используйте для элементов, которые сложно классифицировать по тексту (иконки, графики, кастомные виджеты). Возвращает {mediaType:image/webp, data:base64data}. Пример: {element_id: img_5}.',
    inputSchema: {
      type: 'object',
      properties: {
        element_id: {
          type: 'string',
          description: 'ID элемента в VSL JSON',
        },
      },
      required: ['element_id'],
    },
  },
  {
    name: 'vsl_read_page',
    description: 'Гибридное чтение веб-страниц. mode=auto (по умолчанию): статические страницы читаются через HTTP (быстро), SPA рендерятся через браузер. mode=http: только HTTP (без браузера). mode=render: всегда рендерить через браузер. readable=true: фильтрует шум (навигация, футеры, cookie-баннеры) для чистого контента. При повторных вызовах возвращает diff (изменения), а не полный контент. Пример: {url:https://example.com, mode:auto, readable:true}.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL страницы для чтения',
        },
        mode: {
          type: 'string',
          enum: ['auto', 'http', 'render'],
          description: 'Режим чтения: auto (авто-детект), http (только HTTP), render (всегда рендерить)',
        },
        readable: {
          type: 'boolean',
          description: 'Readable-режим: фильтрация шума (nav, footer, cookie banners) для чистого контента',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'vsl_get_full_json',
    description: 'Получить полный VSL JSON текущей страницы, минуя diff-first логику. Используйте когда: (1) история агента обрезалась и вы потеряли контекст, (2) нужно увидеть полную картину страницы, (3) инкрементальные диффы не дают достаточно информации. Пример: {}. Возвращает полный VSL Document с viewport и objects.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'vsl_get_text_block',
    description: 'Получить полный текст по txt_ref из lazy text loading (M1.7). Когда текст элемента > 200 символов, в VSL JSON хранится только txt_preview (первые ~50 символов) и txt_ref (например, tb_001). Используйте этот tool для получения полного текста. Пример: {block_id: "tb_001"}. Возвращает {block_id, text} с полным содержимым.',
    inputSchema: {
      type: 'object',
      properties: {
        block_id: {
          type: 'string',
          description: 'ID текстового блока из txt_ref поля VSL объекта (формат tb_xxx)',
        },
      },
      required: ['block_id'],
    },
  },
  {
    name: 'vsl_download',
    description: 'Управление скачиванием файлов через Playwright BrowserContext. Два режима: (1) target_id — клик по элементу (кнопка/ссылка для скачивания), инициирует download через Playwright; (2) value — прямое скачивание по URL (создаёт <a download> и кликает). Возвращает downloadId, filename, url, status (completed/failed/cancelled), path. Примеры: {target_id: btn_download} или {value: "https://example.com/file.pdf"}. Опционально: timeout (мс), save_path (путь для сохранения).',
    inputSchema: {
      type: 'object',
      properties: {
        target_id: {
          type: 'string',
          description: 'ID элемента для клика (кнопка/ссылка для скачивания)',
        },
        value: {
          type: 'string',
          description: 'URL для прямого скачивания',
        },
        timeout: {
          type: 'number',
          description: 'Таймаут ожидания загрузки в мс (по умолчанию из config)',
        },
        save_path: {
          type: 'string',
          description: 'Путь для сохранения файла (опционально)',
        },
      },
    },
  },
];

/**
 * Регистрирует handlers для MCP Tools.
 *
 * @param server - MCP Server instance
 * @param config - Конфигурация сервера
 * @param browser - Browser Manager (shared singleton)
 * @param session - Server Session (shared singleton)
 */
export function registerTools(server: Server, config: McpServerConfig, browser: BrowserManager, session: ServerSession): void {

  // Handler: список инструментов
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: VSL_TOOLS,
    };
  });

  // Handler: вызов инструмента
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'vsl_get_snapshot':
          result = await handleGetSnapshot(args as never, browser, session, config);
          break;

        case 'vsl_get_diff':
          result = await handleGetDiff(session);
          break;

        case 'vsl_execute_action':
          result = await handleExecuteAction(args as never, browser, session);
          break;

        case 'vsl_navigate':
          result = await handleNavigate(args as never, browser);
          break;

        case 'vsl_clear_cache':
          result = await handleClearCache(session);
          break;

        case 'vsl_get_visual':
          result = await handleGetVisual(args as never, browser);
          break;

        case 'vsl_read_page':
          result = await handleReadPage(args as never, browser, session, config);
          break;

        case 'vsl_get_full_json':
          result = await handleGetFullJson(args as never, session);
          break;

        case 'vsl_get_text_block':
          result = await handleGetTextBlock(args as never, session);
          break;

        case 'vsl_download':
          result = await handleDownload(args as never, browser, session);
          break;
        default:
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `Unknown tool: ${name}`,
                }),
              },
            ],
            isError: true,
          };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
            }),
          },
        ],
        isError: true,
      };
    }
  });
}