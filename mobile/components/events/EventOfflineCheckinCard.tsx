// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@/components/ui/Icon';
import { Alert, Button, Card, Chip, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import Input from '@/components/ui/Input';
import TextArea from '@/components/ui/TextArea';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import AccentIcon from '@/components/ui/AccentIcon';
import {
  downloadOfflineCheckinManifest,
  getOfflineCheckinConflicts,
  getOfflineCheckinWorkspace,
  registerOfflineCheckinDevice,
  resolveOfflineCheckinConflict,
  revokeOfflineCheckinDevice,
  type MobileOfflineConflicts,
  type MobileOfflineWorkspace,
  type OfflineAttendanceOperation,
} from '@/lib/api/eventOfflineCheckin';
import { ApiResponseError } from '@/lib/api/client';
import {
  activateMobileOfflineSession,
  enqueueMobileOfflineCredential,
  loadMobileOfflineSessionForReview,
  purgeMobileOfflineSession,
  purgeRevokedOrExpiredMobileSessions,
  refreshMobileOfflineManifest,
  syncMobileOfflineSession,
  type MobileOfflineInactiveReason,
  type MobileOfflineSession,
} from '@/lib/eventOfflineCheckinStore';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

const OPERATIONS: OfflineAttendanceOperation[] = ['check_in', 'check_out', 'no_show', 'undo'];

function mutationKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function EventOfflineCheckinCard({ eventId }: { eventId: number }) {
  const { t } = useTranslation('eventOfflineCheckin');
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [permission, requestPermission] = useCameraPermissions();
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
  const [revocationReason, setRevocationReason] = useState('');
  const [credential, setCredential] = useState('');
  const [operation, setOperation] = useState<OfflineAttendanceOperation>('check_in');
  const [reason, setReason] = useState('');
  const [resolutionReasons, setResolutionReasons] = useState<Record<number, string>>({});
  const [cameraOpen, setCameraOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Read through refs inside `load` so a re-created `t` or toast handle cannot re-run the
  // workspace fetch on every render (the effect below keys on `load`).
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const tRef = useRef(t);
  tRef.current = t;

  const loadConflicts = useCallback(async () => {
    try {
      setConflicts(await getOfflineCheckinConflicts(eventId));
    } catch {
      setConflicts(null);
    }
  }, [eventId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const nextWorkspace = await getOfflineCheckinWorkspace(eventId);
      await purgeRevokedOrExpiredMobileSessions(nextWorkspace);
      setWorkspace(nextWorkspace);
      let restored: MobileOfflineSession | null = null;
      let inactive: MobileOfflineInactiveReason | null = null;
      for (const device of nextWorkspace.devices) {
        if (device.status !== 'active') continue;
        try {
          const review = await loadMobileOfflineSessionForReview(eventId, device.id);
          if (review.session) {
            restored = review.session;
            inactive = review.inactive;
            break;
          }
        } catch {
          // Unreadable ciphertext: the store has already destroyed it.
        }
      }
      if (restored && !inactive && restored.manifest.manifest_version !== nextWorkspace.manifest_version) {
        const manifest = await downloadOfflineCheckinManifest(eventId, restored.deviceSecret);
        restored = await refreshMobileOfflineManifest(restored, manifest, nextWorkspace);
      }
      setSession(restored);
      setSessionInactive(inactive);
      if (restored && inactive) {
        const pending = restored.queue.filter((item) => item.state === 'pending').length;
        if (pending > 0) {
          showToastRef.current({ title: tRef.current('queue.pendingKept', { count: pending }), variant: 'warning' });
        }
      }
      await loadConflicts();
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [eventId, loadConflicts]);

  useEffect(() => { void load(); }, [load]);

  async function registerDevice() {
    if (!deviceLabel.trim()) return;
    setBusy(true);
    try {
      const result = await registerOfflineCheckinDevice(
        eventId,
        deviceLabel.trim(),
        mutationKey('mobile-offline-device'),
      );
      if (!result.device.secret) throw new Error('device_secret_missing');
      const manifest = await downloadOfflineCheckinManifest(eventId, result.device.secret);
      const nextWorkspace = await getOfflineCheckinWorkspace(eventId);
      const next = await activateMobileOfflineSession(result.device.secret, manifest, nextWorkspace);
      setWorkspace(nextWorkspace);
      setSession(next);
      setSessionInactive(null);
      setDeviceLabel('');
      showToast({ title: t('workspace.ready'), variant: 'success' });
    } catch {
      showToast({ title: t('errors.generic'), variant: 'danger' });
    } finally {
      setBusy(false);
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
        setBusy(true);
        try {
          await revokeOfflineCheckinDevice(
            eventId,
            device.id,
            device.version,
            revocationReason.trim(),
            mutationKey('mobile-offline-revoke'),
          );
          await purgeMobileOfflineSession(eventId, device.id);
          if (session?.deviceId === device.id) setSession(null);
          setRevocationReason('');
          showToast({ title: t('device.revoked'), variant: 'success' });
          await load();
        } catch {
          showToast({ title: t('errors.generic'), variant: 'danger' });
        } finally {
          setBusy(false);
        }
      },
    });
  }

  async function openCamera() {
    if (!permission?.granted) {
      const granted = await requestPermission();
      if (!granted.granted) {
        showToast({ title: t('scan.cameraUnavailable'), variant: 'warning' });
        return;
      }
    }
    setCameraOpen(true);
  }

  async function enqueue() {
    if (!session || sessionInactive || !credential.trim()) return;
    setBusy(true);
    try {
      const next = await enqueueMobileOfflineCredential(session, credential, operation, reason);
      setSession(next);
      setCredential('');
      setReason('');
      showToast({ title: t('scan.queued'), variant: 'success' });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'generic';
      showToast({
        title: t(code === 'reason_required'
          ? 'scan.reasonRequired'
          : code === 'transition_invalid'
            ? 'scan.transitionInvalid'
            : 'scan.invalid'),
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  async function synchronize() {
    if (!session || sessionInactive) return;
    setBusy(true);
    try {
      const result = await syncMobileOfflineSession(session);
      setSession(result.session);
      showToast({ title: result.batch ? t('queue.synced') : t('queue.emptyPending'), variant: 'success' });
      await loadConflicts();
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 403) {
        await purgeMobileOfflineSession(session.eventId, session.deviceId);
        setSession(null);
        showToast({ title: t('errors.revoked'), variant: 'danger' });
      } else {
        showToast({ title: t('queue.syncError'), variant: 'danger' });
      }
    } finally {
      setBusy(false);
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
    setBusy(true);
    try {
      const next = await resolveOfflineCheckinConflict(eventId, item.item_id, {
        expectedDecisionVersion: item.conflict.decision_version,
        expectedAttendanceVersion: item.current_attendance.version,
        disposition,
        reason: resolutionReason,
        idempotencyKey: mutationKey('mobile-offline-conflict'),
      });
      setConflicts(next);
      setResolutionReasons((current) => ({ ...current, [item.item_id]: '' }));
      showToast({ title: t('conflicts.resolved'), variant: 'success' });
    } catch {
      showToast({ title: t('conflicts.error'), variant: 'danger' });
      await loadConflicts();
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = useMemo(
    () => session?.queue.filter((item) => item.state === 'pending').length ?? 0,
    [session],
  );

  if (loading && !workspace) {
    return <Surface variant="secondary" className="items-center rounded-panel-inner p-5"><Spinner /></Surface>;
  }

  if (loadError || !workspace) {
    return (
      <Alert status="warning">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{t('workspace.loadErrorTitle')}</Alert.Title>
          <Alert.Description>{t('workspace.loadErrorDescription')}</Alert.Description>
        </Alert.Content>
        <Button size="sm" variant="secondary" onPress={() => void load()}><Button.Label>{t('workspace.retry')}</Button.Label></Button>
      </Alert>
    );
  }

  return (
    <View className="gap-4">
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

      <Card variant="secondary">
        <Card.Body className="gap-3 px-4 py-4">
          <Text className="text-base font-bold" style={{ color: theme.text }}>{t('device.title')}</Text>
          <Input label={t('device.label')} value={deviceLabel} onChangeText={setDeviceLabel} placeholder={t('device.labelPlaceholder')} editable={!busy} />
          <Button variant="primary" isDisabled={busy || !deviceLabel.trim()} onPress={() => void registerDevice()}>
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
      </Card>

      {session ? (
        <>
          {sessionInactive ? (
            <Alert status="warning" testID="event-offline-checkin-read-only">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{t('queue.readOnlyTitle')}</Alert.Title>
                <Alert.Description>
                  {t(sessionInactive === 'manifest_expired' ? 'queue.readOnlyExpired' : 'queue.readOnlyRotated')}
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : (
          <Card variant="secondary">
            <Card.Body className="gap-3 px-4 py-4">
              <Text className="text-base font-bold" style={{ color: theme.text }}>{t('scan.title')}</Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('scan.description')}</Text>
              <Button variant="secondary" onPress={() => void openCamera()}>
                <Ionicons name="scan-outline" size={18} color={primary} />
                <Button.Label>{t('scan.openCamera')}</Button.Label>
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
              <View className="flex-row items-center justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-bold" style={{ color: theme.text }}>{t('queue.title')}</Text>
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('queue.pending', { count: pendingCount })}</Text>
                </View>
                <Button size="sm" variant="primary" isDisabled={busy || pendingCount === 0 || sessionInactive !== null} onPress={() => void synchronize()}>
                  <Button.Label>{t('queue.sync')}</Button.Label>
                </Button>
              </View>
              {session.queue.length === 0 ? <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('queue.empty')}</Text> : session.queue.map((item) => (
                <Surface key={item.clientNonce} variant="tertiary" className="flex-row items-center justify-between gap-3 rounded-panel-inner p-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-semibold" style={{ color: theme.text }}>{item.displayName}</Text>
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>{t(`scan.operations.${item.operation}`)}</Text>
                  </View>
                  <Chip size="sm" color={item.state === 'synced' ? 'success' : item.state === 'conflict' ? 'warning' : item.state === 'rejected' ? 'danger' : 'default'}><Chip.Label>{t(`queue.states.${item.state}`)}</Chip.Label></Chip>
                </Surface>
              ))}
              <Button size="sm" variant="danger-soft" testID="event-offline-checkin-purge" onPress={() => {
                confirm({
                  title: t('queue.purgeTitle'),
                  message: pendingCount > 0
                    ? `${t('queue.purgeDescription')} ${t('queue.purgePendingWarning', { count: pendingCount })}`
                    : t('queue.purgeDescription'),
                  confirmLabel: t('queue.purge'),
                  cancelLabel: t('device.keep'),
                  variant: 'danger',
                  onConfirm: async () => {
                    await purgeMobileOfflineSession(session.eventId, session.deviceId);
                    setSession(null);
                    setSessionInactive(null);
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

      <Card variant="secondary">
        <Card.Body className="gap-3 px-4 py-4">
          <Text className="text-base font-bold" style={{ color: theme.text }}>{t('conflicts.title')}</Text>
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('conflicts.description')}</Text>
          {!conflicts ? (
            <Button size="sm" variant="secondary" onPress={() => void loadConflicts()}><Button.Label>{t('workspace.retry')}</Button.Label></Button>
          ) : conflicts.items.length === 0 ? (
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('conflicts.empty')}</Text>
          ) : conflicts.items.map((item) => (
            <Surface key={item.item_id} variant="tertiary" className="gap-2 rounded-panel-inner p-3">
              <Text className="text-sm font-semibold" style={{ color: theme.text }}>{item.member.display_name}</Text>
              <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('conflicts.current', { state: item.current_attendance.state, version: item.current_attendance.version })}</Text>
              <TextArea label={t('conflicts.reason')} value={resolutionReasons[item.item_id] ?? ''} onChangeText={(value) => setResolutionReasons((current) => ({ ...current, [item.item_id]: value }))} editable={!busy} />
              <View className="flex-row gap-2">
                <Button className="flex-1" size="sm" variant="primary" style={{ backgroundColor: primary }} isDisabled={busy} onPress={() => void resolve(item, 'apply')}><Button.Label>{t('conflicts.apply')}</Button.Label></Button>
                <Button className="flex-1" size="sm" variant="secondary" isDisabled={busy} onPress={() => void resolve(item, 'reject')}><Button.Label>{t('conflicts.reject')}</Button.Label></Button>
              </View>
            </Surface>
          ))}
        </Card.Body>
      </Card>

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
