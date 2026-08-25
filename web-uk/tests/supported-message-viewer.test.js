// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The consented read-only message viewer (2026-08-25).
 *
 * Walking it as a carer who had been granted access found four faults, and the
 * first of them meant the page could never load at all:
 *
 *  1. The stated purpose travels in `X-Message-View-Purpose`. Header values are
 *     BYTES — `fetch()` throws "Cannot convert argument to a ByteString" for any
 *     code point above 255 — and the purpose is translated copy joined to free
 *     text with an em dash. The ENGLISH reason "Checking they're okay" already
 *     carries a curly apostrophe. So the request never left the process; the
 *     route's catch turned that into "the permission may have been withdrawn",
 *     and no audit row was ever written.
 *
 *  2. Every conversation was headed "Unknown member": the endpoint sends
 *     `other_user.name` as null alongside `first_name`/`last_name`.
 *
 *  3. Every message in a thread was attributed to "Unknown member" for the same
 *     reason — there is no `sender_name`, only a nested `sender`.
 *
 *  4. `open_thread` is "Conversation with :name". It was called with no
 *     replacement, so the member read the literal ":name", and the same string
 *     was reused as the pagination button's label.
 */

const nunjucks = require('nunjucks');
const path = require('path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

const env = nunjucks.configure(
  [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);
registerTemplateFilters(env);

const shell = {
  t: createTranslator('en'),
  tc: createChoiceTranslator('en'),
  urlFor: (pathname) => pathname,
  formatLocaleNumber: (value) => String(value),
  formatLocaleDate: (value) => String(value ?? ''),
  isAuthenticated: true,
  tenantName: 'Acme Timebank',
  serviceName: 'Project NEXUS Accessible',
  communityName: 'Acme Timebank',
  alphaNavItems: [],
  alphaFooterColumns: [],
  alphaLocaleOptions: [],
  alphaLanguageQueryParams: [],
  alphaCurrentLocale: 'en',
  htmlLang: 'en',
  htmlDirection: 'ltr',
  csrfToken: 'test-csrf'
};

function visibleText(html) {
  const main = /<main[\s\S]*?<\/main>/.exec(html);
  return (main ? main[0] : html)
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Exactly the shape GET /users/me/sub-accounts/{id}/messages returns: a null
// composite `name` beside a populated first/last.
const CONVERSATION = {
  partner_id: 900014,
  other_user: { id: 900014, name: null, first_name: 'Bríd', last_name: 'Ní Mhaoldomhnaigh' },
  last_message: { body: 'Can you help on Sunday?' }
};

describe('the conversation list names the person, not "Unknown member"', () => {
  it('composes the partner name from first and last', () => {
    const html = env.render('settings/supported-messages.njk', {
      ...shell, childUserId: 900015, childName: 'Mary Casey', conversations: [CONVERSATION], nextCursor: null
    });
    const text = visibleText(html);

    expect(text).toContain('Bríd Ní Mhaoldomhnaigh');
    expect(text).not.toContain('Unknown member');
  });

  it('interpolates the name into the thread link instead of printing ":name"', () => {
    const html = env.render('settings/supported-messages.njk', {
      ...shell, childUserId: 900015, childName: 'Mary Casey', conversations: [CONVERSATION], nextCursor: null
    });
    const text = visibleText(html);

    expect(text).toContain('Conversation with Bríd Ní Mhaoldomhnaigh');
    expect(html).not.toContain(':name');
  });

  it('labels the pagination button as pagination, not as a conversation', () => {
    const html = env.render('settings/supported-messages.njk', {
      ...shell, childUserId: 900015, childName: 'Mary Casey', conversations: [CONVERSATION], nextCursor: 'abc'
    });
    const button = /<a class="govuk-button[\s\S]*?<\/a>/.exec(html);

    expect(button).not.toBeNull();
    expect(button[0]).toContain('Load more');
    expect(button[0]).not.toContain('Conversation with');
  });

  it('still says "Unknown member" when the API really sends nothing', () => {
    const html = env.render('settings/supported-messages.njk', {
      ...shell,
      childUserId: 900015,
      childName: 'Mary Casey',
      conversations: [{ partner_id: 3, other_user: { id: 3 }, last_message: { body: 'Hello' } }],
      nextCursor: null
    });

    expect(visibleText(html)).toContain('Unknown member');
  });
});

describe('a thread attributes every message to its real sender', () => {
  const messages = [
    { id: 1, body: 'Can you help on Sunday?', sender: { id: 900014, first_name: 'Bríd', last_name: 'Ní Mhaoldomhnaigh' } },
    { id: 2, body: 'Yes, I can bring a soldering iron.', sender: { id: 900015, first_name: 'Mary', last_name: 'Casey' } }
  ];

  it('reads the nested sender object, since there is no sender_name', () => {
    const html = env.render('settings/supported-messages-thread.njk', {
      ...shell, childUserId: 900015, childName: 'Mary Casey', partnerUserId: 900014, messages
    });
    const text = visibleText(html);

    expect(text).toContain('Bríd Ní Mhaoldomhnaigh');
    expect(text).toContain('Mary Casey');
    expect(text).not.toContain('Unknown member');
  });

  it('keeps the read-only promise visible', () => {
    const html = env.render('settings/supported-messages-thread.njk', {
      ...shell, childUserId: 900015, childName: 'Mary Casey', partnerUserId: 900014, messages
    });

    expect(visibleText(html)).toContain('Read-only.');
    // No reply box, no mark-as-read, no action of any kind. Asserted on what
    // the page could POST rather than on the presence of any <form>: the
    // shared shell puts a hidden session-timeout sign-out form inside <main>
    // on every page, so a bare '<form' check fails for the wrong reason.
    const actions = [...html.matchAll(/<form[^>]*action="([^"]*)"/g)].map((m) => m[1]);
    expect(actions.filter((a) => a.includes('messages'))).toEqual([]);
    expect(html).not.toContain('<textarea');
  });
});

describe('the purpose page announces guidance, not an error', () => {
  it('says "Warning", not "There is a problem"', () => {
    const html = env.render('settings/supported-messages-purpose.njk', {
      ...shell,
      childUserId: 900015,
      childName: 'Mary Casey',
      partnerId: null,
      reasons: ['wellbeing', 'safety', 'helping_reply', 'other']
    });
    const warning = /<strong class="govuk-warning-text__text">[\s\S]*?<\/strong>/.exec(html);

    expect(warning).not.toBeNull();
    // A screen reader must not hear "There is a problem" before the member has
    // typed anything: this box is guidance about a permanent record.
    expect(warning[0]).toContain('Warning');
    expect(warning[0]).not.toContain('There is a problem');
  });
});
