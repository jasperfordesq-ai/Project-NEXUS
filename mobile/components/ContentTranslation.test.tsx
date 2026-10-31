// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ContentTranslation from './ContentTranslation';
import { UgcTranslationPreferencesProvider } from '@/lib/context/UgcTranslationPreferencesContext';
import { api } from '@/lib/api/client';
import { getUserPreferences } from '@/lib/api/settings';
import { refreshUgcPreferences } from '@/lib/ugcPreferencesEvents';

let mockLanguage = 'en';
let mockUser = 1;
let mockTenant = 2;
let mockEnabled = true;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: mockLanguage } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: mockTenant, translation: { enabled: mockEnabled } } }) }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUser } }) }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textMuted: '#444', textSecondary: '#333' }) }));
jest.mock('@/lib/api/client', () => ({ api: { post: jest.fn() } }));
jest.mock('@/lib/api/settings', () => ({ getUserPreferences: jest.fn() }));
jest.mock('@/components/ui/NativeButton', () => {
  const { Pressable, Text } = require('react-native');
  const Button = ({ children, isDisabled, ...props }: any) => <Pressable disabled={isDisabled} {...props}>{children}</Pressable>;
  Button.Label = Text;
  return { Button };
});
const response = { data: { translated_text: 'Hola' } };
const view = (body = 'Hello', id = 1) => <UgcTranslationPreferencesProvider><ContentTranslation contentType="post" contentId={id} fields={{ body }} /></UgcTranslationPreferencesProvider>;
beforeEach(() => {
  jest.resetAllMocks(); mockLanguage = 'en'; mockUser = 1; mockTenant = 2; mockEnabled = true;
  jest.mocked(getUserPreferences).mockResolvedValue({ translation: { auto_translate_ugc: true, auto_translate_target_locale: 'es' } });
  jest.mocked(api.post).mockResolvedValue(response);
});
test('automatic display uses only the cache, respects the saved target, and offers original', async () => {
  const screen = render(view());
  await screen.findByText('Hola');
  expect(api.post).toHaveBeenCalledWith('/api/v2/ugc-translate', expect.objectContaining({ cache_only: true, target_locale: 'es' }));
  fireEvent.press(screen.getByLabelText('ugcTranslation.showOriginal'));
  expect(screen.queryByText('Hola')).toBeNull();
  expect(api.post).toHaveBeenCalledTimes(1);
});
test('a cache miss preserves the manual action and rerendering does not repeat requests', async () => {
  jest.mocked(api.post).mockResolvedValueOnce({ data: null });
  const screen = render(view());
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  screen.rerender(view());
  expect(api.post).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('ugcTranslation.translate'));
  await screen.findByText('Hola');
  expect(jest.mocked(api.post).mock.calls[1]?.[1]).not.toHaveProperty('cache_only');
});
test.each(['source', 'id', 'language', 'account', 'tenant', 'switch'])('late responses cannot survive a %s change', async change => {
  let resolve!: (value: unknown) => void;
  jest.mocked(api.post).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const screen = render(view());
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  jest.mocked(api.post).mockResolvedValue({ data: null });
  if (change === 'language') mockLanguage = 'fr';
  if (change === 'account') mockUser = 3;
  if (change === 'tenant') mockTenant = 4;
  if (change === 'switch') mockEnabled = false;
  screen.rerender(view(change === 'source' ? 'Edited' : 'Hello', change === 'id' ? 9 : 1));
  await act(async () => resolve(response));
  expect(screen.queryByText('Hola')).toBeNull();
});
test('disabling the saved preference clears translated content and late reads', async () => {
  const screen = render(view()); await screen.findByText('Hola');
  jest.mocked(getUserPreferences).mockResolvedValue({ translation: { auto_translate_ugc: false } });
  await act(async () => refreshUgcPreferences());
  expect(screen.queryByText('Hola')).toBeNull();
});
test('title-only translation skips an empty body and provider failure remains retryable', async () => {
  jest.mocked(getUserPreferences).mockResolvedValue({});
  jest.mocked(api.post).mockRejectedValueOnce(new Error('quota'));
  const screen = render(<ContentTranslation contentType="group" contentId={1} fields={{ body: '', name: 'Welcome' }} />);
  fireEvent.press(screen.getByLabelText('ugcTranslation.translate'));
  await screen.findByText('ugcTranslation.failed');
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith('/api/v2/ugc-translate', expect.objectContaining({ content_type: 'group_name', source_text: 'Welcome' }));
  fireEvent.press(screen.getByLabelText('ugcTranslation.translate'));
  await screen.findByText('Hola');
});
// 31 Oct re-audit: several screens pass a stored description, which is HTML.
// Sent as-is, a translation could come back with literal tags on screen, and
// it would not share the cache with the web clients, which send plain text.
test('formatted descriptions are translated as the plain text the reader sees', async () => {
  const screen = render(view('<p>Hello <strong>there</strong></p>'));
  await screen.findByText('Hola');
  expect(api.post).toHaveBeenCalledWith('/api/v2/ugc-translate', expect.objectContaining({ source_text: 'Hello there' }));
});
