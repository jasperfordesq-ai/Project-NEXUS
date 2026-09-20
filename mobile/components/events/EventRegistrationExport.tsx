// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useEffect, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Input from '@/components/ui/Input';
import { Button } from '@/components/ui/NativeButton';
import { useRegistrationExport } from '@/lib/hooks/useRegistrationExport';
import { isRefusalStatus } from '@/lib/api/refusal';
interface Props { tenantId: number; userId: number; eventId: number; permitted: boolean; sensitive: boolean; active: boolean; onClose: () => void; onErrorLayout?: () => void }
export default function EventRegistrationExport({ permitted, sensitive, active, onClose, onErrorLayout, ...scope }: Props) {
  const { t } = useTranslation(['eventRegistration', 'events', 'common']);
  const [purpose, setPurpose] = useState(''); const [reference, setReference] = useState('');
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const download = useRegistrationExport(scope, permitted, sensitive, active);
  useEffect(() => { if (!active || !permitted) { setPurpose(''); setReference(''); setIncludeSensitive(false); } }, [active, permitted]);
  useEffect(() => { if (!sensitive) setIncludeSensitive(false); }, [sensitive]);
  const busy = download.status === 'loading';
  const valid = Boolean(purpose.trim() && reference.trim()) && Array.from(purpose.trim()).length <= 500
    && new TextEncoder().encode(reference.trim()).length <= 512;
  if (!active || !permitted) return null;
  return <View className="gap-4">
    <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{t('submissions.export_title')}</Text>
    <Button variant="secondary" onPress={onClose}>{t('common:close')}</Button>
    <Text className="text-muted-foreground">{t('submissions.export_description')}</Text>
    <Text className="font-semibold text-foreground">{t('submissions.audit_title')}</Text>
    <Input label={t('submissions.purpose')} value={purpose} editable={!busy} multiline onChangeText={value => { if (!busy) setPurpose(value); }} />
    <Input label={t('submissions.correlation')} value={reference} editable={!busy} onChangeText={value => { if (!busy) setReference(value); }} />
    {sensitive && <View className="gap-2"><Text className="text-foreground">{t('submissions.include_sensitive')}</Text>
      <View className="flex-row flex-wrap gap-2">{[false, true].map(value => <Button key={String(value)} variant={includeSensitive === value ? 'primary' : 'secondary'}
        accessibilityState={{ selected: includeSensitive === value }} isDisabled={busy} onPress={() => { if (!busy) setIncludeSensitive(value); }}>
        {t(value ? 'common:yes' : 'common:no')}</Button>)}</View></View>}
    <Button isDisabled={!valid || busy} onPress={() => { if (valid) { Keyboard.dismiss(); void download.open({ purpose, correlation_id: reference, include_sensitive: includeSensitive && sensitive }); } }}>
      {t(busy ? 'common:loading' : 'submissions.export_action')}</Button>
    {download.status === 'failed' && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" onLayout={onErrorLayout} className="text-danger">{t(isRefusalStatus(download.errorStatus) ? 'events:manage.access_denied_title'
      : download.unavailable ? 'submissions.sharing_unavailable' : 'submissions.export_error')}</Text>}
  </View>;
}
