// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Input, Button, Spinner } from '@/components/ui';
import { useState, useEffect, type ReactNode } from 'react';
import Stethoscope from 'lucide-react/icons/stethoscope';
import Search from 'lucide-react/icons/search';
import CircleCheck from 'lucide-react/icons/circle-check-big';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { useToast } from '@/contexts';
import { adminDiagnostics } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { formatPercentValue, formatUnit } from '@/lib/helpers';
import { formatServerDateTime } from '@/lib/serverTime';
import type { MatchingListingDiagnosis, MatchingUserDiagnosis } from '../../api/types';
import { parseMatchingStatsResponse } from '../matching/matchingResponseGuards';

/**
 * Matching Diagnostic (platform team)
 *
 * Answers, in plain facts, why one member does or does not get matches and
 * why one listing is or is not offered as a match:
 *   GET /v2/admin/matching/diagnose/user/{id}
 *   GET /v2/admin/matching/diagnose/listing/{id}
 *
 * Until November 2026 both buttons called the community-wide statistics
 * endpoint with an id it never read, and printed the same JSON for every id.
 */

/** Wording for each finding code the server can send. */
const FINDING_KEYS: Record<string, string> = {
  matching_off: 'diagnostics.finding_matching_off',
  member_not_active: 'diagnostics.finding_member_not_active',
  matching_paused: 'diagnostics.finding_matching_paused',
  no_active_listings: 'diagnostics.finding_no_active_listings',
  no_location_remote_only: 'diagnostics.finding_no_location_remote_only',
  no_location: 'diagnostics.finding_no_location',
  needs_coordinator_approval: 'diagnostics.finding_needs_coordinator_approval',
  approval_state_unknown: 'diagnostics.finding_approval_state_unknown',
  listing_not_active: 'diagnostics.finding_listing_not_active',
  listing_not_approved: 'diagnostics.finding_listing_not_approved',
  owner_not_active: 'diagnostics.finding_owner_not_active',
  owner_dormant: 'diagnostics.finding_owner_dormant',
  no_location_in_person: 'diagnostics.finding_no_location_in_person',
  nothing_blocking: 'diagnostics.finding_nothing_blocking',
};

const LISTING_TYPE_KEYS: Record<string, string> = {
  offer: 'diagnostics.listing_type_offer',
  request: 'diagnostics.listing_type_request',
};

/**
 * Words for the states an account, a listing or a moderation decision can be
 * stored in (users.status, listings.status, listings.moderation_status). The
 * stored value itself is never printed: "pending_review" means nothing to the
 * person reading this page.
 */
const STATE_KEYS: Record<string, string> = {
  active: 'diagnostics.state_active',
  inactive: 'diagnostics.state_inactive',
  suspended: 'diagnostics.state_suspended',
  banned: 'diagnostics.state_banned',
  pending: 'diagnostics.state_pending',
  rejected: 'diagnostics.state_rejected',
  delegate: 'diagnostics.state_delegate',
  paused: 'diagnostics.state_paused',
  completed: 'diagnostics.state_completed',
  expired: 'diagnostics.state_expired',
  closed: 'diagnostics.state_closed',
  deleted: 'diagnostics.state_deleted',
  pending_review: 'diagnostics.state_pending_review',
  approved: 'diagnostics.state_approved',
};

/** How a listing is delivered (listings.service_type), worded as the listing form words it. */
const DELIVERY_KEYS: Record<string, string> = {
  physical_only: 'diagnostics.delivery_physical_only',
  remote_only: 'diagnostics.delivery_remote_only',
  hybrid: 'diagnostics.delivery_hybrid',
  location_dependent: 'diagnostics.delivery_location_dependent',
};

interface Fact {
  label: string;
  value: ReactNode;
}

function isUserDiagnosis(value: unknown): value is MatchingUserDiagnosis {
  const v = value as Partial<MatchingUserDiagnosis> | null;
  return Boolean(v && typeof v === 'object' && v.member && v.listings && v.preferences
    && v.cache && v.dismissals && v.community && v.effective && Array.isArray(v.findings));
}

function isListingDiagnosis(value: unknown): value is MatchingListingDiagnosis {
  const v = value as Partial<MatchingListingDiagnosis> | null;
  return Boolean(v && typeof v === 'object' && v.listing && v.owner && v.cache
    && v.dismissals && v.community && Array.isArray(v.findings));
}

/** A finding code this page has no wording for yet, exactly as the server named it. */
function Stored({ children }: { children: string }) {
  return (
    <code className="rounded bg-surface-secondary px-1.5 py-0.5 text-xs text-foreground">{children}</code>
  );
}

function FactSection({ title, facts }: { title: string; facts: Fact[] }) {
  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold text-foreground">{title}</h4>
      <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-baseline justify-between gap-4 border-b border-divider/60 py-1.5">
            <dt className="text-sm text-muted">{fact.label}</dt>
            <dd className="text-right text-sm font-medium text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function MatchingDiagnostic() {
  const { t } = useTranslation('admin_diagnostics');
  useAdminPageMeta({ title: t('diagnostics.page_title') });
  const toast = useToast();

  const [userId, setUserId] = useState('');
  const [listingId, setListingId] = useState('');
  const [userResult, setUserResult] = useState<MatchingUserDiagnosis | null>(null);
  const [listingResult, setListingResult] = useState<MatchingListingDiagnosis | null>(null);
  const [engineStatus, setEngineStatus] = useState<{ today?: number; stored: number; average: number } | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const [loadingListing, setLoadingListing] = useState(false);
  const [loadingEngine, setLoadingEngine] = useState(true);

  useEffect(() => {
    adminDiagnostics.getMatchingStats()
      .then((res) => {
        // The same guard the analytics pages use: it knows the names the
        // server really sends (total_cached_matches, average_score). Reading
        // the raw keys left all three tiles on "--".
        const parsed = res.success ? parseMatchingStatsResponse(res.data) : null;
        if (parsed) {
          setEngineStatus({
            today: parsed.overview.total_matches_today,
            stored: parsed.overview.cache_entries,
            average: parsed.overview.avg_match_score,
          });
        } else {
          toast.error(t('diagnostics.failed_to_load_engine_status'));
        }
      })
      .catch(() => toast.error(t('diagnostics.failed_to_load_engine_status')))
      .finally(() => setLoadingEngine(false));
  }, [t, toast])


  const handleDiagnoseUser = async () => {
    if (!userId) return;
    setLoadingUser(true);
    setUserResult(null);
    try {
      const res = await adminDiagnostics.diagnoseUser(Number(userId));
      if (res.success && isUserDiagnosis(res.data)) {
        setUserResult(res.data);
      } else if (res.code === 'NOT_FOUND') {
        // No such member in this community (an id from another community
        // answers the same way).
        toast.error(t('diagnostics.no_diagnostic_data_found_for_this_user'));
      } else {
        toast.error(t('diagnostics.failed_to_diagnose_user'));
      }
    } catch {
      toast.error(t('diagnostics.failed_to_diagnose_user'));
    } finally {
      setLoadingUser(false);
    }
  };

  const handleDiagnoseListing = async () => {
    if (!listingId) return;
    setLoadingListing(true);
    setListingResult(null);
    try {
      const res = await adminDiagnostics.diagnoseListing(Number(listingId));
      if (res.success && isListingDiagnosis(res.data)) {
        setListingResult(res.data);
      } else if (res.code === 'NOT_FOUND') {
        toast.error(t('diagnostics.no_diagnostic_data_found_for_this_listin'));
      } else {
        toast.error(t('diagnostics.failed_to_diagnose_listing'));
      }
    } catch {
      toast.error(t('diagnostics.failed_to_diagnose_listing'));
    } finally {
      setLoadingListing(false);
    }
  };

  const yesNo = (value: boolean) => (value ? t('common.yes') : t('common.no'));
  const dateOrBlank = (value: string | null) =>
    value ? formatServerDateTime(value) : t('diagnostics.value_not_recorded');
  const scoreOrBlank = (value: number | null) =>
    value === null ? t('diagnostics.value_not_recorded') : formatPercentValue(value);
  const km = (value: number) => formatUnit(value, 'kilometer', { maximumFractionDigits: 0 });
  const stateLabel = (stored: string | null) => {
    if (stored === null) return t('diagnostics.value_not_recorded');
    const key = STATE_KEYS[stored];
    return key ? t(key) : t('common.unknown');
  };
  const deliveryLabel = (stored: string) => {
    const key = DELIVERY_KEYS[stored];
    return key ? t(key) : t('common.unknown');
  };
  const listingTypeLabel = (stored: string) => {
    const key = LISTING_TYPE_KEYS[stored];
    return key ? t(key) : t('common.unknown');
  };

  const renderFindings = (codes: string[], dormancyDays: number) => (
    <section>
      <h4 className="mb-2 text-sm font-semibold text-foreground">{t('diagnostics.findings_title')}</h4>
      <ul className="space-y-2">
        {codes.map((code) => {
          const clear = code === 'nothing_blocking';
          const key = FINDING_KEYS[code];
          return (
            <li
              key={code}
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                clear ? 'border-success/30 bg-success/5' : 'border-warning/40 bg-warning/5'
              }`}
            >
              {clear
                ? <CircleCheck size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                : <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />}
              <span className="text-foreground">
                {key ? t(key, { days: dormancyDays }) : <Stored>{code}</Stored>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );

  const renderUser = (d: MatchingUserDiagnosis) => {
    const ownMin = d.preferences.min_match_score;
    const ownMax = d.preferences.max_distance_km;
    const ownMaxApplies = ownMax !== null && ownMax > 0 && ownMax <= d.community.max_distance_km;

    return (
      <div className="mt-2 space-y-5 rounded-xl bg-surface-secondary/60 p-4" data-testid="user-diagnosis">
        {renderFindings(d.findings, d.community.dormancy_days)}

        <FactSection
          title={t('diagnostics.section_member')}
          facts={[
            { label: t('diagnostics.fact_name'), value: <>{d.member.name} <span className="text-muted">#{d.member.id}</span></> },
            { label: t('diagnostics.fact_account_status'), value: stateLabel(d.member.status) },
            { label: t('diagnostics.fact_location_set'), value: yesNo(d.member.has_coordinates) },
            { label: t('diagnostics.fact_last_active'), value: dateOrBlank(d.member.last_active_at) },
          ]}
        />

        <section>
          <FactSection
            title={t('diagnostics.section_their_listings')}
            facts={[
              { label: t('diagnostics.fact_active_listings'), value: d.listings.active_count },
              { label: t('diagnostics.fact_listings_in_moderation'), value: d.listings.awaiting_or_refused_review_count },
            ]}
          />
          {d.listings.by_category.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {d.listings.by_category.map((row) => {
                return (
                  <li
                    key={`${row.type}-${row.category_name ?? ''}`}
                    className="rounded-full border border-divider bg-surface px-3 py-1 text-xs text-foreground"
                  >
                    {listingTypeLabel(row.type)}
                    {' · '}
                    {row.category_name ?? t('diagnostics.value_no_category')}
                    {' · '}
                    <span className="font-semibold tabular-nums">{row.count}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <FactSection
          title={t('diagnostics.section_settings')}
          facts={[
            { label: t('diagnostics.fact_matching_paused'), value: yesNo(d.preferences.matching_paused) },
            {
              label: t('diagnostics.fact_min_score'),
              value: ownMin !== null
                ? t('diagnostics.value_member_setting', { value: formatPercentValue(ownMin) })
                : t('diagnostics.value_community_setting', { value: formatPercentValue(d.community.min_match_score) }),
            },
            {
              label: t('diagnostics.fact_max_distance'),
              value: ownMaxApplies
                ? t('diagnostics.value_member_setting', { value: km(d.effective.max_distance_km) })
                : t('diagnostics.value_community_setting', { value: km(d.effective.max_distance_km) }),
            },
          ]}
        />

        <FactSection
          title={t('diagnostics.section_activity')}
          facts={[
            { label: t('diagnostics.fact_cached_matches'), value: d.cache.cached_matches },
            { label: t('diagnostics.fact_best_score'), value: scoreOrBlank(d.cache.best_score) },
            {
              label: t('diagnostics.fact_dismissals'),
              value: t('diagnostics.value_dismissals', { total: d.dismissals.total, recent: d.dismissals.last_90_days }),
            },
            { label: t('diagnostics.fact_held_for_approval'), value: d.held_for_approval_count },
          ]}
        />
      </div>
    );
  };

  const renderListing = (d: MatchingListingDiagnosis) => {
    return (
      <div className="mt-2 space-y-5 rounded-xl bg-surface-secondary/60 p-4" data-testid="listing-diagnosis">
        {renderFindings(d.findings, d.community.dormancy_days)}

        <FactSection
          title={t('diagnostics.section_listing')}
          facts={[
            { label: t('diagnostics.fact_title'), value: <>{d.listing.title} <span className="text-muted">#{d.listing.id}</span></> },
            { label: t('diagnostics.fact_listing_status'), value: stateLabel(d.listing.status) },
            { label: t('diagnostics.fact_moderation'), value: stateLabel(d.listing.moderation_status) },
            { label: t('diagnostics.fact_type'), value: listingTypeLabel(d.listing.type) },
            { label: t('diagnostics.fact_category'), value: d.listing.category_name ?? t('diagnostics.value_no_category') },
            { label: t('diagnostics.fact_service_type'), value: deliveryLabel(d.listing.service_type) },
            { label: t('diagnostics.fact_location_set'), value: yesNo(d.listing.has_coordinates) },
          ]}
        />

        <FactSection
          title={t('diagnostics.section_owner')}
          facts={[
            { label: t('diagnostics.fact_name'), value: <>{d.owner.name} <span className="text-muted">#{d.owner.id}</span></> },
            { label: t('diagnostics.fact_account_status'), value: stateLabel(d.owner.status) },
            { label: t('diagnostics.fact_location_set'), value: yesNo(d.owner.has_coordinates) },
            { label: t('diagnostics.fact_last_active'), value: dateOrBlank(d.owner.last_active_at) },
          ]}
        />

        <FactSection
          title={t('diagnostics.section_activity')}
          facts={[
            { label: t('diagnostics.fact_members_cached'), value: d.cache.members_cached },
            { label: t('diagnostics.fact_best_score'), value: scoreOrBlank(d.cache.best_score) },
            { label: t('diagnostics.fact_times_dismissed'), value: d.dismissals.total },
          ]}
        />
      </div>
    );
  };

  return (
    <div>
      <PageHeader title={t('diagnostics.matching_diagnostic_title')} description={t('diagnostics.matching_diagnostic_desc')} />

      <div className="space-y-4">
        <Card >
          <CardHeader><h3 className="text-lg font-semibold flex items-center gap-2"><Stethoscope size={20} aria-hidden="true" /> {t('diagnostics.diagnose_user_matches')}</h3></CardHeader>
          <CardBody className="gap-4">
            <p className="text-sm text-muted">{t('diagnostics.diagnose_user_matches_desc')}</p>
            <div className="flex gap-3">
              <Input label={t('diagnostics.label_user_i_d')} placeholder={t('diagnostics.user_id_placeholder')} type="number" value={userId} onValueChange={setUserId} variant="secondary" className="max-w-xs" />
              <Button
                startContent={loadingUser ? undefined : <Search size={16} />}
                className="self-end"
                isDisabled={!userId}
                isLoading={loadingUser}
                onPress={handleDiagnoseUser}
              >
                {t('diagnostics.diagnose')}
              </Button>
            </div>
            {userResult && renderUser(userResult)}
            {!userId && !userResult && (
              <p className="text-xs text-muted">{t('diagnostics.user_prompt')}</p>
            )}
          </CardBody>
        </Card>

        <Card >
          <CardHeader><h3 className="text-lg font-semibold">{t('diagnostics.diagnose_listing_matches')}</h3></CardHeader>
          <CardBody className="gap-4">
            <p className="text-sm text-muted">{t('diagnostics.diagnose_listing_matches_desc')}</p>
            <div className="flex gap-3">
              <Input label={t('diagnostics.label_listing_i_d')} placeholder={t('diagnostics.listing_id_placeholder')} type="number" value={listingId} onValueChange={setListingId} variant="secondary" className="max-w-xs" />
              <Button
                startContent={loadingListing ? undefined : <Search size={16} />}
                className="self-end"
                isDisabled={!listingId}
                isLoading={loadingListing}
                onPress={handleDiagnoseListing}
              >
                {t('diagnostics.diagnose')}
              </Button>
            </div>
            {listingResult && renderListing(listingResult)}
          </CardBody>
        </Card>

        <Card >
          <CardHeader><h3 className="text-lg font-semibold">{t('diagnostics.engine_status')}</h3></CardHeader>
          <CardBody>
            {loadingEngine ? (
              <div className="flex justify-center py-4" role="status" aria-busy="true" aria-label={t('common.loading')}><Spinner size="sm" /></div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border p-3 text-center">
                  <p className="text-sm text-muted">{t('diagnostics.matches_today')}</p>
                  <p className="font-medium">{engineStatus?.today ?? '--'}</p>
                </div>
                <div className="rounded-lg border border-border p-3 text-center">
                  <p className="text-sm text-muted">{t('diagnostics.cache_entries')}</p>
                  <p className="font-medium">{engineStatus?.stored ?? '--'}</p>
                </div>
                <div className="rounded-lg border border-border p-3 text-center">
                  <p className="text-sm text-muted">{t('diagnostics.avg_match_score')}</p>
                  <p className="font-medium">
                    {engineStatus ? formatPercentValue(engineStatus.average) : '--'}
                  </p>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default MatchingDiagnostic;
