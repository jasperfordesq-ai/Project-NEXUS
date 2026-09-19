// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ChoiceChips from '@/components/ui/ChoiceChips';
import { Button } from '@/components/ui/NativeButton';
import type { RegistrationQuestionDraft } from '@/lib/eventRegistrationFormDraft';
import { registrationConditionOperators } from '@/lib/eventRegistrationFormRules';
import EventRegistrationConditionValue from './EventRegistrationConditionValue';
type Condition = { question_key: string; operator: string; value?: unknown };
type Props = { question: RegistrationQuestionDraft; earlier: readonly RegistrationQuestionDraft[];
  disabled: boolean; onChange: (question: RegistrationQuestionDraft) => void };
export default function EventRegistrationVisibilityEditor({ question, earlier, disabled, onChange }: Props) {
  const { t } = useTranslation(['eventRegistration', 'common']);
  const rules = question.visibility_rules;
  const raw = rules?.conditions;
  const conditions: Condition[] = Array.isArray(raw) && raw.every(item => item && typeof item === 'object'
    && typeof item.question_key === 'string' && typeof item.operator === 'string') ? raw : [];
  function change(next: Record<string, unknown> | null) { if (!disabled) onChange({ ...question, visibility_rules: next }); }
  function update(index: number, next: Condition) {
    change({ ...rules, conditions: conditions.map((condition, at) => at === index ? next : condition) });
  }
  const newCondition = () => ({ question_key: earlier[0]?.stable_key ?? '', operator: 'is_answered' });
  return <View className="gap-3">
    <ChoiceChips<'yes' | 'no'> label={t('forms.editor.conditional')} selected={rules ? 'yes' : 'no'}
      options={(['yes', 'no'] as const).map(value => ({ value, label: t(`common:${value}`), disabled: disabled || (value === 'yes' && !earlier.length && !rules) }))}
      onSelect={value => { if (value === 'no') change(null); else if (value === 'yes' && !rules && earlier.length) change({ match: 'all', conditions: [newCondition()] }); }} />
    {rules && <>
      {!conditions.length && <Text accessibilityRole="alert" className="text-danger">{t('forms.editor.invalid')}</Text>}
      <ChoiceChips label={t('forms.editor.condition_match')} selected={String(rules.match)}
        options={(['all', 'any'] as const).map(value => ({ value, label: t(`forms.editor.match.${value}`), disabled }))}
        onSelect={value => { if (value) change({ ...rules, match: value }); }} />
      {conditions.map((condition, index) => <View key={index} className="gap-3 rounded-panel border border-border p-3">
        <ChoiceChips label={t('forms.editor.condition_question')} selected={condition.question_key}
          options={earlier.map((item, at) => ({ value: item.stable_key, label: item.prompt || t('forms.editor.question', { number: at + 1 }), disabled }))}
          onSelect={value => { if (value) update(index, { ...condition, question_key: value }); }} />
        <ChoiceChips label={t('forms.editor.condition_operator')} selected={condition.operator}
          options={registrationConditionOperators.map(value => ({ value, label: t(`operators.${value}`), disabled }))}
          onSelect={operator => {
            if (!operator) return;
            const { value: previous, ...rest } = condition;
            update(index, ['is_answered', 'is_not_answered'].includes(operator)
              ? { ...rest, operator } : { ...rest, operator, value: Object.hasOwn(condition, 'value') ? previous : '' });
          }} />
        {!['is_answered', 'is_not_answered'].includes(condition.operator) && <EventRegistrationConditionValue value={condition.value}
          disabled={disabled} onChange={value => update(index, { ...condition, value })} />}
        <Button isDisabled={disabled} onPress={() => {
          const next = conditions.filter((_, at) => at !== index);
          change(next.length ? { ...rules, conditions: next } : null);
        }}>{t('forms.editor.remove_condition')}</Button>
      </View>)}
      <Button isDisabled={disabled || !earlier.length || conditions.length >= 20}
        onPress={() => { if (earlier.length && conditions.length < 20) change({ ...rules, conditions: [...conditions, newCondition()] }); }}>
        {t('forms.editor.add_condition')}</Button>
    </>}
  </View>;
}
