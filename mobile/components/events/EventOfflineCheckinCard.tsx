// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@/components/ui/Icon';
import { Alert, Card, Spinner, Surface } from 'heroui-native';
import { Button } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import { useTranslation } from 'react-i18next';
import Input from '@/components/ui/Input';
import TextArea from '@/components/ui/TextArea';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm, type ConfirmOptions } from '@/components/ui/useConfirm';
import AccentIcon from '@/components/ui/AccentIcon';
import ErrorState from '@/components/ui/ErrorState';
import {
  downloadOfflineCheckinManifest,
  getOfflineCheckinConflicts,
  getOfflineCheckinWorkspace,
  resolveOfflineCheckinConflict,
  revokeOfflineCheckinDevice,
  type MobileOfflineConflicts,
  type MobileOfflineWorkspace,
  type OfflineAttendanceOperation,
} from '@/lib/api/eventOfflineCheckin';
import { ApiResponseError } from '@/lib/api/client';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  getPendingOfflineRegistration,
  cacheMobileOfflineWorkspace,
  loadCachedMobileOfflineWorkspace,
  invalidateCachedMobileOfflineWorkspace,
  reserveOfflineRegistration,
  completeOfflineRegistration,
  type PendingOfflineRegistration,
  enqueueMobileOfflineCredential,
  loadMobileOfflineSessionForReview,
  purgeMobileOfflineSession,
  purgeRevokedOrExpiredMobileSessions,
  refreshMobileOfflineManifest,
  syncMobileOfflineSession,
  reconcileMobileOfflineConflicts,
  type MobileOfflineInactiveReason,
  type MobileOfflineSession,
} from '@/lib/eventOfflineCheckinStore';
import { recoverOfflineRegistration } from '@/lib/offlineRegistrationRecovery';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

const OPERATIONS: OfflineAttendanceOperation[] = ['check_in', 'check_out', 'no_show', 'undo'];

function mutationKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function EventOfflineCheckinCard({ eventId }: { eventId: number }) {
  const { t } = useTranslation(['eventOfflineCheckin', 'notifications', 'events', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm: showConfirmation, confirmDialog } = useConfirm();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [workspace, setWorkspace] = useState<MobileOfflineWorkspace | null>(null);
  const [session, setSession] = useState<MobileOfflineSession | null>(null);
  /**
   * 🔴 Set when the stored session can no longer queue or sync (roster expired, device
   * re-authorised). The store used to DELETE such a session on load, taking every
   * never-synced check-in with it and saying nothing (audit 2026-09-05, S4-19). Now it
   * stays on the device read-only: the queue is shown, the pending count is announced,
   * and only the member's explicit "Remove offline data" — after a confirmation that
   * states what will be lost — purges it.
   */
  const [sessionInactive, setSessionInactive] = useState<MobileOfflineInactiveReason | null>(null);
  const [conflicts, setConflicts] = useState<MobileOfflineConflicts | null>(null);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [pendingRegistration, setPendingRegistration] = useState<PendingOfflineRegistration | null>(null);
  const [revocationReason, setRevocationReason] = useState('');
  const [credential, setCredential] = useState('');
  const [operation, setOperation] = useState<OfflineAttendanceOperation>('check_in');
  const [reason, setReason] = useState('');
  const [resolutionReasons, setResolutionReasons] = useState<Record<number, string>>({});
  const [cameraOpen, setCameraOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [cachedMode, setCachedMode] = useState(false);
  const mountedRef = useRef(false);
  const loadVersionRef = useRef(0);
  const conflictsVersionRef = useRef(0);
  const mutationPendingRef = useRef(false);
  const mutationVersionRef = useRef(0);
  // Read through refs inside `load` so a re-created `t` or toast handle cannot re-run the
  // workspace fetch on every render (the effect below keys on `load`).
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const tRef = useRef(t);
  tRef.current = t;

  const loadConflicts = useCallback(async () => {
    if (!mountedRef.current) return;
    const version = ++conflictsVersionRef.current;
    const isCurrent = () => mountedRef.current && version === conflictsVersionRef.current;
    try {
      const next = await getOfflineCheckinConflicts(eventId);
      if (isCurrent()) setConflicts(next);
    } catch {
      if (isCurrent()) setConflicts(null);
    }
  }, [eventId]);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    const version = ++loadVersionRef.current;
    const isCurrent = () => mountedRef.current && version === loadVersionRef.current;
    setLoading(true);
    setLoadError(false);
    try {
      const [saved, fetched] = await Promise.allSettled([
        getPendingOfflineRegistration(eventId), getOfflineCheckinWorkspace(eventId),
      ]);
      if (!isCurrent()) return;
      if (saved.status === 'rejected') throw saved.reason;
      setPendingRegistration(saved.value);
      if (fetched.status === 'rejected') {
        const error = fetched.reason;
        if (error instanceof ApiResponseError && [401, 403, 404].includes(error.status)) {
          await invalidateCachedMobileOfflineWorkspace(eventId);
        }
        if (error instanceof ApiResponseError && [0, 502, 503, 504].includes(error.status)) {
          const cached = await loadCachedMobileOfflineWorkspace(eventId);
          if (!isCurrent()) return;
          if (cached.session && cached.workspace) {
            setWorkspace(cached.workspace);
            setSession(cached.session);
            setSessionInactive(cached.inactive);
            setCachedMode(true);
            setConflicts(null);
            return;
          }
        }
        throw error;
      }
      const nextWorkspace = fetched.value;
      await purgeRevokedOrExpiredMobileSessions(nextWorkspace);
      if (!isCurrent()) return;
      let restored: MobileOfflineSession | null = null;
      let inactive: MobileOfflineInactiveReason | null = null;
      for (const device of nextWorkspace.devices) {
        if (device.status !== 'active') continue;
        try {
          const review = await loadMobileOfflineSessionForReview(eventId, device.id);
          if (!isCurrent()) return;
          if (review.session) {
            restored = review.session;
            inactive = review.inactive;
            break;
          }
        } catch {
          // Unreadable ciphertext: the store has already destroyed it.
        }
        if (!isCurrent()) return;
      }
      if (restored && !inactive) {
        const manifest = await downloadOfflineCheckinManifest(eventId, restored.deviceSecret);
        if (!isCurrent()) return;
        restored = await refreshMobileOfflineManifest(restored, manifest, nextWorkspace);
      }
      if (!isCurrent()) return;
      if (restored) {
        restored = await cacheMobileOfflineWorkspace(restored, nextWorkspace);
        try {
          restored = await reconcileMobileOfflineConflicts(restored);
        } catch {
          // Keep saved evidence visible; a failed read is not a resolved decision.
          if (isCurrent()) showToastRef.current({ title: tRef.current('conflicts.error'), variant: 'warning' });
        }
      }
      if (!isCurrent()) return;
      setWorkspace(nextWorkspace);
      setSession(restored);
      setSessionInactive(inactive);
      setCachedMode(false);
      if (restored && inactive) {
        const pending = restored.queue.filter((item) => item.state === 'pending').length;
        if (pending > 0) {
          showToastRef.current({ title: tRef.current('queue.pendingKept', { count: pending }), variant: 'warning' });
        }
      }
      await loadConflicts();
    } catch {
      if (isCurrent()) setLoadError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [eventId, loadConflicts]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      loadVersionRef.current += 1;
      conflictsVersionRef.current += 1;
    };
  }, [load]);

  function confirm(options: ConfirmOptions) {
    const mutationVersion = mutationVersionRef.current;
    const loadVersion = loadVersionRef.current;
    let consumed = false;
    showConfirmation({
      ...options,
      onConfirm: async () => {
        if (consumed || !mountedRef.current || mutationVersion !== mutationVersionRef.current
          || loadVersion !== loadVersionRef.current) return;
        consumed = true;
        await options.onConfirm?.();
      },
    });
  }

  function beginMutation() {
    if (!mountedRef.current || mutationPendingRef.current || loading) return false;
    mutationPendingRef.current = true;
    mutationVersionRef.current += 1;
    conflictsVersionRef.current += 1;
    setBusy(true);
    return true;
  }

  function finishMutation() {
    mutationPendingRef.current = false;
    if (mountedRef.current) setBusy(false);
  }

  async function registerDevice(action: 'new' | 'resume' | 'reauthorize' = 'new') {
    if ((action === 'new' && (!deviceLabel.trim() || pendingRegistration)) || !beginMutation()) return;
    try {
      if (action === 'new') {
        const saved = await reserveOfflineRegistration(eventId, deviceLabel.trim());
        if (!mountedRef.current) return;
        setPendingRegistration(saved);
      }
      const result = await recoverOfflineRegistration(eventId, action === 'reauthorize' ? 'reauthorize' : 'resume', () => mountedRef.current);
      if (!mountedRef.current) return;
      setPendingRegistration(result.pending);
      if (result.session && result.workspace) {
        const cached = await cacheMobileOfflineWorkspace(result.session, result.workspace);
        if (!mountedRef.current) return;
        setWorkspace(result.workspace);
        setSession(cached);
        setCachedMode(false);
        setSessionInactive(null);
        setDeviceLabel('');
        setLoadError(false);
        showToast({ title: t('workspace.ready'), variant: 'success' });
      }
    } catch (error) {
      if (!mountedRef.current) return;
      try {
        const saved = await getPendingOfflineRegistration(eventId);
        if (!mountedRef.current) return;
        setPendingRegistration(saved);
      } catch {
        if (!mountedRef.current) return;
        setLoadError(true);
      }
      showToast({ title: t('errors.generic'), description: describeApiError(error, '') || undefined, variant: 'danger' });
    } finally {
      finishMutation();
    }
  }

  function requestRevoke(device: MobileOfflineWorkspace['devices'][number]) {
    if (!revocationReason.trim()) {
      showToast({ title: t('device.reasonRequired'), variant: 'warning' });
      return;
    }
    confirm({
      title: t('device.lostTitle'),
      message: t('device.lostDescription'),
      confirmLabel: t('device.revoke'),
      cancelLabel: t('device.keep'),
      variant: 'danger',
      onConfirm: async () => {
        if (!beginMutation()) return;
        try {
          await revokeOfflineCheckinDevice(
            eventId,
            device.id,
            device.version,
            revocationReason.trim(),
            mutationKey('mobile-offline-revoke'),
          );
          if (!mountedRef.current) return;
          await purgeMobileOfflineSession(eventId, device.id);
          if (!mountedRef.current) return;
          if (session?.deviceId === device.id) setSession(null);
          setRevocationReason('');
          showToast({ title: t('device.revoked'), variant: 'success' });
          await load();
        } catch (error) {
          if (!mountedRef.current) return;
          showToast({ title: t('errors.generic'), description: describeApiError(error, '') || undefined, variant: 'danger' });
        } finally {
          finishMutation();
        }
      },
    });
  }

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void getPermission().catch(() => {
          if (mountedRef.current) showToast({ title: t('scan.cameraUnavailable'), variant: 'warning' });
        });
      }
    });
    return () => subscription.remove();
  }, [getPermission, showToast, t]);

  async function openCamera() {
    if (!session || sessionInactive || !beginMutation()) return;
    try {
      if (!permission?.granted && permission?.canAskAgain === false) {
        await Linking.openSettings();
        return;
      }
      if (!permission?.granted) {
        const granted = await requestPermission();
        if (!mountedRef.current) return;
        if (!granted.granted) {
          showToast({ title: t('scan.cameraUnavailable'), variant: 'warning' });
          return;
        }
      }
      if (mountedRef.current) setCameraOpen(true);
    } catch {
      if (mountedRef.current) showToast({ title: t('scan.cameraUnavailable'), variant: 'warning' });
    } finally {
      finishMutation();
    }
  }

  async function enqueue() {
    if (!session || sessionInactive || !credential.trim() || !beginMutation()) return;
    try {
      const next = await enqueueMobileOfflineCredential(session, credential, operation, reason);
      if (!mountedRef.current) return;
      setSession(next);
      setCredential('');
      setReason('');
      showToast({ title: t('scan.queued'), variant: 'success' });
    } catch (error) {
      if (!mountedRef.current) return;
      const code = error instanceof Error ? error.message : 'generic';
      /*
        🔴 Every refusal the store can make used to read as "This code is invalid, copied,
        rotated, revoked, expired or belongs to another event" — so staff scanning the same
        badge twice could not tell "already queued" from "wrong event" (audit 2026-09-07,
        C/F-12). One sentence per reason.
      */
      const SCAN_MESSAGES: Record<string, string> = {
        reason_required: 'scan.reasonRequired',
        transition_invalid: 'scan.transitionInvalid',
        credential_copied: 'scan.alreadyQueued',
        credential_expired: 'scan.expired',
        credential_wrong_event: 'scan.wrongEvent',
        credential_revoked_or_rotated: 'scan.revoked',
        credential_signing_key_unknown: 'scan.signingKeyUnknown',
        queue_full: 'scan.queueFull',
        attendance_history_required: 'scan.historyRequired',
        attendance_reconciliation_required: 'scan.reconciliationRequired',
      };
      showToast({
        title: t(SCAN_MESSAGES[code] ?? 'scan.invalid'),
        variant: 'danger',
      });
    } finally {
      finishMutation();
    }
  }

  async function synchronize() {
    if (!session || (sessionInactive && !(sessionInactive === 'manifest_expired' && session.activeBatchId)) || !beginMutation()) return;
    try {
      const result = await syncMobileOfflineSession(session);
      if (!mountedRef.current) return;
      setSession(result.session);
      if (workspace && !sessionInactive && !result.session.activeBatchId) {
        const manifest = await downloadOfflineCheckinManifest(eventId, result.session.deviceSecret);
        const refreshed = await refreshMobileOfflineManifest(result.session, manifest, workspace);
        if (!mountedRef.current) return;
        setSession(refreshed);
      }
      const stopped = result.session.activeBatchStatus === 'dead_letter';
      showToast({ title: stopped ? t('queue.stoppedTitle') : result.session.activeBatchId ? t('queue.processing') : result.batch ? t('queue.synced') : t('queue.emptyPending'), variant: stopped ? 'warning' : 'success' });
      await loadConflicts();
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof ApiResponseError && error.status === 403) {
        await invalidateCachedMobileOfflineWorkspace(eventId).catch(() => undefined);
        if (!mountedRef.current) return;
        /*
          🔴 This used to purge the encrypted queue on the spot — twenty attendees scanned
          offline, gone on any 403, with a toast (audit 2026-09-07, C/F-4). A revoked device
          is the same situation as an expired manifest: the queue is kept read-only, the
          pending count stays visible, and only the confirmed "Remove offline data" button
          discards it.
        */
        setSessionInactive('device_revoked');
        showToast({ title: t('errors.revoked'), description: describeApiError(error, t('queue.syncError')), variant: 'danger' });
      } else {
        // The server's reason, not a blanket sentence (audit 2026-09-07, C/F-13).
        showToast({ title: t('queue.syncError'), description: describeApiError(error, '') || undefined, variant: 'danger' });
      }
    } finally {
      finishMutation();
    }
  }

  async function resolve(
    item: MobileOfflineConflicts['items'][number],
    disposition: 'apply' | 'reject',
  ) {
    const resolutionReason = resolutionReasons[item.item_id]?.trim();
    if (!resolutionReason) {
      showToast({ title: t('conflicts.reasonRequired'), variant: 'warning' });
      return;
    }
    if (!beginMutation()) return;
    try {
      const next = await resolveOfflineCheckinConflict(eventId, item.item_id, {
        expectedDecisionVersion: item.conflict.decision_version,
        expectedAttendanceVersion: item.current_attendance.version,
        disposition,
        reason: resolutionReason,
        idempotencyKey: mutationKey('mobile-offline-conflict'),
      });
      if (!mountedRef.current) return;
      setConflicts(next);
      setResolutionReasons((current) => ({ ...current, [item.item_id]: '' }));
      if (session) {
        let reconciled = await reconcileMobileOfflineConflicts(session);
        if (workspace && !sessionInactive) {
          const manifest = await downloadOfflineCheckinManifest(eventId, reconciled.deviceSecret);
          reconciled = await refreshMobileOfflineManifest(reconciled, manifest, workspace);
        }
        if (!mountedRef.current) return;
        setSession(reconciled);
      }
      showToast({ title: t('conflicts.resolved'), variant: 'success' });
    } catch (error) {
      if (!mountedRef.current) return;
      showToast({ title: t('conflicts.error'), description: describeApiError(error, '') || undefined, variant: 'danger' });
      await loadConflicts();
    } finally {
      finishMutation();
    }
  }

  const pendingCount = useMemo(
    () => session?.queue.filter((item) => item.state === 'pending').length ?? 0,
    [session],
  );

  const recoveryCard = pendingRegistration ? (
    <Card variant="secondary" testID="offline-registration-recovery">
      <Card.Body className="gap-3 px-4 py-4">
        <Text className="text-base font-bold" style={{ color: theme.text }}>{t('recovery.title')}</Text>
        <Text style={{ color: theme.textSecondary }}>{pendingRegistration.label}</Text>
        <Text style={{ color: theme.textSecondary }}>{t(pendingRegistration.stage === 'reauthorize' ? 'recovery.reauthorizeDescription' : 'recovery.description')}</Text>
        <Button isDisabled={busy || loading} onPress={() => void registerDevice(pendingRegistration.stage === 'reauthorize' ? 'reauthorize' : 'resume')}>
          <Button.Label>{t(pendingRegistration.stage === 'reauthorize' ? 'recovery.reauthorize' : 'recovery.resume')}</Button.Label>
        </Button>
        <Button variant="secondary" isDisabled={busy || loading} onPress={() => confirm({
          title: t('recovery.stop'), message: t('recovery.stopDescription'),
          confirmLabel: t('recovery.stop'), cancelLabel: t('device.keep'),
          onConfirm: async () => {
            if (!beginMutation()) return;
            try {
              await completeOfflineRegistration(pendingRegistration);
              if (!mountedRef.current) return;
              setPendingRegistration(null);
              setDeviceLabel('');
              await load();
            } catch (error) {
              if (mountedRef.current) showToast({ title: t('errors.generic'), description: describeApiError(error, '') || undefined, variant: 'danger' });
            } finally { finishMutation(); }
          },
        })}>
          <Button.Label>{t('recovery.stop')}</Button.Label>
        </Button>
      </Card.Body>
    </Card>
  ) : null;

  if (loading && !workspace) {
    return <Surface variant="secondary" className="items-center rounded-panel-inner p-5"><Spinner /></Surface>;
  }

  if (loadError || !workspace) {
    return (
      <View className="gap-4">
      {recoveryCard}
      <ErrorState title={t('workspace.loadErrorTitle')} subtitle={t('workspace.loadErrorDescription')}
        retryLabel={t('workspace.retry')} isRetrying={busy || loading}
        onRetry={() => { if (!mutationPendingRef.current) void load(); }} />
      {confirmDialog}
      </View>
    );
  }

  return (
    <View className="gap-4">
      {!cachedMode && recoveryCard}
      {cachedMode && (
        <Card variant="secondary" testID="offline-cached-workspace">
          <Card.Body className="gap-3 px-4 py-4">
            <Text className="text-base font-bold" style={{ color: theme.text }}>{t('workspace.cachedTitle')}</Text>
            <Text style={{ color: theme.textSecondary }}>{t('workspace.cachedDescription')}</Text>
            <Button variant="secondary" isDisabled={busy || loading} onPress={() => void load()}>
              <Button.Label>{t('workspace.retry')}</Button.Label>
            </Button>
          </Card.Body>
        </Card>
      )}
      <Card variant="default">
        <Card.Body className="gap-3 px-4 py-4">
          <View className="flex-row items-start gap-3">
            <Ionicons name="shield-checkmark-outline" size={24} color={primary} />
            <View className="min-w-0 flex-1">
              <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('workspace.title')}</Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('workspace.description')}</Text>
            </View>
          </View>
          <Alert status="accent">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t('workspace.privacyTitle')}</Alert.Title>
              <Alert.Description>{t('workspace.privacyDescription')}</Alert.Description>
            </Alert.Content>
          </Alert>
          <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('workspace.noWallet')}</Text>
        </Card.Body>
      </Card>

      {!cachedMode && <Card variant="secondary">
        <Card.Body className="gap-3 px-4 py-4">
          <Text className="text-base font-bold" style={{ color: theme.text }}>{t('device.title')}</Text>
          <Input label={t('device.label')} value={deviceLabel} onChangeText={setDeviceLabel} placeholder={t('device.labelPlaceholder')} editable={!busy && !pendingRegistration} />
          <Button variant="primary" isDisabled={busy || !!pendingRegistration || !deviceLabel.trim()} onPress={() => void registerDevice()}>
            {busy ? <Spinner size="sm" /> : <AccentIcon name="phone-portrait-outline" size={18} />}
            <Button.Label>{t('device.register')}</Button.Label>
          </Button>
          <TextArea label={t('device.reason')} value={revocationReason} onChangeText={setRevocationReason} placeholder={t('device.reasonHint')} editable={!busy} />
          {workspace.devices.length === 0 ? <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('device.empty')}</Text> : workspace.devices.map((device) => (
            <Surface key={device.id} variant="tertiary" className="gap-2 rounded-panel-inner p-3">
              <View className="flex-row items-center justify-between gap-2">
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold" style={{ color: theme.text }}>{device.label}</Text>
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('device.version', { version: device.version })}</Text>
                </View>
                <Chip size="sm" color={device.status === 'active' ? 'success' : 'default'}><Chip.Label>{t(`device.status.${device.status}`)}</Chip.Label></Chip>
              </View>
              {device.status === 'active' ? (
                <Button size="sm" variant="danger-soft" isDisabled={busy} onPress={() => requestRevoke(device)}>
                  <Button.Label>{t('device.revoke')}</Button.Label>
                </Button>
              ) : null}
            </Surface>
          ))}
        </Card.Body>
      </Card>}

      {session ? (
        <>
          {sessionInactive ? (
            <Alert status="warning" testID="event-offline-checkin-read-only">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{t('queue.readOnlyTitle')}</Alert.Title>
                <Alert.Description>
                  {t(sessionInactive === 'manifest_expired' ? 'queue.readOnlyExpired' : sessionInactive === 'device_revoked' ? 'queue.readOnlyRevoked' : 'queue.readOnlyRotated')}
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : (
          <Card variant="secondary">
            <Card.Body className="gap-3 px-4 py-4">
              <Text className="text-base font-bold" style={{ color: theme.text }}>{t('scan.title')}</Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('scan.description')}</Text>
              <Button variant="secondary" isDisabled={busy} onPress={() => void openCamera()}>
                <Ionicons name="scan-outline" size={18} color={primary} />
                <Button.Label>{!permission?.granted && permission?.canAskAgain === false ? t('notifications:permissionCard.openSettings') : t('scan.openCamera')}</Button.Label>
              </Button>
              {cameraOpen ? (
                <View className="h-72 overflow-hidden rounded-panel-inner">
                  <CameraView
                    style={{ flex: 1 }}
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={(event) => {
                      const value = event.data.trim();
                      if (!value) return;
                      setCredential(value);
                      setCameraOpen(false);
                    }}
                  />
                </View>
              ) : null}
              <Input label={t('scan.codeLabel')} value={credential} onChangeText={setCredential} placeholder={t('scan.codeHint')} autoCapitalize="none" autoCorrect={false} editable={!busy} />
              <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('scan.operation')}</Text>
              <View className="flex-row flex-wrap gap-2">
                {OPERATIONS.map((item) => (
                  <Chip key={item} size="sm" color={operation === item ? 'accent' : 'default'} variant={operation === item ? 'primary' : 'soft'} onPress={() => setOperation(item)} accessibilityRole="button" accessibilityState={{ selected: operation === item }}>
                    <Chip.Label>{t(`scan.operations.${item}`)}</Chip.Label>
                  </Chip>
                ))}
              </View>
              <TextArea label={t('scan.reason')} value={reason} onChangeText={setReason} placeholder={t('scan.reasonHint')} editable={!busy} />
              <Button variant="primary" isDisabled={busy || !credential.trim()} onPress={() => void enqueue()}>
                <Button.Label>{t('scan.queue')}</Button.Label>
              </Button>
            </Card.Body>
          </Card>
          )}

          <Card variant="secondary">
            <Card.Body className="gap-3 px-4 py-4">
              <View className="gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-bold" style={{ color: theme.text }}>{t('queue.title')}</Text>
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('queue.pending', { count: pendingCount })}</Text>
                </View>
                <Button size="sm" variant="primary" isDisabled={busy || (pendingCount === 0 && !session.activeBatchId) || (sessionInactive !== null && !(sessionInactive === 'manifest_expired' && session.activeBatchId))} onPress={() => void synchronize()}>
                  <Button.Label>{t((sessionInactive === 'manifest_expired' && session.activeBatchId) || session.activeBatchStatus === 'dead_letter' ? 'queue.checkResult' : 'queue.sync')}</Button.Label>
                </Button>
              </View>
              {session.activeBatchStatus === 'dead_letter' && (
                <Alert status="warning" testID="offline-batch-stopped">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>{t('queue.stoppedTitle')}</Alert.Title>
                    <Alert.Description>{t('queue.stoppedDescription')}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              {session.queue.length === 0 ? <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('queue.empty')}</Text> : session.queue.map((item) => (
                <Surface key={item.clientNonce} variant="tertiary" className="flex-row items-center justify-between gap-3 rounded-panel-inner p-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-semibold" style={{ color: theme.text }}>{item.displayName}</Text>
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>{t(`scan.operations.${item.operation}`)}</Text>
                  </View>
                  <Chip size="sm" color={item.state === 'synced' ? 'success' : item.state === 'conflict' ? 'warning' : item.state === 'rejected' ? 'danger' : 'default'}><Chip.Label>{t(`queue.states.${item.state}`)}</Chip.Label></Chip>
                </Surface>
              ))}
              <Button size="sm" variant="danger-soft" isDisabled={busy} testID="event-offline-checkin-purge" onPress={() => {
                confirm({
                  title: t('queue.purgeTitle'),
                  message: pendingCount > 0
                    ? `${t('queue.purgeDescription')} ${t('queue.purgePendingWarning', { count: pendingCount })}`
                    : t('queue.purgeDescription'),
                  confirmLabel: t('queue.purge'),
                  cancelLabel: t('device.keep'),
                  variant: 'danger',
                  onConfirm: async () => {
                    if (!beginMutation()) return;
                    try {
                      await purgeMobileOfflineSession(session.eventId, session.deviceId);
                      if (!mountedRef.current) return;
                      setSession(null);
                      setSessionInactive(null);
                    } catch (error) {
                      if (mountedRef.current) showToast({ title: t('errors.generic'), description: describeApiError(error, '') || undefined, variant: 'danger' });
                    } finally {
                      finishMutation();
                    }
                  },
                });
              }}><Button.Label>{t('queue.purge')}</Button.Label></Button>
            </Card.Body>
          </Card>
        </>
      ) : (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('workspace.notReady')}</Alert.Title>
            <Alert.Description>{t('workspace.notReadyDescription')}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {!cachedMode && <Card variant="secondary">
        <Card.Body className="gap-3 px-4 py-4">
          <Text className="text-base font-bold" style={{ color: theme.text }}>{t('conflicts.title')}</Text>
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('conflicts.description')}</Text>
          {!conflicts ? (
            <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { if (!mutationPendingRef.current) void loadConflicts(); }}><Button.Label>{t('workspace.retry')}</Button.Label></Button>
          ) : conflicts.items.length === 0 ? (
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('conflicts.empty')}</Text>
          ) : conflicts.items.map((item) => (
            <Surface key={item.item_id} variant="tertiary" className="gap-2 rounded-panel-inner p-3">
              <Text className="text-sm font-semibold" style={{ color: theme.text }}>{item.member.display_name}</Text>
              <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('conflicts.current', {
                state: t(`events:attendance.states.${item.current_attendance.state}`, { defaultValue: t('common:unknown') }),
                version: item.current_attendance.version,
              })}</Text>
              <TextArea label={t('conflicts.reason')} value={resolutionReasons[item.item_id] ?? ''} onChangeText={(value) => setResolutionReasons((current) => ({ ...current, [item.item_id]: value }))} editable={!busy} />
              <View className="flex-row gap-2">
                <Button className="flex-1" size="sm" variant="primary" style={{ backgroundColor: primary }} isDisabled={busy} onPress={() => void resolve(item, 'apply')}><Button.Label>{t('conflicts.apply')}</Button.Label></Button>
                <Button className="flex-1" size="sm" variant="secondary" isDisabled={busy} onPress={() => void resolve(item, 'reject')}><Button.Label>{t('conflicts.reject')}</Button.Label></Button>
              </View>
            </Surface>
          ))}
        </Card.Body>
      </Card>}

      <Alert status="accent">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{t('manual.title')}</Alert.Title>
          <Alert.Description>{t('manual.description')}</Alert.Description>
        </Alert.Content>
      </Alert>
      {confirmDialog}
    </View>
  );
}
