// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const request = require('supertest');
const morgan = require('morgan');

// GHSA-9f6g-j8ch-79g4 (Dependabot #139): morgan before 1.12.1 escaped control
// characters but not the double quote, which is the field delimiter of the
// `combined` format src/server.js writes in production. A visitor could put a
// `"` in their User-Agent or Referer header and forge extra fields in the
// access-log record. This pins the installed morgan to the version that escapes it.
function logLineFor(headers) {
  const lines = [];
  const app = express();
  app.use(morgan('combined', { stream: { write: (line) => lines.push(line) } }));
  app.get('/', (req, res) => res.send('ok'));
  let req = request(app).get('/');
  for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
  return req.then(() => lines[0]);
}

// Field delimiters in a combined-format line that are not escaped (`\"`).
function unescapedQuotes(line) {
  return (line.match(/(?<!\\)"/g) || []).length;
}

describe('access log: a request header cannot forge log fields', () => {
  it('escapes a double quote in the User-Agent and Referer', async () => {
    const line = await logLineFor({
      'User-Agent': 'probe" 200 999 "forged',
      Referer: 'https://example.test/" "forged-referer',
    });
    // request, referrer and user-agent: three quoted fields, six delimiters.
    expect(unescapedQuotes(line)).toBe(6);
    expect(line).not.toMatch(/(?<!\\)" 200 999 "forged/);
  });

  it('control: an ordinary request logs its three quoted fields', async () => {
    const line = await logLineFor({ 'User-Agent': 'Mozilla/5.0', Referer: 'https://example.test/' });
    expect(unescapedQuotes(line)).toBe(6);
    expect(line).toContain('"Mozilla/5.0"');
  });
});
