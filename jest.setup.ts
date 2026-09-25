/**
 * Jest setup (jsdom).
 *
 * jsdom не имеет layout-движка: getBoundingClientRect() возвращает нулевые rect.
 * Прод-код SDK рассчитан на реальный браузер с нативным API и не меняется.
 * Тестовые фикстуры задают координаты декларативно — через атрибут
 * `data-rect="x,y,width,height"`, который этот полифилл парсит
 * (гипотеза note_1789916090383, решение пользователя — jsdom + моки координат).
 */

interface RectTuple {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ZERO_RECT: RectTuple = { x: 0, y: 0, width: 0, height: 0 };

function parseDataRect(el: Element): RectTuple | null {
  const raw = el.getAttribute('data-rect');
  if (!raw) return null;
  const parts = raw.split(',').map((s) => Number.parseFloat(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x = 0, y = 0, width = 0, height = 0] = parts;
  return { x, y, width, height };
}

function toDOMRect(r: RectTuple): DOMRect {
  if (typeof DOMRect === 'function') {
    return new DOMRect(r.x, r.y, r.width, r.height);
  }
  // Защитный фолбэк для сборок jsdom без конструктора DOMRect.
  return {
    ...r,
    top: r.y,
    left: r.x,
    right: r.x + r.width,
    bottom: r.y + r.height,
    toJSON: () => ({ ...r }),
  } as DOMRect;
}

// Фиксированный тестовый viewport — база для нормализации p=[0..1] в VSL Builder.
Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true, writable: true });
Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true, writable: true });

Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  return toDOMRect(parseDataRect(this) ?? ZERO_RECT);
};