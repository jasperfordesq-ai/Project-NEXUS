// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import deExchanges from '../../locales/de/exchanges.json';
import enExchanges from '../../locales/en/exchanges.json';
import esExchanges from '../../locales/es/exchanges.json';
import frExchanges from '../../locales/fr/exchanges.json';
import gaExchanges from '../../locales/ga/exchanges.json';
import itExchanges from '../../locales/it/exchanges.json';
import ptExchanges from '../../locales/pt/exchanges.json';

/**
 * The optional "service details" a listing carries — experience level, equipment and
 * accessibility notes.
 *
 * 🔴 These are NOT columns. They are serialised into the tail of `description` as a
 * `---`-separated block of `Label: value` lines, and the label is the member's own
 * TRANSLATED word. That schema is why this file exists, and why it is defensive:
 *
 *  - A listing written in French stores `Expérience: Professionnel / certifié`. Editing it
 *    in English used to look for `Experience:`, find nothing, and rebuild the description
 *    without the block — silently erasing the accessibility note a disabled member relied
 *    on (audit 2026-09-06, F01). So labels and values are matched against EVERY bundled
 *    locale, not just the current one.
 *  - The block was found by splitting on the first `---` and keeping only what preceded it,
 *    so an ordinary horizontal rule inside a member's own prose truncated the listing at
 *    the first separator (audit 2026-09-06, F02). Only the LAST section is considered, and
 *    only when it really looks like a details block.
 *  - Anything inside that block we cannot map to a known field is carried through verbatim
 *    (`unknownDetailLines`) instead of being dropped, so a field added by the web client or
 *    a future locale survives a mobile edit.
 *
 * The invariant every change here must keep: parsing a description and rebuilding it
 * without editing any field returns the description unchanged. `serviceDetails.test.ts`
 * asserts exactly that for prose, separators, foreign locales and unknown fields.
 */

export type Translate = (key: string) => string;

export const experienceOptions = ['beginner_friendly', 'some_experience', 'experienced', 'professional'] as const;
export const equipmentOptions = ['provided', 'partial', 'bring_own', 'not_applicable'] as const;

export type ExperienceOption = (typeof experienceOptions)[number];
export type EquipmentOption = (typeof equipmentOptions)[number];

export const experienceLabelKeys: Record<ExperienceOption, string> = {
  beginner_friendly: 'experienceBeginner',
  some_experience: 'experienceSome',
  experienced: 'experienceExperienced',
  professional: 'experienceProfessional',
};

export const equipmentLabelKeys: Record<EquipmentOption, string> = {
  provided: 'equipmentProvidedOption',
  partial: 'equipmentPartial',
  bring_own: 'equipmentBringOwn',
  not_applicable: 'equipmentNa',
};

export interface ServiceDetails {
  experience: string;
  equipment: string;
  accessibility: string;
}

export interface ParsedListingDescription extends ServiceDetails {
  /** Everything the details block did not claim, including the member's own `---` rules. */
  description: string;
  /** Detail lines that are metadata but map to no field we know. Re-emitted verbatim. */
  unknownDetailLines: string[];
}

type FormCatalogue = { form?: Record<string, string> };

/** Every locale shipped in the bundle. i18n.ts already requires each of these. */
const BUNDLED_FORM_CATALOGUES: FormCatalogue[] = [
  enExchanges as FormCatalogue,
  gaExchanges as FormCatalogue,
  deExchanges as FormCatalogue,
  frExchanges as FormCatalogue,
  esExchanges as FormCatalogue,
  itExchanges as FormCatalogue,
  ptExchanges as FormCatalogue,
];

/** Labels the web client wrote before the option keys were introduced. */
const webDetailAliases: Record<string, string[]> = {
  beginner_friendly: ['beginner-friendly'],
  some_experience: ['some experience helpful'],
  experienced: ['experienced practitioner'],
  professional: ['professional / certified', 'professional/certified'],
  provided: ["i'll provide everything needed", 'i will provide everything needed'],
  partial: ['some things needed from you'],
  bring_own: ["you'll need to provide your own", 'you will need to provide your own'],
  not_applicable: ['not applicable'],
};

function localeValues(formKey: string): string[] {
  return BUNDLED_FORM_CATALOGUES
    .map((catalogue) => catalogue.form?.[formKey])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function comparable(value: string): string {
  return value.trim().toLowerCase();
}

/** Field labels, in every bundled locale, plus the English text older listings hold. */
const FIELD_LABELS: Record<keyof ServiceDetails, string[]> = {
  experience: [...localeValues('experienceLabel'), 'Experience'],
  equipment: [...localeValues('equipmentLabel'), 'Equipment'],
  accessibility: [...localeValues('accessibilityLabel'), 'Accessibility'],
};

/** Localised option text -> option key, for every bundled locale and legacy web wording. */
const OPTION_BY_LABEL: Map<string, string> = (() => {
  const map = new Map<string, string>();
  const add = (label: string | undefined, option: string) => {
    if (!label) return;
    const key = comparable(label);
    if (key && !map.has(key)) map.set(key, option);
  };

  for (const option of experienceOptions) {
    add(option, option);
    add(option.replace(/_/g, ' '), option);
    for (const alias of webDetailAliases[option] ?? []) add(alias, option);
    for (const label of localeValues(experienceLabelKeys[option])) add(label, option);
  }
  for (const option of equipmentOptions) {
    add(option, option);
    add(option.replace(/_/g, ' '), option);
    for (const alias of webDetailAliases[option] ?? []) add(alias, option);
    for (const label of localeValues(equipmentLabelKeys[option])) add(label, option);
  }
  return map;
})();

/**
 * A line inside a details block: a short label, a colon, then a value. The 60-character
 * label bound is what stops an ordinary sentence containing a colon from being mistaken
 * for metadata.
 */
const DETAIL_LINE = /^([^:\n]{1,60}):[ \t]*(\S.*)$/;

/** A horizontal rule on its own line. */
const SEPARATOR = /\n[ \t]*---[ \t]*\n/g;

export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/(?:div|p|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Map a stored option value onto its canonical key, in any locale. Free text passes through. */
export function normalizeServiceDetailValue(value: string): string {
  return OPTION_BY_LABEL.get(comparable(value)) ?? value;
}

function labelMatches(label: string, field: keyof ServiceDetails, t: Translate): boolean {
  const candidates = [...FIELD_LABELS[field], t(`form.${field}Label`)];
  return candidates.some((candidate) => comparable(candidate) === comparable(label));
}

interface DetailLine {
  label: string;
  value: string;
  raw: string;
}

function readDetailLines(section: string): DetailLine[] | null {
  const lines = section.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const parsed: DetailLine[] = [];
  for (const line of lines) {
    const match = DETAIL_LINE.exec(line);
    // One line of ordinary prose disqualifies the whole section: it is the member's
    // writing, not metadata, and must stay in the description.
    if (!match) return null;
    parsed.push({ label: match[1].trim(), value: match[2].trim(), raw: line });
  }
  return parsed;
}

function lastSeparatorIndex(plain: string): { start: number; end: number } | null {
  SEPARATOR.lastIndex = 0;
  let found: { start: number; end: number } | null = null;
  let match = SEPARATOR.exec(plain);
  while (match) {
    found = { start: match.index, end: match.index + match[0].length };
    match = SEPARATOR.exec(plain);
  }
  return found;
}

export function parseListingDescription(value: string, t: Translate): ParsedListingDescription {
  const plain = stripHtml(value);
  const empty: ParsedListingDescription = {
    description: plain,
    experience: '',
    equipment: '',
    accessibility: '',
    unknownDetailLines: [],
  };

  const separator = lastSeparatorIndex(plain);
  if (!separator) return empty;

  const lines = readDetailLines(plain.slice(separator.end));
  if (!lines) return empty;

  const fields: Record<keyof ServiceDetails, string> = { experience: '', equipment: '', accessibility: '' };
  const unknownDetailLines: string[] = [];

  for (const line of lines) {
    const field = (Object.keys(fields) as (keyof ServiceDetails)[])
      .find((candidate) => !fields[candidate] && labelMatches(line.label, candidate, t));
    if (field) {
      // Accessibility is free text a member typed; only the two pick-lists are canonicalised.
      fields[field] = field === 'accessibility' ? line.value : normalizeServiceDetailValue(line.value);
    } else {
      unknownDetailLines.push(line.raw);
    }
  }

  // A section of `Label: value` lines that names none of our fields is not our block.
  if (!fields.experience && !fields.equipment && !fields.accessibility) return empty;

  return {
    description: plain.slice(0, separator.start).replace(/\s+$/, ''),
    ...fields,
    unknownDetailLines,
  };
}

export function formatExperienceDetail(value: string, t: Translate): string {
  return experienceOptions.includes(value as ExperienceOption)
    ? t(`form.${experienceLabelKeys[value as ExperienceOption]}`)
    : value;
}

export function formatEquipmentDetail(value: string, t: Translate): string {
  return equipmentOptions.includes(value as EquipmentOption)
    ? t(`form.${equipmentLabelKeys[value as EquipmentOption]}`)
    : value;
}

export function buildListingDescription(
  baseDescription: string,
  details: ServiceDetails,
  t: Translate,
  unknownDetailLines: string[] = [],
): string {
  const detailLines = [
    details.experience.trim() ? `${t('form.experienceLabel')}: ${formatExperienceDetail(details.experience.trim(), t)}` : '',
    details.equipment.trim() ? `${t('form.equipmentLabel')}: ${formatEquipmentDetail(details.equipment.trim(), t)}` : '',
    details.accessibility.trim() ? `${t('form.accessibilityLabel')}: ${details.accessibility.trim()}` : '',
    ...unknownDetailLines.map((line) => line.trim()).filter(Boolean),
  ].filter(Boolean);

  if (detailLines.length === 0) return baseDescription;
  return `${baseDescription}\n\n---\n${detailLines.join('\n')}`.trim();
}
