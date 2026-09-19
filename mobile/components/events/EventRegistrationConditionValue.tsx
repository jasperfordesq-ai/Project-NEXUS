// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Input from '@/components/ui/Input';
import ChoiceChips from '@/components/ui/ChoiceChips';
import { Button } from '@/components/ui/NativeButton';

export default function EventRegistrationConditionValue({ value, disabled, onChange, scalarOnly = false }: {
  value: unknown; disabled: boolean; onChange: (value: unknown) => void; scalarOnly?: boolean;
}) {
  const { t } = useTranslation(['eventRegistration', 'common']);
  const invalidNumber = value !== null && typeof value === 'object' && !Array.isArray(value)
    && 'invalidNumber' in value && typeof value.invalidNumber === 'string' ? value.invalidNumber : null;
  const kind = Array.isArray(value) ? 'list' : typeof value === 'boolean' ? 'boolean'
    : typeof value === 'number' || invalidNumber !== null ? 'number' : 'text';
  const change = (next: unknown) => { if (!disabled) onChange(next); };
  return <View className="gap-2">
    <ChoiceChips label={t('forms.editor.value_type')} selected={kind}
      options={(scalarOnly ? ['text', 'number', 'boolean'] : ['text', 'number', 'boolean', 'list']).map(type => ({
        value: type, label: t(`forms.editor.value_types.${type}`), disabled,
      }))} onSelect={type => { if (type && type !== kind) change(type === 'text' ? '' : type === 'number' ? 0 : type === 'boolean' ? false : []); }} />
    {kind === 'boolean' ? <ChoiceChips<'yes' | 'no'> selected={value ? 'yes' : 'no'}
      label={t('forms.editor.condition_value')} options={(['yes', 'no'] as const).map(entry => ({ value: entry, label: t(`common:${entry}`), disabled }))}
      onSelect={entry => { if (entry) change(entry === 'yes'); }} />
      : kind === 'list' && Array.isArray(value) ? <View className="gap-3">
        {value.map((item, index) => <View key={index} className="gap-2">
          <EventRegistrationConditionValue value={item} disabled={disabled} scalarOnly
            onChange={next => change(value.map((entry, at) => at === index ? next : entry))} />
          <Button isDisabled={disabled} onPress={() => change(value.filter((_, at) => at !== index))}>{t('forms.editor.remove_value')}</Button>
        </View>)}
        <Button isDisabled={disabled || value.length >= 100} onPress={() => change([...value, ''])}>{t('forms.editor.add_value')}</Button>
      </View> : <Input label={t('forms.editor.condition_value')} accessibilityLabel={t('forms.editor.condition_value')}
        value={invalidNumber ?? (typeof value === 'string' || typeof value === 'number' ? String(value) : '')}
        editable={!disabled} keyboardType={kind === 'number' ? 'numbers-and-punctuation' : 'default'}
        onChangeText={text => {
          if (kind !== 'number') { change(text); return; }
          const number = Number(text);
          // Keep unfinished numeric input distinct from a valid string condition.
          change(text.trim() !== '' && /^-?(?:\d+|\d*\.\d+)$/.test(text) && Number.isFinite(number)
            ? number : { invalidNumber: text });
        }} />}
  </View>;
}
