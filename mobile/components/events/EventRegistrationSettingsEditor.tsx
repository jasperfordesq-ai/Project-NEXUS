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
import { registrationSettingsDraft, registrationSettingsPayload, type RegistrationSettingsDraft } from '@/lib/eventRegistrationSettingsDraft';
import type { OrganizerRegistrationSettings, RegistrationSettingsInput } from '@/lib/api/eventRegistration';
import { useConfirm } from '@/components/ui/useConfirm';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';

interface Props {
  settings: OrganizerRegistrationSettings | null;
  timezone: string;
  eventStart: string;
  blocked: boolean;
  recoveredDraft?: RegistrationSettingsDraft;
  recoveredInput?: RegistrationSettingsInput;
  onSave: (input: RegistrationSettingsInput) => Promise<void>;
  onPublish: (revision: number) => Promise<void>;
}
/** Parent keys this form by owner/event/revision and owns permissions and saved-operation recovery. */
export default function EventRegistrationSettingsEditor({ settings, timezone, eventStart, blocked, recoveredDraft, recoveredInput, onSave, onPublish }: Props) {
  const { t } = useTranslation(['events', 'common']);
  const initial = useRef(registrationSettingsDraft(settings, timezone));
  const [draft, setDraft] = useState(recoveredDraft ?? initial.current);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current);
  const { confirm, confirmDialog } = useConfirm();
  useUnsavedChangesGuard({ isDirty: dirty, isSaving: busy, confirm,
    title: t('common:unsavedChanges.title'), message: t('common:unsavedChanges.message'),
    discardLabel: t('common:unsavedChanges.discard'), cancelLabel: t('common:cancel') });
  const disabled = blocked || busy;
  const current = useRef({ draft, disabled, settings });
  current.current = { draft, disabled, settings };
  const label = (key: string) => t(`registrationSettings.${key}`);
  const comparisons: [keyof RegistrationSettingsDraft, string][] = [
    ['approval', 'approval_mode'], ['opens', 'opens_at'], ['closes', 'closes_at'],
    ['cutoff', 'cancellation_cutoff'], ['memberLimit', 'per_member_limit'],
    ['guests', 'guests_enabled'], ['maxGuests', 'max_guests'], ['retentionDays', 'guest_retention'],
  ];
  const displayValue = (key: keyof RegistrationSettingsDraft, value: string | boolean) => {
    if (key === 'approval') return label(`approval_modes.${String(value)}`);
    if (typeof value === 'boolean') return t(`common:${value ? 'yes' : 'no'}`);
    return value || label('not_set');
  };
  function change<K extends keyof RegistrationSettingsDraft>(key: K, value: RegistrationSettingsDraft[K]) {
    setDraft(previous => ({ ...previous, [key]: value })); setInvalid(false);
  }
  async function act(publish: boolean) {
    if (!mounted.current || current.current.disabled || lock.current
      || current.current.draft !== draft || current.current.settings !== settings) return;
    const input = registrationSettingsPayload(draft, settings, timezone, eventStart, recoveredInput);
    if (!input) { setInvalid(true); return; }
    if (publish && (!settings || settings.status !== 'draft' || dirty)) return;
    lock.current = true; setBusy(true);
    try {
      if (publish) await onPublish(settings!.revision); else await onSave(input);
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function requestAction(publish: boolean) {
    if (disabled || !mounted.current) return;
    if (!registrationSettingsPayload(draft, settings, timezone, eventStart, recoveredInput)) { setInvalid(true); return; }
    if (publish || settings?.status === 'published') {
      confirm({ title: label(publish ? 'publish' : 'save'), message: label('live_hint'),
        confirmLabel: label(publish ? 'publish' : 'save'), cancelLabel: t('common:cancel'),
        onConfirm: () => act(publish).catch(() => undefined) });
    } else { void act(false).catch(() => undefined); }
  }
  const field = (key: 'opens' | 'closes' | 'cutoff' | 'memberLimit' | 'maxGuests' | 'retentionDays', title: string, numeric = false) => (
    <Input key={key} label={label(title)} accessibilityLabel={label(title)} value={draft[key]}
      onChangeText={value => change(key, value)} editable={!disabled} keyboardType={numeric ? 'number-pad' : 'default'} autoCapitalize="none" />
  );
  return <View className="gap-4">
    <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{label('title')}</Text>
    <Text className="text-sm text-muted-foreground">{label(settings?.status === 'published' ? 'live_hint' : 'draft_hint')}</Text>
    <Text className="text-sm text-muted-foreground">{t('registrationSettings.time_hint', { timezone })}</Text>
    {recoveredDraft && <View className="gap-3 rounded-panel border border-border p-4">
      <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{label('comparison')}</Text>
      {comparisons.filter(([key]) => initial.current[key] !== draft[key]).map(([key, title]) => <View key={key} className="gap-1">
        <Text className="font-semibold text-foreground">{label(title)}</Text>
        <Text className="text-muted-foreground">{t('registrationSettings.current_value', { value: displayValue(key, initial.current[key]) })}</Text>
        <Text className="text-foreground">{t('registrationSettings.proposed_value', { value: displayValue(key, draft[key]) })}</Text>
      </View>)}
      {!dirty && <Text className="text-muted-foreground">{label('no_differences')}</Text>}
    </View>}
    <ChoiceChips<'auto' | 'manual'> label={label('approval_mode')} selected={draft.approval} onSelect={value => { if (value) change('approval', value); }}
      options={(['auto', 'manual'] as const).map(value => ({ value, label: label(`approval_modes.${value}`), disabled }))} />
    {field('opens', 'opens_at')}{field('closes', 'closes_at')}
    <Text className="text-sm text-muted-foreground">{label('window_hint')}</Text>
    {field('cutoff', 'cancellation_cutoff')}{field('memberLimit', 'per_member_limit', true)}
    <ChoiceChips<'yes' | 'no'> label={label('guests_enabled')} selected={draft.guests ? 'yes' : 'no'} onSelect={value => { if (value) change('guests', value === 'yes'); }}
      options={(['yes', 'no'] as const).map(value => ({ value, label: t(`common:${value}`), disabled }))} />
    {draft.guests && field('maxGuests', 'max_guests', true)}{field('retentionDays', 'guest_retention', true)}
    {invalid && <Text accessibilityRole="alert" className="text-danger">{label('invalid')}</Text>}
    <Button isDisabled={disabled} onPress={() => requestAction(false)}>{label('save')}</Button>
    {settings?.status === 'draft' && <Button isDisabled={disabled || dirty} onPress={() => requestAction(true)}>{label('publish')}</Button>}
    {confirmDialog}
  </View>;
}
