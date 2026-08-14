// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Translated announcements for `govukCharacterCount`.
 *
 * 🔴 Without these the component announces ENGLISH to every member, in every language.
 * govuk-frontend ships its own English defaults inside its JavaScript bundle
 * (`charactersUnderLimit`, `charactersAtLimit`, `charactersOverLimit`), and they are used
 * unless the page passes replacements — so an Irish or Arabic speaker typing into a
 * limited text box would hear "You have 12 characters remaining" from a screen reader
 * regardless of the language they chose.
 *
 * 🔴 The plural forms are NOT decoration. Irish has five (one / two / few / many /
 * other) where English has two, and Arabic has six. Passing a single string would be
 * grammatically wrong in most of the eleven languages we serve. The catalogue carries a
 * value for every category; this reads each one by its own path because the translator
 * returns the key itself for a non-string value, so the object cannot be fetched whole.
 *
 * 🔴 The placeholder is `%{count}`, which is govuk-frontend's own interpolation syntax,
 * NOT our `:count` or `{count}`. Our translator must not touch it — it is substituted in
 * the browser by the component, long after this runs.
 */

const PLURAL_CATEGORIES = ['one', 'two', 'few', 'many', 'other'];
const KEY_PREFIX = 'web_uk.character_count';

function pluralMessages(t, key) {
  const messages = {};
  for (const category of PLURAL_CATEGORIES) {
    const path = `${KEY_PREFIX}.${key}.${category}`;
    const value = t(path);
    // The translator returns the key itself when a path is missing. Passing that through
    // would render the literal key to a screen reader, which is worse than the English
    // default, so drop it and let govuk-frontend fall back.
    if (value && value !== path) {
      messages[category] = value;
    }
  }
  return messages;
}

/**
 * The static allowance text that must sit in the `{id}-info` element.
 *
 * 🔴 That element is NOT optional: govuk-frontend THROWS an ElementError without it, and
 * if it is left empty the component writes its own English "You can enter up to N
 * characters" into it — in every language.
 *
 * 🔴 There is no translated key for that sentence, and adding one would need Irish, which
 * must not be machine-translated (`translate-php-lang-gaps.mjs` deliberately skips `ga`
 * because Google's Irish is poor). So this reuses the `characters_under_limit` strings,
 * which ARE translated in all eleven languages and say the right thing at page load —
 * "You have 500 characters remaining". The component replaces the live count separately
 * as soon as the member types, so this text only has to be correct initially.
 *
 * Plural category comes from `Intl.PluralRules`, so Irish gets one of its five forms and
 * Arabic one of its six, rather than English's two being imposed on them.
 */
function describeAllowance(t, locale, maxlength) {
  const count = Number(maxlength);
  if (!Number.isFinite(count)) return '';

  let category = 'other';
  try {
    category = new Intl.PluralRules(locale || 'en').select(count);
  } catch {
    category = 'other';
  }

  const messages = pluralMessages(t, 'characters_under_limit');
  const template = messages[category] || messages.other || '';
  // `%{count}` is govuk-frontend's placeholder, not ours — our translator leaves it
  // alone, so substitute it here.
  return template.replace(/%\{count\}/g, String(count));
}

/**
 * @param {(key: string) => string} t request-scoped translator
 * @param {string} locale for plural-category selection
 * @returns {{under: object, at: string, over: object, describe: (max: number) => string}}
 */
function characterCountMessages(t, locale = 'en') {
  if (typeof t !== 'function') return null;
  const atKey = `${KEY_PREFIX}.characters_at_limit`;
  const at = t(atKey);
  return {
    under: pluralMessages(t, 'characters_under_limit'),
    at: at === atKey ? undefined : at,
    over: pluralMessages(t, 'characters_over_limit'),
    describe: (maxlength) => describeAllowance(t, locale, maxlength),
  };
}

module.exports = { characterCountMessages, describeAllowance, PLURAL_CATEGORIES };
