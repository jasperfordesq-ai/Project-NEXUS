// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner, 9 Nov 2026: "if my language is set to English and the text is
 * English, there's no need for a translate button. If my language is set to
 * English and text anywhere on the site is in a different language, then there
 * should be a translate button there." Short texts the words alone cannot
 * decide ("E088 Media Test Group") are now asked about: the server says which
 * language they are in.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.unmock('@/lib/textLanguage/detectLanguage');
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
// TranslateButton reads only isAuthenticated and the user's community.
const member = (fields: Record<string, unknown>) => fields as unknown as User;
const auth = vi.hoisted(() => ({ value: { isAuthenticated: true, user: null as User | null } }));
vi.mock('@/contexts', () => createMockContexts({
  useAuthOptional: () => ({
    user: auth.value.user, isAuthenticated: auth.value.isAuthenticated,
    login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(),
    status: 'idle' as const, error: null,
  }),
}));

import { api } from '@/lib/api';
import type { User } from '@/types/api';
import { TranslateButton } from './TranslateButton';
import { loadVocabulary } from '@/lib/textLanguage/useReaderVocabulary';
import { forgetTextLanguages } from '@/lib/textLanguage/detectLanguage';

const button = () => screen.queryByRole('button', { name: /^translate/i });
const languageQuestions = () => vi.mocked(api.post).mock.calls.filter(([url]) => url === '/v2/ugc-language');

function serverSays(...answers: Array<{ language: string; confidence: number } | null>) {
  vi.mocked(api.post).mockImplementation(async (url) => (url === '/v2/ugc-language'
    ? { success: true, data: { detections: answers } }
    : { success: true, data: null }));
}

describe('TranslateButton — the server says which language a text is in', () => {
  beforeAll(async () => { await loadVocabulary('eng'); });
  beforeEach(() => {
    vi.clearAllMocks();
    forgetTextLanguages();
    auth.value = { isAuthenticated: true, user: member({ id: 7, tenant_id: 2 }) };
  });

  it('leaves the button out when a short text is in the reader\'s language (the E088 group)', async () => {
    serverSays({ language: 'en', confidence: 0.92 }, { language: 'en', confidence: 0.98 });
    render(<TranslateButton contentType="group_description" contentId={980}
      sourceText="Security testing group for media uploads E088." extraFields={{ name: 'E088 Media Test Group' }} />);

    await waitFor(() => expect(languageQuestions()).toHaveLength(1));
    expect(languageQuestions()[0]![1]).toEqual({ texts: ['Security testing group for media uploads E088.', 'E088 Media Test Group'] });
    await waitFor(() => expect(button()).toBeNull());
  });

  it('offers it when a short text is in another language', async () => {
    serverSays({ language: 'es', confidence: 0.97 });
    render(<TranslateButton contentType="comment" contentId={1} sourceText="¡Muchas gracias!" />);

    expect(await screen.findByRole('button', { name: /^translate/i })).toBeInTheDocument();
  });

  it('does not flash the button while waiting for the answer', async () => {
    let answer: (value: unknown) => void = () => {};
    vi.mocked(api.post).mockImplementation(() => new Promise((resolve) => { answer = resolve as (value: unknown) => void; }));
    render(<TranslateButton contentType="comment" contentId={2} sourceText="Thanks so much!" />);

    await waitFor(() => expect(languageQuestions()).toHaveLength(1));
    expect(button()).toBeNull();
    answer({ success: true, data: { detections: [{ language: 'en', confidence: 0.99 }] } });
    await waitFor(() => expect(languageQuestions()).toHaveLength(1));
    expect(button()).toBeNull();
  });

  it('keeps the button when the language is not known', async () => {
    serverSays(null);
    render(<TranslateButton contentType="comment" contentId={3} sourceText="Thanks so much!" />);

    expect(await screen.findByRole('button', { name: /^translate/i })).toBeInTheDocument();
  });

  it('keeps the button when the server cannot be reached', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('offline'));
    render(<TranslateButton contentType="comment" contentId={4} sourceText="Thanks so much!" />);

    expect(await screen.findByRole('button', { name: /^translate/i })).toBeInTheDocument();
  });

  it('keeps it when an unsure answer is contradicted by the words', async () => {
    serverSays({ language: 'en', confidence: 0.3 });
    render(<TranslateButton contentType="comment" contentId={5} sourceText="Ayuda con jardinería" />);

    expect(await screen.findByRole('button', { name: /^translate/i })).toBeInTheDocument();
  });

  it('does not ask when the words already show it is in the reader\'s language', async () => {
    serverSays({ language: 'en', confidence: 1 });
    render(<TranslateButton contentType="feed_post" contentId={6}
      sourceText="Please remember to log your hours after each exchange so the balance stays accurate." />);

    expect(button()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(languageQuestions()).toHaveLength(0);
  });

  it('does not ask for a visitor who is not signed in, and keeps the button as before', async () => {
    auth.value = { isAuthenticated: false, user: null };
    serverSays({ language: 'en', confidence: 1 });
    render(<TranslateButton contentType="comment" contentId={7} sourceText="Thanks so much!" />);

    expect(button()).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(languageQuestions()).toHaveLength(0);
  });

  it('does not ask for a manager visiting another community (their requests there are read-only)', async () => {
    auth.value = { isAuthenticated: true, user: member({ id: 8, tenant_id: 1, is_tenant_super_admin: true }) };
    serverSays({ language: 'en', confidence: 1 });
    render(<TranslateButton contentType="comment" contentId={8} sourceText="Thanks so much!" />);

    expect(button()).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(languageQuestions()).toHaveLength(0);
  });
});
