// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';

import ShieldCheck from 'lucide-react/icons/shield-check';
import GraduationCap from 'lucide-react/icons/graduation-cap';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import FileWarning from 'lucide-react/icons/file-warning';
import Calendar from 'lucide-react/icons/calendar';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { useTenant, useToast } from '@/contexts';
import { memberStatusKey } from '@/lib/incidentStatus';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { ReportIncidentModal } from './ReportIncidentModal';

interface Training { id: number; training_type: 'children_first' | 'vulnerable_adults' | 'first_aid' | 'manual_handling' | 'other'; training_name: string; provider: string | null; completed_at: string; expires_at: string | null; status: 'pending' | 'verified' | 'expired' | 'rejected'; created_at: string; }
interface Incident { id: number; title: string; description: string; severity: 'low' | 'medium' | 'high' | 'critical'; category: string; status: 'open' | 'investigating' | 'resolved' | 'escalated' | 'closed'; created_at: string; incident_date?: string | null; organization_name?: string | null; }
type SubView = 'training' | 'incidents';

const TRAINING_TYPE_KEYS = ['children_first', 'vulnerable_adults', 'first_aid', 'manual_handling', 'other'] as const;

function trainingStatusColor(s: Training['status']): 'warning'|'success'|'danger' { if (s==='pending') return 'warning'; if (s==='verified') return 'success'; return 'danger'; }
function severityColor(s: Incident['severity']): 'default'|'warning'|'danger' { if (s==='low') return 'default'; if (s==='medium') return 'warning'; return 'danger'; }
function incidentStatusColor(s: Incident['status']): 'warning'|'success'|'danger'|'primary'|'default' { if (s==='open') return 'warning'; if (s==='investigating') return 'primary'; if (s==='resolved') return 'success'; if (s==='escalated') return 'danger'; return 'default'; }

const cV = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } } };
const iV = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } };

export function SafeguardingTab() {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const [subView, setSubView] = useState<SubView>('training');
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const trainingModal = useDisclosure();
  const [trainingForm, setTrainingForm] = useState({ training_type: 'children_first', training_name: '', provider: '', completed_at: '', expires_at: '' });
  const [isSubmittingTraining, setIsSubmittingTraining] = useState(false);
  const incidentModal = useDisclosure();
  const { tenantPath } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();

  // "Make a new report" links (e.g. from a closed report's page) arrive with
  // ?report=1: open the form once, then drop the flag so a refresh does not.
  const openIncidentModal = incidentModal.onOpen;
  useEffect(() => {
    if (searchParams.get('report') !== '1') return;
    setSubView('incidents');
    openIncidentModal();
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete('report'); return next; }, { replace: true });
  }, [searchParams, setSearchParams, openIncidentModal]);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true); setError(null);
      const [tRes, iRes] = await Promise.all([api.get<{ items: Training[]; cursor?: string | null; has_more?: boolean }>('/v2/volunteering/training'), api.get<{ items: Incident[]; total?: number; page?: number; per_page?: number }>('/v2/volunteering/incidents')]);
      if (controller.signal.aborted) return;
      let anyFailed = false;
      if (tRes.success && tRes.data) {
        const tPayload = tRes.data as Record<string, unknown>;
        setTrainings(Array.isArray(tPayload.items) ? tPayload.items as Training[] : Array.isArray(tRes.data) ? tRes.data as unknown as Training[] : []);
      } else {
        anyFailed = true;
      }
      if (iRes.success && iRes.data) {
        const iPayload = iRes.data as Record<string, unknown>;
        setIncidents(Array.isArray(iPayload.items) ? iPayload.items as Incident[] : Array.isArray(iRes.data) ? iRes.data as unknown as Incident[] : []);
      } else {
        anyFailed = true;
      }
      // Surface an error (with retry) if either fetch failed, instead of silently
      // showing an empty tab while leaving the other list stale.
      if (anyFailed) {
        setError(tRef.current('safeguarding.load_error'));
      }
    } catch (err) { if (controller.signal.aborted) return; logError('Failed to load safeguarding data', err); setError(tRef.current('safeguarding.load_error')); }
    finally { if (!controller.signal.aborted) setIsLoading(false); }
  }, []);
  useEffect(() => { load(); return () => { abortRef.current?.abort(); }; }, [load]);

  const handleSubmitTraining = async () => {
    if (!trainingForm.training_name.trim() || !trainingForm.completed_at) { toastRef.current.error(tRef.current('safeguarding.fill_required')); return; }
    try {
      setIsSubmittingTraining(true);
      const res = await api.post('/v2/volunteering/training', { training_type: trainingForm.training_type, training_name: trainingForm.training_name.trim(), provider: trainingForm.provider.trim() || null, completed_at: trainingForm.completed_at, expires_at: trainingForm.expires_at || null });
      if (res.success) { trainingModal.onClose(); setTrainingForm({ training_type: 'children_first', training_name: '', provider: '', completed_at: '', expires_at: '' }); toastRef.current.success(tRef.current('safeguarding.training_added')); load(); }
      else { toastRef.current.error(tRef.current('safeguarding.training_failed')); }
    } catch (err) { logError('Failed to submit training record', err); toastRef.current.error(tRef.current('safeguarding.training_failed')); }
    finally { setIsSubmittingTraining(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-rose-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('safeguarding.heading')}</h2>
        </div>
        {/* Gap C9: reporting a concern is one press from either view; it used to
            appear only after switching to Incident Reports. */}
        <div className="flex flex-wrap gap-2 sm:shrink-0">
          {subView === 'training' && (
            <Button size="sm" variant="secondary" startContent={<Plus className="w-4 h-4" aria-hidden="true" />} onPress={trainingModal.onOpen}>
              {t('safeguarding.add_training')}
            </Button>
          )}
          <Button size="sm" className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" startContent={<FileWarning className="w-4 h-4" aria-hidden="true" />} onPress={incidentModal.onOpen}>
            {t('safeguarding.report_incident')}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={subView === 'training' ? 'primary' : 'tertiary'} className={subView === 'training' ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white' : 'bg-theme-elevated text-theme-muted'} startContent={<GraduationCap className="w-4 h-4" aria-hidden="true" />} onPress={() => setSubView('training')}>{t('safeguarding.training_records')}</Button>
        <Button size="sm" variant={subView === 'incidents' ? 'primary' : 'tertiary'} className={subView === 'incidents' ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white' : 'bg-theme-elevated text-theme-muted'} startContent={<FileWarning className="w-4 h-4" aria-hidden="true" />} onPress={() => setSubView('incidents')}>{t('safeguarding.incident_reports')}</Button>
      </div>
      {error && !isLoading && (<GlassCard className="p-8 text-center" role="alert"><AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" /><p className="text-theme-muted mb-4">{error}</p><Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />} onPress={load}>{t('safeguarding.try_again')}</Button></GlassCard>)}
      {!error && isLoading && (<div className="space-y-3" role="status" aria-busy="true" aria-label={t('common:loading')}>{[1, 2, 3].map((i) => (<CardRowsSkeleton key={i} />))}</div>)}
      {!error && !isLoading && subView === 'training' && (trainings.length === 0 ? (<EmptyState icon={<GraduationCap className="w-12 h-12" aria-hidden="true" />} title={t('safeguarding.no_training_title')} description={t('safeguarding.no_training_desc')} action={<Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={trainingModal.onOpen}>{t('safeguarding.add_training')}</Button>} />) : (
        <motion.div variants={cV} initial="hidden" animate="visible" className="space-y-3">
          {trainings.map((tr) => (<motion.div key={tr.id} variants={iV}><GlassCard className="p-4"><div className="flex items-start justify-between gap-3"><div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-1"><span className="text-sm font-semibold text-theme-primary">{tr.training_name}</span><Chip size="sm" color={trainingStatusColor(tr.status)} variant="soft">{t(`safeguarding.status_${tr.status}`)}</Chip></div><p className="text-xs text-theme-muted">{t(`safeguarding.training_types.${tr.training_type}`)}{tr.provider && ` — ${tr.provider}`}</p><div className="flex items-center gap-3 mt-1 text-xs text-theme-subtle"><span className="flex items-center gap-1"><Calendar className="w-3 h-3" aria-hidden="true" />{t('safeguarding.completed')}: {new Date(tr.completed_at).toLocaleDateString(getFormattingLocale())}</span>{tr.expires_at && (<span>{t('safeguarding.expires')}: {new Date(tr.expires_at).toLocaleDateString(getFormattingLocale())}</span>)}</div></div></div></GlassCard></motion.div>))}
        </motion.div>))}
      {!error && !isLoading && subView === 'incidents' && (incidents.length === 0 ? (<EmptyState icon={<FileWarning className="w-12 h-12" aria-hidden="true" />} title={t('safeguarding.no_incidents_title')} description={t('safeguarding.no_incidents_desc')} action={<Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={incidentModal.onOpen}>{t('safeguarding.report_incident')}</Button>} />) : (
        <motion.div variants={cV} initial="hidden" animate="visible" className="space-y-3">
          {incidents.map((inc) => (<motion.div key={inc.id} variants={iV}><GlassCard className="p-4"><div className="flex items-start justify-between gap-3"><div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2 mb-1"><span className="text-xs text-theme-subtle">#{inc.id}</span><Link to={tenantPath(`/volunteering/incidents/${inc.id}`)} className="text-sm font-semibold text-theme-primary hover:underline">{inc.title}</Link><Chip size="sm" color={severityColor(inc.severity)} variant="soft" className={inc.severity === 'critical' ? 'font-bold' : ''}>{t(`safeguarding.severity_options.${inc.severity}`)}</Chip><Chip size="sm" color={incidentStatusColor(inc.status)} variant="soft">{t(memberStatusKey(inc.status))}</Chip></div><p className="text-xs text-theme-muted line-clamp-2">{inc.description}</p><div className="flex items-center gap-3 mt-1 text-xs text-theme-subtle">{inc.organization_name && <span>{inc.organization_name}</span>}{inc.category && <span>{inc.category}</span>}<span>{new Date(inc.incident_date || inc.created_at).toLocaleDateString(getFormattingLocale())}</span></div></div></div></GlassCard></motion.div>))}
        </motion.div>))}
      <Modal isOpen={trainingModal.isOpen} onClose={() => { setTrainingForm({ training_type: 'children_first', training_name: '', provider: '', completed_at: '', expires_at: '' }); trainingModal.onClose(); }} size="lg" classNames={{ base: 'bg-overlay border border-theme-default' }}><ModalContent><ModalHeader className="text-theme-primary"><ModalHeading className="flex items-center gap-2"><GraduationCap className="w-5 h-5 text-rose-400" aria-hidden="true" />{t('safeguarding.add_training_title')}</ModalHeading></ModalHeader><ModalBody className="space-y-4"><Select label={t('safeguarding.training_type')} selectedKeys={new Set([trainingForm.training_type])} onSelectionChange={(keys) => { const val = Array.from(keys)[0] as string; if (val) setTrainingForm((f) => ({ ...f, training_type: val })); }} classNames={{ trigger: 'bg-theme-elevated border-theme-default' }}>{TRAINING_TYPE_KEYS.map((key) => (<SelectItem key={key} id={key}>{t(`safeguarding.training_types.${key}`)}</SelectItem>))}</Select><Input label={t('safeguarding.training_name')} isRequired value={trainingForm.training_name} onChange={(e) => setTrainingForm((f) => ({ ...f, training_name: e.target.value }))} classNames={{ inputWrapper: 'bg-theme-elevated border-theme-default' }} /><Input label={t('safeguarding.provider')} value={trainingForm.provider} onChange={(e) => setTrainingForm((f) => ({ ...f, provider: e.target.value }))} classNames={{ inputWrapper: 'bg-theme-elevated border-theme-default' }} /><Input label={t('safeguarding.completed_at')} type="date" isRequired value={trainingForm.completed_at} onChange={(e) => setTrainingForm((f) => ({ ...f, completed_at: e.target.value }))} classNames={{ inputWrapper: 'bg-theme-elevated border-theme-default' }} /><Input label={t('safeguarding.expires_at')} type="date" value={trainingForm.expires_at} onChange={(e) => setTrainingForm((f) => ({ ...f, expires_at: e.target.value }))} classNames={{ inputWrapper: 'bg-theme-elevated border-theme-default' }} /></ModalBody><ModalFooter><Button variant="tertiary" onPress={() => { setTrainingForm({ training_type: 'children_first', training_name: '', provider: '', completed_at: '', expires_at: '' }); trainingModal.onClose(); }}>{t('safeguarding.cancel')}</Button><Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={handleSubmitTraining} isLoading={isSubmittingTraining} startContent={!isSubmittingTraining ? <Plus className="w-4 h-4" aria-hidden="true" /> : undefined}>{t('safeguarding.submit_training')}</Button></ModalFooter></ModalContent></Modal>
      <ReportIncidentModal isOpen={incidentModal.isOpen} onClose={incidentModal.onClose} onReported={() => { void load(); }} />
    </div>
  );
}

export default SafeguardingTab;
