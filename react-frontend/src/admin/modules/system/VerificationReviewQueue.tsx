import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Spinner, Chip, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';

import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useToast } from '@/contexts';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VerificationReviewQueue — Admin component for reviewing pending identity verification sessions.
 * Allows admins to approve or reject users awaiting manual review.
 */


interface PendingSession {
  id: number;
  tenant_id: number;
  user_id: number;
  provider_slug: string;
  verification_level: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  failure_reason: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

type ReviewAction = 'approve' | 'reject';

const STATUS_COLORS: Record<string, 'default' | 'primary' | 'warning' | 'success' | 'danger'> = {
  created: 'default',
  started: 'primary',
  processing: 'warning',
  passed: 'success',
  failed: 'danger',
  expired: 'default',
  cancelled: 'default',
};

const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleString(getFormattingLocale());
};

export function VerificationReviewQueue() {
  const { t } = useTranslation('admin_system');
  const toast = useToast();
  const [sessions, setSessions] = useState<PendingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Confirmation modal state
  const confirmModal = useDisclosure();
  const [selectedSession, setSelectedSession] = useState<PendingSession | null>(null);
  const [selectedAction, setSelectedAction] = useState<ReviewAction>('approve');

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PendingSession[]>('/v2/admin/identity/sessions?status=pending&limit=100');
      if (res.data) {
        setSessions(Array.isArray(res.data) ? res.data : []);
      }
    } catch {
      // silent — component may not have sessions
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const openConfirmation = (session: PendingSession, action: ReviewAction) => {
    setSelectedSession(session);
    setSelectedAction(action);
    confirmModal.onOpen();
  };

  const handleConfirm = async () => {
    if (!selectedSession) return;

    setActionLoading(true);
    try {
      const endpoint = `/v2/admin/identity/sessions/${selectedSession.id}/${selectedAction}`;
      const res = await api.post<{ status: string; message: string }>(endpoint, {});

      if (res.success) {
        toast.success(
          selectedAction === 'approve'
            ? t('verification.user_approved_activated')
            : t('verification.user_verification_rejected')
        );
        confirmModal.onClose();
        fetchSessions();
      } else {
        toast.error(t('verification.failed_to_action_verification'));
      }
    } catch {
      toast.error(t('verification.failed_to_action_verification_session'));
    } finally {
      setActionLoading(false);
    }
  };

  const getUserName = (session: PendingSession): string => {
    return resolveUserDisplayName(session) || t('verification.user_with_id', { id: session.user_id });
  };

  return (
    <>
      <Card className="shadow-sm">
        <CardHeader className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center px-6 pt-5 pb-0">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-amber-500" />
            <h3 className="text-lg font-semibold">{t('verification.pending_reviews_title')}</h3>
            {sessions.length > 0 && (
              <Chip size="sm" color="warning" variant="soft">
                {t('verification.n_pending', { count: sessions.length })}
              </Chip>
            )}
          </div>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={fetchSessions}
            aria-label={t('verification.refresh_pending_reviews_aria')}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardBody className="px-6 pb-5">
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-center py-8 text-theme-muted">
              {t('verification.no_pending_reviews')}
            </p>
          ) : (
            <Table aria-label={t('verification.pending_reviews_aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('verification.col_user')}</TableColumn>
                <TableColumn>{t('verification.col_provider')}</TableColumn>
                <TableColumn>{t('verification.col_level')}</TableColumn>
                <TableColumn>{t('verification.col_status')}</TableColumn>
                <TableColumn>{t('verification.col_created')}</TableColumn>
                <TableColumn>{t('verification.col_actions')}</TableColumn>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{getUserName(session)}</div>
                      {session.email && (
                        <div className="text-xs text-theme-muted">{session.email}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {t(`verification.provider_${session.provider_slug}`, { defaultValue: t('verification.provider_unknown') })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {t(`system.verification_level_${session.verification_level}`, { defaultValue: t('system.verification_level_unknown') })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        color={STATUS_COLORS[session.status] || 'default'}
                        variant="soft"
                      >
                        {t(`verification.status_${session.status}`, { defaultValue: t('verification.status_unknown') })}
                      </Chip>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-theme-muted">
                      {formatDate(session.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          color="success"
                          variant="tertiary"
                          startContent={<CheckCircle className="w-3.5 h-3.5" />}
                          onPress={() => openConfirmation(session, 'approve')}
                        >
                          {t('verification.approve')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          startContent={<XCircle className="w-3.5 h-3.5" />}
                          onPress={() => openConfirmation(session, 'reject')}
                        >
                          {t('verification.reject')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Confirmation Modal */}
      <Modal isOpen={confirmModal.isOpen} onOpenChange={confirmModal.onOpenChange} size="sm">
        <ModalContent>
          <ModalHeader>
            {selectedAction === 'approve' ? t('verification.approve_user') : t('verification.reject_user')}
          </ModalHeader>
          <ModalBody>
            {selectedSession && (
              <div className="space-y-2">
                <p className="text-sm">
                  {selectedAction === 'approve' ? (
                    <>
                      {t('verification.approve_confirm_prefix')}{' '}
                      <strong className="text-success">{t('verification.approve')}</strong>{' '}
                      <strong>{getUserName(selectedSession)}</strong>{t('verification.approve_confirm_suffix')}
                    </>
                  ) : (
                    <>
                      {t('verification.reject_confirm_prefix')}{' '}
                      <strong className="text-danger">{t('verification.reject')}</strong>{' '}
                      <strong>{getUserName(selectedSession)}</strong>{t('verification.reject_confirm_suffix')}
                    </>
                  )}
                </p>
                {selectedSession.email && (
                  <p className="text-xs text-theme-muted">{selectedSession.email}</p>
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={confirmModal.onClose} isDisabled={actionLoading}>
              {t('verification.cancel')}
            </Button>
            <Button
              color={selectedAction === 'approve' ? 'success' : 'danger'}
              onPress={handleConfirm}
              isLoading={actionLoading}
              startContent={
                !actionLoading
                  ? selectedAction === 'approve'
                    ? <CheckCircle className="w-4 h-4" />
                    : <XCircle className="w-4 h-4" />
                  : undefined
              }
            >
              {selectedAction === 'approve' ? t('verification.approve') : t('verification.reject')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

export default VerificationReviewQueue;
