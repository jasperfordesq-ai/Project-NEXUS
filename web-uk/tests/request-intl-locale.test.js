'use strict';

const fs = require('fs/promises');
const path = require('path');
const { getRequestIntlLocale } = require('../src/lib/request-intl-locale');
const { runWithRequestLocale } = require('../src/lib/request-locale-context');

const routesDirectory = path.join(__dirname, '..', 'src', 'routes');

function formatSamples() {
  const locale = getRequestIntlLocale();
  return {
    locale,
    number: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(1234567.89),
    date: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(new Date('2026-07-10T12:00:00Z'))
  };
}

describe('request-scoped Intl locale', () => {
  test('route display formatters do not hard-code English regional locales', async () => {
    const routeFiles = (await fs.readdir(routesDirectory))
      .filter((file) => file.endsWith('.js'));
    const violations = [];
    const displayPatterns = [
      /Intl\.(?:DateTimeFormat|NumberFormat)\(\s*['"]en-(?:GB|IE)['"]/g,
      /\.toLocale(?:DateString|String)\(\s*['"]en-(?:GB|IE)['"]/g
    ];

    await Promise.all(routeFiles.map(async (file) => {
      const source = await fs.readFile(path.join(routesDirectory, file), 'utf8');
      for (const pattern of displayPatterns) {
        for (const match of source.matchAll(pattern)) {
          const line = source.slice(0, match.index).split('\n').length;
          violations.push(`${file}:${line}: ${match[0]}`);
        }
      }
    }));

    expect(violations).toEqual([]);
  });

  test('keeps concurrent Irish and Arabic formatting isolated', async () => {
    let ready = 0;
    let release;
    const bothReady = new Promise((resolve) => {
      release = resolve;
    });

    const formatInLocale = (locale) => runWithRequestLocale(locale, async () => {
      ready += 1;
      if (ready === 2) release();
      await bothReady;
      await new Promise((resolve) => global.setImmediate(resolve));
      return formatSamples();
    });

    const [irish, arabic] = await Promise.all([
      formatInLocale('ga'),
      formatInLocale('ar')
    ]);

    expect(irish).toEqual({
      locale: 'ga-IE',
      number: new Intl.NumberFormat('ga-IE', { maximumFractionDigits: 2 }).format(1234567.89),
      date: new Intl.DateTimeFormat('ga-IE', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(new Date('2026-07-10T12:00:00Z'))
    });
    expect(arabic).toEqual({
      locale: 'ar',
      number: new Intl.NumberFormat('ar', { maximumFractionDigits: 2 }).format(1234567.89),
      date: new Intl.DateTimeFormat('ar', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(new Date('2026-07-10T12:00:00Z'))
    });
    expect(getRequestIntlLocale()).toBe('en-GB');
  });
});
