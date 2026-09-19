// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { registrationFormDefinitionSchema, type RegistrationFormDefinition, type OrganizerRegistrationForm } from './api/eventRegistration';

type Question = RegistrationFormDefinition['questions'][number];
export type RegistrationQuestionDraft = Omit<Question, 'retention_days' | 'choice_options'> & {
  retention_days: string; choice_options: string[];
};
export interface RegistrationFormDraft { name: string; description: string; questions: RegistrationQuestionDraft[] }
export function registrationFormDraft(form: Pick<OrganizerRegistrationForm, 'name' | 'description' | 'questions'> | RegistrationFormDefinition): RegistrationFormDraft {
  return { name: form.name, description: form.description ?? '', questions: form.questions.map(question => {
    // Strip response identity fields, while retaining every authored rule and evidence field.
    const { id: _id, position: _position, ...input } = question as Question & { id?: number; position?: number };
    return { ...input, retention_days: String(question.retention_days), choice_options: [...(question.choice_options ?? [])] };
  }) };
}
export function registrationFormPayload(draft: RegistrationFormDraft): RegistrationFormDefinition | null {
  if (draft.questions.some(question => !/^\d+$/.test(question.retention_days))) return null;
  const parsed = registrationFormDefinitionSchema.safeParse({ ...draft, questions: draft.questions.map(question => ({
    ...question, retention_days: Number(question.retention_days),
    choice_options: question.question_type === 'single_choice' || question.question_type === 'multiple_choice'
      ? question.choice_options.map(choice => choice.trim()) : null,
  })) });
  return parsed.success ? parsed.data : null;
}
export function newRegistrationQuestion(existing: readonly RegistrationQuestionDraft[]): RegistrationQuestionDraft {
  let number = existing.length + 1;
  while (existing.some(question => question.stable_key === `question_${number}`)) number++;
  return { stable_key: `question_${number}`, question_type: 'short_text', prompt: '', help_text: null,
    is_required: false, data_classification: 'internal', purpose: '', retention_days: '30', choice_options: [],
    validation_rules: null, visibility_rules: null, displayed_text: null, displayed_text_version: null };
}

/** Never silently drop a condition when moving/removing its source question. */
export function hasValidQuestionOrder(questions: readonly RegistrationQuestionDraft[]): boolean {
  const earlier = new Set<string>();
  for (const question of questions) {
    if (earlier.has(question.stable_key)) return false;
    const rules = question.visibility_rules;
    if (rules != null) {
      if (!Array.isArray(rules.conditions)) return false;
      for (const condition of rules.conditions) {
        if (!condition || typeof condition !== 'object' || typeof condition.question_key !== 'string'
          || !earlier.has(condition.question_key)) return false;
      }
    }
    earlier.add(question.stable_key);
  }
  return true;
}
export function moveRegistrationQuestion(draft: RegistrationFormDraft, from: number, to: number): RegistrationFormDraft | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0
    || from >= draft.questions.length || to >= draft.questions.length) return null;
  const questions = [...draft.questions];
  const [question] = questions.splice(from, 1);
  questions.splice(to, 0, question);
  return hasValidQuestionOrder(questions) ? { ...draft, questions } : null;
}
export function removeRegistrationQuestion(draft: RegistrationFormDraft, index: number): RegistrationFormDraft | null {
  if (!Number.isInteger(index) || index < 0 || index >= draft.questions.length || draft.questions.length <= 1) return null;
  const questions = draft.questions.filter((_, at) => at !== index);
  return hasValidQuestionOrder(questions) ? { ...draft, questions } : null;
}
