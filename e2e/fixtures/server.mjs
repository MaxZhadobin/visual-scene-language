/**
 * Локальный HTTP-сервер для e2e-тестов (T1.5.6, dev_11).
 *
 * Раздаёт 3 fixture-страницы:
 *   /registration.html — форма регистрации (имя, email, пароль, кнопка Submit)
 *   /ecommerce.html    — каталог товаров (карточки + кнопка "Add to cart")
 *   /settings.html     — страница настроек (select language + Save)
 *
 * Запуск: node e2e/fixtures/server.mjs (порт 3456, см. playwright.config.ts).
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const PORT = Number(process.env.FIXTURE_PORT ?? 3456);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  let filePath = url.pathname === '/' ? '/registration.html' : url.pathname;
  filePath = join(__dirname, filePath);

  try {
    const body = readFileSync(filePath);
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`fixture server listening on http://localhost:${PORT}`);
});