// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for IdleLogoutGuard
 *
 * With no warning due, the component is a pure side-effect wrapper: it calls
 * useIdleLogout() and renders nothing.
 *
 * Test objectives:
 *   (a) The component mounts and returns null (renders nothing to the DOM).
 *   (b) useIdleLogout is invoked on mount.
 *   (c) Unmounting does not throw (cleanup path is exercised).
 *   (d) Sibling content is unaffected when the guard is composed into a parent.
 *
 * We mock the hook at its canonical path via vi.hoisted() so the factory
 * has no uninitialized-variable issue when Vitest hoists vi.mock().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

// ─── vi.hoisted() ─────────────────────────────────────────────────────────────
// Variables referenced inside vi.mock() factories must be declared via
// vi.hoisted() so they are available at the point the factory runs.

const { mockUseIdleLogout } = vi.hoisted(() => ({
  mockUseIdleLogout: vi.fn(),
}));

// ─── Mock @/hooks/useIdleLogout ───────────────────────────────────────────────
vi.mock('@/hooks/useIdleLogout', () => ({
  useIdleLogout: mockUseIdleLogout,
  // parseIdleTimeoutMs is a named export from the same file; keep it to avoid
  // "missing export" warnings even though the component doesn't use it directly.
  parseIdleTimeoutMs: vi.fn((v: unknown) => v),
}));

// ─── Component import (after mocks) ──────────────────────────────────────────
import { IdleLogoutGuard } from './IdleLogoutGuard';

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // No warning due: the guard renders nothing. (The warning itself is covered
  // by __tests__/IdleLogoutGuard.test.tsx, E-119 F-608.)
  mockUseIdleLogout.mockReturnValue({ warningOpen: false, secondsLeft: 0, staySignedIn: vi.fn(), signOutNow: vi.fn() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('IdleLogoutGuard', () => {
  it('invokes useIdleLogout on mount', () => {
    render(<IdleLogoutGuard />);
    expect(mockUseIdleLogout).toHaveBeenCalled();
  });

  it('renders nothing to the DOM (returns null)', () => {
    const { container } = render(<IdleLogoutGuard />);
    // test-utils wraps in AllProviders (a <div>), so container.firstChild is
    // that wrapper div. We verify the component itself contributed no element
    // children — the wrapper's only children are provider noise (toast regions
    // etc.), none of which come from IdleLogoutGuard.
    // The reliable check: query for anything the component could have rendered.
    // Since IdleLogoutGuard returns null, there are no data-testid or role
    // nodes it could have injected.
    expect(container.querySelector('[data-idle-guard]')).toBeNull();
    // And there is no text content coming from the guard.
    expect(container.textContent).toBe('');
  });

  it('does not add any visible text or accessible roles to the document', () => {
    render(<IdleLogoutGuard />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    // No text whatsoever rendered by the component.
    expect(screen.queryByText(/.+/)).toBeNull();
  });

  it('can be unmounted without throwing', () => {
    const { unmount } = render(<IdleLogoutGuard />);
    expect(() => unmount()).not.toThrow();
  });

  it('calls useIdleLogout on every render cycle', () => {
    const { rerender } = render(<IdleLogoutGuard />);
    const callsAfterMount = mockUseIdleLogout.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThanOrEqual(1);

    rerender(<IdleLogoutGuard />);
    expect(mockUseIdleLogout.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('does not interfere with sibling content when composed into a parent', () => {
    render(
      <div>
        <IdleLogoutGuard />
        <span data-testid="sibling">hello</span>
      </div>,
    );

    expect(screen.getByTestId('sibling')).toHaveTextContent('hello');
    expect(mockUseIdleLogout).toHaveBeenCalled();
  });
});
