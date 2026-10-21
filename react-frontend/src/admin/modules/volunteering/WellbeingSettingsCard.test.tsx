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

  it('shows a whole-list server refusal as an announced message tied to the links', async () => {
    mockApi.updateWellbeingSettings.mockResolvedValue({
      success: false,
      errors: [{ code: 'VALIDATION_ERROR', message: 'You can add up to five links.', field: 'support_links' }],
    });
    render(<WellbeingSettingsCard />);
    await screen.findByText(/contact your community's team/i);

    fireEvent.click(screen.getByRole('button', { name: /add a link/i }));
    fireEvent.change(screen.getByLabelText(/link 1 label/i), { target: { value: 'Our office' } });
    fireEvent.change(screen.getByLabelText(/link 1 address/i), { target: { value: 'https://example.org/help' } });
    fireEvent.click(screen.getByRole('button', { name: /save wellbeing settings/i }));

    const message = await screen.findByText('You can add up to five links.');
    expect(message).toHaveAttribute('role', 'alert');
    const group = screen.getByRole('group', { name: /support links/i });
    expect(group.getAttribute('aria-describedby')).toContain(message.id);
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  // Deep audit C11 (21 Oct 2026): the server now names the row (support_links.{i}).
  it('marks the link row the server refused', async () => {
    mockApi.updateWellbeingSettings.mockResolvedValue({
      success: false,
      errors: [{ code: 'VALIDATION_ERROR', message: 'Each link needs a label and a secure address.', field: 'support_links.1' }],
    });
    mockApi.getWellbeingSettings.mockResolvedValue({
      success: true,
      data: { ...SETTINGS, support_links: [{ label: 'One', url: '/contact' }, { label: 'Two', url: 'https://example.org/two' }] },
    });
    render(<WellbeingSettingsCard />);
    await screen.findByDisplayValue('Two');
    fireEvent.click(screen.getByRole('button', { name: /save wellbeing settings/i }));

    expect(await screen.findByText('Each link needs a label and a secure address.')).toBeInTheDocument();
    expect(screen.getByLabelText(/link 2 address/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/link 1 address/i)).not.toHaveAttribute('aria-invalid', 'true');
  });

  it.each([
    ['plain http', 'Our office', 'http://example.org', /starts with https:\/\//i],
    ['javascript', 'Our office', 'javascript:alert(1)', /starts with https:\/\//i],
    ['protocol-relative', 'Our office', '//evil.example', /starts with https:\/\//i],
    ['no label', '   ', 'https://example.org', /give this link a label/i],
    ['label too long', 'x'.repeat(81), 'https://example.org', /80 characters or fewer/i],
  ])('refuses a %s link before sending anything, and says which row', async (_name, label, url, message) => {
    render(<WellbeingSettingsCard />);
    await screen.findByText(/contact your community's team/i);

    fireEvent.click(screen.getByRole('button', { name: /add a link/i }));
    fireEvent.change(screen.getByLabelText(/link 1 label/i), { target: { value: label } });
    fireEvent.change(screen.getByLabelText(/link 1 address/i), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: /save wellbeing settings/i }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText(/some support links need fixing/i)).toHaveAttribute('role', 'alert');
    expect(mockApi.updateWellbeingSettings).not.toHaveBeenCalled();
  });

  it.each([
    ['https', 'https://example.org/help'],
    ['mailto', 'mailto:help@example.org'],
    ['tel', 'tel:+353100'],
    ['a page on this site', '/contact'],
  ])('accepts a %s link', async (_name, url) => {
    render(<WellbeingSettingsCard />);
    await screen.findByText(/contact your community's team/i);

    fireEvent.click(screen.getByRole('button', { name: /add a link/i }));
    fireEvent.change(screen.getByLabelText(/link 1 label/i), { target: { value: 'Help' } });
    fireEvent.change(screen.getByLabelText(/link 1 address/i), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: /save wellbeing settings/i }));

    await waitFor(() => expect(mockApi.updateWellbeingSettings).toHaveBeenCalled());
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
