// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Chip } from '@/components/ui/Chip';
/**
 * Pinned Announcements Banner
 * Shows pinned announcements at top of group page (above tabs).
 * Non-critical — silently fails if the API is unavailable.
 */

import { useEffect, useState } from 'react';
import Megaphone from 'lucide-react/icons/megaphone';
import { MemberPlainText } from '@/components/ui/MemberPlainText';
import { useTranslation } from 'react-i18next';
import {
  GROUP_ANNOUNCEMENTS_CHANGED_EVENT,
  getPinnedAnnouncements,
  type GroupAnnouncement,
} from '../api/announcements';

interface PinnedAnnouncementsBannerProps {
  groupId: number;
  isMember?: boolean;
}

export function PinnedAnnouncementsBanner({ groupId, isMember = true }: PinnedAnnouncementsBannerProps) {
  const { t } = useTranslation('groups');
  const [pinned, setPinned] = useState<GroupAnnouncement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);

  useEffect(() => {
    const handleChanged = (event: Event) => {
      const changedGroupId = (event as CustomEvent<{ groupId?: number }>).detail?.groupId;
      if (changedGroupId === groupId) setRefreshRevision((value) => value + 1);
    };
    window.addEventListener(GROUP_ANNOUNCEMENTS_CHANGED_EVENT, handleChanged);
    return () => window.removeEventListener(GROUP_ANNOUNCEMENTS_CHANGED_EVENT, handleChanged);
  }, [groupId]);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    setPinned([]);
    setLoaded(false);

    if (!isMember) {
      setLoaded(true);
      return () => {
        isCurrent = false;
        controller.abort();
      };
    }

    async function load() {
      try {
        const items = await getPinnedAnnouncements(groupId, {
          signal: controller.signal,
        });
        if (isCurrent) setPinned(items);
      } catch {
        // Silently fail — banner is non-critical
      } finally {
        if (isCurrent) setLoaded(true);
      }
    }
    load();

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [groupId, isMember, refreshRevision]);

  if (!loaded || pinned.length === 0) return null;

  return (
    <div className="space-y-2">
      {pinned.map((announcement) => (
        <div
          key={announcement.id}
          className="flex min-w-0 items-start gap-3 rounded-lg border border-accent/20 bg-accent/5 p-3"
        >
          <Megaphone className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="break-words text-sm font-medium text-theme-primary">{announcement.title}</p>
            <MemberPlainText content={announcement.content} className="mt-0.5 line-clamp-2 break-words text-xs text-theme-subtle" as="p" />
          </div>
          <Chip size="sm" variant="flat" color="primary" className="flex-shrink-0">{t('announcements.pinned')}</Chip>
        </div>
      ))}
    </div>
  );
}
