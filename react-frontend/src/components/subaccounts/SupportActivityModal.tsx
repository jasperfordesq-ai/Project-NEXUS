// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SupportActivityModal — a supporter views the activity summary of a member
 * they support.
 *
 * Renders GET /v2/users/me/sub-accounts/{childId}/activity. That endpoint has
 * existed, enforced (`activity ≥ assist`), since the permissions were first
 * wired up — but until this modal NOTHING in any frontend called it, so the
 * one capability that defaults to ON for every relationship had no screen.
 * A permission that can be granted but never exercised misleads the family
 * granting it, which is the same defect class as the old "View their
 * messages" switch.
 *
 * Read-only by design: every acting path (prepare / act alone) lives in
 * SupportPrepareModal and carries its own tier rules. This modal must never
 * grow an action button — seeing is `assist`; doing is a different tier.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalHeading,
  Button,
  Spinner,
} from '@/components/ui';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';

interface HoursSummary {
  hours_given: number;
  hours_received: number;
  transactions_given: number;
  transactions_received: number;
  net_balance: number;
}

interface ConnectionStats {
  total_connections: number;
  pending_requests: number;
  groups_joined: number;
}

interface EngagementMetrics {
  posts_count: number;
  comments_count: number;
  likes_given: number;
  likes_received: number;
  period: string;
}

interface TimelineItem {
  id: number;
  activity_type: string;
  description: string | null;
  created_at: string;
}

interface ActivitySummary {
  timeline?: TimelineItem[];
  hours_summary?: HoursSummary;
  connection_stats?: ConnectionStats;
  engagement?: EngagementMetrics;
}

interface SupportActivityModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  supportedUserId: number;
  supportedName: string;
}

const TIMELINE_LIMIT = 10;

/** Timeline rows arrive with a server-side activity_type vocabulary; anything
 *  unrecognised falls back to the generic label rather than leaking the code. */
const KNOWN_TIMELINE_TYPES = new Set(['post', 'comment', 'connection', 'gave_hours', 'received_hours']);

export function SupportActivityModal({
  isOpen,
  onOpenChange,
  supportedUserId,
  supportedName,
}: SupportActivityModalProps) {
  const { t } = useTranslation('settings');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setSummary(null);

    (async () => {
      try {
        const res = await api.get<ActivitySummary>(`/v2/users/me/sub-accounts/${supportedUserId}/activity`);
        if (cancelled) return;
        if (res.success && res.data) {
          setSummary(res.data);
        } else {
          // A 403 here means the grant was withdrawn (or a safeguarding
          // restriction landed) after this card rendered — say so plainly
          // rather than showing an empty dashboard.
          setError(res.error || t('support_activity.load_failed'));
        }
      } catch (err) {
        logError('Failed to load supported member activity', err);
        if (!cancelled) setError(t('support_activity.load_failed'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, supportedUserId, t]);

  const hours = summary?.hours_summary;
  const connections = summary?.connection_stats;
  const engagement = summary?.engagement;
  const timeline = (summary?.timeline ?? []).slice(0, TIMELINE_LIMIT);

  const stat = (label: string, value: number | string) => (
    <div className="rounded-lg border border-theme-default p-3">
      <p className="text-xs text-theme-muted">{label}</p>
      <p className="text-lg font-semibold text-theme-primary">{value}</p>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>
              <ModalHeading>{t('support_activity.title', { name: supportedName })}</ModalHeading>
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-theme-muted">
                {t('support_activity.explainer', { name: supportedName })}
              </p>

              {isLoading && (
                <div className="flex justify-center py-8">
                  <Spinner aria-label={t('support_activity.loading')} />
                </div>
              )}

              {!isLoading && error && (
                <p className="text-sm text-danger" data-testid="support-activity-error">{error}</p>
              )}

              {!isLoading && !error && summary && (
                <div className="space-y-4">
                  {hours && (
                    <section aria-label={t('support_activity.hours_heading')}>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-theme-muted">
                        {t('support_activity.hours_heading')}
                      </h4>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {stat(t('support_activity.hours_given'), hours.hours_given)}
                        {stat(t('support_activity.hours_received'), hours.hours_received)}
                        {stat(t('support_activity.net_balance'), hours.net_balance)}
                      </div>
                    </section>
                  )}

                  {(connections || engagement) && (
                    <section aria-label={t('support_activity.community_heading')}>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-theme-muted">
                        {t('support_activity.community_heading')}
                      </h4>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {connections && stat(t('support_activity.connections'), connections.total_connections)}
                        {connections && stat(t('support_activity.groups'), connections.groups_joined)}
                        {engagement && stat(t('support_activity.posts_30_days'), engagement.posts_count)}
                      </div>
                    </section>
                  )}

                  <section aria-label={t('support_activity.timeline_heading')}>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-theme-muted">
                      {t('support_activity.timeline_heading')}
                    </h4>
                    {timeline.length === 0 ? (
                      <p className="text-sm text-theme-muted">{t('support_activity.timeline_empty')}</p>
                    ) : (
                      <ul className="space-y-2">
                        {timeline.map((item) => (
                          <li
                            key={`${item.activity_type}-${item.id}-${item.created_at}`}
                            className="rounded-lg border border-theme-default p-3"
                          >
                            <p className="text-xs font-medium text-theme-muted">
                              {KNOWN_TIMELINE_TYPES.has(item.activity_type)
                                ? t(`support_activity.type_${item.activity_type}`)
                                : t('support_activity.type_other')}
                              {' · '}
                              {formatRelativeTime(item.created_at)}
                            </p>
                            {item.description && (
                              <p className="mt-1 break-words text-sm text-theme-primary">{item.description}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="tertiary" onPress={onClose}>
                {t('support_activity.close')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default SupportActivityModal;
