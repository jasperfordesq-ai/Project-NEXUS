// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Phone app: who has the app, across every community.
 *
 * The figures and both lists are the block that used to sit at the foot of
 * each community admin's Phone app page for the platform team; this page gives
 * them a home of their own and their own request
 * (`GET /v2/platform-team/phone-app`, platform team only).
 *
 * A reply that cannot be loaded shows the error card. It never shows a
 * platform of zero.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { PhoneAppAllCommunities, type NativeAppPlatformStats } from '@/admin/modules/system/PhoneAppAllCommunities';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import Info from 'lucide-react/icons/info';

interface AppVersionRow {
  version: string;
  sign_ins: number;
}

/**
 * The page's reply: the all-communities block plus, from 16 Nov 2026, the
 * app versions in use. An older server sends no `versions`; the section is
 * then left out, not shown as an error.
 */
type PhoneAppReply = NativeAppPlatformStats & {
  versions?: AppVersionRow[];
  version_not_recorded?: number;
};

/**
 * Live phone-app sign-ins counted by app version, newest first (the server
 * orders them). Counts only: no member, no device.
 */
function AppVersionsInUse({ versions, notRecorded }: { versions: AppVersionRow[]; notRecorded: number }) {
  const { t } = useTranslation('platform_team');

  return (
    <section aria-labelledby="phone-app-versions-title" className="mt-8">
      <h2 id="phone-app-versions-title" className="text-lg font-semibold text-foreground">
        {t('phone_app.versions.title')}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t('phone_app.versions.coverage')}</p>

      {versions.length === 0 ? (
        <p className="mt-3 text-sm text-foreground">{t('phone_app.versions.none_yet')}</p>
      ) : (
        <ul className="mt-3 max-w-md divide-y divide-divider rounded-lg border border-divider">
          {versions.map((row) => (
            <li key={row.version} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
              <span className="font-medium text-foreground">
                {t('phone_app.versions.version', { version: row.version })}
              </span>
              <span className="text-muted">
                {t('phone_app.versions.sign_ins', { count: row.sign_ins })}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-sm text-muted">
        {t('phone_app.versions.not_recorded', { count: notRecorded })}
      </p>
    </section>
  );
}

export function PhoneAppPage() {
  const { t } = useTranslation('platform_team');
  usePageTitle(t('phone_app.title'));

  const [stats, setStats] = useState<PhoneAppReply | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<PhoneAppReply>('/v2/platform-team/phone-app');
      if (res.success && res.data && Array.isArray(res.data.by_tenant)) {
        setStats(res.data);
      } else {
        setStats(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the all-communities phone app figures', err);
      setStats(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">{t('phone_app.title')}</h1>
        <p className="mt-2 max-w-2xl text-base text-muted">{t('phone_app.intro')}</p>
        <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm text-muted">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t('phone_app.not_downloads')}
        </p>
      </div>

      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('phone_app.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !stats ? (
        <LoadError title={t('phone_app.load_error_title')} onRetry={() => void load()} />
      ) : (
        <>
          <PhoneAppAllCommunities platform={stats} />
          {Array.isArray(stats.versions) ? (
            <AppVersionsInUse versions={stats.versions} notRecorded={Number(stats.version_not_recorded ?? 0)} />
          ) : null}
        </>
      )}
    </section>
  );
}

export default PhoneAppPage;
