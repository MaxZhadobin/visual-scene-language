/**
 * Unit test: post-action navigation handling in vsl_execute_action.
 * 
 * Tests that 'Execution context was destroyed' error is properly handled
 * when an action (like press Enter) triggers page navigation.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { handleExecuteAction } from '../src/tools/executeAction.js';
import type { BrowserManager } from '../src/browser/manager.js';
import type { ServerSession } from '../src/session/serverSession.js';

const TEST_SESSION_ID = 'test-navigation-unit';

// Mock BrowserManager
function createMockBrowserManager(options: {
  urlBeforeAction?: string;
  urlAfterAction?: string;
  pressError?: Error | null;
  hasVslIds?: boolean;
}): BrowserManager {
  const {
    urlBeforeAction = 'https://example.com/search',
    urlAfterAction = 'https://example.com/results?q=test',
    pressError = null,
    hasVslIds = true,
  } = options;

  let currentUrl = urlBeforeAction;

  const mockPage = {
    url: jest.fn(() => currentUrl),
    keyboard: {
      press: jest.fn(async () => {
        if (pressError) {
          // Simulate navigation happening during press
          currentUrl = urlAfterAction;
          throw pressError;
        }
        currentUrl = urlAfterAction;
      }),
    },
    waitForLoadState: jest.fn(async () => {}),
    waitForTimeout: jest.fn(async () => {}),
    locator: jest.fn(() => ({
      click: jest.fn(async () => {}),
      fill: jest.fn(async () => {}),
      press: jest.fn(async () => {}),
    })),
  };

  const mockBrowser = {
    isAvailable: jest.fn(async () => true),
    getPage: jest.fn(async () => mockPage),
    evaluate: jest.fn(async (fn: (...a: unknown[]) => unknown, _sessionId: string, ..._args: unknown[]) => {
      // Handle different evaluate calls
      const fnStr = fn.toString();
      if (fnStr.includes('window.location.href')) {
        return currentUrl;
      }
      if (fnStr.includes('data-vsl-id')) {
        return hasVslIds;
      }
      // DOM stabilization
      return undefined;
    }),
  } as unknown as BrowserManager;

  return mockBrowser;
}

// Mock ServerSession
function createMockSession(options: {
  snapshotUrl?: string;
  idMap?: Map<string, string>;
}): ServerSession {
  const {
    snapshotUrl = 'https://example.com/search',
    idMap = new Map([['inp_1', 'input_0_0_0']]),
  } = options;

  const mockSession = {
    hasSnapshot: jest.fn(() => true),
    getSnapshot: jest.fn(() => ({
      canvas: { url: snapshotUrl },
    })),
    getIdMap: jest.fn(() => idMap),
    clear: jest.fn(),
  } as unknown as ServerSession;

  return mockSession;
}

describe('vsl_execute_action post-action navigation (unit)', () => {
  it('should handle press Enter triggering "Execution context was destroyed"', async () => {
    const navigationError = new Error('Execution context was destroyed, most likely because of a navigation');
    
    const browser = createMockBrowserManager({
      urlBeforeAction: 'https://example.com/search',
      urlAfterAction: 'https://example.com/results?q=test',
      pressError: navigationError,
      hasVslIds: true,
    });

    const session = createMockSession({
      snapshotUrl: 'https://example.com/search',
      idMap: new Map([['inp_1', 'input_0_0_0']]),
    });

    const result = await handleExecuteAction({
      action: 'press',
      target_id: 'inp_1',
      value: 'Enter',
      return_state: true,
    }, browser, session, TEST_SESSION_ID);

    // Should succeed, not throw
    console.log('[TEST] result:', JSON.stringify(result, null, 2));
    expect(result.status).toBe('success');
    expect(result.data?.navigated).toBe(true);
    expect(result.data?.newUrl).toBe('https://example.com/results?q=test');
    // Verify navigation detection was triggered
    const page = await browser.getPage(TEST_SESSION_ID);
    expect(page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 5000 });
  }, 30000);

  it('should detect navigation via URL change even without error', async () => {
    const browser = createMockBrowserManager({
      urlBeforeAction: 'https://example.com/search',
      urlAfterAction: 'https://example.com/results?q=test',
      pressError: null, // No error, but URL changes
      hasVslIds: true,
    });

    const session = createMockSession({
      snapshotUrl: 'https://example.com/search',
    });

    const result = await handleExecuteAction({
      action: 'press',
      target_id: 'inp_1',
      value: 'Enter',
      return_state: true,
    }, browser, session, TEST_SESSION_ID);

    expect(result.status).toBe('success');
    expect(result.data?.navigated).toBe(true);
    expect(result.data?.newUrl).toBe('https://example.com/results?q=test');
  }, 30000);

  it('should NOT set navigated flag when URL stays the same', async () => {
    const browser = createMockBrowserManager({
      urlBeforeAction: 'https://example.com/search',
      urlAfterAction: 'https://example.com/search', // Same URL
      pressError: null,
      hasVslIds: true,
    });

    const session = createMockSession({
      snapshotUrl: 'https://example.com/search',
    });

    const result = await handleExecuteAction({
      action: 'press',
      target_id: 'inp_1',
      value: 'Tab',
      return_state: true,
    }, browser, session, TEST_SESSION_ID);

    expect(result.status).toBe('success');
    expect(result.data?.navigated).toBeUndefined();
  }, 30000);
  it('should return error status for non-navigation errors', async () => {
    const otherError = new Error('Element not found');
    
    const browser = createMockBrowserManager({
      urlBeforeAction: 'https://example.com/search',
      urlAfterAction: 'https://example.com/search',
      pressError: otherError,
      hasVslIds: true,
    });
 
    const session = createMockSession({
      snapshotUrl: 'https://example.com/search',
    });
 
    const result = await handleExecuteAction({
      action: 'press',
      target_id: 'inp_1',
      value: 'Enter',
      return_state: true,
    }, browser, session, TEST_SESSION_ID);
 
    // Non-navigation errors are caught and returned as error status
    expect(result.status).toBe('error');
    expect(result.error).toContain('Element not found');
  }, 30000);

  it('should return warning when state extraction fails after navigation', async () => {
    const navigationError = new Error('Execution context was destroyed');
    
    // Create browser where evaluate fails after navigation (simulating context destroyed)
    let callCount = 0;
    const mockPage = {
      url: jest.fn(() => 'https://example.com/results'),
      keyboard: {
        press: jest.fn(async () => {
          throw navigationError;
        }),
      },
      waitForLoadState: jest.fn(async () => {}),
      waitForTimeout: jest.fn(async () => {}),
      locator: jest.fn(() => ({
        click: jest.fn(async () => {}),
      })),
    };

    const mockBrowser = {
      isAvailable: jest.fn(async () => true),
      getPage: jest.fn(async () => mockPage),
      evaluate: jest.fn(async (fn: (...a: unknown[]) => unknown) => {
        callCount++;
        const fnStr = fn.toString();
        if (fnStr.includes('window.location.href')) {
          return callCount === 1 ? 'https://example.com/search' : 'https://example.com/results';
        }
        if (fnStr.includes('data-vsl-id')) {
          return true;
        }
        // DOM stabilization or state extraction - fail after navigation
        if (callCount > 2) {
          throw new Error('Execution context was destroyed');
        }
        return undefined;
      }),
    } as unknown as BrowserManager;

    const session = createMockSession({
      snapshotUrl: 'https://example.com/search',
    });

    const result = await handleExecuteAction({
      action: 'press',
      target_id: 'inp_1',
      value: 'Enter',
      return_state: true,
    }, mockBrowser, session, TEST_SESSION_ID);

    expect(result.status).toBe('success');
    expect(result.data?.navigated).toBe(true);
    // State extraction should have failed with a warning
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('State extraction failed');
  }, 30000);
});