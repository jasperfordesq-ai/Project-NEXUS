// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const path = require('node:path');

function opensslCandidates(platform = process.platform, env = process.env) {
  const candidates = [];
  if (env.OPENSSL_BIN) candidates.push(env.OPENSSL_BIN);
  candidates.push('openssl');

  if (platform === 'win32') {
    const programFiles = env.ProgramFiles || env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = env['ProgramFiles(x86)'] || env.PROGRAMFILES_X86 || 'C:\\Program Files (x86)';
    candidates.push(
      path.win32.join(programFiles, 'Git', 'usr', 'bin', 'openssl.exe'),
      path.win32.join(programFilesX86, 'Git', 'usr', 'bin', 'openssl.exe'),
    );
  }

  return [...new Set(candidates)];
}

module.exports = { opensslCandidates };
