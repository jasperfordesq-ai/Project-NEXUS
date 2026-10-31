// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/contexts', () => {
  const defaults = createMockContexts();
  return { ...defaults, useAuth: () => ({ ...defaults.useAuth(), user: { id: 7 } }) };
});
import { api } from '@/lib/api';
import { UgcTranslationPreferencesProvider, UGC_PREFERENCES_CHANGED } from '@/contexts/UgcTranslationPreferencesContext';
import { TranslateButton } from './TranslateButton';

const response = (text: string) => ({ success: true, data: { translated_text: text, source_locale: 'auto', target_locale: 'es', cached: true } });
const preference = (automatic: boolean) => ({ success: true, data: { translation: { auto_translate_ugc: automatic, auto_translate_target_locale: 'es' } } });

describe('existing translation preferences and title-only content', () => {
  beforeEach(() => vi.resetAllMocks());

  it('translates a title without sending an empty body and restores the original', async () => {
    vi.mocked(api.post).mockResolvedValue(response('Un objetivo'));
    const fields = vi.fn();
    render(<TranslateButton contentType="goal" contentId={1} sourceText="" extraFields={{ title: 'A goal' }} onFieldsChange={fields} />);
    fireEvent.click(screen.getByRole('button', { name: /^translate/i }));
    await waitFor(() => expect(fields).toHaveBeenLastCalledWith({ title: 'Un objetivo' }));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({ source_text: 'A goal', content_type: 'goal_title' }));
    fireEvent.click(screen.getByRole('button', { name: /show original/i }));
    expect(fields).toHaveBeenLastCalledWith(null);
  });

  it('automatically displays only cached text in the saved target, then resets when disabled', async () => {
    vi.mocked(api.get).mockResolvedValue(preference(true));
    vi.mocked(api.post).mockResolvedValue(response('Hola'));
    const changed = vi.fn();
    render(<UgcTranslationPreferencesProvider><TranslateButton contentType="post" contentId={1} sourceText="Hello" onTextChange={changed} /></UgcTranslationPreferencesProvider>);
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith('Hola', true));
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({ cache_only: true, target_locale: 'es' }));
    vi.mocked(api.get).mockResolvedValue(preference(false));
    act(() => window.dispatchEvent(new Event(UGC_PREFERENCES_CHANGED)));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith('Hello', false));
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('does not spend provider quota on a cache miss or retry on a rerender', async () => {
    vi.mocked(api.get).mockResolvedValue(preference(true));
    vi.mocked(api.post).mockResolvedValue({ success: true, data: null });
    const changed = vi.fn();
    const view = () => <UgcTranslationPreferencesProvider><TranslateButton contentType="post" contentId={1} sourceText="Hello" onTextChange={changed} /></UgcTranslationPreferencesProvider>;
    const { rerender } = render(view());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    rerender(view());
    expect(changed).toHaveBeenLastCalledWith('Hello', false);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('ignores an automatic reply after the preference is disabled', async () => {
    vi.mocked(api.get).mockResolvedValue(preference(true));
    let resolve!: (value: ReturnType<typeof response>) => void;
    vi.mocked(api.post).mockReturnValue(new Promise((done) => { resolve = done; }) as never);
    const changed = vi.fn();
    render(<UgcTranslationPreferencesProvider><TranslateButton contentType="post" contentId={1} sourceText="Hello" onTextChange={changed} /></UgcTranslationPreferencesProvider>);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    vi.mocked(api.get).mockResolvedValue(preference(false));
    await act(async () => { window.dispatchEvent(new Event(UGC_PREFERENCES_CHANGED)); });
    await act(async () => resolve(response('Hola')));
    expect(changed).not.toHaveBeenCalledWith('Hola', true);
  });
});
