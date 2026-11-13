// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Invite codes: make, list, copy and stop the codes people need to join a
 * community whose "Who can join" is Invite only.
 *
 * Moved from the Registration policy page on 13 Nov 2026 (owner): that page is
 * now god-only, and a community admin who chooses Invite only on the Settings
 * page must still be able to make the codes. Rendered there, inside "Joining
 * and signing in", while Invite only is chosen. Same endpoints as before:
 *   GET    /v2/admin/invite-codes
 *   POST   /v2/admin/invite-codes
 *   DELETE /v2/admin/invite-codes/{id}
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Copy from 'lucide-react/icons/copy';
import Plus from 'lucide-react/icons/plus';
import Ticket from 'lucide-react/icons/ticket';
import Trash2 from 'lucide-react/icons/trash-2';
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  useDisclosure,
} from '@/components/ui';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';

interface InviteCode {
  id: number;
  code: string;
  max_uses: number;
  uses_count: number;
  note: string | null;
  is_active: number;
  expires_at: string | null;
  created_at: string;
  creator_name: string | null;
}

interface InviteCodesResponse {
  items: InviteCode[];
  total: number;
}

export function InviteCodesPanel() {
  const { t } = useTranslation(['admin_system', 'common']);
  const toast = useToast();

  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [inviteCodesTotal, setInviteCodesTotal] = useState(0);
  const [inviteCodesLoading, setInviteCodesLoading] = useState(true);
  const [generateCount, setGenerateCount] = useState(1);
  const [generateMaxUses, setGenerateMaxUses] = useState(1);
  const [generateExpiry, setGenerateExpiry] = useState('');
  const [generateNote, setGenerateNote] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const generateModal = useDisclosure();

  const fetchInviteCodes = useCallback(async () => {
    setInviteCodesLoading(true);
    try {
      const res = await api.get<InviteCodesResponse>('/v2/admin/invite-codes');
      if (res.data) {
        setInviteCodes(res.data.items || []);
        setInviteCodesTotal(res.data.total || 0);
      }
    } catch {
      /* The list stays empty; making codes still works. */
    } finally {
      setInviteCodesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInviteCodes();
  }, [fetchInviteCodes]);

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(t('system.copied_to_clipboard'));
  };

  const openGenerate = () => {
    setGeneratedCodes([]);
    setGenerateCount(1);
    setGenerateMaxUses(1);
    setGenerateExpiry('');
    setGenerateNote('');
    generateModal.onOpen();
  };

  const handleGenerateInviteCodes = async () => {
    setGenerating(true);
    try {
      const res = await api.post<{ codes: string[] }>('/v2/admin/invite-codes', {
        count: generateCount,
        max_uses: generateMaxUses,
        expires_at: generateExpiry || undefined,
        note: generateNote || undefined,
      });
      if (res.data?.codes) {
        setGeneratedCodes(res.data.codes);
        void fetchInviteCodes();
        toast.success(t('system.reg.codes_generated'));
      }
    } catch {
      toast.error(t('system.failed_to_generate_invite_codes'));
    } finally {
      setGenerating(false);
    }
  };

  const handleDeactivateCode = async (id: number) => {
    try {
      const res = await api.delete(`/v2/admin/invite-codes/${id}`);
      if (res.success) {
        toast.success(t('system.invite_code_deactivated'));
        void fetchInviteCodes();
      } else {
        toast.error(t('system.failed_to_deactivate_invite_code'));
      }
    } catch {
      toast.error(t('system.failed_to_deactivate_invite_code'));
    }
  };

  return (
    <div data-testid="invite-codes-panel" className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <Ticket size={16} aria-hidden="true" className="text-accent" />
            {t('system.reg.invite_codes')}
          </p>
          <p className="mt-0.5 text-sm leading-5 text-muted">{t('system.reg.invite_codes_desc')}</p>
        </div>
        <Button size="sm" variant="secondary" startContent={<Plus size={14} aria-hidden="true" />} onPress={openGenerate} className="shrink-0">
          {t('system.reg.generate_codes')}
        </Button>
      </div>

      {inviteCodesLoading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : inviteCodes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-divider py-6 text-center">
          <Ticket size={28} aria-hidden="true" className="mx-auto mb-2 text-muted" />
          <p className="text-sm text-muted">{t('system.reg.no_invite_codes')}</p>
          <p className="mt-1 text-xs text-muted">{t('system.reg.no_invite_codes_hint')}</p>
        </div>
      ) : (
        <Table aria-label={t('system.reg.invite_codes')} removeWrapper>
          <TableHeader>
            <TableColumn>{t('system.reg.col_code')}</TableColumn>
            <TableColumn>{t('system.reg.col_uses')}</TableColumn>
            <TableColumn>{t('system.reg.col_status')}</TableColumn>
            <TableColumn>{t('system.reg.col_note')}</TableColumn>
            <TableColumn>{t('system.reg.col_expires')}</TableColumn>
            <TableColumn>{t('system.reg.col_actions')}</TableColumn>
          </TableHeader>
          <TableBody>
            {inviteCodes.map((ic) => (
              <TableRow key={ic.id}>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <code className="font-mono text-sm">{ic.code}</code>
                    <Button isIconOnly size="sm" variant="tertiary" aria-label={t('system.reg.copy_invite_code')} onPress={() => copyToClipboard(ic.code)}>
                      <Copy size={12} aria-hidden="true" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <span className={ic.uses_count >= ic.max_uses ? 'text-warning' : ''}>
                    {ic.uses_count}/{ic.max_uses}
                  </span>
                </TableCell>
                <TableCell>
                  {!ic.is_active ? (
                    <Chip size="sm" color="default" variant="soft">{t('system.reg.deactivated')}</Chip>
                  ) : ic.uses_count >= ic.max_uses ? (
                    <Chip size="sm" color="warning" variant="soft">{t('system.reg.exhausted')}</Chip>
                  ) : ic.expires_at && new Date(ic.expires_at) < new Date() ? (
                    <Chip size="sm" color="warning" variant="soft">{t('system.reg.expired')}</Chip>
                  ) : (
                    <Chip size="sm" color="success" variant="soft">{t('system.reg.active')}</Chip>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted">{ic.note || '—'}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted">
                    {ic.expires_at ? new Date(ic.expires_at).toLocaleDateString(getFormattingLocale()) : t('system.reg.never')}
                  </span>
                </TableCell>
                <TableCell>
                  {ic.is_active ? (
                    <Button isIconOnly size="sm" variant="danger" aria-label={t('system.reg.deactivate_invite_code')} onPress={() => void handleDeactivateCode(ic.id)}>
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {inviteCodesTotal > 0 && (
        <p className="text-xs text-muted">{t('system.reg.total_codes_count', { count: inviteCodesTotal })}</p>
      )}

      <Modal isOpen={generateModal.isOpen} onOpenChange={generateModal.onOpenChange} size="md">
        <ModalContent>
          <ModalHeader>{t('system.reg.generate_invite_codes')}</ModalHeader>
          <ModalBody>
            {generatedCodes.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted">{t('system.reg.generated_share')}</p>
                <div className="space-y-1">
                  {generatedCodes.map((code) => (
                    <div key={code} className="flex items-center justify-between rounded-lg bg-surface-secondary p-2">
                      <code className="font-mono text-sm">{code}</code>
                      <Button isIconOnly size="sm" variant="tertiary" aria-label={t('system.reg.copy_code')} onPress={() => copyToClipboard(code)}>
                        <Copy size={14} aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => copyToClipboard(generatedCodes.join('\n'))}
                  startContent={<Copy size={14} aria-hidden="true" />}
                  className="mt-2"
                >
                  {t('system.reg.copy_all_codes')}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <Input
                  label={t('system.label_number_of_codes')}
                  type="number"
                  min={1}
                  max={100}
                  value={String(generateCount)}
                  onChange={(e) => setGenerateCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                  variant="secondary"
                  description={t('system.reg.generate_count_desc')}
                />
                <Input
                  label={t('system.label_max_uses_per_code')}
                  type="number"
                  min={1}
                  max={1000}
                  value={String(generateMaxUses)}
                  onChange={(e) => setGenerateMaxUses(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))}
                  variant="secondary"
                  description={t('system.reg.max_uses_desc')}
                />
                <Input
                  label={t('system.reg.expiry_date')}
                  type="date"
                  value={generateExpiry}
                  onChange={(e) => setGenerateExpiry(e.target.value)}
                  variant="secondary"
                  description={t('system.reg.expiry_desc')}
                />
                <Input
                  label={t('system.reg.note_optional')}
                  placeholder={t('system.reg.note_placeholder')}
                  value={generateNote}
                  onChange={(e) => setGenerateNote(e.target.value)}
                  variant="secondary"
                  description={t('system.reg.note_desc')}
                />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={generateModal.onClose}>
              {generatedCodes.length > 0 ? t('system.reg.done') : t('system.reg.cancel')}
            </Button>
            {generatedCodes.length === 0 && (
              <Button onPress={() => void handleGenerateInviteCodes()} isLoading={generating} isDisabled={generating}>
                {t('system.reg.generate')}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default InviteCodesPanel;
