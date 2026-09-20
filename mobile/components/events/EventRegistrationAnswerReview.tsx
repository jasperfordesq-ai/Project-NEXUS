// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useEffect, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Input from '@/components/ui/Input';
import { Button } from '@/components/ui/NativeButton';
import { useRegistrationAnswerReview } from '@/lib/hooks/useRegistrationAnswerReview';
import { isRefusalStatus } from '@/lib/api/refusal';
import type { OrganizerRegistrationForm } from '@/lib/api/eventRegistration';
interface Props { tenantId: number; userId: number; eventId: number; submissionId: number; revision: number;
  form?: OrganizerRegistrationForm; permitted: boolean; sensitive: boolean; active: boolean; onClose: () => void; onErrorLayout?: () => void }
export default function EventRegistrationAnswerReview({ form, permitted, sensitive, active, onClose, onErrorLayout, ...scope }: Props) {
  const { t } = useTranslation(['eventRegistration', 'events', 'common']);
  const [purpose, setPurpose] = useState(''); const [reference, setReference] = useState('');
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const review = useRegistrationAnswerReview(scope, permitted, sensitive, active);
  useEffect(() => { if (!active || !permitted) { setPurpose(''); setReference(''); setIncludeSensitive(false); } }, [active, permitted]);
  useEffect(() => { if (!sensitive) setIncludeSensitive(false); }, [sensitive]);
  const busy = review.status === 'loading';
  const valid = Boolean(purpose.trim() && reference.trim()) && Array.from(purpose.trim()).length <= 500
    && new TextEncoder().encode(reference.trim()).length <= 512;
  const entries = Object.entries(review.answers ?? {});
  const display = (value: unknown): string => typeof value === 'boolean' ? t(value ? 'common:yes' : 'common:no')
    : typeof value === 'string' || typeof value === 'number' ? String(value)
    : Array.isArray(value) && value.every(item => typeof item === 'string') ? value.join('\n')
    : t('submissions.unavailable_answer');
  if (!active || !permitted) return null;
  return <View className="gap-4">
    <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{t('submissions.review_title')}</Text>
    <Button variant="secondary" onPress={() => { review.clear(); onClose(); }}>{t('common:close')}</Button>
    <Text className="font-semibold text-foreground">{t('submissions.audit_title')}</Text>
    <Text className="text-muted-foreground">{t('submissions.audit_description')}</Text>
    <Input label={t('submissions.purpose')} value={purpose} editable={!busy} multiline onChangeText={value => { review.clear(); setPurpose(value); }} />
    <Input label={t('submissions.correlation')} value={reference} editable={!busy} onChangeText={value => { review.clear(); setReference(value); }} />
    {sensitive && <View className="gap-2"><Text className="text-foreground">{t('submissions.include_sensitive')}</Text>
      <View className="flex-row flex-wrap gap-2">{[false, true].map(value => <Button key={String(value)} variant={includeSensitive === value ? 'primary' : 'secondary'}
        accessibilityState={{ selected: includeSensitive === value }} isDisabled={busy} onPress={() => { review.clear(); setIncludeSensitive(value); }}>
        {t(value ? 'common:yes' : 'common:no')}</Button>)}</View></View>}
    <Button isDisabled={!valid || busy} onPress={() => { Keyboard.dismiss(); void review.open({ purpose, correlation_id: reference, include_sensitive: includeSensitive && sensitive }); }}>
      {t(busy ? 'common:loading' : 'submissions.open_answers')}</Button>
    {review.status === 'failed' && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" onLayout={onErrorLayout} className="text-danger">{t(isRefusalStatus(review.errorStatus) ? 'events:manage.access_denied_title' : 'messages.review_error')}</Text>}
    {review.status === 'ready' && entries.length === 0 && <Text className="text-muted-foreground">{t('submissions.no_readable_answers')}</Text>}
    {entries.map(([key, answer], index) => { const question = form?.questions.find(item => item.stable_key === key && item.id === answer.question_id);
      return <View key={key} className="gap-2 border-b border-separator pb-3">
        <Text className="font-semibold text-foreground">{question?.prompt ?? t('forms.editor.question', { number: index + 1 })}</Text>
        <Text className="text-muted-foreground">{t('classifications.' + answer.classification)}</Text>
        <Text selectable className="text-foreground">{answer.purged ? t('submissions.purged') : display(answer.value)}</Text>
      </View>;
    })}
  </View>;
}
