// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/lib/constants', () => ({ API_V2: '/api/v2' }));

import { api } from '@/lib/api/client';
import {
  buildSupportReportBody,
  isSupportRequestType,
  submitSupportRequest,
  SUPPORT_IMPACTS,
  SUPPORT_REQUEST_TYPES,
} from './support';

const mockPost = api.post as jest.Mock;

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
});
