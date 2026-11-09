// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.unmock('@/lib/textLanguage/detectLanguage');
vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }));

import { api } from '@/lib/api';
import {
  detectTextLanguage,
  knownTextLanguage,
  forgetTextLanguages,
  writtenInReaderLanguage,
} from './detectLanguage';
import { vocabularySet } from './textLanguage';

const english = vocabularySet({ words: 'a the for of and in on to is we our group test media security testing uploads garden day walk park saturday' });

describe('detectTextLanguage', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    forgetTextLanguages();
  });

  it('asks once for every text on the page together', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { detections: [
      { language: 'en', confidence: 0.9 },
      { language: 'es', confidence: 1 },
    ] } });

    const [a, b] = await Promise.all([detectTextLanguage('Garden day on Saturday'), detectTextLanguage('Hola vecinos')]);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.post).mock.calls[0]![0]).toBe('/v2/ugc-language');
    expect(vi.mocked(api.post).mock.calls[0]![1]).toEqual({ texts: ['Garden day on Saturday', 'Hola vecinos'] });
    expect(a).toEqual({ language: 'en', confidence: 0.9 });
    expect(b).toEqual({ language: 'es', confidence: 1 });
  });

  it('remembers an answer, so the same text is never asked about twice', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { detections: [{ language: 'en', confidence: 0.9 }] } });

    await detectTextLanguage('Garden day on Saturday');
    expect(knownTextLanguage('Garden day on Saturday')).toEqual({ language: 'en', confidence: 0.9 });
    await detectTextLanguage('Garden day on Saturday');

    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('asks about the same text only once even while the first question is on its way', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { detections: [{ language: 'en', confidence: 0.9 }] } });

    await Promise.all([detectTextLanguage('Garden day'), detectTextLanguage('Garden day')]);

    expect(vi.mocked(api.post).mock.calls[0]![1]).toEqual({ texts: ['Garden day'] });
  });

  it('answers "not known" when the server cannot be reached or refuses', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    expect(await detectTextLanguage('Garden day on Saturday')).toBeNull();

    vi.mocked(api.post).mockResolvedValueOnce({ success: false, error: 'Too many requests' });
    expect(await detectTextLanguage('A walk in the park')).toBeNull();
  });

  it('sends at most fifty texts in one question', async () => {
    vi.mocked(api.post).mockImplementation(async (_url, body) => ({
      success: true,
      data: { detections: (body as { texts: string[] }).texts.map(() => ({ language: 'en', confidence: 1 })) },
    }));

    await Promise.all(Array.from({ length: 60 }, (_, i) => detectTextLanguage(`Text number ${i} about the garden`)));

    expect(api.post).toHaveBeenCalledTimes(2);
    expect((vi.mocked(api.post).mock.calls[0]![1] as { texts: string[] }).texts).toHaveLength(50);
    expect((vi.mocked(api.post).mock.calls[1]![1] as { texts: string[] }).texts).toHaveLength(10);
  });
});

describe('writtenInReaderLanguage', () => {
  it('is true when every part is, by Google, in the reader\'s language', () => {
    expect(writtenInReaderLanguage(
      ['E088 Media Test Group', 'Security testing group for media uploads E088.'],
      [{ language: 'en', confidence: 0.95 }, { language: 'en', confidence: 0.99 }],
      'en', english,
    )).toBe(true);
  });

  it('is false when any part is in another language — a Spanish title on an English body keeps the button', () => {
    expect(writtenInReaderLanguage(
      ['Grupo de jardinería', 'A walk in the park'],
      [{ language: 'es', confidence: 0.98 }, { language: 'en', confidence: 0.99 }],
      'en', english,
    )).toBe(false);
  });

  it('is false while any part is not known', () => {
    expect(writtenInReaderLanguage(['A walk in the park', 'Garden day'], [{ language: 'en', confidence: 1 }, null], 'en', english)).toBe(false);
    expect(writtenInReaderLanguage(['A walk in the park'], [], 'en', english)).toBe(false);
  });

  it('matches regional codes by language: pt-BR is Portuguese, zh-CN is Chinese', () => {
    expect(writtenInReaderLanguage(['Olá a todos'], [{ language: 'pt-br', confidence: 1 }], 'pt', null)).toBe(true);
    expect(writtenInReaderLanguage(['Olá a todos'], [{ language: 'pt', confidence: 1 }], 'pt-BR', null)).toBe(true);
  });

  it('when Google is unsure, trusts it only if the words are everyday words of the reader\'s language', () => {
    // "Media Test Group": Google unsure, but every word is everyday English.
    expect(writtenInReaderLanguage(['Media Test Group'], [{ language: 'en', confidence: 0.3 }], 'en', english)).toBe(true);
    // A short Spanish text Google wrongly guessed as English: its words are not English, so the button stays.
    expect(writtenInReaderLanguage(['Ayuda con jardinería'], [{ language: 'en', confidence: 0.3 }], 'en', english)).toBe(false);
    // Without the reader's vocabulary loaded, an unsure answer is not enough.
    expect(writtenInReaderLanguage(['Media Test Group'], [{ language: 'en', confidence: 0.3 }], 'en', null)).toBe(false);
  });
});
