// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';

vi.mock('@/lib/serverTime', () => ({
  formatServerDateTime: (s: string) => (s ? `datetime:${s}` : ''),
  formatServerDate: (s: string) => (s ? `date:${s}` : ''),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { MemberNotesPanel } from './MemberNotesPanel';
import type { MemberNotesState } from './useMemberNotes';

function makeState(overrides: Partial<MemberNotesState> = {}): MemberNotesState {
  return {
    notes: [],
    loading: false,
    error: false,
    adding: false,
    saving: false,
    busyId: null,
    reload: vi.fn(),
    add: vi.fn(async () => true),
    update: vi.fn(async () => true),
    remove: vi.fn(async () => undefined),
    togglePin: vi.fn(async () => undefined),
    ...overrides,
  };
}

const pinned = { id: 1, content: 'Pinned note', is_pinned: true, created_at: '2026-09-01T09:00:00Z', author_name: 'Broker B' };
const plain = { id: 2, content: 'Plain note', category: 'outreach', is_pinned: false, created_at: '2026-10-01T09:00:00Z' };

describe('MemberNotesPanel', () => {
  it('shows a spinner while loading', () => {
    render(<MemberNotesPanel state={makeState({ loading: true })} />);
    expect(screen.getByLabelText('common.loading')).toBeInTheDocument();
  });

  it('shows the failure with a Retry that reloads, never "no notes"', () => {
    const state = makeState({ error: true });
    render(<MemberNotesPanel state={state} />);
    expect(screen.getByRole('alert')).toHaveTextContent('members.notes_load_failed');
    expect(screen.queryByText('members.no_notes')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'members.retry' }));
    expect(state.reload).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when there are no notes', () => {
    render(<MemberNotesPanel state={makeState()} />);
    expect(screen.getByText('members.no_notes')).toBeInTheDocument();
  });

  it('lists pinned notes first with author, time and category', () => {
    render(<MemberNotesPanel state={makeState({ notes: [plain, pinned] })} />);
    const texts = screen.getAllByText(/note$/).map((el) => el.textContent);
    expect(texts).toEqual(['Pinned note', 'Plain note']);
    expect(screen.getByText('Broker B')).toBeInTheDocument();
    expect(screen.getByText('members.note_system_author')).toBeInTheDocument();
    expect(screen.getByText('datetime:2026-10-01T09:00:00Z')).toBeInTheDocument();
    // The category chip on the note (the add-form Select lists the same label).
    expect(screen.getAllByText('members.note_category_outreach').length).toBeGreaterThanOrEqual(1);
  });

  it('sends a new note with its category and clears the box on success', async () => {
    const state = makeState();
    render(<MemberNotesPanel state={state} />);
    const box = screen.getByPlaceholderText('members.note_placeholder');
    const send = screen.getByRole('button', { name: 'members.send_note' });
    expect(send).toBeDisabled();

    fireEvent.change(box, { target: { value: 'Rang back today' } });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);

    await waitFor(() => expect(state.add).toHaveBeenCalledWith('Rang back today', 'general'));
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''));
  });

  it('edits a note inline and saves content + category', async () => {
    const state = makeState({ notes: [plain] });
    render(<MemberNotesPanel state={state} />);
    fireEvent.click(screen.getByRole('button', { name: 'members.note_edit' }));

    const editor = screen.getByDisplayValue('Plain note');
    fireEvent.change(editor, { target: { value: 'Plain note, amended' } });
    fireEvent.click(screen.getByRole('button', { name: 'members.note_save' }));

    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith(2, { content: 'Plain note, amended', category: 'outreach' }),
    );
  });

  it('pin and delete go through the hook (which owns the confirmation)', () => {
    const state = makeState({ notes: [plain] });
    render(<MemberNotesPanel state={state} />);
    fireEvent.click(screen.getByRole('button', { name: 'members.note_pin' }));
    expect(state.togglePin).toHaveBeenCalledWith(plain);
    fireEvent.click(screen.getByRole('button', { name: 'members.note_delete' }));
    expect(state.remove).toHaveBeenCalledWith(2);
  });
});
