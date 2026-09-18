// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * The platform feature catalogue, and the server-side filtering behind /features.
 *
 * The data is generated — see scripts/build-features-catalogue.js for where it comes
 * from and why it is a committed copy rather than a direct read.
 *
 * 🔴 Filtering happens HERE, on the server, not in the browser. The React page does
 * it in JavaScript with a search box and filter chips; this frontend is HTML-first, so
 * the same capability is a plain GET form whose results are computed before the page
 * is sent. Someone with JavaScript switched off gets working search, which is the
 * whole point of this frontend.
 */

const catalogue = require('./generated/features-catalogue.json');

/** Sentinel for "no category chosen", matching the React page's own. */
const ALL_CATEGORIES = '__all__';

const FALLBACK_LOCALE = 'en';

function textFor(locale) {
  return catalogue.text[locale] || catalogue.text[FALLBACK_LOCALE];
}

/**
 * Fold case and strip accents so a search for "creditos" finds "créditos".
 *
 * 🔴 Do this on BOTH sides of the comparison or it is worse than not doing it:
 * normalising only the query makes an accented word unfindable by its accented
 * spelling, which is the spelling a native speaker actually types.
 */
function foldForSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Every group, with its localised title and items, unfiltered.
 *
 * @param {string} locale
 * @returns {Array<{key: string, title: string, intro: string, items: Array<object>}>}
 */
function allGroups(locale) {
  const text = textFor(locale);
  return catalogue.groups.map((group) => {
    const groupText = (text.groups || {})[group.key] || {};
    return {
      key: group.key,
      title: groupText.title || group.key,
      intro: groupText.intro || '',
      items: group.items.map((item) => {
        const itemText = ((groupText.items || {})[item.key]) || {};
        return {
          key: item.key,
          maturity: item.maturity,
          title: itemText.title || item.key,
          description: itemText.description || '',
        };
      }),
    };
  });
}

/**
 * Apply the search box and the category select.
 *
 * A group with no surviving items is dropped entirely rather than rendered as an
 * empty heading — an empty section reads to a screen reader as a dead end.
 *
 * @param {{ locale: string, query?: string, category?: string }} options
 */
function filterCatalogue({ locale, query = '', category = ALL_CATEGORIES } = {}) {
  const groups = allGroups(locale);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  const needle = foldForSearch(query);
  const requested = category && category !== ALL_CATEGORIES ? category : '';
  const categoryIsKnown = !requested || catalogue.groups.some((g) => g.key === requested);

  // 🔴 An unknown category is IGNORED, not applied. Applying it matched nothing, so a
  // stale or hand-edited link produced "Showing 0 of 119" underneath a dropdown that
  // said "Everything" — a dead end that blamed the member for a bad URL.
  const wantedCategory = categoryIsKnown ? requested : '';

  const matched = groups
    .filter((group) => !wantedCategory || group.key === wantedCategory)
    .map((group) => ({
      ...group,
      items: needle
        ? group.items.filter((item) => foldForSearch(`${item.title} ${item.description}`).includes(needle))
        : group.items,
    }))
    .filter((group) => group.items.length > 0);

  const shown = matched.reduce((n, g) => n + g.items.length, 0);

  return {
    groups: matched,
    shown,
    total,
    // An unknown category in the query string is reported rather than silently
    // treated as "everything", so a stale or hand-edited link does not quietly
    // show the wrong thing.
    categoryIsKnown,
    isFiltered: Boolean(needle) || Boolean(wantedCategory),
  };
}

/** Options for the category select, "Everything" first, matching React's chip row. */
function categoryOptions(locale) {
  const text = textFor(locale);
  return [
    { value: ALL_CATEGORIES, label: text.filter_all || 'Everything' },
    ...catalogue.groups.map((group) => ({
      value: group.key,
      label: ((text.groups || {})[group.key] || {}).title || group.key,
    })),
  ];
}

/** The whole localised `features_page` string set, for the page chrome. */
function chromeFor(locale) {
  return textFor(locale);
}

module.exports = {
  ALL_CATEGORIES,
  allGroups,
  categoryOptions,
  chromeFor,
  filterCatalogue,
  foldForSearch,
  groupCount: catalogue.groupCount,
  itemCount: catalogue.itemCount,
};
