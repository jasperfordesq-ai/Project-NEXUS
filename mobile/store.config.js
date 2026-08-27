// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const metadata = require('./store-listing/apple/en-GB.json');

module.exports = {
  configVersion: 0,
  apple: {
    version: metadata.version,
    copyright: '2024 Jasper Ford',
    categories: [metadata.primaryCategory, metadata.secondaryCategory],
    info: {
      'en-GB': {
        title: metadata.name,
        subtitle: metadata.subtitle,
        description: metadata.description,
        keywords: metadata.keywords.split(',').map((keyword) => keyword.trim()),
        promoText: metadata.promotionalText,
        marketingUrl: metadata.marketingUrl,
        supportUrl: metadata.supportUrl,
        privacyPolicyUrl: metadata.privacyPolicyUrl,
        privacyChoicesUrl: metadata.privacyChoicesUrl,
      },
    },
    release: {
      automaticRelease: false,
    },
  },
};
