# File Upload Support Implementation Plan

## Spec

Реализовать поддержку загрузки файлов (upload) в VSL SDK и MCP server. Агент должен иметь возможность загружать файлы на веб-страницы через:
1. Стандартные `<input type="file">` элементы
2. Кастомные file picker'ы (кнопки "Загрузить", drag-and-drop зоны)

Реализация должна следовать паттерну существующего download функционала (T1.6.3, dev_10) и использовать Playwright API:
- `page.setInputFiles(selector, files)` — для `<input type="file">`
- `page.on('filechooser', handler)` + `fileChooser.setFiles()` — для кастомных file picker'ов

## Acceptance Criteria

- [ ] **AC-1**: BrowserManager содержит метод `uploadFile(selector, filePaths)` для загрузки файлов через `<input type="file">`
- [ ] **AC-2**: BrowserManager содержит метод `waitForFileChooser()` для обработки кастомных file picker'ов
- [ ] **AC-3**: `vsl_execute_action` поддерживает action `upload` с параметрами `target_id` и `value` (путь к файлу)
- [ ] **AC-4**: VSL snapshot помечает `<input type="file">` элементы как тип `file_input` с атрибутом `accept`
- [ ] **AC-5**: Реализована проверка безопасности (path traversal protection) для путей к файлам
- [ ] **AC-6**: Написаны unit-тесты для `uploadFile` и `waitForFileChooser` в BrowserManager
- [ ] **AC-7**: Написаны unit-тесты для action `upload` в `executeAction.ts`
- [ ] **AC-8**: Написан e2e-тест загрузки файла через `<input type="file">`
- [ ] **AC-9**: Документация обновлена (README.md, tool descriptions)

## Constraints

- Следовать существующей архитектуре и паттернам кода (см. `download.ts` как референс)
- Playwright — optional peer dependency, код должен корректно обрабатывать его отсутствие
- Поддержка абсолютных и относительных путей к файлам с path traversal проверкой
- Lazy navigation: если браузер не на URL из snapshot → автоматически навигировать (как в download)
- TypeScript strict mode, ESLint compliance
- Тесты через Jest, покрытие ≥80% для нового кода

## Implementation Plan

### Phase 1: BrowserManager Extensions

**Task 1.1: Add Playwright FileChooser type**
- File: `packages/mcp-server/src/browser/manager.ts`
- Add interface `PlaywrightFileChooser` with methods:
  - `element(): PlaywrightElement`
  - `setFiles(files: string | string[]): Promise<void>`
  - `isMultiple(): boolean`
- Add interface `PlaywrightElement` with method `inputFiles(): string[]`
- Add to `PlaywrightPage` interface:
  - `setInputFiles(selector: string, files: string[]): Promise<void>`
  - `on(event: 'filechooser', listener: (fileChooser: PlaywrightFileChooser) => void): void`

**Task 1.2: Implement `uploadFile` method**
- File: `packages/mcp-server/src/browser/manager.ts`
- Method signature: `async uploadFile(selector: string, filePaths: string[]): Promise<{ success: boolean; count: number }>`
- Logic:
  1. Validate file paths (path traversal check)
  2. Resolve relative paths against `config.uploadsPath` or CWD
  3. Call `page.setInputFiles(selector, filePaths)`
  4. Return result with uploaded file count
- Error handling: file not found, permission denied, element not found

**Task 1.3: Implement `waitForFileChooser` method**
- File: `packages/mcp-server/src/browser/manager.ts`
- Method signature: `async waitForFileChooser(timeout?: number): Promise<PlaywrightFileChooser>`
- Logic:
  1. Set up Promise that resolves on 'filechooser' event
  2. Apply timeout (default from `config.fileChooserTimeout` or 30000ms)
  3. Return FileChooser object for caller to invoke `setFiles()`
- Add config option `fileChooserTimeout` to `BrowserConfig`

**Task 1.4: Add `uploadsPath` to BrowserConfig**
- File: `packages/mcp-server/src/config/loader.ts`
- Add field `uploadsPath?: string` to `BrowserConfig`
- Default value: `~/.vsl/uploads` (similar to downloadsPath)
- Validate path exists or create on first use

### Phase 2: MCP Tool Implementation

**Task 2.1: Add `upload` action to `vsl_execute_action`**
- File: `packages/mcp-server/src/tools/executeAction.ts`
- Add `'upload'` to `VALID_ACTIONS` array
- Add case in switch statement:
    case 'upload': {
    if (!args.value) {
      return { status: 'error', error: 'value (file path) is required for upload action' };
    }
    const filePaths = Array.isArray(args.value) ? args.value : [args.value];
    const result = await browser.uploadFile(selector, filePaths);
    return {
      status: 'success',
      data: {
        action: args.action,
        target_id: args.target_id,
        success: result.success,
        upload: { count: result.count, files: filePaths },
      },
    };
  }
  - Add lazy navigation (same pattern as download)

**Task 2.2: Create dedicated `vsl_upload` tool (optional, for advanced use cases)**
- File: `packages/mcp-server/src/tools/upload.ts` (new file)
- Similar structure to `download.ts`
- Arguments:
  - `target_id?: string` — element ID for click (triggers filechooser)
  - `input_selector?: string` — CSS selector for `<input type="file">`
  - `files: string[]` — array of file paths
  - `timeout?: number` — filechooser timeout
- Logic:
  1. If `input_selector` provided → use `browser.uploadFile(selector, files)`
  2. If `target_id` provided → click element, wait for filechooser, call `setFiles(files)`
  3. Return result with uploaded file names
- Register tool in `packages/mcp-server/src/tools/index.ts`

### Phase 3: VSL Snapshot Enhancement

**Task 3.1: Detect `<input type="file">` in DOM extractor**
- File: `src/capture/domExtractor.ts` (SDK side)
- In element classification logic, detect `<input type="file">` elements
- Assign type `file_input` instead of generic `input`
- Extract `accept` attribute (e.g., `image/*`, `.pdf,.doc`)
- Extract `multiple` attribute (boolean)

**Task 3.2: Add `file_input` type to VSL types**
- File: `src/types/vsl.ts`
- Add `'file_input'` to element type union
- Add optional fields to `VSLObject`:
  - `accept?: string` — accepted file types
  - `multiple?: boolean` — allows multiple files

**Task 3.3: Update snapshot builder**
- File: `src/builder/vslBuilder.ts`
- When building VSL object for `<input type="file">`:
  - Set `type: 'file_input'`
  - Include `accept` and `multiple` attributes
  - Generate appropriate `id` (e.g., `file_input_1`)

### Phase 4: Security & Validation

**Task 4.1: Implement path traversal protection**
- File: `packages/mcp-server/src/browser/manager.ts` (in `uploadFile`)
- Logic:
    const isAbsolute = filePath.startsWith('/');
  if (!isAbsolute) {
    const resolvedBase = path.resolve(config.uploadsPath || os.homedir(), '.vsl', 'uploads');
    const resolvedFile = path.resolve(resolvedBase, filePath);
    if (!resolvedFile.startsWith(resolvedBase + path.sep) && resolvedFile !== resolvedBase) {
      throw new Error(`Path traversal detected: file path '${filePath}' escapes uploads directory`);
    }
  }
  - Apply same pattern as in `download.ts` (lines 166-178)

**Task 4.2: Validate file existence and permissions**
- Before calling `setInputFiles`, check:
  - File exists (`fs.access(filePath, fs.constants.R_OK)`)
  - File is readable
  - File is not a directory
- Return clear error messages for each case

### Phase 5: Testing

**Task 5.1: Unit tests for BrowserManager upload methods**
- File: `packages/mcp-server/src/browser/manager.test.ts` (new file)
- Test cases:
  - `uploadFile` with valid absolute path
  - `uploadFile` with valid relative path
  - `uploadFile` with path traversal attempt (should throw)
  - `uploadFile` with non-existent file (should throw)
  - `waitForFileChooser` resolves on event
  - `waitForFileChooser` timeout handling
- Mock Playwright page and filechooser

**Task 5.2: Unit tests for `vsl_execute_action` upload**
- File: `packages/mcp-server/src/tools/executeAction.test.ts`
- Test cases:
  - Upload action with valid target_id and value
  - Upload action without value (should error)
  - Upload action with multiple files
  - Upload action with lazy navigation
- Follow pattern from existing tests (see `download.test.ts`)

**Task 5.3: Unit tests for `vsl_upload` tool (if implemented)**
- File: `packages/mcp-server/src/tools/upload.test.ts` (new file)
- Test cases:
  - Upload via input_selector
  - Upload via target_id (filechooser flow)
  - Missing required arguments
  - File not found error handling
- Follow pattern from `download.test.ts`

**Task 5.4: E2E test for file upload**
- File: `e2e/upload.spec.ts` (new file)
- Test scenario:
  1. Navigate to test page with `<input type="file">`
  2. Call `vsl_execute_action` with action='upload', target_id='file_input_1', value='/path/to/test.txt'
  3. Verify file was uploaded (check page state or network request)
- Create test fixture HTML file in `e2e/fixtures/upload.html`

### Phase 6: Documentation

**Task 6.1: Update MCP server README**
- File: `packages/mcp-server/README.md`
- Add section "File Upload" with:
  - Usage examples for `vsl_execute_action` with action='upload'
  - Usage examples for `vsl_upload` (if implemented)
  - Security considerations (path restrictions)
  - Supported file types and limitations

**Task 6.2: Update tool descriptions**
- File: `packages/mcp-server/src/tools/index.ts`
- Add description for `upload` action in `vsl_execute_action`
- Add description for `vsl_upload` tool (if implemented)
- Include parameter descriptions and examples

**Task 6.3: Update main README**
- File: `README.md`
- Add "File Upload" section to features list
- Add example workflow: read page → find file input → upload file

## Architecture Decisions

**DEC-UPLOAD-1: Use setInputFiles for standard inputs**
- Rationale: Playwright's `setInputFiles` is the most reliable way to upload files through `<input type="file">`. It bypasses browser security restrictions and works in headless mode.

**DEC-UPLOAD-2: Use filechooser event for custom pickers**
- Rationale: Custom file pickers (buttons, drag-and-drop) don't have direct input elements. Listening to 'filechooser' event allows intercepting the file selection dialog.

**DEC-UPLOAD-3: Follow download.ts pattern**
- Rationale: Consistency with existing file operations reduces cognitive load and maintenance burden. Download implementation already handles lazy navigation, error handling, and security checks.

**DEC-UPLOAD-4: Optional dedicated vsl_upload tool**
- Rationale: While `vsl_execute_action` with action='upload' covers most cases, a dedicated tool provides clearer API for complex scenarios (multiple files, filechooser timeout). Similar to how `vsl_download` exists alongside download action.

**DEC-UPLOAD-5: Path traversal protection**
- Rationale: Security critical. Users may provide relative paths that escape intended directory. Must validate all file paths before passing to Playwright.

## Risk Assessment

**Risk 1: Custom file pickers without input elements**
- Mitigation: Document limitation. For fully custom implementations (no `<input>`), users may need to use `vsl_execute_action` with action='click' to trigger filechooser, then handle upload manually.

**Risk 2: Browser compatibility**
- Mitigation: Playwright abstracts browser differences. `setInputFiles` and `filechooser` are stable APIs across Chromium, Firefox, WebKit.

**Risk 3: Large file uploads**
- Mitigation: Add timeout configuration. Document that very large files may require increased `fileChooserTimeout`.

**Risk 4: Path traversal attacks**
- Mitigation: Strict validation in `uploadFile` method. Only allow paths within `uploadsPath` directory (for relative paths) or explicit absolute paths (user responsibility).

## Estimated Effort

- Phase 1 (BrowserManager): 4-6 hours
- Phase 2 (MCP Tool): 3-4 hours
- Phase 3 (VSL Snapshot): 2-3 hours
- Phase 4 (Security): 1-2 hours
- Phase 5 (Testing): 4-6 hours
- Phase 6 (Documentation): 2-3 hours
- **Total: 16-24 hours**

## Dependencies

- Playwright ≥1.20.0 (for stable `setInputFiles` and `filechooser` APIs)
- Existing VSL SDK and MCP server infrastructure
- Test fixtures (HTML pages with file inputs)

## Success Metrics

- All acceptance criteria pass
- Code coverage ≥80% for new code
- E2E tests pass on CI
- Documentation is clear and includes working examples
- No security vulnerabilities (path traversal, file permission issues)

## Future Enhancements (Out of Scope)

- Drag-and-drop file upload support
- File preview before upload
- Progress tracking for large uploads
- Batch upload (multiple files to multiple inputs)
- File type validation against `accept` attribute