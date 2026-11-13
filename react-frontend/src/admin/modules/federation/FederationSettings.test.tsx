// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// --- mocks ---------------------------------------------------------------

const { mockAdminFederation } = vi.hoisted(() => ({
  mockAdminFederation: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    getPartnerships: vi.fn(),
    approvePartnership: vi.fn(),
    rejectPartnership: vi.fn(),
    terminatePartnership: vi.fn(),
    reactivatePartnership: vi.fn(),
    getDirectory: vi.fn(),
    requestPartnership: vi.fn(),
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminFederation: mockAdminFederation,
}));

// PartnerTimebankGuidance has its own router dep — stub it out
vi.mock('./PartnerTimebankGuidance', () => ({
  PartnerTimebankGuidance: () => <div data-testid="partner-guidance" />,
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast }),
);

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

// Import AFTER mocks
import { FederationSettings } from './FederationSettings';

// --- data ----------------------------------------------------------------

const FED_DATA = {
  federation_enabled: true,
  tenant_id: 2,
  settings: {
    allow_inbound_partnerships: true,
    shared_categories: [],
    max_partnerships: 10,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// --- tests ---------------------------------------------------------------

describe('FederationSettings — loading state', () => {
  it('shows loading skeleton while fetching', () => {
    mockAdminFederation.getSettings.mockReturnValue(new Promise(() => {}));
    render(<FederationSettings />);
    const loadingEl = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(loadingEl).toBeInTheDocument();
  });
});

describe('FederationSettings — error / null state', () => {
  it('shows "not enabled for tenant" when API returns null data', async () => {
    mockAdminFederation.getSettings.mockResolvedValue({ success: true, data: null });
    render(<FederationSettings />);
    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });
    // No settings card, just the "not enabled" fallback
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('shows error toast when getSettings throws', async () => {
    mockAdminFederation.getSettings.mockRejectedValue(new Error('fail'));
    render(<FederationSettings />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});

describe('FederationSettings — populated state', () => {
  beforeEach(() => {
    mockAdminFederation.getSettings.mockResolvedValue({ success: true, data: FED_DATA });
  });

  it('renders federation_enabled switch in on state', async () => {
    render(<FederationSettings />);
    await waitFor(() => {
      const switches = screen.getAllByRole('switch');
      expect(switches.length).toBeGreaterThan(0);
    });
  });

  it('renders max_partnerships input with correct value', async () => {
    render(<FederationSettings />);
    await waitFor(() => {
      const input = screen.getByRole('spinbutton');
      expect(input).toHaveValue(10);
    });
  });

  it('renders Save Changes button (disabled when not dirty)', async () => {
    render(<FederationSettings />);
    await waitFor(() => {
      const saveBtn = screen.getByRole('button', { name: /save/i });
      expect(saveBtn).toBeDisabled();
    });
  });
});

describe('FederationSettings — dirty state and save', () => {
  beforeEach(() => {
    mockAdminFederation.getSettings.mockResolvedValue({ success: true, data: FED_DATA });
  });

  it('enables Save button after toggling a switch', async () => {
    render(<FederationSettings />);
    await waitFor(() => screen.getAllByRole('switch'));

    // Toggle federation_enabled switch (first one)
    await userEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => {
      const saveBtn = screen.getByRole('button', { name: /save/i });
      expect(saveBtn).not.toBeDisabled();
    });
  });

  it('calls updateSettings and shows success toast on save', async () => {
    mockAdminFederation.updateSettings.mockResolvedValue({ success: true });
    render(<FederationSettings />);
    await waitFor(() => screen.getAllByRole('switch'));

    // Make dirty by toggling
    await userEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled());

    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(mockAdminFederation.updateSettings).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it.each([
    ['federation_enabled', 0],
    ['allow_inbound_partnerships', 1],
  ] as const)('persists the %s toggle through the settings endpoint', async (field, switchIndex) => {
    mockAdminFederation.updateSettings.mockResolvedValue({ success: true });
    render(<FederationSettings />);
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(2));

    await userEvent.click(screen.getAllByRole('switch')[switchIndex]);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    const expected = {
      federation_enabled: FED_DATA.federation_enabled,
      settings: { ...FED_DATA.settings },
    };
    if (field === 'federation_enabled') {
      expected.federation_enabled = false;
    } else {
      expected.settings[field] = !FED_DATA.settings[field];
    }

    await waitFor(() => {
      expect(mockAdminFederation.updateSettings).toHaveBeenCalledWith(expected);
    });
  });

  it('offers no "approve automatically" switch — nothing on the server ever acted on it', async () => {
    // Retired November 2026. Even a stored value from before must not bring it back.
    mockAdminFederation.getSettings.mockResolvedValue({
      success: true,
      data: { ...FED_DATA, settings: { ...FED_DATA.settings, auto_approve_partners: true } },
    });
    render(<FederationSettings />);
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(2));

    expect(screen.queryByRole('switch', { name: /automatic/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/approve new partners automatically/i)).not.toBeInTheDocument();
  });

  it('shows error toast when save fails', async () => {
    mockAdminFederation.updateSettings.mockResolvedValue({ success: false, error: 'Server error' });
    render(<FederationSettings />);
    await waitFor(() => screen.getAllByRole('switch'));

    await userEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});

describe('FederationSettings — refresh', () => {
  it('re-fetches on Refresh button click', async () => {
    mockAdminFederation.getSettings
      .mockResolvedValueOnce({ success: true, data: FED_DATA })
      .mockResolvedValueOnce({ success: true, data: FED_DATA });
    render(<FederationSettings />);
    await waitFor(() => screen.getAllByRole('switch'));

    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => {
      expect(mockAdminFederation.getSettings).toHaveBeenCalledTimes(2);
    });
  });
});
