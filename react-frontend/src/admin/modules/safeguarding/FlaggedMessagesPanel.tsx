// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Flagged messages — copies of messages taken for safeguarding review, and
 * the review action. Formerly the first tab of the safeguarding dashboard; now
 * its own page in the broker panel.
 *
 * The view is driven by `?filter=` so links from elsewhere (dashboard tiles,
 * old bookmarks) land on the right list: `unreviewed` (the default),
 * `critical`, `reviewed`, or `all`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Eye from 'lucide-react/icons/eye';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Shield from 'lucide-react/icons/shield';
import {
  Avatar, Button, Card, CardBody, CardHeader, Chip, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
  SearchField, Separator, Spinner, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Textarea,
  useDisclosure,
} from '@/components/ui';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';
import {
  SEVERITY_COLORS,
  SafeguardingFilterBar,
  requestBadgeRefresh,
  useFlagReasonLabel,
  type FlaggedMessage,
} from './safeguardingShared';

type FlagFilter = 'unreviewed' | 'critical' | 'reviewed' | 'all';
const FLAG_FILTERS: readonly FlagFilter[] = ['unreviewed', 'critical', 'reviewed', 'all'];

const isCritical = (m: FlaggedMessage) => !m.is_reviewed && (m.severity === 'critical' || m.severity === 'high');

export function FlaggedMessagesPanel() {
  const { t } = useTranslation('admin_safeguarding');
  const flagReasonLabel = useFlagReasonLabel();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawFilter = searchParams.get('filter');
  const filter: FlagFilter = (FLAG_FILTERS as readonly string[]).includes(rawFilter ?? '')
    ? (rawFilter as FlagFilter)
    : 'unreviewed';

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [messages, setMessages] = useState<FlaggedMessage[]>([]);
  const [search, setSearch] = useState('');

  const reviewModal = useDisclosure();
  const [reviewTarget, setReviewTarget] = useState<FlaggedMessage | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/v2/admin/safeguarding/flagged-messages');
      if (res.success) {
        const payload = res.data;
        setMessages(Array.isArray(payload) ? payload : (payload as { messages?: FlaggedMessage[] })?.messages ?? []);
        setFailed(false);
      } else {
        setMessages([]);
        setFailed(true);
      }
    } catch (err) {
      logError('FlaggedMessagesPanel.load', err);
      setMessages([]);
      setFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setFilter = useCallback(
    (next: FlagFilter) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'unreviewed') params.delete('filter');
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
      unreviewed: messages.filter((m) => !m.is_reviewed).length,
      critical: messages.filter(isCritical).length,
      reviewed: messages.filter((m) => m.is_reviewed).length,
      all: messages.length,
    }),
    [messages],
  );

  const visible = useMemo(() => {
    let list = messages;
    if (filter === 'unreviewed') list = list.filter((m) => !m.is_reviewed);
    else if (filter === 'reviewed') list = list.filter((m) => m.is_reviewed);
    else if (filter === 'critical') list = list.filter(isCritical);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (m) =>
          m.message_content.toLowerCase().includes(q) ||
          m.sender.name.toLowerCase().includes(q) ||
          m.recipient.name.toLowerCase().includes(q),
      );
    }
    return list;
  }, [messages, filter, search]);

  const handleReview = useCallback(async () => {
    if (!reviewTarget) return;
    setReviewing(true);
    try {
      const res = await api.post(`/v2/admin/safeguarding/flagged-messages/${reviewTarget.id}/review`, {
        notes: reviewNotes,
      });
      if (res.success) {
        toast.success(t('safeguarding.message_reviewed'));
        setMessages((prev) =>
          prev.map((m) => (m.id === reviewTarget.id ? { ...m, is_reviewed: true, review_notes: reviewNotes } : m)),
        );
        setReviewTarget(null);
        setReviewNotes('');
        reviewModal.onClose();
        requestBadgeRefresh();
      } else {
        // admin-i18n-ignore: localized server message — AdminSafeguardingController
        toast.error(res.error || t('safeguarding.failed_to_review_message'));
      }
    } catch (err) {
      logError('FlaggedMessagesPanel.review', err);
      toast.error(t('safeguarding.failed_to_review_message'));
    }
    setReviewing(false);
  }, [reviewTarget, reviewNotes, toast, reviewModal, t]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col items-stretch gap-4">
          <p className="text-sm text-muted">{t('safeguarding.flagged_page.intro')}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SafeguardingFilterBar<FlagFilter>
              label={t('safeguarding.flagged_page.filter_label')}
              value={filter}
              onChange={setFilter}
              options={[
                { key: 'unreviewed', label: t('safeguarding.flagged_page.filter_unreviewed'), count: counts.unreviewed },
                { key: 'critical', label: t('safeguarding.flagged_page.filter_critical'), count: counts.critical },
                { key: 'reviewed', label: t('safeguarding.flagged_page.filter_reviewed'), count: counts.reviewed },
                { key: 'all', label: t('safeguarding.flagged_page.filter_all'), count: counts.all },
              ]}
            />
            <div className="flex items-center gap-2">
              <SearchField
                aria-label={t('safeguarding.label_search_safeguarding_messages')}
                placeholder={t('safeguarding.placeholder_search_messages')}
                value={search}
                onValueChange={setSearch}
                size="sm"
                className="w-56 max-w-full"
              />
              <Button variant="secondary" size="sm" startContent={<RefreshCw size={16} />} onPress={() => void load()}>
                {t('safeguarding.refresh')}
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
            <Table aria-label={t('safeguarding.flagged_messages')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('safeguarding.col_sender')}</TableColumn>
                <TableColumn>{t('safeguarding.col_recipient')}</TableColumn>
                <TableColumn>{t('safeguarding.col_message')}</TableColumn>
                <TableColumn>{t('safeguarding.col_severity')}</TableColumn>
                <TableColumn>{t('safeguarding.col_reason')}</TableColumn>
                <TableColumn>{t('safeguarding.col_date')}</TableColumn>
                <TableColumn>{t('safeguarding.col_status')}</TableColumn>
                <TableColumn>{t('safeguarding.col_actions')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={t('safeguarding.no_flagged_messages')}>
                {visible.map((flag) => (
                  <TableRow key={flag.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar size="sm" name={flag.sender.name} className="h-6 w-6" />
                        <span className="text-sm">{flag.sender.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar size="sm" name={flag.recipient.name} className="h-6 w-6" />
                        <span className="text-sm">{flag.recipient.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[200px] truncate text-sm text-muted">{flag.message_content}</p>
                    </TableCell>
                    <TableCell>
                      <Chip size="sm" color={SEVERITY_COLORS[flag.severity] || 'default'} variant="soft">
                        {t(`common.${flag.severity}`, { defaultValue: t('common.unknown') })}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <span className="whitespace-nowrap text-sm text-muted">{flagReasonLabel(flag.flag_reason)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="whitespace-nowrap text-sm text-muted">{formatRelativeTime(flag.created_at)}</span>
                    </TableCell>
                    <TableCell>
                      {flag.is_reviewed ? (
                        <Chip size="sm" color="success" variant="soft" startContent={<CheckCircle size={12} />}>
                          {t('safeguarding.reviewed')}
                        </Chip>
                      ) : (
                        <Chip size="sm" color="warning" variant="soft" startContent={<Clock size={12} />}>
                          {t('safeguarding.pending')}
                        </Chip>
                      )}
                    </TableCell>
                    <TableCell>
                      {!flag.is_reviewed && (
                        <Button
                          size="sm"
                          variant="secondary"
                          startContent={<Eye size={14} />}
                          onPress={() => {
                            setReviewTarget(flag);
                            reviewModal.onOpen();
                          }}
                        >
                          {t('safeguarding.review')}
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

      <Modal isOpen={reviewModal.isOpen} onOpenChange={reviewModal.onOpenChange} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <Eye size={20} />
                {t('safeguarding.review_flagged_message')}
              </ModalHeader>
              <ModalBody className="gap-4">
                {reviewTarget && (
                  <>
                    <div className="rounded-lg bg-surface-secondary p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-sm font-medium">{t('safeguarding.from')}:</span>
                        <span className="text-sm">{reviewTarget.sender.name}</span>
                        <span className="mx-1 text-sm text-muted">{t('safeguarding.to')}</span>
                        <span className="text-sm">{reviewTarget.recipient.name}</span>
                      </div>
                      <Separator className="my-2" />
                      <p className="whitespace-pre-wrap text-sm text-foreground">{reviewTarget.message_content}</p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div>
                        <span className="text-sm text-muted">{t('safeguarding.severity')}:</span>{' '}
                        <Chip size="sm" color={SEVERITY_COLORS[reviewTarget.severity]} variant="soft">
                          {t(`common.${reviewTarget.severity}`, { defaultValue: t('common.unknown') })}
                        </Chip>
                      </div>
                      <div>
                        <span className="text-sm text-muted">{t('safeguarding.reason')}:</span>{' '}
                        <span className="text-sm">{flagReasonLabel(reviewTarget.flag_reason)}</span>
                      </div>
                    </div>

                    {reviewTarget.ward_name && (
                      <div className="flex items-center gap-2 text-sm">
                        <Shield size={14} className="text-accent" />
                        <span className="text-muted">{t('safeguarding.ward')}:</span>
                        <span>{reviewTarget.ward_name}</span>
                        {reviewTarget.guardian_name && (
                          <>
                            <span className="mx-1 text-muted">|</span>
                            <span className="text-muted">{t('safeguarding.guardian')}:</span>
                            <span>{reviewTarget.guardian_name}</span>
                          </>
                        )}
                      </div>
                    )}

                    <Textarea
                      label={t('safeguarding.label_review_notes')}
                      placeholder={t('safeguarding.placeholder_review_notes')}
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      minRows={3}
                    />
                  </>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('safeguarding.cancel')}</Button>
                <Button isLoading={reviewing} startContent={<CheckCircle size={16} />} onPress={handleReview}>
                  {t('safeguarding.mark_as_reviewed')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}

export default FlaggedMessagesPanel;
