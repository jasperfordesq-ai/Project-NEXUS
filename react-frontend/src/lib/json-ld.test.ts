// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { toJsonLd } from './json-ld';

describe('toJsonLd', () => {
  const hostile = 'Tea & cake</script><script>alert(1)</script>';

  it('never emits a literal "<", ">" or "&"', () => {
    const out = toJsonLd({ name: hostile });
    expect(out).not.toMatch(/[<>&]/);
    expect(out).toContain('\\u003c/script\\u003e');
    expect(out).toContain('\\u0026');
  });

  it('round-trips to the original value', () => {
    const value = { '@context': 'https://schema.org', name: hostile, nested: [{ d: '<b>' }] };
    expect(JSON.parse(toJsonLd(value))).toEqual(value);
  });
});
