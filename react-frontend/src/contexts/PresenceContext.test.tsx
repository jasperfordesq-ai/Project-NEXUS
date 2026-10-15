// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for PresenceContext — presence state management,
 * heartbeat behavior, and default values.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import React from 'react';

// Mock dependencies
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: {} }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('./AuthContext', () => ({
  useAuth: vi.fn().mockReturnValue({
    user: { id: 1, first_name: 'Test', last_name: 'User' },
    isAuthenticated: true,
  }),
}));

const mockUseTenant = vi.fn().mockReturnValue({ tenant: { id: 2 } });
vi.mock('./TenantContext', () => ({
  useTenant: (...args: unknown[]) => mockUseTenant(...args),
}));

// Import after mocks
import { api } from '@/lib/api';
import { useAuth } from './AuthContext';
import {
  PresenceProvider,
  usePresence,
} from './PresenceContext';

// Helper: wrap component in provider
function renderWithPresenceProvider(ui: React.ReactElement) {
  return render(
    <PresenceProvider>{ui}</PresenceProvider>
  );
}

// Consumer component for testing
function PresenceConsumer() {
  const presence = usePresence();
  return (
    <div>
      <span data-testid="online-count">{presence.onlineCount}</span>
      <span data-testid="has-fetch">{typeof presence.fetchPresence}</span>
      <span data-testid="has-set-status">{typeof presence.setStatus}</span>
      <span data-testid="has-get-presence">{typeof presence.getPresence}</span>
    </div>
  );
}

describe('PresenceContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders provider without crashing', () => {
    renderWithPresenceProvider(<div>child</div>);
    expect(screen.getByText('child')).toBeTruthy();
  });

  it('provides context values to consumers', () => {
    renderWithPresenceProvider(<PresenceConsumer />);

    expect(screen.getByTestId('has-fetch').textContent).toBe('function');
    expect(screen.getByTestId('has-set-status').textContent).toBe('function');
    expect(screen.getByTestId('has-get-presence').textContent).toBe('function');
  });

  it('initializes with zero online count', () => {
    renderWithPresenceProvider(<PresenceConsumer />);

    expect(screen.getByTestId('online-count').textContent).toBe('0');
  });

  it('getPresence returns offline for unknown user', () => {
    let getPresenceFn: ((userId: number) => { status: string }) | null = null;

    function TestConsumer() {
      const { getPresence } = usePresence();
      getPresenceFn = getPresence;
      return <div>test</div>;
    }

    renderWithPresenceProvider(<TestConsumer />);

    expect(getPresenceFn).not.toBeNull();
    const presence = getPresenceFn!(99999);
    expect(presence.status).toBe('offline');
  });
});

describe('PresenceContext for a manager visiting from a community above (E-107)', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockClear();
  });

  it('never sends a heartbeat, so the visitor never shows as online here', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 7, tenant_id: 2, role: 'admin', is_tenant_super_admin: true },
      isAuthenticated: true,
    } as unknown as ReturnType<typeof useAuth>);
    mockUseTenant.mockReturnValue({ tenant: { id: 101 } });

    renderWithPresenceProvider(<div>child</div>);

    expect(api.post).not.toHaveBeenCalledWith('/v2/presence/heartbeat');
  });

  it('sends it as usual in its own community', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 7, tenant_id: 2, role: 'admin', is_tenant_super_admin: true },
      isAuthenticated: true,
    } as unknown as ReturnType<typeof useAuth>);
    mockUseTenant.mockReturnValue({ tenant: { id: 2 } });

    renderWithPresenceProvider(<div>child</div>);

    expect(api.post).toHaveBeenCalledWith('/v2/presence/heartbeat');
  });
});
