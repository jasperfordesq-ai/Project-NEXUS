// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/NativeButton';
import type { CanonicalEvent, EventAgendaSession } from '@/lib/api/events';
import type { AgendaSessionPayload } from '@/lib/api/eventAgendaManagement';
import { agendaDraft, type AgendaDraft } from '@/lib/eventAgendaDraft';
import { eventIsoToLocalInput, eventLocalInputToIso } from '@/lib/utils/eventDateTime';

/** Read-only comparison of the authoritative session and the live proposed edit. */
export default function EventAgendaComparison({ event, session, draft, original }: {
  event: CanonicalEvent; session: EventAgendaSession; draft: AgendaDraft; original: AgendaSessionPayload;
}) {
  const { t, i18n } = useTranslation('events');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const current = agendaDraft(event, session);
  const empty = t('registrationSettings.not_set');
  const label = (key: string) => t(`manage.agenda.${key}`);
  const exactTime = (value: string, previous: string) => value === eventIsoToLocalInput(previous, event.schedule.timezone)
    ? previous : eventLocalInputToIso(value, event.schedule.timezone) ?? value;
  const time = (value: string, zone: string) => {
    try { return new Intl.DateTimeFormat(i18n?.language, { dateStyle: 'medium', timeStyle: 'long', timeZone: zone }).format(new Date(value)); }
    catch { return value; }
  };
  const rows: { key: string; before: string; after: string }[] = [
    ...(['title', 'description', 'track', 'room'] as const).map(key => ({ key: `${key}_label`, before: current[key], after: draft[key] })),
    { key: 'type_label', before: label(`types.${current.type}`), after: label(`types.${draft.type}`) },
    { key: 'visibility_label', before: label(`visibilities.${current.visibility}`), after: label(`visibilities.${draft.visibility}`) },
    { key: 'resources.capacity_label', before: current.capacity, after: draft.capacity },
    { key: 'start_label', before: time(session.start_at, session.timezone), after: time(exactTime(draft.start, original.start_at), event.schedule.timezone) },
    { key: 'end_label', before: time(session.end_at, session.timezone), after: time(exactTime(draft.end, original.end_at), event.schedule.timezone) },
  ].filter(row => row.before !== row.after);
  const speakers = (values: AgendaDraft['speakers']) => values.map(speaker =>
    `${speaker.name || t('agenda.speakerFallback')}${speaker.userId ? ` (#${speaker.userId})` : ''} — ${speaker.role || empty}`).join('\n');
  const resources = (values: AgendaDraft['resources']) => values.map(resource =>
    `${resource.title || empty}\n${resource.url || empty}\n${label(`resources.resource_types.${resource.type}`)} · ${label(`visibilities.${resource.visibility}`)}`).join('\n\n');
  const lists = [
    { key: 'speakers_title', before: current.speakers, after: draft.speakers, values: [speakers(current.speakers), speakers(draft.speakers)] },
    { key: 'resources.resources_title', before: current.resources, after: draft.resources, values: [resources(current.resources), resources(draft.resources)] },
  ].filter(row => JSON.stringify(row.before) !== JSON.stringify(row.after));
  const values = (before: string, after: string) => <>
    <Text selectable className="text-muted-foreground">{t('registrationSettings.current_value', { value: before || empty })}</Text>
    <Text selectable className="text-foreground">{t('registrationSettings.proposed_value', { value: after || empty })}</Text>
  </>;
  return <View className="gap-3 rounded-panel border border-border p-4">
    <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{label('comparison')}</Text>
    {rows.map(row => <View key={row.key} className="gap-1">
      <Text className="font-semibold text-foreground">{label(row.key)}</Text>
      {values(row.before, row.after)}
    </View>)}
    {lists.map(row => <View key={row.key} className="gap-2">
      <Button variant="secondary" accessibilityState={{ expanded: !!expanded[row.key] }}
        onPress={() => setExpanded(previous => ({ ...previous, [row.key]: !previous[row.key] }))}>{label(row.key)}</Button>
      {expanded[row.key] && values(row.values[0], row.values[1])}
    </View>)}
    {!rows.length && !lists.length && <Text className="text-muted-foreground">{label('no_differences')}</Text>}
  </View>;
}
