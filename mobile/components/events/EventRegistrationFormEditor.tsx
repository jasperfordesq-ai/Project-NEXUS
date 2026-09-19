// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Input from '@/components/ui/Input';
import { Button } from '@/components/ui/NativeButton';
import { useConfirm } from '@/components/ui/useConfirm';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import type { OrganizerRegistrationForm, RegistrationFormDefinition } from '@/lib/api/eventRegistration';
import { registrationFormDraft, registrationFormPayload, newRegistrationQuestion, hasValidQuestionOrder,
  moveRegistrationQuestion, removeRegistrationQuestion, type RegistrationFormDraft } from '@/lib/eventRegistrationFormDraft';
import EventRegistrationQuestionEditor from './EventRegistrationQuestionEditor';
import EventRegistrationFormComparison from './EventRegistrationFormComparison';

type Props = { form: OrganizerRegistrationForm | null; blocked: boolean; recovered?: RegistrationFormDefinition; createRevision?: boolean;
  onSave: (definition: RegistrationFormDefinition) => Promise<void> };
/** Parent keys by owner/event/form revision and handles transport recovery and publication. */
export default function EventRegistrationFormEditor({ form, blocked, recovered, createRevision = false, onSave }: Props) {
  const { t } = useTranslation(['eventRegistration', 'common']);
  const initial = useRef<RegistrationFormDraft>(form ? registrationFormDraft(form)
    : { name: '', description: '', questions: [newRegistrationQuestion([])] });
  const [draft, setDraft] = useState(() => recovered ? registrationFormDraft(recovered) : initial.current);
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const copyingPublished = createRevision && Boolean(recovered) && form?.status === 'published';
  const disabled = blocked || busy || (form?.status === 'published' && !copyingPublished);
  const current = useRef({ draft, disabled }); current.current = { draft, disabled };
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current);
  const { confirm, confirmDialog } = useConfirm();
  useUnsavedChangesGuard({ isDirty: dirty, isSaving: busy, confirm,
    title: t('common:unsavedChanges.title'), message: t('common:unsavedChanges.message'),
    discardLabel: t('common:unsavedChanges.discard'), cancelLabel: t('common:buttons.cancel') });
  function change(next: RegistrationFormDraft | null) {
    if (!next || !mounted.current || current.current.disabled || current.current.draft !== draft) return;
    setDraft(next); setInvalid(false); setFailed(false);
  }
  async function save() {
    if (!mounted.current || current.current.disabled || lock.current || current.current.draft !== draft) return;
    const payload = registrationFormPayload(draft);
    if (!payload || !hasValidQuestionOrder(draft.questions)) { setInvalid(true); return; }
    lock.current = true; setBusy(true); setFailed(false);
    try { await onSave(payload); }
    catch { if (mounted.current) setFailed(true); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <View className="gap-4">
    <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">
      {t(form?.status === 'published' ? 'forms.title' : form ? 'forms.editor.edit_title' : 'forms.editor.create_title')}
    </Text>
    <Text className="text-muted-foreground">{t('forms.editor.rules_description')}</Text>
    {recovered && <EventRegistrationFormComparison current={form ? initial.current : { name: '', description: '', questions: [] }} proposed={draft} />}
    <Input label={t('forms.editor.name')} accessibilityLabel={t('forms.editor.name')} value={draft.name}
      maxLength={191} editable={!disabled} onChangeText={name => change({ ...draft, name })} />
    <Input label={t('forms.editor.description')} accessibilityLabel={t('forms.editor.description')} value={draft.description}
      multiline maxLength={4000} editable={!disabled} onChangeText={description => change({ ...draft, description })} />
    {draft.questions.map((question, index) => <View key={question.stable_key} className="gap-3 rounded-panel border border-border p-4">
      <EventRegistrationQuestionEditor question={question} number={index + 1} disabled={disabled} earlier={draft.questions.slice(0, index)}
        onChange={next => change({ ...draft, questions: draft.questions.map((item, at) => at === index ? next : item) })} />
      <Button isDisabled={disabled || !moveRegistrationQuestion(draft, index, index - 1)}
        onPress={() => change(moveRegistrationQuestion(draft, index, index - 1))}>{t('forms.editor.move_up')}</Button>
      <Button isDisabled={disabled || !moveRegistrationQuestion(draft, index, index + 1)}
        onPress={() => change(moveRegistrationQuestion(draft, index, index + 1))}>{t('forms.editor.move_down')}</Button>
      <Button isDisabled={disabled || !removeRegistrationQuestion(draft, index)} onPress={() => {
        if (current.current.disabled || !removeRegistrationQuestion(draft, index)) return;
        confirm({ title: t('forms.editor.remove'), message: question.prompt || t('forms.editor.question', { number: index + 1 }),
          confirmLabel: t('forms.editor.remove'), cancelLabel: t('common:buttons.cancel'),
          onConfirm: () => change(removeRegistrationQuestion(draft, index)) });
      }}>{t('forms.editor.remove')}</Button>
    </View>)}
    <Button isDisabled={disabled || draft.questions.length >= 100}
      onPress={() => change({ ...draft, questions: [...draft.questions, newRegistrationQuestion(draft.questions)] })}>
      {t('forms.editor.add_question')}
    </Button>
    {invalid && <Text accessibilityRole="alert" className="text-danger">{t('forms.editor.invalid')}</Text>}
    {failed && <Text accessibilityRole="alert" className="text-danger">{t('messages.form_save_error')}</Text>}
    <Button isDisabled={disabled} onPress={() => {
      if (disabled) return;
      if (copyingPublished) confirm({ title: t('forms.create_revision'), message: t('forms.editor.rules_description'),
        confirmLabel: t('forms.create_revision'), cancelLabel: t('common:buttons.cancel'), onConfirm: save });
      else void save();
    }}>{t(copyingPublished ? 'forms.create_revision' : 'common.save')}</Button>
    {confirmDialog}
  </View>;
}
