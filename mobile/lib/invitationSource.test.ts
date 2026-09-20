// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { buildInvitationSource as build, emptyAudience } from './invitationSource';
it('keeps duplicate IDs for preview diagnostics without dropping malformed selections', () => {
  expect(build('member', '12, 12\n34', emptyAudience).source).toEqual({ member_ids: [12, 12, 34] });
  for (const value of ['12,bad,34', '1e3', '1.5', '9007199254740993', '', '0']) expect(build('member', value, emptyAudience).invalidField).toBe('source');
  expect(build('group', '12,34', emptyAudience).invalidField).toBe('source');
  expect(build('group', '12', emptyAudience).source).toEqual({ group_id: 12 });
});
it('leaves email validity and duplicates to the server preview', () => {
  expect(build('email', 'a@example.test; invalid\na@example.test', emptyAudience).source).toEqual({ emails: ['a@example.test', 'invalid', 'a@example.test'] });
});
it('preserves CSV verbatim and enforces UTF-8 byte limits', () => {
  const csv = 'email,name\r\na@example.test,"A\nB"\r\n';
  expect(build('csv', csv, emptyAudience).source).toEqual({ csv });
  expect(build('csv', 'é'.repeat(2_500_000), emptyAudience).source).toBeDefined();
  expect(build('csv', 'é'.repeat(2_500_001), emptyAudience).invalidField).toBe('source');
  expect(build('csv', '😀'.repeat(1_250_001), emptyAudience).invalidField).toBe('source');
});
it('expresses all audience filters including explicit false values', () => {
  expect(build('audience', '', { ...emptyAudience, roles: 'member,admin', languages: 'FR ga', groups: '2 3', excluded: '9',
    joinedAfter: '2024-02-29', joinedBefore: '2026-09-20', approved: 'no', hasEmail: 'yes', groupMatch: 'all' }).source).toEqual({ criteria: {
    all_active: true, roles: ['member', 'admin'], preferred_languages: ['fr', 'ga'], group_ids: [2, 3], group_match: 'all',
    exclude_member_ids: [9], joined_after: '2024-02-29', joined_before: '2026-09-20', approved: false, has_email: true,
  } });
  expect(build('audience', '', emptyAudience).source).toEqual({ criteria: { all_active: true } });
});
it.each([
  ['joinedAfter', '2025-02-29'], ['joinedBefore', '2026-04-31'], ['languages', 'xx'], ['roles', 'admin!'],
  ['roles', ',,,'], ['languages', ',,,'], ['groups', Array.from({ length: 26 }, (_, i) => i + 1).join(',')],
  ['excluded', Array.from({ length: 1001 }, (_, i) => i + 1).join(',')],
])('reports invalid %s at the corresponding input', (key, value) => {
  expect(build('audience', '', { ...emptyAudience, [key]: value }).invalidField).toBe(key);
});
it('rejects a reversed date range and over-limit member selection', () => {
  expect(build('audience', '', { ...emptyAudience, joinedAfter: '2026-09-20', joinedBefore: '2026-09-19' }).invalidField).toBe('joinedBefore');
  expect(build('member', Array.from({ length: 10001 }, (_, i) => i + 1).join(','), emptyAudience).invalidField).toBe('source');
});
