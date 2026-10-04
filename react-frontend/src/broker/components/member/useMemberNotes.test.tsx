// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { crm, mockConfirm, mockToast } = vi.hoisted(() => ({
  crm: { getNotes: vi.fn(), createNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn() },
  mockConfirm: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({ adminCrm: crm }));
vi.mock('@/contexts', () => ({ useToast: () => mockToast }));
vi.mock('@/components/ui', () => ({ useConfirm: () => mockConfirm }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { useMemberNotes } from './useMemberNotes';

const note = { id: 7, content: 'Called about the garden job', category: 'outreach', is_pinned: false, created_at: '2026-10-01T09:00:00Z' };

describe('useMemberNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crm.getNotes.mockResolvedValue({ success: true, data: [note] });
    crm.createNote.mockResolvedValue({ success: true });
    crm.updateNote.mockResolvedValue({ success: true });
    crm.deleteNote.mockResolvedValue({ success: true });
    mockConfirm.mockResolvedValue(true);
  });

  it('does nothing without a member, then loads the member\'s notes (20, by id)', async () => {
    const { result, rerender } = renderHook(({ id }: { id: number | null }) => useMemberNotes(id), {
      initialProps: { id: null as number | null },
    });
    expect(crm.getNotes).not.toHaveBeenCalled();
    expect(result.current.notes).toEqual([]);

    rerender({ id: 5 });
    await waitFor(() => expect(crm.getNotes).toHaveBeenCalledWith({ user_id: 5, limit: 20 }));
    await waitFor(() => expect(result.current.notes).toEqual([note]));
    expect(result.current.error).toBe(false);
  });

  it('accepts both the bare array and the paged { data } envelope', async () => {
    crm.getNotes.mockResolvedValue({ success: true, data: { data: [note] } });
    const { result } = renderHook(() => useMemberNotes(5));
    await waitFor(() => expect(result.current.notes).toEqual([note]));
  });

  it('reports a failed load as an error, not as "no notes", and reload retries', async () => {
    crm.getNotes.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useMemberNotes(5));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.notes).toEqual([]);

    act(() => result.current.reload());
    // load() clears the error flag before the request resolves, so wait for
    // the data itself rather than for the flag to flip.
    await waitFor(() => expect(result.current.notes).toEqual([note]));
    expect(result.current.error).toBe(false);
    expect(crm.getNotes).toHaveBeenCalledTimes(2);
  });

  it('adds a trimmed note with its category, toasts, and refreshes the list', async () => {
    const { result } = renderHook(() => useMemberNotes(5));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok = false;
    await act(async () => { ok = await result.current.add('  Rang back  ', 'support'); });
    expect(ok).toBe(true);
    expect(crm.createNote).toHaveBeenCalledWith({ user_id: 5, content: 'Rang back', category: 'support' });
    expect(mockToast.success).toHaveBeenCalledWith('members.note_added');
    await waitFor(() => expect(crm.getNotes).toHaveBeenCalledTimes(2));
  });

  it('refuses to add an empty note without calling the API', async () => {
    const { result } = renderHook(() => useMemberNotes(5));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok = true;
    await act(async () => { ok = await result.current.add('   ', 'general'); });
    expect(ok).toBe(false);
    expect(crm.createNote).not.toHaveBeenCalled();
  });

  it('updates content and category together', async () => {
    const { result } = renderHook(() => useMemberNotes(5));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.update(7, { content: 'Edited', category: 'concern' }); });
    expect(crm.updateNote).toHaveBeenCalledWith(7, { content: 'Edited', category: 'concern' });
    expect(mockToast.success).toHaveBeenCalledWith('members.note_updated');
  });

  it('deleting asks a danger confirmation first and stops on "no"', async () => {
    mockConfirm.mockResolvedValue(false);
    const { result } = renderHook(() => useMemberNotes(5));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.remove(7); });
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'members.confirm_note_delete_title', status: 'danger' }));
    expect(crm.deleteNote).not.toHaveBeenCalled();
  });

  it('deletes after a "yes" and toasts', async () => {
    const { result } = renderHook(() => useMemberNotes(5));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.remove(7); });
    expect(crm.deleteNote).toHaveBeenCalledWith(7);
    expect(mockToast.success).toHaveBeenCalledWith('members.note_deleted');
  });

  it('toggles the pin and surfaces a failure as a toast', async () => {
    const { result } = renderHook(() => useMemberNotes(5));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.togglePin(note); });
    expect(crm.updateNote).toHaveBeenCalledWith(7, { is_pinned: true });

    crm.updateNote.mockResolvedValueOnce({ success: false });
    await act(async () => { await result.current.togglePin(note); });
    expect(mockToast.error).toHaveBeenCalledWith('members.action_failed');
  });

  it('clears the list when the member changes to none', async () => {
    const { result, rerender } = renderHook(({ id }: { id: number | null }) => useMemberNotes(id), {
      initialProps: { id: 5 as number | null },
    });
    await waitFor(() => expect(result.current.notes).toEqual([note]));
    rerender({ id: null });
    expect(result.current.notes).toEqual([]);
  });
});
