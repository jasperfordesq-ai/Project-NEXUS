// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Organisation dashboard › Wellbeing (20 Oct 2026).
 *
 * Which of the organisation's volunteers said they are Low or Struggling and
 * asked for someone to get in touch, how they feel, when, and when the
 * organisation was told. The organisation's owner, admins and safeguarding
 * leads are also sent a bell, a phone push and an email at the time; this is
 * the place they land. Name and mood only — the note stays with the
 * community's safeguarding staff.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import Lock from 'lucide-react/icons/lock';
import MessageSquare from 'lucide-react/icons/message-square';
import UserRound from 'lucide-react/icons/user-round';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { getFormattingLocale } from '@/lib/helpers';
import { parseServerTimestamp } from '@/lib/serverTime';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { EmptyState } from '@/components/feedback';

export interface OrgWellbeingItem {
  alert_id: number;
  volunteer: { id: number; name: string; avatar_url?: string | null };
  mood: number | null;
  checkin_at: string | null;
  status: 'active' | 'acknowledged' | 'resolved' | 'dismissed' | string;
  told_at: string | null;
  raised_at: string;
  updated_at: string;
}

interface OrgWellbeingResponse {
  organisation: { id: number; name: string };
  items: OrgWellbeingItem[];
}

/** A server time (ISO-8601, or the legacy `Y-m-d H:i:s`, which is UTC) in the viewer's zone. */
function formatDateTime(value: string | null | undefined): string {
  const date = parseServerTimestamp(value);
  if (!date) return value ?? '';
  return date.toLocaleString(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

const STATUS_KEYS: Record<string, string> = {
  active: 'org_wellbeing.status_active',
  acknowledged: 'org_wellbeing.status_acknowledged',
  resolved: 'org_wellbeing.status_resolved',
  dismissed: 'org_wellbeing.status_dismissed',
};

export function OrgWellbeingTab({ orgId }: { orgId: number }) {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const [items, setItems] = useState<OrgWellbeingItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'failed'>('loading');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get<OrgWellbeingResponse>(`/v2/volunteering/organisations/${orgId}/wellbeing`);
        if (!active) return;
        if (res.success && res.data) {
          setItems(Array.isArray(res.data.items) ? res.data.items : []);
          setState('ready');
        } else {
          setState(res.code === 'NOT_ORGANISATION_CONTACT' || res.code === 'FORBIDDEN' ? 'forbidden' : 'failed');
        }
      } catch (err) {
        logError('Failed to load organisation wellbeing', err);
        if (active) setState('failed');
      }
    })();
    return () => { active = false; };
  }, [orgId]);

  const open = items.filter((i) => i.status === 'active' || i.status === 'acknowledged').length;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-theme-muted">{t('org_wellbeing.intro')}</p>
        {/* Always in the page, empty until the list arrives, so the summary is
            announced when it is filled in (21 Oct 2026). */}
        <p
          role="status"
          aria-live="polite"
          data-testid="org-wellbeing-summary"
          className={state === 'ready' && items.length > 0 ? 'mt-4 text-sm font-medium text-theme-primary' : undefined}
        >
          {state === 'ready' && items.length > 0 ? t('org_wellbeing.summary', { count: open }) : null}
        </p>
      </div>

      {state === 'loading' && <div role="status" aria-busy="true" className="space-y-3"><CardRowsSkeleton /><CardRowsSkeleton /></div>}
      {state === 'forbidden' && <EmptyState icon={<HeartPulse className="w-12 h-12" aria-hidden="true" />} title={t('org_wellbeing.forbidden')} />}
      {state === 'failed' && <EmptyState icon={<HeartPulse className="w-12 h-12" aria-hidden="true" />} title={t('org_wellbeing.load_error')} />}
      {state === 'ready' && items.length === 0 && (
        <EmptyState icon={<HeartPulse className="w-12 h-12" aria-hidden="true" />} title={t('org_wellbeing.empty')} description={t('org_wellbeing.empty_desc')} />
      )}
      {state === 'ready' && items.length > 0 && (
        <>
          <ul className="space-y-3">
            {items.map((item) => {
              const moodKey = item.mood === 1 ? 'org_wellbeing.mood_struggling' : 'org_wellbeing.mood_low';
              const isOpen = item.status === 'active' || item.status === 'acknowledged';
              return (
                <li key={item.alert_id}>
                  <GlassCard className={`space-y-2 p-4 ${isOpen ? 'border border-rose-500/30' : ''}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-theme-primary">{item.volunteer.name}</span>
                      <Chip size="sm" variant="soft" color={item.mood === 1 ? 'danger' : 'warning'}>{t(moodKey)}</Chip>
                      <Chip size="sm" variant="soft">{t(STATUS_KEYS[item.status] ?? 'org_wellbeing.status_active')}</Chip>
                    </div>
                    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-theme-muted">
                      {item.checkin_at && (
                        <div className="flex gap-1"><dt>{t('org_wellbeing.checked_in')}:</dt><dd>{formatDateTime(item.checkin_at)}</dd></div>
                      )}
                      <div className="flex gap-1">
                        <dt>{t('org_wellbeing.told_label')}:</dt>
                        <dd>{item.told_at ? t('org_wellbeing.told_on', { date: formatDateTime(item.told_at) }) : t('org_wellbeing.not_told')}</dd>
                      </div>
                    </dl>
                    <p className="text-sm text-theme-muted">{isOpen ? t('org_wellbeing.what_to_do') : t('org_wellbeing.closed_help')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={tenantPath(`/messages/${item.volunteer.id}`)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-2 hover:underline"
                      >
                        <MessageSquare className="w-4 h-4" aria-hidden="true" />
                        {t('org_wellbeing.message', { name: item.volunteer.name })}
                      </Link>
                      <Link
                        to={tenantPath(`/profile/${item.volunteer.id}`)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-2 hover:underline"
                      >
                        <UserRound className="w-4 h-4" aria-hidden="true" />
                        {t('org_wellbeing.view_profile')}
                      </Link>
                    </div>
                  </GlassCard>
                </li>
              );
            })}
          </ul>
          <p className="flex items-start gap-2 text-xs text-theme-subtle">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('org_wellbeing.confidentiality_note')}
          </p>
        </>
      )}
    </div>
  );
}

export default OrgWellbeingTab;
