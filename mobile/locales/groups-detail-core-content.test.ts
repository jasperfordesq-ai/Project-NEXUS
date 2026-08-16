// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const english = require('./en/groups.json') as Record<string, unknown>;
const irish = require('./ga/groups.json') as Record<string, unknown>;

function flatten(value: Record<string, unknown>, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const [nestedPath, nestedValue] of flatten(item as Record<string, unknown>, path)) {
        result.set(nestedPath, nestedValue);
      }
    } else if (typeof item === 'string') {
      result.set(path, item);
    }
  }
  return result;
}

describe('mobile Irish group-detail core content', () => {
  it('does not fall back to English in overview, discussion, announcement or event controls', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);
    const reviewedNestedSections = ['detail.tabs.'];
    const reviewedCorePaths = new Set([
      'admin', 'groupAdmin', 'tags', 'emptyAbout', 'emptyDiscussions', 'emptyMembers',
      'emptyAnnouncements', 'emptyEvents', 'joinToDiscuss', 'joinToSeeMembers',
      'joinToSeeAnnouncements', 'pinned', 'newAnnouncement', 'newAnnouncementHint',
      'createAnnouncement', 'announcementTitlePlaceholder', 'announcementContentPlaceholder',
      'pinAnnouncement', 'unpinAnnouncement', 'publishAnnouncement', 'announcementRequired',
      'announcementCreateError', 'announcementUpdateError', 'announcementDeleteError',
      'deleteAnnouncement', 'deleteAnnouncementTitle', 'deleteAnnouncementMessage',
      'startDiscussion', 'startDiscussionHint', 'newDiscussion', 'discussionTitlePlaceholder',
      'discussionContentPlaceholder', 'publishDiscussion', 'discussionRequired',
      'discussionCreateError', 'replies', 'replies_other', 'eventsHeading', 'eventsSubtitle',
      'createEvent', 'eventAttending', 'eventOnline', 'eventDateFallback', 'ownerTools', 'edit',
    ].map((path) => `detail.${path}`));
    const reviewedPaths = [...englishFlat.keys()].filter((path) =>
      reviewedCorePaths.has(path)
      || reviewedNestedSections.some((prefix) => path.startsWith(prefix)),
    );

    for (const path of reviewedPaths) {
      expect(irishFlat.get(path)).toBeDefined();
      expect(irishFlat.get(path)).not.toBe(englishFlat.get(path));
    }
  });
});
