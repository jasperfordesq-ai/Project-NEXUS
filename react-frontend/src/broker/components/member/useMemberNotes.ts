// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One member's CRM notes: list, add, edit, delete (confirmed), pin.
 *
 * Until October 2026 this logic existed twice — once in the Members page's
 * notes modal and once in the member window's Notes tab — and the two copies
 * had already drifted (one reported a failed load, the other showed "no notes
 * yet"). Both now use this hook, and `MemberNotesPanel` renders it.
 *
 * Loads when `userId` becomes a number; resets when it changes or turns null.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { useConfirm } from '@/components/ui';
import { adminCrm } from '@/admin/api/adminApi';

export interface MemberNote {
  id: number;
  content: string;
  category?: string;
  is_pinned?: boolean;
  created_at: string;
  author_name?: string;
  author?: { name: string };
}

// CRM note categories — mirrors the admin MemberNotes module.
export const NOTE_CATEGORIES = ['general', 'outreach', 'support', 'onboarding', 'concern', 'follow_up'] as const;

export interface MemberNotesState {
  notes: MemberNote[];
  loading: boolean;
  /** The list could not be loaded. Distinct from "no notes yet" on purpose. */
  error: boolean;
  adding: boolean;
  saving: boolean;
  /** Id of the note a pin/delete is running for (disables its buttons). */
  busyId: number | null;
  reload: () => void;
  add: (content: string, category: string) => Promise<boolean>;
  update: (noteId: number, changes: { content: string; category: string }) => Promise<boolean>;
  remove: (noteId: number) => Promise<void>;
  togglePin: (note: MemberNote) => Promise<void>;
}

function asNotes(payload: unknown): MemberNote[] {
  if (Array.isArray(payload)) return payload as MemberNote[];
  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as MemberNote[];
  }
  return [];
}

export function useMemberNotes(userId: number | null | undefined): MemberNotesState {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const confirm = useConfirm();

  const [notes, setNotes] = useState<MemberNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setError(false);
    try {
      const res = await adminCrm.getNotes({ user_id: id, limit: 20 });
      if (res?.success) {
        setNotes(asNotes(res.data));
      } else {
        setError(true);
      }
    } catch {
      // An empty list would read as "no notes yet" — say that it failed instead.
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setNotes([]);
    setError(false);
    if (typeof userId === 'number') void load(userId);
  }, [userId, load]);

  const reload = useCallback(() => {
    if (typeof userId === 'number') void load(userId);
  }, [userId, load]);

  const add = useCallback(async (content: string, category: string) => {
    if (typeof userId !== 'number' || !content.trim()) return false;
    setAdding(true);
    try {
      const res = await adminCrm.createNote({ user_id: userId, content: content.trim(), category });
      if (res.success) {
        toast.success(t('members.note_added'));
        void load(userId);
        return true;
      }
      toast.error(t('members.action_failed'));
      return false;
    } catch {
      toast.error(t('members.action_failed'));
      return false;
    } finally {
      setAdding(false);
    }
  }, [userId, load, toast, t]);

  const update = useCallback(async (noteId: number, changes: { content: string; category: string }) => {
    if (typeof userId !== 'number' || !changes.content.trim()) return false;
    setSaving(true);
    try {
      const res = await adminCrm.updateNote(noteId, { content: changes.content.trim(), category: changes.category });
      if (res.success) {
        toast.success(t('members.note_updated'));
        void load(userId);
        return true;
      }
      toast.error(t('members.action_failed'));
      return false;
    } catch {
      toast.error(t('members.action_failed'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [userId, load, toast, t]);

  const remove = useCallback(async (noteId: number) => {
    if (typeof userId !== 'number') return;
    const ok = await confirm({
      title: t('members.confirm_note_delete_title'),
      body: t('members.confirm_note_delete_message'),
      confirmLabel: t('members.note_delete'),
      status: 'danger',
    });
    if (!ok) return;
    setBusyId(noteId);
    try {
      const res = await adminCrm.deleteNote(noteId);
      if (res.success) {
        toast.success(t('members.note_deleted'));
        void load(userId);
      } else {
        toast.error(t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setBusyId(null);
    }
  }, [userId, confirm, load, toast, t]);

  const togglePin = useCallback(async (note: MemberNote) => {
    if (typeof userId !== 'number') return;
    setBusyId(note.id);
    try {
      const res = await adminCrm.updateNote(note.id, { is_pinned: !note.is_pinned });
      if (res.success) {
        void load(userId);
      } else {
        toast.error(t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setBusyId(null);
    }
  }, [userId, load, toast, t]);

  return { notes, loading, error, adding, saving, busyId, reload, add, update, remove, togglePin };
}

export default useMemberNotes;
