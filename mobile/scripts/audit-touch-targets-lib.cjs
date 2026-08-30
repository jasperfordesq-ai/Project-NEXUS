// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

function isKeyguardShowing(windowPolicy) {
  return /(?:^|\s)(?:showing|mIsShowing)=true(?:\s|$)/m.test(windowPolicy);
}

function summariseResults(results) {
  const summary = {
    requested: results.length,
    verified: 0,
    unverified: 0,
    unreadable: 0,
    unsettled: 0,
  };

  for (const result of results) {
    if (Object.hasOwn(summary, result.status)) summary[result.status] += 1;
  }

  return summary;
}

function auditExitCode({ summary, belowAA }) {
  if (summary.verified !== summary.requested) return 2;
  return belowAA > 0 ? 1 : 0;
}

function structuralSignature(xml) {
  const nodes = [];
  for (const match of String(xml).matchAll(/<node\b([^>]*)>/g)) {
    const attrs = match[1];
    const attr = (name) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
    // Decorative text and images legitimately resize as relative times, translated
    // labels and remote avatars change. They are not touch targets, and including their
    // bounds made a healthy screen look as though it never settled. Retain the actionable
    // and scrollable node set, but not transient geometry; the final XML still supplies the
    // exact bounds that are measured. A route's separate text fingerprint proves that the
    // intended screen has arrived.
    const resourceId = attr('resource-id');
    const clickable = attr('clickable');
    const longClickable = attr('long-clickable');
    const scrollable = attr('scrollable');
    if (clickable !== 'true' && longClickable !== 'true' && scrollable !== 'true') {
      continue;
    }
    nodes.push([
      resourceId,
      attr('class'),
      clickable,
      longClickable,
      attr('enabled'),
      scrollable,
    ].join('|'));
  }
  return nodes.join(';');
}

module.exports = {
  auditExitCode,
  isKeyguardShowing,
  structuralSignature,
  summariseResults,
};
