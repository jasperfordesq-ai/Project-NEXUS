// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Copy from 'lucide-react/icons/copy';
import Printer from 'lucide-react/icons/printer';
import QrCode from 'lucide-react/icons/qr-code';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import ShieldCheck from 'lucide-react/icons/shield-check';
import QRCode from 'qrcode';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/contexts/ToastContext';
import {
  eventOfflineCheckinApi,
  type EventCheckinCredential,
} from '@/lib/event-offline-checkin-api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

function mutationKey(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

export function EventCheckinCredentialCard({ eventId }: { eventId: number }) {
  const { t } = useTranslation('event_offline_checkin');
  const toast = useToast();
  const confirm = useConfirm();
  const [credential, setCredential] = useState<EventCheckinCredential | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await eventOfflineCheckinApi.myCredential(eventId);
      if (!response.success || !response.data) {
        setLoadError(true);
        return;
      }
      setCredential(response.data.credential);
    } catch (error) {
      logError('Failed to load private Event check-in credential metadata', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    if (!token) {
      setQrDataUrl(null);
      return () => { active = false; };
    }
    QRCode.toDataURL(token, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
    }).then((value) => {
      if (active) setQrDataUrl(value);
    }).catch((error) => {
      logError('Failed to render private Event check-in QR code', error);
      if (active) setQrDataUrl(null);
    });
    return () => { active = false; };
  }, [token]);
  const applyResponse = (next: EventCheckinCredential | null) => {
    setCredential(next);
    setToken(next?.token ?? null);
  };

  const issue = async () => {
    setBusy(true);
    try {
      const response = await eventOfflineCheckinApi.issueCredential(
        eventId,
        null,
        mutationKey('event-checkin-code'),
      );
      if (!response.success || !response.data?.credential) throw new Error(response.code ?? 'issue_failed');
      applyResponse(response.data.credential);
    } catch (error) {
      logError('Failed to issue private Event check-in credential', error);
      toast.error(t('credential.unavailable'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!credential) return;
    const accepted = await confirm({
      title: t('credential.rotate_title'),
      body: t('credential.rotate_description'),
      confirmLabel: t('credential.rotate'),
      status: 'warning',
    });
    if (!accepted) return;
    setBusy(true);
    try {
      const response = await eventOfflineCheckinApi.rotateCredential(
        eventId,
        credential.id,
        credential.version,
        mutationKey('event-checkin-code-rotate'),
      );
      if (!response.success || !response.data?.credential) throw new Error(response.code ?? 'rotate_failed');
      applyResponse(response.data.credential);
      setReason('');
    } catch (error) {
      logError('Failed to rotate private Event check-in credential', error);
      toast.error(t('credential.unavailable'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!credential) return;
    if (!reason.trim()) {
      toast.warning(t('credential.reason_required'));
      return;
    }
    const accepted = await confirm({
      title: t('credential.revoke_title'),
      body: t('credential.revoke_description'),
      confirmLabel: t('credential.revoke'),
      status: 'danger',
    });
    if (!accepted) return;
    setBusy(true);
    try {
      const response = await eventOfflineCheckinApi.revokeCredential(
        eventId,
        credential.id,
        credential.version,
        reason.trim(),
      );
      if (!response.success || !response.data?.credential) throw new Error(response.code ?? 'revoke_failed');
      applyResponse(response.data.credential);
      setReason('');
      toast.success(t('credential.revoked'));
    } catch (error) {
      logError('Failed to revoke private Event check-in credential', error);
      toast.error(t('credential.unavailable'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-32 items-center justify-center"><Spinner label={t('credential.loading')} /></div>;
  }

  return (
    <Card className="border border-theme-default bg-theme-surface">
      <CardBody className="space-y-4 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-accent" aria-hidden="true" />
          <div>
            <h2 className="font-semibold text-theme-primary">{t('credential.title')}</h2>
            <p className="text-sm text-theme-muted">{t('credential.description')}</p>
          </div>
        </div>
        <Alert color="primary" title={t('credential.privacy')} />
        {loadError && <Alert color="warning" title={t('credential.load_error')} />}

        {!credential || credential.status !== 'active' ? (
          <Button color="primary" startContent={<QrCode className="h-4 w-4" aria-hidden="true" />} isLoading={busy} isDisabled={busy} onPress={() => void issue()}>
            {t('credential.issue')}
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip size="sm" color="success">{t(`credential.status.${credential.status}`)}</Chip>
              {credential.expires_at && (
                <span className="text-xs text-theme-muted">
                  {t('credential.expires', {
                    date: new Intl.DateTimeFormat(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' })
                      .format(new Date(credential.expires_at)),
                  })}
                </span>
              )}
            </div>
            {token ? (
              <div className="space-y-3 rounded-xl border border-theme-default p-4 text-center print:border-0">
                {qrDataUrl
                  ? <img className="mx-auto h-64 w-64" src={qrDataUrl} alt={t('credential.qr_alt')} />
                  : <Spinner label={t('credential.loading')} />}
                <p className="break-all font-mono text-xs text-theme-muted print:text-black">{token}</p>
                <p className="text-xs text-theme-muted">{t('credential.one_shot')}</p>
                <div className="flex flex-wrap justify-center gap-2 print:hidden">
                  <Button size="sm" variant="outline" startContent={<Copy className="h-4 w-4" aria-hidden="true" />} onPress={() => void navigator.clipboard.writeText(token).then(() => toast.success(t('credential.copied')))}>{t('credential.copy')}</Button>
                  <Button size="sm" variant="outline" startContent={<Printer className="h-4 w-4" aria-hidden="true" />} onPress={() => window.print()}>{t('credential.print')}</Button>
                </div>
              </div>
            ) : (
              <Alert color="warning" title={t('credential.one_shot')} />
            )}
            <Textarea label={t('credential.reason')} description={t('credential.reason_hint')} value={reason} onValueChange={setReason} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" startContent={<RotateCcw className="h-4 w-4" aria-hidden="true" />} isDisabled={busy} onPress={() => void rotate()}>{t('credential.rotate')}</Button>
              <Button color="danger" variant="outline" isDisabled={busy} onPress={() => void revoke()}>{t('credential.revoke')}</Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
