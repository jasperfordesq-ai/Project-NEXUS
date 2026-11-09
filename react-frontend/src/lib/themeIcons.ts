// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A picture for each offer theme (AWID feedback, Nov 2026: "clear categories,
 * attractive visuals"). An administrator picks one per theme from this fixed
 * set (categories.icon, validated against App\Support\Categories\ThemeIcons —
 * the test checks the two lists match). A theme with no choice gets a guess
 * from its slug or name, so a community sees pictures before anyone sets
 * them; a name we do not recognise gets none, and the caller keeps its
 * standard picture.
 */

import type { LucideIcon } from 'lucide-react';
import Bike from 'lucide-react/icons/bike';
import BookOpen from 'lucide-react/icons/book-open';
import Briefcase from 'lucide-react/icons/briefcase';
import Calculator from 'lucide-react/icons/calculator';
import Camera from 'lucide-react/icons/camera';
import Car from 'lucide-react/icons/car';
import Coffee from 'lucide-react/icons/coffee';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import Hammer from 'lucide-react/icons/hammer';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import House from 'lucide-react/icons/house';
import Languages from 'lucide-react/icons/languages';
import Laptop from 'lucide-react/icons/laptop';
import Music from 'lucide-react/icons/music';
import Palette from 'lucide-react/icons/palette';
import PawPrint from 'lucide-react/icons/paw-print';
import Scissors from 'lucide-react/icons/scissors';
import Shirt from 'lucide-react/icons/shirt';
import ShoppingBasket from 'lucide-react/icons/shopping-basket';
import Sparkles from 'lucide-react/icons/sparkles';
import Sprout from 'lucide-react/icons/sprout';
import Trees from 'lucide-react/icons/trees';
import Truck from 'lucide-react/icons/truck';
import Utensils from 'lucide-react/icons/utensils';
import Wrench from 'lucide-react/icons/wrench';

export const THEME_ICONS = {
  garden: Sprout,
  transport: Car,
  repairs: Wrench,
  food: Utensils,
  learning: BookOpen,
  care: HeartHandshake,
  pets: PawPrint,
  technology: Laptop,
  music: Music,
  arts: Palette,
  clothes: Shirt,
  home: House,
  fitness: HeartPulse,
  languages: Languages,
  office: Briefcase,
  beauty: Scissors,
  building: Hammer,
  photography: Camera,
  cycling: Bike,
  errands: ShoppingBasket,
  cleaning: Sparkles,
  outdoors: Trees,
  money: Calculator,
  company: Coffee,
  moving: Truck,
} as const satisfies Record<string, LucideIcon>;

export type ThemeIconKey = keyof typeof THEME_ICONS;

export const THEME_ICON_KEYS = Object.keys(THEME_ICONS) as ThemeIconKey[];

export function isThemeIconKey(value: unknown): value is ThemeIconKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEME_ICONS, value);
}

/**
 * English words that suggest a picture, most specific first (the first match
 * wins). Each pattern starts at a word boundary, so "art" never matches
 * "party" and "car" never matches "care".
 */
const GUESSES: ReadonlyArray<readonly [ThemeIconKey, RegExp]> = [
  ['pets', /\b(pets?|dogs?|cats?|animals?)\b/],
  ['garden', /\b(garden\w*|plants?|planting|allotments?|lawns?|weeding|horticultur\w*)\b/],
  ['cycling', /\b(bikes?|bicycles?|cycl\w*)\b/],
  ['transport', /\b(lifts?|transport\w*|driv\w*|cars?|travel\w*|taxis?|rides?)\b/],
  ['moving', /\b(moving|move|removals?|lifting|furniture|carrying)\b/],
  ['repairs', /\b(repairs?|repairing|fix\w*|mend\w*|maintenance|handy\w*)\b/],
  ['building', /\b(diy|build\w*|carpent\w*|plumb\w*|electric\w*|decorat\w*|joinery)\b/],
  ['cleaning', /\b(clean\w*|tidy\w*|laundry|ironing|housework|declutter\w*)\b/],
  ['food', /\b(cook\w*|food\w*|meals?|bak(e|ed|ing|ery)|kitchen\w*|recipes?)\b/],
  ['languages', /\b(languages?|translat\w*|english|irish|french|spanish|german|italian)\b/],
  ['learning', /\b(teach\w*|tutor\w*|learn\w*|lessons?|educat\w*|schools?|homework|study|studying|training|mentor\w*)\b/],
  ['technology', /\b(computers?|computing|tech\w*|digital|internet|software|websites?|smartphones?|phones?|online)\b/],
  ['music', /\b(music\w*|instruments?|singing|singers?|piano|guitars?|choirs?)\b/],
  ['clothes', /\b(sew\w*|cloth\w*|alterations?|textiles?|tailor\w*)\b/],
  ['arts', /\b(arts?|crafts?|crafting|paint\w*|draw\w*|knit\w*|creative|pottery)\b/],
  ['care', /\b(care|caring|carers?|support|communit\w*|neighbou?r\w*|volunteer\w*)\b/],
  ['company', /\b(company|companion\w*|befriend\w*|chats?|social\w*|coffee|visit\w*|friends?|friendship|listening)\b/],
  ['fitness', /\b(fitness|wellbeing|exercis\w*|yoga|sports?|health\w*|gym)\b/],
  ['beauty', /\b(hair\w*|beauty|massages?|nails?|barber\w*|make up|makeup)\b/],
  ['photography', /\b(photo\w*|videos?|film\w*|cameras?)\b/],
  ['money', /\b(money|financ\w*|tax|taxes|budget\w*|paperwork|forms|accounts?|accounting|bookkeep\w*)\b/],
  ['office', /\b(admin\w*|business\w*|office|marketing|cvs?|careers?|jobs?|writing|professional\w*)\b/],
  ['errands', /\b(shop\w*|errands?|grocer\w*|collect\w*|deliver\w*)\b/],
  ['outdoors', /\b(outdoors?|walk\w*|hik\w*|nature|environment\w*|trees?|conservation)\b/],
  ['home', /\b(home\w*|house\w*|household\w*|domestic)\b/],
];

/** A picture for a theme name or slug, or null when nothing fits. */
export function guessThemeIconKey(text: string | null | undefined): ThemeIconKey | null {
  if (!text) return null;
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!words) return null;
  for (const [key, pattern] of GUESSES) {
    if (pattern.test(words)) return key;
  }
  return null;
}

/**
 * The picture for a theme: the administrator's choice, else a guess from the
 * slug (the same in every language), else from the name; null when none fits.
 */
export function themeIconFor(theme: {
  icon?: string | null;
  slug?: string | null;
  name?: string | null;
}): LucideIcon | null {
  if (isThemeIconKey(theme.icon)) return THEME_ICONS[theme.icon];
  const guess = guessThemeIconKey(theme.slug) ?? guessThemeIconKey(theme.name);
  return guess ? THEME_ICONS[guess] : null;
}
