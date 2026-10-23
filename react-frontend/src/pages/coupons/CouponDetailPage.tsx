// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CouponDetailPage — AG63 detail view: copy online code or generate QR for in-store use.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CardBody, Card, Button, Chip, Spinner, Modal, ModalContent, ModalHeader, ModalBody } from '@/components/ui';

import Tag from 'lucide-react/icons/tag';
import Copy from 'lucide-react/icons/copy';
import QrCode from 'lucide-react/icons/qr-code';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { isNotFoundResponse } from '@/lib/not-found';
import { useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta, PrerenderStatusCode } from '@/components/seo';
import { QrCodeImage } from '@/components/volunteering/QrCodeImage';
import { logError } from '@/lib/logger';

interface CouponDetail {
  id: number;
  code: string;
  title: string;
  description: string | null;
  discount_type: 'percent' | 'fixed' | 'bogo';
  discount_value: number;
  min_order_cents: number | null;
  valid_until: string | null;
  status: string;
}

interface QrPayload {
  token: string;
  expires_at: string;
  coupon_code: string;
}

export default function CouponDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('common');
  const { tenantPath } = useTenant();
  const toast = useToast();
  usePageTitle(t('coupon.details'));

  const [coupon, setCoupon] = useState<CouponDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // The server said the coupon does not exist (not merely that loading failed).
  const [missing, setMissing] = useState(false);
  const [qr, setQr] = useState<QrPayload | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<CouponDetail>(`/v2/coupons/${id}`);
        if (cancelled) return;
        if (res.data) setCoupon(res.data);
        else setMissing(isNotFoundResponse(res));
      } catch (err) {
        logError('CouponDetailPage.load', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleCopy = () => {
    if (!coupon) return;
    navigator.clipboard.writeText(coupon.code).then(() => {
      toast.success(t('coupon.code_copied'));
    });
  };

  const handleGenerateQr = async () => {
    if (!id) return;
    setQrLoading(true);
    try {
      const res = await api.post<QrPayload>(`/v2/coupons/${id}/qr`, {});
      if (res.data) {
        setQr(res.data);
        setQrOpen(true);
      }
    } catch (err) {
      logError('CouponDetailPage.qr', err);
      toast.error(t('errors.unexpected'));
    } finally {
      setQrLoading(false);
    }
  };

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
        <PageMeta title={t('coupon.details')} noIndex />
        <Spinner />
      </div>
    );
  }

  if (!coupon) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <PageMeta title={t('coupon.details')} noIndex />
        {/* Only a confirmed missing coupon answers crawlers 404; a failed load does not. */}
        {missing && <PrerenderStatusCode code={404} />}
        <Button as={Link} to={tenantPath('/coupons')} variant="light" startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}>
          {t('coupon.back_to_coupons')}
        </Button>
      </div>
    );
  }

  const formatDiscount = (): string => {
    if (coupon.discount_type === 'percent') return `${coupon.discount_value}${t('coupon.type_percent')}`;
    if (coupon.discount_type === 'fixed') return `€${(coupon.discount_value / 100).toFixed(2)} ${t('coupon.type_fixed')}`;
    return t('coupon.type_bogo');
  };

  const couponMetaDescription = (
    coupon.description ||
    t('coupon.detail_meta_description_named', { title: coupon.title, code: coupon.code })
  ).replace(/\s+/g, ' ').trim().slice(0, 160);

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <PageMeta
        title={coupon.title}
        description={couponMetaDescription}
        type="article"
      />
      <Button
        as={Link}
        to={tenantPath('/coupons')}
        variant="light"
        startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
        className="mb-4"
      >
        {t('coupon.back_to_coupons')}
      </Button>

      <Card>
        <CardBody className="p-6">
          <div className="flex items-start justify-between mb-4">
            <Tag className="w-10 h-10 text-accent" aria-hidden="true" />
            <Chip color="success" variant="flat" size="lg">
              {formatDiscount()}
            </Chip>
          </div>
          <h1 className="text-2xl font-bold mb-2">{coupon.title}</h1>
          {coupon.description && (
            <p className="text-[var(--color-text-secondary)] mb-4">{coupon.description}</p>
          )}

          <div className="bg-[var(--color-surface-elevated)] rounded p-4 mb-4">
            <div className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)] mb-1">
              {t('coupon.code')}
            </div>
            <div className="text-2xl font-mono font-bold">{coupon.code}</div>
          </div>

          {coupon.valid_until && (
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              {t('coupon.valid_until')}: {new Date(coupon.valid_until).toLocaleDateString(getFormattingLocale())}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              color="primary"
              startContent={<Copy className="w-4 h-4" aria-hidden="true" />}
              onPress={handleCopy}
              className="flex-1"
            >
              {t('coupon.use_online')}
            </Button>
            <Button
              color="secondary"
              startContent={<QrCode className="w-4 h-4" aria-hidden="true" />}
              onPress={handleGenerateQr}
              isLoading={qrLoading}
              className="flex-1"
            >
              {t('coupon.redeem_in_store')}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Modal isOpen={qrOpen} onOpenChange={setQrOpen} size="md">
        <ModalContent>
          <ModalHeader>{t('coupon.show_qr')}</ModalHeader>
          <ModalBody className="text-center pb-6">
            {qr && (
              <QrCodeImage
                value={qr.token}
                alt={t('coupon.qr_code_alt')}
                size={300}
                className="mx-auto mb-4 max-w-full"
                fallbackToLink={false}
              />
            )}
            <p className="text-sm text-[var(--color-text-secondary)] mb-2">
              {t('coupon.scan_at_checkout')}
            </p>
            {qr && (
              <p className="text-xs text-[var(--color-text-secondary)]">
                {t('coupon.qr_expires_in')}: {new Date(qr.expires_at).toLocaleTimeString(getFormattingLocale())}
              </p>
            )}
            <div className="text-xs font-mono mt-3 break-all">{qr?.token}</div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
