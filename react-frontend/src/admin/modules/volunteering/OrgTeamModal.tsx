// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OrgTeamModal — an organisation's team in the admin panel (gap D7, 7 Oct 2026).
 *
 * Until now this window only listed members. Admins can now add someone from
 * the community, change a member's role and remove a member. The server keeps
 * the safeguards: the person who registered the organisation and the admin's
 * own place cannot be changed, and the last owner cannot be removed. The
 * controls for those rows are disabled here so nobody is offered a dead end.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Users from 'lucide-react/icons/users';
import UserPlus from 'lucide-react/icons/user-plus';

import { getFormattingLocale } from '@/lib/helpers';
import {
  Avatar, Button, Chip, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, SelectItem,
} from '@/components/ui';
import { useAuth, useToast } from '@/contexts';
import { adminVolunteering } from '../../api/adminApi';
import { ConfirmModal } from '../../components/ConfirmModal';
import { MemberSearchPicker, type MemberSearchMember } from '../../components/MemberSearchPicker';

export type OrgTeamRole = 'owner' | 'admin' | 'member';
const ROLES: readonly OrgTeamRole[] = ['owner', 'admin', 'member'];
const isRole = (value: unknown): value is OrgTeamRole => typeof value === 'string' && (ROLES as readonly string[]).includes(value);

export interface OrgTeamMember {
  id?: number;
  user_id: number;
  first_name?: string;
  last_name?: string;
  avatar_url?: string | null;
  role: string;
  total_hours?: number;
  is_creator?: boolean;
}

interface OrgTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  org: { id: number; name: string } | null;
  /** Called after any change so the page can refresh its member counts. */
  onChanged?: () => void;
}

const memberName = (m: OrgTeamMember) => `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || `#${m.user_id}`;

export function OrgTeamModal({ isOpen, onClose, org, onChanged }: OrgTeamModalProps) {
  const { t } = useTranslation('admin_volunteering');
  const { user } = useAuth();
  const toast = useToast();

  const [members, setMembers] = useState<OrgTeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  const [pickedId, setPickedId] = useState('');
  const [picked, setPicked] = useState<MemberSearchMember | null>(null);
  const [newRole, setNewRole] = useState<OrgTeamRole>('member');
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgTeamMember | null>(null);

  const orgId = org?.id ?? 0;

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await adminVolunteering.getOrgMembers(orgId);
      if (res.success) {
        const payload = res.data as unknown;
        const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown[] } | null)?.data;
        setMembers(Array.isArray(rows) ? (rows as OrgTeamMember[]) : []);
      } else {
        toast.error(t('volunteering.failed_load_members'));
      }
    } catch {
      toast.error(t('volunteering.failed_load_members'));
    }
    setLoading(false);
  }, [orgId, toast, t]);

  useEffect(() => {
    if (!isOpen) return;
    setMembers([]);
    setPickedId('');
    setPicked(null);
    setNewRole('member');
    void load();
  }, [isOpen, load]);

  // The server's message is already in the admin's language and says which
  // safeguard refused the change.
  const fail = (error?: string) => toast.error(error || t('org_team.failed'));

  const afterChange = async (message: string) => {
    toast.success(message);
    await load();
    onChanged?.();
  };

  const handleAdd = async () => {
    const userId = Number(pickedId);
    if (!userId || !orgId) return;
    setAdding(true);
    try {
      const res = await adminVolunteering.addOrgMember(orgId, userId, newRole);
      if (res.success) {
        setPickedId('');
        setPicked(null);
        setNewRole('member');
        await afterChange(t('org_team.added'));
      } else {
        fail(res.error);
      }
    } catch {
      fail();
    }
    setAdding(false);
  };

  const handleRole = async (member: OrgTeamMember, role: OrgTeamRole) => {
    if (role === member.role) return;
    setBusyUserId(member.user_id);
    try {
      const res = await adminVolunteering.updateOrgMemberRole(orgId, member.user_id, role);
      if (res.success) await afterChange(t('org_team.role_changed'));
      else fail(res.error);
    } catch {
      fail();
    }
    setBusyUserId(null);
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setBusyUserId(removeTarget.user_id);
    try {
      const res = await adminVolunteering.removeOrgMember(orgId, removeTarget.user_id);
      if (res.success) {
        setRemoveTarget(null);
        await afterChange(t('org_team.removed'));
      } else {
        fail(res.error);
      }
    } catch {
      fail();
    }
    setBusyUserId(null);
  };

  const ownId = user?.id != null ? Number(user.id) : null;

  return (
    <>
      <Modal isOpen={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} size="2xl" scrollBehavior="inside">
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>
                {t('volunteering.organization_members')}
                {org && <span className="mt-1 block text-sm font-normal text-muted">{org.name}</span>}
              </ModalHeader>
              <ModalBody>
                {/* Add */}
                <section aria-labelledby="org-team-add" className="rounded-xl border border-divider/70 p-3">
                  <h3 id="org-team-add" className="mb-2 text-sm font-semibold text-foreground">{t('org_team.add_title')}</h3>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <MemberSearchPicker
                      value={pickedId}
                      onValueChange={setPickedId}
                      selectedMember={picked}
                      onSelectedMemberChange={setPicked}
                      label={t('org_team.member_label')}
                      placeholder={t('org_team.member_placeholder')}
                      noResultsText={t('org_team.no_results')}
                      clearText={t('org_team.clear')}
                      size="sm"
                      className="flex-1"
                    />
                    <Select
                      size="sm"
                      label={t('org_team.role_label')}
                      className="sm:max-w-[160px]"
                      selectedKeys={[newRole]}
                      onChange={(e) => { if (isRole(e.target.value)) setNewRole(e.target.value); }}
                    >
                      {ROLES.map((role) => <SelectItem key={role} id={role}>{t(`org_team.roles.${role}`)}</SelectItem>)}
                    </Select>
                    <Button
                      size="sm"
                      startContent={<UserPlus size={14} aria-hidden="true" />}
                      isDisabled={!pickedId}
                      isLoading={adding}
                      onPress={() => void handleAdd()}
                    >
                      {t('org_team.add')}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted">{t('org_team.role_help')}</p>
                </section>

                {/* Team */}
                {loading && members.length === 0 ? (
                  <div className="flex justify-center py-8">
                    <span className="text-muted">{t('volunteering.loading')}</span>
                  </div>
                ) : members.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-muted">
                    <Users size={40} className="mb-2" aria-hidden="true" />
                    <p>{t('volunteering.no_members')}</p>
                  </div>
                ) : (
                  <ul className="space-y-2" aria-busy={loading || undefined}>
                    {members.map((m) => {
                      const name = memberName(m);
                      const isSelf = ownId !== null && ownId === Number(m.user_id);
                      const locked = Boolean(m.is_creator) || isSelf;
                      const busy = busyUserId === m.user_id;
                      return (
                        <li
                          key={m.user_id}
                          className="flex flex-col gap-3 rounded-xl border border-divider/70 bg-surface-secondary/30 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar src={m.avatar_url || undefined} name={name} size="sm" className="shrink-0" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{name}</p>
                              <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
                                <span>{t('volunteering.hours_value', { value: (m.total_hours ?? 0).toLocaleString(getFormattingLocale()) })}</span>
                                {m.is_creator && <Chip size="sm" variant="secondary">{t('org_team.creator')}</Chip>}
                                {isSelf && <Chip size="sm" variant="secondary">{t('org_team.you')}</Chip>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Select
                              size="sm"
                              aria-label={t('org_team.role_for', { name })}
                              className="w-36"
                              selectedKeys={[isRole(m.role) ? m.role : 'member']}
                              isDisabled={locked || busy}
                              onChange={(e) => { if (isRole(e.target.value)) void handleRole(m, e.target.value); }}
                            >
                              {ROLES.map((role) => <SelectItem key={role} id={role}>{t(`org_team.roles.${role}`)}</SelectItem>)}
                            </Select>
                            <Button
                              size="sm"
                              variant="tertiary"
                              aria-label={t('org_team.remove_named', { name })}
                              isDisabled={locked || busy}
                              onPress={() => setRemoveTarget(m)}
                            >
                              {t('org_team.remove')}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={close}>{t('volunteering.close')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <ConfirmModal
        isOpen={!!removeTarget}
        onClose={() => { if (busyUserId === null) setRemoveTarget(null); }}
        onConfirm={() => void handleRemove()}
        title={t('org_team.remove_title')}
        message={t('org_team.remove_body', { name: removeTarget ? memberName(removeTarget) : '', org: org?.name ?? '' })}
        confirmLabel={t('org_team.remove')}
        confirmColor="danger"
        isLoading={busyUserId !== null}
      />
    </>
  );
}

export default OrgTeamModal;
