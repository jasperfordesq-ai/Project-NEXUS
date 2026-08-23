// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { getRequestIntlLocale } = require('./request-intl-locale');

// Locale-aware list rendering for DISPLAY strings only. `join(', ')` bakes an
// English comma-space into every language (Japanese uses '、', Arabic '، ').
// `style: 'short', type: 'unit'` keeps English byte-identical to the old
// join(', ') output ("a, b, c") while letting other locales use their own list
// punctuation — 'narrow' was rejected because it drops the English commas
// entirely ("a b c").
//
// 🔴 Never use this for a value that round-trips through a form input and is
// re-parsed on submit (tag editors split on ','); those must stay join(', ').
function formatRequestList(items) {
  const list = (Array.isArray(items) ? items : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  if (list.length === 0) return '';
  return new Intl.ListFormat(getRequestIntlLocale(), { style: 'short', type: 'unit' }).format(list);
}

module.exports = { formatRequestList };
