// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Journey: a member logs in to a community that has switched the feed OFF.
 *
 * 🔴 Why this file exists.
 *
 * Login sends every member to the feed. `LoginPage` defaults its destination to
 * `tenantPath('/feed')` on success, on 2FA success, and when an already-signed-in
 * member opens the page — that half is pinned by
 * `pages/auth/LoginPage.test.tsx` ("navigates to dashboard on successful passkey
 * login", which asserts `/test/feed`).
 *
 * Nothing pinned the other half: what a member actually SEES when they arrive at
 * that address and their community does not have the feed. The behaviour was in
 * fact correct — the route redirects to the dashboard — but it was correct by
 * accident of two independent route declarations, and a change to either the login
 * default or the feed route's redirect target would have moved a member's landing
 * page with no test objecting.
 *
 * These cases use the REAL `FeatureGate` and mirror the route declarations in
 * `AppRoutes.tsx` (`module="feed" redirect="/dashboard"` and
 * `module="dashboard" redirect="/"`). `tenantPath` is the identity function here,
 * which is a community on its own domain — a real configuration, and it keeps the
 * route table readable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FeatureGate } from '@/components/routing/FeatureGate';
import { useTenant } from '@/contexts/TenantContext';

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(),
}));

/** Modules a community has switched off. Everything absent is on. */
function tenantWith(disabled: string[] = [], isLoading = false) {
  return {
    isLoading,
    hasFeature: vi.fn((_key: string) => true),
    // Answers per key — a mock that ignores the key cannot tell "feed off,
    // dashboard on" from "everything off", which is the whole question here.
    hasModule: vi.fn((key: string) => !disabled.includes(key)),
    tenantPath: vi.fn((path: string) => path),
  } as unknown as ReturnType<typeof useTenant>;
}

/** The two module-gated routes a signed-in member can be dropped on, as declared in AppRoutes. */
function renderLandingAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>Community home page</div>} />
        <Route
          path="/feed"
          element={
            <FeatureGate module="feed" redirect="/dashboard">
              <div>Community feed</div>
            </FeatureGate>
          }
        />
        <Route
          path="/dashboard"
          element={
            <FeatureGate module="dashboard" redirect="/">
              <div>Member dashboard</div>
            </FeatureGate>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('landing after login when a community has switched the feed off', () => {
  beforeEach(() => {
    vi.mocked(useTenant).mockReturnValue(tenantWith());
  });

  it('shows the feed to a community that has it switched on', () => {
    renderLandingAt('/feed');

    expect(screen.getByText('Community feed')).toBeInTheDocument();
  });

  it('lands the member on the dashboard instead of the feed, with no error', () => {
    vi.mocked(useTenant).mockReturnValue(tenantWith(['feed']));

    renderLandingAt('/feed');

    expect(screen.getByText('Member dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Community feed')).not.toBeInTheDocument();
  });

  /*
   * Both modules off is reachable from the admin module screen: `dashboard` is one of
   * the eight configured core modules, same as `feed`. The chain is then
   * feed → dashboard → community home page. That is a soft landing rather than a
   * redirect loop or a blank screen, and this case is what keeps it soft: point either
   * redirect at the other page and it hangs instead.
   */
  it('falls through to the community home page when the dashboard is also switched off', () => {
    vi.mocked(useTenant).mockReturnValue(tenantWith(['feed', 'dashboard']));

    renderLandingAt('/feed');

    expect(screen.getByText('Community home page')).toBeInTheDocument();
    expect(screen.queryByText('Community feed')).not.toBeInTheDocument();
    expect(screen.queryByText('Member dashboard')).not.toBeInTheDocument();
  });

  /*
   * While the community's configuration is still being read, a member must not be
   * bounced anywhere — a redirect fired on incomplete config moves them off the page
   * they asked for and cannot be undone once the real answer arrives.
   */
  it('does not redirect while the community configuration is still loading', () => {
    vi.mocked(useTenant).mockReturnValue(tenantWith(['feed'], true));

    renderLandingAt('/feed');

    expect(screen.queryByText('Community feed')).not.toBeInTheDocument();
    expect(screen.queryByText('Member dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Community home page')).not.toBeInTheDocument();
  });
});
