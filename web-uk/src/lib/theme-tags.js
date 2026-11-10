// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
'use strict';

/**
 * The GOV.UK tag colour for each theme (category) — AWID feedback, Nov 2026:
 * "clear categories, attractive visuals".
 *
 * Only the official govuk-frontend 6 tag colours are used (no custom colours,
 * and not the deprecated turquoise/pink), so every tag keeps the Design
 * System's tested text contrast. The rule matches the React site
 * (react-frontend/src/lib/categoryColours.ts, themeColourNames):
 *
 *  - Every category is created 'blue' (the database default). While all of a
 *    community's themes share one stored colour, they are coloured in turn.
 *  - As soon as an admin gives themes different colours, each shows the
 *    nearest official tag colour to the one chosen.
 *
 * The rotation leaves out blue and purple (the Offer and Request tags beside
 * it), red (GOV.UK keeps it for urgent things) and grey (inactive things).
 */

const THEME_ROTATION = Object.freeze(['green', 'teal', 'orange', 'magenta', 'yellow']);

// Admin colour names (Admin → Categories) → nearest official tag colour.
const TAG_FOR_COLOUR = Object.freeze({
  red: 'red', rose: 'red',
  orange: 'orange', amber: 'orange',
  yellow: 'yellow',
  green: 'green', emerald: 'green',
  teal: 'teal', cyan: 'teal',
  sky: 'blue', blue: 'blue', indigo: 'blue',
  violet: 'purple', purple: 'purple',
  fuchsia: 'magenta', pink: 'magenta',
  gray: 'grey', slate: 'grey'
});

function colourName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** The tag class for a stored colour name. Blue is the tag's default, so it needs none. */
function tagClassForColour(value) {
  const tag = TAG_FOR_COLOUR[colourName(value)] || 'grey';
  return tag === 'blue' ? '' : `govuk-tag--${tag}`;
}

/**
 * Category id → tag class, for the community's whole list of themes (in the
 * order the API gives them, so a theme keeps its colour from page to page).
 */
function themeTagClasses(categories) {
  const list = (Array.isArray(categories) ? categories : []).filter((category) => category && category.id);
  const allTheSame = new Set(list.map((category) => colourName(category.color))).size <= 1;
  const classes = new Map();
  list.forEach((category, index) => {
    classes.set(Number(category.id), allTheSame
      ? `govuk-tag--${THEME_ROTATION[index % THEME_ROTATION.length]}`
      : tagClassForColour(category.color));
  });
  return classes;
}

module.exports = { THEME_ROTATION, TAG_FOR_COLOUR, tagClassForColour, themeTagClasses };
