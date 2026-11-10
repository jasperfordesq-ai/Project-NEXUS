// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner, 9 Nov 2026: Translate only when the text is in another language. When
 * the word check cannot tell (short texts), the app asks the server's language
 * check — the same rule as the website (TranslateButton.detectedLanguage.test).
 */

jest.unmock('@/lib/textLanguage/detectLanguage');

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import ContentTranslation from './ContentTranslation';
import { UgcTranslationPreferencesProvider } from '@/lib/context/UgcTranslationPreferencesContext';
import { api } from '@/lib/api/client';
import { getUserPreferences } from '@/lib/api/settings';
import { forgetTextLanguages } from '@/lib/textLanguage/detectLanguage';
import { loadReaderVocabulary } from '@/lib/textLanguage/readerVocabulary';

let mockSignedIn = true;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: 2, translation: { enabled: true } } }) }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: mockSignedIn ? { id: 7 } : null }) }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textMuted: '#444', textSecondary: '#333' }) }));
jest.mock('@/lib/api/client', () => ({ api: { post: jest.fn() } }));
jest.mock('@/lib/api/settings', () => ({ getUserPreferences: jest.fn() }));
jest.mock('@/components/ui/NativeButton', () => {
  const { Pressable, Text } = require('react-native');
  const Button = ({ children, isDisabled, ...props }: any) => <Pressable disabled={isDisabled} {...props}>{children}</Pressable>;
  Button.Label = Text;
  return { Button };
});

const post = jest.mocked(api.post);
let detections: ({ language: string; confidence: number } | null)[] | Error = [];

function languageCalls() {
  return post.mock.calls.filter(([url]) => url === '/api/v2/ugc-language');
}

const view = (node: React.ReactNode) => <UgcTranslationPreferencesProvider>{node}</UgcTranslationPreferencesProvider>;

beforeEach(() => {
  jest.resetAllMocks();
  forgetTextLanguages();
  mockSignedIn = true;
  detections = [];
  jest.mocked(getUserPreferences).mockResolvedValue({ translation: { auto_translate_ugc: false } });
  post.mockImplementation(async (url: string, body: unknown) => {
    if (url === '/api/v2/ugc-language') {
      if (detections instanceof Error) throw detections;
      const texts = (body as { texts: string[] }).texts;
      return { data: { detections: texts.map((_, i) => (detections as unknown[])[i] ?? null) } };
    }
    return { data: { translated_text: 'Traducido' } };
  });
});

test('no Translate button when the server says a short text is in the reader\'s language', async () => {
  detections = [{ language: 'en', confidence: 0.95 }];
  const screen = render(view(<ContentTranslation contentType="group" contentId={1} fields={{ name: 'Media Test Group' }} />));

  await waitFor(() => expect(languageCalls()).toHaveLength(1));
  expect(languageCalls()[0]![1]).toEqual({ texts: ['Media Test Group'] });
  await waitFor(() => expect(screen.queryByLabelText('ugcTranslation.translate')).toBeNull());
});

test('the button appears when the server says the text is in another language', async () => {
  detections = [{ language: 'es', confidence: 0.99 }];
  const screen = render(view(<ContentTranslation contentType="group" contentId={2} fields={{ name: 'Grupo de jardinería' }} />));

  expect(await screen.findByLabelText('ugcTranslation.translate')).toBeTruthy();
});

test('the button waits while the server answers, and stays when the answer is not known', async () => {
  let release: () => void = () => {};
  detections = new Error('offline');
  post.mockImplementation((url: string) => {
    if (url !== '/api/v2/ugc-language') return Promise.resolve({ data: { translated_text: 'x' } });
    return new Promise((_, reject) => { release = () => reject(new Error('offline')); });
  });
  const screen = render(view(<ContentTranslation contentType="post" contentId={3} fields={{ body: 'Media Test Group' }} />));

  await waitFor(() => expect(languageCalls()).toHaveLength(1));
  expect(screen.queryByLabelText('ugcTranslation.translate')).toBeNull();
  release();
  expect(await screen.findByLabelText('ugcTranslation.translate')).toBeTruthy();
});

test('every Translate button on a screen is asked about in one request', async () => {
  detections = [{ language: 'en', confidence: 0.9 }, { language: 'fr', confidence: 0.9 }];
  const screen = render(view(<>
    <ContentTranslation contentType="feed_post" contentId={4} fields={{ body: 'Garden day' }} />
    <ContentTranslation contentType="comment" contentId={5} fields={{ body: 'Bonjour à tous' }} />
  </>));

  expect(await screen.findAllByLabelText('ugcTranslation.translate')).toHaveLength(1);
  expect(languageCalls()).toHaveLength(1);
  expect(languageCalls()[0]![1]).toEqual({ texts: ['Garden day', 'Bonjour à tous'] });
});

test('🔴 a private message is never sent to the language check; the word check alone decides', async () => {
  detections = [{ language: 'en', confidence: 1 }];
  const screen = render(view(<ContentTranslation contentType="message" contentId={6} fields={{ body: 'See you at six' }} />));

  expect(await screen.findByLabelText('ugcTranslation.translate')).toBeTruthy();
  expect(languageCalls()).toHaveLength(0);
});

test('nothing is asked for a reader who is not signed in; the button stays', async () => {
  mockSignedIn = false;
  const screen = render(view(<ContentTranslation contentType="group" contentId={8} fields={{ name: 'Media Test Group' }} />));

  expect(await screen.findByLabelText('ugcTranslation.translate')).toBeTruthy();
  expect(languageCalls()).toHaveLength(0);
});

test('a text the word check already proves English is never sent', async () => {
  // The word lists are read on first use; once they are in, the word check answers first.
  await loadReaderVocabulary('en');
  const screen = render(view(<ContentTranslation contentType="post" contentId={9} fields={{ body: 'Please remember to log your hours after each exchange so the balance stays accurate.' }} />));

  await waitFor(() => expect(screen.queryByLabelText('ugcTranslation.translate')).toBeNull());
  expect(languageCalls()).toHaveLength(0);
});
