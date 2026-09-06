// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { getVisibleCreateOptions } from './createOptions';
import type { TenantFeatures, TenantModules } from '@/types/api';

describe('getVisibleCreateOptions', () => {
  const moduleGate = (enabled: Array<keyof TenantModules>) => (
    module: keyof TenantModules,
  ) => enabled.includes(module);

  const featureGate = (enabled: Array<keyof TenantFeatures>) => (
    feature: keyof TenantFeatures,
  ) => enabled.includes(feature);

  it('shows the caring community quick action only when the module switch is enabled', () => {
    const enabledOptions = getVisibleCreateOptions(
      featureGate(['caring_community']),
      moduleGate(['listings']),
    );

    expect(enabledOptions.map((option) => option.labelKey)).toContain('quick_create.offer_time');

    const disabledOptions = getVisibleCreateOptions(
      featureGate([]),
      moduleGate(['listings']),
    );

    expect(disabledOptions.map((option) => option.labelKey)).not.toContain('quick_create.offer_time');
  });
});
