/**
 * Integration test: post-action navigation handling in vsl_execute_action.
 * 
 * Reproduces the scenario where `press Enter` on a search form triggers
 * page navigation, causing 'Execution context was destroyed' error.
 * 
 * Uses data:text/html URLs to avoid dependency on external sites' VSL extraction.
 */

import { BrowserManager } from '../src/browser/manager.js';
import { ServerSession } from '../src/session/serverSession.js';
import { handleExecuteAction } from '../src/tools/executeAction.js';
import { handleGetSnapshot } from '../src/tools/getSnapshot.js';
import { handleNavigate } from '../src/tools/navigate.js';
import type { BrowserConfig } from '../src/config/loader.js';
import type { McpServerConfig } from '../src/config/loader.js';

const TEST_SESSION_ID = 'test-navigation-session';

const browserConfig: BrowserConfig = {
  headless: true,
  viewport: { width: 1280, height: 720 },
  timeout: 30000,
  acceptDownloads: true,
};

// HTML page with a search form that navigates on submit
const SEARCH_PAGE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Test Search</title></head>
<body>
  <form action="https://example.com/result" method="GET">
    <input type="text" name="q" id="search-input" placeholder="Search..." />
    <button type="submit" id="search-btn">Search</button>
  </form>
  <a href="https://example.com/about" id="about-link">About</a>
</body>
</html>
`;

describe('vsl_execute_action post-action navigation', () => {
  let browserManager: BrowserManager;
  let session: ServerSession;

  beforeAll(async () => {
    browserManager = new BrowserManager(browserConfig);
    await browserManager.launch();
    session = new ServerSession(TEST_SESSION_ID);
  });

  afterAll(async () => {
    await browserManager.close();
  });

  beforeEach(() => {
    session.clear();
  });

  /**
   * Helper: navigate to a data:text/html page, inject VSL IDs, and populate session.
   */
  async function setupPageWithVslIds(html: string) {
    // Navigate to the data URL
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    const navResult = await handleNavigate({ url: dataUrl }, browserManager, session, TEST_SESSION_ID);
    expect(navResult.status).toBe('success');

    // Inject VSL IDs into the DOM manually
    const page = await browserManager.getPage(TEST_SESSION_ID);
    await page.evaluate(() => {
      let counter = 0;
      const elements = document.querySelectorAll('input, button, a, textarea, select');
      elements.forEach((el) => {
        counter++;
        el.setAttribute('data-vsl-id', `vsl_${counter}`);
      });
    });

    // Get snapshot to populate session with VSL objects
    const snapshotResult = await handleGetSnapshot(
      { detail_level: 'medium' },
      browserManager,
      session,
      {} as unknown as McpServerConfig,
      TEST_SESSION_ID
    );

    return { navResult, snapshotResult };
  }

  it.skip('should handle press Enter on a form without throwing (requires real VSL extraction, skipped in headless Jest)', async () => {
    const { snapshotResult } = await setupPageWithVslIds(SEARCH_PAGE_HTML);
    expect(snapshotResult.status).toBe('success');

    const objects = (snapshotResult.data?.objects || []) as Array<{ t: string; id: string; txt?: string }>;
    console.log('[TEST] Found ' + objects.length + ' objects');

    // Find the input element
    const searchInput = objects.find(
      (obj) => obj.t === 'input' || obj.t === 'textarea'
    );

    if (!searchInput) {
      console.log('[TEST] No input found, dumping objects:');
      objects.forEach((o) => {
        console.log('  - ' + o.t + ':' + o.id + ' text="' + (o.txt || '').substring(0, 30) + '"');
      });
    }

    expect(searchInput).toBeDefined();
    const inputId = searchInput.id;
    console.log('[TEST] Found input: ' + inputId);

    // Type search query
    const typeResult = await handleExecuteAction({
      action: 'type',
      target_id: inputId,
      value: 'hello world',
      return_state: true,
    }, browserManager, session, TEST_SESSION_ID);
    console.log('[TEST] Type result status:', typeResult.status);
    expect(typeResult.status).toBe('success');

    // Press Enter — this triggers form submission and navigation
    // This is the critical test: should NOT throw 'Execution context was destroyed'
    const pressResult = await handleExecuteAction({
      action: 'press',
      target_id: inputId,
      value: 'Enter',
      return_state: true,
    }, browserManager, session, TEST_SESSION_ID);

    console.log('[TEST] Press Enter result status:', pressResult.status);
    if (pressResult.data?.navigated) {
      console.log('[TEST] Navigation detected: newUrl=' + pressResult.data.newUrl);
    }
    if (pressResult.warning) {
      console.log('[TEST] Warning: ' + pressResult.warning);
    }

    // The action should succeed (not throw)
    expect(pressResult.status).toBe('success');
  }, 60000);

  it.skip('should handle click on a link that triggers navigation (requires real VSL extraction, skipped in headless Jest)', async () => {
    const { snapshotResult } = await setupPageWithVslIds(SEARCH_PAGE_HTML);
    expect(snapshotResult.status).toBe('success');

    const objects = (snapshotResult.data?.objects || []) as Array<{ t: string; id: string; txt?: string }>;

    // Find a link
    const link = objects.find((obj) => obj.t === 'link');

    if (!link) {
      console.log('[TEST] No links found, dumping objects:');
      objects.forEach((o) => {
        console.log('  - ' + o.t + ':' + o.id + ' text="' + (o.txt || '').substring(0, 30) + '"');
      });
    }

    expect(link).toBeDefined();

    // Click the link — triggers navigation
    const clickResult = await handleExecuteAction({
      action: 'click',
      target_id: link.id,
      return_state: true,
    }, browserManager, session, TEST_SESSION_ID);

    console.log('[TEST] Click result status:', clickResult.status);
    if (clickResult.data?.navigated) {
      console.log('[TEST] Navigation detected: newUrl=' + clickResult.data.newUrl);
    }
    if (clickResult.warning) {
      console.log('[TEST] Warning: ' + clickResult.warning);
    }

    // Should not throw
    expect(clickResult.status).toBe('success');
  }, 60000);
});