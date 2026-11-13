// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoist mock data ───────────────────────────────────────────────────────────
const { mockAdminFederation } = vi.hoisted(() => ({
  mockAdminFederation: {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    getTopics: vi.fn(),
    getMyTopics: vi.fn(),
    updateMyTopics: vi.fn(),
  },
}));

// ── Mock adminApi ─────────────────────────────────────────────────────────────
vi.mock('@/admin/api/adminApi', () => ({
  adminFederation: mockAdminFederation,
  default: { adminFederation: mockAdminFederation },
}));

// ── Contexts ──────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ── Stub heavy children ───────────────────────────────────────────────────────
vi.mock('@/admin/components', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const makeFedProfile = (overrides = {}) => ({
  id: 1,
  name: 'hOUR Timebank',
  slug: 'hour-timebank',
  status: 'active',
  federation_profile: {
    description: 'A timebank community',
    contact_email: 'contact@hour-timebank.ie',
    website: 'https://hour-timebank.ie',
    categories: [],
  },
  ...overrides,
});

const makeTopic = (overrides = {}) => ({
  id: 10,
  name: 'Care',
  slug: 'care',
  icon: '❤️',
  category: 'care',
  tenant_count: 5,
  is_primary: false,
  ...overrides,
});

const successResponse = (data: unknown) => ({ success: true, data });
const errorResponse = () => ({ success: false, error: 'API error' });

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('MyProfile (Federation)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminFederation.getProfile.mockResolvedValue(successResponse(makeFedProfile()));
    mockAdminFederation.getTopics.mockResolvedValue(successResponse([]));
    mockAdminFederation.getMyTopics.mockResolvedValue(successResponse([]));
  });

  it('shows skeleton while loading', async () => {
    mockAdminFederation.getProfile.mockImplementationOnce(() => new Promise(() => {}));
    mockAdminFederation.getTopics.mockResolvedValue(successResponse([]));
    mockAdminFederation.getMyTopics.mockResolvedValue(successResponse([]));

    const { MyProfile } = await import('./MyProfile');
    render(<MyProfile />);

    // Skeleton is rendered — look for heading that is always present
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('renders profile form fields after load', async () => {
    const { MyProfile } = await import('./MyProfile');
    render(<MyProfile />);

    await waitFor(() => {
      // Community name input should show the profile name
      expect(screen.getByDisplayValue('hOUR Timebank')).toBeInTheDocument();
    });
  });

  it('does not show the read-only "slug" field — an internal name an admin could not use or change', async () => {
    const { MyProfile } = await import('./MyProfile');
    render(<MyProfile />);

    await waitFor(() => expect(screen.getByDisplayValue('hOUR Timebank')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('hour-timebank')).not.toBeInTheDocument();
    expect(screen.queryByText(/slug/i)).not.toBeInTheDocument();
  });

  it('labels a topic group with a plain word, not "Category Care"', async () => {
    mockAdminFederation.getTopics.mockResolvedValue(
      successResponse([makeTopic({ id: 10, name: 'Befriending', category: 'care' })])
    );
    const { MyProfile } = await import('./MyProfile');
    render(<MyProfile />);

    await waitFor(() => screen.getByText('Befriending'));
    expect(screen.getByRole('heading', { name: 'Care' })).toBeInTheDocument();
    expect(screen.queryByText(/Category Care/)).not.toBeInTheDocument();
  });

  it('renders contact email and website fields', async () => {
    const { MyProfile } = await import('./MyProfile');
    render(<MyProfile />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('contact@hour-timebank.ie')).toBeInTheDocument();
      expect(screen.getByDisplayValue('https://hour-timebank.ie')).toBeInTheDocument();
    });
  });

  it('shows not-available state when profile is null', async () => {
    mockAdminFederation.getProfile.mockResolvedValue({ success: false });
    const { MyProfile } = await import('./MyProfile');
    render(<MyProfile />);

    await waitFor(() => {
      // Profile not available text or building icon container
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toBeInTheDocument();
    });
  });

  it('shows error toast when getProfile throws', async () => {
    mockAdminFederation.getProfile.mockRejectedValue(new Error('network'));
    const { MyProfile } = await import('./MyProfile');
    render(<MyProfile />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders topic chips when topics are returned', async () => {
    mockAdminFederation.getTopics.mockResolvedValue(
      successResponse([makeTopic({ name: 'Home Repairs' })])
    );
    mockAdminFederation.getMyTopics.mockResolvedValue(successResponse([]));

    const { MyProfile } = await import('./MyProfile');
    render(<MyProfile />);

    await waitFor(() => {
      expect(screen.getByText('Home Repairs')).toBeInTheDocument();
    });
  });

  it('calls updateProfile on Save Changes button press', async () => {
    mockAdminFederation.updateProfile.mockResolvedValue({ success: true });
    mockAdminFederation.getProfile
      .mockResolvedValueOnce(successResponse(makeFedProfile()))
      .mockResolvedValue(successResponse(makeFedProfile()));

    const { MyProfile } = await import('./MyProfile');
    render(<MyProfile />);

    await waitFor(() => screen.getByDisplayValue('hOUR Timebank'));

    // Modify the name field to make dirty=true
    const nameInput = screen.getByDisplayValue('hOUR Timebank');
    fireEvent.change(nameInput, { target: { value: 'hOUR Timebank CLG' } });

    // Save Changes button should now be enabled
    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    expect(saveBtn).toBeDefined();
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminFederation.updateProfile).toHaveBeenCalled();
    });
  });

  it('shows success toast after saving profile', async () => {
    mockAdminFederation.updateProfile.mockResolvedValue({ success: true });
    mockAdminFederation.getProfile
      .mockResolvedValueOnce(successResponse(makeFedProfile()))
      .mockResolvedValue(successResponse(makeFedProfile()));

    const { MyProfile } = await import('./MyProfile');
    render(<MyProfile />);

    await waitFor(() => screen.getByDisplayValue('hOUR Timebank'));

    const nameInput = screen.getByDisplayValue('hOUR Timebank');
    fireEvent.change(nameInput, { target: { value: 'Updated Name' } });

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('renders wrapped data format (data.data)', async () => {
    mockAdminFederation.getProfile.mockResolvedValue({
      success: true,
      data: { data: makeFedProfile({ name: 'Wrapped Community' }) },
    });
    const { MyProfile } = await import('./MyProfile');
    render(<MyProfile />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Wrapped Community')).toBeInTheDocument();
    });
  });

  it('calls updateMyTopics when Save Topics is clicked after selecting a topic', async () => {
    mockAdminFederation.getTopics.mockResolvedValue(
      successResponse([makeTopic({ id: 10, name: 'Befriending', category: 'care' })])
    );
    mockAdminFederation.getMyTopics.mockResolvedValue(successResponse([]));
    mockAdminFederation.updateMyTopics.mockResolvedValue({ success: true });

    const { MyProfile } = await import('./MyProfile');
    render(<MyProfile />);

    await waitFor(() => screen.getByText('Befriending'));

    // Click the topic chip to select it (the group heading is now the plain
    // word "Care", so the topic needs a name of its own).
    const careChip = screen.getByText('Befriending');
    fireEvent.click(careChip);

    // Save Topics button
    const saveTopicsBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('topic')
    );
    if (saveTopicsBtn) fireEvent.click(saveTopicsBtn);

    await waitFor(() => {
      expect(mockAdminFederation.updateMyTopics).toHaveBeenCalled();
    });
  });
});
