// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminModuleGate, ADMIN_MODULE_REQUIREMENTS } from './AdminModuleGate';

const state = vi.hoisted(() => ({ enabled: true, loading: false, off: new Set<string>() }));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    hasModule: () => state.enabled, hasFeature: (key: string) => state.enabled && !state.off.has(key),
    isLoading: state.loading, tenantPath: (path: string) => `/test${path}`,
  }),
}));

function renderPage(path: string, effect = vi.fn()) {
  function Content() {
    useEffect(effect, []);
    return <div>Module content</div>;
  }
  return render(<MemoryRouter initialEntries={[`/test/admin/${path}`]}>
    <Routes><Route element={<AdminModuleGate />}>
      <Route path="/test/admin/not-found" element={<div>Unavailable</div>} />
      <Route path="/test/admin/*" element={<Content />} />
    </Route></Routes>
  </MemoryRouter>);
}

describe('admin module boundaries', () => {
  beforeEach(() => { state.enabled = true; state.loading = false; state.off.clear(); });
  it.each(ADMIN_MODULE_REQUIREMENTS)('blocks $path and nested pages before mounting when disabled', ({ path }) => {
    state.enabled = false;
    const effect = vi.fn();
    renderPage(`${path}/42/edit`, effect);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(effect).not.toHaveBeenCalled();
  });
  it.each(ADMIN_MODULE_REQUIREMENTS)('allows $path when enabled', ({ path }) => {
    renderPage(path);
    expect(screen.getByText('Module content')).toBeInTheDocument();
  });
  it.each(['module-configuration', 'categories', 'users', 'settings'])('preserves %s for setup and recovery', path => {
    state.enabled = false;
    renderPage(path);
    expect(screen.getByText('Module content')).toBeInTheDocument();
  });
  // F-529 (E-078): coupons are part of the marketplace — the sidebar shows them only
  // inside the marketplace section, so the page must need the parent switch too.
  it('blocks marketplace/coupons when the marketplace is off but merchant coupons are on', () => {
    state.off.add('marketplace');
    renderPage('marketplace/coupons');
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });
  it('blocks marketplace/coupons when merchant coupons are off but the marketplace is on', () => {
    state.off.add('merchant_coupons');
    renderPage('marketplace/coupons');
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });
  // F-530 (E-078): the Swiss FADP page follows its own switch, like the sidebar link.
  it('blocks enterprise/fadp when fadp_compliance is off', () => {
    state.off.add('fadp_compliance');
    renderPage('enterprise/fadp');
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });
  it('does not mount content while settings load', () => {
    state.loading = true;
    const effect = vi.fn();
    renderPage('listings', effect);
    expect(effect).not.toHaveBeenCalled();
  });
});
