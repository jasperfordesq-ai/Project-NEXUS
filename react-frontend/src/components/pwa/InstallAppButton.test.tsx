// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for InstallAppButton.
 *
 * The behaviour under test changed on 2026-08-12: the entry point navigates to
 * the /install-app instructions page instead of firing a browser install
 * prompt, and it renders on every browser (including Chrome/Firefox on iOS,
 * which the old shouldOfferInstall gate hid).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── API mock ─────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

// ─── Router mock ──────────────────────────────────────────────────────────────
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

// ─── Helper render ─────────────────────────────────────────────────────────
/** A simple children render-prop implementation used across all tests */
function renderButton({
  onClick,
  label,
  sublabel,
}: {
  onClick: () => void;
  label: string;
  sublabel: string;
}) {
  return (
    <button onClick={onClick} data-testid="install-btn">
      <span data-testid="label">{label}</span>
      <span data-testid="sublabel">{sublabel}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe('InstallAppButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the children render-prop', async () => {
    const { InstallAppButton } = await import('./InstallAppButton');
    render(<InstallAppButton>{renderButton}</InstallAppButton>);
    expect(screen.getByTestId('install-btn')).toBeInTheDocument();
  });

  it('passes the translated label "Get the app" to the render-prop', async () => {
    const { InstallAppButton } = await import('./InstallAppButton');
    render(<InstallAppButton>{renderButton}</InstallAppButton>);
    expect(screen.getByTestId('label')).toHaveTextContent('Get the app');
  });

  it('passes the sublabel to the render-prop', async () => {
    const { InstallAppButton } = await import('./InstallAppButton');
    render(<InstallAppButton>{renderButton}</InstallAppButton>);
    expect(screen.getByTestId('sublabel')).toHaveTextContent('Add it to your phone or computer');
  });

  it('navigates to the tenant-scoped install page when clicked', async () => {
    const { InstallAppButton } = await import('./InstallAppButton');
    render(<InstallAppButton>{renderButton}</InstallAppButton>);

    fireEvent.click(screen.getByTestId('install-btn'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/test/install-app');
  });

  it('does not navigate before the button is clicked', async () => {
    const { InstallAppButton } = await import('./InstallAppButton');
    render(<InstallAppButton>{renderButton}</InstallAppButton>);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates again on a second click', async () => {
    const { InstallAppButton } = await import('./InstallAppButton');
    render(<InstallAppButton>{renderButton}</InstallAppButton>);
    const btn = screen.getByTestId('install-btn');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockNavigate).toHaveBeenCalledTimes(2);
  });

  it('accepts a custom render-prop returning a link element', async () => {
    const { InstallAppButton } = await import('./InstallAppButton');
    render(
      <InstallAppButton>
        {({ onClick, label }) => (
          <a role="link" onClick={onClick} data-testid="install-link">
            {label}
          </a>
        )}
      </InstallAppButton>,
    );
    expect(screen.getByTestId('install-link')).toBeInTheDocument();
    expect(screen.getByTestId('install-link')).toHaveTextContent('Get the app');
  });
});
