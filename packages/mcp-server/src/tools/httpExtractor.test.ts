/**
 * Unit tests for HTTP Extractor (M1.6, DEC-024).
 *
 * Test coverage:
 *  - buildVslFromDom(): HTML → VSL JSON парсинг
 *  - extractViaHttp(): HTTP-извлечение с моком fetch
 *  - detectSpa(): SPA-детекция по маркерам
 *  - applyReadableFilter(): фильтрация шума
 *  - extractTextContent(): извлечение текста
 *  - extractTitle(): извлечение title
 *  - countWords(): подсчёт слов
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  buildVslFromDom,
  extractViaHttp,
  detectSpa,
  applyReadableFilter,
  extractTextContent,
  extractTitle,
  countWords,
} from './httpExtractor.js';

describe('httpExtractor', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as never;
  });

  describe('buildVslFromDom()', () => {
    it('строит базовый VSL JSON из HTML', () => {
      const html = '<html><head><title>Test</title></head><body><p>Hello</p></body></html>';
      const vsl = buildVslFromDom(html, { url: 'https://example.com', title: 'Test' });

      expect(vsl.vsl_version).toBe('1.0.0');
      expect(vsl.canvas.viewport).toEqual({ width: 1280, height: 800, unit: 'px' });
      expect(vsl.canvas.url).toBe('https://example.com');
      expect(vsl.canvas.title).toBe('Test');
      expect(vsl.objects.length).toBeGreaterThan(0);
    });

    it('определяет тип элемента по тегу (L1)', () => {
      const html = '<html><body><button>Click</button><a href="#">Link</a><input type="text" /></body></html>';
      const vsl = buildVslFromDom(html);

      const button = vsl.objects.find((o) => o.t === 'button');
      const link = vsl.objects.find((o) => o.t === 'link');
      const input = vsl.objects.find((o) => o.t === 'input');

      expect(button).toBeDefined();
      expect(link).toBeDefined();
      expect(input).toBeDefined();
    });

    it('определяет тип элемента по ARIA role (L2)', () => {
      const html = '<html><body><div role="button">Custom Button</div></body></html>';
      const vsl = buildVslFromDom(html);

      const button = vsl.objects.find((o) => o.r === 'button');
      expect(button).toBeDefined();
      expect(button?.t).toBe('button');
    });

    it('определяет состояние элемента (disabled, expanded, pressed)', () => {
      const html = `
        <html><body>
          <button aria-disabled="true">Disabled</button>
          <button aria-expanded="true">Expanded</button>
          <button aria-pressed="true">Pressed</button>
        </body></html>
      `;
      const vsl = buildVslFromDom(html);

      const disabled = vsl.objects.find((o) => o.st === 'disabled');
      const expanded = vsl.objects.find((o) => o.st === 'expanded');
      const pressed = vsl.objects.find((o) => o.st === 'pressed');

      expect(disabled).toBeDefined();
      expect(expanded).toBeDefined();
      expect(pressed).toBeDefined();
    });

    it('определяет действия по типу элемента', () => {
      const html = '<html><body><button>Click</button><input type="text" /></body></html>';
      const vsl = buildVslFromDom(html);

      const button = vsl.objects.find((o) => o.t === 'button');
      const input = vsl.objects.find((o) => o.t === 'input');

      expect(button?.act).toEqual(['click']);
      expect(input?.act).toEqual(['click', 'type', 'clear']);
    });

    it('не добавляет действия для disabled элементов', () => {
      const html = '<html><body><button aria-disabled="true">Disabled</button></body></html>';
      const vsl = buildVslFromDom(html);

      const disabled = vsl.objects.find((o) => o.st === 'disabled');
      expect(disabled?.act).toBeUndefined();
    });

    it('применяет lazy text loading для длинных текстов', () => {
      const longText = 'A'.repeat(250); // > LAZY_TEXT_THRESHOLD (200)
      const html = `<html><body><p>${longText}</p></body></html>`;
      const vsl = buildVslFromDom(html);

      const textElement = vsl.objects.find((o) => o.txt_preview);
      expect(textElement).toBeDefined();
      expect(textElement?.txt_preview).toBeDefined();
      expect(textElement?.txt_preview?.length).toBeLessThanOrEqual(51); // 50 + '…'
      expect(textElement?.txt_ref).toBeDefined();
      expect(vsl.text_blocks).toBeDefined();
      expect(vsl.text_blocks?.[textElement!.txt_ref!]).toBe(longText);
    });

    it('фильтрует невидимые элементы (aria-hidden="true")', () => {
      const html = '<html><body><div aria-hidden="true">Hidden</div><p>Visible</p></body></html>';
      const vsl = buildVslFromDom(html);

      const hidden = vsl.objects.find((o) => o.txt === 'Hidden');
      expect(hidden).toBeUndefined();
    });

    it('фильтрует элементы с display: none', () => {
      const html = '<html><body><div style="display: none">Hidden</div><p>Visible</p></body></html>';
      const vsl = buildVslFromDom(html);

      const hidden = vsl.objects.find((o) => o.txt === 'Hidden');
      expect(hidden).toBeUndefined();
    });

    it('удаляет script, style, link теги', () => {
      const html = `
        <html>
          <head><title>Test</title><script>alert('x')</script><style>.x{}</style></head>
          <body><p>Content</p></body>
        </html>
      `;
      const vsl = buildVslFromDom(html);

      const script = vsl.objects.find((o) => o.txt?.includes('alert'));
      const style = vsl.objects.find((o) => o.txt?.includes('.x'));
      expect(script).toBeUndefined();
      expect(style).toBeUndefined();
    });

    it('извлекает текст из aria-label', () => {
      const html = '<html><body><button aria-label="Close dialog">X</button></body></html>';
      const vsl = buildVslFromDom(html);

      const button = vsl.objects.find((o) => o.t === 'button');
      expect(button?.txt).toBe('Close dialog');
    });

    it('сохраняет data-* и aria-* атрибуты', () => {
      const html = '<html><body><div data-testid="test" aria-label="Test">Content</div></body></html>';
      const vsl = buildVslFromDom(html);

      const element = vsl.objects.find((o) => o.attributes);
      expect(element?.attributes?.['data-testid']).toBe('test');
      expect(element?.attributes?.['aria-label']).toBe('Test');
    });

    it('устанавливает p=null и s=null для HTTP-пути (нет координат)', () => {
      const html = '<html><body><p>Text</p></body></html>';
      const vsl = buildVslFromDom(html);

      const element = vsl.objects.find((o) => o.t === 'text');
      expect(element?.p).toBeNull();
      expect(element?.s).toBeNull();
    });

    it('строит иерархию детей (ch)', () => {
      const html = '<html><body><div><p>Child 1</p><p>Child 2</p></div></body></html>';
      const vsl = buildVslFromDom(html);

      const container = vsl.objects.find((o) => o.t === 'container');
      expect(container?.ch).toBeDefined();
      expect(container?.ch?.length).toBeGreaterThan(0);
    });
  });

  describe('extractViaHttp()', () => {
    it('успешно извлекает контент через HTTP', async () => {
      const html = '<html><head><title>Test</title></head><body><p>Hello World</p></body></html>';
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(html),
      });

      const result = await extractViaHttp('https://example.com');

      expect(result.url).toBe('https://example.com');
      expect(result.rawHtml).toBe(html);
      expect(result.textContent).toContain('Hello World');
      expect(result.title).toBe('Test');
      expect(result.wordCount).toBeGreaterThan(0);
      expect(result.isSpa).toBe(false);
      expect(result.readableApplied).toBe(false);
      expect(result.vslDocument).toBeDefined();
      expect(result.vslDocument.vsl_version).toBe('1.0.0');
    });

    it('применяет readable-фильтр при readable=true', async () => {
      const html = '<html><body><nav>Nav</nav><main>Content</main><footer>Footer</footer></body></html>';
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(html),
      });

      const result = await extractViaHttp('https://example.com', { readable: true });

      expect(result.readableApplied).toBe(true);
      expect(result.filteredHtml).not.toContain('<nav>');
      expect(result.filteredHtml).not.toContain('<footer>');
    });

    it('детектирует SPA по маркерам', async () => {
      const html = '<html><body><div data-reactroot></div></body></html>';
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(html),
      });

      const result = await extractViaHttp('https://example.com');

      expect(result.isSpa).toBe(true);
    });

    it('выбрасывает ошибку при HTTP != 200', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(extractViaHttp('https://example.com')).rejects.toThrow('HTTP 404');
    });

    it('выбрасывает ошибку при network failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(extractViaHttp('https://example.com')).rejects.toThrow('Network error');
    });

    it('выбрасывает ошибку при timeout', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('AbortError')), 10);
        });
      });

      await expect(extractViaHttp('https://example.com', { timeout: 5 })).rejects.toThrow();
    });
  });

  describe('detectSpa()', () => {
    it('детектирует SPA по id="root"', () => {
      // detectSpa ищет буквальную строку 'id="root"' в HTML
      expect(detectSpa('<div id="root"></div>')).toBe(true);
    });

    it('детектирует SPA по id="app"', () => {
      expect(detectSpa('<div id="app"></div>')).toBe(true);
    });

    it('детектирует SPA по data-reactroot', () => {
      expect(detectSpa('<div data-reactroot></div>')).toBe(true);
    });

    it('детектирует SPA по ng-app', () => {
      expect(detectSpa('<div ng-app></div>')).toBe(true);
    });

    it('возвращает false для статической страницы', () => {
      expect(detectSpa('<html><body><p>Static</p></body></html>')).toBe(false);
    });
  });

  describe('applyReadableFilter()', () => {
    it('удаляет nav теги', () => {
      const html = '<html><body><nav>Navigation</nav><main>Content</main></body></html>';
      const filtered = applyReadableFilter(html);

      expect(filtered).not.toContain('<nav>');
      expect(filtered).toContain('<main>');
    });

    it('удаляет footer теги', () => {
      const html = '<html><body><main>Content</main><footer>Footer</footer></body></html>';
      const filtered = applyReadableFilter(html);

      expect(filtered).not.toContain('<footer>');
      expect(filtered).toContain('<main>');
    });

    it('удаляет cookie banners (по тегу, не по классу)', () => {
      // applyReadableFilter работает с тегами, а не с CSS-классами
      // .cookie-banner не будет удалён, потому что это класс, а не тег
      const html = '<html><body><cookie-banner>Accept cookies</cookie-banner><p>Content</p></body></html>';
      const filtered = applyReadableFilter(html);

      expect(filtered).not.toContain('<cookie-banner>');
      expect(filtered).toContain('<p>');
    });
  });

  describe('extractTextContent()', () => {
    it('извлекает текст из HTML', () => {
      const html = '<html><body><p>Hello World</p></body></html>';
      const text = extractTextContent(html);

      expect(text).toContain('Hello World');
    });

    it('удаляет script теги', () => {
      const html = '<html><body><script>alert("x")</script><p>Content</p></body></html>';
      const text = extractTextContent(html);

      expect(text).not.toContain('alert');
      expect(text).toContain('Content');
    });

    it('удаляет style теги', () => {
      const html = '<html><body><style>.x{color:red}</style><p>Content</p></body></html>';
      const text = extractTextContent(html);

      expect(text).not.toContain('.x');
      expect(text).toContain('Content');
    });

    it('нормализует пробелы', () => {
      const html = '<html><body><p>Hello    World</p></body></html>';
      const text = extractTextContent(html);

      expect(text).toBe('Hello World');
    });
  });

  describe('extractTitle()', () => {
    it('извлекает title из HTML', () => {
      const html = '<html><head><title>My Page</title></head><body></body></html>';
      const title = extractTitle(html);

      expect(title).toBe('My Page');
    });

    it('возвращает undefined если title отсутствует', () => {
      const html = '<html><head></head><body></body></html>';
      const title = extractTitle(html);

      expect(title).toBeUndefined();
    });

    it('извлекает title с пробелами', () => {
      const html = '<html><head><title>  My Page  </title></head><body></body></html>';
      const title = extractTitle(html);

      expect(title).toBe('My Page');
    });
  });

  describe('countWords()', () => {
    it('подсчитывает слова в тексте', () => {
      const text = 'Hello World Test';
      const count = countWords(text);

      expect(count).toBe(3);
    });

    it('игнорирует множественные пробелы', () => {
      const text = 'Hello    World    Test';
      const count = countWords(text);

      expect(count).toBe(3);
    });

    it('возвращает 0 для пустой строки', () => {
      const count = countWords('');
      expect(count).toBe(0);
    });

    it('возвращает 0 для строки с пробелами', () => {
      const count = countWords('   ');
      expect(count).toBe(0);
    });
  });
});