// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The full history of one volunteering safeguarding incident, as staff see it:
 * every report, decision, note and message, newest first, with a filter.
 * Entries cannot be edited or removed — the server refuses to change them.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import FileText from 'lucide-react/icons/file-text';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import UserCheck from 'lucide-react/icons/user-check';
import FolderPen from 'lucide-react/icons/folder-pen';
import Landmark from 'lucide-react/icons/landmark';
import StickyNote from 'lucide-react/icons/sticky-note';
import MessageSquare from 'lucide-react/icons/message-square';
import Building2 from 'lucide-react/icons/building-2';
import Share2 from 'lucide-react/icons/share-2';
import CircleSlash from 'lucide-react/icons/circle-slash';
import MessageSquarePlus from 'lucide-react/icons/message-square-plus';
import { Button } from '@/components/ui';
import { getFormattingLocale } from '@/lib/helpers';

export type IncidentEventType =
  | 'reported' | 'migrated' | 'status_changed' | 'handler_changed' | 'filing_changed'
  | 'authority_recorded' | 'staff_note' | 'message_to_reporter' | 'message_to_organisation'
  | 'reporter_addition' | 'org_update' | 'shared_with_organisation' | 'share_withdrawn';

export interface StaffTimelineEvent {
  id: number;
  type: IncidentEventType;
  created_at: string;
  from?: string | null;
  to?: string | null;
  body?: string;
  actor_user_id?: number | null;
  actor_name?: string | null;
  actor_role?: string;
  data?: Record<string, unknown> | null;
}

export const TIMELINE_FILTERS = ['all', 'notes', 'status', 'organisation', 'reporter'] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

const FILTER_TYPES: Record<Exclude<TimelineFilter, 'all'>, IncidentEventType[]> = {
  notes: ['staff_note'],
  status: ['status_changed', 'handler_changed', 'filing_changed', 'authority_recorded'],
  organisation: ['message_to_organisation', 'org_update', 'shared_with_organisation', 'share_withdrawn'],
  reporter: ['reported', 'migrated', 'message_to_reporter', 'reporter_addition'],
};

const ICONS: Record<IncidentEventType, ComponentType<{ size?: number; className?: string }>> = {
  reported: FileText,
  migrated: FileText,
  status_changed: ArrowRightLeft,
  handler_changed: UserCheck,
  filing_changed: FolderPen,
  authority_recorded: Landmark,
  staff_note: StickyNote,
  message_to_reporter: MessageSquare,
  message_to_organisation: Building2,
  reporter_addition: MessageSquarePlus,
  org_update: Building2,
  shared_with_organisation: Share2,
  share_withdrawn: CircleSlash,
};

/** Translation keys for the filing fields a `filing_changed` entry can name. */
const FILING_FIELD_KEYS: Record<string, string> = {
  organization_id: 'volunteering.col_organization',
  opportunity_id: 'volunteering.col_opportunity',
  incident_type: 'volunteering.col_incident_type',
  severity: 'volunteering.col_severity',
  incident_date: 'volunteering.incident_date_label',
};

interface IncidentTimelineProps {
  events: StaffTimelineEvent[];
  /** Names of staff who can handle incidents, to say who an incident was handed to. */
  people?: Record<number, string>;
}

export function IncidentTimeline({ events, people = {} }: IncidentTimelineProps) {
  const { t } = useTranslation('admin_volunteering');
  const [filter, setFilter] = useState<TimelineFilter>('all');

  const shown = useMemo(() => {
    const newestFirst = [...events].sort((a, b) =>
      b.created_at === a.created_at ? b.id - a.id : (b.created_at > a.created_at ? 1 : -1));
    return filter === 'all' ? newestFirst : newestFirst.filter((e) => FILTER_TYPES[filter].includes(e.type));
  }, [events, filter]);

  const detail = (event: StaffTimelineEvent): string | null => {
    const data = event.data ?? {};
    switch (event.type) {
      case 'status_changed':
        return event.from && event.to
          ? t('volunteering.timeline_status_from_to', {
            from: t(`volunteering.status_${event.from}`),
            to: t(`volunteering.status_${event.to}`),
          })
          : null;
      case 'handler_changed': {
        const to = typeof data.to_user_id === 'number' ? data.to_user_id : null;
        return to === null ? t('volunteering.handled_by_nobody') : (people[to] ?? null);
      }
      case 'filing_changed':
        return Object.keys(data).map((field) => t(FILING_FIELD_KEYS[field] ?? field)).join(', ') || null;
      case 'authority_recorded':
        return typeof data.reference === 'string' && data.reference !== '' ? data.reference : null;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('volunteering.case_timeline_heading')}>
        {TIMELINE_FILTERS.map((key) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? 'primary' : 'tertiary'}
            aria-pressed={filter === key}
            onPress={() => setFilter(key)}
          >
            {t(`volunteering.timeline_filter_${key}`)}
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">{t('volunteering.timeline_empty')}</p>
      ) : (
        <ol className="space-y-4" data-testid="incident-timeline">
          {shown.map((event) => {
            const Icon = ICONS[event.type] ?? FileText;
            const extra = detail(event);
            return (
              <li key={event.id} className="flex gap-3" data-event-type={event.type}>
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary">
                  <Icon size={16} className="text-muted" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t(`volunteering.timeline_${event.type}`)}
                    {extra && <span className="font-normal text-muted"> — {extra}</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {[event.actor_name, new Date(event.created_at.replace(' ', 'T')).toLocaleString(getFormattingLocale())]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {event.body && <p className="mt-1 whitespace-pre-line text-sm">{event.body}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default IncidentTimeline;
