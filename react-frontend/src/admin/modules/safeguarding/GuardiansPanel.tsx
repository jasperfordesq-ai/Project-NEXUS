// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Guardians — the guardian arrangements staff have recorded for members who
 * want extra support, with create and revoke. Formerly the second tab of the
 * safeguarding dashboard; now its own page in the broker panel.
 *
 * `?filter=` picks the view: `active` (the default), `consented` (the member
 * has agreed), or `all`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import UserPlus from 'lucide-react/icons/user-plus';
import UserMinus from 'lucide-react/icons/user-minus';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Shield from 'lucide-react/icons/shield';
import {
  Avatar, Button, Card, CardBody, CardHeader, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
  Spinner, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, useDisclosure,
} from '@/components/ui';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';
import { SafeguardingFilterBar, type GuardianAssignment } from './safeguardingShared';

type GuardianFilter = 'active' | 'consented' | 'all';
const GUARDIAN_FILTERS: readonly GuardianFilter[] = ['active', 'consented', 'all'];

export function GuardiansPanel() {
  const { t } = useTranslation('admin_safeguarding');
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawFilter = searchParams.get('filter');
  const filter: GuardianFilter = (GUARDIAN_FILTERS as readonly string[]).includes(rawFilter ?? '')
    ? (rawFilter as GuardianFilter)
    : 'active';

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [assignments, setAssignments] = useState<GuardianAssignment[]>([]);

  const assignModal = useDisclosure();
  const [wardEmail, setWardEmail] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/v2/admin/safeguarding/assignments');
      if (res.success) {
        const payload = res.data;
        setAssignments(
          Array.isArray(payload) ? payload : (payload as { assignments?: GuardianAssignment[] })?.assignments ?? [],
        );
        setFailed(false);
      } else {
        setAssignments([]);
        setFailed(true);
      }
    } catch (err) {
      logError('GuardiansPanel.load', err);
      setAssignments([]);
      setFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setFilter = useCallback(
    (next: GuardianFilter) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'active') params.delete('filter');
          else params.set('filter', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const counts = useMemo(
    () => ({
      active: assignments.filter((a) => a.status === 'active').length,
      consented: assignments.filter((a) => a.status === 'active' && a.consent_given).length,
      all: assignments.length,
    }),
    [assignments],
  );

  const visible = useMemo(() => {
    if (filter === 'active') return assignments.filter((a) => a.status === 'active');
    if (filter === 'consented') return assignments.filter((a) => a.status === 'active' && a.consent_given);
    return assignments;
  }, [assignments, filter]);

  const handleCreate = useCallback(async () => {
    if (!wardEmail.trim() || !guardianEmail.trim()) return;
    setCreating(true);
    try {
      const res = await api.post('/v2/admin/safeguarding/assignments', {
        ward_email: wardEmail.trim(),
        guardian_email: guardianEmail.trim(),
      });
      if (res.success) {
        toast.success(t('safeguarding.guardian_assignment_created'));
        setWardEmail('');
        setGuardianEmail('');
        assignModal.onClose();
        void load();
      } else {
        // 🔴 api.ts never throws, so without this branch a refusal (email
        // matching no member, guardian == supported member, duplicate
        // arrangement) produced NO feedback at all. Surface the API's own
        // message so staff know what to fix.
        // admin-i18n-ignore: localized server message — AdminSafeguardingController
        toast.error(res.error || t('safeguarding.failed_to_create_assignment'));
      }
    } catch (err) {
      logError('GuardiansPanel.create', err);
      toast.error(t('safeguarding.failed_to_create_assignment'));
    }
    setCreating(false);
  }, [wardEmail, guardianEmail, toast, assignModal, load, t]);

  const handleRevoke = useCallback(
    async (assignmentId: number) => {
      try {
        const res = await api.delete(`/v2/admin/safeguarding/assignments/${assignmentId}`);
        if (res.success) {
          toast.success(t('safeguarding.assignment_revoked'));
          setAssignments((prev) => prev.map((a) => (a.id === assignmentId ? { ...a, status: 'revoked' as const } : a)));
        } else {
          toast.error(t('safeguarding.failed_to_revoke_assignment'));
        }
      } catch (err) {
        logError('GuardiansPanel.revoke', err);
        toast.error(t('safeguarding.failed_to_revoke_assignment'));
      }
    },
    [toast, t],
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col items-stretch gap-4">
          <p className="text-sm text-muted">{t('safeguarding.guardians_page.intro')}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SafeguardingFilterBar<GuardianFilter>
              label={t('safeguarding.guardians_page.filter_label')}
              value={filter}
              onChange={setFilter}
              options={[
                { key: 'active', label: t('safeguarding.guardians_page.filter_active'), count: counts.active },
                { key: 'consented', label: t('safeguarding.guardians_page.filter_consented'), count: counts.consented },
                { key: 'all', label: t('safeguarding.guardians_page.filter_all'), count: counts.all },
              ]}
            />
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" startContent={<RefreshCw size={16} />} onPress={() => void load()}>
                {t('safeguarding.refresh')}
              </Button>
              <Button size="sm" startContent={<UserPlus size={16} />} onPress={assignModal.onOpen}>
                {t('safeguarding.new_assignment')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-10">
              <Spinner size="lg" />
            </div>
          ) : failed ? (
            <div role="alert" className="py-8 text-center text-danger">
              <Shield size={40} className="mx-auto mb-2 opacity-40" aria-hidden="true" />
              <p>{t('safeguarding.failed_to_load_safeguarding_data')}</p>
            </div>
          ) : (
            <Table aria-label={t('safeguarding.guardian_assignments')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('safeguarding.col_ward')}</TableColumn>
                <TableColumn>{t('safeguarding.col_guardian')}</TableColumn>
                <TableColumn>{t('safeguarding.col_status')}</TableColumn>
                <TableColumn>{t('safeguarding.col_consent')}</TableColumn>
                <TableColumn>{t('safeguarding.col_created')}</TableColumn>
                <TableColumn>{t('safeguarding.col_expires')}</TableColumn>
                <TableColumn>{t('safeguarding.col_actions')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={t('safeguarding.no_guardian_assignments')}>
                {visible.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar size="sm" name={assignment.ward.name} className="h-6 w-6" />
                        <span className="text-sm">{assignment.ward.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar size="sm" name={assignment.guardian.name} className="h-6 w-6" />
                        <span className="text-sm">{assignment.guardian.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={assignment.status === 'active' ? 'success' : assignment.status === 'revoked' ? 'danger' : 'default'}
                      >
                        {t(`safeguarding.status_${assignment.status}`, { defaultValue: t('common.unknown') })}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      {assignment.consent_given ? (
                        <CheckCircle size={16} className="text-success" aria-label={t('safeguarding.guardians_page.consent_yes')} />
                      ) : (
                        <XCircle size={16} className="text-danger" aria-label={t('safeguarding.guardians_page.consent_no')} />
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted">{formatRelativeTime(assignment.created_at)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted">
                        {assignment.expires_at ? formatRelativeTime(assignment.expires_at) : t('safeguarding.never')}
                      </span>
                    </TableCell>
                    <TableCell>
                      {assignment.status === 'active' && (
                        <Button
                          size="sm"
                          variant="danger"
                          startContent={<UserMinus size={14} />}
                          onPress={() => void handleRevoke(assignment.id)}
                        >
                          {t('safeguarding.revoke')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal isOpen={assignModal.isOpen} onOpenChange={assignModal.onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <UserPlus size={20} />
                {t('safeguarding.create_guardian_assignment')}
              </ModalHeader>
              <ModalBody className="gap-4">
                <Input
                  label={t('safeguarding.label_ward_email')}
                  placeholder={t('safeguarding.placeholder_ward_email')}
                  value={wardEmail}
                  onChange={(e) => setWardEmail(e.target.value)}
                  description={t('safeguarding.desc_the_vulnerable_user_who_needs_oversight')}
                />
                <Input
                  label={t('safeguarding.label_guardian_email')}
                  placeholder={t('safeguarding.placeholder_guardian_email')}
                  value={guardianEmail}
                  onChange={(e) => setGuardianEmail(e.target.value)}
                  description={t('safeguarding.desc_guardian_monitors_messages')}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('safeguarding.cancel')}</Button>
                <Button
                  isLoading={creating}
                  isDisabled={!wardEmail.trim() || !guardianEmail.trim()}
                  onPress={handleCreate}
                >
                  {t('safeguarding.create_assignment')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}

export default GuardiansPanel;
