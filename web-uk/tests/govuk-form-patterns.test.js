// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GOV.UK form patterns, enforced across every template (28 Oct 2026).
 *
 * The accessible frontend validates on the server and shows the GOV.UK error
 * summary plus an inline error. Any browser-side validation pre-empts that with
 * a pop-up in the browser's own language, which is exactly what the pattern is
 * meant to avoid. So:
 *
 *  - every form gets `novalidate`;
 *  - no control carries `required`, `min`, `max`, `pattern`, `minlength` or `step`;
 *  - numbers are text inputs with `inputmode`, never `type="number"`
 *    (GOV.UK "Ask users for numbers");
 *  - a link styled as a button says it is a button, and cannot be dragged.
 *
 * The `caring/` templates belong to an unfinished alpha that is deliberately
 * out of scope and are not scanned.
 */

const fs = require('fs');
const path = require('path');
const { scanTags, hasAttr, attrValue, macroAttributeBlocks, topLevelEntries, plain } = require('./support/njk-tags');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const SKIPPED_DIRS = new Set(['caring']);

function listTemplates(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) out.push(...listTemplates(full));
    } else if (entry.name.endsWith('.njk')) {
      out.push(full);
    }
  }
  return out;
}

const files = listTemplates(VIEWS).map((file) => ({
  rel: path.relative(VIEWS, file).split(path.sep).join('/'),
  src: fs.readFileSync(file, 'utf8')
}));

const CONSTRAINTS = ['required', 'min', 'max', 'pattern', 'minlength', 'step'];
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

function collect(fn) {
  const hits = [];
  for (const { rel, src } of files) {
    for (const hit of fn(src)) hits.push(`${rel}:${lineOf(src, hit.index)} ${hit.what}`);
  }
  return hits;
}

describe('GOV.UK form patterns across web-uk templates', () => {
  it('scans a meaningful number of templates', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('every POST form has novalidate', () => {
    const hits = collect((src) => scanTags(src)
      .filter((t) => t.name === 'form')
      .filter((t) => /\smethod\s*=\s*["']?post/i.test(plain(t.text)) && !hasAttr(t.text, 'novalidate'))
      .map((t) => ({ index: t.start, what: t.text.slice(0, 90) })));
    expect(hits).toEqual([]);
  });

  it('no GET form that holds an email or url field lacks novalidate', () => {
    const hits = collect((src) => {
      const tags = scanTags(src);
      const found = [];
      tags.forEach((t, n) => {
        if (t.name !== 'form' || hasAttr(t.text, 'novalidate')) return;
        if (/\smethod\s*=\s*["']?post/i.test(plain(t.text))) return;
        const close = src.indexOf('</form>', t.end);
        const body = tags.filter((x) => x.start > t.start && x.start < (close === -1 ? src.length : close));
        if (body.some((x) => x.name === 'input' && ['email', 'url'].includes((attrValue(x.text, 'type') || '').toLowerCase()))) {
          found.push({ index: t.start, what: t.text.slice(0, 90) });
        }
      });
      return found;
    });
    expect(hits).toEqual([]);
  });

  it('no input, select or textarea carries a browser constraint attribute', () => {
    const hits = collect((src) => {
      const found = [];
      for (const t of scanTags(src)) {
        if (!['input', 'select', 'textarea'].includes(t.name)) continue;
        for (const attr of CONSTRAINTS) {
          if (hasAttr(t.text, attr)) found.push({ index: t.start, what: `${attr} on ${t.text.slice(0, 70)}` });
        }
      }
      return found;
    });
    expect(hits).toEqual([]);
  });

  it('no macro call passes a browser constraint attribute', () => {
    const hits = collect((src) => {
      const found = [];
      for (const block of macroAttributeBlocks(src)) {
        for (const entry of topLevelEntries(block.text)) {
          if (CONSTRAINTS.includes(entry.key)) found.push({ index: block.start, what: entry.key + ' in macro attributes' });
        }
      }
      return found;
    });
    expect(hits).toEqual([]);
  });

  it('no number input: text with inputmode instead', () => {
    const hits = collect((src) => {
      const found = [];
      for (const t of scanTags(src)) {
        if (t.name === 'input' && (attrValue(t.text, 'type') || '').toLowerCase() === 'number') {
          found.push({ index: t.start, what: t.text.slice(0, 80) });
        }
      }
      for (const m of src.matchAll(/\btype\s*:\s*["']number["']/g)) {
        found.push({ index: m.index, what: 'macro type: "number"' });
      }
      return found;
    });
    expect(hits).toEqual([]);
  });

  it('every link styled as a button says role="button" and cannot be dragged', () => {
    const hits = collect((src) => scanTags(src)
      .filter((t) => t.name === 'a')
      .filter((t) => /(^|\s)govuk-button(\s|--|$)/.test(attrValue(t.text, 'class') || ''))
      .filter((t) => attrValue(t.text, 'role') !== 'button' || attrValue(t.text, 'draggable') !== 'false')
      .map((t) => ({ index: t.start, what: t.text.slice(0, 90) })));
    expect(hits).toEqual([]);
  });
});
