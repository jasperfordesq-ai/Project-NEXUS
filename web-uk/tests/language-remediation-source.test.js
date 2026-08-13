// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('language remediation source contracts', () => {
  it('renders the federation hub exclusively through translation keys', () => {
    const template = source('src/views/federation/index.njk');
    const forbiddenEnglish = [
      'This community has not enabled cross-community federation yet.',
      'Federation status',
      'Recent activity',
      'No recent federation activity.',
      'Federation links',
      'Turn off federation'
    ];

    for (const literal of forbiddenEnglish) expect(template).not.toContain(literal);
    expect(template).toContain('t("web_uk.federation_hub.not_enabled_description")');
    expect(template).toContain('t("web_uk.federation_hub.links_heading")');
  });

  it('passes translated timeout copy to the client instead of embedding English', () => {
    const template = source('src/views/layouts/base.njk');
    const script = source('public/js/timeout-warning.js');

    expect(template).toContain('data-timeout-title="{{ t(\'web_uk.session_timeout.title\') }}"');
    expect(template).toContain('data-timeout-minutes-one="{{ t(\'web_uk.session_timeout.minutes.one\') }}"');
    expect(script).toContain("timeoutText('data-timeout-title')");
    expect(script).not.toContain('You will be signed out soon');
    expect(script).not.toContain('Stay signed in');
  });

  it('localizes event form validation errors at the request boundary', () => {
    const routes = source('src/routes/events.js');

    expect(routes).toContain("res.locals.t('web_uk.event_validation.title_required')");
    expect(routes).toContain("res.locals.t('web_uk.event_validation.start_required')");
    expect(routes).not.toContain("text: 'Enter an event title'");
    expect(routes).not.toContain("text: 'Enter a start date and time'");
  });

  it('enhances bounded text areas with the official localized character-count component', () => {
    const template = source('src/views/layouts/base.njk');
    const init = source('public/js/init.js');

    expect(template).toContain('id="character-count-translations"');
    expect(template).toContain('data-i18n.characters-under-limit.one="{{ t(\'web_uk.character_count.characters_under_limit.one\') }}"');
    expect(init).toContain("wrapper.setAttribute('data-module', 'govuk-character-count')");
    expect(init).toContain('message.textContent = translatedCharacterCount(Number(maximum))');
    expect(init.indexOf('prepareCharacterCounts();')).toBeLessThan(init.indexOf('initAll();'));
  });
});
