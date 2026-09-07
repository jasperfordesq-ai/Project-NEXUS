// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminModuleGate, ADMIN_MODULE_REQUIREMENTS } from './AdminModuleGate';

const state = vi.hoisted(() => ({ enabled: true, loading: false }));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    hasModule: () => state.enabled, hasFeature: () => state.enabled,
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
  beforeEach(() => { state.enabled = true; state.loading = false; });
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
  it('does not mount content while settings load', () => {
    state.loading = true;
    const effect = vi.fn();
    renderPage('listings', effect);
    expect(effect).not.toHaveBeenCalled();
  });
});
