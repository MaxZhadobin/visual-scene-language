/**
 * E2E тест для загрузки файлов через <input type="file">.
 *
 * Тестирует полный flow:
 *  1. Запуск Playwright браузера
 *  2. Навигация на HTML страницу с input[type=file]
 *  3. Вызов uploadFile() через BrowserManager
 *  4. Проверка, что файл успешно загружен
 *
 * Требования:
 *  - Playwright должен быть установлен (npm install playwright)
 *  - Браузеры должны быть загружены (npx playwright install chromium)
 *
 * Если Playwright не установлен — тест пропускается.
 */

import { BrowserManager } from './manager.js';
import type { BrowserConfig } from '../config/loader.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// HTML страница с input[type=file]
const UPLOAD_PAGE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Upload Test</title></head>
<body>
  <h1>File Upload Test</h1>
  <form id="uploadForm">
    <label for="fileInput">Select file:</label>
    <input type="file" id="fileInput" name="file" accept=".txt,.pdf" />
    <button type="submit">Upload</button>
  </form>
  <div id="result"></div>
  <script>
    document.getElementById('uploadForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('fileInput');
      const file = input.files[0];
      if (file) {
        document.getElementById('result').textContent = 'Uploaded: ' + file.name;
      }
    });
  </script>
</body>
</html>
`;

// Проверяем, установлен ли Playwright
let isPlaywrightAvailable = false;
try {
  await import('playwright');
  isPlaywrightAvailable = true;
} catch {
  // Playwright не установлен
}

describe('E2E: File Upload', () => {
  let browserManager: BrowserManager;
  let tempDir: string;
  let testFilePath: string;

  beforeAll(async () => {
    if (!isPlaywrightAvailable) {
      return;
    }

    // Создаём временную директорию и тестовый файл
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsl-upload-test-'));
    testFilePath = path.join(tempDir, 'test-upload.txt');
    fs.writeFileSync(testFilePath, 'This is a test file for upload');

    // Создаём BrowserManager с тестовой конфигурацией
    const config: BrowserConfig = {
      headless: true,
      downloadsPath: tempDir,
      downloadTimeout: 10000,
      viewport: { width: 1280, height: 720 },
    };
    browserManager = new BrowserManager(config);
  });

  afterAll(async () => {
    if (!isPlaywrightAvailable) {
      return;
    }

    await browserManager?.close();

    // Удаляем временную директорию
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  (isPlaywrightAvailable ? it : it.skip)(
    'загружает файл через input[type=file] с абсолютным путём',
    async () => {
      // 1. Запускаем браузер и открываем страницу
      await browserManager.launch();
      const page = await browserManager.getPage();

      // Используем data URL для HTML страницы
      const dataUrl = `data:text/html;base64,${Buffer.from(UPLOAD_PAGE_HTML).toString('base64')}`;
      await browserManager.navigate(dataUrl);

      // 2. Загружаем файл через uploadFile
      const selector = '#fileInput';
      await browserManager.uploadFile(selector, [testFilePath]);

      // 3. Проверяем, что файл загружен в input
      const fileName = await page.evaluate(() => {
        const input = document.getElementById('fileInput') as HTMLInputElement;
        return input.files?.[0]?.name || null;
      });

      expect(fileName).toBe('test-upload.txt');
    },
    30000,
  );

  (isPlaywrightAvailable ? it : it.skip)(
    'загружает несколько файлов если input имеет multiple',
    async () => {
      // Создаём второй тестовый файл
      const testFile2Path = path.join(tempDir, 'test-upload-2.txt');
      fs.writeFileSync(testFile2Path, 'Second test file');

      // HTML с multiple
      const multiUploadHtml = UPLOAD_PAGE_HTML.replace(
        'accept=".txt,.pdf"',
        'accept=".txt,.pdf" multiple',
      );
      const dataUrl = `data:text/html;base64,${Buffer.from(multiUploadHtml).toString('base64')}`;

      await browserManager.navigate(dataUrl);

      // Загружаем два файла
      const selector = '#fileInput';
      await browserManager.uploadFile(selector, [testFilePath, testFile2Path]);

      // Проверяем, что оба файла загружены
      const page = await browserManager.getPage();
      const fileCount = await page.evaluate(() => {
        const input = document.getElementById('fileInput') as HTMLInputElement;
        return input.files?.length || 0;
      });

      expect(fileCount).toBe(2);
    },
    30000,
  );

  (isPlaywrightAvailable ? it : it.skip)(
    'выбрасывает ошибку при path traversal',
    async () => {
      await browserManager.launch();
      const dataUrl = `data:text/html;base64,${Buffer.from(UPLOAD_PAGE_HTML).toString('base64')}`;
      await browserManager.navigate(dataUrl);

      const selector = '#fileInput';
      const maliciousPath = '../../../etc/passwd';

      await expect(browserManager.uploadFile(selector, [maliciousPath])).rejects.toThrow(
        /Path traversal|escapes CWD/i,
      );
    },
    30000,
  );

  (isPlaywrightAvailable ? it : it.skip)(
    'обрабатывает кастомный file picker через waitForFileChooser',
    async () => {
      // HTML с кастомным file picker (не input[type=file], а кнопка, вызывающая file chooser)
      const customPickerHtml = `
<!DOCTYPE html>
<html>
<head><title>Custom Picker Test</title></head>
<body>
  <h1>Custom File Picker Test</h1>
  <button id="customPicker">Choose File</button>
  <div id="fileName"></div>
  <script>
    // Создаём скрытый input и кликаем по нему при нажатии кнопки
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      if (input.files[0]) {
        document.getElementById('fileName').textContent = 'Selected: ' + input.files[0].name;
      }
    });

    document.getElementById('customPicker').addEventListener('click', () => {
      input.click();
    });
  </script>
</body>
</html>
`;
      const dataUrl = `data:text/html;base64,${Buffer.from(customPickerHtml).toString('base64')}`;

      await browserManager.navigate(dataUrl);

      // Запускаем waitForFileChooser в фоне
      const fileChooserPromise = browserManager.waitForFileChooser();

      // Кликаем по кнопке, которая вызывает file chooser
      const page = await browserManager.getPage();
      await page.click('#customPicker');

      // Ожидаем file chooser
      const fileChooser = await fileChooserPromise;
      expect(fileChooser).toBeDefined();

      // Устанавливаем файл
      await fileChooser.setFiles(testFilePath);

      // Проверяем, что файл выбран
      const fileName = await page.evaluate(() => {
        return document.getElementById('fileName')?.textContent || '';
      });

      expect(fileName).toContain('test-upload.txt');
    },
    30000,
  );
});