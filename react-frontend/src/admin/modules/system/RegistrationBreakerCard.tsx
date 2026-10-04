import { Card, CardBody, CardHeader, Button, Chip, Spinner } from '@/components/ui';
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ShieldCheck from 'lucide-react/icons/shield-check';
import PlayCircle from 'lucide-react/icons/play-circle';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { api } from '@/lib/api';
import { useToast } from '@/contexts';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * RegistrationBreakerCard
 *
 * Tenant-level circuit-breaker status for new-account registration. Wraps
 * the two admin endpoints added alongside the breaker:
 *   GET  /api/v2/admin/registration/breaker         — current status
 *   POST /api/v2/admin/registration/resume-signups  — manual clear
 *
 * Rendered as the first card on the Registration Policy Settings page so
 * that during a signup-flood incident, the admin sees the status front-and-
 * centre and can resume signups in one click. Polls every 30s so the
 * "paused" state surfaces without a manual reload.
 *
 * Additive: never touches existing components. Safe to ship.
 */


interface BreakerStatus {
  tripped: boolean;
  count_in_current_hour: number;
  threshold: number;
  auto_resume_in_seconds: number | null;
}

export function RegistrationBreakerCard() {
  const { t } = useTranslation('admin_system');
  const toast = useToast();
  const [status, setStatus] = useState<BreakerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [resuming, setResuming] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get<BreakerStatus>('/v2/admin/registration/breaker');
      if (res.success && res.data) {
        setStatus(res.data);
      }
    } catch {
      // Silent — surfaces as stale data, not a toast. The page works without this card.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 30_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const handleResume = useCallback(async () => {
    setResuming(true);
    try {
      const res = await api.post('/v2/admin/registration/resume-signups', {});
      if (res.success) {
        toast.success(t('system.registration_breaker.resume_success'));
        await fetchStatus();
      } else {
        toast.error(t('system.registration_breaker.resume_failed'));
      }
    } finally {
      setResuming(false);
    }
  }, [t, toast, fetchStatus]);

  if (loading) {
    return (
      <Card >
        <CardBody role="status" aria-busy="true" aria-label={t('common.loading')} className="flex items-center justify-center py-6">
          <Spinner size="sm" />
        </CardBody>
      </Card>
    );
  }

  if (!status) {
    return null;
  }

  const tripped = status.tripped;
  const pctOfThreshold =
    status.threshold > 0
      ? Math.min(100, Math.round((status.count_in_current_hour / status.threshold) * 100))
      : 0;

  return (
    <Card  className={tripped ? 'border-2 border-danger' : ''}>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            {tripped ? (
              <ShieldAlert size={20} className="text-danger" />
            ) : (
              <ShieldCheck size={20} className="text-success" />
            )}
            <div>
              <h3 className="text-lg font-semibold">{t('system.registration_breaker.title')}</h3>
              <p className="text-sm text-muted mt-1">
                {t('system.registration_breaker.description')}
              </p>
            </div>
          </div>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={fetchStatus}
            aria-label={t('system.registration_breaker.refresh_status')}
          >
            <RefreshCw size={16} />
          </Button>
        </div>
      </CardHeader>
      <CardBody className="gap-3">
        <div className="flex items-center gap-3">
          <Chip
            color={tripped ? 'danger' : 'success'}
            variant="soft"
            startContent={tripped ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
          >
            {tripped ? t('system.registration_breaker.status_paused') : t('system.registration_breaker.status_active')}
          </Chip>
          <span className="text-sm text-muted">
            {t('system.registration_breaker.signups_this_hour', {
              count: status.count_in_current_hour,
              threshold: status.threshold,
            })}
            {pctOfThreshold >= 50 && !tripped && (
              <span className="text-warning ml-2">
                {t('system.registration_breaker.threshold_percent', { percent: pctOfThreshold })}
              </span>
            )}
          </span>
        </div>

        {tripped && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm">
            <p className="font-medium text-danger">{t('system.registration_breaker.paused_title')}</p>
            <p className="text-foreground mt-1">
              {t('system.registration_breaker.paused_body', {
                threshold: status.threshold,
                minutes: Math.ceil((status.auto_resume_in_seconds ?? 3600) / 60),
              })}
            </p>
            <Button
              variant="primary"
              size="sm"
              className="mt-3"
              startContent={<PlayCircle size={16} />}
              onPress={handleResume}
              isLoading={resuming}
            >
              {t('system.registration_breaker.resume_now')}
            </Button>
          </div>
        )}

        {!tripped && (
          <p className="text-xs text-muted">
            {t('system.registration_breaker.threshold_prefix')}{' '}
            <code className="font-mono">REGISTRATION_TENANT_HOURLY_CAP</code>.
            {' '}{t('system.registration_breaker.threshold_suffix')}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export default RegistrationBreakerCard;
