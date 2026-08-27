// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * My membership pass — the QR a member shows at a partner venue.
 *
 * The QR encodes a frontend URL, so venue staff scan it with any phone camera
 * and land on VenueVisitVerifyPage to confirm. Nothing is recorded by showing
 * the pass; recording is always an authorised staff action.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Chip } from '@/components/ui/Chip';
import { QrCodeImage } from '@/components/volunteering/QrCodeImage';
import Store from 'lucide-react/icons/store';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { useAuth, useTenant, useToast } from '@/contexts';
import { partnerVenuesApi, type MemberPass, type MyVisit } from '@/lib/partner-venues-api';
import { resolveUserDisplayName } from '@/lib/helpers';

export default function MyPassPage() {
  const { t } = useTranslation('venues');
  usePageTitle(t('pass.title'));

  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [pass, setPass] = useState<MemberPass | null>(null);
  const [visits, setVisits] = useState<MyVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [passRes, visitsRes] = await Promise.all([
      partnerVenuesApi.pass(),
      partnerVenuesApi.myVisits(),
    ]);

    if (passRes.success && passRes.data) {
      setPass(passRes.data);
    }
    if (visitsRes.success && visitsRes.data) {
      setVisits(visitsRes.data.visits ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRotate() {
    setRotating(true);
    const res = await partnerVenuesApi.rotatePass();
    if (res.success && res.data) {
      setPass(res.data);
      toast.success(t('pass.rotated'));
    } else {
      toast.error(res.error || t('pass.rotate_failed'));
    }
    setRotating(false);
  }

  const memberName = resolveUserDisplayName(user);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <PageMeta title={t('pass.title')} noIndex />

      <div>
        <h1 className="text-2xl font-semibold">{t('pass.title')}</h1>
        <p className="text-theme-muted mt-1">{t('pass.intro')}</p>
      </div>

      <Card className="p-8 text-center space-y-4">
        {loading ? (
          <div className="py-8">
            <Spinner className="mx-auto" aria-label={t('loading')} />
          </div>
        ) : pass ? (
          <>
            <QrCodeImage
              value={pass.qr_url}
              alt={t('pass.qr_alt')}
              size={220}
              className="mx-auto rounded-lg bg-white p-2"
            />
            {memberName && <p className="text-lg font-medium">{memberName}</p>}
            <Chip color="success" variant="secondary">{t('pass.active')}</Chip>
            <p className="text-sm text-theme-muted">{t('pass.show_to_staff')}</p>

            <Button
              variant="secondary"
              className="mx-auto"
              onPress={handleRotate}
              isDisabled={rotating}
            >
              <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
              {rotating ? t('loading') : t('pass.rotate')}
            </Button>
            <p className="text-xs text-theme-muted">{t('pass.rotate_hint')}</p>
          </>
        ) : (
          <p className="text-theme-muted">{t('pass.unavailable')}</p>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{t('pass.recent_visits')}</h2>
          <Link
            to={tenantPath('/venues')}
            className="text-sm text-[var(--color-primary)] underline"
          >
            {t('pass.browse_venues')}
          </Link>
        </div>

        {visits.length === 0 ? (
          <div className="text-center py-6 space-y-2">
            <Store className="w-8 h-8 text-theme-muted mx-auto" aria-hidden="true" />
            <p className="text-theme-muted">{t('pass.no_visits')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {visits.map((visit) => (
              <li key={visit.id} className="py-3 flex items-center justify-between gap-4">
                <span className="font-medium">{visit.venue_name}</span>
                <span className="text-sm text-theme-muted">{visit.visited_on}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
