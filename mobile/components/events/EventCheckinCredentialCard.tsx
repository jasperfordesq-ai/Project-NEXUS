// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Share, Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Alert, Button, Card, Chip, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import TextArea from '@/components/ui/TextArea';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import {
  getMyEventCheckinCredential,
  issueMyEventCheckinCredential,
  revokeMyEventCheckinCredential,
  rotateMyEventCheckinCredential,
  type MobileEventCheckinCredentialResponse,
} from '@/lib/api/eventOfflineCheckin';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';

type Credential = NonNullable<MobileEventCheckinCredentialResponse['credential']>;

function mutationKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Confirmed-attendee, one-shot display boundary for a PII-free signed QR credential. */
export default function EventCheckinCredentialCard({ eventId }: { eventId: number }) {
  const { t } = useTranslation(['eventOfflineCheckin', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const issueKey = useRef<string | null>(null);
  const rotateKey = useRef<string | null>(null);
  const [credential, setCredential] = useState<Credential | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const applyResponse = useCallback((response: MobileEventCheckinCredentialResponse) => {
    setCredential(response.credential);
    const oneShotToken = response.credential?.token_one_shot === true
      && response.credential.token?.startsWith('nqx2_')
      ? response.credential.token
      : null;
    setToken(oneShotToken);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      applyResponse(await getMyEventCheckinCredential(eventId));
    } catch {
      setCredential(null);
      setToken(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [applyResponse, eventId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setToken(null);
    });
    return () => subscription.remove();
  }, []);

  async function issue() {
    setBusy(true);
    issueKey.current ??= mutationKey('mobile-event-checkin-code');
    try {
      const response = await issueMyEventCheckinCredential(eventId, issueKey.current);
      applyResponse(response);
      issueKey.current = null;
    } catch {
      showToast({ title: t('eventOfflineCheckin:credential.unavailable'), variant: 'danger' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    if (!credential) return;
    setBusy(true);
    rotateKey.current ??= mutationKey('mobile-event-checkin-code-rotate');
    try {
      const response = await rotateMyEventCheckinCredential(
        eventId,
        credential.id,
        credential.version,
        rotateKey.current,
      );
      applyResponse(response);
      rotateKey.current = null;
      setReason('');
    } catch {
      showToast({ title: t('eventOfflineCheckin:credential.unavailable'), variant: 'danger' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!credential) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      showToast({ title: t('eventOfflineCheckin:credential.reason_required'), variant: 'warning' });
      return;
    }
    setBusy(true);
    try {
      applyResponse(await revokeMyEventCheckinCredential(
        eventId,
        credential.id,
        credential.version,
        trimmedReason,
      ));
      setReason('');
      showToast({ title: t('eventOfflineCheckin:credential.revoked'), variant: 'success' });
    } catch {
      showToast({ title: t('eventOfflineCheckin:credential.unavailable'), variant: 'danger' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  function requestRotate() {
    confirm({
      title: t('eventOfflineCheckin:credential.rotate_title'),
      message: t('eventOfflineCheckin:credential.rotate_description'),
      confirmLabel: t('eventOfflineCheckin:credential.rotate'),
      cancelLabel: t('common:no'),
      variant: 'danger',
      onConfirm: rotate,
    });
  }

  function requestRevoke() {
    if (!reason.trim()) {
      showToast({ title: t('eventOfflineCheckin:credential.reason_required'), variant: 'warning' });
      return;
    }
    confirm({
      title: t('eventOfflineCheckin:credential.revoke_title'),
      message: t('eventOfflineCheckin:credential.revoke_description'),
      confirmLabel: t('eventOfflineCheckin:credential.revoke'),
      cancelLabel: t('common:no'),
      variant: 'danger',
      onConfirm: revoke,
    });
  }

  async function copyCode() {
    if (!token) return;
    await Clipboard.setStringAsync(token);
    showToast({ title: t('eventOfflineCheckin:credential.copied'), variant: 'success' });
  }

  async function shareCode() {
    if (!token) return;
    await Share.share({
      title: t('eventOfflineCheckin:credential.title'),
      message: token,
    });
  }

  if (loading) {
    return (
      <Surface
        variant="secondary"
        className="flex-row items-center justify-center gap-2 rounded-panel-inner p-5"
        accessibilityLiveRegion="polite"
        accessibilityLabel={t('eventOfflineCheckin:credential.loading')}
      >
        <Spinner size="sm" />
        <Text className="text-sm" style={{ color: theme.textSecondary }}>
          {t('eventOfflineCheckin:credential.loading')}
        </Text>
      </Surface>
    );
  }

  if (loadError) {
    return (
      <Alert status="warning">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{t('eventOfflineCheckin:credential.load_error')}</Alert.Title>
        </Alert.Content>
        <Button size="sm" variant="secondary" onPress={() => void load()}>
          <Button.Label>{t('eventOfflineCheckin:workspace.retry')}</Button.Label>
        </Button>
      </Alert>
    );
  }

  const isActive = credential?.status === 'active';

  return (
    <>
      <Card variant="secondary">
        <Card.Body className="gap-4 px-4 py-4">
          <View className="flex-row items-start gap-3">
            <Ionicons name="qr-code-outline" size={24} color={primary} />
            <View className="min-w-0 flex-1">
              <Text className="text-lg font-bold" style={{ color: theme.text }}>
                {t('eventOfflineCheckin:credential.title')}
              </Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('eventOfflineCheckin:credential.description')}
              </Text>
            </View>
          </View>

          <Alert status="accent">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t('eventOfflineCheckin:credential.privacy')}</Alert.Title>
            </Alert.Content>
          </Alert>

          {!isActive ? (
            <Button
              variant="primary"
              style={{ backgroundColor: primary }}
              isDisabled={busy}
              accessibilityState={{ busy }}
              onPress={() => void issue()}
            >
              {busy ? <Spinner size="sm" /> : <Ionicons name="qr-code-outline" size={18} color="#fff" />}
              <Button.Label>{t('eventOfflineCheckin:credential.issue')}</Button.Label>
            </Button>
          ) : (
            <View className="gap-4">
              <View className="flex-row flex-wrap items-center gap-2">
                <Chip size="sm" color="success">
                  <Chip.Label>{t(`eventOfflineCheckin:credential.status.${credential.status}`)}</Chip.Label>
                </Chip>
                {credential.expires_at ? (
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>
                    {t('eventOfflineCheckin:credential.expires', {
                      date: new Intl.DateTimeFormat(dateLocale(), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(credential.expires_at)),
                    })}
                  </Text>
                ) : null}
              </View>

              {token ? (
                <Surface variant="tertiary" className="items-center gap-3 rounded-panel-inner p-4">
                  <View
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={t('eventOfflineCheckin:credential.qr_alt')}
                    className="rounded-panel-inner bg-white p-3"
                  >
                    <QRCode value={token} size={220} color="#000000" backgroundColor="#ffffff" ecl="M" />
                  </View>
                  <Text selectable className="font-mono text-xs" style={{ color: theme.textSecondary }}>
                    {token}
                  </Text>
                  <Text className="text-center text-xs" style={{ color: theme.textSecondary }}>
                    {t('eventOfflineCheckin:credential.one_shot')}
                  </Text>
                  <View className="w-full flex-row flex-wrap justify-center gap-2">
                    <Button size="sm" variant="secondary" onPress={() => void copyCode()}>
                      <Ionicons name="copy-outline" size={16} color={primary} />
                      <Button.Label>{t('eventOfflineCheckin:credential.copy')}</Button.Label>
                    </Button>
                    <Button size="sm" variant="secondary" onPress={() => void shareCode()}>
                      <Ionicons name="share-outline" size={16} color={primary} />
                      <Button.Label>{t('eventOfflineCheckin:credential.share')}</Button.Label>
                    </Button>
                    <Button size="sm" variant="secondary" onPress={() => setToken(null)}>
                      <Button.Label>{t('eventOfflineCheckin:credential.hide')}</Button.Label>
                    </Button>
                  </View>
                </Surface>
              ) : (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>{t('eventOfflineCheckin:credential.one_shot')}</Alert.Title>
                  </Alert.Content>
                </Alert>
              )}

              <TextArea
                label={t('eventOfflineCheckin:credential.reason')}
                value={reason}
                onChangeText={setReason}
                placeholder={t('eventOfflineCheckin:credential.reason_hint')}
                editable={!busy}
              />
              <View className="flex-row flex-wrap gap-2">
                <Button className="flex-1" variant="secondary" isDisabled={busy} onPress={requestRotate}>
                  <Ionicons name="refresh-outline" size={16} color={primary} />
                  <Button.Label>{t('eventOfflineCheckin:credential.rotate')}</Button.Label>
                </Button>
                <Button className="flex-1" variant="danger-soft" isDisabled={busy} onPress={requestRevoke}>
                  <Button.Label>{t('eventOfflineCheckin:credential.revoke')}</Button.Label>
                </Button>
              </View>
            </View>
          )}
        </Card.Body>
      </Card>
      {confirmDialog}
    </>
  );
}
