// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AG44 — Public application status page.
 *
 * GET /api/v2/provisioning-requests/status/{token}
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from '@/lib/motion';
import { Chip } from '@/components/ui/Chip';
import Building from 'lucide-react/icons/building';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { PageMeta } from '@/components/seo/PageMeta';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

interface StatusInfo {
  org_name: string;
  requested_slug: string;
  status: string;
  provisioned_tenant_id: number | null;
  created_at: string | null;
  reviewed_at: string | null;
}

const STATUS_COLORS: Record<string, 'default' | 'accent' | 'success' | 'warning' | 'danger'> = {
  pending: 'default',
  under_review: 'accent',
  approved: 'accent',
  provisioned: 'success',
  rejected: 'danger',
  failed: 'warning',
};

export function PilotApplyStatusPage() {
  const { t } = useTranslation('common');
  const { token } = useParams<{ token: string }>();
  const { tenantPath } = useTenant();
  usePageTitle(t('provisioning.status_title'));

  const [info, setInfo] = useState<StatusInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/v2/provisioning-requests/status/${encodeURIComponent(token)}`);
        const data = (res && typeof res === 'object' && 'data' in res ? (res as { data: unknown }).data : res) as
          | StatusInfo
          | undefined;
        if (cancelled) return;
        if (data && typeof data === 'object' && 'status' in data) {
          setInfo(data);
        } else {
          setError(t('provisioning.status_lookup_failed'));
        }
      } catch (err) {
        logError('PilotApplyStatusPage lookup failed', err);
        if (!cancelled) setError(t('provisioning.status_lookup_failed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, t]);

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-12">
      {/* Opened from a private link: never index (2026-10-23). */}
      <PageMeta title={t('provisioning.status_title')} description={t('provisioning.meta.description')} noIndex />
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard className="p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-accent/10">
              <Building className="w-5 h-5 text-accent" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-semibold text-theme-primary">{t('provisioning.status_title')}</h1>
          </div>

          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-8"><Spinner /></div>
          ) : error ? (
            <p className="text-theme-muted text-sm">{error}</p>
          ) : info ? (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-theme-subtle">
                  {t('provisioning.fields.org_name')}
                </p>
                <p className="text-theme-primary font-medium">{info.org_name}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-theme-subtle">
                  {t('provisioning.fields.requested_slug')}
                </p>
                <p className="text-theme-primary">{info.requested_slug}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-theme-subtle mb-1">{t('provisioning.status_title')}</p>
                <Chip color={STATUS_COLORS[info.status] ?? 'default'} variant="tertiary" size="sm">
                  {t(`provisioning.status_labels.${info.status}`)}
                </Chip>
              </div>
              <p className="text-theme-muted text-sm pt-2">{t('provisioning.status_check_email')}</p>
            </div>
          ) : (
            <p className="text-theme-muted text-sm">{t('provisioning.status_check_email')}</p>
          )}

          <div className="mt-6">
            <Button as={Link} to={tenantPath('/')}
              variant="tertiary"
              className="bg-theme-elevated text-theme-muted"
              startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
            >
              {t('provisioning.success_back')}
            </Button>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}

export default PilotApplyStatusPage;
