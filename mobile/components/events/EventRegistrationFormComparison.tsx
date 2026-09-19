// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/NativeButton';
import type { RegistrationFormDraft } from '@/lib/eventRegistrationFormDraft';
import EventRegistrationQuestionEditor from './EventRegistrationQuestionEditor';

const noChange = () => undefined;
/** Show both complete definitions for changed questions, including all authored rules. */
export default function EventRegistrationFormComparison({ current, proposed }: {
  current: RegistrationFormDraft; proposed: RegistrationFormDraft;
}) {
  const { t } = useTranslation(['eventRegistration', 'events']);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const keys = [...new Set([...current.questions, ...proposed.questions].map(question => question.stable_key))];
  const changes = keys.map(key => ({ key,
    before: current.questions.findIndex(question => question.stable_key === key),
    after: proposed.questions.findIndex(question => question.stable_key === key),
  })).filter(({ before, after }) => before !== after
    || JSON.stringify(current.questions[before]) !== JSON.stringify(proposed.questions[after]));
  const details = (['name', 'description'] as const).filter(key => current[key] !== proposed[key]);
  return <View className="gap-3 rounded-panel border border-border p-4">
    <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{t('forms.editor.comparison')}</Text>
    {details.map(key => <View key={key} className="gap-1">
      <Text className="font-semibold text-foreground">{t(`forms.editor.${key}`)}</Text>
      <Text className="text-muted-foreground">{t('events:registrationSettings.current_value', { value: current[key] || t('common.not_recorded') })}</Text>
      <Text className="text-foreground">{t('events:registrationSettings.proposed_value', { value: proposed[key] || t('common.not_recorded') })}</Text>
    </View>)}
    {changes.map(({ key, before, after }) => <View key={key} className="gap-3">
      <Button accessibilityState={{ expanded: Boolean(expanded[key]) }} onPress={() => setExpanded(previous => ({ ...previous, [key]: !previous[key] }))}>
        {(after >= 0 ? proposed.questions[after] : current.questions[before]).prompt || t('forms.editor.question', { number: Math.max(before, after) + 1 })}
      </Button>
      <Text className="text-muted-foreground">{t('forms.editor.current')}: {before < 0 ? t('forms.editor.absent') : t('forms.editor.question', { number: before + 1 })}</Text>
      <Text className="text-foreground">{t('forms.editor.proposed')}: {after < 0 ? t('forms.editor.absent') : t('forms.editor.question', { number: after + 1 })}</Text>
      {expanded[key] && <>
        {before >= 0 && <View className="gap-2">
          <Text accessibilityRole="header" className="font-semibold text-foreground">{t('forms.editor.current')}</Text>
          <EventRegistrationQuestionEditor question={current.questions[before]} number={before + 1} disabled
            earlier={current.questions.slice(0, before)} onChange={noChange} />
        </View>}
        {after >= 0 && <View className="gap-2">
          <Text accessibilityRole="header" className="font-semibold text-foreground">{t('forms.editor.proposed')}</Text>
          <EventRegistrationQuestionEditor question={proposed.questions[after]} number={after + 1} disabled
            earlier={proposed.questions.slice(0, after)} onChange={noChange} />
        </View>}
      </>}
    </View>)}
    {!details.length && !changes.length && <Text className="text-muted-foreground">{t('events:registrationSettings.no_differences')}</Text>}
  </View>;
}
