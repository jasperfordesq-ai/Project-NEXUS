// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import enExchanges from '../../locales/en/exchanges.json';
import frExchanges from '../../locales/fr/exchanges.json';

import { buildListingDescription, parseListingDescription } from './serviceDetails';

type Catalogue = { form: Record<string, string> };

function translatorFor(catalogue: Catalogue): (key: string) => string {
  return (key: string) => {
    const formKey = key.startsWith('form.') ? key.slice('form.'.length) : key;
    return catalogue.form[formKey] ?? key;
  };
}

const en = translatorFor(enExchanges as unknown as Catalogue);
const fr = translatorFor(frExchanges as unknown as Catalogue);

/** What a title-only edit does: parse, change nothing, rebuild. */
function roundTrip(value: string, t: (key: string) => string): string {
  const parsed = parseListingDescription(value, t);
  return buildListingDescription(parsed.description, parsed, t, parsed.unknownDetailLines);
}

describe('listing service details', () => {
  it('reads a details block that was written in a different language', () => {
    const written = [
      'Je propose des cours de guitare pour tous les niveaux.',
      '',
      '---',
      `${fr('form.experienceLabel')}: ${fr('form.experienceProfessional')}`,
      `${fr('form.equipmentLabel')}: ${fr('form.equipmentProvidedOption')}`,
      `${fr('form.accessibilityLabel')}: Entrée sans marche`,
    ].join('\n');

    const parsed = parseListingDescription(written, en);

    expect(parsed.description).toBe('Je propose des cours de guitare pour tous les niveaux.');
    expect(parsed.experience).toBe('professional');
    expect(parsed.equipment).toBe('provided');
    expect(parsed.accessibility).toBe('Entrée sans marche');
  });

  it('keeps accessibility notes when a listing written in French is saved in English', () => {
    const written = [
      'Je propose des cours de guitare pour tous les niveaux.',
      '',
      '---',
      `${fr('form.accessibilityLabel')}: Entrée sans marche`,
    ].join('\n');

    const parsed = parseListingDescription(written, en);
    const rebuilt = buildListingDescription(parsed.description, parsed, en, parsed.unknownDetailLines);

    expect(rebuilt).toContain('Entrée sans marche');
  });

  it('keeps prose that follows a horizontal separator', () => {
    const written = [
      'First paragraph',
      '',
      '---',
      'Second meaningful paragraph',
      '',
      '---',
      'Third paragraph',
    ].join('\n');

    expect(roundTrip(written, en)).toBe(written);
  });

  it('keeps prose that follows a separator even when a details block is also present', () => {
    const written = [
      'First paragraph',
      '',
      '---',
      'Second meaningful paragraph',
      '',
      '---',
      `${en('form.experienceLabel')}: ${en('form.experienceBeginner')}`,
    ].join('\n');

    const parsed = parseListingDescription(written, en);

    expect(parsed.experience).toBe('beginner_friendly');
    expect(parsed.description).toBe('First paragraph\n\n---\nSecond meaningful paragraph');
    expect(roundTrip(written, en)).toBe(written);
  });

  it('keeps detail lines it does not recognise', () => {
    const written = [
      'A listing body with enough detail to pass validation.',
      '',
      '---',
      `${en('form.experienceLabel')}: ${en('form.experienceBeginner')}`,
      'Deposit: 20 credits',
    ].join('\n');

    const parsed = parseListingDescription(written, en);

    expect(parsed.experience).toBe('beginner_friendly');
    expect(parsed.unknownDetailLines).toEqual(['Deposit: 20 credits']);
    expect(roundTrip(written, en)).toBe(written);
  });

  it('round-trips a details block written in the current language', () => {
    const written = [
      'A listing body with enough detail to pass validation.',
      '',
      '---',
      `${en('form.experienceLabel')}: ${en('form.experienceBeginner')}`,
      `${en('form.equipmentLabel')}: ${en('form.equipmentProvidedOption')}`,
      `${en('form.accessibilityLabel')}: Ground floor room`,
    ].join('\n');

    expect(roundTrip(written, en)).toBe(written);
  });

  it('leaves a description with no details block untouched', () => {
    const written = 'A listing body with enough detail to pass validation.';
    expect(roundTrip(written, en)).toBe(written);
  });
});
