// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Input from '@/components/ui/Input';
import ChoiceChips from '@/components/ui/ChoiceChips';
import type { RegistrationQuestionDraft } from '@/lib/eventRegistrationFormDraft';

type Props = { question: RegistrationQuestionDraft; disabled: boolean;
  onChange: (question: RegistrationQuestionDraft) => void };
export default function EventRegistrationValidationEditor({ question, disabled, onChange }: Props) {
  const { t } = useTranslation('eventRegistration');
  const text = ['short_text', 'long_text', 'dietary', 'accessibility'].includes(question.question_type);
  const choice = ['single_choice', 'multiple_choice'].includes(question.question_type);
  if (!text && !choice) return null;
  const rules = question.validation_rules ?? {};
  function change(key: string, value: string, numeric = false) {
    if (disabled) return;
    const next = { ...rules };
    if (value === '') delete next[key];
    else next[key] = numeric && /^\d+$/.test(value) ? Number(value) : value;
    onChange({ ...question, validation_rules: Object.keys(next).length ? next : null });
  }
  return <View className="gap-3">
    {(text ? ['min_length', 'max_length'] : ['min_selections', 'max_selections']).map(key => <Input key={key}
      label={t(`forms.editor.${key}`)} accessibilityLabel={t(`forms.editor.${key}`)}
      value={rules[key] == null ? '' : String(rules[key])} keyboardType="number-pad" editable={!disabled}
      onChangeText={value => change(key, value, true)} />)}
    {text && <ChoiceChips label={t('forms.editor.answer_format')} selected={typeof rules.format === 'string' ? rules.format : 'none'}
      options={(['none', 'email', 'phone', 'url'] as const).map(value => ({ value, label: t(`forms.editor.formats.${value}`), disabled }))}
      onSelect={value => { if (value) change('format', value === 'none' ? '' : value); }} />}
  </View>;
}
