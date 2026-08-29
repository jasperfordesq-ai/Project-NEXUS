// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { opensslCandidates } = require('./check-cert-pins-lib.cjs');

describe('certificate pin OpenSSL discovery', () => {
  it('prefers an explicit executable supplied by the environment', () => {
    expect(opensslCandidates('win32', { OPENSSL_BIN: 'D:\\Tools\\openssl.exe' })[0])
      .toBe('D:\\Tools\\openssl.exe');
  });

  it('checks the OpenSSL bundled with Git for Windows', () => {
    expect(opensslCandidates('win32', {})).toContain(
      'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    );
  });

  it('uses the executable on PATH on every platform', () => {
    expect(opensslCandidates('linux', {})).toEqual(['openssl']);
  });
});
