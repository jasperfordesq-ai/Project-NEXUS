import { getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Textarea, useDisclosure, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Separator } from '@/components/ui';
import Wand2 from 'lucide-react/icons/wand-2';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Sparkles from 'lucide-react/icons/sparkles';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import XCircle from 'lucide-react/icons/x-circle';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import Info from 'lucide-react/icons/info';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProposalStatus = 'proposed' | 'accepted' | 'rejected' | 'published';
type ToneAssessment = 'too_formal' | 'too_informal' | 'condescending' | 'ok';

interface Proposal {
  id: string;
  draft_text: string;
  polished_text: string;
  tone_assessment: ToneAssessment;
  clarity_warnings: string[];
  audience_suggestion: string;
  audience_hint: string;
  sub_region_id: string | null;
  moderation_flags: string[];
  model_used: string;
  created_by: number;
  created_at: string;
  status: ProposalStatus;
  accepted_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  source_announcement_id: number | null;
  updated_at: string;
}

interface ListResponse {
  items: Proposal[];
  limit: number;
}

interface ProposalResponse {
  proposal: Proposal;
  published?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<ProposalStatus, 'accent' | 'warning' | 'default' | 'success'> = {
  proposed: 'accent',
  accepted: 'warning',
  rejected: 'default',
  published: 'success',
};

const TONE_COLORS: Record<ToneAssessment, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  too_formal: 'warning',
  too_informal: 'warning',
  condescending: 'danger',
};

type AdminT = (key: string, options?: Record<string, unknown>) => string;

function formatTime(iso: string | null, t: AdminT): string {
  if (!iso) return t('municipal_copilot.empty.value');
  try {
    return new Date(iso).toLocaleString(getFormattingLocale());
  } catch {
    return iso;
  }
}

function truncate(text: string, n: number): string {
  if (text.length <= n) return text;
  return text.slice(0, n).trimEnd() + '…';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MunicipalCopilotAdminPage() {
  const { t } = useTranslation('admin_caring_community');
  usePageTitle(t('municipal_copilot.meta.page_title'));
  const { showToast } = useToast();

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [draft, setDraft] = useState('');
  const [audienceHint, setAudienceHint] = useState('');
  const [latestId, setLatestId] = useState<string | null>(null);

  const rejectDisclosure = useDisclosure();
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const latest = useMemo<Proposal | null>(() => {
    if (latestId) {
      return proposals.find((p) => p.id === latestId) ?? null;
    }
    return proposals[0] ?? null;
  }, [latestId, proposals]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ListResponse>('/v2/admin/caring-community/copilot/proposals');
      setProposals(res.data?.items ?? []);
    } catch {
      showToast(t('municipal_copilot.toasts.load_failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGenerate = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      showToast(t('municipal_copilot.toasts.enter_draft'), 'error');
      return;
    }
    if (trimmed.length > 4000) {
      showToast(t('municipal_copilot.toasts.draft_too_long'), 'error');
      return;
    }
    setGenerating(true);
    try {
      const res = await api.post<ProposalResponse>(
        '/v2/admin/caring-community/copilot/proposals',
        {
          draft: trimmed,
          audience_hint: audienceHint.trim() || undefined,
        },
      );
      const newProposal = res.data?.proposal ?? null;
      if (newProposal) {
        setLatestId(newProposal.id);
        setProposals((prev) => [newProposal, ...prev.filter((p) => p.id !== newProposal.id)]);
        showToast(t('municipal_copilot.toasts.generated'), 'success');
      }
    } catch {
      showToast(t('municipal_copilot.toasts.generate_failed'), 'error');
    } finally {
      setGenerating(false);
    }
  }, [draft, audienceHint, showToast, t]);

  const handleAccept = useCallback(
    async (proposal: Proposal, polishedOverride?: string) => {
      try {
        const body: Record<string, unknown> = {};
        if (polishedOverride !== undefined && polishedOverride !== proposal.polished_text) {
          body.edited_polished_text = polishedOverride;
        }
        const res = await api.post<ProposalResponse>(
          `/v2/admin/caring-community/copilot/proposals/${proposal.id}/accept`,
          body,
        );
        const updated = res.data?.proposal ?? null;
        if (updated) {
          setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          if (updated.status === 'published') {
            showToast(t('municipal_copilot.toasts.accepted'), 'success');
          } else {
            showToast(t('municipal_copilot.toasts.publish_failed'), 'error');
          }
        }
      } catch {
        showToast(t('municipal_copilot.toasts.accept_failed'), 'error');
      }
    },
    [showToast, t],
  );

  const openReject = useCallback(
    (proposalId: string) => {
      setRejectTargetId(proposalId);
      setRejectReason('');
      rejectDisclosure.onOpen();
    },
    [rejectDisclosure],
  );

  const handleReject = useCallback(async () => {
    if (!rejectTargetId) return;
    const reason = rejectReason.trim();
    if (reason === '') {
      showToast(t('municipal_copilot.toasts.reason_required'), 'error');
      return;
    }
    setRejecting(true);
    try {
      const res = await api.post<ProposalResponse>(
        `/v2/admin/caring-community/copilot/proposals/${rejectTargetId}/reject`,
        { reason },
      );
      const updated = res.data?.proposal ?? null;
      if (updated) {
        setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        showToast(t('municipal_copilot.toasts.rejected'), 'success');
      }
      rejectDisclosure.onClose();
      setRejectTargetId(null);
      setRejectReason('');
    } catch {
      showToast(t('municipal_copilot.toasts.reject_failed'), 'error');
    } finally {
      setRejecting(false);
    }
  }, [rejectTargetId, rejectReason, rejectDisclosure, showToast, t]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('municipal_copilot.meta.title')}
        subtitle={t('municipal_copilot.meta.subtitle')}
        icon={<Wand2 size={20} />}
        actions={
          <Button
            size="sm"
            variant="tertiary"
            startContent={<RefreshCw size={14} />}
            onPress={load}
            isLoading={loading}
          >
            {t('municipal_copilot.actions.refresh')}
          </Button>
        }
      />

      <Card className="border-l-4 border-l-accent bg-accent-soft dark:bg-accent-soft">
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('municipal_copilot.about.title')}</p>
              <p className="text-foreground">
                {t('municipal_copilot.about.body')}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Two-column workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Draft input */}
        <Card>
          <CardHeader className="pb-2">
            <span className="font-semibold text-sm">{t('municipal_copilot.sections.new_draft')}</span>
          </CardHeader>
          <CardBody className="pt-0 space-y-3">
            <Textarea
              label={t('municipal_copilot.fields.draft_announcement')}
              placeholder={t('municipal_copilot.fields.draft_placeholder')}
              minRows={8}
              maxRows={16}
              value={draft}
              onValueChange={setDraft}
              description={t('municipal_copilot.fields.character_count', { count: draft.length })}
              variant="secondary"
            />
            <Input
              label={t('municipal_copilot.fields.audience_hint')}
              placeholder={t('municipal_copilot.fields.audience_placeholder')}
              value={audienceHint}
              onValueChange={setAudienceHint}
              description={t('municipal_copilot.fields.audience_description')}
              variant="secondary"
            />
            <div className="flex justify-end">
              <Button
                variant="primary"
                startContent={<Sparkles size={15} />}
                onPress={handleGenerate}
                isLoading={generating}
                isDisabled={draft.trim() === ''}
              >
                {t('municipal_copilot.actions.generate_proposal')}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Right: Latest proposal preview */}
        <Card>
          <CardHeader className="pb-2 flex items-center justify-between">
            <span className="font-semibold text-sm">{t('municipal_copilot.sections.latest_proposal')}</span>
            {latest && (
              <Chip size="sm" color={STATUS_COLORS[latest.status]} variant="soft">
                {t(`municipal_copilot.status.${latest.status}`)}
              </Chip>
            )}
          </CardHeader>
          <CardBody className="pt-0 space-y-3">
            {!latest && (
                <p className="text-sm text-muted">
                {t('municipal_copilot.empty.no_latest')}
              </p>
            )}
            {latest && (
              <>
                <Textarea
                  label={t('municipal_copilot.fields.polished_text')}
                  value={latest.polished_text}
                  minRows={6}
                  maxRows={14}
                  isReadOnly
                  variant="secondary"
                />

                <div className="flex flex-wrap gap-2 items-center">
                  <Chip
                    size="sm"
                    color={TONE_COLORS[latest.tone_assessment] ?? 'default'}
                    variant="soft"
                  >
                    {t(`municipal_copilot.tone.${latest.tone_assessment}`)}
                  </Chip>
                  <Chip size="sm" variant="soft" color="accent">
                    {t('municipal_copilot.labels.audience', { audience: latest.audience_suggestion })}
                  </Chip>
                  <Chip size="sm" variant="soft" color="default">
                    {t('municipal_copilot.labels.model', { model: latest.model_used })}
                  </Chip>
                </div>
                <p className="text-xs text-muted">
                  {t('municipal_copilot.tone_legend.prefix')} <span className="font-medium">{t('municipal_copilot.tone.too_formal')}</span>: {t('municipal_copilot.tone_legend.too_formal')}; <span className="font-medium">{t('municipal_copilot.tone.too_informal')}</span>: {t('municipal_copilot.tone_legend.too_informal')}; <span className="font-medium">{t('municipal_copilot.tone.condescending')}</span>: {t('municipal_copilot.tone_legend.condescending')}; <span className="font-medium">{t('municipal_copilot.tone.ok')}</span>: {t('municipal_copilot.tone_legend.ok')}.
                </p>

                {latest.clarity_warnings.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-foreground">{t('municipal_copilot.sections.clarity_warnings')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {latest.clarity_warnings.map((w, i) => (
                        <Chip
                          key={`cw-${i}`}
                          size="sm"
                          color="warning"
                          variant="soft"
                          startContent={<AlertTriangle size={12} />}
                        >
                          {w}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}

                {latest.moderation_flags.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-foreground">{t('municipal_copilot.sections.moderation_flags')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {latest.moderation_flags.map((f, i) => (
                        <Chip
                          key={`mf-${i}`}
                          size="sm"
                          color="danger"
                          variant="soft"
                          startContent={<AlertTriangle size={12} />}
                        >
                          {f}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}

                {latest.status === 'accepted' && (
                  <>
                    <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-soft-foreground">
                      {t('municipal_copilot.states.accepted')}
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="primary"
                        startContent={<CheckCircle2 size={14} />}
                        onPress={() => handleAccept(latest)}
                      >
                        {t('municipal_copilot.actions.publish')}
                      </Button>
                    </div>
                  </>
                )}

                {latest.status === 'published' && latest.source_announcement_id != null && (
                  <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success-soft-foreground">
                    {t('municipal_copilot.states.published', { id: latest.source_announcement_id })}
                  </div>
                )}

                {latest.status === 'rejected' && latest.rejection_reason && (
                  <div className="rounded-md border border-border bg-surface-secondary px-3 py-2 text-xs text-foreground">
                    {t('municipal_copilot.states.rejected_reason', { reason: latest.rejection_reason })}
                  </div>
                )}

                {latest.status === 'proposed' && (
                  <>
                    <Separator />
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="tertiary"
                        startContent={<XCircle size={14} />}
                        onPress={() => openReject(latest.id)}
                      >
                        {t('municipal_copilot.actions.reject')}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        startContent={<CheckCircle2 size={14} />}
                        onPress={() => handleAccept(latest)}
                      >
                        {t('municipal_copilot.actions.accept')}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Recent proposals table */}
      <Card>
        <CardHeader className="pb-2">
          <span className="font-semibold text-sm">{t('municipal_copilot.sections.recent_proposals')}</span>
        </CardHeader>
        <CardBody className="pt-0">
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : proposals.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">
              {t('municipal_copilot.empty.no_proposals')}
            </p>
          ) : (
            <Table aria-label={t('municipal_copilot.table.aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('municipal_copilot.table.status')}</TableColumn>
                <TableColumn>{t('municipal_copilot.table.draft')}</TableColumn>
                <TableColumn>{t('municipal_copilot.table.audience')}</TableColumn>
                <TableColumn>{t('municipal_copilot.table.tone')}</TableColumn>
                <TableColumn>{t('municipal_copilot.table.created')}</TableColumn>
                <TableColumn>{t('municipal_copilot.table.actions')}</TableColumn>
              </TableHeader>
              <TableBody>
                {proposals.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Chip size="sm" color={STATUS_COLORS[p.status]} variant="soft">
                        {t(`municipal_copilot.status.${p.status}`)}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-foreground">
                        {truncate(p.draft_text, 80)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs">{p.audience_suggestion}</span>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={TONE_COLORS[p.tone_assessment] ?? 'default'}
                      >
                        {t(`municipal_copilot.tone.${p.tone_assessment}`)}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted">{formatTime(p.created_at, t)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onPress={() => setLatestId(p.id)}
                        >
                          {t('municipal_copilot.actions.view')}
                        </Button>
                        {p.status === 'proposed' && (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              onPress={() => handleAccept(p)}
                            >
                              {t('municipal_copilot.actions.accept')}
                            </Button>
                            <Button
                              size="sm"
                              variant="tertiary"
                              onPress={() => openReject(p.id)}
                            >
                              {t('municipal_copilot.actions.reject')}
                            </Button>
                          </>
                        )}
                        {p.status === 'accepted' && (
                          <Button
                            size="sm"
                            variant="primary"
                            onPress={() => handleAccept(p)}
                          >
                            {t('municipal_copilot.actions.publish')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Reject modal */}
      <Modal isOpen={rejectDisclosure.isOpen} onOpenChange={rejectDisclosure.onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t('municipal_copilot.modal.reject_title')}</ModalHeader>
              <ModalBody>
                <Textarea
                  label={t('municipal_copilot.fields.reason')}
                  placeholder={t('municipal_copilot.fields.reason_placeholder')}
                  value={rejectReason}
                  onValueChange={setRejectReason}
                  minRows={3}
                  maxRows={8}
                  variant="secondary"
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose} isDisabled={rejecting}>
                  {t('municipal_copilot.actions.cancel')}
                </Button>
                <Button
                  variant="danger"
                  onPress={handleReject}
                  isLoading={rejecting}
                  isDisabled={rejectReason.trim() === ''}
                >
                  {t('municipal_copilot.actions.reject_proposal')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
