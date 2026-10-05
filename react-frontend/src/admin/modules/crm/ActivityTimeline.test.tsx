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
    getTimeline: vi.fn(),
    exportTimeline: vi.fn(),
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

vi.mock('../../components/MemberSearchPicker', () => ({
  MemberSearchPicker: ({ label, value, selectedMember, onValueChange }: {
    label: string; value: string; selectedMember?: { name: string } | null; onValueChange: (v: string) => void;
  }) => (
    <div data-testid="member-search-picker" data-value={value} data-member={selectedMember?.name ?? ''}>
      {label}
      <button onClick={() => onValueChange('42')}>pick-member-42</button>
      <button onClick={() => onValueChange('')}>clear-member</button>
    </div>
  ),
}));

import { ActivityTimeline } from './ActivityTimeline';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HOUR = 3600000;
const DAY = 24 * HOUR;

// Local-time stamps in the "YYYY-MM-DD HH:MM:SS" form the API returns.
const stamp = (date: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
};
// Noon today keeps "today" and "yesterday" stable whatever the clock says.
const noonToday = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };
const daysAgo = (n: number) => new Date(noonToday().getTime() - n * DAY);

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 42,
  user_name: 'Alice Smith',
  user_avatar: null,
  activity_type: 'login',
  description_code: 'login',
  description_params: {},
  description: 'SERVER COPY MUST NOT RENDER',
  metadata: null,
  created_at: stamp(noonToday()),
  ...overrides,
});

const LISTING = makeEntry({
  id: 2,
  user_id: 43,
  user_name: 'Bob Jones',
  activity_type: 'listing_created',
  description_code: 'listing_created',
  description_params: { title: 'Community gardening' },
  created_at: stamp(new Date(noonToday().getTime() - HOUR)),
});

const YESTERDAY_NOTE = makeEntry({
  id: 3,
  user_id: 44,
  user_name: 'Carol Note',
  activity_type: 'note_added',
  description_code: 'note_added',
  description_params: { author_name: 'Jane Coordinator', content: 'Called about the lift' },
  created_at: stamp(daysAgo(1)),
});

const OLD_SIGNUP = makeEntry({
  id: 4,
  user_id: 45,
  user_name: null,
  activity_type: 'signup',
  description_code: 'signup',
  created_at: stamp(daysAgo(10)),
});

const paged = (entries: unknown[], meta: Partial<{ total: number; current_page: number; per_page: number; total_pages: number }> = {}) => ({
  success: true,
  data: entries,
  meta: { total: entries.length, current_page: 1, per_page: 25, total_pages: 1, ...meta },
});

const lastRequest = () => mockCrm.getTimeline.mock.calls[mockCrm.getTimeline.mock.calls.length - 1][0];

describe('ActivityTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/admin/crm/timeline');
    mockCrm.getTimeline.mockResolvedValue(paged([makeEntry()]));
    mockCrm.exportTimeline.mockResolvedValue(new Blob());
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  // ── Loading, empty and error states ─────────────────────────────────────────

  it('shows a spinner on the first load only', () => {
    mockCrm.getTimeline.mockReturnValue(new Promise(() => {}));
    render(<ActivityTimeline />);
    const spinner = screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeDefined();
  });

  it('offers to widen to all time when the default window is empty', async () => {
    mockCrm.getTimeline.mockResolvedValue(paged([]));
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText(/no activity found|crm\.no_activity_found/i)).toBeInTheDocument());
    expect(screen.getByText(/longer date range|crm\.no_activity_hint_default/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show all time|crm\.show_all_time/i }));
    await waitFor(() => expect(window.location.search).toBe('?days=all'));
    await waitFor(() => expect(lastRequest().days).toBe(0));
  });

  it('offers to clear the filters when a filtered view is empty', async () => {
    window.history.pushState({}, '', '/admin/crm/timeline?type=signup&days=7');
    mockCrm.getTimeline.mockResolvedValue(paged([]));
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText(/no activity matches|crm\.no_activity_hint_filtered/i)).toBeInTheDocument());

    const clear = screen.getAllByRole('button', { name: /clear filters|crm\.clear_filters/i });
    fireEvent.click(clear[clear.length - 1]);
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('shows an error state with a retry when loading fails, instead of "no activity"', async () => {
    mockCrm.getTimeline.mockRejectedValueOnce(new Error('boom'));
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: /could not be loaded|crm\.timeline_load_failed$/i })).toBeInTheDocument());
    expect(screen.queryByText(/no activity found|crm\.no_activity_found/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^retry$|common\.retry/i }));
    await waitFor(() => expect(mockCrm.getTimeline).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
  });

  // ── Entries ─────────────────────────────────────────────────────────────────

  it('groups entries under one heading per day: Today, Yesterday, then the date', async () => {
    mockCrm.getTimeline.mockResolvedValue(paged([makeEntry(), LISTING, YESTERDAY_NOTE, OLD_SIGNUP]));
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings).toHaveLength(3);
    expect(headings[0]).toHaveTextContent(/today|crm\.day_today/i);
    expect(headings[1]).toHaveTextContent(/yesterday|crm\.day_yesterday/i);
    expect(headings[2]).not.toHaveTextContent(/today|yesterday/i);
    expect(headings[2].textContent?.length).toBeGreaterThan(5);

    // Both of today's entries sit under the first heading.
    const todaySection = headings[0].closest('section')!;
    expect(within(todaySection).getByText('Alice Smith')).toBeInTheDocument();
    expect(within(todaySection).getByText('Bob Jones')).toBeInTheDocument();
    expect(within(todaySection).queryByText('Carol Note')).not.toBeInTheDocument();
  });

  it('links each member to their admin edit page', async () => {
    render(<ActivityTimeline />);
    const link = await screen.findByRole('link', { name: 'Alice Smith' });
    expect(link).toHaveAttribute('href', '/test/admin/users/42/edit');
  });

  it('renders the translated label and description, never the server copy', async () => {
    mockCrm.getTimeline.mockResolvedValue(paged([makeEntry(), LISTING]));
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    // The type label is scoped to the row: the same words are also an option in the type filter.
    const aliceRow = screen.getByText('Alice Smith').closest('li')!;
    expect(within(aliceRow).getByText(/last active|crm\.activity_type_login/i)).toBeInTheDocument();
    expect(within(aliceRow).getByText(/last seen on the platform|crm\.activity_description_login/i)).toBeInTheDocument();
    expect(screen.getByText(/created listing: community gardening/i)).toBeInTheDocument();
    expect(screen.queryByText('SERVER COPY MUST NOT RENDER')).not.toBeInTheDocument();
  });

  it('shows the time of day and the member id for every entry', async () => {
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    expect(screen.getByText(/member #42|crm\.member_with_id/i)).toBeInTheDocument();
    const times = document.querySelectorAll('li time');
    expect(times.length).toBeGreaterThan(0);
    times.forEach((el) => {
      expect(el.textContent).toMatch(/\d{1,2}:\d{2}/);
      expect(el.getAttribute('title')).toBeTruthy();
    });
  });

  it('falls back to "Member #id" when the member has no name', async () => {
    mockCrm.getTimeline.mockResolvedValue(paged([OLD_SIGNUP]));
    render(<ActivityTimeline />);
    const link = await screen.findByRole('link', { name: /member #45|crm\.member_with_id/i });
    expect(link).toHaveAttribute('href', '/test/admin/users/45/edit');
  });

  // ── Filters in the address ──────────────────────────────────────────────────

  it('reads its filters and page from the address', async () => {
    window.history.pushState({}, '', '/admin/crm/timeline?user_id=7&type=listing_created&days=90&page=2');
    render(<ActivityTimeline />);
    await waitFor(() => expect(mockCrm.getTimeline).toHaveBeenCalled());
    expect(lastRequest()).toMatchObject({ user_id: 7, type: 'listing_created', days: 90, page: 2, limit: 25 });
  });

  it('asks for the default 30 days and ignores an unknown type or range', async () => {
    window.history.pushState({}, '', '/admin/crm/timeline?type=bogus&days=nonsense&user_id=abc');
    render(<ActivityTimeline />);
    await waitFor(() => expect(mockCrm.getTimeline).toHaveBeenCalled());
    expect(lastRequest()).toMatchObject({ type: undefined, days: 30, user_id: undefined, page: 1 });
  });

  it('sends days=0 for "all time" so the server does not fall back to 30 days', async () => {
    window.history.pushState({}, '', '/admin/crm/timeline?days=all');
    render(<ActivityTimeline />);
    await waitFor(() => expect(mockCrm.getTimeline).toHaveBeenCalled());
    expect(lastRequest().days).toBe(0);
  });

  it('puts the chosen date range in the address and returns to page 1', async () => {
    window.history.pushState({}, '', '/admin/crm/timeline?page=3');
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    fireEvent.click(screen.getByText(/last 7 days|crm\.date_range_7/i));
    await waitFor(() => expect(window.location.search).toBe('?days=7'));
    await waitFor(() => expect(lastRequest()).toMatchObject({ days: 7, page: 1 }));
  });

  it('puts the picked member in the address', async () => {
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    fireEvent.click(screen.getByText('pick-member-42'));
    await waitFor(() => expect(window.location.search).toBe('?user_id=42'));
    await waitFor(() => expect(lastRequest().user_id).toBe(42));

    fireEvent.click(screen.getByText('clear-member'));
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('narrows to one member from an entry and names them in the picker', async () => {
    mockCrm.getTimeline.mockResolvedValue(paged([makeEntry(), LISTING]));
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Bob Jones')).toBeInTheDocument());

    const bobRow = screen.getByText('Bob Jones').closest('li')!;
    fireEvent.click(within(bobRow).getByRole('button', { name: /only activity by bob jones|crm\.only_this_member_aria/i }));
    await waitFor(() => expect(window.location.search).toBe('?user_id=43'));
    expect(screen.getByTestId('member-search-picker')).toHaveAttribute('data-member', 'Bob Jones');
    await waitFor(() => expect(lastRequest().user_id).toBe(43));
  });

  it('hides the narrow-to-member button on entries of the member already shown', async () => {
    window.history.pushState({}, '', '/admin/crm/timeline?user_id=42');
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /only activity by alice smith|crm\.only_this_member_aria/i })).not.toBeInTheDocument();
  });

  it('shows "Clear filters" only when a filter is active', async () => {
    const { unmount } = render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /clear filters|crm\.clear_filters/i })).not.toBeInTheDocument();
    unmount();

    window.history.pushState({}, '', '/admin/crm/timeline?type=signup');
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /clear filters|crm\.clear_filters/i })).toBeInTheDocument();
  });

  // ── Summary, paging, refresh ────────────────────────────────────────────────

  it('summarises the count, and the range shown when there are several pages', async () => {
    mockCrm.getTimeline.mockResolvedValue(paged([makeEntry(), LISTING]));
    const { unmount } = render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText(/^2 activities$|crm\.timeline_summary/i)).toBeInTheDocument());
    unmount();

    window.history.pushState({}, '', '/admin/crm/timeline?page=2');
    mockCrm.getTimeline.mockResolvedValue(paged([makeEntry()], { total: 60, current_page: 2, total_pages: 3 }));
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText(/showing 26–50 of 60 activities|crm\.timeline_summary_range/i)).toBeInTheDocument());
  });

  it('pages through the address', async () => {
    mockCrm.getTimeline.mockResolvedValue(paged([makeEntry()], { total: 60, total_pages: 3 }));
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByRole('navigation')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^2$|page 2/i }));
    await waitFor(() => expect(window.location.search).toBe('?page=2'));
    await waitFor(() => expect(lastRequest().page).toBe(2));
  });

  it('shows no pagination for a single page', async () => {
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('keeps the entries on screen while refreshing', async () => {
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    mockCrm.getTimeline.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: /refresh|crm\.refresh/i }));
    await waitFor(() => expect(mockCrm.getTimeline).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  // ── Export ──────────────────────────────────────────────────────────────────

  it('exports with the current filters and confirms', async () => {
    window.history.pushState({}, '', '/admin/crm/timeline?user_id=42&type=login&days=all');
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /export activity|crm\.export_activity/i }));
    await waitFor(() => expect(mockCrm.exportTimeline).toHaveBeenCalledWith({ user_id: 42, type: 'login', days: 0 }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('says so when the export fails', async () => {
    mockCrm.exportTimeline.mockRejectedValueOnce(new Error('nope'));
    render(<ActivityTimeline />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /export activity|crm\.export_activity/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});
