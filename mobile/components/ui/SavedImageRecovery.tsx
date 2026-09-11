// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/hooks/useTheme';
import AppTopBar from './AppTopBar';
import { Button } from './NativeButton';
import RemoteImage from './RemoteImage';

/** Keep the saved record separate from its retryable image operation. */
export default function SavedImageRecovery({ title, message, uri, onRetry, onChoose, onContinue }: {
  title: string;
  message: string;
  uri: string | null;
  onRetry: () => Promise<boolean>;
  onChoose: () => Promise<void>;
  onContinue: () => void;
}) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const navigated = useRef(false);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  usePreventRemove(busy, () => {});
  // Let the pending-navigation guard stand down before opening the saved item.
  useEffect(() => {
    if (completed && !busy && !navigated.current) {
      navigated.current = true;
      onContinue();
    }
  }, [busy, completed, onContinue]);
  async function run(action: () => Promise<boolean | void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const saved = await action();
      if (mounted.current && saved === true) setCompleted(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={t('back')} onBack={() => { if (!inFlight.current) onContinue(); }} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Text accessibilityLiveRegion="polite" style={{ color: theme.text }}>{message}</Text>
        {busy ? <ActivityIndicator accessibilityLabel={t('loading')} /> : null}
        {uri ? <RemoteImage key={uri} uri={uri} style={{ width: '100%', height: 180, borderRadius: 12 }} contentFit="contain" /> : null}
        <Button isDisabled={busy} onPress={() => void run(onRetry)}><Button.Label>{t('mediaRecovery.retry')}</Button.Label></Button>
        <Button variant="secondary" isDisabled={busy} onPress={() => void run(onChoose)}><Button.Label>{t('mediaRecovery.choose')}</Button.Label></Button>
        <Button variant="secondary" isDisabled={busy} onPress={() => { if (!inFlight.current) onContinue(); }}><Button.Label>{t('mediaRecovery.continue')}</Button.Label></Button>
      </ScrollView>
    </SafeAreaView>
  );
}
