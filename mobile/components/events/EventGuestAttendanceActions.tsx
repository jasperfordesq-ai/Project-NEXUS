// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/NativeButton';
import Input from '@/components/ui/Input';
import { useGuestAttendanceOperations } from '@/lib/hooks/useGuestAttendanceOperations';
import type { OrganizerRegistrationGuests, RegistrationGuestAttendanceIntent } from '@/lib/api/eventRegistration';
import type { GuestAttendanceScope } from '@/lib/eventGuestAttendanceOperation';
type Action = RegistrationGuestAttendanceIntent['action'];
type Props = { scope: GuestAttendanceScope; guest: OrganizerRegistrationGuests['guests'][number]; permitted: boolean;
  active: boolean; onRefresh: () => void; onErrorLayout?: () => void };
export default function EventGuestAttendanceActions({ scope, guest, permitted, active, onRefresh, onErrorLayout }: Props) {
  const { t } = useTranslation(['eventRegistration', 'events', 'common', 'event_communications']);
  const [action, setAction] = useState<Action | null>(null); const [reason, setReason] = useState('');
  const operation = useGuestAttendanceOperations(scope, permitted, active, () => { setAction(null); setReason(''); onRefresh(); });
  const version = guest.attendance?.version ?? 0; const status = guest.attendance?.status ?? 'not_checked_in';
  const reviewed = operation.saved?.status === 'review' ? operation.saved.attendanceVersion : null;
  const acknowledged = operation.saved?.status === 'acknowledged' ? operation.saved.attendanceVersion : null;
  const stale = (reviewed !== null && reviewed !== version) || (acknowledged !== null && acknowledged > version);
  const blocked = operation.blocked || stale || !permitted || !active || guest.status !== 'captured';
  const actions: Action[] = status === 'not_checked_in' ? ['check_in', 'no_show'] : status === 'checked_in' ? ['check_out', 'undo'] : ['undo'];
  if (!active || !permitted) return null;
  return <View className="gap-3">
    {operation.storageFailed || operation.saved?.status === 'pending' ? <>
      <Text className="text-foreground">{t('event_communications:' + (operation.storageFailed ? 'recovery_storage_description' : 'recovery_description'))}</Text>
      <Button isDisabled={operation.busy} onPress={() => { void (operation.storageFailed ? operation.reload() : operation.recover()); }}>
        {t('event_communications:' + (operation.storageFailed ? 'recovery_reload' : 'recovery_button'))}</Button>
    </> : null}
    {operation.saved?.status === 'rejected' && <Button isDisabled={operation.busy} onPress={() => { setAction(null); void operation.review(); }}>{t('events:registrationSettings.review')}</Button>}
    {stale && <Button onPress={onRefresh}>{t('common:buttons.retry')}</Button>}
    {!operation.ready && !operation.storageFailed && <Text className="text-muted-foreground">{t('common:loading')}</Text>}
    {guest.status === 'captured' && !blocked && !action && actions.map(value => <Button key={value} variant="secondary" onPress={() => { setReason(''); setAction(value); }}>{t('guests.' + value)}</Button>)}
    {action && <View className="gap-3">
      <Text accessibilityRole="header" className="font-semibold text-foreground">{t('guests.' + action)}</Text>
      {action === 'undo' && <Input label={t('guests.undo_reason')} value={reason} onChangeText={setReason} multiline editable={!operation.busy} />}
      <Button isDisabled={blocked || !actions.includes(action) || (action === 'undo' && (!reason.trim() || Array.from(reason.trim()).length > 500))}
        onPress={() => { Keyboard.dismiss(); void operation.submit({ guestId: guest.id, action, expectedVersion: version, ...(action === 'undo' ? { reason } : {}) }); }}>
        {t(operation.busy ? 'common:loading' : 'common:buttons.confirm')}</Button>
      <Button variant="secondary" isDisabled={operation.busy} onPress={() => setAction(null)}>{t('common:buttons.cancel')}</Button>
    </View>}
    {operation.operationFailed && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" onLayout={onErrorLayout} className="text-danger">{t('messages.attendance_error')}</Text>}
  </View>;
}
