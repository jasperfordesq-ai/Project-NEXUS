// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The message-view purpose must survive being put in an HTTP header.
 *
 * 🔴 This is the test that would have caught it. Header values are BYTES:
 * `fetch()` and `Headers` both throw
 *
 *     "Cannot convert argument to a ByteString because the character at index N
 *      has a value of 8217 which is greater than 255"
 *
 * for any code point above U+00FF.
 *
 * Which is exactly why it survived so long. Latin-1 accents pass — Irish,
 * German and French reasons are all under 255 — so the paths a developer here
 * is most likely to try by hand happen to work. What does NOT pass:
 *
 *   - Japanese, Arabic and Polish reasons, so those members could never use the
 *     feature at all; and
 *   - the EM DASH the route joins the reason to the supporter's note with, so
 *     the moment anyone adds a note it fails in every language, English
 *     included.
 *
 * The request therefore never left the process. The route's catch turned the
 * TypeError into `message-view-denied`, so a carer with properly granted consent
 * was told the permission "may have been withdrawn", and no audit row was ever
 * written — on a feature whose entire justification is that every read is
 * audited.
 *
 * These assertions use the REAL `new Headers()` byte check rather than a mocked
 * transport, because a mock accepts any string and is exactly why this survived.
 */

const { encodeHeaderValue } = require('../src/lib/api');
const { createTranslator } = require('../src/lib/localization');

/** True when a value can actually be sent as an HTTP header. */
function isSendableAsHeader(value) {
  try {
    new Headers({ 'X-Message-View-Purpose': value });
    return true;
  } catch {
    return false;
  }
}

const t = createTranslator('en');

describe('the raw purpose really is unsendable — the bug was not hypothetical', () => {
  it.each(['ja', 'ar', 'pl'])('rejects the raw %s reason, so those members could never look', (locale) => {
    const raw = createTranslator(locale)('govuk_alpha_settings.linked_messages.reason_wellbeing');

    expect(isSendableAsHeader(raw)).toBe(false);
  });

  it('rejects the em dash the route joins reason and note with, in ANY language', () => {
    // This is the shape settings-supported-messages.js builds whenever the
    // supporter writes a note, so English was broken too the moment they did.
    const purpose = `${t('govuk_alpha_settings.linked_messages.reason_safety')} — she has not replied`;

    expect(isSendableAsHeader(purpose)).toBe(false);
  });

  it('accepts a Latin-1 reason raw, which is precisely why this went unnoticed', () => {
    // Irish, German and French reasons are all under U+0100, so hand-testing in
    // those languages shows nothing wrong.
    const irish = createTranslator('ga')('govuk_alpha_settings.linked_messages.reason_wellbeing');

    expect(isSendableAsHeader(irish)).toBe(true);
  });
});

describe('encodeHeaderValue makes every locale sendable', () => {
  const reasons = ['wellbeing', 'safety', 'helping_reply', 'other'];

  it.each(['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'])(
    'every %s reason survives encoding',
    (locale) => {
      const translate = createTranslator(locale);
      for (const reason of reasons) {
        const purpose = translate(`govuk_alpha_settings.linked_messages.reason_${reason}`);
        expect(isSendableAsHeader(encodeHeaderValue(purpose))).toBe(true);
      }
    }
  );

  it('survives a reason joined to free text with an em dash', () => {
    const purpose = `${t('govuk_alpha_settings.linked_messages.reason_safety')} — Máire has not replied since Tuesday`;

    expect(isSendableAsHeader(encodeHeaderValue(purpose))).toBe(true);
  });

  it('round-trips exactly, so the audit row records what the supporter typed', () => {
    const purpose = "Checking they’re okay — Máire, 日本語, العربية, 50% sure";
    const encoded = encodeHeaderValue(purpose);

    expect(encoded.startsWith("UTF-8''")).toBe(true);
    // The server decodes with rawurldecode after stripping the prefix.
    expect(decodeURIComponent(encoded.slice(7))).toBe(purpose);
  });

  it('encodes unconditionally, including plain ASCII', () => {
    // 🔴 Deliberate. A "only encode when non-ASCII" shortcut would leave the
    // ASCII path as the only one ever exercised in a test — which is how this
    // went unnoticed. Laravel accepts both forms.
    expect(encodeHeaderValue('A safety concern')).toBe("UTF-8''A%20safety%20concern");
  });

  it('handles an empty or missing purpose without producing "undefined"', () => {
    expect(encodeHeaderValue('')).toBe("UTF-8''");
    expect(encodeHeaderValue(undefined)).toBe("UTF-8''");
  });
});
