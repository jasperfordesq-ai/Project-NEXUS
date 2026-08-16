// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The character count must announce in the member's own language.
 *
 * 🔴 govuk-frontend ships ENGLISH defaults inside its own JavaScript bundle
 * (`charactersUnderLimit`, `charactersAtLimit`, `charactersOverLimit`). A page that adds
 * the component without passing replacements gets those English strings read out to
 * speakers of all eleven languages, and nothing on the page looks wrong — which is
 * exactly how this class of defect survives.
 *
 * 🔴 It also THROWS an ElementError if the `{id}-info` element is missing, and silently
 * writes its own English allowance sentence into that element if it is left empty. Both
 * are asserted here, because either would be invisible in a passing page render.
 */

const fs = require('fs');
const nunjucks = require('nunjucks');
const path = require('path');

const { createTranslator } = require('../src/lib/localization');
const { characterCountMessages, describeAllowance } = require('../src/lib/character-count-messages');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const env = nunjucks.configure(
  [viewsDirectory, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);

function renderMacro(locale, maxlength = 500, id = 'reason') {
  const t = createTranslator(locale);
  return env.renderString(
    `{% from "_character-count.njk" import characterCount %}`
    + `{% call characterCount(${maxlength}, characterCountMessages, "${id}") %}`
    + `<div class="govuk-form-group"><textarea class="govuk-textarea govuk-js-character-count" id="${id}" maxlength="${maxlength}" aria-describedby="${id}-info"></textarea></div>`
    + `{% endcall %}`,
    { characterCountMessages: characterCountMessages(t, locale) }
  );
}

describe('character count wrapper', () => {
  it('emits the wrapper govuk-frontend looks for', () => {
    const html = renderMacro('en');

    expect(html).toContain('class="govuk-character-count"');
    expect(html).toContain('data-module="govuk-character-count"');
    expect(html).toContain('data-maxlength="500"');
    // The hook class is how the component finds the field; without it nothing happens.
    expect(html).toContain('govuk-js-character-count');
  });

  it('includes the count message element the component requires', () => {
    // Without this element govuk-frontend throws an ElementError and the component — and
    // any other component initialised after it — does not start.
    const html = renderMacro('en', 500, 'reason');

    expect(html).toContain('id="reason-info"');
    expect(html).toContain('govuk-character-count__message');
  });

  it('fills the count message so the component cannot write English into it', () => {
    // The component replaces the text ONLY when it is blank. An empty element here would
    // therefore produce "You can enter up to 500 characters" in every language.
    const html = renderMacro('ga', 500, 'reason');
    const info = html.match(/id="reason-info"[^>]*>([^<]*)</);

    expect(info).not.toBeNull();
    expect(info[1].trim()).not.toBe('');
    expect(info[1]).not.toMatch(/You can enter|characters remaining/);
  });

  it('passes translated announcements for every plural form', () => {
    const html = renderMacro('en');

    expect(html).toContain('data-i18n.characters-under-limit.one=');
    expect(html).toContain('data-i18n.characters-under-limit.other=');
    expect(html).toContain('data-i18n.characters-at-limit=');
    expect(html).toContain('data-i18n.characters-over-limit.other=');
    // govuk-frontend's own placeholder must survive untouched — it is substituted in the
    // browser, so interpolating it here would freeze the number.
    expect(html).toContain('%{count}');
  });

  it('announces in the member language, not English', () => {
    const irish = renderMacro('ga');
    const arabic = renderMacro('ar');

    expect(irish).toContain('Tá %{count} charachtar fágtha agat');
    expect(irish).not.toContain('You have %{count} character remaining');
    expect(arabic).not.toContain('You have %{count} character remaining');
  });
});

describe('allowance sentence', () => {
  it('uses the locale plural category rather than English rules', () => {
    // 🔴 Irish has five plural categories and Arabic six, against English's two. Picking
    // by English rules would be grammatically wrong in most of the eleven languages, and
    // a count-only check would pass while doing exactly that — so assert the WORD FORM.
    const english = createTranslator('en');
    expect(describeAllowance(english, 'en', 1)).toBe('You have 1 character remaining');
    expect(describeAllowance(english, 'en', 500)).toBe('You have 500 characters remaining');

    // 🔴 Assert the WORD FORM, not the whole sentence. Comparing two rendered sentences
    // proves nothing: the number differs, so they differ even when the grammar is wrong.
    // My first version of this test made exactly that mistake and passed while the code
    // was deliberately broken to use English rules.
    //
    // These are the counts where Irish and English disagree. English has no category
    // that produces them, so each assertion fails if the locale is ignored:
    //   3 -> Irish "few"  : charachtar (lenited)   English "other" -> carachtar
    //   8 -> Irish "many" : gcarachtar (eclipsed)  English "other" -> carachtar
    const irish = createTranslator('ga');
    expect(describeAllowance(irish, 'ga', 3)).toContain('charachtar');
    expect(describeAllowance(irish, 'ga', 8)).toContain('gcarachtar');
    expect(describeAllowance(irish, 'ga', 500)).toContain('carachtar');

    // Arabic has a DUAL form for exactly two that English has no equivalent of at all.
    const arabic = createTranslator('ar');
    expect(describeAllowance(arabic, 'ar', 2)).toContain('حرفان');
    expect(describeAllowance(arabic, 'ar', 500)).not.toContain('حرفان');

    // The placeholder must be substituted here, unlike the live-count attributes.
    expect(describeAllowance(english, 'en', 500)).not.toContain('%{count}');
  });

  it('returns empty rather than a broken sentence for a non-numeric limit', () => {
    expect(describeAllowance(createTranslator('en'), 'en', 'not-a-number')).toBe('');
  });
});

describe('the converted fields', () => {
  const CONVERTED = [
    ['events/ticket-cancel.njk', 'ticket-cancellation-reason'],
    ['events/check-in.njk', 'signed-code-reason'],
    ['events/check-in-credential.njk', 'revoke-credential-reason'],
    ['events/agenda.njk', 'agenda-session-{{ session.id }}-cancel-reason'],
    ['groups/files.njk', 'file-description'],
    ['events/moderation-decision.njk', 'reason'],
    // 2026-08-14 audit pass — the acute short-limit fields, where silent truncation
    // bites a member writing a note they cannot see the end of. Ids taken from the
    // real textareas (some are loop/record-scoped, e.g. reason_{{ action.id }}).
    ['saved-social/appreciations.njk', 'appreciation-message'],
    ['volunteering/swaps.njk', 'message'],
    ['volunteering/wellbeing.njk', 'note'],
    ['listings/report.njk', 'details'],
    ['onboarding/index.njk', 'bio'],
  ];

  it.each(CONVERTED)('%s wires the field to the counter', (file, id) => {
    const source = fs.readFileSync(path.join(viewsDirectory, file), 'utf8');

    expect(source).toContain('{% from "_character-count.njk" import characterCount %}');
    expect(source).toContain('{% call characterCount(');
    // The three things the component needs, each of which fails silently on its own.
    const escId = id.replace(/[{}|.*+?^$()[\]\\]/g, '\\$&');
    expect(source).toMatch(new RegExp(`<textarea[^>]*id="${escId}"[^>]*govuk-js-character-count|<textarea[^>]*govuk-js-character-count[^>]*id="${escId}"`));
    // `${id}-info` must be REFERENCED by aria-describedby, but it may be appended after
    // an existing -hint/-error id rather than sitting first — so match it anywhere in
    // the attribute value, not only at the start.
    expect(source).toMatch(new RegExp(`aria-describedby="[^"]*${escId}-info`));
  });

  it.each(CONVERTED)('%s keeps maxlength for members without JavaScript', (file) => {
    // The counter is an enhancement. `maxlength` is what actually enforces the limit when
    // scripts do not run, and govuk-frontend removes it itself once it takes over.
    const source = fs.readFileSync(path.join(viewsDirectory, file), 'utf8');
    expect(source).toMatch(/<textarea[^>]*govuk-js-character-count[^>]*maxlength="\d+"|<textarea[^>]*maxlength="\d+"[^>]*govuk-js-character-count/);
  });

  it('keeps the whole converted set attached (floor ratchet)', () => {
    // A floor, not an exact count: the 2026-08-14 audit brought the number of
    // reachable-maxlength textareas carrying the counter to 59. If a later edit strips
    // the component off a field, this catches the regression. Raise the floor when more
    // are converted; never lower it without a recorded reason.
    let attached = 0;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(entry.parentPath ?? dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.njk') || entry.name === '_character-count.njk') continue;
        const src = fs.readFileSync(full, 'utf8');
        attached += (src.match(/govuk-js-character-count/g) || []).length;
      }
    };
    walk(viewsDirectory);
    expect(attached).toBeGreaterThanOrEqual(59);
  });

  it('never passes a {{ }}-interpolated string literal as the characterCount id', () => {
    // 🔴 Nunjucks does NOT interpolate {{ }} inside a string literal passed to a
    // macro, so `characterCount(500, msgs, "x-{{ id }}-reason")` emits an element
    // id with LITERAL braces — a broken aria-describedby target, duplicate ids
    // across a loop, and a govuk-frontend ElementError. Build the id with `{% set %}`
    // + string concatenation and pass the variable (see events/agenda.njk). This
    // ratchet keeps the whole class shut.
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(entry.parentPath ?? dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.njk')) continue;
        const src = fs.readFileSync(full, 'utf8');
        // A characterCount( call whose argument list contains a quoted string
        // literal with {{ inside it.
        if (/characterCount\([^)]*"[^"]*\{\{/.test(src)) {
          offenders.push(path.relative(viewsDirectory, full));
        }
      }
    };
    walk(viewsDirectory);
    expect(offenders).toEqual([]);
  });
});
