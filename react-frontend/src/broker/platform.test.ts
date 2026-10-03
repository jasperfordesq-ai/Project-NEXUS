// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, afterEach } from 'vitest';
import { isApplePlatform } from './platform';

type NavigatorWithHints = Navigator & { userAgentData?: { platform?: string } };

function setPlatform(platform: string | undefined, hintPlatform?: string) {
  Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(window.navigator, 'userAgentData', {
    value: hintPlatform === undefined ? undefined : { platform: hintPlatform },
    configurable: true,
  });
}

describe('isApplePlatform', () => {
  const original = {
    platform: window.navigator.platform,
    userAgentData: (window.navigator as NavigatorWithHints).userAgentData,
  };

  afterEach(() => {
    setPlatform(original.platform, original.userAgentData?.platform);
  });

  it('is true on a Mac', () => {
    setPlatform('MacIntel');
    expect(isApplePlatform()).toBe(true);
  });

  it('is true on an iPhone or iPad', () => {
    setPlatform('iPhone');
    expect(isApplePlatform()).toBe(true);
    setPlatform('iPad');
    expect(isApplePlatform()).toBe(true);
  });

  it('is false on Windows', () => {
    setPlatform('Win32');
    expect(isApplePlatform()).toBe(false);
  });

  it('prefers the client-hint platform when the browser offers one', () => {
    setPlatform('Win32', 'macOS');
    expect(isApplePlatform()).toBe(true);
    setPlatform('MacIntel', 'Windows');
    expect(isApplePlatform()).toBe(false);
  });

  it('is false when nothing is known', () => {
    setPlatform(undefined);
    expect(isApplePlatform()).toBe(false);
  });
});
