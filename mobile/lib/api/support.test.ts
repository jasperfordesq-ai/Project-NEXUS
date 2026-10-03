// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn(), post: jest.fn(), upload: jest.fn() } }));
jest.mock('@/lib/constants', () => ({ API_V2: '/api/v2' }));

import { api } from '@/lib/api/client';
import {
  buildSupportReportBody,
  buildSupportReportFormData,
  isSupportRequestType,
  isSupportScreenshotType,
  submitSupportRequest,
  SUPPORT_IMPACTS,
  SUPPORT_REQUEST_TYPES,
  SUPPORT_SCREENSHOT_MAX_BYTES,
  SUPPORT_SCREENSHOTS_MAX,
  type SupportScreenshot,
} from './support';

const mockPost = api.post as jest.Mock;
const mockUpload = api.upload as jest.Mock;

const SHOT: SupportScreenshot = { uri: 'file:///cache/shot-1.jpg', name: 'screenshot-1.jpg', mimeType: 'image/jpeg' };

const DIAGNOSTICS = {
  client: 'native_app',
  platform: 'android',
  os_version: '34',
  app_version: '1.8.1',
  language: 'en',
};

describe('support request contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers exactly the request types and impacts SupportReportController accepts', () => {
    // app/Http/Controllers/Api/SupportReportController.php: REQUEST_TYPES / ALLOWED_IMPACTS.
    expect([...SUPPORT_REQUEST_TYPES]).toEqual(['broken', 'how_to', 'account', 'suggestion']);
    expect([...SUPPORT_IMPACTS]).toEqual(['blocked', 'major', 'minor', 'cosmetic']);
    expect(isSupportRequestType('how_to')).toBe(true);
    expect(isSupportRequestType('bug')).toBe(false);
    expect(isSupportRequestType(undefined)).toBe(false);
  });

  it('sends a broken report with its impact and the member-approved diagnostics', async () => {
    mockPost.mockResolvedValue({
      data: { report: { id: 7, reference: 'NXR-261003-ABC123', request_type: 'broken', status: 'open', impact: 'blocked', summary: 'Wallet crashes' } },
    });

    const receipt = await submitSupportRequest({
      requestType: 'broken',
      summary: '  Wallet crashes  ',
      description: '  It closes when I open it.  ',
      impact: 'blocked',
      diagnostics: DIAGNOSTICS,
    });

    expect(mockPost).toHaveBeenCalledWith('/api/v2/support/reports', {
      request_type: 'broken',
      summary: 'Wallet crashes',
      description: 'It closes when I open it.',
      impact: 'blocked',
      module: 'mobile_app',
      include_diagnostics: true,
      diagnostics: DIAGNOSTICS,
    });
    expect(receipt.reference).toBe('NXR-261003-ABC123');
    expect(receipt.request_type).toBe('broken');
  });

  it('sends no diagnostics when the member unticked them', () => {
    const body = buildSupportReportBody({
      requestType: 'broken',
      summary: 'Wallet crashes',
      description: 'It closes when I open it.',
      impact: 'minor',
      diagnostics: null,
    });

    expect(body.include_diagnostics).toBe(false);
    expect(body).not.toHaveProperty('diagnostics');
    expect(body.impact).toBe('minor');
  });

  it.each(['how_to', 'account', 'suggestion'] as const)(
    'never sends an impact or diagnostics for a %s request',
    (requestType) => {
      // The server only keeps diagnostics for `broken`; the app must not even send them.
      const body = buildSupportReportBody({
        requestType,
        summary: 'A question',
        description: 'How do I send hours to a neighbour?',
        impact: 'blocked',
        diagnostics: DIAGNOSTICS,
      });

      expect(body).not.toHaveProperty('impact');
      expect(body).not.toHaveProperty('diagnostics');
      expect(body.include_diagnostics).toBe(false);
      expect(body.request_type).toBe(requestType);
    },
  );

  it('defaults a broken report to a minor impact, as the website does', () => {
    const body = buildSupportReportBody({ requestType: 'broken', summary: 'abc', description: 'abcdefghij' });
    expect(body.impact).toBe('minor');
  });

  it('refuses a success response that carries no reference, rather than showing an empty receipt', async () => {
    mockPost.mockResolvedValue({ data: { report: { id: 7 } } });

    await expect(
      submitSupportRequest({ requestType: 'suggestion', summary: 'Idea', description: 'A dark mode toggle.' }),
    ).rejects.toThrow('reference');
  });

  it('passes a refusal straight through so the screen can read its code', async () => {
    const refusal = Object.assign(new Error('limit'), { status: 429, code: 'SUPPORT_REPORT_DAILY_LIMIT' });
    mockPost.mockRejectedValue(refusal);

    await expect(
      submitSupportRequest({ requestType: 'how_to', summary: 'Question', description: 'How do I do this?' }),
    ).rejects.toBe(refusal);
  });

  describe('screenshots (HELP-11)', () => {
    /** Every part appended to a FormData, in order, so file parts can be read back whole. */
    function appendedParts(): [string, unknown][] {
      return appendSpy.mock.calls.map(([key, value]) => [String(key), value]);
    }

    let appendSpy: jest.SpyInstance;
    beforeEach(() => {
      appendSpy = jest.spyOn(FormData.prototype, 'append');
    });
    afterEach(() => appendSpy.mockRestore());

    it('mirrors the server limits: three files, 10 MB, PNG/JPEG/WebP only', () => {
      // SupportReportScreenshotService::MAX_FILES / MAX_BYTES and the controller's mimetypes rule.
      expect(SUPPORT_SCREENSHOTS_MAX).toBe(3);
      expect(SUPPORT_SCREENSHOT_MAX_BYTES).toBe(10 * 1024 * 1024);
      expect(isSupportScreenshotType('image/webp')).toBe(true);
      expect(isSupportScreenshotType('image/heic')).toBe(false);
    });

    it('keeps the JSON request exactly as it was when nothing is attached', async () => {
      mockPost.mockResolvedValue({ data: { report: { id: 1, reference: 'NXR-261003-AAAAAA' } } });

      await submitSupportRequest({ requestType: 'how_to', summary: 'Question', description: 'How do I do this?', screenshots: [] });

      expect(mockUpload).not.toHaveBeenCalled();
      expect(mockPost).toHaveBeenCalledWith('/api/v2/support/reports', expect.not.objectContaining({ screenshots: expect.anything() }));
      expect(mockPost.mock.calls[0][1]).toEqual(
        buildSupportReportBody({ requestType: 'how_to', summary: 'Question', description: 'How do I do this?' }),
      );
    });

    it('sends multipart, with screenshots[0], only when a screenshot is attached', async () => {
      mockUpload.mockResolvedValue({ data: { report: { id: 9, reference: 'NXR-261003-SHOT01', screenshots: 1 } } });

      const receipt = await submitSupportRequest({
        requestType: 'broken',
        summary: 'Wallet crashes',
        description: 'It closes when I open it.',
        impact: 'blocked',
        diagnostics: DIAGNOSTICS,
        screenshots: [SHOT],
      });

      expect(mockPost).not.toHaveBeenCalled();
      expect(mockUpload).toHaveBeenCalledWith('/api/v2/support/reports', expect.any(FormData));
      // The reference is still read from the response body, and the count is kept.
      expect(receipt.reference).toBe('NXR-261003-SHOT01');
      expect(receipt.screenshots).toBe(1);

      const parts = new Map(appendedParts());
      expect(parts.get('screenshots[0]')).toEqual({ uri: SHOT.uri, name: 'screenshot-1.jpg', type: 'image/jpeg' });
      expect(parts.has('screenshots[1]')).toBe(false);
      // Text fields travel as the server's multipart normaliser expects them.
      expect(parts.get('request_type')).toBe('broken');
      expect(parts.get('summary')).toBe('Wallet crashes');
      expect(parts.get('impact')).toBe('blocked');
      expect(parts.get('module')).toBe('mobile_app');
      expect(parts.get('include_diagnostics')).toBe('1');
      expect(JSON.parse(String(parts.get('diagnostics')))).toEqual(DIAGNOSTICS);
    });

    it('sends "0" and no diagnostics for a non-broken request with a screenshot', async () => {
      await buildSupportReportFormData({ requestType: 'suggestion', summary: 'Idea', description: 'A dark mode toggle.', diagnostics: DIAGNOSTICS, screenshots: [SHOT] });

      const parts = new Map(appendedParts());
      expect(parts.get('include_diagnostics')).toBe('0');
      expect(parts.has('diagnostics')).toBe(false);
      expect(parts.has('impact')).toBe(false);
    });

    it('never sends more than three files, whatever it is handed', async () => {
      const shots = [1, 2, 3, 4].map((n) => ({ ...SHOT, uri: `file:///cache/shot-${n}.jpg`, name: `screenshot-${n}.jpg` }));

      await buildSupportReportFormData({ requestType: 'broken', summary: 'abc', description: 'abcdefghij', screenshots: shots });

      const keys = appendedParts().map(([key]) => key).filter((key) => key.startsWith('screenshots'));
      expect(keys).toEqual(['screenshots[0]', 'screenshots[1]', 'screenshots[2]']);
    });

    it('passes a screenshot refusal straight through so the screen can show it', async () => {
      const refusal = Object.assign(new Error('That screenshot is not a PNG, JPEG or WebP image.'), {
        status: 422,
        code: 'VALIDATION_FAILED',
        field: 'screenshots.0',
      });
      mockUpload.mockRejectedValue(refusal);

      await expect(
        submitSupportRequest({ requestType: 'broken', summary: 'abc', description: 'abcdefghij', screenshots: [SHOT] }),
      ).rejects.toBe(refusal);
    });
  });
});
