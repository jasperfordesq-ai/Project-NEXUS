// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Input from '@/components/ui/Input';
import ChoiceChips from '@/components/ui/ChoiceChips';
import { Button } from '@/components/ui/NativeButton';
import { useConfirm } from '@/components/ui/useConfirm';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import type { CanonicalEvent, EventAgendaSession } from '@/lib/api/events';
import type { AgendaSessionPayload } from '@/lib/api/eventAgendaManagement';
import { agendaDraft, agendaPayload, type AgendaDraft } from '@/lib/eventAgendaDraft';

interface Props {
  event: CanonicalEvent; session?: EventAgendaSession; recoveredInput?: AgendaSessionPayload;
  blocked: boolean; onSave: (payload: AgendaSessionPayload) => Promise<void>; onClose: () => void;
}
export default function EventAgendaEditor({ event, session, recoveredInput, blocked, onSave, onClose }: Props) {
  const { t } = useTranslation(['events', 'common']);
  const initial = useRef(agendaDraft(event, session));
  const [draft, setDraft] = useState(() => agendaDraft(event, session, recoveredInput));
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { confirm, confirmDialog } = useConfirm();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current);
  useUnsavedChangesGuard({ isDirty: dirty, isSaving: busy, confirm,
    title: t('common:unsavedChanges.title'), message: t('common:unsavedChanges.message'),
    discardLabel: t('common:unsavedChanges.discard'), cancelLabel: t('common:buttons.cancel') });
  const current = useRef({ blocked, draft }); current.current = { blocked, draft };
  const disabled = blocked || busy;
  const label = (key: string) => t(`manage.agenda.${key}`);
  function change<K extends keyof AgendaDraft>(key: K, value: AgendaDraft[K]) {
    if (current.current.blocked || lock.current) return;
    setDraft(previous => ({ ...previous, [key]: value })); setInvalid(false);
  }
  async function save() {
    if (!mounted.current || current.current.blocked || lock.current) return;
    const payload = agendaPayload(current.current.draft, event, recoveredInput ?? session ?? event.schedule);
    if (!payload) { setInvalid(true); return; }
    lock.current = true; setBusy(true);
    try { await onSave(payload); } catch { /* Parent retains the saved operation and renders recovery. */ }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function close() {
    if (lock.current) return;
    if (!dirty) { onClose(); return; }
    const snapshot = draft;
    confirm({ title: t('common:unsavedChanges.title'), message: t('common:unsavedChanges.message'),
      confirmLabel: t('common:unsavedChanges.discard'), cancelLabel: t('common:buttons.cancel'),
      onConfirm: () => { if (mounted.current && !lock.current && current.current.draft === snapshot) onClose(); } });
  }
  const field = (key: 'title' | 'description' | 'start' | 'end' | 'track' | 'room' | 'capacity', title: string) =>
    <Input key={key} label={label(title)} accessibilityLabel={label(title)} value={draft[key]} editable={!disabled}
      multiline={key === 'description'} maxLength={key === 'description' ? 4000 : key === 'title' ? 191 : undefined}
      keyboardType={key === 'capacity' ? 'number-pad' : 'default'} autoCapitalize={key === 'start' || key === 'end' ? 'none' : 'sentences'}
      onChangeText={value => change(key, value)} />;
  const choices = <T extends string,>(title: string, selected: T, values: readonly T[], prefix: string, changeValue: (value: T) => void) =>
    <ChoiceChips<T> label={label(title)} selected={selected} onSelect={value => { if (value && !disabled) changeValue(value); }}
      options={values.map(value => ({ value, label: label(`${prefix}.${value}`), disabled }))} />;
  return <View className="gap-4">
    <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{label(session ? 'edit_title' : 'create_title')}</Text>
    {field('title', 'title_label')}{field('description', 'description_label')}
    {choices('type_label', draft.type, ['session', 'keynote', 'workshop', 'panel', 'break', 'networking', 'other'], 'types', value => change('type', value))}
    {choices('visibility_label', draft.visibility, ['public', 'registered', 'staff'], 'visibilities', value => change('visibility', value))}
    <Text className="text-muted-foreground">{label('visibility_hint')}</Text>
    <Text className="text-muted-foreground">{t('manage.agenda.timezone_hint', { timezone: event.schedule.timezone })}</Text>
    <Text className="text-muted-foreground">{label('input_format')}</Text>
    {field('start', 'start_label')}{field('end', 'end_label')}{field('track', 'track_label')}{field('room', 'room_label')}
    {field('capacity', 'resources.capacity_label')}<Text className="text-muted-foreground">{label('resources.capacity_hint')}</Text>
    <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{label('speakers_title')}</Text>
    <Text className="text-muted-foreground">{label('speakers_hint')}</Text>
    {draft.speakers.map((speaker, index) => <View key={index} className="gap-2 rounded-panel border border-border p-3">
      <Input label={label('speaker_name')} accessibilityLabel={label('speaker_name')} value={speaker.name} editable={!disabled && !speaker.userId}
        maxLength={191} onChangeText={name => change('speakers', draft.speakers.map((s, i) => i === index ? { ...s, name } : s))} />
      <Input label={label('speaker_role')} accessibilityLabel={label('speaker_role')} value={speaker.role} editable={!disabled} maxLength={120}
        onChangeText={role => change('speakers', draft.speakers.map((s, i) => i === index ? { ...s, role } : s))} />
      <Button variant="secondary" isDisabled={disabled} onPress={() => change('speakers', draft.speakers.filter((_, i) => i !== index))}>
        {t('manage.agenda.remove_speaker', { name: speaker.name || t('agenda.speakerFallback') })}</Button>
    </View>)}
    <Button variant="secondary" isDisabled={disabled || draft.speakers.length >= 50} onPress={() => change('speakers', [...draft.speakers, { name: '', role: '' }])}>{label('add_speaker')}</Button>
    <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{label('resources.resources_title')}</Text>
    <Text className="text-muted-foreground">{label('resources.resources_hint')}</Text>
    {draft.resources.map((resource, index) => {
      const update = (patch: Partial<typeof resource>) => change('resources', draft.resources.map((r, i) => i === index ? { ...r, ...patch } : r));
      return <View key={index} className="gap-2 rounded-panel border border-border p-3">
        <Text accessibilityRole="header" className="font-semibold text-foreground">{t('manage.agenda.resources.resource_number', { number: index + 1 })}</Text>
        <Input label={label('resources.resource_title')} accessibilityLabel={label('resources.resource_title')} value={resource.title} editable={!disabled} maxLength={191} onChangeText={title => update({ title })} />
        <Input label={label('resources.resource_url')} accessibilityLabel={label('resources.resource_url')} value={resource.url} editable={!disabled} autoCapitalize="none" keyboardType="url" onChangeText={url => update({ url })} />
        {choices('resources.resource_type', resource.type, ['link', 'document', 'slides', 'download', 'stream', 'recording'], 'resources.resource_types', type => update({ type }))}
        {choices('resources.resource_visibility', resource.visibility, ['public', 'registered', 'staff'], 'visibilities', visibility => update({ visibility }))}
        <Button variant="secondary" isDisabled={disabled} onPress={() => change('resources', draft.resources.filter((_, i) => i !== index))}>{t('manage.agenda.resources.remove_resource', { title: resource.title })}</Button>
      </View>;
    })}
    <Button variant="secondary" isDisabled={disabled || draft.resources.length >= 50} onPress={() => change('resources', [...draft.resources, { type: 'link', title: '', url: '', visibility: 'registered' }])}>{label('resources.add_resource')}</Button>
    {invalid && <Text accessibilityRole="alert" className="text-danger">{label('invalid_fields')}</Text>}
    <Button isDisabled={disabled} onPress={() => { void save(); }}>{label(session ? 'save_changes' : 'create_session')}</Button>
    <Button variant="secondary" isDisabled={busy} onPress={close}>{label('close_editor')}</Button>
    {confirmDialog}
  </View>;
}
