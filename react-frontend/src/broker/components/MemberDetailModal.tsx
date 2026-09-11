// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Member Detail Modal (broker panel)
 *
 * A single-member view giving brokers the operational actions the admin Users
 * area used to be needed for: approve/suspend/reactivate, resend verification,
 * send a password reset, reset 2FA, adjust the time balance, edit safe profile
 * fields, and review vetting / insurance / consent status. Privileged actions
 * (role/status change, ban, delete) are intentionally absent — the backend also
 * rejects them for brokers (see AdminUsersController@update).
 *
 * Organised into tabs: Overview (identity + membership timeline), Compliance
 * (vetting / insurance / consents), Notes (the CRM notes workflow), and
 * Actions (operational buttons + safe profile edit + balance adjustment).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField, Label, Input as HeroInput } from '@heroui/react';
import {
  Avatar, Button, Chip, Separator, Input, Textarea,
  Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter,
  Tabs, Tab, Tooltip, Select, SelectItem,
} from '@/components/ui';
import UserCheck from 'lucide-react/icons/user-check';
import UserX from 'lucide-react/icons/user-x';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import MailCheck from 'lucide-react/icons/mail-check';
import KeyRound from 'lucide-react/icons/key-round';
import ShieldOff from 'lucide-react/icons/shield-off';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Coins from 'lucide-react/icons/coins';
import Pencil from 'lucide-react/icons/pencil';
import IdCard from 'lucide-react/icons/id-card';
import StickyNote from 'lucide-react/icons/sticky-note';
import Wrench from 'lucide-react/icons/wrench';
import Pin from 'lucide-react/icons/pin';
import Trash2 from 'lucide-react/icons/trash-2';
import Check from 'lucide-react/icons/check';
import Send from 'lucide-react/icons/send';
import CheckCircle2 from 'lucide-react/icons/circle-check-big';
import Circle from 'lucide-react/icons/circle';
import { useToast } from '@/contexts';
import { adminUsers, adminTimebanking, adminVetting, adminInsurance, adminCrm } from '@/admin/api/adminApi';
import type { AdminUserDetail, VettingAttestation, InsuranceCertificate } from '@/admin/api/types';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { formatServerDate, formatServerDateTime } from '@/lib/serverTime';
import { BrokerStatusChip } from './BrokerStatusChip';
import { BrokerSkeleton } from './BrokerSkeleton';

type MemberDetail = AdminUserDetail;

interface ConsentRow {
  consent_type?: string;
  type?: string;
  name?: string;
  granted?: boolean;
  is_granted?: boolean;
  status?: string;
}

interface MemberNote {
  id: number;
  content: string;
  category?: string;
  is_pinned?: boolean;
  created_at: string;
  author_name?: string;
  author?: { name: string };
}

interface EditForm {
  first_name: string;
  last_name: string;
  phone: string;
  bio: string;
  tagline: string;
  location: string;
}

// CRM note categories — mirrors the admin MemberNotes module.
const NOTE_CATEGORIES = ['general', 'outreach', 'support', 'onboarding', 'concern', 'follow_up'] as const;

interface MemberDetailModalProps {
  userId: number | null;
  onClose: () => void;
  /** Called after any mutation so the parent list can refresh. */
  onChanged: () => void;
}

export function MemberDetailModal({ userId, onClose, onChanged }: MemberDetailModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();

  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [vetting, setVetting] = useState<VettingAttestation[]>([]);
  const [insurance, setInsurance] = useState<InsuranceCertificate[]>([]);
  const [consents, setConsents] = useState<ConsentRow[]>([]);
  // Which action is currently running (disables the relevant button).
  const [busy, setBusy] = useState<string | null>(null);
  const [resetReason, setResetReason] = useState('');

  // Edit form
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm>({ first_name: '', last_name: '', phone: '', bio: '', tagline: '', location: '' });

  // Balance adjustment sub-modal
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceReason, setBalanceReason] = useState('');

  // Notes workflow (categories / edit / delete / pin)
  const [notes, setNotes] = useState<MemberNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [noteCategory, setNoteCategory] = useState('general');
  const [addingNote, setAddingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [editingCategory, setEditingCategory] = useState('general');
  const [savingNote, setSavingNote] = useState(false);
  const [noteBusyId, setNoteBusyId] = useState<number | null>(null);

  const asArray = <T,>(payload: unknown): T[] => {
    if (Array.isArray(payload)) return payload as T[];
    if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
      return (payload as { data: T[] }).data;
    }
    return [];
  };

  const loadNotes = useCallback(async (id: number) => {
    setNotesLoading(true);
    try {
      const res = await adminCrm.getNotes({ user_id: id, limit: 20 });
      if (res?.success) setNotes(asArray<MemberNote>(res.data));
    } catch {
      // Notes are best-effort — failures shouldn't block the modal.
    } finally {
      setNotesLoading(false);
    }
  }, []);

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setEditing(false);
    setDetail(null);
    setVetting([]);
    setInsurance([]);
    setConsents([]);
    setNotes([]);
    setNewNote('');
    setNoteCategory('general');
    setEditingNoteId(null);
    try {
      const res = await adminUsers.get(id);
      if (res.success && res.data) {
        const d = res.data as MemberDetail;
        setDetail(d);
        setForm({
          first_name: d.first_name ?? '',
          last_name: d.last_name ?? '',
          phone: d.phone ?? '',
          bio: d.bio ?? '',
          tagline: d.tagline ?? '',
          location: d.location ?? '',
        });
      } else {
        toast.error(t('member_detail.load_failed'));
      }
    } catch {
      toast.error(t('member_detail.load_failed'));
    } finally {
      setLoading(false);
    }
    // Compliance + notes data is best-effort — failures shouldn't block the modal.
    try {
      const [v, i, c] = await Promise.all([
        adminVetting.getUserRecords(id).catch(() => null),
        adminInsurance.getUserCertificates(id).catch(() => null),
        adminUsers.getConsents(id).catch(() => null),
      ]);
      if (v?.success) setVetting(asArray<VettingAttestation>(v.data));
      if (i?.success) setInsurance(asArray<InsuranceCertificate>(i.data));
      if (c?.success) setConsents(asArray<ConsentRow>(c.data));
    } catch { /* ignore */ }
    loadNotes(id);
  }, [toast, t, loadNotes]);

  useEffect(() => {
    setResetReason('');
    if (userId != null) load(userId);
    // `load` is intentionally NOT a dependency: it closes over toast/t, which
    // are not guaranteed to be referentially stable, so keying the effect on
    // its identity would re-run on every render and loop. The member id is the
    // only thing that should trigger a (re)fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Generic action runner — refreshes the detail + parent list on success.
  const run = useCallback(async (
    key: string,
    fn: () => Promise<{ success?: boolean; error?: string }>,
    successKey: string,
    refetch = true,
  ) => {
    if (!detail) return;
    setBusy(key);
    try {
      const res = await fn();
      if (res?.success) {
        toast.success(t(successKey));
        onChanged();
        if (refetch) await load(detail.id);
      } else {
        toast.error(res?.error || t('member_detail.action_failed'));
      }
    } catch {
      toast.error(t('member_detail.action_failed'));
    } finally {
      setBusy(null);
    }
  }, [detail, toast, t, onChanged, load]);

  const handleSaveEdit = useCallback(async () => {
    if (!detail) return;
    setBusy('edit');
    try {
      const res = await adminUsers.update(detail.id, {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim(),
        bio: form.bio,
        tagline: form.tagline,
        location: form.location,
      });
      if (res.success) {
        toast.success(t('member_detail.edit_success'));
        setEditing(false);
        onChanged();
        await load(detail.id);
      } else {
        toast.error(res.error || t('member_detail.action_failed'));
      }
    } catch {
      toast.error(t('member_detail.action_failed'));
    } finally {
      setBusy(null);
    }
  }, [detail, form, toast, t, onChanged, load]);

  const handleAdjustBalance = useCallback(async () => {
    if (!detail) return;
    const amount = Number(balanceAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error(t('member_detail.balance_amount_invalid'));
      return;
    }
    if (!balanceReason.trim()) {
      toast.error(t('member_detail.balance_reason_required'));
      return;
    }
    setBusy('balance');
    try {
      const res = await adminTimebanking.adjustBalance(detail.id, amount, balanceReason.trim());
      if (res.success) {
        toast.success(t('member_detail.balance_success'));
        setBalanceOpen(false);
        setBalanceAmount('');
        setBalanceReason('');
        onChanged();
        await load(detail.id);
      } else {
        toast.error(res.error || t('member_detail.action_failed'));
      }
    } catch {
      toast.error(t('member_detail.action_failed'));
    } finally {
      setBusy(null);
    }
  }, [detail, balanceAmount, balanceReason, toast, t, onChanged, load]);

  // ─── Notes workflow ─────────────────────────────────────────────────────────

  const handleAddNote = useCallback(async () => {
    if (!detail || !newNote.trim()) return;
    setAddingNote(true);
    try {
      const res = await adminCrm.createNote({
        user_id: detail.id,
        content: newNote.trim(),
        category: noteCategory,
      });
      if (res.success) {
        toast.success(t('members.note_added'));
        setNewNote('');
        setNoteCategory('general');
        loadNotes(detail.id);
      } else {
        toast.error(t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setAddingNote(false);
    }
  }, [detail, newNote, noteCategory, toast, t, loadNotes]);

  const startEditNote = useCallback((note: MemberNote) => {
    setEditingNoteId(note.id);
    setEditingContent(note.content);
    setEditingCategory(note.category || 'general');
  }, []);

  const cancelEditNote = useCallback(() => {
    setEditingNoteId(null);
    setEditingContent('');
  }, []);

  const handleUpdateNote = useCallback(async () => {
    if (editingNoteId == null || !editingContent.trim() || !detail) return;
    setSavingNote(true);
    try {
      const res = await adminCrm.updateNote(editingNoteId, {
        content: editingContent.trim(),
        category: editingCategory,
      });
      if (res.success) {
        toast.success(t('members.note_updated'));
        setEditingNoteId(null);
        loadNotes(detail.id);
      } else {
        toast.error(t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setSavingNote(false);
    }
  }, [editingNoteId, editingContent, editingCategory, detail, toast, t, loadNotes]);

  const handleDeleteNote = useCallback(async (noteId: number) => {
    if (!detail) return;
    setNoteBusyId(noteId);
    try {
      const res = await adminCrm.deleteNote(noteId);
      if (res.success) {
        toast.success(t('members.note_deleted'));
        loadNotes(detail.id);
      } else {
        toast.error(t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setNoteBusyId(null);
    }
  }, [detail, toast, t, loadNotes]);

  const handleTogglePin = useCallback(async (note: MemberNote) => {
    if (!detail) return;
    setNoteBusyId(note.id);
    try {
      const res = await adminCrm.updateNote(note.id, { is_pinned: !note.is_pinned });
      if (res.success) {
        loadNotes(detail.id);
      } else {
        toast.error(t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setNoteBusyId(null);
    }
  }, [detail, toast, t, loadNotes]);

  const consentLabel = (c: ConsentRow) => c.consent_type || c.type || c.name || '';
  const consentGranted = (c: ConsentRow) => c.granted ?? c.is_granted ?? (c.status === 'granted' || c.status === 'active');

  return (
    <>
      <Modal isOpen={userId != null} onClose={onClose} size="2xl" scrollBehavior="inside">
        <ModalContent>
          {loading || !detail ? (
            <ModalBody>
              <BrokerSkeleton variant="detail" className="py-2" />
            </ModalBody>
          ) : (
            <>
              <ModalHeader className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3">
                <Avatar
                  src={resolveAvatarUrl(detail.avatar_url || detail.avatar) || undefined}
                  name={detail.name}
                  size="md"
                  className="row-span-2"
                />
                <ModalHeading className="min-w-0 truncate text-base font-semibold tracking-tight">
                  {detail.name}
                </ModalHeading>
                <div className="row-span-2 flex flex-wrap items-center gap-1">
                  <BrokerStatusChip status={detail.status} />
                  <Chip size="sm" variant="tertiary" color={detail.role === 'member' ? 'default' : 'accent'}>
                    {t(`members.role_${detail.role}`, { defaultValue: detail.role })}
                  </Chip>
                  <Chip size="sm" variant="tertiary" color={detail.email_verified_at ? 'success' : 'warning'}>
                    {detail.email_verified_at ? t('members.email_verified') : t('members.email_unverified')}
                  </Chip>
                </div>
                <p className="col-start-2 min-w-0 truncate text-xs font-normal text-muted">{detail.email}</p>
              </ModalHeader>

              <ModalBody className="gap-3">
                <Tabs
                  aria-label={t('member_detail.tabs_aria')}
                  variant="underlined"
                  size="sm"
                  defaultSelectedKey="overview"
                >
                  {/* ── Overview ──────────────────────────────────────────── */}
                  <Tab
                    key="overview"
                    title={
                      <div className="flex items-center gap-2">
                        <IdCard size={14} aria-hidden="true" />
                        <span>{t('member_detail.tab_overview')}</span>
                      </div>
                    }
                  >
                    <div className="space-y-4 pt-3">
                      <StatusTimeline detail={detail} />

                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Overview label={t('member_detail.label_balance')} value={`${typeof detail.balance === 'number' ? detail.balance.toLocaleString(getFormattingLocale()) : '0'} ${t('members.hours_short')}`} />
                        <Overview label={t('member_detail.label_joined')} value={formatServerDate(detail.created_at)} />
                        <Overview label={t('member_detail.label_last_active')} value={detail.last_active_at ? formatServerDate(detail.last_active_at) : t('members.time_never')} />
                        <Overview label={t('member_detail.label_onboarding')} value={detail.onboarding_completed ? t('member_detail.onboarding_complete') : t('member_detail.onboarding_incomplete')} />
                      </div>

                      {(detail.tagline || detail.bio || detail.location) && (
                        <p className="text-sm leading-6 text-muted">
                          {detail.tagline || detail.bio || detail.location}
                        </p>
                      )}
                    </div>
                  </Tab>

                  {/* ── Compliance ────────────────────────────────────────── */}
                  <Tab
                    key="compliance"
                    title={
                      <div className="flex items-center gap-2">
                        <ShieldCheck size={14} aria-hidden="true" />
                        <span>{t('member_detail.tab_compliance')}</span>
                      </div>
                    }
                  >
                    <div className="space-y-4 pt-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Overview
                          label={t('member_detail.label_contact_attestation')}
                          value={t(`vetting.filter_${vetting[0]?.decision ?? 'not_confirmed'}`)}
                        />
                        <Overview label={t('member_detail.label_insurance')} value={t(`member_detail.compliance_${detail.insurance_status ?? 'none'}`, { defaultValue: detail.insurance_status ?? '—' })} />
                      </div>

                      <ComplianceList
                        title={t('member_detail.contact_attestations_title')}
                        empty={t('member_detail.contact_attestations_none')}
                        items={vetting.map((v) => ({
                          key: `v-${v.id}`,
                          label: t(`vetting.attestation_${v.attestation_code}`, { defaultValue: t('vetting.attestation_other') }),
                          status: v.decision,
                          expiry: null,
                        }))}
                      />
                      <ComplianceList
                        title={t('member_detail.insurance_title')}
                        empty={t('member_detail.insurance_none')}
                        items={insurance.map((i) => ({
                          key: `i-${i.id}`,
                          label: t(`insurance.type_${i.insurance_type}`, { defaultValue: i.insurance_type }),
                          status: i.status,
                          expiry: i.expiry_date ?? null,
                        }))}
                      />
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{t('member_detail.consents_title')}</p>
                        {consents.length === 0 ? (
                          <p className="text-sm text-muted">{t('member_detail.consents_none')}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {consents.map((c, idx) => (
                              <Chip key={`c-${idx}`} size="sm" variant="tertiary" color={consentGranted(c) ? 'success' : 'default'}>
                                {consentLabel(c) || t('member_detail.consent_generic')}
                              </Chip>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </Tab>

                  {/* ── Notes ─────────────────────────────────────────────── */}
                  <Tab
                    key="notes"
                    title={
                      <div className="flex items-center gap-2">
                        <StickyNote size={14} aria-hidden="true" />
                        <span>{t('members.notes')}</span>
                        {notes.length > 0 && (
                          <Chip size="sm" variant="soft" color="accent" className="tabular-nums">
                            {notes.length}
                          </Chip>
                        )}
                      </div>
                    }
                  >
                    <div className="space-y-3 pt-3">
                      {/* Add note */}
                      <div className="space-y-2">
                        <Select
                          aria-label={t('members.note_category_label')}
                          size="sm"
                          variant="bordered"
                          selectedKeys={[noteCategory]}
                          onSelectionChange={(keys) => setNoteCategory((Array.from(keys)[0] as string) ?? 'general')}
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
                            isLoading={addingNote}
                            isDisabled={!newNote.trim()}
                            onPress={handleAddNote}
                            className="self-end"
                            aria-label={t('members.send_note')}
                          >
                            <Send size={16} />
                          </Button>
                        </div>
                      </div>

                      {/* Notes list — pinned first */}
                      {notesLoading ? (
                        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="py-6 text-center text-sm text-muted">
                          {t('common.loading')}
                        </div>
                      ) : notes.length === 0 ? (
                        <div className="py-6 text-center text-muted">
                          <StickyNote size={28} className="mx-auto mb-2 opacity-30" aria-hidden="true" />
                          <p className="text-sm">{t('members.no_notes')}</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {[...notes].sort((a, b) => Number(b.is_pinned ?? false) - Number(a.is_pinned ?? false)).map((note) => (
                            <div key={note.id} className={`rounded-xl p-3 ${note.is_pinned ? 'border border-accent/20 bg-accent/10' : 'bg-surface-secondary'}`}>
                              {editingNoteId === note.id ? (
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
                                    <Button size="sm" color="primary" isLoading={savingNote} isDisabled={!editingContent.trim()} startContent={<Check size={14} />} onPress={handleUpdateNote}>
                                      {t('members.note_save')}
                                    </Button>
                                    <Button size="sm" variant="flat" isDisabled={savingNote} onPress={cancelEditNote}>
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
                                        <Button isIconOnly size="sm" variant="light" isLoading={noteBusyId === note.id} onPress={() => handleTogglePin(note)} aria-label={note.is_pinned ? t('members.note_unpin') : t('members.note_pin')}>
                                          <Pin size={13} className={note.is_pinned ? 'fill-current text-accent' : 'text-muted'} />
                                        </Button>
                                      </Tooltip>
                                      <Tooltip content={t('members.note_edit')}>
                                        <Button isIconOnly size="sm" variant="light" onPress={() => startEditNote(note)} aria-label={t('members.note_edit')}>
                                          <Pencil size={13} className="text-muted" />
                                        </Button>
                                      </Tooltip>
                                      <Tooltip content={t('members.note_delete')}>
                                        <Button isIconOnly size="sm" variant="light" color="danger" isLoading={noteBusyId === note.id} onPress={() => handleDeleteNote(note.id)} aria-label={t('members.note_delete')}>
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
                  </Tab>

                  {/* ── Actions ───────────────────────────────────────────── */}
                  <Tab
                    key="actions"
                    title={
                      <div className="flex items-center gap-2">
                        <Wrench size={14} aria-hidden="true" />
                        <span>{t('member_detail.section_actions')}</span>
                      </div>
                    }
                  >
                    <div className="space-y-4 pt-3">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t('member_detail.section_actions')}</p>
                        <div className="flex flex-wrap gap-2">
                          {detail.status === 'pending' && (
                            <Button size="sm" color="success" variant="flat" startContent={<UserCheck size={14} />} isLoading={busy === 'approve'}
                              onPress={() => run('approve', () => adminUsers.approve(detail.id), 'member_detail.approve_success')}>
                              {t('members.approve')}
                            </Button>
                          )}
                          {detail.status === 'active' && (
                            <Button size="sm" color="danger" variant="flat" startContent={<UserX size={14} />} isLoading={busy === 'suspend'}
                              onPress={() => run('suspend', () => adminUsers.suspend(detail.id), 'member_detail.suspend_success')}>
                              {t('members.suspend')}
                            </Button>
                          )}
                          {detail.status === 'suspended' && (
                            <Button size="sm" variant="tertiary" startContent={<RotateCcw size={14} />} isLoading={busy === 'reactivate'}
                              onPress={() => run('reactivate', () => adminUsers.reactivate(detail.id), 'member_detail.reactivate_success')}>
                              {t('members.reactivate')}
                            </Button>
                          )}
                          <Button size="sm" variant="tertiary" startContent={<MailCheck size={14} />} isLoading={busy === 'verify'}
                            onPress={() => run('verify', () => adminUsers.sendVerificationEmail(detail.id), 'member_detail.verification_sent', false)}>
                            {t('member_detail.action_resend_verification')}
                          </Button>
                          <Button size="sm" variant="tertiary" startContent={<KeyRound size={14} />} isLoading={busy === 'pwd'}
                            onPress={() => run('pwd', () => adminUsers.sendPasswordReset(detail.id), 'member_detail.password_reset_sent', false)}>
                            {t('member_detail.action_send_password_reset')}
                          </Button>
                          <TextField value={resetReason} onChange={setResetReason}>
                            <Label>{t('users.reset_2fa_identity_reason', { ns: 'admin_users' })}</Label>
                            <HeroInput minLength={10} maxLength={500} />
                          </TextField>
                          <Button size="sm" variant="tertiary" startContent={<ShieldOff size={14} />} isLoading={busy === '2fa'} isDisabled={resetReason.trim().length < 10}
                            onPress={() => run('2fa', () => adminUsers.reset2fa(detail.id, resetReason.trim()), 'member_detail.reset_2fa_success', false)}>
                            {t('member_detail.action_reset_2fa')}
                          </Button>
                          <Button size="sm" color="primary" variant="flat" startContent={<Coins size={14} />}
                            onPress={() => { setBalanceAmount(''); setBalanceReason(''); setBalanceOpen(true); }}>
                            {t('member_detail.action_adjust_balance')}
                          </Button>
                        </div>
                      </div>

                      <Separator />

                      {/* Edit profile */}
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t('member_detail.section_edit')}</p>
                          {!editing && (
                            <Button size="sm" variant="light" startContent={<Pencil size={14} />} onPress={() => setEditing(true)}>
                              {t('member_detail.edit_toggle')}
                            </Button>
                          )}
                        </div>
                        {editing ? (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Input size="sm" variant="bordered" label={t('member_detail.edit_first_name')} value={form.first_name} onValueChange={(v) => setForm((f) => ({ ...f, first_name: v }))} />
                            <Input size="sm" variant="bordered" label={t('member_detail.edit_last_name')} value={form.last_name} onValueChange={(v) => setForm((f) => ({ ...f, last_name: v }))} />
                            <Input size="sm" variant="bordered" label={t('member_detail.edit_phone')} value={form.phone} onValueChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="+1 555 123 4567" />
                            <Input size="sm" variant="bordered" label={t('member_detail.edit_location')} value={form.location} onValueChange={(v) => setForm((f) => ({ ...f, location: v }))} />
                            <Input size="sm" variant="bordered" label={t('member_detail.edit_tagline')} value={form.tagline} onValueChange={(v) => setForm((f) => ({ ...f, tagline: v }))} className="sm:col-span-2" />
                            <Textarea size="sm" variant="bordered" label={t('member_detail.edit_bio')} value={form.bio} onValueChange={(v) => setForm((f) => ({ ...f, bio: v }))} minRows={2} className="sm:col-span-2" />
                            <div className="flex gap-2 sm:col-span-2">
                              <Button size="sm" color="primary" isLoading={busy === 'edit'} onPress={handleSaveEdit}>{t('member_detail.edit_save')}</Button>
                              <Button size="sm" variant="flat" isDisabled={busy === 'edit'} onPress={() => setEditing(false)}>{t('common.cancel')}</Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted">{detail.tagline || detail.bio || detail.location || '—'}</p>
                        )}
                      </div>
                    </div>
                  </Tab>
                </Tabs>
              </ModalBody>

              <ModalFooter>
                <Button variant="flat" onPress={onClose}>{t('member_detail.close')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Balance adjustment sub-modal */}
      <Modal isOpen={balanceOpen} onClose={() => setBalanceOpen(false)} size="sm">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Coins size={18} className="text-primary" />
            {t('member_detail.balance_modal_title')}
          </ModalHeader>
          <ModalBody className="gap-3">
            <Input
              type="number"
              variant="bordered"
              label={t('member_detail.balance_amount_label')}
              description={t('member_detail.balance_amount_help')}
              value={balanceAmount}
              onValueChange={setBalanceAmount}
              placeholder="0"
            />
            <Textarea
              variant="bordered"
              label={t('member_detail.balance_reason_label')}
              placeholder={t('member_detail.balance_reason_placeholder')}
              value={balanceReason}
              onValueChange={setBalanceReason}
              minRows={2}
              isRequired
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" isDisabled={busy === 'balance'} onPress={() => setBalanceOpen(false)}>{t('common.cancel')}</Button>
            <Button color="primary" isLoading={busy === 'balance'} onPress={handleAdjustBalance}>{t('member_detail.balance_submit')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

/**
 * Membership journey strip: registered → email verified → approved.
 * Built purely from fields the modal already loads — no extra requests.
 */
function StatusTimeline({ detail }: { detail: MemberDetail }) {
  const { t } = useTranslation('broker');
  const steps: { key: string; label: string; done: boolean; date: string | null }[] = [
    { key: 'registered', label: t('member_detail.timeline_registered'), done: true, date: detail.created_at ?? null },
    { key: 'email_verified', label: t('member_detail.timeline_email_verified'), done: !!detail.email_verified_at, date: detail.email_verified_at ?? null },
    // Suspended/banned members were approved at some point — only a literal
    // 'pending' status means the approval step hasn't happened yet.
    { key: 'approved', label: t('member_detail.timeline_approved'), done: detail.status !== 'pending', date: null },
  ];

  return (
    <ol
      aria-label={t('member_detail.timeline_title')}
      className="flex items-center rounded-xl bg-surface-secondary px-3 py-2.5"
    >
      {steps.map((step, i) => (
        <li key={step.key} className={`flex min-w-0 items-center ${i > 0 ? 'flex-1' : ''}`}>
          {i > 0 && (
            <span
              aria-hidden="true"
              className={`mx-2 h-px flex-1 ${step.done ? 'bg-success/50' : 'bg-divider'}`}
            />
          )}
          <span className="flex shrink-0 items-center gap-1.5">
            {step.done ? (
              <CheckCircle2 size={15} className="text-success" aria-hidden="true" />
            ) : (
              <Circle size={15} className="text-muted/60" aria-hidden="true" />
            )}
            <span className={`text-xs font-medium ${step.done ? 'text-foreground' : 'text-muted'}`}>
              {step.label}
            </span>
            {step.done && step.date && (
              <span className="hidden text-xs tabular-nums text-muted sm:inline">
                {formatServerDate(step.date)}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Overview({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-secondary p-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

interface ComplianceItem { key: string; label: string; status?: string; expiry: string | null }

function ComplianceList({ title, empty, items }: { title: string; empty: string; items: ComplianceItem[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="space-y-1">
          {items.map((it) => (
            <div key={it.key} className="flex items-center justify-between rounded-md bg-surface-secondary px-2.5 py-1.5 text-sm">
              <span className="truncate">{it.label}</span>
              <span className="flex items-center gap-2">
                {it.status && <BrokerStatusChip status={it.status} />}
                {it.expiry && <span className="text-xs tabular-nums text-muted">{formatServerDateTime(it.expiry)}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MemberDetailModal;
