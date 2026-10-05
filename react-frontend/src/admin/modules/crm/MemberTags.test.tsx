// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockCrm } = vi.hoisted(() => ({
  mockCrm: {
    getTags: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    bulkRemoveTag: vi.fn(),
    exportTags: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminCrm: mockCrm,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Contexts / hooks ─────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Admin-specific stubs ─────────────────────────────────────────────────────
vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      <div data-testid="page-header-actions">{actions}</div>
    </div>
  ),
}));

vi.mock('../../components/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, onConfirm, onClose, title, message, isLoading }: {
    isOpen: boolean; onConfirm: () => void; onClose: () => void; title: string; message: string; isLoading?: boolean;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title} data-testid="confirm-modal">
        <span>{title}</span>
        <p data-testid="confirm-message">{message}</p>
        <button onClick={onConfirm} disabled={isLoading}>Confirm</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null,
}));

vi.mock('../../components/MemberSearchPicker', () => ({
  MemberSearchPicker: ({ label, value, onValueChange, onSelectedMemberChange }: {
    label: string; value: string; onValueChange: (v: string) => void; onSelectedMemberChange?: (m: unknown) => void;
  }) => (
    <div data-testid="member-search-picker" data-value={value}>
      {label}
      <button
        onClick={() => {
          onValueChange('42');
          onSelectedMemberChange?.({ id: 42, name: 'Alice Example', email: 'alice@example.test' });
        }}
      >
        pick-member-42
      </button>
    </div>
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeTagSummary = (overrides = {}) => ({
  tag: 'Gardening',
  member_count: 3,
  last_added_at: '2026-10-01T10:00:00Z',
  ...overrides,
});

const makeMemberTag = (overrides = {}) => ({
  id: 1,
  tenant_id: 2,
  user_id: 42,
  tag: 'Gardening',
  created_by: 1,
  created_at: '2026-10-01T10:00:00Z',
  user_name: 'Alice Example',
  user_avatar: null,
  created_by_name: 'Jane Coordinator',
  ...overrides,
});

const ok = (data: unknown) => ({ success: true, data });

const waitForLoaded = () =>
  waitFor(() => {
    const busy = screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeUndefined();
  });

/** Routes getTags: no filter → summaries, ?tag= → members of that tag. */
const routeTags = (summaries: object[], membersByTag: Record<string, object[]> = {}) => {
  mockCrm.getTags.mockImplementation((params?: { tag?: string }) =>
    Promise.resolve(ok(params?.tag ? (membersByTag[params.tag] ?? []) : summaries))
  );
};

const headerButton = (pattern: RegExp) =>
  within(screen.getByTestId('page-header-actions')).getAllByRole('button').find((b) => pattern.test(b.textContent ?? ''));

// ─────────────────────────────────────────────────────────────────────────────

describe('MemberTags', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.pushState({}, '', '/admin/crm/tags');
    routeTags([]);
    mockCrm.addTag.mockResolvedValue(ok(makeMemberTag()));
    mockCrm.removeTag.mockResolvedValue({ success: true });
    mockCrm.bulkRemoveTag.mockResolvedValue({ success: true, data: { deleted: 3 } });
    mockCrm.exportTags.mockResolvedValue(new Blob());
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  // ─── Tag list ──────────────────────────────────────────────────────────────

  it('shows a loading spinner while tags are being loaded', async () => {
    mockCrm.getTags.mockImplementation(() => new Promise(() => {}));
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    const busy = screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows an empty state with an Add tag action when no tags exist', async () => {
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    expect(screen.getByText(/no tags yet|crm\.no_tags_yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /add tag|crm\.add_tag/i }).length).toBeGreaterThanOrEqual(2);
  });

  it('renders one card per tag with its member count and when it was last added', async () => {
    routeTags([makeTagSummary(), makeTagSummary({ tag: 'Needs a lift', member_count: 1 })]);
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    expect(screen.getByRole('link', { name: 'Gardening' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Needs a lift' })).toBeInTheDocument();
    // The count is a number, not the bare word "Members" the old page showed.
    expect(screen.getByText(/^3 members$|crm\.tag_member_count/)).toBeInTheDocument();
    expect(screen.getByText(/^1 member$/)).toBeInTheDocument();
    expect(screen.getAllByText(/last added|crm\.tag_last_added/i).length).toBe(2);
    expect(screen.getByText(/^2 tags$|crm\.tags_summary/)).toBeInTheDocument();
  });

  it('filters the list from ?q= and says how many tags match', async () => {
    window.history.pushState({}, '', '/admin/crm/tags?q=lift');
    routeTags([makeTagSummary(), makeTagSummary({ tag: 'Needs a lift', member_count: 1 })]);
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    expect(screen.queryByRole('link', { name: 'Gardening' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Needs a lift' })).toBeInTheDocument();
    expect(screen.getByText(/1 tag matches your search|crm\.tags_summary_filtered/i)).toBeInTheDocument();
  });

  it('writes the search box into the address after the debounce, and Clear resets it', async () => {
    vi.useFakeTimers();
    try {
      routeTags([makeTagSummary()]);
      const { MemberTags } = await import('./MemberTags');
      render(<MemberTags />);
      await vi.waitFor(() => expect(mockCrm.getTags).toHaveBeenCalled());

      const search = screen.getByRole('searchbox');
      fireEvent.change(search, { target: { value: 'gard' } });
      expect(window.location.search).toBe('');
      vi.advanceTimersByTime(350);
      expect(window.location.search).toBe('?q=gard');
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers Clear in the empty state when a search matches nothing', async () => {
    window.history.pushState({}, '', '/admin/crm/tags?q=zzz');
    routeTags([makeTagSummary()]);
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    expect(screen.getByText(/no tags found|crm\.no_tags_found/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^clear$|crm\.clear$/i }));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.getByRole('link', { name: 'Gardening' })).toBeInTheDocument();
  });

  it('sorts A to Z from ?sort=name and most-members otherwise', async () => {
    routeTags([makeTagSummary({ tag: 'Zumba', member_count: 9 }), makeTagSummary({ tag: 'Baking', member_count: 2 })]);
    const { MemberTags } = await import('./MemberTags');
    const { unmount } = render(<MemberTags />);

    await waitForLoaded();
    let names = screen.getAllByRole('listitem').map((li) => within(li).getByRole('link').textContent);
    expect(names).toEqual(['Zumba', 'Baking']);
    unmount();

    window.history.pushState({}, '', '/admin/crm/tags?sort=name');
    render(<MemberTags />);
    await waitForLoaded();
    names = screen.getAllByRole('listitem').map((li) => within(li).getByRole('link').textContent);
    expect(names).toEqual(['Baking', 'Zumba']);
  });

  it('opens a tag through the address (?tag=) so the back button returns to the list', async () => {
    routeTags([makeTagSummary()], { Gardening: [makeMemberTag()] });
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    fireEvent.click(screen.getByRole('link', { name: 'Gardening' }));

    await waitFor(() => expect(window.location.search).toBe('?tag=Gardening'));
    await waitFor(() => expect(mockCrm.getTags).toHaveBeenCalledWith({ tag: 'Gardening' }));
    expect(await screen.findByRole('link', { name: 'Alice Example' })).toBeInTheDocument();
  });

  // ─── Members of one tag ────────────────────────────────────────────────────

  it('lands on the members view from a ?tag= link, naming the tag, the count and who added it', async () => {
    window.history.pushState({}, '', '/admin/crm/tags?tag=Gardening');
    routeTags([makeTagSummary()], { Gardening: [makeMemberTag(), makeMemberTag({ id: 2, user_id: 43, user_name: 'Bob Example', created_by_name: null })] });
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    expect(await screen.findByRole('link', { name: 'Alice Example' })).toHaveAttribute('href', '/test/admin/users/42/edit');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/Gardening/);
    expect(screen.getByText(/2 members have this tag|crm\.tagged_members_summary/i)).toBeInTheDocument();
    expect(screen.getByText(/by Jane Coordinator|crm\.tag_added_on_by/i)).toBeInTheDocument();
    // The header button now offers to tag another member, and a remove-from-all button is present.
    expect(headerButton(/tag another member|crm\.tag_another_member/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /remove from all members|crm\.remove_from_all_members/i })).toBeInTheDocument();
  });

  it('All tags takes the member view back to the list', async () => {
    window.history.pushState({}, '', '/admin/crm/tags?tag=Gardening');
    routeTags([makeTagSummary()], { Gardening: [makeMemberTag()] });
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await screen.findByRole('link', { name: 'Alice Example' });
    fireEvent.click(screen.getAllByRole('button', { name: /all tags|crm\.all_tags/i })[0]!);

    await waitFor(() => expect(window.location.search).toBe(''));
    expect(await screen.findByRole('link', { name: 'Gardening' })).toBeInTheDocument();
  });

  it('shows an empty state when nobody carries the tag in the address', async () => {
    window.history.pushState({}, '', '/admin/crm/tags?tag=Nobody');
    routeTags([makeTagSummary()]);
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    expect(await screen.findByText(/no members with this tag|crm\.no_members_with_tag/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove from all members|crm\.remove_from_all_members/i })).not.toBeInTheDocument();
  });

  it('removing the tag from one member confirms by name and reloads', async () => {
    window.history.pushState({}, '', '/admin/crm/tags?tag=Gardening');
    routeTags([makeTagSummary()], { Gardening: [makeMemberTag()] });
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await screen.findByRole('link', { name: 'Alice Example' });
    fireEvent.click(screen.getByRole('button', { name: /remove tag from alice example|crm\.remove_tag_from_member_aria/i }));

    const dialog = await screen.findByTestId('confirm-modal');
    expect(within(dialog).getByTestId('confirm-message')).toHaveTextContent(/Gardening.*Alice Example|crm\.remove_tag_confirm_named/);
    fireEvent.click(within(dialog).getByText('Confirm'));

    await waitFor(() => expect(mockCrm.removeTag).toHaveBeenCalledWith(1));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    // Members of the tag and the summary are both refreshed.
    await waitFor(() => expect(mockCrm.getTags.mock.calls.filter(([p]) => p?.tag === 'Gardening').length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(mockCrm.getTags.mock.calls.filter(([p]) => !p).length).toBeGreaterThanOrEqual(2));
  });

  it('removing a tag from everyone, from a card, confirms with the tag and count and calls the bulk endpoint', async () => {
    routeTags([makeTagSummary()]);
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    fireEvent.click(screen.getByRole('button', { name: /remove .*gardening.* from all members|crm\.remove_tag_all_aria/i }));

    const dialog = await screen.findByTestId('confirm-modal');
    expect(within(dialog).getByTestId('confirm-message')).toHaveTextContent(/Gardening.*3 members|crm\.remove_tag_all_confirm_named/);
    fireEvent.click(within(dialog).getByText('Confirm'));

    await waitFor(() => expect(mockCrm.bulkRemoveTag).toHaveBeenCalledWith('Gardening'));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('removing a tag from everyone while viewing it returns to the list', async () => {
    window.history.pushState({}, '', '/admin/crm/tags?tag=Gardening');
    routeTags([makeTagSummary()], { Gardening: [makeMemberTag()] });
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await screen.findByRole('link', { name: 'Alice Example' });
    fireEvent.click(screen.getByRole('button', { name: /remove from all members|crm\.remove_from_all_members/i }));
    fireEvent.click(within(await screen.findByTestId('confirm-modal')).getByText('Confirm'));

    await waitFor(() => expect(mockCrm.bulkRemoveTag).toHaveBeenCalledWith('Gardening'));
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('shows an error toast when the bulk removal fails', async () => {
    routeTags([makeTagSummary()]);
    mockCrm.bulkRemoveTag.mockRejectedValue(new Error('network'));
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    fireEvent.click(screen.getByRole('button', { name: /remove .*gardening.* from all members|crm\.remove_tag_all_aria/i }));
    fireEvent.click(within(await screen.findByTestId('confirm-modal')).getByText('Confirm'));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  // ─── Add tag ───────────────────────────────────────────────────────────────

  it('opens the Add tag dialog from the header', async () => {
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    fireEvent.click(headerButton(/add tag|crm\.add_tag/i)!);

    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    expect(screen.getByTestId('member-search-picker')).toBeInTheDocument();
  });

  it('refuses to add without a member selected', async () => {
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    fireEvent.click(headerButton(/add tag|crm\.add_tag/i)!);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const submit = within(dialog).getAllByRole('button').find((b) => /add tag|crm\.add_tag/i.test(b.textContent ?? ''));
    fireEvent.click(submit!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockCrm.addTag).not.toHaveBeenCalled();
  });

  it('adds the tag typed into the dialog and refreshes the list', async () => {
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    fireEvent.click(headerButton(/add tag|crm\.add_tag/i)!);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByText('pick-member-42'));
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '  Baking  ' } });
    const submit = within(dialog).getAllByRole('button').find((b) => /add tag|crm\.add_tag/i.test(b.textContent ?? ''));
    fireEvent.click(submit!);

    await waitFor(() => expect(mockCrm.addTag).toHaveBeenCalledWith({ user_id: 42, tag: 'Baking' }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    await waitFor(() => expect(mockCrm.getTags.mock.calls.filter(([p]) => !p).length).toBeGreaterThanOrEqual(2));
  });

  it('pre-fills the tag when adding from a tag’s members view', async () => {
    window.history.pushState({}, '', '/admin/crm/tags?tag=Gardening');
    routeTags([makeTagSummary()], { Gardening: [makeMemberTag()] });
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await screen.findByRole('link', { name: 'Alice Example' });
    fireEvent.click(headerButton(/tag another member|crm\.tag_another_member/i)!);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(within(dialog).getByRole('combobox')).toHaveValue('Gardening');
  });

  it('says the member already has the tag when the API answers 409', async () => {
    mockCrm.addTag.mockResolvedValue({ success: false, code: 'RESOURCE_ALREADY_EXISTS' });
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    fireEvent.click(headerButton(/add tag|crm\.add_tag/i)!);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByText('pick-member-42'));
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'Gardening' } });
    const submit = within(dialog).getAllByRole('button').find((b) => /add tag|crm\.add_tag/i.test(b.textContent ?? ''));
    fireEvent.click(submit!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(expect.stringMatching(/already has|crm\.tag_already_assigned/i)));
  });

  it('refuses a tag longer than 50 characters before calling the API', async () => {
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    fireEvent.click(headerButton(/add tag|crm\.add_tag/i)!);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByText('pick-member-42'));
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'x'.repeat(51) } });
    const submit = within(dialog).getAllByRole('button').find((b) => /add tag|crm\.add_tag/i.test(b.textContent ?? ''));
    fireEvent.click(submit!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockCrm.addTag).not.toHaveBeenCalled();
  });

  // ─── Export ────────────────────────────────────────────────────────────────

  it('exports the tags CSV from the header and reports the result', async () => {
    const { MemberTags } = await import('./MemberTags');
    render(<MemberTags />);

    await waitForLoaded();
    fireEvent.click(headerButton(/export tags|crm\.export_tags/i)!);
    await waitFor(() => expect(mockCrm.exportTags).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());

    mockCrm.exportTags.mockRejectedValueOnce(new Error('401'));
    fireEvent.click(headerButton(/export tags|crm\.export_tags/i)!);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });
});
