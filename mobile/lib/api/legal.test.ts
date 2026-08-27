// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api, ApiResponseError } from '@/lib/api/client';
import {
  acceptAllLegalDocuments,
  getLegalAcceptanceStatus,
  getLegalDocument,
  isLegalAcceptanceRequired,
  pendingDocuments,
  LEGAL_ACCEPTANCE_REQUIRED,
} from './legal';

// Only `api` is mocked. `ApiResponseError` comes from the real module, because
// `isLegalAcceptanceRequired` uses `instanceof` — a stand-in class would make the
// check pass against the wrong type and prove nothing.
//
// The class is NOT redeclared inside the factory: TypeScript parameter properties
// (`public readonly status`) read as out-of-scope variable access to Babel's
// jest.mock guard, and the suite fails to compile.
jest.mock('@/lib/api/client', () => {
  const actual = jest.requireActual('@/lib/api/client');
  return {
    ...actual,
    api: {
      get: jest.fn(),
      post: jest.fn(),
    },
  };
});

const mockGet = api.get as jest.Mock;
const mockPost = api.post as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('legal acceptance API', () => {
  it('reads the acceptance status from the v2 endpoint', async () => {
    mockGet.mockResolvedValueOnce({ data: { has_pending: false, documents: [] } });

    await getLegalAcceptanceStatus();

    expect(mockGet).toHaveBeenCalledWith('/api/v2/legal/acceptance/status');
  });

  it('accepts everything outstanding with no body', async () => {
    mockPost.mockResolvedValueOnce({ data: { accepted: ['terms'], message: 'ok' } });

    await acceptAllLegalDocuments();

    // 🔴 No body on purpose. The API recomputes the pending set inside a
    // transaction with the rows locked, so a client-supplied list could record
    // acceptance of a version the member was never shown — corrupting the exact
    // audit trail this exists to produce.
    expect(mockPost).toHaveBeenCalledWith('/api/v2/legal/acceptance/accept-all');
  });

  it('reads one document by type, URL-encoding it', async () => {
    mockGet.mockResolvedValueOnce({ data: null });

    await getLegalDocument('community_guidelines');

    expect(mockGet).toHaveBeenCalledWith('/api/v2/legal/community_guidelines');
  });
});

describe('isLegalAcceptanceRequired', () => {
  it('recognises the gate refusing a request', () => {
    const error = new ApiResponseError(403, 'Please accept', undefined, LEGAL_ACCEPTANCE_REQUIRED);

    expect(isLegalAcceptanceRequired(error)).toBe(true);
  });

  it('matches on the code, not the status', () => {
    // 🔴 A 403 has many causes. Treating every one as a pending acceptance would
    // show the wrong screen for a permission problem.
    const forbidden = new ApiResponseError(403, 'Forbidden', undefined, 'AUTH_INSUFFICIENT_PERMISSIONS');

    expect(isLegalAcceptanceRequired(forbidden)).toBe(false);
  });

  it('matches on the code, not the message', () => {
    // 🔴 The message is translated into the member's language, so matching on it
    // would work in English and silently fail in the other six.
    const noCode = new ApiResponseError(403, 'Please review and accept the updated terms');

    expect(isLegalAcceptanceRequired(noCode)).toBe(false);
  });

  it('ignores anything that is not an API error', () => {
    expect(isLegalAcceptanceRequired(new Error('boom'))).toBe(false);
    expect(isLegalAcceptanceRequired(null)).toBe(false);
    expect(isLegalAcceptanceRequired({ code: LEGAL_ACCEPTANCE_REQUIRED })).toBe(false);
  });
});

describe('pendingDocuments', () => {
  const row = (status: string, id = 1) => ({
    document_id: id,
    document_type: 'terms',
    title: 'Terms',
    current_version_id: 9,
    current_version: '2.0',
    acceptance_status: status as 'current' | 'outdated' | 'not_accepted',
    accepted_at: null,
  });

  it('keeps documents that are unaccepted or out of date', () => {
    const documents = pendingDocuments({
      data: { has_pending: true, documents: [row('not_accepted', 1), row('outdated', 2)] },
    });

    expect(documents.map((document) => document.document_id)).toEqual([1, 2]);
  });

  it('drops documents already accepted at their current version', () => {
    const documents = pendingDocuments({
      data: { has_pending: true, documents: [row('current', 1), row('outdated', 2)] },
    });

    expect(documents.map((document) => document.document_id)).toEqual([2]);
  });

  it('returns an empty list for a malformed payload rather than throwing', () => {
    expect(pendingDocuments(null)).toEqual([]);
    expect(pendingDocuments(undefined)).toEqual([]);
    expect(pendingDocuments({ data: { has_pending: true, documents: 'nope' } } as any)).toEqual([]);
  });
});
