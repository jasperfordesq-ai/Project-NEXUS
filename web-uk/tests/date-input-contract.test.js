// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The GOV.UK three-field date pattern, and a shrink-only ceiling on what is left.
 *
 * 🔴 Why native date inputs are being replaced: GOV.UK guidance is explicit that they
 * fail users. They behave differently in every browser, a mobile calendar cannot
 * practically reach a date years in the past, the device decides the display format, and
 * validation cannot be presented in the service's own style. GDS asks for three plain
 * number fields instead.
 *
 * The conversion is deliberately phased — each one changes a POST handler's parsing, so
 * doing all 36 at once would be a large untested change. The ceiling below stops the
 * remainder growing while they are worked through.
 */

const fs = require('node:fs');
const nunjucks = require('nunjucks');
const path = require('node:path');

const { composeDate, splitDate } = require('../src/lib/date-input');
const { createTranslator } = require('../src/lib/localization');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const env = nunjucks.configure(
  [viewsDirectory, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);

function render(locale, params = {}) {
  const t = createTranslator(locale);
  return env.renderString(
    '{% from "_date-input.njk" import nexusDateInput %}{{ nexusDateInput(params, t) }}',
    { t, params: { name: 'deadline', legend: 'Deadline', ...params } }
  );
}

function renderDateTime(locale, params = {}) {
  const t = createTranslator(locale);
  return env.renderString(
    '{% from "_date-input.njk" import nexusDateTimeInput %}{{ nexusDateTimeInput(params, t) }}',
    { t, params: { name: 'starts', legend: 'Starts', ...params } }
  );
}

describe('date composer', () => {
  it('accepts what a person actually types', () => {
    // Liberal about form, per GDS: "3" and "03" are both March, spaces are ignored.
    expect(composeDate({ 'd-day': '27', 'd-month': '3', 'd-year': '2027' }, 'd').value).toBe('2027-03-27');
    expect(composeDate({ 'd-day': '03', 'd-month': '03', 'd-year': '2027' }, 'd').value).toBe('2027-03-03');
    expect(composeDate({ 'd-day': ' 3 ', 'd-month': ' 3 ', 'd-year': ' 2027 ' }, 'd').value).toBe('2027-03-03');
  });

  it('rejects dates that do not exist instead of rolling them forward', () => {
    // 🔴 `new Date(2027, 1, 31)` silently becomes 3 March. Storing that would record a
    // date the member never chose, which is worse than an error message.
    expect(composeDate({ 'd-day': '31', 'd-month': '2', 'd-year': '2027' }, 'd')).toMatchObject({
      value: null, error: 'date_invalid'
    });
    expect(composeDate({ 'd-day': '31', 'd-month': '4', 'd-year': '2027' }, 'd').value).toBeNull();
  });

  it('gets leap years right in both directions', () => {
    expect(composeDate({ 'd-day': '29', 'd-month': '2', 'd-year': '2028' }, 'd').value).toBe('2028-02-29');
    expect(composeDate({ 'd-day': '29', 'd-month': '2', 'd-year': '2027' }, 'd').value).toBeNull();
  });

  it('refuses a two-digit year rather than guessing the century', () => {
    // "26" could be 1926 or 2026. Guessing wrong on a deadline or a date of birth is
    // worse than asking again.
    expect(composeDate({ 'd-day': '3', 'd-month': '3', 'd-year': '26' }, 'd').error).toBe('date_invalid');
  });

  it('treats a half-filled date as an error even when the field is optional', () => {
    // Silently discarding it would lose what the member typed without telling them.
    const result = composeDate({ 'd-day': '3', 'd-month': '', 'd-year': '2027' }, 'd');
    expect(result.value).toBeNull();
    expect(result.error).toBe('month_required');
    expect(result.errorFields).toEqual(['month']);
  });

  it('treats a completely empty optional date as absent, not invalid', () => {
    expect(composeDate({}, 'd')).toMatchObject({ value: null, error: null });
    expect(composeDate({}, 'd', { required: true }).error).toBe('day_required');
  });

  it('keeps what was typed so the form can be re-rendered', () => {
    const result = composeDate({ 'd-day': '31', 'd-month': '2', 'd-year': '2027' }, 'd');
    expect(result.parts).toEqual({ day: '31', month: '2', year: '2027' });
  });

  it('splits a stored date back into fields', () => {
    expect(splitDate('2027-03-05')).toEqual({ day: '5', month: '3', year: '2027' });
    expect(splitDate('2027-03-05T14:00:00Z')).toEqual({ day: '5', month: '3', year: '2027' });
    expect(splitDate('')).toEqual({ day: '', month: '', year: '' });
  });
});

describe('date input markup', () => {
  it('renders three named fields the composer can read back', () => {
    const html = render('en');

    expect(html).toContain('name="deadline-day"');
    expect(html).toContain('name="deadline-month"');
    expect(html).toContain('name="deadline-year"');
    expect(html).toContain('govuk-date-input');
  });

  it('uses text inputs with a numeric keypad, not number spinners', () => {
    // 🔴 GDS uses text here. A spinner on a year is meaningless, and `type="number"`
    // discards a leading zero in some browsers.
    const html = render('en');

    expect(html).toContain('inputmode="numeric"');
    expect(html).not.toContain('type="number"');
  });

  it('groups the fields so a screen reader announces one question', () => {
    const html = render('en', { hint: 'For example, 27 3 2027' });

    expect(html).toContain('<fieldset');
    expect(html).toContain('role="group"');
    expect(html).toContain('govuk-fieldset__legend');
    expect(html).toContain('aria-describedby');
  });

  it('marks only the field that is wrong', () => {
    const html = render('en', { errorMessage: 'Enter a real date', errorFields: ['month'] });
    const monthInput = html.match(/<input[^>]*name="deadline-month"[^>]*>/)[0];
    const dayInput = html.match(/<input[^>]*name="deadline-day"[^>]*>/)[0];

    expect(monthInput).toContain('govuk-input--error');
    expect(dayInput).not.toContain('govuk-input--error');
  });

  it('translates the field labels', () => {
    expect(render('ga')).toContain('Lá');
    expect(render('ga')).toContain('Bliain');
    expect(render('ar')).toContain('يوم');
    expect(render('en')).toContain('Day');
  });

  it('translates the hidden "Error:" prefix and does not double its colon', () => {
    // 🔴 Two real defects found by rendering this rather than trusting the parameter
    // names: without `visuallyHiddenText` govuk-frontend announces the English word
    // "Error" before an Irish message; and because its template appends its own colon,
    // passing our already-punctuated key straight through produced "Earráid::".
    const irish = render('ga', { errorMessage: 'Cuir isteach dáta fíor' });
    const prefix = irish.match(/govuk-visually-hidden">([^<]*)</);

    expect(prefix).not.toBeNull();
    expect(prefix[1].trim()).toBe('Earráid:');
    expect(irish).not.toContain('Earráid::');
    expect(irish).not.toContain('>Error:<');
  });
});

describe('time and datetime composer (GOV.UK date + single time field)', () => {
  const { parseTime, composeDateTime, readDateTime, splitDateTime } = require('../src/lib/date-input');

  it('parses common time formats liberally, normalising to 24-hour HH:MM', () => {
    expect(parseTime('9:30')).toBe('09:30');
    expect(parseTime('09:30')).toBe('09:30');
    expect(parseTime('9.30')).toBe('09:30');
    expect(parseTime(' 9:30 am ')).toBe('09:30');
    expect(parseTime('9:30pm')).toBe('21:30');
    expect(parseTime('9am')).toBe('09:00');
    expect(parseTime('2 pm')).toBe('14:00');
    expect(parseTime('14:30')).toBe('14:30');
    expect(parseTime('12am')).toBe('00:00');
    expect(parseTime('12pm')).toBe('12:00');
    expect(parseTime('0:00')).toBe('00:00');
  });

  it('rejects impossible or ambiguous times rather than guessing', () => {
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('9:60')).toBeNull();
    expect(parseTime('13pm')).toBeNull();
    expect(parseTime('half nine')).toBeNull();
    expect(parseTime('')).toBeNull();
  });

  it('composes the four fields into the native YYYY-MM-DDTHH:MM shape', () => {
    const r = composeDateTime({ 'x-day': '14', 'x-month': '8', 'x-year': '2026', 'x-time': '18:30' }, 'x');
    expect(r.value).toBe('2026-08-14T18:30');
    expect(r.error).toBeNull();
  });

  it('reports a date error before a time error, and points at the missing half', () => {
    // 31 February is a date error even though the time is fine.
    expect(composeDateTime({ 'x-day': '31', 'x-month': '2', 'x-year': '2026', 'x-time': '9:00' }, 'x').error).toBe('date_invalid');
    // A bad time with a good date is a time error.
    expect(composeDateTime({ 'x-day': '14', 'x-month': '8', 'x-year': '2026', 'x-time': '99:99' }, 'x').error).toBe('time_invalid');
    // Date filled, time missing → time_required; and the converse.
    expect(composeDateTime({ 'x-day': '14', 'x-month': '8', 'x-year': '2026', 'x-time': '' }, 'x').error).toBe('time_required');
    expect(composeDateTime({ 'x-day': '', 'x-month': '', 'x-year': '', 'x-time': '9:00' }, 'x').error).toBe('day_required');
    // Both empty and optional: absent, not invalid.
    expect(composeDateTime({}, 'x').error).toBeNull();
    expect(composeDateTime({}, 'x').value).toBeNull();
  });

  it('readDateTime accepts an already-composed value (unconverted form / bookmarked link)', () => {
    expect(readDateTime({ x: '2026-08-14T18:30' }, 'x').value).toBe('2026-08-14T18:30');
    expect(readDateTime({ x: '2026-08-14T18:30:00Z' }, 'x').value).toBe('2026-08-14T18:30');
    // Falls through to the four fields when no single value is present.
    expect(readDateTime({ 'x-day': '14', 'x-month': '8', 'x-year': '2026', 'x-time': '18:30' }, 'x').value).toBe('2026-08-14T18:30');
  });

  it('splitDateTime turns a stored value back into re-render parts', () => {
    expect(splitDateTime('2026-08-14T18:30')).toEqual({ day: '14', month: '8', year: '2026', time: '18:30' });
  });
});

describe('datetime input markup (date fields + one time field)', () => {
  it('renders the four named fields the datetime composer reads back', () => {
    const html = renderDateTime('en');
    expect(html).toContain('name="starts-day"');
    expect(html).toContain('name="starts-month"');
    expect(html).toContain('name="starts-year"');
    expect(html).toContain('name="starts-time"');
    expect(html).toContain('govuk-date-input');
  });

  it('routes a time error to the time field, not the date fields', () => {
    const html = renderDateTime('en', { errorMessage: 'Enter a real time, like 9:30am', errorFields: ['time'] });
    const timeInput = html.match(/<input[^>]*name="starts-time"[^>]*>/)[0];
    const dayInput = html.match(/<input[^>]*name="starts-day"[^>]*>/)[0];
    expect(timeInput).toContain('govuk-input--error');
    expect(dayInput).not.toContain('govuk-input--error');
  });

  it('routes a date error to the date fields, not the time field', () => {
    const html = renderDateTime('en', { errorMessage: 'Enter a real date', errorFields: ['month'] });
    const monthInput = html.match(/<input[^>]*name="starts-month"[^>]*>/)[0];
    const timeInput = html.match(/<input[^>]*name="starts-time"[^>]*>/)[0];
    expect(monthInput).toContain('govuk-input--error');
    expect(timeInput).not.toContain('govuk-input--error');
  });

  it('translates the time label and hint', () => {
    expect(renderDateTime('en')).toContain('Time');
    expect(renderDateTime('de')).toContain('Zeit');
    expect(renderDateTime('ar')).toContain('وقت');
  });

  it('idPrefix gives unique element ids while the posted names stay put (for doubled forms)', () => {
    const html = renderDateTime('en', { idPrefix: 'starts-42' });
    // ids are prefixed (so two forms on one page do not clash)...
    expect(html).toContain('id="starts-42-day"');
    expect(html).toContain('id="starts-42-time"');
    // ...but the POSTED names are unchanged, so the route reads the same fields.
    expect(html).toContain('name="starts-day"');
    expect(html).toContain('name="starts-time"');
  });
});

describe('native date input ceiling', () => {
  // 🔴 SHRINK-ONLY. Lower these numbers as fields are converted; never raise them.
  // Measured 2026-08-13 after converting the two goal deadline fields.
  // Lowered 2026-08-13 from date:21 as the six volunteering fields were converted
  // (start_date, end_date, expiry_date, hours date, completed_at, expires_at). The 21st
  // was never a real field — it was an example inside `_date-input.njk`'s own comment,
  // which this counter greps; that example has been reworded away.
  // Lowered again 2026-08-13 (14 -> 9) for batch 2: group announcement expires_at (create
  // and edit), job deadline, marketplace coupon valid_until, insurance expiry_date and
  // start_date.
  // 🔴 `polls/create.njk` expires_at is DELIBERATELY still native. Its native input carries
  // min="{{ minDate }}", and there is NO server-side minimum — so converting would remove
  // the only thing stopping an honest member setting a poll to expire in the past. Doing it
  // properly needs a "must be in the future" message in eleven locales. Convert that one
  // WITH server validation, not before.
  // 9 -> 1 (2026-08-13, batch 3): events as_of / recurrence_ends_on_date / effective_from /
  // effective_until, the two jobs bias-audit filters and the two advanced-search filters.
  // 🔴 The GET filters keep working from a bookmarked `?date_from=YYYY-MM-DD` link, because
  // `readDate()` accepts either shape — a converted filter must not break shared URLs.
  // 🔴 The remaining 1 is `polls/create.njk` expires_at, DELIBERATELY native: its
  // min="{{ minDate }}" is the only thing stopping a poll expiring in the past, and there is
  // no server-side minimum. Convert it WITH server validation, not before.
  // 🔴 `datetime-local` is BLOCKED, not neglected. Converting a date-AND-time field needs a
  // time sub-field label, an example hint and two time error messages — and NONE exist:
  // there is no standalone "Time"/"Hour"/"Minute" label anywhere in the catalogs, and the
  // six "Hours" strings that do exist are TIME-CREDIT hours, a currency, not clock time.
  // `check-php-lang-untranslated.mjs` also sits at exactly its 249 ceiling, so one
  // English-only value fails the build. The exact wording needed is listed in
  // .local-docs-archive/HANDOFF-IRISH-TRANSLATION-FOR-CODEX.md (round 2). The server side
  // is already written and tested; only `composeDateTime` and the macro's time row remain.
  //
  // 🔴 `time: 2` is a deliberate LOW PRIORITY, not a blocker: both are inside a repeating
  // weekly-slots grid (`slots[day][index][start]`), GOV.UK has no time component, and its
  // guidance on native time inputs is far weaker than on native date pickers.
  // 🔴 17, not 13, for datetime-local. The counter used to match only the HTML form
  // `type="datetime-local"` and so was BLIND to 4 inputs written as a macro argument
  // (`type: "datetime-local"`) on the two most-used event forms (events/new,
  // events/edit) — exactly the fields a member meets most. The count below now
  // includes both spellings, so the true total (13 HTML + 4 macro) is measured.
  // 🔴 Lowered 17 -> 15 on 2026-08-14: marketplace pickup-slot start/end converted to
  // the GOV.UK date + single-time pattern (nexusDateTimeInput), the translated time
  // strings that used to block this now existing. Then 15 -> 14: podcast episode
  // scheduled_for converted (idPrefix added so the doubled add/edit partial keeps unique
  // ids). Then 14 -> 13: events/communications scheduled_at (per-broadcast loop, idPrefix
  // schedule-{id}). Then 13 -> 11: registration campaign expires_at + scheduled_for
  // (_registration-organizer-workflows, idPrefix campaign-*-{id}). Keep lowering.
  const CEILING = { 'datetime-local': 11, date: 1, time: 2 };

  function countNative(type) {
    let total = 0;
    // Both `type="x"` (HTML attribute) and `type: "x"` / `type: 'x'` (macro argument).
    const attr = new RegExp(`type="${type}"`, 'g');
    const arg = new RegExp(`type:\\s*["']${type}["']`, 'g');
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.njk')) {
          const src = fs.readFileSync(full, 'utf8');
          total += (src.match(attr) || []).length + (src.match(arg) || []).length;
        }
      }
    };
    walk(viewsDirectory);
    return total;
  }

  it.each(Object.entries(CEILING))('does not add new native %s inputs', (type, ceiling) => {
    const actual = countNative(type);

    expect(actual).toBeLessThanOrEqual(ceiling);
    // Lock in progress: converting one without lowering the ceiling leaves the gate
    // measuring nothing, which is how a ratchet quietly stops ratcheting.
    expect(actual).toBe(ceiling);
  });
});
