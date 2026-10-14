// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Camera from 'lucide-react/icons/camera';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import KeyRound from 'lucide-react/icons/key-round';
import QrCode from 'lucide-react/icons/qr-code';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Smartphone from 'lucide-react/icons/smartphone';
import Trash2 from 'lucide-react/icons/trash-2';
import WifiOff from 'lucide-react/icons/wifi-off';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/contexts/ToastContext';
import {
  eventOfflineCheckinApi,
  type OfflineCheckinConflicts,
  type OfflineCheckinWorkspace,
  type OfflineOperation,
} from '@/lib/event-offline-checkin-api';
import {
  activateOfflineCheckinSession,
  enqueueOfflineCredential,
  loadOfflineCheckinSession,
  offlineCheckinExplanation,
  offlineDecisionMessage,
  OfflineCheckinRequestError,
  parseCheckinTimestamp,
  purgeOfflineCheckinSession,
  refreshOfflineCheckinManifest,
  removeSyncedOfflineCheckinItems,
  synchronizeOfflineCheckin,
  type OfflineCheckinSession,
} from '@/lib/event-offline-checkin-store';
import { explainedApiError } from '@/lib/explained-api-error';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { EventCheckInGuide } from './EventCheckInGuide';
import { EventCheckInWorkspace } from './EventCheckInWorkspace';

interface BarcodeDetection {
  rawValue?: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<BarcodeDetection[]>;
}

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

function mutationKey(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : 'generic';
}

function localDate(value: string): string {
  const date = parseCheckinTimestamp(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

export interface EventOfflineCheckinWorkspaceProps {
  eventId: number;
  eventStart?: string | null;
  eventEnd?: string | null;
}

/**
 * The organiser's Manage → Check-in tab. Order of importance (E-105):
 * 1. check in by name (always works online), 2. scan an attendee's check-in
 * code, 3. offline mode — clearly marked as only needed without internet.
 */
export function EventOfflineCheckinWorkspace({ eventId, eventStart = null, eventEnd = null }: EventOfflineCheckinWorkspaceProps) {
  const { t } = useTranslation(['event_offline_checkin', 'events']);
  const toast = useToast();
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;
  const confirm = useConfirm();
  const [workspace, setWorkspace] = useState<OfflineCheckinWorkspace | null>(null);
  const [session, setSession] = useState<OfflineCheckinSession | null>(null);
  const [conflicts, setConflicts] = useState<OfflineCheckinConflicts | null>(null);
  const [isConflictsLoading, setIsConflictsLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [deviceReason, setDeviceReason] = useState('');
  const [credential, setCredential] = useState('');
  const [operation, setOperation] = useState<OfflineOperation>('check_in');
  const [correctionReason, setCorrectionReason] = useState('');
  const [resolutionReasons, setResolutionReasons] = useState<Record<number, string>>({});
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [rosterReloadToken, setRosterReloadToken] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const attendanceStateLabel = useCallback((state: string): string => t(
    `events:manage.people.states.attendance.${state}`,
    { defaultValue: state },
  ), [t]);

  const loadConflicts = useCallback(async (page = 1) => {
    setIsConflictsLoading(true);
    try {
      const response = await eventOfflineCheckinApi.conflicts(eventId, page);
      if (response.success && response.data) {
        setConflicts(response.data);
      } else {
        toastRef.current.error(tRef.current('conflicts.load_error'));
      }
    } catch (error) {
      logError('Failed to load Event offline check-in conflicts', error);
      toastRef.current.error(tRef.current('conflicts.load_error'));
    } finally {
      setIsConflictsLoading(false);
    }
  }, [eventId]);

  const restoreSession = useCallback(async (next: OfflineCheckinWorkspace) => {
    let restored: OfflineCheckinSession | null = null;
    for (const device of next.devices) {
      if (device.status !== 'active') {
        await purgeOfflineCheckinSession(eventId, device.id).catch(() => undefined);
        continue;
      }
      try {
        restored = await loadOfflineCheckinSession(eventId, device.id);
      } catch {
        restored = null;
      }
      if (restored) break;
    }
    if (restored && restored.manifest.manifest_version !== next.manifest_version && isOnline()) {
      const manifest = await eventOfflineCheckinApi.manifest(eventId, restored.deviceSecret);
      if (manifest.success && manifest.data) {
        restored = await refreshOfflineCheckinManifest(restored, manifest.data);
      }
    }
    setSession(restored);
  }, [eventId]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await eventOfflineCheckinApi.workspace(eventId);
      if (!response.success || !response.data) {
        setLoadError(true);
        return;
      }
      setWorkspace(response.data);
      await restoreSession(response.data);
      await loadConflicts();
    } catch (error) {
      logError('Failed to load private Event offline check-in workspace', error);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [eventId, loadConflicts, restoreSession]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!cameraActive) return undefined;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let activeVideo: HTMLVideoElement | null = null;
    let frame = 0;
    const Detector = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
      .BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setCameraUnavailable(true);
      setCameraActive(false);
      return undefined;
    }
    const detector = new Detector({ formats: ['qr_code'] });
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const video = videoRef.current;
        if (!video || cancelled) return;
        activeVideo = video;
        video.srcObject = stream;
        await video.play();
        const detect = async () => {
          if (cancelled) return;
          try {
            const result = await detector.detect(video);
            const value = result[0]?.rawValue?.trim();
            if (value) {
              setCredential(value);
              setCameraActive(false);
              return;
            }
          } catch {
            // A transient unreadable frame is expected; manual entry stays available.
          }
          frame = window.requestAnimationFrame(() => void detect());
        };
        void detect();
      } catch (error) {
        logError('Event check-in camera unavailable', error);
        setCameraUnavailable(true);
        setCameraActive(false);
      }
    };
    void start();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      if (activeVideo) activeVideo.srcObject = null;
    };
  }, [cameraActive]);

  const activate = async (secret: string) => {
    const response = await eventOfflineCheckinApi.manifest(eventId, secret);
    if (!response.success || !response.data) {
      throw new OfflineCheckinRequestError(response.code ?? 'generic', explainedApiError(response));
    }
    const next = await activateOfflineCheckinSession(secret, response.data);
    setSession(next);
    toast.success(t('workspace.offline_ready'));
  };

  const registerDevice = async () => {
    if (!deviceLabel.trim()) return;
    setIsBusy(true);
    try {
      const response = await eventOfflineCheckinApi.registerDevice(
        eventId,
        deviceLabel.trim(),
        null,
        mutationKey('offline-device'),
      );
      const secret = response.data?.device.secret;
      if (!response.success || !response.data || !secret) {
        throw new OfflineCheckinRequestError(response.code ?? 'generic', explainedApiError(response));
      }
      await activate(secret);
      setDeviceLabel('');
      await load();
    } catch (error) {
      logError('Failed to authorize Event check-in device', error);
      toast.error(offlineCheckinExplanation(error) ?? t('errors.generic'));
    } finally {
      setIsBusy(false);
    }
  };

  const rotateDevice = async (device: OfflineCheckinWorkspace['devices'][number]) => {
    if (session?.deviceId === device.id && session.queue.some((item) => item.state === 'pending')) {
      toast.warning(t('device.unsynced_rotate_blocked'));
      return;
    }
    const accepted = await confirm({
      title: t('device.rotate_title'),
      body: t('device.rotate_description'),
      confirmLabel: t('device.rotate'),
      cancelLabel: t('device.keep_device'),
      status: 'warning',
    });
    if (!accepted) return;
    setIsBusy(true);
    try {
      const response = await eventOfflineCheckinApi.rotateDevice(
        eventId,
        device.id,
        device.version,
        mutationKey('offline-device-rotate'),
      );
      const secret = response.data?.device.secret;
      if (!response.success || !secret) throw new Error(response.code ?? 'generic');
      await purgeOfflineCheckinSession(eventId, device.id);
      await activate(secret);
      await load();
    } catch (error) {
      logError('Failed to rotate Event check-in device', error);
      toast.error(t('errors.generic'));
    } finally {
      setIsBusy(false);
    }
  };

  const revokeDevice = async (device: OfflineCheckinWorkspace['devices'][number]) => {
    if (!deviceReason.trim()) {
      toast.warning(t('device.reason_required'));
      return;
    }
    const accepted = await confirm({
      title: t('device.lost_title'),
      body: t('device.lost_description'),
      confirmLabel: t('device.confirm_revoke'),
      cancelLabel: t('device.keep_device'),
      status: 'danger',
    });
    if (!accepted) return;
    setIsBusy(true);
    try {
      const response = await eventOfflineCheckinApi.revokeDevice(
        eventId,
        device.id,
        device.version,
        deviceReason.trim(),
        mutationKey('offline-device-revoke'),
      );
      if (!response.success) throw new Error(response.code ?? 'generic');
      await purgeOfflineCheckinSession(eventId, device.id);
      if (session?.deviceId === device.id) setSession(null);
      setDeviceReason('');
      toast.success(t('device.revoke_success'));
      await load();
    } catch (error) {
      logError('Failed to revoke Event check-in device', error);
      toast.error(t('errors.generic'));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Record a scanned code. It is always saved on this device first; when the
   * browser is online it is sent to the server straight away, so a volunteer
   * on the door sees "sent" rather than a queue they must remember to sync.
   */
  const queueCredential = async () => {
    if (!session || !credential.trim()) return;
    setIsBusy(true);
    try {
      let next = await enqueueOfflineCredential(
        session,
        credential,
        operation,
        correctionReason,
      );
      const queued = next.queue[next.queue.length - 1];
      const name = queued?.displayName ?? '';
      setCredential('');
      setCorrectionReason('');
      if (!isOnline()) {
        setSession(next);
        toast.success(t('scan.saved_offline', { name }));
        return;
      }
      try {
        const result = await synchronizeOfflineCheckin(next);
        next = result.session;
        setSession(next);
        const decided = queued
          ? next.queue.find((item) => item.clientNonce === queued.clientNonce)
          : undefined;
        if (decided?.state === 'synced') {
          toast.success(t('scan.sent', { name }));
        } else if (decided?.state === 'conflict') {
          toast.warning(t('scan.needs_review', { name }));
          await loadConflicts();
        } else if (decided?.state === 'rejected') {
          const message = offlineDecisionMessage(decided.code ?? 'unknown');
          toast.error(t('scan.not_applied', { name, reason: t(message.key, message.params) }));
        } else {
          toast.success(t('scan.queued', { name }));
        }
        setRosterReloadToken((current) => current + 1);
      } catch (error) {
        setSession(next);
        const explanation = offlineCheckinExplanation(error);
        toast.warning(explanation ?? t('scan.saved_offline', { name }));
      }
    } catch (error) {
      const code = errorCode(error);
      toast.error(t(code === 'reason_required'
        ? 'scan.reason_required'
        : code === 'transition_invalid'
          ? 'scan.transition_invalid'
          : code === 'credential_verification_unavailable'
            ? 'scan.verification_unavailable'
            : code === 'credential_copied'
              ? 'scan.already_recorded'
              : code === 'queue_full'
                ? 'scan.queue_full'
                : 'scan.invalid'));
    } finally {
      setIsBusy(false);
    }
  };

  const sync = async () => {
    if (!session) return;
    setIsBusy(true);
    try {
      const result = await synchronizeOfflineCheckin(session);
      setSession(result.session);
      toast.success(result.batch ? t('queue.sync_success') : t('queue.nothing_to_sync'));
      setRosterReloadToken((current) => current + 1);
      await loadConflicts();
    } catch (error) {
      const code = errorCode(error);
      // The server's own explanation (a revoked code, an outdated roster, a
      // check-in already sent) beats a generic "could not sync".
      const explanation = offlineCheckinExplanation(error);
      if (code === 'EVENT_CHECKIN_FORBIDDEN' || code === 'device_revoked' || code === 'device_expired') {
        await purgeOfflineCheckinSession(session.eventId, session.deviceId);
        setSession(null);
        toast.error(explanation ?? t(code.includes('expired') ? 'errors.device_expired' : 'errors.device_revoked'));
      } else {
        toast.error(explanation ?? t('queue.sync_error'));
      }
    } finally {
      setIsBusy(false);
    }
  };

  const purge = async () => {
    if (!session) return;
    const accepted = await confirm({
      title: t('queue.purge_title'),
      body: t('queue.purge_description'),
      confirmLabel: t('queue.confirm_purge'),
      cancelLabel: t('queue.keep_data'),
      status: 'danger',
    });
    if (!accepted) return;
    await purgeOfflineCheckinSession(session.eventId, session.deviceId);
    setSession(null);
    toast.success(t('workspace.purged'));
  };

  const resolveConflict = async (
    item: NonNullable<OfflineCheckinConflicts>['items'][number],
    disposition: 'apply' | 'reject',
  ) => {
    const reason = resolutionReasons[item.item_id]?.trim();
    if (!reason) {
      toast.warning(t('conflicts.reason_required'));
      return;
    }
    setIsBusy(true);
    try {
      const response = await eventOfflineCheckinApi.resolveConflict(eventId, item.item_id, {
        expectedDecisionVersion: item.conflict.decision_version,
        disposition,
        expectedAttendanceVersion: item.current_attendance.version,
        reason,
      }, mutationKey('offline-conflict'));
      if (!response.success || !response.data) throw new Error(response.code ?? 'generic');
      setConflicts(response.data);
      setResolutionReasons((current) => ({ ...current, [item.item_id]: '' }));
      toast.success(t('conflicts.resolved'));
      setRosterReloadToken((current) => current + 1);
    } catch (error) {
      logError('Failed to resolve Event offline check-in conflict', error);
      toast.error(t('conflicts.resolution_error'));
      await loadConflicts();
    } finally {
      setIsBusy(false);
    }
  };

  const queueCounts = useMemo(() => session?.queue.reduce<Record<string, number>>((counts, item) => {
    counts[item.state] = (counts[item.state] ?? 0) + 1;
    return counts;
  }, {}) ?? {}, [session]);

  const guide = (
    <EventCheckInGuide
      title={t('guide.title')}
      who={t('guide.who')}
      when={t('guide.when')}
      steps={[t('guide.step_name'), t('guide.step_code'), t('guide.step_offline'), t('guide.step_undo')]}
    />
  );

  const byName = (
    <section aria-labelledby="checkin-by-name-heading" className="space-y-3">
      <div>
        <h3 id="checkin-by-name-heading" className="text-lg font-semibold text-theme-primary">{t('sections.by_name')}</h3>
        <p className="text-sm text-theme-muted">{t('sections.by_name_hint')}</p>
      </div>
      <EventCheckInWorkspace
        eventId={eventId}
        eventStart={eventStart}
        eventEnd={eventEnd}
        showGuide={false}
        reloadToken={rosterReloadToken}
      />
    </section>
  );

  if (isLoading && !workspace) {
    return <div className="flex min-h-48 items-center justify-center"><Spinner label={t('workspace.loading')} /></div>;
  }

  if (loadError || !workspace) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold text-theme-primary">{t('workspace.title')}</h2>
          <p className="mt-1 text-sm text-theme-muted">{t('workspace.description')}</p>
        </div>
        {guide}
        {byName}
        <Alert color="danger" title={t('workspace.load_error_title')} description={t('workspace.load_error_description')} />
        <Button variant="outline" onPress={() => void load()}>{t('workspace.retry')}</Button>
      </div>
    );
  }

  const online = isOnline();
  const deviceSetup = (
    <div className="space-y-3">
      <p className="text-sm text-theme-muted">{t('device.setup_what')}</p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input label={t('device.label')} description={t('device.label_hint')} value={deviceLabel} onValueChange={setDeviceLabel} />
        <Button className="self-end" color="primary" isDisabled={isBusy || !deviceLabel.trim()} isLoading={isBusy} onPress={() => void registerDevice()}>{t('device.register')}</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-theme-primary">{t('workspace.title')}</h2>
        <p className="mt-1 text-sm text-theme-muted">{t('workspace.description')}</p>
      </div>

      {guide}

      <div className="grid gap-3 md:grid-cols-2">
        <Alert
          color={online ? 'success' : 'warning'}
          icon={online ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <WifiOff className="h-5 w-5" aria-hidden="true" />}
          title={online ? t('workspace.online') : t('workspace.offline')}
          description={online ? t('workspace.online_hint') : t('workspace.offline_hint')}
        />
        <Alert color="primary" title={t('workspace.credits')} />
      </div>

      {byName}

      <section aria-labelledby="checkin-scan-heading">
        <Card className="border border-theme-default bg-theme-surface">
          <CardBody className="space-y-4 p-4 sm:p-6">
            <div className="flex items-start gap-3">
              <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <div>
                <h3 id="checkin-scan-heading" className="text-lg font-semibold text-theme-primary">{t('sections.scan')}</h3>
                <p className="text-sm text-theme-muted">{t('scan.description')}</p>
              </div>
            </div>
            {session ? (
              <>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-theme-muted">{t('workspace.list_version', { version: session.manifest.manifest_version })}</p>
                  <Button size="sm" variant="outline" startContent={<Camera className="h-4 w-4" aria-hidden="true" />} onPress={() => setCameraActive((current) => !current)}>{cameraActive ? t('scan.stop_camera') : t('scan.start_camera')}</Button>
                </div>
                {cameraUnavailable && <Alert color="warning" title={t('scan.camera_unavailable')} />}
                {cameraActive && <video ref={videoRef} className="max-h-72 w-full rounded-xl bg-black object-cover" aria-label={t('scan.camera_label')} muted playsInline />}
                <Input label={t('scan.code_label')} description={t('scan.code_hint')} value={credential} onValueChange={setCredential} autoComplete="off" spellCheck={false} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select label={t('scan.operation')} selectedKeys={new Set([operation])} onSelectionChange={(keys) => setOperation(String(Array.from(keys as Iterable<string | number>)[0] ?? 'check_in') as OfflineOperation)}>
                    {(['check_in', 'check_out', 'no_show', 'undo'] as const).map((action) => <SelectItem key={action} id={action} textValue={t(`scan.operations.${action}`)}>{t(`scan.operations.${action}`)}</SelectItem>)}
                  </Select>
                  <Textarea label={t('scan.reason')} description={t('scan.reason_hint')} value={correctionReason} onValueChange={setCorrectionReason} />
                </div>
                <Button color="primary" isDisabled={isBusy || !credential.trim()} isLoading={isBusy} onPress={() => void queueCredential()}>{t('scan.queue')}</Button>
              </>
            ) : (
              <>
                <Alert color="warning" title={t('scan.needs_setup')} />
                {deviceSetup}
              </>
            )}
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="checkin-offline-heading">
        <Card className="border border-theme-default bg-theme-surface">
          <CardBody className="space-y-5 p-4 sm:p-6">
            <div className="flex items-start gap-3">
              <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="checkin-offline-heading" className="text-lg font-semibold text-theme-primary">{t('sections.offline')}</h3>
                  <Chip size="sm" color="warning" variant="flat">{t('sections.offline_badge')}</Chip>
                </div>
                <p className="text-sm text-theme-muted">{t('sections.offline_hint')}</p>
                <p className="text-sm text-theme-muted">{session ? t('workspace.offline_ready') : t('workspace.offline_not_ready')}</p>
                {session && <p className="text-xs text-theme-muted">{t('workspace.list_expires', { date: localDate(session.manifest.expires_at) })}</p>}
              </div>
            </div>

            {session && (
              <div className="space-y-3 rounded-xl border border-theme-default p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="font-semibold text-theme-primary">{t('queue.title')}</h4>
                    <p className="text-sm text-theme-muted">{t('queue.description')}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" color="primary" startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />} isDisabled={isBusy || !session.queue.some((item) => item.state === 'pending')} isLoading={isBusy} onPress={() => void sync()}>{t('queue.sync')}</Button>
                    <Button size="sm" variant="outline" isDisabled={!queueCounts.synced} onPress={() => void removeSyncedOfflineCheckinItems(session).then(setSession)}>{t('queue.clear_synced')}</Button>
                  </div>
                </div>
                <p className="text-xs text-theme-muted">{t('queue.sync_hint')}</p>
                {session.queue.length === 0 ? <p className="text-sm text-theme-muted">{t('queue.empty')}</p> : (
                  <ul className="divide-y divide-theme-default rounded-xl border border-theme-default">
                    {session.queue.map((item) => (
                      <li key={item.clientNonce} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium text-theme-primary">{item.displayName}</p>
                          <p className="text-xs text-theme-muted">{t(`scan.operations.${item.operation}`)} · {t('queue.observed', { date: localDate(item.observedAt) })}</p>
                          {item.code && <p className="text-xs text-theme-muted">{t(offlineDecisionMessage(item.code).key, offlineDecisionMessage(item.code).params)}</p>}
                        </div>
                        <Chip size="sm" color={item.state === 'synced' ? 'success' : item.state === 'conflict' ? 'warning' : item.state === 'rejected' ? 'danger' : 'default'}>{t(`queue.states.${item.state}`)}</Chip>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="space-y-3 rounded-xl border border-theme-default p-4">
              <div className="flex items-start gap-3">
                <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <h4 className="font-semibold text-theme-primary">{t('device.title')}</h4>
                  <p className="text-sm text-theme-muted">{t('device.description')}</p>
                </div>
              </div>
              {!session && <p className="text-sm text-theme-muted">{t('device.setup_in_scan')}</p>}
              <div className="space-y-2">
                {workspace.devices.length === 0 && <p className="text-sm text-theme-muted">{t('device.empty')}</p>}
                {workspace.devices.map((device) => (
                  <div key={device.id} className="flex flex-col gap-3 rounded-xl border border-theme-default p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-theme-primary">{device.label}</span>
                        <Chip size="sm" color={device.status === 'active' ? 'success' : 'default'}>{t(`device.status.${device.status}`)}</Chip>
                        {session?.deviceId === device.id && <Chip size="sm" color="primary">{t('device.this_device')}</Chip>}
                      </div>
                      <p className="mt-1 text-xs text-theme-muted">{t('device.version', { version: device.version })} · {t('device.expires', { date: localDate(device.expires_at) })}</p>
                      {device.status === 'active' && session?.deviceId !== device.id && (
                        <p className="mt-1 text-xs text-theme-muted">{t('device.other_device')}</p>
                      )}
                    </div>
                    {device.status === 'active' && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" startContent={<KeyRound className="h-4 w-4" aria-hidden="true" />} isDisabled={isBusy} onPress={() => void rotateDevice(device)}>{t('device.rotate')}</Button>
                        <Button size="sm" color="danger" variant="outline" isDisabled={isBusy} onPress={() => void revokeDevice(device)}>{t('device.revoke')}</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {workspace.devices.some((device) => device.status === 'active') && (
                <Textarea label={t('device.reason')} description={t('device.reason_hint')} value={deviceReason} onValueChange={setDeviceReason} />
              )}
              {session && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" color="danger" variant="outline" startContent={<Trash2 className="h-4 w-4" aria-hidden="true" />} onPress={() => void purge()}>{t('queue.purge')}</Button>
                  <p className="text-xs text-theme-muted">{t('device.logout_note')}</p>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-theme-default p-4">
              <div>
                <h4 className="font-semibold text-theme-primary">{t('conflicts.title')}</h4>
                <p className="text-sm text-theme-muted">{t('conflicts.description')}</p>
              </div>
              {isConflictsLoading && !conflicts ? <Spinner label={t('conflicts.title')} /> : !conflicts ? <Button size="sm" variant="outline" onPress={() => void loadConflicts()}>{t('workspace.retry')}</Button> : conflicts.items.length === 0 ? <p className="text-sm text-theme-muted">{t('conflicts.empty')}</p> : conflicts.items.map((item) => (
                <div key={item.item_id} className="space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-theme-primary">{item.member.display_name}</p>
                      <p className="text-sm text-theme-primary">{t('conflicts.offline_action', { action: t(`scan.operations.${item.operation}`) })}</p>
                      <p className="text-sm text-theme-primary">{t('conflicts.current_state', { state: attendanceStateLabel(item.current_attendance.state) })}</p>
                      <p className="text-xs text-theme-muted">{t('conflicts.device', { label: item.device.label ?? `#${item.device.id}` })} · {t('conflicts.observed', { date: localDate(item.observed_at) })}</p>
                    </div>
                    <Chip color="warning" size="sm">{t('queue.states.conflict')}</Chip>
                  </div>
                  <Textarea label={t('conflicts.reason')} description={t('conflicts.reason_hint')} value={resolutionReasons[item.item_id] ?? ''} onValueChange={(value) => setResolutionReasons((current) => ({ ...current, [item.item_id]: value }))} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" isDisabled={isBusy} onPress={() => void resolveConflict(item, 'reject')}>{t('conflicts.reject')}</Button>
                    <Button size="sm" color="primary" isDisabled={isBusy} onPress={() => void resolveConflict(item, 'apply')}>{t('conflicts.apply')}</Button>
                  </div>
                </div>
              ))}
              {conflicts && conflicts.total > conflicts.per_page && (
                <div className="flex justify-end border-t border-theme-default pt-4">
                  <Pagination
                    page={conflicts.page}
                    total={Math.ceil(conflicts.total / conflicts.per_page)}
                    showControls
                    isDisabled={isConflictsLoading || isBusy}
                    aria-label={t('conflicts.title')}
                    onChange={(nextPage) => void loadConflicts(nextPage)}
                  />
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
