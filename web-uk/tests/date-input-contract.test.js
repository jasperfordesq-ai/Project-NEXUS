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

describe('native date input ceiling', () => {
  // 🔴 SHRINK-ONLY. Lower these numbers as fields are converted; never raise them.
  // Measured 2026-08-13 after converting the two goal deadline fields.
  // Lowered 2026-08-13 from date:21 as the six volunteering fields were converted
  // (start_date, end_date, expiry_date, hours date, completed_at, expires_at). The 21st
  // was never a real field — it was an example inside `_date-input.njk`'s own comment,
  // which this counter greps; that example has been reworded away.
  const CEILING = { 'datetime-local': 13, date: 14, time: 2 };

  function countNative(type) {
    let total = 0;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.njk')) {
          total += (fs.readFileSync(full, 'utf8').match(new RegExp(`type="${type}"`, 'g')) || []).length;
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
