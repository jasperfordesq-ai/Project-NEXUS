// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Add a member to monitoring, or edit an existing record. `setMonitoring`
 * upserts server-side, so an edit is the same call with the existing
 * user_id. On edit, a reason-only change preserves the record's remaining
 * expiry rather than silently clearing it.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Eye from 'lucide-react/icons/eye';
import Pencil from 'lucide-react/icons/pencil';
import UserPlus from 'lucide-react/icons/user-plus';
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Switch,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/contexts';
import { formatServerDate } from '@/lib/serverTime';
import { adminBroker } from '@/admin/api/adminApi';
import { MemberSearchPicker, type MemberSearchMember } from '@/admin/components';
import type { MonitoredUser } from '@/admin/api/types';
import { DURATION_OPTIONS, remainingDays } from './monitoringShared';

interface MonitoringFormModalProps {
  isOpen: boolean;
  /** The record being edited, or null to add someone new. */
  editingItem: MonitoredUser | null;
  onClose: () => void;
  /** Called after a successful add or edit. */
  onSaved: () => void;
}

export function MonitoringFormModal({ isOpen, editingItem, onClose, onSaved }: MonitoringFormModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [memberId, setMemberId] = useState('');
  const [member, setMember] = useState<MemberSearchMember | null>(null);
  const [reason, setReason] = useState('');
  const [messagingDisabled, setMessagingDisabled] = useState(false);
  const [expiresDays, setExpiresDays] = useState('');
  const [originalExpiresDays, setOriginalExpiresDays] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMemberId('');
    setMember(null);
    if (editingItem) {
      setReason(editingItem.monitoring_reason || '');
      setMessagingDisabled(!!editingItem.messaging_disabled);
      const remaining = remainingDays(editingItem);
      setOriginalExpiresDays(remaining);
      // Only reflect it in the Select when it maps to a preset option.
      setExpiresDays(
        remaining !== null && (DURATION_OPTIONS as readonly string[]).includes(String(remaining))
          ? String(remaining)
          : '',
      );
    } else {
      setReason('');
      setMessagingDisabled(false);
      setOriginalExpiresDays(null);
      setExpiresDays('');
    }
  }, [isOpen, editingItem]);

  const targetUserId = editingItem ? editingItem.user_id : memberId ? Number(memberId) : null;

  const handleSubmit = async () => {
    if (!targetUserId) {
      toast.error(t('monitoring.select_user_required'));
      return;
    }
    if (!reason.trim()) {
      toast.error(t('monitoring.reason_required'));
      return;
    }
    // On edit, if the broker didn't pick a preset duration, preserve the
    // record's existing remaining expiry (or leave it open if it had none).
    const effectiveExpiresDays = expiresDays
      ? Number(expiresDays)
      : editingItem
        ? originalExpiresDays
        : null;
    setSaving(true);
    try {
      const res = await adminBroker.setMonitoring(targetUserId, {
        under_monitoring: true,
        reason,
        messaging_disabled: messagingDisabled,
        ...(effectiveExpiresDays ? { expires_days: effectiveExpiresDays } : {}),
      });
      if (res?.success) {
        toast.success(editingItem ? t('monitoring.edit_success') : t('monitoring.add_success'));
        onSaved();
        onClose();
      } else {
        toast.error(res?.error || t('monitoring.add_failed'));
      }
    } catch {
      toast.error(t('monitoring.add_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          {editingItem
            ? <Pencil size={20} className="text-accent" aria-hidden="true" />
            : <UserPlus size={20} className="text-accent" aria-hidden="true" />}
          {editingItem ? t('monitoring.modal_edit_title') : t('monitoring.modal_title')}
        </ModalHeader>
        <ModalBody>
          {editingItem ? (
            <div className="flex items-center gap-3 rounded-lg border border-divider bg-surface-secondary p-3">
              <Eye size={18} className="shrink-0 text-warning" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{editingItem.user_name}</p>
                <p className="text-xs text-muted">{t('monitoring.member_label')}</p>
              </div>
            </div>
          ) : (
            <MemberSearchPicker
              value={memberId}
              onValueChange={setMemberId}
              selectedMember={member}
              onSelectedMemberChange={setMember}
              label={t('monitoring.search_user_label')}
              placeholder={t('monitoring.search_user_placeholder')}
              noResultsText={t('monitoring.no_users_found')}
              clearText={t('monitoring.clear_selection_aria')}
              isRequired
            />
          )}

          <Textarea
            label={t('monitoring.reason_label')}
            placeholder={t('monitoring.reason_placeholder')}
            value={reason}
            onValueChange={setReason}
            minRows={3}
            variant="bordered"
            isRequired
          />
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-foreground/70">{t('monitoring.disable_messaging')}</span>
            <Switch
              aria-label={t('monitoring.disable_messaging')}
              isSelected={messagingDisabled}
              onValueChange={setMessagingDisabled}
              size="sm"
            />
          </div>
          <Select
            label={t('monitoring.duration_label')}
            placeholder={t('monitoring.duration_placeholder')}
            variant="bordered"
            selectedKeys={expiresDays ? [expiresDays] : []}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as string | undefined;
              setExpiresDays(val ?? '');
            }}
          >
            {DURATION_OPTIONS.map((days) => (
              <SelectItem key={days} id={days}>{t(`monitoring.duration_${days}_days`)}</SelectItem>
            ))}
          </Select>
          {editingItem?.monitoring_expires_at && (
            <p className="text-xs text-muted">
              {t('monitoring.current_expiry', { date: formatServerDate(editingItem.monitoring_expires_at) })}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={saving}>
            {t('monitoring.cancel_button')}
          </Button>
          <Button
            variant="primary"
            onPress={handleSubmit}
            isPending={saving}
            isDisabled={!targetUserId}
            startContent={!saving && (editingItem ? <Pencil size={14} aria-hidden="true" /> : <UserPlus size={14} aria-hidden="true" />)}
          >
            {editingItem ? t('monitoring.save_button') : t('monitoring.add_button')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default MonitoringFormModal;
