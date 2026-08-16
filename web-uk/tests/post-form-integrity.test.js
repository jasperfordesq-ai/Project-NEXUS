// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Two whole-app ratchets, both added 2026-08-14 after an audit found live defects:
 *
 *   1. EVERY POST form template carries a CSRF token. `achievements/showcase.njk`
 *      did not, so saving a badge showcase was rejected as "page expired" — the
 *      feature had never worked, and nothing caught it because no test asserted the
 *      class. This scan is that test.
 *
 *   2. EVERY submit that spends credits or does something destructive has GOV.UK
 *      double-click protection. None did, so a double-click (or back-then-resubmit)
 *      could send a credit transfer twice.
 */
const fs = require('node:fs');
const path = require('node:path');

const VIEWS = path.join(__dirname, '..', 'src', 'views');

/** Every .njk under src/views, recursively. */
function allTemplates(dir = VIEWS, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(entry.parentPath ?? dir, entry.name);
    if (entry.isDirectory()) allTemplates(full, out);
    else if (entry.name.endsWith('.njk')) out.push(full);
  }
  return out;
}

const rel = (p) => path.relative(VIEWS, p).split(path.sep).join('/');

describe('POST form integrity (whole-app ratchets)', () => {
  const templates = allTemplates();

  describe('CSRF token present on every POST form', () => {
    it('finds no POST form template missing _csrf', () => {
      const offenders = [];
      for (const file of templates) {
        const src = fs.readFileSync(file, 'utf8');
        // A template that declares method="post" must also emit the CSRF hidden input.
        // (Some templates hold several POST forms; one _cssrf per form is the real
        //  requirement, but a template with a POST form and ZERO _csrf is always wrong,
        //  which is the regression this locks out.)
        if (/method\s*=\s*["']post["']/i.test(src) && !/name\s*=\s*["']_csrf["']/.test(src)) {
          offenders.push(rel(file));
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('double-click protection on money/destructive submits', () => {
    // Forms that spend credits, transfer, donate, purchase, or permanently delete.
    // Each must carry data-prevent-double-click (plain button) or preventDoubleClick
    // (govukButton macro). Listed explicitly so a NEW money/destructive form is a
    // deliberate addition here, not a silent omission.
    const REQUIRED = [
      'wallet/index.njk',
      'members/profile.njk',
      'federation/transfer.njk',
      'volunteering/donations.njk',
      'marketplace/buy.njk',
      'profile/delete.njk',
      'groups/edit.njk',
      // Added 2026-08-16 after a deeper audit found these money/credit and
      // destructive submits unguarded.
      'group-exchanges/detail.njk',
      'volunteering/org-wallet.njk',
      'achievements/shop.njk',
      'marketplace/offer.njk',
      'premium/index.njk',
      'podcasts/manage.njk',
      // The listing/episode deletes moved off the manage pages to a shared
      // "are you sure?" interstitial (2026-08-16); its confirm button carries
      // the guard. marketplace/manage.njk no longer holds a destructive submit.
      'confirm-delete.njk',
    ];

    it.each(REQUIRED)('%s guards its submit against double activation', (tpl) => {
      const src = fs.readFileSync(path.join(VIEWS, tpl), 'utf8');
      const guarded =
        /data-prevent-double-click\s*=\s*["']true["']/.test(src) ||
        /preventDoubleClick\s*:\s*true/.test(src);
      expect(guarded).toBe(true);
    });
  });
});
