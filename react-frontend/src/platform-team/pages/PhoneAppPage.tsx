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

export function PhoneAppPage() {
  const { t } = useTranslation('platform_team');
  usePageTitle(t('phone_app.title'));

  const [stats, setStats] = useState<NativeAppPlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<NativeAppPlatformStats>('/v2/platform-team/phone-app');
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
        <PhoneAppAllCommunities platform={stats} />
      )}
    </section>
  );
}

export default PhoneAppPage;
