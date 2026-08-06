// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { ImpersonationBanner } from './ImpersonationBanner';

const mocks = vi.hoisted(() => ({
  isImpersonatedTab: vi.fn(() => false),
  endImpersonation: vi.fn(async () => {}),
  readImpersonationContext: vi.fn(() => null as unknown),
}));

vi.mock('@/lib/api', () => ({
  isImpersonatedTab: mocks.isImpersonatedTab,
}));

vi.mock('@/lib/impersonate', () => ({
  endImpersonation: mocks.endImpersonation,
  readImpersonationContext: mocks.readImpersonationContext,
}));

describe('ImpersonationBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isImpersonatedTab.mockReturnValue(false);
    mocks.readImpersonationContext.mockReturnValue(null);
    vi.spyOn(window, 'close').mockImplementation(() => {});
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, replace: vi.fn() },
    });
  });

  it('renders nothing in an ordinary tab', () => {
    // The admin's own tabs must never show it.
    const { container } = render(<ImpersonationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a notice in an impersonated tab', () => {
    mocks.isImpersonatedTab.mockReturnValue(true);
    render(<ImpersonationBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('names the member when the context carries a name', () => {
    mocks.isImpersonatedTab.mockReturnValue(true);
    mocks.readImpersonationContext.mockReturnValue({
      userId: 42, userName: 'Sam Member', adminId: 7, adminName: 'Ada Admin', startedAt: 0,
    });

    render(<ImpersonationBanner />);

    expect(screen.getByRole('status').textContent).toContain('Sam Member');
  });

  it('falls back to generic copy when no context was stored', () => {
    mocks.isImpersonatedTab.mockReturnValue(true);
    mocks.readImpersonationContext.mockReturnValue(null);

    render(<ImpersonationBanner />);

    // Still shows the notice — a missing context must not hide the fact that
    // this tab is somebody else's account.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('offers a way out that ends the session', async () => {
    mocks.isImpersonatedTab.mockReturnValue(true);
    mocks.readImpersonationContext.mockReturnValue({
      userId: 42, userName: 'Sam Member', adminId: 7, adminName: 'Ada Admin', startedAt: 0,
    });

    render(<ImpersonationBanner />);
    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mocks.endImpersonation).toHaveBeenCalledTimes(1);
    });
  });
});
