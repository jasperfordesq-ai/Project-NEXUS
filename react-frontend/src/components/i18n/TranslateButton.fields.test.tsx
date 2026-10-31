// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner, 31 Oct 2026: an item's title (listing, event, group name…) must be
 * translatable with its text, not only its comments. One press translates the
 * body and any extra fields; the original returns with "Show original".
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

const reply = (text: string) => ({
  success: true,
  data: { translated_text: text, source_locale: 'es', target_locale: 'en', cached: false },
});

describe('TranslateButton — extra fields', () => {
  beforeEach(() => vi.clearAllMocks());

  it('translates the title with the text and hands both back', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => {
      const { content_type } = body as { content_type: string };
      return content_type === 'listing_title' ? reply('Help with gardening') : reply('I need to know how to keep my plants healthy.');
    });
    const onTextChange = vi.fn();
    const onFieldsChange = vi.fn();
    render(
      <TranslateButton
        contentType="listing"
        contentId={9}
        sourceText="Necesito saber cómo tener mis plantas sanas."
        extraFields={{ title: 'Ayuda con jardinería' }}
        onTextChange={onTextChange}
        onFieldsChange={onFieldsChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^translate/i }));

    await waitFor(() => expect(onFieldsChange).toHaveBeenLastCalledWith({ title: 'Help with gardening' }));
    expect(onTextChange).toHaveBeenLastCalledWith('I need to know how to keep my plants healthy.', true);
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({ content_type: 'listing_title', source_text: 'Ayuda con jardinería' }));

    fireEvent.click(screen.getByRole('button', { name: /show original/i }));
    await waitFor(() => expect(onFieldsChange).toHaveBeenLastCalledWith(null));
  });

  it('keeps a field in its original wording when only that field fails', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => (
      (body as { content_type: string }).content_type === 'listing_title'
        ? { success: false, code: 'TRANSLATION_FAILED', error: 'x' }
        : reply('Body in English')
    ));
    const onFieldsChange = vi.fn();
    render(
      <TranslateButton contentType="listing" contentId={9} sourceText="Cuerpo" extraFields={{ title: 'Título' }} onFieldsChange={onFieldsChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^translate/i }));

    await waitFor(() => expect(onFieldsChange).toHaveBeenLastCalledWith({ title: 'Título' }));
  });
});
