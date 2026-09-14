// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const queryStringPath = require.resolve('query-string');
const decoderPath = require.resolve('decode-uri-component');

describe('Expo Router query-string compatibility', () => {
  it('uses the decoder release that removes the malformed-input denial of service', () => {
    const packageJson = JSON.parse(
      readFileSync(join(dirname(decoderPath), 'package.json'), 'utf8'),
    ) as { version?: string };

    expect(packageJson.version).toBe('0.5.0');
  });

  it('preserves the CommonJS interface used by Expo Router and React Navigation', () => {
    const queryString = require('query-string') as {
      parse: (value: string) => Record<string, unknown>;
      stringify: (value: Record<string, unknown>) => string;
    };

    expect(queryString.stringify({ token: 'a b' })).toBe('token=a%20b');
    expect(queryString.parse('?token=%E2%9C%93')).toEqual({ token: '✓' });
  });

  it('bounds hostile malformed decoding in a separate process', () => {
    const script = [
      `const queryString = require(${JSON.stringify(queryStringPath)});`,
      "queryString.parse('value=' + '%ab'.repeat(700));",
    ].join('');

    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      timeout: 1500,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });
});
