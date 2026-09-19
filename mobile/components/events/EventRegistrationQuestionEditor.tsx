// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Input from '@/components/ui/Input';
import ChoiceChips from '@/components/ui/ChoiceChips';
import { Button } from '@/components/ui/NativeButton';
import type { RegistrationQuestionDraft } from '@/lib/eventRegistrationFormDraft';
import EventRegistrationValidationEditor from './EventRegistrationValidationEditor';
import EventRegistrationVisibilityEditor from './EventRegistrationVisibilityEditor';

type Props = { question: RegistrationQuestionDraft; number: number; disabled: boolean; earlier?: readonly RegistrationQuestionDraft[];
  onChange: (question: RegistrationQuestionDraft) => void };
const types = ['short_text', 'long_text', 'single_choice', 'multiple_choice', 'dietary', 'accessibility', 'consent', 'waiver'] as const;
const classifications = ['public', 'internal', 'confidential', 'sensitive'] as const;
const textTypes: readonly string[] = ['short_text', 'long_text', 'dietary', 'accessibility'];
/** Controlled metadata editor; parent owns ordering, conditional rules, validation and persistence. */
export default function EventRegistrationQuestionEditor({ question, number, disabled, onChange, earlier = [] }: Props) {
  const { t } = useTranslation(['eventRegistration', 'common']);
  const label = (key: string) => t(`forms.editor.${key}`);
  const patch = (changes: Partial<RegistrationQuestionDraft>) => { if (!disabled) onChange({ ...question, ...changes }); };
  const field = (key: 'prompt' | 'help_text' | 'purpose' | 'retention_days' | 'displayed_text' | 'displayed_text_version',
    title: string, maxLength: number, multiline = false) => <Input label={label(title)} accessibilityLabel={label(title)}
    value={question[key] ?? ''} onChangeText={value => patch({ [key]: value })} editable={!disabled}
    maxLength={maxLength} multiline={multiline} keyboardType={key === 'retention_days' ? 'number-pad' : 'default'} />;
  const consent = question.question_type === 'consent' || question.question_type === 'waiver';
  const choice = question.question_type === 'single_choice' || question.question_type === 'multiple_choice';
  return <View className="gap-3">
    <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{t('forms.editor.question', { number })}</Text>
    <ChoiceChips label={label('type')} selected={question.question_type}
      options={types.map(value => ({ value, label: t(`question_types.${value}`), disabled }))}
      onSelect={value => {
        if (!value || value === question.question_type) return;
        // An explicit type change resets only fields that do not apply to the new type.
        const nextChoice = value === 'single_choice' || value === 'multiple_choice';
        const nextConsent = value === 'consent' || value === 'waiver';
        // Keep authored limits within a field family, even when the new type needs
        // tighter limits. Save validation then asks for correction instead of losing them.
        const sameRuleFamily = (choice && nextChoice)
          || (textTypes.includes(question.question_type) && textTypes.includes(value));
        patch({ question_type: value, validation_rules: sameRuleFamily ? question.validation_rules : null,
          choice_options: nextChoice ? (choice ? question.choice_options : ['', '']) : [],
          displayed_text: nextConsent && consent ? question.displayed_text : null,
          displayed_text_version: nextConsent && consent ? question.displayed_text_version : null });
      }} />
    {field('prompt', 'prompt', 2000, true)}{field('help_text', 'help_text', 4000, true)}
    <ChoiceChips label={label('classification')} selected={question.data_classification}
      options={classifications.map(value => ({ value, label: t(`classifications.${value}`), disabled }))}
      onSelect={value => { if (value) patch({ data_classification: value }); }} />
    {field('purpose', 'purpose', 500, true)}{field('retention_days', 'retention_days', 5)}
    <ChoiceChips<'yes' | 'no'> label={label('required')} selected={question.is_required ? 'yes' : 'no'}
      options={(['yes', 'no'] as const).map(value => ({ value, label: t(`common:${value}`), disabled }))}
      onSelect={value => { if (value) patch({ is_required: value === 'yes' }); }} />
    {choice && <View className="gap-3">
      {question.choice_options.map((value, index) => <View key={index} className="gap-2">
        <Input label={t('forms.editor.choice_number', { number: index + 1 })}
          accessibilityLabel={t('forms.editor.choice_number', { number: index + 1 })}
          value={value} multiline maxLength={191} editable={!disabled}
          onChangeText={text => patch({ choice_options: question.choice_options.map((entry, at) => at === index ? text : entry) })} />
        <Button isDisabled={disabled || question.choice_options.length <= 2}
          onPress={() => patch({ choice_options: question.choice_options.filter((_, at) => at !== index) })}>
          {t('forms.editor.remove_choice', { number: index + 1 })}
        </Button>
      </View>)}
      <Button isDisabled={disabled || question.choice_options.length >= 100}
        onPress={() => patch({ choice_options: [...question.choice_options, ''] })}>{label('add_choice')}</Button>
    </View>}
    {consent && <>{field('displayed_text', 'displayed_text', 20000, true)}{field('displayed_text_version', 'displayed_version', 64)}</>}
    <EventRegistrationValidationEditor question={question} disabled={disabled} onChange={onChange} />
    <EventRegistrationVisibilityEditor question={question} earlier={earlier} disabled={disabled} onChange={onChange} />
  </View>;
}
