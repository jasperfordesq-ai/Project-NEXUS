// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner, 31 Oct 2026: "if the message is in English and my language is English,
 * it is pointless to have the button there". The button is left out only when
 * everything shown is, beyond doubt, in the reader's language; doubt keeps it.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/contexts', () => createMockContexts());

import { TranslateButton } from './TranslateButton';
import { loadVocabulary } from '@/lib/textLanguage/useReaderVocabulary';

const ENGLISH = 'Please remember to log your hours after each exchange so the balance stays accurate.';
const SPANISH = 'Mi vecina mayor estaría encantada de recibir una llamada cada semana, ¿alguien tiene veinte minutos?';

const button = () => screen.queryByRole('button', { name: /^translate/i });

describe('TranslateButton — already in the reader\'s language', () => {
  // As on a real page once the reader's word list has arrived; before that the
  // button shows (the safe default, covered in textLanguage.test.ts).
  beforeAll(async () => { await loadVocabulary('eng'); });
  beforeEach(() => vi.clearAllMocks());

  it('leaves the button out for English text and an English reader', () => {
    render(<TranslateButton contentType="feed_post" contentId={1} sourceText={ENGLISH} />);
    expect(button()).toBeNull();
  });

  it('offers it for Spanish text to the same reader', () => {
    render(<TranslateButton contentType="feed_post" contentId={2} sourceText={SPANISH} />);
    expect(button()).not.toBeNull();
  });

  it('keeps it when the title is in another language than the English body', () => {
    render(<TranslateButton contentType="listing" contentId={3} sourceText={ENGLISH} extraFields={{ title: 'Ayuda con jardinería en mi huerto' }} />);
    expect(button()).not.toBeNull();
  });

  // AWID report, Oct 2026: a profile's skills must translate with its bio. A
  // list of single words is never "beyond doubt" in any language, so companion
  // fields ride along with a press but never decide whether the button shows.
  it('does not let companion fields bring the button back for an English bio', () => {
    render(<TranslateButton contentType="profile_bio" contentId={5} sourceText={ENGLISH} companionFields={{ skills: 'Gardening\nCooking' }} />);
    expect(button()).toBeNull();
  });

  it('does not show the button for companion fields alone', () => {
    render(<TranslateButton contentType="profile_bio" contentId={6} sourceText="" companionFields={{ skills: 'Jardinería\nCocina' }} />);
    expect(button()).toBeNull();
  });

  it('keeps it for a short text it cannot be sure about', () => {
    render(<TranslateButton contentType="comment" contentId={4} sourceText="Thanks so much!" />);
    expect(button()).not.toBeNull();
  });
});
