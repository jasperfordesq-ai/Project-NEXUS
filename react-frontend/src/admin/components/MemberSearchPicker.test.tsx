// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── Mock adminApi ──────────────────────────────────────────────────────────────
vi.mock('../api/adminApi', () => ({
  adminUsers: {
    list: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('@/contexts', () => createMockContexts());

import { adminUsers } from '../api/adminApi';
import { MemberSearchPicker } from './MemberSearchPicker';

const MOCK_MEMBERS = [
  { id: 1, name: 'Alice Smith', email: 'alice@example.com', avatar_url: null },
  { id: 2, name: 'Bob Jones', email: 'bob@example.com', avatar_url: null },
];

const DEFAULT_PROPS = {
  value: '',
  onValueChange: vi.fn(),
  onSelectedMemberChange: vi.fn(),
  label: 'Pick a member',
  placeholder: 'Search members…',
  noResultsText: 'No members found',
  clearText: 'Clear',
};

describe('MemberSearchPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the search input with the given label', () => {
    render(<MemberSearchPicker {...DEFAULT_PROPS} />);
    expect(screen.getByRole('combobox', { name: /Pick a member/i })).toBeInTheDocument();
  });

  it('shows no dropdown before typing', () => {
    render(<MemberSearchPicker {...DEFAULT_PROPS} />);
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
  });

  it('shows noResultsText when query has ≥2 chars but API returns empty', async () => {
    vi.mocked(adminUsers.list).mockResolvedValue({ success: true, data: [] });
    render(<MemberSearchPicker {...DEFAULT_PROPS} />);
    const input = screen.getByRole('combobox', { name: /Pick a member/i });
    await userEvent.type(input, 'zz');
    await waitFor(() => {
      expect(screen.getByText('No members found')).toBeInTheDocument();
      expect(adminUsers.list).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'zz' })
      );
    });
  });

  it('renders search results in a dropdown after debounce', async () => {
    vi.mocked(adminUsers.list).mockResolvedValue({
      success: true,
      data: MOCK_MEMBERS,
    });
    render(<MemberSearchPicker {...DEFAULT_PROPS} />);
    const input = screen.getByRole('combobox', { name: /Pick a member/i });
    await userEvent.type(input, 'Ali');
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('fires onSelectedMemberChange and onValueChange when a result is selected', async () => {
    const onValueChange = vi.fn();
    const onSelectedMemberChange = vi.fn();
    vi.mocked(adminUsers.list).mockResolvedValue({
      success: true,
      data: MOCK_MEMBERS,
    });
    render(
      <MemberSearchPicker
        {...DEFAULT_PROPS}
        onValueChange={onValueChange}
        onSelectedMemberChange={onSelectedMemberChange}
      />
    );
    const input = screen.getByRole('combobox', { name: /Pick a member/i });
    await userEvent.type(input, 'Ali');
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    const option = screen.getByRole('option', { name: /Alice Smith/ });
    await userEvent.click(option);
    expect(onValueChange).toHaveBeenCalledWith('1');
    expect(onSelectedMemberChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: 'Alice Smith' })
    );
  });

  it('renders results in a portalled listbox, not inside the field', async () => {
    // Regression: the results used to be an absolutely positioned <div> inside
    // the field, which a scrolling container (every admin modal body) clipped
    // out of sight, so the search looked broken. They must live in a popover.
    vi.mocked(adminUsers.list).mockResolvedValue({
      success: true,
      data: MOCK_MEMBERS,
    } as never);
    const { container } = render(
      <div className="overflow-y-auto">
        <MemberSearchPicker {...DEFAULT_PROPS} />
      </div>
    );
    await userEvent.type(screen.getByRole('combobox', { name: /Pick a member/i }), 'Ali');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    expect(container.contains(screen.getByRole('listbox'))).toBe(false);
  });

  it('shows members the server matched by email even when the name does not match', async () => {
    vi.mocked(adminUsers.list).mockResolvedValue({
      success: true,
      data: [{ id: 3, name: 'Carol White', email: 'cw.volunteer@example.com', avatar_url: null }],
    } as never);
    render(<MemberSearchPicker {...DEFAULT_PROPS} />);
    await userEvent.type(screen.getByRole('combobox', { name: /Pick a member/i }), 'volunteer');
    expect(await screen.findByRole('option', { name: /Carol White/ })).toBeInTheDocument();
  });

  it('renders the selected member card when selectedMember is provided', () => {
    render(
      <MemberSearchPicker
        {...DEFAULT_PROPS}
        value="1"
        selectedMember={{ id: 1, name: 'Alice Smith', email: 'alice@example.com' }}
      />
    );
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear/i })).toBeInTheDocument();
  });

  it('fires onSelectedMemberChange(null) and onValueChange("") when Clear is pressed', async () => {
    const onValueChange = vi.fn();
    const onSelectedMemberChange = vi.fn();
    render(
      <MemberSearchPicker
        {...DEFAULT_PROPS}
        value="1"
        selectedMember={{ id: 1, name: 'Alice Smith', email: 'alice@example.com' }}
        onValueChange={onValueChange}
        onSelectedMemberChange={onSelectedMemberChange}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /Clear/i }));
    expect(onSelectedMemberChange).toHaveBeenCalledWith(null);
    expect(onValueChange).toHaveBeenCalledWith('');
  });

  it('does not call api when query is shorter than 2 chars', async () => {
    render(<MemberSearchPicker {...DEFAULT_PROPS} />);
    const input = screen.getByRole('combobox', { name: /Pick a member/i });
    await userEvent.type(input, 'a');
    // Wait a bit past debounce time
    await new Promise((r) => setTimeout(r, 400));
    expect(adminUsers.list).not.toHaveBeenCalled();
  });

  it('does not show dropdown when API returns success:false', async () => {
    vi.mocked(adminUsers.list).mockResolvedValue({ success: false, data: null });
    render(<MemberSearchPicker {...DEFAULT_PROPS} />);
    const input = screen.getByRole('combobox', { name: /Pick a member/i });
    await userEvent.type(input, 'Ali');
    await waitFor(() => {
      expect(adminUsers.list).toHaveBeenCalled();
    });
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
  });
});
