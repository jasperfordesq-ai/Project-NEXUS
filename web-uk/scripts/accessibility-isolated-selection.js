// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const SAFE_GREP_PATTERN = [
  'default-English resilient presentation gate',
  'representative public-page accessibility gate',
  'keyboard, focus, error, and forced-colour gate'
].join('|');

function withoutCallerGrep(args = []) {
  const filtered = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index]);
    if (['--grep', '-g', '--grep-invert'].includes(argument)) {
      index += 1;
      continue;
    }
    if (/^(?:--grep|-g|--grep-invert)=/.test(argument)) continue;
    filtered.push(argument);
  }
  return filtered;
}

function isolatedRunnerArgs(args = []) {
  const normalized = args.map((argument) => String(argument));
  if (normalized.includes('--manual')) return normalized;
  return [
    ...withoutCallerGrep(normalized),
    `--grep=${SAFE_GREP_PATTERN}`
  ];
}

module.exports = {
  SAFE_GREP_PATTERN,
  isolatedRunnerArgs
};
