// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One place that turns an activity-log row into a sentence.
 *
 * Newer rows carry a stable `description_code` plus parameters and are
 * localised here, in the reader's language; the server sends `description`
 * as null for them. Older rows keep the server-rendered prose. The admin
 * dashboard used to read `description` alone, so every structured row showed
 * a name followed by nothing.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityLogEntry } from '../../api/types';

export const activityDetailKeys: Record<string, string> = {
  blog_post_created: 'system.activity_details.blog_post_created',
  blog_post_updated: 'system.activity_details.blog_post_updated',
  blog_post_deleted: 'system.activity_details.blog_post_deleted',
  blog_post_status_changed: 'system.activity_details.blog_post_status_changed',
  blog_posts_bulk_deleted: 'system.activity_details.blog_posts_bulk_deleted',
  blog_posts_bulk_published: 'system.activity_details.blog_posts_bulk_published',
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function describeActivity(entry: ActivityLogEntry, t: Translate): string {
  if (entry.description_code) {
    const translationKey = activityDetailKeys[entry.description_code];
    const params: Record<string, string | number> = { ...(entry.description_params ?? {}) };
    for (const statusField of ['old_status', 'new_status'] as const) {
      const status = params[statusField];
      if (typeof status === 'string') {
        params[statusField] = t(`system.activity_status.${status}`, {
          defaultValue: t('system.activity_status.unknown'),
        });
      }
    }
    return translationKey
      ? t(translationKey, params)
      : t('system.activity_details.unknown', { code: entry.description_code });
  }

  // Historical rows stored free-form prose. Keep displaying that legacy
  // value, but all newly structured rows are rendered from stable codes.
  return entry.description || '—';
}

/** Hook form for components: `const describe = useActivityDescription();` */
export function useActivityDescription(): (entry: ActivityLogEntry) => string {
  const { t } = useTranslation('admin_system');
  return useCallback((entry: ActivityLogEntry) => describeActivity(entry, t as Translate), [t]);
}
