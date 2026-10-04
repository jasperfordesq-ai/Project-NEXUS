import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { Button, Chip, Spinner, Textarea, Card, CardBody, Select, SelectItem, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';
// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AG71 â€” Pilot Region Inquiry Admin Page
 *
 * Platform-level pipeline board for managing incoming Gemeinde
 * pilot inquiries.  English-only (admin panel policy).
 *
 * GET  /v2/admin/pilot-inquiries
 * GET  /v2/admin/pilot-inquiries/stats
 * GET  /v2/admin/pilot-inquiries/{id}
 * POST /v2/admin/pilot-inquiries/{id}/stage
 * POST /v2/admin/pilot-inquiries/{id}/assign
 * POST /v2/admin/pilot-inquiries/{id}/notes
 * GET  /v2/admin/pilot-inquiries/export
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Info from 'lucide-react/icons/info';
import MapPin from 'lucide-react/icons/map-pin';
import Users from 'lucide-react/icons/users';
import TrendingUp from 'lucide-react/icons/trending-up';
import CheckCircle from 'lucide-react/icons/check-circle';
import Clock from 'lucide-react/icons/clock';
import Star from 'lucide-react/icons/star';
import FileText from 'lucide-react/icons/file-text';
import Download from 'lucide-react/icons/download';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface PilotInquiry {
  id: number;
  municipality_name: string;
  region: string | null;
  country: string;
  population: number | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  contact_role: string | null;
  has_kiss_cooperative: number;
  has_existing_digital_tool: number;
  existing_tool_name: string | null;
  timeline_months: number | null;
  interest_modules: string | null;  // JSON string
  budget_indication: string | null;
  notes: string | null;
  fit_score: number | null;
  fit_breakdown: string | null;     // JSON string
  stage: string;
  assigned_to: number | null;
  assigned_user_name: string | null;
  assigned_user_email: string | null;
  proposal_sent_at: string | null;
  pilot_agreed_at: string | null;
  went_live_at: string | null;
  rejection_reason: string | null;
  internal_notes: string | null;
  source: string | null;
  created_at: string;
}

interface PipelineStats {
  total: number;
  avg_fit_score: number;
  by_stage: Record<string, { count: number; avg_fit_score: number }>;
  by_country: Array<{ country: string; count: number }>;
  avg_days_to_proposal: number | null;
  avg_days_to_agreed: number | null;
  avg_days_to_live: number | null;
}

const STAGES = [
  { key: 'new',           color: 'default' },
  { key: 'qualified',     color: 'primary' },
  { key: 'proposal_sent', color: 'warning' },
  { key: 'pilot_agreed',  color: 'success' },
  { key: 'live',          color: 'success' },
  { key: 'rejected',      color: 'danger' },
  { key: 'dormant',       color: 'default' },
] as const;

type StageKey = typeof STAGES[number]['key'];

function stageConfig(stage: string) {
  return STAGES.find(s => s.key === stage) ?? { key: 'unknown', color: 'default' as const };
}

function stageTranslationKey(stage: string) {
  return STAGES.some(s => s.key === stage) ? `stages.${stage}` : 'stages.unknown';
}

// â”€â”€â”€ Fit score chip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function FitChip({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted">â€”</span>;
  const color = score >= 60 ? 'success' : score >= 40 ? 'warning' : 'default';
  return (
    <Chip size="sm" color={color} variant="soft">
      {formatNumber(score, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
    </Chip>
  );
}

// â”€â”€â”€ Inquiry card (pipeline view) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function InquiryCard({
  inquiry,
  onClick,
}: {
  inquiry: PilotInquiry;
  onClick: () => void;
}) {
  const { t } = useTranslation('admin_super', { keyPrefix: 'pilot_inquiry_admin' });
  const sc = stageConfig(inquiry.stage);
  return (
    <Card
      isPressable
      onPress={onClick}
      className="cursor-pointer hover:shadow-md transition-shadow"
    >
      <CardBody className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-sm leading-tight">{inquiry.municipality_name}</p>
            <p className="text-xs text-muted">
              {inquiry.region ? t('values.country_region', { country: inquiry.country, region: inquiry.region }) : inquiry.country}
            </p>
          </div>
          <FitChip score={inquiry.fit_score} />
        </div>
        <p className="text-xs text-muted">{inquiry.contact_name}</p>
        <div className="flex items-center justify-between">
          <Chip size="sm" color={sc.color as never} variant="soft">
            {t(stageTranslationKey(inquiry.stage), { stage: inquiry.stage })}
          </Chip>
          {inquiry.assigned_user_name?.trim() && (
            <span className="text-xs text-muted truncate max-w-[100px]">{inquiry.assigned_user_name.trim()}</span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

// â”€â”€â”€ Detail modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function InquiryDetailModal({
  inquiry,
  isOpen,
  onClose,
  onRefresh,
}: {
  inquiry: PilotInquiry | null;
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const toast = useToast();
  const { t } = useTranslation('admin_super', { keyPrefix: 'pilot_inquiry_admin' });
  const { t: tCommon } = useTranslation('common');
  const [newStage, setNewStage]         = useState('');
  const [rejectionReason, setRejReason] = useState('');
  const [internalNotes, setNotes]       = useState('');
  const [saving, setSaving]             = useState(false);

  useEffect(() => {
    if (inquiry) {
      setNewStage(inquiry.stage);
      setNotes(inquiry.internal_notes ?? '');
      setRejReason(inquiry.rejection_reason ?? '');
    }
  }, [inquiry]);

  if (!inquiry) return null;

  async function saveStage() {
    setSaving(true);
    try {
      const res = await api.post(`/v2/admin/pilot-inquiries/${inquiry!.id}/stage`, {
        stage: newStage,
        rejection_reason: newStage === 'rejected' ? rejectionReason : undefined,
      });
      if (res.success) {
        toast.success(t('toasts.stage_updated'));
        onRefresh();
        onClose();
      } else {
        toast.error(t('toasts.stage_update_failed'));
      }
    } catch (err) {
      logError('stage update failed', err);
      toast.error(t('toasts.stage_update_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function saveNotes() {
    setSaving(true);
    try {
      const res = await api.post(`/v2/admin/pilot-inquiries/${inquiry!.id}/notes`, { internal_notes: internalNotes });
      if (res.success) {
        toast.success(t('toasts.notes_saved'));
        onRefresh();
      } else {
        toast.error(t('toasts.notes_save_failed'));
      }
    } catch (err) {
      logError('notes save failed', err);
      toast.error(t('toasts.notes_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  // Parse JSON fields safely
  let modules: string[] = [];
  try { modules = JSON.parse(inquiry.interest_modules ?? '[]'); } catch { /* ignore */ }

  let breakdown: Record<string, number> = {};
  try { breakdown = JSON.parse(inquiry.fit_breakdown ?? '{}'); } catch { /* ignore */ }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-accent" />
          {inquiry.municipality_name}
          <FitChip score={inquiry.fit_score} />
        </ModalHeader>
        <ModalBody className="space-y-4 text-sm">
          {/* Municipality info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted text-xs uppercase tracking-wide mb-0.5">{t('fields.country_region')}</p>
              <p>{inquiry.region ? t('values.country_region', { country: inquiry.country, region: inquiry.region }) : inquiry.country}</p>
            </div>
            <div>
              <p className="text-muted text-xs uppercase tracking-wide mb-0.5">{t('fields.population')}</p>
              <p>{inquiry.population?.toLocaleString(getFormattingLocale()) ?? t('values.empty')}</p>
            </div>
            <div>
              <p className="text-muted text-xs uppercase tracking-wide mb-0.5">{tCommon('nav.caring_community')} {t('fields.cooperative')}</p>
              <p>{inquiry.has_kiss_cooperative ? t('values.yes') : t('values.no')}</p>
            </div>
            <div>
              <p className="text-muted text-xs uppercase tracking-wide mb-0.5">{t('fields.existing_digital_tool')}</p>
              <p>{inquiry.has_existing_digital_tool ? (inquiry.existing_tool_name ?? t('values.yes')) : t('values.no')}</p>
            </div>
          </div>

          {/* Contact */}
          <div>
            <p className="text-muted text-xs uppercase tracking-wide mb-1">{t('fields.contact')}</p>
            <p className="font-medium">{inquiry.contact_name}</p>
            <p className="text-accent">{inquiry.contact_email}</p>
            {inquiry.contact_phone && <p>{inquiry.contact_phone}</p>}
            {inquiry.contact_role && <p className="text-muted">{inquiry.contact_role}</p>}
          </div>

          {/* Modules + timeline + budget */}
          {modules.length > 0 && (
            <div>
              <p className="text-muted text-xs uppercase tracking-wide mb-1">{t('fields.modules_of_interest')}</p>
              <div className="flex flex-wrap gap-1">
                {modules.map((m: string) => (
                  <Chip key={m} size="sm" variant="soft" color="accent">
                    {t(`module_values.${m}`, { defaultValue: t('module_values.unknown') })}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted text-xs uppercase tracking-wide mb-0.5">{t('fields.timeline')}</p>
              <p>{inquiry.timeline_months === 0 ? t('values.asap') : inquiry.timeline_months ? t('values.months', { count: inquiry.timeline_months }) : t('values.empty')}</p>
            </div>
            <div>
              <p className="text-muted text-xs uppercase tracking-wide mb-0.5">{t('fields.budget')}</p>
              <p>
                {inquiry.budget_indication
                  ? t(`budget_values.${inquiry.budget_indication}`, { defaultValue: t('budget_values.unknown') })
                  : t('values.empty')}
              </p>
            </div>
          </div>

          {/* Notes */}
          {inquiry.notes && (
            <div>
              <p className="text-muted text-xs uppercase tracking-wide mb-0.5">{t('fields.notes_from_gemeinde')}</p>
              <p className="text-foreground italic">{inquiry.notes}</p>
            </div>
          )}

          {/* Fit score breakdown */}
          {Object.keys(breakdown).length > 0 && (
            <div>
              <p className="text-muted text-xs uppercase tracking-wide mb-1">{t('fields.fit_score_breakdown')}</p>
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(breakdown).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between text-xs bg-surface-secondary rounded px-2 py-1">
                    <span>{t(`breakdown.${key}`, { defaultValue: t('breakdown.unknown') })}</span>
                    <span className="font-semibold text-accent">{formatNumber(val, { signDisplay: 'always' })}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs bg-accent-soft rounded px-2 py-1 font-semibold col-span-2">
                  <span>{t('fields.total')}</span>
                  <span>{inquiry.fit_score === null ? t('values.empty') : formatNumber(inquiry.fit_score, { maximumFractionDigits: 1 })}</span>
                </div>
              </div>
            </div>
          )}

          {/* Stage update */}
          <div className="border-t border-border pt-4">
            <p className="text-muted text-xs uppercase tracking-wide mb-2">{t('fields.update_stage')}</p>
            <Select
              size="sm"
              selectedKeys={newStage ? [newStage] : []}
              onSelectionChange={keys => setNewStage(Array.from(keys)[0] as string ?? '')}
              variant="secondary"
            >
              {STAGES.map(s => (
                <SelectItem key={s.key} id={s.key}>{t(`stages.${s.key}`)}</SelectItem>
              ))}
            </Select>
            {newStage === 'rejected' && (
              <Textarea
                className="mt-2"
                size="sm"
                placeholder={t('placeholders.rejection_reason')}
                value={rejectionReason}
                onValueChange={setRejReason}
              />
            )}
            <Button
              size="sm"
              className="mt-2"
              isLoading={saving}
              onPress={saveStage}
            >
              {t('actions.save_stage')}
            </Button>
          </div>

          {/* Internal notes */}
          <div className="border-t border-border pt-4">
            <p className="text-muted text-xs uppercase tracking-wide mb-2">{t('fields.internal_notes')}</p>
            <Textarea
              size="sm"
              minRows={2}
              value={internalNotes}
              onValueChange={setNotes}
              placeholder={t('placeholders.internal_notes')}
            />
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              isLoading={saving}
              onPress={saveNotes}
            >
              {t('actions.save_notes')}
            </Button>
          </div>

          {/* Timestamps */}
          <div className="border-t border-border pt-4 grid grid-cols-2 gap-2 text-xs text-muted">
            <div><span className="font-medium text-foreground">{t('timestamps.submitted')}:</span> {new Date(inquiry.created_at).toLocaleDateString(getFormattingLocale())}</div>
            {inquiry.proposal_sent_at && <div><span className="font-medium text-foreground">{t('timestamps.proposal')}:</span> {new Date(inquiry.proposal_sent_at).toLocaleDateString(getFormattingLocale())}</div>}
            {inquiry.pilot_agreed_at  && <div><span className="font-medium text-foreground">{t('timestamps.agreed')}:</span>   {new Date(inquiry.pilot_agreed_at).toLocaleDateString(getFormattingLocale())}</div>}
            {inquiry.went_live_at     && <div><span className="font-medium text-foreground">{t('timestamps.live')}:</span>      {new Date(inquiry.went_live_at).toLocaleDateString(getFormattingLocale())}</div>}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose}>{t('actions.close')}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// â”€â”€â”€ Main page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function PilotInquiryAdminPage() {
  const { t } = useTranslation('admin_super', { keyPrefix: 'pilot_inquiry_admin' });
  const { t: tAdmin } = useTranslation('admin_super');
  const { t: tCommon } = useTranslation('common');
  usePageTitle(t('page_title'));
  const toast = useToast();

  // api.download carries the admin's auth header; opening the API URL in a
  // new tab sent no token and showed "Authentication required".
  const handleExport = async () => {
    try {
      await api.download('/v2/admin/pilot-inquiries/export', {
        filename: `pilot-inquiries-${new Date().toISOString().slice(0, 10)}.csv`,
      });
    } catch {
      toast.error(tCommon('errors.download_failed'));
    }
  };

  const [inquiries, setInquiries]   = useState<PilotInquiry[]>([]);
  const [stats, setStats]           = useState<PipelineStats | null>(null);
  const [loading, setLoading]       = useState(true);
  const [stageFilter, setStageFilter] = useState<string>('');
  const [selected, setSelected]     = useState<PilotInquiry | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        api.get('/v2/admin/pilot-inquiries' + (stageFilter ? `?stage=${stageFilter}` : '')),
        api.get('/v2/admin/pilot-inquiries/stats'),
      ]);
      const listData  = 'data' in listRes  ? listRes.data  : listRes;
      const statsData = 'data' in statsRes ? statsRes.data : statsRes;
      setInquiries(Array.isArray(listData) ? listData : []);
      if (statsData && typeof statsData === 'object') setStats(statsData as PipelineStats);
    } catch (err) {
      logError('PilotInquiryAdminPage loadData', err);
      toast.error(t('toasts.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [stageFilter, toast, t]);

  useEffect(() => { loadData(); }, [loadData]);

  function openDetail(inquiry: PilotInquiry) {
    setSelected(inquiry);
    onOpen();
  }

  // In-pipeline = qualified + proposal_sent + pilot_agreed
  const inPipeline = stats
    ? (['qualified', 'proposal_sent', 'pilot_agreed'] as StageKey[])
        .reduce((acc, s) => acc + (stats.by_stage[s]?.count ?? 0), 0)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('page_title')}
        subtitle={t('page_subtitle')}
        icon={<MapPin className="w-6 h-6" />}
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              startContent={<RefreshCw className="w-4 h-4" />}
              onPress={loadData}
              isLoading={loading}
            >
              {t('actions.refresh')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              startContent={<Download className="w-4 h-4" />}
              onPress={handleExport}
            >
              {t('actions.export_csv')}
            </Button>
          </div>
        }
      />

      <Card className="border-l-4 border-l-accent bg-accent-soft">
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('about.title')}</p>
              <p className="text-foreground">
                {t('about.body_intro_before_gemeinden')}<em>{t('about.gemeinden')}</em>{t('about.body_intro_before_kiss')}
                {tCommon('nav.caring_community')}{t('about.body_intro_after_kiss')}
              </p>
              <p className="text-muted">
                <strong>{t('about.pipeline_stages_label')}</strong> {t('about.pipeline_stages')}{' '}
                {t('about.fit_score_before')}<strong>{t('about.fit_score_label')}</strong>{t('about.fit_score_after')}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Fit score scale */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-xs text-muted">
        <span className="font-medium text-foreground">{t('fit_scale.title')}</span>
        <span className="flex items-center gap-1.5"><Chip size="sm" color="success" variant="soft">60-100</Chip>{t('fit_scale.good')}</span>
        <span className="flex items-center gap-1.5"><Chip size="sm" color="warning" variant="soft">40-59</Chip>{t('fit_scale.potential')}</span>
        <span className="flex items-center gap-1.5"><Chip size="sm" color="default" variant="soft">0-39</Chip>{t('fit_scale.weak')}</span>
        <span className="ml-3 text-muted">{t('fit_scale.factors_before_kiss')}{tCommon('nav.caring_community')}{t('fit_scale.factors_after_kiss')}</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          title={t('stats.total_inquiries')}
          value={stats?.total ?? 0}
          icon={<FileText className="w-5 h-5 text-accent" />}
        />
        <StatCard
          title={t('stats.qualified')}
          value={stats?.by_stage['qualified']?.count ?? 0}
          icon={<Star className="w-5 h-5 text-amber-400" />}
        />
        <StatCard
          title={t('stats.in_pipeline')}
          value={inPipeline}
          icon={<TrendingUp className="w-5 h-5 text-emerald-400" />}
        />
        <StatCard
          title={t('stats.avg_fit_score')}
          value={stats ? formatNumber(stats.avg_fit_score, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : t('values.empty')}
          icon={<CheckCircle className="w-5 h-5 text-accent" />}
        />
      </div>

      {/* Stage timing */}
      {stats && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-foreground">{t('velocity.title')}</p>
          <div className="flex gap-4 text-xs text-muted flex-wrap">
          {stats.avg_days_to_proposal !== null && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" /> {t('velocity.avg_to_proposal')} <strong className="text-foreground">{t('velocity.days', { count: stats.avg_days_to_proposal })}</strong>
            </span>
          )}
          {stats.avg_days_to_agreed !== null && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" /> {t('velocity.avg_to_agreed')} <strong className="text-foreground">{t('velocity.days', { count: stats.avg_days_to_agreed })}</strong>
            </span>
          )}
          {stats.avg_days_to_live !== null && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" /> {t('velocity.avg_to_live')} <strong className="text-foreground">{t('velocity.days', { count: stats.avg_days_to_live })}</strong>
            </span>
          )}
          </div>
        </div>
      )}

      {/* Stage filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted">{t('filters.stage')}</span>
        <Button
          size="sm"
          variant={stageFilter === '' ? 'primary' : 'secondary'}
          onPress={() => setStageFilter('')}
        >
          {t('filters.all')}
        </Button>
        {STAGES.map(s => (
          <Button
            key={s.key}
            size="sm"
            variant={stageFilter === s.key ? 'primary' : 'secondary'}
            onPress={() => setStageFilter(stageFilter === s.key ? '' : s.key)}
          >
            {t(`stages.${s.key}`)}
            {stats?.by_stage[s.key] && (
              <span className="ml-1 opacity-60">({stats.by_stage[s.key]?.count ?? 0})</span>
            )}
          </Button>
        ))}
      </div>

      {/* Inquiry grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
        </div>
      ) : inquiries.length === 0 ? (
        <div className="text-center py-16 text-muted">
          <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground">{t('empty.title')}</p>
          <p className="text-sm mt-1 text-muted">
            {t('empty.body')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {inquiries.map(inq => (
            <InquiryCard
              key={inq.id}
              inquiry={inq}
              onClick={() => openDetail(inq)}
            />
          ))}
        </div>
      )}

      {/* By country summary */}
      {stats && stats.by_country.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-muted uppercase tracking-wide mb-2 flex items-center gap-1">
            <Users className="w-3 h-3" /> {t('summary.by_country')}
          </p>
          <div className="flex gap-2 flex-wrap">
            {stats.by_country.map(c => (
              <Chip key={c.country} size="sm" variant="soft">
                {c.country}: {c.count}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {/* Detail modal */}
      <InquiryDetailModal
        inquiry={selected}
        isOpen={isOpen}
        onClose={onClose}
        onRefresh={loadData}
      />
    </div>
  );
}

export default PilotInquiryAdminPage;
