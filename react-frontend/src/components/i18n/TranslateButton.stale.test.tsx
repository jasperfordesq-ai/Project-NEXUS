// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID audit A4 (30 Oct 2026): the button kept ONE translated value for its
 * whole life, so after the text was edited, or the reader changed language,
 * it kept showing — or toggled back to — a translation of something else.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));

import { api } from '@/lib/api';
import { TranslateButton } from './TranslateButton';

const ok = (text: string) => ({
  success: true,
  data: { translated_text: text, source_locale: 'fr', target_locale: 'en', cached: false },
});

describe('TranslateButton — translations never outlive their text', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forgets the translation when the text changes, and translates the new text', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(ok('Hello world'));
    const onTextChange = vi.fn();
    const { rerender } = render(
      <TranslateButton contentType="post" contentId="1" sourceText="Bonjour le monde" sourceLocale="fr" onTextChange={onTextChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /translate/i }));
    await waitFor(() => expect(onTextChange).toHaveBeenLastCalledWith('Hello world', true));

    rerender(
      <TranslateButton contentType="post" contentId="1" sourceText="Bonsoir tout le monde" sourceLocale="fr" onTextChange={onTextChange} />,
    );

    // Back to the (new) original, offering Translate again.
    await waitFor(() => expect(onTextChange).toHaveBeenLastCalledWith('Bonsoir tout le monde', false));
    expect(screen.getByRole('button', { name: /^translate/i })).toBeInTheDocument();

    vi.mocked(api.post).mockResolvedValueOnce(ok('Good evening everyone'));
    fireEvent.click(screen.getByRole('button', { name: /translate/i }));
    await waitFor(() => expect(onTextChange).toHaveBeenLastCalledWith('Good evening everyone', true));
    expect(api.post).toHaveBeenLastCalledWith('/v2/ugc-translate', expect.objectContaining({ source_text: 'Bonsoir tout le monde' }));
  });

  it('ignores a reply that arrives after the text changed', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    vi.mocked(api.post).mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }) as never);
    const onTextChange = vi.fn();
    const { rerender } = render(
      <TranslateButton contentType="post" contentId="1" sourceText="Bonjour" sourceLocale="fr" onTextChange={onTextChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /translate/i }));
    rerender(<TranslateButton contentType="post" contentId="2" sourceText="Salut" sourceLocale="fr" onTextChange={onTextChange} />);
    resolveFirst(ok('Hello'));

    await new Promise((r) => setTimeout(r, 20));
    expect(onTextChange).not.toHaveBeenCalledWith('Hello', true);
  });
});
