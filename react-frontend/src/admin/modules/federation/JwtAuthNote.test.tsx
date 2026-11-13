// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { JwtAuthNote } from './JwtAuthNote';
import externalPartnersSource from './ExternalPartners.tsx?raw';
import federationSettingsSource from './FederationSettings.tsx?raw';

describe('JwtAuthNote', () => {
  it('tells the platform operator where JWT partner sign-in is configured', () => {
    render(<JwtAuthNote />);
    expect(screen.getByText('JWT partner sign-in is set up by the platform operator')).toBeInTheDocument();
    expect(screen.getByText('FEDERATION_JWT_SECRET')).toBeInTheDocument();
  });

  it('lives on External platforms, not in the middle of Network settings', () => {
    // Until November 2026 a non-technical admin met an environment-variable
    // name between the master switch and the partnership preferences.
    expect(externalPartnersSource).toContain('<JwtAuthNote />');
    expect(federationSettingsSource).not.toContain('JwtAuthNote');
    expect(federationSettingsSource).not.toContain('FEDERATION_JWT_SECRET');
  });
});
