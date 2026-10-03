/**
 * Регистрация MCP Tools (T1.6.3, M1.7).
 *
 * 7 инструментов VSL:
 *  - vsl_get_snapshot: получить текущий VSL snapshot (параметр full — полный документ)
 *  - vsl_execute_action: выполнить действие (включая download)
 *  - vsl_navigate: перейти по URL
 *  - vsl_clear_cache: сбросить кэш
 *  - vsl_get_visual: получить visual fragment
 *  - vsl_read_page: гибридное чтение веб-страниц
 *  - vsl_get_text_block: получить полный текст по txt_ref (lazy text loading, M1.7)
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { McpServerConfig } from '../config/loader.js';
import type { SessionManager } from '../session/sessionManager.js';
import { handleGetSnapshot } from './getSnapshot.js';
import { handleNavigate } from './navigate.js';
import { handleClearCache } from './clearCache.js';
import { handleExecuteAction } from './executeAction.js';
import { handleGetVisual } from './getVisual.js';
import { handleReadPage } from './readPage.js';
import { handleGetTextBlock } from './getTextBlock.js';
import { handleClickCoordinates } from './clickCoordinates.js';

/** Список всех инструментов VSL. */
const VSL_TOOLS = [
  {
    name: 'vsl_get_snapshot',
    description: 'Get the current VSL snapshot of the page. Returns a VSL JSON with the semantic structure of elements. VSL (Visual Scene Language) is a JSON representation of the page where each element has: id (unique identifier, e.g. btn_123), type (button/input/link/text/image), text (text content), bbox ([x,y,width,height]), children (nested elements). Example: { viewport:{width:1920,height:1080}, objects:[{id:btn_1,type:button,text:Sign in,bbox:[100,200,80,30]},{id:inp_2,type:input,text:,bbox:[100,250,200,30]}] }. Usage: get the snapshot, find the desired element by id, then use vsl_execute_action to interact. Lazy text loading (DEC-026): texts longer than 200 characters are automatically replaced with txt_preview (first ~50 characters) + txt_ref (reference like tb_001). Full texts are stored in the text_blocks map. Use vsl_get_text_block to retrieve the full text. Parameters: detail_level (low/medium/high) for object filtering, ttl (ms) for caching.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Page URL (optional, if not specified — uses the current page)',
        },
        detail_level: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: "Snapshot detail level. 'low': interactive elements only (buttons, links, inputs). 'medium': interactive + containers (default). 'high': all objects (full DOM). Default: 'medium'.",
        },
        ttl: {
          type: 'number',
          description: 'Cache TTL in milliseconds (default: 5000 = 5s). Set to 0 to disable caching.',
        },
        full: {
          type: 'boolean',
          description: 'Full mode: returns the entire document without filters (replacement for the removed full snapshot tool)',
        },
      },
    },
  },
  {
    name: 'vsl_execute_action',
    description: 'Execute an action on a VSL element. Find the element by id in the snapshot (vsl_get_snapshot), then call this action. Supported actions: click (click on element), type (enter text, requires value), fill (alias for type, enter text, requires value), scroll (scroll, format: "up", "down", "left", "right" or "dir:amount", e.g. "down:300"), select (select option, requires value), hover, focus, blur, check, uncheck, press (press a keyboard key, requires value — key name, e.g. "Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "Space", "Backspace". Used for submitting forms via Enter, navigating via Tab, closing modals via Escape, etc.), upload (file upload, requires value — file path or comma-separated list of paths). Example: {action:click, target_id:btn_1} or {action:type, target_id:inp_2, value:hello@mail.com} or {action:fill, target_id:inp_2, value:hello@mail.com} or {action:press, target_id:inp_1, value:Enter} or {action:upload, target_id:file_input_0, value:/path/to/file.pdf}. Parameter return_state=true returns diff and snapshot after the action.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action name (click, type, fill, scroll, select, etc.)',
        },
        target_id: {
          type: 'string',
          description: 'Target element ID in VSL JSON',
        },
        value: {
          type: 'string',
          description: 'Value for the action (e.g. text for type/fill, option for select)',
        },
        return_state: {
          type: 'boolean',
          description: 'If true, returns diff and snapshot after the action. Useful for tracking DOM changes without an additional vsl_get_diff call. Default: true — always return state to save agent steps. Set to false to disable.',
        },
        timeout: {
          type: 'number',
          description: 'Download completion timeout in ms (only for download action)',
        },
        save_path: {
          type: 'string',
          description: 'Path to save the downloaded file (only for download action)',
        },
      },
      required: ['action', 'target_id'],
    },
  },
  {
    name: 'vsl_navigate',
    description: 'Navigate to a URL in the browser. Use this to open a new page before getting a snapshot. Example: {url:"https://example.com"}. Returns {status:"success"} or {status:"error", message:"..."}. After navigation, call vsl_get_snapshot to get the page structure.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to navigate to',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'vsl_clear_cache',
    description: 'Clear the VSL snapshot cache. Use when you need a fresh snapshot from scratch (e.g. after significant page changes or when switching to a different site). Example: {}. The next vsl_get_snapshot call will create a new snapshot.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'vsl_get_visual',
    description: 'Get a visual fragment (screenshot) of an element in base64 WebP format. Use for elements that are hard to classify by text alone (icons, charts, custom widgets). Returns {mediaType:image/webp, data:base64data}. Example: {element_id: img_5}. Parameter auto_refresh=true automatically refreshes the snapshot before searching for the element. IMPORTANT: works only with IDs from vsl_get_snapshot (browser DOM). Does NOT work with IDs from vsl_read_page (semantic IDs) — use vsl_get_snapshot to get compatible IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        element_id: {
          type: 'string',
          description: 'Element ID in VSL JSON',
        },
        auto_refresh: {
          type: 'boolean',
          description: 'If true, automatically refreshes the snapshot before searching for the element. Useful after navigation or actions that modify the DOM. Default: false.',
        },
      },
      required: ['element_id'],
    },
  },
  {
    name: 'vsl_read_page',
    description: 'Read web pages. Automatically determines the strategy: static pages are read via HTTP (fast), SPAs are rendered via browser. readable=true filters noise (navigation, footers, cookie banners) for clean content. On repeated calls, returns diff (changes) instead of full content. Parameter detail_level (low/medium/high) filters objects in the snapshot: low — interactive elements only (buttons, links, inputs), medium — interactive + containers (default), high — all objects. Metadata includes vsl_estimated_tokens — the number of tokens in the VSL snapshot for context estimation. Example: {url:"https://example.com", readable:true, detail_level:"medium"}. Returns snapshot and diff automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Page URL to read',
        },
        readable: {
          type: 'boolean',
          description: 'Readable mode: filter noise (nav, footer, cookie banners) for clean content',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'vsl_get_text_block',
    description: 'Get the full text by txt_ref from lazy text loading (M1.7). When an element\'s text exceeds 200 characters, only txt_preview (first ~50 characters) and txt_ref (e.g. tb_001) are stored in the VSL JSON. Use this tool to retrieve the full text. Example: {block_id: "tb_001"}. Returns {block_id, text} with the full content.',
    inputSchema: {
      type: 'object',
      properties: {
        block_id: {
          type: 'string',
          description: 'Text block ID from the txt_ref field of a VSL object (format: tb_xxx)',
        },
      },
      required: ['block_id'],
    },
  },
  {
    name: 'vsl_click_coordinates',
    description: 'Perform multiple clicks at coordinates relative to a target element. Coordinates (x, y) are specified in pixels from the top-left corner of the element (use bbox from snapshot). Supports delays between clicks. Returns diff + snapshot + screenshot after all clicks. Example: {target_id: "iframe_2", clicks: [{x: 50, y: 50, delay_after_ms: 500}, {x: 150, y: 50}]}.',
    inputSchema: {
      type: 'object',
      properties: {
        target_id: {
          type: 'string',
          description: 'Element ID in VSL JSON (e.g. iframe_2 for reCAPTCHA challenge iframe)',
        },
        clicks: {
          type: 'array',
          description: 'Array of clicks. Each click: {x: number, y: number, delay_after_ms?: number}. Coordinates in pixels from the top-left corner of the element.',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'X coordinate (pixels from left edge of element)' },
              y: { type: 'number', description: 'Y coordinate (pixels from top edge of element)' },
              delay_after_ms: { type: 'number', description: 'Delay after click (ms)' },
            },
            required: ['x', 'y'],
          },
        },
        return_state: {
          type: 'boolean',
          description: 'If true (default), returns diff + snapshot + screenshot after all clicks.',
        },
      },
      required: ['target_id', 'clicks'],
    },
  },
];

/**
 * Регистрирует handlers для MCP Tools.
 *
 * @param server - MCP Server instance
 * @param config - Конфигурация сервера
 * @param sessionManager - Session Manager для per-session isolation
 */
export function registerTools(server: Server, config: McpServerConfig, sessionManager: SessionManager): void {
  // Handler: список инструментов
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: VSL_TOOLS,
    };
  });

  // Handler: вызов инструмента
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args, _meta } = request.params as { name: string; arguments?: Record<string, unknown>; _meta?: { sessionId?: string } };

    // Per-session isolation: извлекаем sessionId из _meta или используем default из env VSL_SESSION_ID
    const sessionId = _meta?.sessionId ?? sessionManager.getDefaultSessionId();
    const { session } = sessionManager.getSession(sessionId);
    const browser = sessionManager.getBrowserManager();

    try {
      let result: unknown;

      switch (name) {
        case 'vsl_get_snapshot':
          result = await handleGetSnapshot(args as never, browser, session, config, sessionId);
          break;

        case 'vsl_execute_action':
          result = await handleExecuteAction(args as never, browser, session, sessionId);
          break;

        case 'vsl_navigate':
          result = await handleNavigate(args as never, browser, session, sessionId);
          break;

        case 'vsl_clear_cache':
          result = await handleClearCache(session);
          break;

        case 'vsl_get_visual':
          // vsl_get_visual returns MCP-compliant ImageContent directly
          result = await handleGetVisual(args as never, browser, session, sessionId);
          break;

        case 'vsl_read_page':
          result = await handleReadPage(args as never, browser, session, config, sessionId);
          break;

        case 'vsl_get_text_block':
          result = await handleGetTextBlock(args as never, session);
          break;
        case 'vsl_click_coordinates':
          result = await handleClickCoordinates(args as never, browser, session, sessionId);
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

      // Если результат уже MCP-compliant (имеет поле content с массивом), возвращаем напрямую
      if (result && typeof result === 'object' && 'content' in result && Array.isArray((result as { content: unknown[] }).content)) {
        return result as {
          content: Array<{ type: string; data?: string; text?: string; mimeType?: string }>;
          isError?: boolean;
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