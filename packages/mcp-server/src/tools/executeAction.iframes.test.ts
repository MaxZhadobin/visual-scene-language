/**
 * Unit tests for iframe interaction (M2.1) in vsl_execute_action tool.
 *
 * Test cases:
 *  - Frame routing: click внутри iframe через frame prefix (iframe_N:localId)
 *  - Error handling: frame not found in registry
 *  - Error handling: Playwright frame not found by URL
 *  - ID resolution: short ID resolved correctly for iframe elements
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleExecuteAction } from './executeAction.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ServerSession } from '../session/serverSession.js';

describe('vsl_execute_action — iframe interaction (M2.1)', () => {
  let mockBrowser: jest.Mocked<BrowserManager>;
  let mockSession: jest.Mocked<ServerSession>;
  let mockPage: {
    click: jest.Mock;
    fill: jest.Mock;
    waitForTimeout: jest.Mock;
    keyboard: { press: jest.Mock };
    locator: jest.Mock;
  };

  beforeEach(() => {
    mockPage = {
      click: jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      keyboard: { press: jest.fn().mockResolvedValue(undefined) },
      locator: jest.fn().mockImplementation(() => ({
        click: jest.fn().mockResolvedValue(undefined),
        fill: jest.fn().mockResolvedValue(undefined),
        setInputFiles: jest.fn().mockResolvedValue(undefined),
      })),
    };

    mockBrowser = {
      isAvailable: jest.fn(),
      navigate: jest.fn(),
      evaluate: jest.fn(),
      getContent: jest.fn(),
      screenshot: jest.fn(),
      getPage: jest.fn().mockResolvedValue(mockPage),
      launch: jest.fn(),
      close: jest.fn(),
      uploadFile: jest.fn(),
      getDownloads: jest.fn(),
      waitForDownload: jest.fn(),
      saveDownload: jest.fn(),
      getFrames: jest.fn().mockResolvedValue([]),
      evaluateInFrame: jest.fn(),
    } as unknown as jest.Mocked<BrowserManager>;

    mockSession = {
      hasSnapshot: jest.fn(),
      setSnapshot: jest.fn(),
      getSnapshot: jest.fn(),
      getDiff: jest.fn(),
      clear: jest.fn(),
      snapshotFromElements: jest.fn(),
      getScrollContext: jest.fn().mockReturnValue(null),
      getPreviousSnapshot: jest.fn().mockReturnValue(null),
      setScrollContext: jest.fn(),
      getReverseIdMap: jest.fn().mockReturnValue(new Map()),
      getIdMap: jest.fn().mockReturnValue(new Map()),
    } as unknown as jest.Mocked<ServerSession>;

    // Defaults
    mockBrowser.isAvailable.mockResolvedValue(true);
    mockBrowser.evaluate.mockResolvedValue('https://example.com' as never);
    mockBrowser.navigate.mockResolvedValue(undefined);
  });

  describe('frame routing', () => {
    beforeEach(() => {
      mockSession.hasSnapshot.mockReturnValue(true);
      mockSession.getSnapshot.mockReturnValue({
        canvas: { url: 'https://example.com' },
        objects: [
          {
            id: 'iframe_0',
            t: 'iframe',
            iframe: {
              url: 'https://captcha.com/iframe',
              frameId: 0,
              vsl: {
                objects: [
                  { id: 'spn_0', t: 'span', txt: 'Checkbox', act: ['click'] },
                ],
              },
            },
          },
        ],
      } as never);
    });

    it('выполняет click внутри iframe через frame routing', async () => {
      // Setup: iframeFrameRegistry
      const { iframeFrameRegistry } = await import('./getSnapshot.js');
      iframeFrameRegistry.set(0, 'https://captcha.com/iframe');

      // Setup: Playwright frame mock
      const mockFrameLocator = {
        click: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(1),
      };
      const mockFrame = {
        url: () => 'https://captcha.com/iframe',
        locator: jest.fn().mockReturnValue(mockFrameLocator),
        evaluate: jest.fn().mockResolvedValue(undefined),
      };
      mockBrowser.getFrames = jest.fn().mockResolvedValue([mockFrame]);

      // Setup: idMap for iframe element (iframe_0:spn_0 → span_0_0_0)
      const mockIdMap = new Map([['iframe_0:spn_0', 'span_0_0_0']]);
      mockSession.getIdMap = jest.fn().mockReturnValue(mockIdMap);

      // Mock hasVslIds check (evaluate returns true)
      mockBrowser.evaluate.mockResolvedValue(true as never);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'iframe_0:spn_0', return_state: false },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      // Verify frame locator was used (not page locator)
      expect(mockFrame.locator).toHaveBeenCalledWith(
        '[data-vsl-id="span_0_0_0"], #span_0_0_0, .span_0_0_0'
      );
      expect(mockFrameLocator.click).toHaveBeenCalled();
    });

    it('возвращает ошибку если frame не найден в registry', async () => {
      // Clear registry for this test
      const { iframeFrameRegistry } = await import('./getSnapshot.js');
      iframeFrameRegistry.delete(99);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'iframe_99:spn_0', return_state: false },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('Frame iframe_99 not found in registry');
    });

    it('возвращает ошибку если Playwright frame не найден по URL', async () => {
      const { iframeFrameRegistry } = await import('./getSnapshot.js');
      iframeFrameRegistry.set(0, 'https://captcha.com/iframe');

      // Empty frames list — no matching frame
      mockBrowser.getFrames = jest.fn().mockResolvedValue([]);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'iframe_0:spn_0', return_state: false },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('Frame with URL');
      expect(result.error).toContain('https://captcha.com/iframe');
    });

    it('резолвит короткий ID для iframe элемента через idMap', async () => {
      const { iframeFrameRegistry } = await import('./getSnapshot.js');
      iframeFrameRegistry.set(0, 'https://captcha.com/iframe');

      const mockFrameLocator = {
        click: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(1),
      };
      const mockFrame = {
        url: () => 'https://captcha.com/iframe',
        locator: jest.fn().mockReturnValue(mockFrameLocator),
        evaluate: jest.fn().mockResolvedValue(undefined),
      };
      mockBrowser.getFrames = jest.fn().mockResolvedValue([mockFrame]);

      // idMap maps short iframe-prefixed ID to long ID
      const mockIdMap = new Map([['iframe_0:btn_0', 'button_0_1_2_3']]);
      mockSession.getIdMap = jest.fn().mockReturnValue(mockIdMap);
      mockBrowser.evaluate.mockResolvedValue(true as never);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'iframe_0:btn_0', return_state: false },
        mockBrowser,
        mockSession,
      );

      expect(result.status).toBe('success');
      // Verify the resolved long ID is used in selector
      expect(mockFrame.locator).toHaveBeenCalledWith(
        '[data-vsl-id="button_0_1_2_3"], #button_0_1_2_3, .button_0_1_2_3'
      );
    });

    it('использует partial URL match для frame routing', async () => {
      const { iframeFrameRegistry } = await import('./getSnapshot.js');
      iframeFrameRegistry.set(0, 'https://captcha.com/iframe');

      const mockFrameLocator = {
        click: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(1),
      };
      // Frame URL differs slightly (extra query params)
      const mockFrame = {
        url: () => 'https://captcha.com/iframe?hl=en&v=1.0',
        locator: jest.fn().mockReturnValue(mockFrameLocator),
        evaluate: jest.fn().mockResolvedValue(undefined),
      };
      mockBrowser.getFrames = jest.fn().mockResolvedValue([mockFrame]);
      mockSession.getIdMap = jest.fn().mockReturnValue(new Map());
      mockBrowser.evaluate.mockResolvedValue(true as never);

      const result = await handleExecuteAction(
        { action: 'click', target_id: 'iframe_0:spn_0', return_state: false },
        mockBrowser,
        mockSession,
      );

      // Partial match should succeed
      expect(result.status).toBe('success');
      expect(mockFrame.locator).toHaveBeenCalled();
    });
  });
});