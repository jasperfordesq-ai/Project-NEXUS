// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * WellbeingSettingsCard — who is told first when a volunteer asks for someone
 * to get in touch, and the "need support now" box volunteers see.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

const mockApi = vi.hoisted(() => ({
  getWellbeingSettings: vi.fn(),
  updateWellbeingSettings: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  adminVolunteering: mockApi,
}));

vi.mock('../../components/MemberSearchPicker', () => ({
  MemberSearchPicker: ({ onSelectedMemberChange, label }: { onSelectedMemberChange?: (m: { id: number; name: string; email: string } | null) => void; label: string }) => (
    <button type="button" onClick={() => onSelectedMemberChange?.({ id: 222, name: 'Nikita Serkevich', email: 'n@example.org' })}>
      {label}
    </button>
  ),
}));

import { WellbeingSettingsCard } from './WellbeingSettingsCard';

const SETTINGS = {
  contact_user_ids: [],
  contacts: [],
  contact_email: null,
  support_text: '',
  support_links: [],
  defaults: {
    support_text: "If you need support now, contact your community's team.",
    support_links: [{ label: 'Contact the team', url: '/contact' }],
  },
};

describe('WellbeingSettingsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getWellbeingSettings.mockResolvedValue({ success: true, data: SETTINGS });
    mockApi.updateWellbeingSettings.mockImplementation((payload: Record<string, unknown>) =>
      Promise.resolve({ success: true, data: { ...SETTINGS, ...payload, contacts: [{ id: 222, name: 'Nikita Serkevich', status: 'active' }] } }),
    );
  });

  it('shows the default support text until the community writes its own', async () => {
    render(<WellbeingSettingsCard />);

    expect(await screen.findByText(/contact your community's team/i)).toBeInTheDocument();
    expect(screen.getByText(/default/i)).toBeInTheDocument();
  });

  it('adds a contact, an address and a link, and saves them', async () => {
    render(<WellbeingSettingsCard />);
    await screen.findByText(/contact your community's team/i);

    fireEvent.click(screen.getByRole('button', { name: /add a wellbeing contact/i }));
    expect(await screen.findByText('Nikita Serkevich')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/extra email address/i), { target: { value: 'wellbeing@example.org' } });
    fireEvent.change(screen.getByLabelText(/support text/i), { target: { value: 'Ring the office any weekday.' } });
    fireEvent.click(screen.getByRole('button', { name: /add a link/i }));
    fireEvent.change(screen.getByLabelText(/link 1 label/i), { target: { value: 'Our office' } });
    fireEvent.change(screen.getByLabelText(/link 1 address/i), { target: { value: 'tel:+353100' } });
    fireEvent.click(screen.getByRole('button', { name: /save wellbeing settings/i }));

    await waitFor(() => expect(mockApi.updateWellbeingSettings).toHaveBeenCalledWith({
      contact_user_ids: [222],
      contact_email: 'wellbeing@example.org',
      support_text: 'Ring the office any weekday.',
      support_links: [{ label: 'Our office', url: 'tel:+353100' }],
    }));
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('shows the server refusal beside the field it names', async () => {
    mockApi.updateWellbeingSettings.mockResolvedValue({
      success: false,
      errors: [{ code: 'VALIDATION_ERROR', message: 'Each link needs a label and a secure address.', field: 'support_links' }],
    });
    render(<WellbeingSettingsCard />);
    await screen.findByText(/contact your community's team/i);

    fireEvent.click(screen.getByRole('button', { name: /add a link/i }));
    fireEvent.change(screen.getByLabelText(/link 1 label/i), { target: { value: 'Bad' } });
    fireEvent.change(screen.getByLabelText(/link 1 address/i), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: /save wellbeing settings/i }));

    expect(await screen.findByText('Each link needs a label and a secure address.')).toBeInTheDocument();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('removes a contact', async () => {
    mockApi.getWellbeingSettings.mockResolvedValue({
      success: true,
      data: { ...SETTINGS, contact_user_ids: [222], contacts: [{ id: 222, name: 'Nikita Serkevich', status: 'active' }] },
    });
    render(<WellbeingSettingsCard />);
    expect(await screen.findByText('Nikita Serkevich')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove nikita serkevich/i }));
    expect(screen.queryByText('Nikita Serkevich')).not.toBeInTheDocument();
  });
});
