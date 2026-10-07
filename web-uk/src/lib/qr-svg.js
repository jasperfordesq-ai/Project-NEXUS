// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const QRCode = require('qrcode-svg');

/**
 * A QR code as inline SVG, rendered on the server.
 *
 * The accessible frontend must work with no JavaScript and no external request, so a
 * client-side QR renderer or a third-party image URL would break it. qrcode-svg is MIT
 * with zero dependencies. Error correction is Medium; the quiet zone is 4 modules, the
 * QR specification minimum.
 *
 * Callers encode the SAME URL the website and phone app encode (the API's `qr_url`), so
 * staff scanning any client's code land on one canonical page. Never print the encoded
 * token as text beside it: the token is the credential.
 *
 * Used by the venue member pass (routes/venues.js) and the volunteer shift check-in on
 * the opportunity page (server.js). Returns null when there is nothing to encode or it
 * cannot be encoded, so the page still renders.
 */
function qrSvg(content) {
  const text = typeof content === 'string' ? content.trim() : '';
  if (text === '') return null;

  try {
    // qrcode-svg prefixes an XML declaration, which is not valid inside an HTML body
    // (the parser turns it into a bogus comment). The SVG is inlined, so drop it.
    return new QRCode({
      content: text,
      padding: 4,
      width: 260,
      height: 260,
      color: '#0b0c0c',
      background: '#ffffff',
      ecl: 'M',
      join: true
    }).svg().replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  } catch {
    return null;
  }
}

module.exports = { qrSvg };
