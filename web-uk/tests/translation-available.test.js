// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 30 Oct 2026: Admin → Translation settings "Enable translation" is now
 * published by the tenant bootstrap (`translation.enabled`). This site offers
 * translation only when both that and the `message_translation` feature are on.
 */

const fs = require('fs');
const path = require('path');
const { translationAvailable } = require('../src/lib/translation-available');

const reqFor = (tenant) => ({ accessibleRouting: { tenant } });

describe('translationAvailable', () => {
  it('is on with the feature on and no community switch published (older bootstrap)', () => {
    expect(translationAvailable(reqFor({ features: { message_translation: true } }))).toBe(true);
  });

  it('is off when the community switched translation off', () => {
    expect(translationAvailable(reqFor({ features: { message_translation: true }, translation: { enabled: false } }))).toBe(false);
  });

  it('is off when the message translation feature is off', () => {
    expect(translationAvailable(reqFor({ features: { message_translation: false }, translation: { enabled: true } }))).toBe(false);
  });

  it('is used by every place that offers or performs translation', () => {
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', file), 'utf8');
    for (const file of ['messages.js', 'federation.js', 'federation-actions.js']) {
      expect(read(file)).toMatch(/translationAvailable\(req\)/);
      expect(read(file)).not.toMatch(/tenantFeatureEnabled\(req, 'message_translation'/);
    }
  });
});
