// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GOV.UK component-semantics conformance.
 *
 * Each block below pins a GDS misuse that was found by audit and is now fixed,
 * so it cannot silently come back. The four classes of fault:
 *
 *   1. A checkbox/radio group hint that no assistive technology can reach —
 *      a `govuk-hint` with no id, in a fieldset with no aria-describedby, or a
 *      per-option hint nested INSIDE the <label> (which folds the whole
 *      description into the control's accessible NAME instead of its
 *      description).
 *   2. `govuk-warning-text` used for a question, a heading or a status. The
 *      yellow "!" means a CONSEQUENCE of an action the member is about to take.
 *   3. An error summary for a transient send/load failure linked to a field the
 *      member did not get wrong and cannot fix.
 *   4. `govuk-panel--confirmation` — the big green end-of-transaction panel —
 *      used for a data display or a transient flash status.
 */
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const read = (relative) => fs.readFileSync(path.join(VIEWS, ...relative.split('/')), 'utf8');
const stripComments = (source) => source.replace(/\{#[\s\S]*?#\}/g, '');

// Every template this file touches. Compiling each one catches an unbalanced
// tag or a Nunjucks syntax error in the restructured markup, which a
// source-string assertion cannot see.
const TOUCHED_TEMPLATES = [
  'events/reminders.njk',
  'events/communications.njk',
  'achievements/showcase.njk',
  'onboarding/index.njk',
  'jobs/alerts.njk',
  'support/trust-safety.njk',
  'federation/opt-out.njk',
  'volunteering/org-dashboard.njk',
  'goals/buddy-actions.njk',
  'goals/reminder.njk',
  'goals/discover.njk',
  'goals/templates.njk',
  'coupons/detail.njk',
  'wallet/index.njk',
  'courses/detail.njk',
];

describe('templates changed for GDS conformance still compile', () => {
  const environment = new nunjucks.Environment(
    new nunjucks.FileSystemLoader([
      VIEWS,
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist'),
    ]),
    { autoescape: true }
  );

  it.each(TOUCHED_TEMPLATES)('%s compiles', (relative) => {
    expect(() => environment.getTemplate(relative, true)).not.toThrow();
  });
});

describe('checkbox group hints are announced (GDS + WCAG 1.3.1)', () => {
  /**
   * Both fieldsets rendered a `govuk-hint` straight after the legend with no
   * id, inside a fieldset with no aria-describedby, so the hint existed
   * visually and was unreachable by a screen reader.
   */
  it('events/reminders.njk points each fieldset at its own hint', () => {
    const source = read('events/reminders.njk');

    for (const hintId of ['reminders-timing-hint', 'reminders-channels-hint']) {
      expect(source).toContain(`aria-describedby="${hintId}"`);
      expect(source).toContain(`<div id="${hintId}" class="govuk-hint">`);
    }

    // No hint left dangling without an id inside this form.
    expect(source).not.toContain('<legend class="govuk-fieldset__legend govuk-fieldset__legend--m">{{ t("govuk_alpha_events.reminders.timing") }}</legend><div class="govuk-hint">');
    expect(source).not.toContain('<legend class="govuk-fieldset__legend govuk-fieldset__legend--m">{{ t("govuk_alpha_events.reminders.channels") }}</legend><div class="govuk-hint">');
  });

  it('events/communications.njk points the segments fieldset at its hint', () => {
    const source = read('events/communications.njk');

    expect(source).toContain('aria-describedby="communication-segments-hint"');
    expect(source).toContain('<div id="communication-segments-hint" class="govuk-hint">');
    expect(source).not.toContain('{{ t("govuk_alpha.events.communications.segments_label") }}</legend><div class="govuk-hint">');
  });

  /**
   * The per-badge description sat INSIDE the <label>, so the checkbox's
   * accessible name became "Name Description" instead of "Name" described by
   * "Description".
   */
  it('achievements/showcase.njk describes each badge checkbox instead of renaming it', () => {
    const source = read('achievements/showcase.njk');

    expect(source).toContain('aria-describedby="showcase-{{ loop.index0 }}-hint"');
    expect(source).toContain('<div id="showcase-{{ loop.index0 }}-hint" class="govuk-hint govuk-checkboxes__hint">{{ badge.description }}</div>');

    // The description must no longer be inside the label element.
    const label = /<label class="govuk-label govuk-checkboxes__label" for="showcase-\{\{ loop\.index0 \}\}">[\s\S]*?<\/label>/.exec(source);
    expect(label).not.toBeNull();
    expect(label[0]).not.toContain('badge.description');
  });
});

describe('onboarding safeguarding is one GDS checkbox question', () => {
  const source = stripComments(read('onboarding/index.njk'));
  const region = source.slice(
    source.indexOf('{% elif step == "safeguarding" %}'),
    source.indexOf('{% else %}', source.indexOf('{% elif step == "safeguarding" %}'))
  );

  it('locates the safeguarding step', () => {
    expect(region.length).toBeGreaterThan(500);
    expect(region).toContain('govuk_alpha.onboarding.safeguarding.options_legend');
  });

  it('uses exactly one fieldset and one checkboxes container', () => {
    expect(region.match(/<fieldset/g)).toHaveLength(1);
    expect(region.match(/class="govuk-checkboxes" data-module="govuk-checkboxes"/g)).toHaveLength(1);
  });

  /**
   * "None of these apply" used to live in a SECOND .govuk-checkboxes outside
   * the fieldset, so the legend's question was never announced for it. It now
   * sits inside the same fieldset behind the GDS divider.
   */
  it('keeps the exclusive option inside the fieldset behind a govuk-checkboxes__divider', () => {
    const fieldsetOpen = region.indexOf('<fieldset');
    const fieldsetClose = region.indexOf('</fieldset>');
    const divider = region.indexOf('govuk-checkboxes__divider');
    const noneOption = region.indexOf('name="safeguarding[{{ noneOption.id }}]"');

    expect(divider).toBeGreaterThan(fieldsetOpen);
    expect(divider).toBeLessThan(fieldsetClose);
    expect(noneOption).toBeGreaterThan(divider);
    expect(noneOption).toBeLessThan(fieldsetClose);

    // The hand-rolled separator it replaced is gone.
    expect(region).not.toContain('govuk-section-break--visible govuk-section-break--m');
    expect(region).not.toContain('<p class="govuk-body govuk-!-font-weight-bold">');
  });

  /**
   * .govuk-checkboxes accepts only __item / __divider / __conditional children.
   * The info blocks and the select questions used to be direct children of it.
   */
  it('renders info blocks and select questions outside the checkboxes container', () => {
    const fieldsetOpen = region.indexOf('<fieldset');
    const fieldsetClose = region.indexOf('</fieldset>');

    const inset = /<div class="govuk-inset-text">\s*<p class="govuk-body govuk-!-margin-bottom-0">\{\{ option\.label \}\}/.exec(region);
    expect(inset).not.toBeNull();
    expect(inset.index).toBeLessThan(fieldsetOpen);

    const selectGroup = region.indexOf('<div class="govuk-form-group govuk-!-margin-top-4">');
    expect(selectGroup).toBeGreaterThan(fieldsetClose);
  });

  it('wires each option description and help link to its checkbox', () => {
    expect(region).toContain('aria-describedby="{% if option.description %}sg-{{ option.id }}-hint');
    expect(region).toContain('<div id="sg-{{ option.id }}-hint" class="govuk-hint govuk-checkboxes__hint">{{ option.description }}</div>');
    expect(region).toContain('<div id="sg-{{ option.id }}-help" class="govuk-hint govuk-checkboxes__hint">');
    // The select question keeps its own hint wiring.
    expect(region).toContain('<select class="govuk-select" id="sg-{{ option.id }}" name="safeguarding[{{ option.id }}]"{% if option.description %} aria-describedby="sg-{{ option.id }}-hint"{% endif %}>');
    // The help link markup the shared shell test pins is unchanged.
    expect(region).toContain('href="{{ option.help_url }}" rel="noopener">{{ t("govuk_alpha.help.title") }}</a>');
  });
});

describe('govuk-warning-text carries a consequence, not a question or a status', () => {
  const warningTextBlocks = (source) => [
    ...stripComments(source).matchAll(/<div class="govuk-warning-text">[\s\S]*?<\/div>/g),
  ].map((match) => match[0]);

  it('jobs/alerts.njk warns about permanence and asks the question in body copy', () => {
    const source = read('jobs/alerts.njk');
    const blocks = warningTextBlocks(source);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('govuk_alpha.ux.confirm_irreversible');
    expect(blocks[0]).not.toContain('jobs_t4.delete_confirm');
    expect(source).toContain('<p class="govuk-body">{{ t("govuk_alpha.jobs_t4.delete_confirm") }}</p>');
  });

  it('support/trust-safety.njk signposts with inset text under a real heading', () => {
    const source = read('support/trust-safety.njk');

    expect(warningTextBlocks(source)).toHaveLength(0);
    expect(source).toContain('<h2 class="govuk-heading-m">{{ t("trust_safety.safeguarding_title") }}</h2>');
    expect(source).toContain('<div class="govuk-inset-text">');
    expect(source).toContain('{{ t("trust_safety.safeguarding_body") }}');
    // No bolded pseudo-heading standing in for a heading element.
    expect(source).not.toContain('govuk-!-font-weight-bold');
  });

  it('federation/opt-out.njk warns about the consequence, not the title', () => {
    const source = read('federation/opt-out.njk');
    const blocks = warningTextBlocks(source);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('federation.optout.warning_body');
    expect(blocks[0]).not.toContain('federation.optout.warning_title');
    expect(source).toContain('<p class="govuk-body-l">{{ t("federation.optout.warning_title") }}</p>');
  });

  it('volunteering/org-dashboard.njk states pending approval in a notification banner', () => {
    const source = read('volunteering/org-dashboard.njk');

    expect(warningTextBlocks(source)).toHaveLength(0);
    expect(source).toContain('<div class="govuk-notification-banner" role="region" aria-labelledby="org-approval-banner-title" data-module="govuk-notification-banner">');
    expect(source).toContain('id="org-approval-banner-title">{{ t("states.important") }}</h2>');
    expect(source).toContain('{{ t("govuk_alpha_volunteering.org_dashboard.awaiting_approval") }}');
  });
});

describe('transient goals failures do not blame an innocent field', () => {
  // Each of these rendered a "we could not send/load this" failure — produced in
  // a route catch block and carried back on ?status=…-failed — as an error
  // summary whose only link pointed at the first radio button.
  const TRANSIENT = [
    ['goals/buddy-actions.njk', '#type-nudge'],
    ['goals/reminder.njk', '#frequency-daily'],
    ['goals/discover.njk', '#discover-goals'],
    ['goals/templates.njk', '#templates-list'],
  ];

  it.each(TRANSIENT)('%s drops the field link and the autofocus', (relative, oldHref) => {
    const source = read(relative);

    expect(source).toContain('data-module="govuk-error-summary" data-disable-auto-focus="true" tabindex="-1"');
    expect(source).toContain('<div class="govuk-error-summary__body"><p class="govuk-body">{{ errorMessage }}</p></div>');

    // No field href, and no error-list item to hold one.
    expect(source).not.toContain(oldHref);
    expect(source).not.toContain('govuk-error-summary__list');
    // The macro form (which always renders a list) is gone, import included.
    expect(source).not.toContain('govukErrorSummary');
  });

  it.each(TRANSIENT)('%s keeps role="alert" on a nested child, not the focused root', (relative) => {
    const source = stripComments(read(relative));

    expect(source).not.toMatch(/class="govuk-error-summary"[^>]*role="alert"/);
    expect(source).toContain('<div role="alert">');
  });
});

describe('govuk-panel--confirmation is reserved for transaction confirmations', () => {
  it('coupons/detail.njk shows the code as inset text on an ordinary detail page', () => {
    const source = read('coupons/detail.njk');

    expect(stripComments(source)).not.toContain('govuk-panel');
    expect(source).toContain('<h2 class="govuk-heading-m">{{ t("polish_commerce.coupon_code_panel_title") }}</h2>');
    expect(source).toContain('<div class="govuk-inset-text govuk-!-margin-bottom-4">');
    expect(source).toContain('<strong>{{ coupon.code }}</strong>');
  });

  it('wallet/index.njk uses a success notification banner for the transfer flash', () => {
    const source = stripComments(read('wallet/index.njk'));

    expect(source).not.toContain('govuk-panel');
    expect(source).toContain('aria-labelledby="wallet-transfer-success-title"');
    expect(source).toContain('id="wallet-transfer-success-title">{{ t("states.success_title") }}</h2>');
    expect(source).toContain('<p class="govuk-notification-banner__heading">{{ t("wallet.sent") }}</p>');
    // The well-formed three-part banner, matching the donate-sent sibling.
    expect(source).toContain('govuk-notification-banner govuk-notification-banner--success');
    expect(source).toContain('govuk-notification-banner__header');
    expect(source).toContain('govuk-notification-banner__content');
  });

  it('courses/detail.njk lets the enrolled flash use the shared success banner', () => {
    const source = stripComments(read('courses/detail.njk'));

    expect(source).not.toContain('govuk-panel');
    // routes/courses.js gives `enrolled` type: 'success', so there is no longer a
    // separate branch for it.
    expect(source).not.toContain("status.key == 'enrolled'");
    expect(source).toContain("{% if status.type == 'success' %}");
    expect(source).toContain('govuk-notification-banner--success');
  });
});
