// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { TenantParamRedirect, TenantRedirect } from '../routes';

vi.mock('@/contexts', () => ({
  useTenant: () => ({
    tenantPath: (path: string) => `/hour-timebank${path}`,
    hasFeature: () => true,
  }),
}));

// The admin route tree reached from '../routes' also contains modules that import useTenant from
// '@/contexts/TenantContext' directly (LegalDocVersionList among them), where the barrel override
// above does not apply. Mock the direct path too so the whole graph sees one tenant.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenantPath: (path: string) => `/hour-timebank${path}`,
    hasFeature: () => true,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="path">{location.pathname}</output>;
}

describe('legacy Caring admin redirects', () => {
  it('redirects old /admin/caring-community bookmarks to the dedicated /caring panel', async () => {
    render(
      <MemoryRouter initialEntries={['/hour-timebank/admin/caring-community/loyalty']}>
        <Routes>
          <Route path="/hour-timebank/admin/caring-community/loyalty" element={<TenantRedirect to="/caring/loyalty" />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('path')).toHaveTextContent('/hour-timebank/caring/loyalty');
  });

  it('preserves and encodes legacy route params when redirecting Warmth Pass lookups', async () => {
    render(
      <MemoryRouter initialEntries={['/hour-timebank/admin/caring-community/warmth-pass/member name']}>
        <Routes>
          <Route
            path="/hour-timebank/admin/caring-community/warmth-pass/:userId"
            element={<TenantParamRedirect to="/caring/warmth-pass/:userId" />}
          />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('path')).toHaveTextContent('/hour-timebank/caring/warmth-pass/member%20name');
  });
});
