// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { loadCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { resolveMessageDraftScope } from './messageDraftScope';
jest.mock('./creationDraftStore', () => ({ loadCreationDraft: jest.fn() }));
const canonical: CreationDraftScope = { kind: 'message', tenantId: 2, userId: 674, contextId: 'conversation:675' };
const legacy = { ...canonical, contextId: 'recipient:675:listing:0:context:none:0' };

it.each([false, true])('uses one key for a new draft regardless of entry (%s)', async (entry) => {
  jest.mocked(loadCreationDraft).mockResolvedValue(null);
  expect(await resolveMessageDraftScope(canonical, legacy, entry)).toEqual({ scope: canonical, draft: null });
});
it.each([false, true])('recovers the sole legacy draft from either entry (%s)', async (entry) => {
  const draft = { text: 'Retain me', voice: { uri: 'owned.m4a', durationSeconds: 7 } };
  jest.mocked(loadCreationDraft).mockImplementation(async (scope) => scope.contextId === legacy.contextId ? draft : null);
  expect(await resolveMessageDraftScope(canonical, legacy, entry)).toEqual({ scope: legacy, draft });
});
it.each([false, true])('preserves conflicting drafts under their original entry (%s)', async (entry) => {
  jest.mocked(loadCreationDraft).mockImplementation(async (scope) => ({ text: String(scope.contextId) }));
  const scope = entry ? legacy : canonical;
  expect(await resolveMessageDraftScope(canonical, legacy, entry)).toEqual({ scope, draft: { text: scope.contextId } });
});
it('does not consult another context for a listing-specific draft', async () => {
  jest.mocked(loadCreationDraft).mockReset().mockResolvedValue(null);
  const listing = { ...canonical, contextId: 'recipient:675:listing:99:context:none:0' };
  expect(await resolveMessageDraftScope(listing, null, true)).toEqual({ scope: listing, draft: null });
  expect(loadCreationDraft).toHaveBeenCalledTimes(1);
});
