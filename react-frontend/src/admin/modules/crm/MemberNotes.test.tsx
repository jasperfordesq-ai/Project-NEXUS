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
    getNotes: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    exportNotes: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminCrm: mockCrm,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Stub heavy children ─────────────────────────────────────────────────────
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
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

// ─── Admin-specific stubs ─────────────────────────────────────────────────────
vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      {actions}
    </div>
  ),
}));

vi.mock('../../components/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, onConfirm, title }: { isOpen: boolean; onConfirm: () => void; title: string }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onConfirm}>Confirm</button>
      </div>
    ) : null,
}));

vi.mock('../../components/MemberSearchPicker', () => ({
  MemberSearchPicker: ({ label, value, onValueChange }: { label: string; value: string; onValueChange: (v: string) => void }) => (
    <div data-testid="member-search-picker" data-value={value}>
      {label}
      <button onClick={() => onValueChange('42')}>pick-member-42</button>
    </div>
  ),
}));

// ─── Toast mock (hoisted so vi.mock closures see it) ─────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeNote = (overrides = {}) => ({
  id: 1,
  tenant_id: 2,
  user_id: 10,
  author_id: 5,
  content: 'Test note content',
  category: 'general',
  is_pinned: 0,
  created_at: '2025-01-15T10:00:00Z',
  updated_at: '2025-01-15T10:00:00Z',
  user_name: 'Alice Member',
  user_avatar: null,
  author_name: 'Admin User',
  ...overrides,
});

const makeNotesResponse = (data: object[] = [], meta = {}) => ({
  success: true,
  data,
  meta: {
    total: data.length,
    current_page: 1,
    per_page: 20,
    total_pages: 1,
    ...meta,
  },
});

const waitForLoaded = () =>
  waitFor(() => {
    const busy = screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeUndefined();
  });

const openActionsMenu = async () => {
  const trigger = screen.getAllByRole('button').find((b) =>
    /note actions|crm\.label_note_actions/i.test(b.getAttribute('aria-label') ?? '')
  );
  expect(trigger).toBeDefined();
  fireEvent.click(trigger!);
  await waitFor(() => {
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
describe('MemberNotes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.pushState({}, '', '/admin/crm/notes');
    mockCrm.getNotes.mockResolvedValue(makeNotesResponse());
    mockCrm.createNote.mockResolvedValue({ success: true, data: makeNote() });
    mockCrm.updateNote.mockResolvedValue({ success: true, data: makeNote() });
    mockCrm.deleteNote.mockResolvedValue({ success: true });
    mockCrm.exportNotes.mockResolvedValue(new Blob());
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('shows a loading spinner while notes are fetching', async () => {
    mockCrm.getNotes.mockImplementationOnce(() => new Promise(() => {}));
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders the empty state with an Add note action when nothing is filtered', async () => {
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitForLoaded();
    expect(screen.getByText(/no notes found/i)).toBeInTheDocument();
    // Header button + empty-state button both offer to add a note.
    expect(screen.getAllByRole('button', { name: /add note|crm\.add_note/i }).length).toBeGreaterThanOrEqual(2);
  });

  it('offers Clear filters in the empty state when a filter is active, and clearing resets the address', async () => {
    window.history.pushState({}, '', '/admin/crm/notes?category=support&q=garden');
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitForLoaded();
    expect(mockCrm.getNotes).toHaveBeenCalledWith(expect.objectContaining({ category: 'support', search: 'garden' }));

    const clearButtons = screen.getAllByRole('button', { name: /clear filters|crm\.clear_filters/i });
    expect(clearButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(clearButtons[clearButtons.length - 1]!);

    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
    await waitFor(() => {
      expect(mockCrm.getNotes).toHaveBeenLastCalledWith({ page: 1, limit: 20 });
    });
  });

  it('reads the member filter from ?user_id= so links from the CRM dashboard land filtered', async () => {
    window.history.pushState({}, '', '/admin/crm/notes?user_id=990006');
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitFor(() => {
      expect(mockCrm.getNotes).toHaveBeenCalledWith(expect.objectContaining({ user_id: '990006' }));
    });
    expect(screen.getByTestId('member-search-picker')).toHaveAttribute('data-value', '990006');
  });

  it('ignores an unknown category in the address instead of sending it to the API', async () => {
    window.history.pushState({}, '', '/admin/crm/notes?category=bogus');
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitForLoaded();
    expect(mockCrm.getNotes).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('puts the chosen member into the address when the picker changes', async () => {
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);
    await waitForLoaded();

    fireEvent.click(screen.getByText('pick-member-42'));

    await waitFor(() => {
      expect(window.location.search).toContain('user_id=42');
    });
    await waitFor(() => {
      expect(mockCrm.getNotes).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: '42' }));
    });
  });

  it('waits for a pause in typing before searching, then puts the search in the address', async () => {
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);
    await waitForLoaded();
    expect(mockCrm.getNotes).toHaveBeenCalledTimes(1);

    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'g' } });
    fireEvent.change(search, { target: { value: 'ga' } });
    fireEvent.change(search, { target: { value: 'gar' } });

    // Nothing has fired yet: the debounce is still running.
    expect(mockCrm.getNotes).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(mockCrm.getNotes).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'gar' }));
    });
    expect(mockCrm.getNotes).toHaveBeenCalledTimes(2);
    expect(window.location.search).toContain('q=gar');
  });

  it('renders note content, the member link, the author line and the category chip', async () => {
    mockCrm.getNotes.mockResolvedValue(makeNotesResponse([makeNote()]));
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitFor(() => {
      expect(screen.getByText('Test note content')).toBeInTheDocument();
    });
    const memberLink = screen.getByRole('link', { name: 'Alice Member' });
    expect(memberLink).toHaveAttribute('href', '/test/admin/users/10/edit');
    expect(screen.getByText(/Admin User/)).toBeInTheDocument();
    // The category appears twice: once as a filter toggle, once as the note's chip.
    expect(screen.getAllByText(/^general$|crm\.category_general/i).length).toBeGreaterThanOrEqual(2);
  });

  it('shows a results summary with the total from the API', async () => {
    mockCrm.getNotes.mockResolvedValue(makeNotesResponse([makeNote()], { total: 37 }));
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitFor(() => screen.getByText('Test note content'));
    expect(screen.getByText(/37/)).toBeInTheDocument();
  });

  it('shows a Pinned chip and an "edited" time only when they apply', async () => {
    mockCrm.getNotes.mockResolvedValue(
      makeNotesResponse([
        makeNote({ id: 2, is_pinned: 1, content: 'Pinned note', updated_at: '2025-02-01T09:00:00Z' }),
        makeNote({ id: 3, content: 'Plain note' }),
      ])
    );
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitFor(() => screen.getByText('Pinned note'));
    expect(screen.getAllByText(/^pinned$|crm\.pin_button_pinned/i)).toHaveLength(1);
    expect(screen.getAllByText(/edited|crm\.note_edited_on/i)).toHaveLength(1);
  });

  it('opens the create note modal when Add note is clicked', async () => {
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitFor(() => screen.getByText(/no notes found/i));

    fireEvent.click(screen.getAllByRole('button', { name: /add note|crm\.add_note/i })[0]!);

    await waitFor(() => {
      expect(document.querySelectorAll('[role="dialog"]').length).toBeGreaterThan(0);
    });
    // The create form asks for the member; the pin control is a switch.
    expect(screen.getAllByTestId('member-search-picker').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('opens the edit modal naming the member instead of asking for one again', async () => {
    mockCrm.getNotes.mockResolvedValue(makeNotesResponse([makeNote({ content: 'Editable', user_name: 'Bea Member' })]));
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitFor(() => screen.getByText('Editable'));
    await openActionsMenu();
    fireEvent.click(screen.getAllByRole('menuitem')[0]!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Bea Member/)).toBeInTheDocument();
    expect(within(dialog).queryByTestId('member-search-picker')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('textbox')).toHaveValue('Editable');
  });

  it('toggles the pin from the actions menu by sending only is_pinned', async () => {
    mockCrm.getNotes.mockResolvedValue(makeNotesResponse([makeNote({ id: 7, content: 'Pin me' })]));
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitFor(() => screen.getByText('Pin me'));
    await openActionsMenu();
    const pinItem = screen.getAllByRole('menuitem').find((el) => /pin note|crm\.note_action_pin/i.test(el.textContent ?? ''));
    expect(pinItem).toBeDefined();
    fireEvent.click(pinItem!);

    await waitFor(() => {
      expect(mockCrm.updateNote).toHaveBeenCalledWith(7, { is_pinned: true });
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('calls deleteNote and shows success toast on delete confirm', async () => {
    mockCrm.getNotes.mockResolvedValue(makeNotesResponse([makeNote({ id: 99 })]));
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitFor(() => screen.getByText('Test note content'));
    await openActionsMenu();
    const deleteItem = screen.getAllByRole('menuitem').find((el) => /delete note|crm\.note_action_delete/i.test(el.textContent ?? ''));
    expect(deleteItem).toBeDefined();
    fireEvent.click(deleteItem!);

    const confirmBtn = await screen.findByText('Confirm');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockCrm.deleteNote).toHaveBeenCalledWith(99);
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('exports the CSV through the authenticated client and reports a failure', async () => {
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole('button', { name: /export notes|crm\.export_notes/i }));
    await waitFor(() => expect(mockCrm.exportNotes).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());

    mockCrm.exportNotes.mockRejectedValueOnce(new Error('401'));
    fireEvent.click(screen.getByRole('button', { name: /export notes|crm\.export_notes/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('shows the empty state rather than crashing when getNotes fails', async () => {
    mockCrm.getNotes.mockRejectedValue(new Error('network error'));
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitForLoaded();
    expect(screen.queryByText('Test note content')).not.toBeInTheDocument();
    expect(screen.getByText(/no notes found/i)).toBeInTheDocument();
  });

  it('keeps the page number in the address and sends it to the API', async () => {
    window.history.pushState({}, '', '/admin/crm/notes?page=3');
    mockCrm.getNotes.mockResolvedValue(makeNotesResponse([makeNote()], { total: 60, current_page: 3, total_pages: 3 }));
    const { MemberNotes } = await import('./MemberNotes');
    render(<MemberNotes />);

    await waitFor(() => {
      expect(mockCrm.getNotes).toHaveBeenCalledWith(expect.objectContaining({ page: 3 }));
    });
    expect(screen.getByText('Test note content')).toBeInTheDocument();
  });
});
