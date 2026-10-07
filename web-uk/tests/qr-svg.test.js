// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The shared server-side QR renderer (src/lib/qr-svg.js), used by the venue member pass
 * and the volunteer shift check-in. It must produce an inline SVG with no external
 * request, never echo the encoded content as text, and give null rather than throw.
 */

const { qrSvg } = require('../src/lib/qr-svg');

describe('qrSvg', () => {
  it('renders an inline SVG that does not print what it encodes', () => {
    const url = `https://app.example/acme/volunteering/checkin/${'f'.repeat(64)}`;
    const svg = qrSvg(url);

    expect(svg).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(svg).not.toContain('f'.repeat(64));
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it('gives null for nothing to encode', () => {
    expect(qrSvg('')).toBeNull();
    expect(qrSvg('   ')).toBeNull();
    expect(qrSvg(undefined)).toBeNull();
    expect(qrSvg(null)).toBeNull();
  });
});
