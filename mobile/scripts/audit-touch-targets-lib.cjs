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

module.exports = {
  auditExitCode,
  isKeyguardShowing,
  summariseResults,
};
