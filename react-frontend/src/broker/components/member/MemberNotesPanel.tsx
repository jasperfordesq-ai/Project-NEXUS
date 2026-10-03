// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The notes workflow for one member: add a categorised note, then the list
 * (pinned first) with inline edit, pin and delete. Purely presentational —
 * data and confirmations come from `useMemberNotes`, so the Members page's
 * notes modal and the member window's Notes tab render exactly the same thing.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import StickyNote from 'lucide-react/icons/sticky-note';
import Pin from 'lucide-react/icons/pin';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import Check from 'lucide-react/icons/check';
import Send from 'lucide-react/icons/send';
import { Button, Chip, Select, SelectItem, Spinner, Textarea, Tooltip } from '@/components/ui';
import { formatServerDateTime } from '@/lib/serverTime';
import { BrokerEmptyState } from '../BrokerEmptyState';
import { NOTE_CATEGORIES, type MemberNote, type MemberNotesState } from './useMemberNotes';

interface MemberNotesPanelProps {
  state: MemberNotesState;
  className?: string;
}

export function MemberNotesPanel({ state, className = '' }: MemberNotesPanelProps) {
  const { t } = useTranslation('broker');
  const { notes, loading, error, adding, saving, busyId, reload, add, update, remove, togglePin } = state;

  const [newNote, setNewNote] = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [editingCategory, setEditingCategory] = useState('general');

  const handleAdd = async () => {
    if (await add(newNote, newCategory)) {
      setNewNote('');
      setNewCategory('general');
    }
  };

  const startEdit = (note: MemberNote) => {
    setEditingId(note.id);
    setEditingContent(note.content);
    setEditingCategory(note.category || 'general');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingContent('');
  };

  const handleUpdate = async () => {
    if (editingId == null) return;
    if (await update(editingId, { content: editingContent, category: editingCategory })) {
      setEditingId(null);
    }
  };

  const sorted = [...notes].sort((a, b) => Number(b.is_pinned ?? false) - Number(a.is_pinned ?? false));

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Add note */}
      <div className="space-y-2">
        <Select
          aria-label={t('members.note_category_label')}
          size="sm"
          variant="bordered"
          selectedKeys={[newCategory]}
          onSelectionChange={(keys) => setNewCategory((Array.from(keys)[0] as string) ?? 'general')}
          className="max-w-[220px]"
        >
          {NOTE_CATEGORIES.map((cat) => (
            <SelectItem key={cat} id={cat}>{t(`members.note_category_${cat}`)}</SelectItem>
          ))}
        </Select>
        <div className="flex gap-2">
          <Textarea
            placeholder={t('members.note_placeholder')}
            value={newNote}
            onValueChange={setNewNote}
            minRows={2}
            maxRows={4}
            className="flex-1"
          />
          <Button
            color="primary"
            isIconOnly
            isLoading={adding}
            isDisabled={!newNote.trim()}
            onPress={handleAdd}
            className="self-end"
            aria-label={t('members.send_note')}
          >
            <Send size={16} />
          </Button>
        </div>
      </div>

      {/* Notes list — pinned first */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner size="sm" aria-label={t('common.loading')} />
        </div>
      ) : error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <span>{t('members.notes_load_failed')}</span>
          <Button size="sm" variant="tertiary" onPress={reload}>
            {t('members.retry')}
          </Button>
        </div>
      ) : notes.length === 0 ? (
        <BrokerEmptyState bare icon={StickyNote} color="neutral" title={t('members.no_notes')} />
      ) : (
        <div className="mt-2 space-y-3">
          {sorted.map((note) => (
            <div key={note.id} className={`rounded-xl p-3 ${note.is_pinned ? 'border border-accent/20 bg-accent/10' : 'bg-surface-secondary'}`}>
              {editingId === note.id ? (
                <div className="space-y-2">
                  <Select
                    aria-label={t('members.note_category_label')}
                    size="sm"
                    variant="bordered"
                    selectedKeys={[editingCategory]}
                    onSelectionChange={(keys) => setEditingCategory((Array.from(keys)[0] as string) ?? 'general')}
                    className="max-w-[220px]"
                  >
                    {NOTE_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} id={cat}>{t(`members.note_category_${cat}`)}</SelectItem>
                    ))}
                  </Select>
                  <Textarea value={editingContent} onValueChange={setEditingContent} minRows={2} maxRows={5} variant="bordered" />
                  <div className="flex gap-2">
                    <Button size="sm" color="primary" isLoading={saving} isDisabled={!editingContent.trim()} startContent={<Check size={14} />} onPress={handleUpdate}>
                      {t('members.note_save')}
                    </Button>
                    <Button size="sm" variant="flat" isDisabled={saving} onPress={cancelEdit}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1 whitespace-pre-wrap text-sm text-foreground">{note.content}</p>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Tooltip content={note.is_pinned ? t('members.note_unpin') : t('members.note_pin')}>
                        <Button isIconOnly size="sm" variant="light" isLoading={busyId === note.id} onPress={() => void togglePin(note)} aria-label={note.is_pinned ? t('members.note_unpin') : t('members.note_pin')}>
                          <Pin size={13} className={note.is_pinned ? 'fill-current text-accent' : 'text-muted'} />
                        </Button>
                      </Tooltip>
                      <Tooltip content={t('members.note_edit')}>
                        <Button isIconOnly size="sm" variant="light" onPress={() => startEdit(note)} aria-label={t('members.note_edit')}>
                          <Pencil size={13} className="text-muted" />
                        </Button>
                      </Tooltip>
                      <Tooltip content={t('members.note_delete')}>
                        <Button isIconOnly size="sm" variant="light" color="danger" isLoading={busyId === note.id} onPress={() => void remove(note.id)} aria-label={t('members.note_delete')}>
                          <Trash2 size={13} />
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{note.author_name || note.author?.name || t('members.note_system_author')}</span>
                    <span>&middot;</span>
                    <span className="tabular-nums">{formatServerDateTime(note.created_at)}</span>
                    {note.category && (
                      <Chip size="sm" variant="tertiary" className="text-xs">{t(`members.note_category_${note.category}`, { defaultValue: note.category })}</Chip>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MemberNotesPanel;
