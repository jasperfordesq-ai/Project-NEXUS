// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import type { InvitationCampaignIntent } from './api/eventRegistration';

export type CampaignPreview = Extract<InvitationCampaignIntent, { action: 'preview' }>;
export type AudienceFields = {
  roles: string; languages: string; groups: string; excluded: string;
  joinedAfter: string; joinedBefore: string;
  approved: 'any' | 'yes' | 'no'; hasEmail: 'any' | 'yes' | 'no'; groupMatch: 'any' | 'all';
};
export const emptyAudience: AudienceFields = {
  roles: '', languages: '', groups: '', excluded: '', joinedAfter: '', joinedBefore: '',
  approved: 'any', hasEmail: 'any', groupMatch: 'any',
};
export const invitationLocales = ['ar', 'de', 'en', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'] as const;
const tokens = (value: string) => value.split(/[\s,;]+/).filter(Boolean);
function ids(value: string, maximum: number): number[] {
  const list = tokens(value);
  if (!list.length || list.length > maximum || list.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error('invalid');
  return list.map(Number);
}
function date(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('invalid');
  return value;
}
/** Never silently discard malformed selections or deduplicate rows: preview reports duplicate recipients. */
export function buildInvitationSource(type: CampaignPreview['campaignType'], value: string, audience: AudienceFields): {
  source?: Record<string, unknown>; invalidField?: string;
} {
  let field = 'source';
  try {
    if (type === 'member') return { source: { member_ids: ids(value, 10_000) } };
    if (type === 'group') return { source: { group_id: ids(value, 1)[0] } };
    if (type === 'email') {
      const emails = value.split(/[\n,;]+/).map(item => item.trim()).filter(Boolean);
      if (!emails.length || emails.length > 10_000) throw new Error('invalid');
      return { source: { emails } };
    }
    if (type === 'csv') {
      // PHP limits bytes, not UTF-16 characters. Keep the original CSV, including quoted newlines.
      let bytes = 0;
      for (const char of value) { const point = char.codePointAt(0)!; bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4; }
      if (!value.trim() || bytes > 5_000_000) throw new Error('invalid');
      return { source: { csv: value } };
    }
    const criteria: Record<string, unknown> = { all_active: true };
    for (const [key, target] of [['approved', 'approved'], ['hasEmail', 'has_email']] as const) {
      if (audience[key] !== 'any') criteria[target] = audience[key] === 'yes';
    }
    field = 'roles';
    if (audience.roles.trim()) {
      const roles = tokens(audience.roles);
      if (!roles.length || roles.length > 20 || roles.some(role => role.length > 64 || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(role))) throw new Error('invalid');
      criteria.roles = roles;
    }
    field = 'languages';
    if (audience.languages.trim()) {
      const languages = tokens(audience.languages.toLowerCase());
      if (!languages.length || languages.length > invitationLocales.length || languages.some(language => !(invitationLocales as readonly string[]).includes(language))) throw new Error('invalid');
      criteria.preferred_languages = languages;
    }
    field = 'groups';
    if (audience.groups.trim()) { criteria.group_ids = ids(audience.groups, 25); criteria.group_match = audience.groupMatch; }
    field = 'excluded';
    if (audience.excluded.trim()) criteria.exclude_member_ids = ids(audience.excluded, 1000);
    field = 'joinedAfter';
    if (audience.joinedAfter.trim()) criteria.joined_after = date(audience.joinedAfter.trim());
    field = 'joinedBefore';
    if (audience.joinedBefore.trim()) criteria.joined_before = date(audience.joinedBefore.trim());
    if (criteria.joined_after && criteria.joined_before && String(criteria.joined_after) > String(criteria.joined_before)) throw new Error('invalid');
    return { source: { criteria } };
  } catch { return { invalidField: field }; }
}
