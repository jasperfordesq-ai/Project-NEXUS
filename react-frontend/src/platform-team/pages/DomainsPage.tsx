// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Addresses and certificates (idea 7).
 *
 * For each community's own addresses and for the platform's own addresses:
 * does the name resolve, and when does the certificate a visitor's browser is
 * given run out. The server checks every address once a day; "Check now"
 * checks one community's addresses (or the platform's) again.
 *
 * 🔴 The request names a community, never an address: the server takes the
 * addresses from its own records. The server's error wording is never shown;
 * each refusal is said in this page's own words.
 *
 * A list that cannot be loaded shows the error card, never an empty list.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import CheckCircle from 'lucide-react/icons/circle-check';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import XCircle from 'lucide-react/icons/circle-x';
import HelpCircle from 'lucide-react/icons/circle-help';
import MinusCircle from 'lucide-react/icons/circle-minus';
import RefreshCw from 'lucide-react/icons/refresh-cw';

type DomainStatus = 'ok' | 'warning' | 'failing' | 'unknown' | 'not_checkable';

type ErrorKind =
  | 'does_not_resolve'
  | 'not_a_public_address'
  | 'no_answer'
  | 'certificate_not_trusted'
  | 'could_not_read_certificate';

interface CheckResult {
  status: DomainStatus | null;
  resolves: boolean | null;
  certificate_expires_at: string | null;
  days_left: number | null;
  checked_at: string | null;
  error_kind: ErrorKind | null;
}

interface PlatformAddress extends CheckResult {
  host: string;
}

interface CommunityAddress extends CheckResult {
  kind: 'main' | 'accessible';
  host: string;
  uses_platform_address: boolean;
}

interface CommunityRow {
  id: number;
  name: string;
  slug: string | null;
  is_active: boolean;
  addresses: CommunityAddress[];
}

interface DomainsOverview {
  platform: PlatformAddress[];
  communities: CommunityRow[];
  warning_days: number;
}

const REASON_KEYS = {
  does_not_resolve: 'domains.reason.does_not_resolve',
  not_a_public_address: 'domains.reason.not_a_public_address',
  no_answer: 'domains.reason.no_answer',
  certificate_not_trusted: 'domains.reason.certificate_not_trusted',
  could_not_read_certificate: 'domains.reason.could_not_read_certificate',
} as const satisfies Record<ErrorKind, string>;

const KIND_KEYS = {
  main: 'domains.kind.main',
  accessible: 'domains.kind.accessible',
} as const;

/** The server's refusal codes, said in the page's own words. */
const REFUSAL_KEYS: Record<string, 'domains.too_many'> = {
  RATE_LIMIT_EXCEEDED: 'domains.too_many',
};

/** Something of its own the server would check (not the platform's address, a plain name). */
function hasOwnAddress(community: CommunityRow): boolean {
  return community.addresses.some((a) => !a.uses_platform_address && a.status !== 'not_checkable');
}

export function DomainsPage() {
  const { t, i18n } = useTranslation('platform_team');
  const toast = useToast();
  usePageTitle(t('domains.title'));

  const [overview, setOverview] = useState<DomainsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<number | 'platform' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<DomainsOverview>('/v2/platform-team/domains');
      if (res.success && res.data && Array.isArray(res.data.communities) && Array.isArray(res.data.platform)) {
        setOverview(res.data);
      } else {
        setOverview(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the addresses and certificates list', err);
      setOverview(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refuse = (code: string | undefined) => {
    const refusal = REFUSAL_KEYS[code ?? ''];
    toast.error(refusal ? t(refusal) : t('domains.check_failed'));
  };

  const checkCommunity = async (community: CommunityRow) => {
    setBusy(community.id);
    try {
      const res = await api.post<CommunityRow>('/v2/platform-team/domains/check', { tenant_id: community.id });
      if (res.success && res.data && Array.isArray(res.data.addresses)) {
        const fresh = res.data;
        setOverview((current) =>
          current ? { ...current, communities: current.communities.map((c) => (c.id === fresh.id ? fresh : c)) } : current,
        );
        toast.success(t('domains.checked'));
      } else {
        refuse(res.code);
      }
    } catch (err) {
      logError('Address check could not be run', err);
      toast.error(t('domains.check_failed'));
    } finally {
      setBusy(null);
    }
  };

  const checkPlatform = async () => {
    setBusy('platform');
    try {
      const res = await api.post<{ platform: PlatformAddress[] }>('/v2/platform-team/domains/check', { platform: true });
      if (res.success && res.data && Array.isArray(res.data.platform)) {
        const fresh = res.data.platform;
        setOverview((current) => (current ? { ...current, platform: fresh } : current));
        toast.success(t('domains.checked'));
      } else {
        refuse(res.code);
      }
    } catch (err) {
      logError('Platform address check could not be run', err);
      toast.error(t('domains.check_failed'));
    } finally {
      setBusy(null);
    }
  };

  const date = (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const time = (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString(i18n.language);
  };

  /** The state in words, with an icon. */
  const renderStatus = (result: CheckResult) => {
    const expiresOn = date(result.certificate_expires_at);
    const checkedAt = time(result.checked_at);

    let icon = <HelpCircle size={16} className="shrink-0 text-muted" aria-hidden="true" />;
    let words = t('domains.status.unknown');
    let reason: string | null = null;

    switch (result.status) {
      case 'ok':
        icon = <CheckCircle size={16} className="shrink-0 text-success" aria-hidden="true" />;
        words = t('domains.status.ok');
        break;
      case 'warning':
        icon = <AlertTriangle size={16} className="shrink-0 text-warning" aria-hidden="true" />;
        // 🔴 Days left that could not be read are never shown as "0 days".
        words =
          result.days_left === null
            ? t('domains.status.warning_days_unknown')
            : t('domains.status.warning', { count: result.days_left });
        break;
      case 'failing':
        icon = <XCircle size={16} className="shrink-0 text-danger" aria-hidden="true" />;
        words = t('domains.status.failing');
        reason = result.error_kind ? t(REASON_KEYS[result.error_kind]) : t('domains.reason.expired');
        break;
      case 'not_checkable':
        icon = <MinusCircle size={16} className="shrink-0 text-muted" aria-hidden="true" />;
        words = t('domains.status.not_checkable');
        break;
      default:
        break;
    }

    return (
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          {icon}
          <span>{words}</span>
        </p>
        {reason && <p className="mt-1 ps-6 text-sm text-foreground">{reason}</p>}
        {(result.status === 'ok' || result.status === 'warning') && expiresOn && (
          <p className="mt-1 ps-6 text-sm text-muted">{t('domains.expires_on', { date: expiresOn })}</p>
        )}
        {checkedAt && <p className="mt-1 ps-6 text-xs text-muted">{t('domains.checked_at', { time: checkedAt })}</p>}
      </div>
    );
  };

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('domains.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('domains.intro')}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('domains.seen_from_server')}</p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !overview ? (
        <div role="status" aria-busy="true" aria-label={t('domains.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !overview ? (
        <LoadError title={t('domains.load_error_title')} onRetry={() => void load()} />
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">{t('domains.daily', { days: overview.warning_days })}</p>

          <section className="mb-8" data-testid="domains-platform" aria-labelledby="domains-platform-heading">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 id="domains-platform-heading" className="text-lg font-semibold text-foreground">
                {t('domains.platform_heading')}
              </h2>
              {overview.platform.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={t('domains.check_platform_now')}
                  isLoading={busy === 'platform'}
                  isDisabled={busy !== null}
                  onPress={() => void checkPlatform()}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  {t('domains.check_now')}
                </Button>
              )}
            </div>
            {overview.platform.length === 0 ? (
              <p className="text-sm text-muted">{t('domains.platform_none')}</p>
            ) : (
              <Card>
                <CardBody className="p-0">
                  <ul className="divide-y divide-divider">
                    {overview.platform.map((p) => (
                      <li key={p.host} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                        <span className="min-w-0 break-all text-sm font-medium text-foreground">{p.host}</span>
                        <div className="sm:max-w-[60%]">{renderStatus(p)}</div>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )}
          </section>

          <h2 className="mb-3 text-lg font-semibold text-foreground">{t('domains.communities_heading')}</h2>
          <ul className="flex flex-col gap-3">
            {overview.communities.map((community) => (
              <li key={community.id} data-testid={`domains-community-${community.id}`}>
                <Card>
                  <CardBody className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="flex min-w-0 flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                        <span className="break-words">{community.name}</span>
                        {!community.is_active && (
                          <Chip size="sm" variant="soft">
                            {t('domains.switched_off')}
                          </Chip>
                        )}
                      </h3>
                      {hasOwnAddress(community) && (
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={t('domains.check_now_for', { name: community.name })}
                          isLoading={busy === community.id}
                          isDisabled={busy !== null}
                          onPress={() => void checkCommunity(community)}
                        >
                          <RefreshCw size={14} aria-hidden="true" />
                          {t('domains.check_now')}
                        </Button>
                      )}
                    </div>

                    {community.addresses.length === 0 ? (
                      <p className="text-sm text-muted">{t('domains.no_address')}</p>
                    ) : (
                      <ul className="flex flex-col gap-3">
                        {community.addresses.map((a) => (
                          <li key={a.kind} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                            <div className="min-w-0">
                              <p className="text-xs text-muted">{t(KIND_KEYS[a.kind])}</p>
                              <p className="break-all text-sm font-medium text-foreground">{a.host}</p>
                            </div>
                            <div className="sm:max-w-[60%]">
                              {a.uses_platform_address ? (
                                <p className="text-sm text-muted">{t('domains.uses_platform_address')}</p>
                              ) : (
                                renderStatus(a)
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default DomainsPage;
