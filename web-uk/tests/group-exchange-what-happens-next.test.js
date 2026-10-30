// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * AWID accessibility report item 16 (30 Oct 2026): "It is clear that everyone
 * has to confirm, but it isn't explained what happens once everyone has
 * confirmed: whether the exchange takes place through an external link or the
 * platform generates one." The group exchange page now says, while the exchange
 * is in progress, that members arrange the activity themselves (no meeting link
 * is created) and that the time credits move when the organiser completes it.
 */

const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');
const { createTranslator } = require('../src/lib/localization');

const t = createTranslator('en');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'group-exchanges', 'detail.njk'), 'utf8');
const start = source.indexOf('{# What happens next');
const end = source.indexOf('<h2 class="govuk-heading-l">{{ t("group_exchanges.participants_title") }}</h2>', start);
const block = source.slice(start, end);
const env = new nunjucks.Environment(null, { autoescape: true });
const render = (statusKey) => env.renderString(block, { t, exchange: { statusKey } });

describe('group exchange "What happens next"', () => {
  it('is shown while the exchange is being set up or confirmed', () => {
    for (const statusKey of ['draft', 'pending_confirmation']) {
      const html = render(statusKey);
      expect(html).toContain(t('group_exchanges.how_title'));
      expect(html).toContain('does not create a meeting link');
      expect(html).toContain(nunjucks.lib.escape(t('group_exchanges.how_complete')));
    }
  });

  it('is not shown once the exchange is completed or cancelled', () => {
    for (const statusKey of ['completed', 'cancelled']) {
      expect(render(statusKey)).not.toContain(t('group_exchanges.how_title'));
    }
  });

  it('has its wording in every language', () => {
    for (const locale of ['ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar']) {
      const tl = createTranslator(locale);
      for (const key of ['how_title', 'how_start', 'how_activity', 'how_complete']) {
        expect(tl(`group_exchanges.${key}`)).not.toBe(t(`group_exchanges.${key}`));
      }
    }
  });
});
