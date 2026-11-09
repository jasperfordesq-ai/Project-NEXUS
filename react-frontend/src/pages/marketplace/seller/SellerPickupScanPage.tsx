// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SellerPickupScanPage — AG45 click-and-collect: seller scans/enters a buyer's QR code.
 *
 * Manual entry by default. Camera scanning is optional via html5-qrcode (not bundled).
 */

import { useState } from 'react';import QrCode from 'lucide-react/icons/qr-code';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageMeta } from '@/components/seo/PageMeta';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';

interface ScanResult {
  id: number;
  order_id: number;
  listing_id: number;
  status: string;
  picked_up_at: string | null;
}

export function SellerPickupScanPage() {
  const { t } = useTranslation('common');
  usePageTitle(t('marketplace.pickup.scan_title'));
  const toast = useToast();

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [last, setLast] = useState<ScanResult | null>(null);

  const handleSubmit = async () => {
    if (!code.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.post<ScanResult>('/v2/marketplace/seller/pickup-scan', {
        qr_code: code.trim(),
      });
      if (res.success && res.data) {
        setLast(res.data);
        setCode('');
        toast.success(t('marketplace.pickup.scan_success'));
      } else {
        toast.error(res.error || t('marketplace.pickup.scan_failed'));
      }
    } catch (err) {
      logError('SellerPickupScanPage: scan failed', err);
      toast.error(t('marketplace.pickup.scan_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageMeta title={t('marketplace.pickup.scan_title')} noIndex />
      <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <PublicPageHero
        size="compact"
        title={t('marketplace.pickup.scan_title')}
        description={t('marketplace.pickup.scan_subtitle')}
        icon={<QrCode className="h-6 w-6" aria-hidden="true" />}
        accent="indigo"
      />

      <GlassCard className="p-6 space-y-4">
        <Input
          label={t('marketplace.pickup.qr_code')}
          value={code}
          onValueChange={setCode}
          placeholder="01HXXXXXXXXXXXXXXXXXXXXXXX"
          autoFocus
        />
        <Button

          fullWidth
          onPress={handleSubmit}
          isLoading={submitting}
          isDisabled={!code.trim()}
          startContent={<CheckCircle2 className="w-4 h-4" />}
        >
          {t('marketplace.pickup.confirm_pickup')}
        </Button>
      </GlassCard>

      {last && (
        <GlassCard className="p-4 border-l-4 border-success">
          <p className="font-semibold text-success">
            {t('marketplace.pickup.last_scan')}
          </p>
          <p className="text-sm text-foreground mt-1">
            {t('marketplace.pickup.order_n', { id: last.order_id })} —{' '}
            {t('marketplace.pickup.status_picked_up')}
          </p>
        </GlassCard>
      )}
      </div>
    </>
  );
}

export default SellerPickupScanPage;
