// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { Text, View } from 'react-native';
import { Card } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/NativeButton';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { getEventPeopleHistory } from '@/lib/api/eventPeople';
import { isRefusalStatus } from '@/lib/api/refusal';
import { dateLocale } from '@/lib/utils/dateLocale';

interface Props { eventId: number; userId: number; name: string; onClose: () => void }
export default function EventPeopleHistory(props: Props) {
  const { user } = useAuth(); const { tenant } = useTenant();
  return <HistoryContent key={`${tenant?.id}:${user?.id}:${props.eventId}:${props.userId}`} {...props} />;
}

function HistoryContent({ eventId, userId, name, onClose }: Props) {
  const { t } = useTranslation(['events', 'common']);
  const [page, setPage] = useState(1);
  const valid = [eventId, userId].every(id => Number.isSafeInteger(id) && id > 0);
  const history = useApi(() => getEventPeopleHistory(eventId, userId, page), [eventId, userId, page], { enabled: valid, clearOnRefusal: true });
  const p = 'manage.people';
  const stateLabel = (axis: string, state: string | null) => state
    ? t(`${p}.states.${axis}.${state}`, { defaultValue: t(`${p}.not_recorded`) }) : t(`${p}.states.none`);
  function timestamp(value: string) {
    // Laravel history rows use UTC SQL timestamps (config/app.php).
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
    const date = new Date(normalized);
    if (!Number.isFinite(date.getTime())) return t(`${p}.not_recorded`);
    return date.toLocaleString(dateLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  }
  return <Card variant="secondary"><Card.Body className="gap-3 p-4">
    <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{t(`${p}.history_title`, { name })}</Text>
    <Button variant="secondary" onPress={onClose}><Button.Label>{t(`${p}.close_history`)}</Button.Label></Button>
    {history.isLoading ? <Text accessibilityLiveRegion="polite" className="text-muted-foreground">{t(`${p}.history_loading`)}</Text> : null}
    {!valid || isRefusalStatus(history.errorStatus) ? <Text accessibilityRole="alert" className="text-danger">{t('manage.access_denied_title')}</Text>
      : history.error ? <View className="gap-2"><Text accessibilityRole="alert" className="text-danger">{t(`${p}.history_error`)}</Text>
        <Button isDisabled={history.isLoading} onPress={history.refresh}><Button.Label>{t('common:buttons.retry')}</Button.Label></Button></View> : null}
    {history.data?.data.length === 0 ? <Text className="text-muted-foreground">{t(`${p}.history_empty`)}</Text> : null}
    {history.data?.data.map(entry => <View key={`${entry.axis}:${entry.entry_id}`} className="gap-2 border-b border-separator pb-3">
      <Text className="font-semibold text-foreground">{t(`${p}.history_axes.${entry.axis}`)} · {t(`${p}.history_change`, {
        from: stateLabel(entry.axis, entry.from_state), to: stateLabel(entry.axis, entry.to_state),
      })}</Text>
      <Text className="text-muted-foreground">{entry.actor.display_name || t(`${p}.system_actor`)} · {timestamp(entry.created_at)}</Text>
      <Text className="text-muted-foreground">{t(`${p}.version`, { version: entry.version })}</Text>
      {entry.reason ? <Text className="text-foreground">{entry.reason}</Text> : null}
    </View>)}
    {history.data ? <View className="flex-row flex-wrap gap-2">
      <Button variant="secondary" isDisabled={history.isLoading || page <= 1} onPress={() => setPage(current => Math.max(1, current - 1))}><Button.Label>{t('attendance.previous')}</Button.Label></Button>
      <Button variant="secondary" isDisabled={history.isLoading || !history.data.meta.has_more || page >= 200} onPress={() => setPage(current => Math.min(200, current + 1))}><Button.Label>{t('attendance.next')}</Button.Label></Button>
    </View> : null}
  </Card.Body></Card>;
}
