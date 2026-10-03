// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The "safe" profile fields a broker may edit (names, phone, location,
 * tagline, bio). Role, status and e-mail are deliberately absent — the
 * backend refuses them for brokers too (AdminUsersController@update).
 * Extracted from MemberDetailModal unchanged in behaviour.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Pencil from 'lucide-react/icons/pencil';
import { Button, Input, Textarea } from '@/components/ui';
import { useToast } from '@/contexts';
import { adminUsers } from '@/admin/api/adminApi';
import type { AdminUserDetail } from '@/admin/api/types';

interface EditForm {
  first_name: string;
  last_name: string;
  phone: string;
  bio: string;
  tagline: string;
  location: string;
}

function formFrom(detail: AdminUserDetail): EditForm {
  return {
    first_name: detail.first_name ?? '',
    last_name: detail.last_name ?? '',
    phone: detail.phone ?? '',
    bio: detail.bio ?? '',
    tagline: detail.tagline ?? '',
    location: detail.location ?? '',
  };
}

interface MemberProfileEditorProps {
  detail: AdminUserDetail;
  /** Called after a successful save so the parent can reload the member. */
  onSaved: () => void | Promise<void>;
}

export function MemberProfileEditor({ detail, onSaved }: MemberProfileEditorProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<EditForm>(() => formFrom(detail));

  // A reload of the member (after any action) refreshes the form's baseline
  // and leaves edit mode, exactly as the modal did before the split.
  useEffect(() => {
    setForm(formFrom(detail));
    setEditing(false);
  }, [detail]);

  const save = useCallback(async () => {
    setBusy(true);
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
        await onSaved();
      } else {
        toast.error(res.error || t('member_detail.action_failed'));
      }
    } catch {
      toast.error(t('member_detail.action_failed'));
    } finally {
      setBusy(false);
    }
  }, [detail.id, form, toast, t, onSaved]);

  return (
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
          <Input size="sm" variant="bordered" label={t('member_detail.edit_phone')} value={form.phone} onValueChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder={t('member_detail.edit_phone_placeholder')} />
          <Input size="sm" variant="bordered" label={t('member_detail.edit_location')} value={form.location} onValueChange={(v) => setForm((f) => ({ ...f, location: v }))} />
          <Input size="sm" variant="bordered" label={t('member_detail.edit_tagline')} value={form.tagline} onValueChange={(v) => setForm((f) => ({ ...f, tagline: v }))} className="sm:col-span-2" />
          <Textarea size="sm" variant="bordered" label={t('member_detail.edit_bio')} value={form.bio} onValueChange={(v) => setForm((f) => ({ ...f, bio: v }))} minRows={2} className="sm:col-span-2" />
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" color="primary" isLoading={busy} onPress={() => void save()}>{t('member_detail.edit_save')}</Button>
            <Button size="sm" variant="flat" isDisabled={busy} onPress={() => setEditing(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">{detail.tagline || detail.bio || detail.location || '—'}</p>
      )}
    </div>
  );
}

export default MemberProfileEditor;
