// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The case file of one volunteering safeguarding incident, for community staff:
 * the report, what is being done about it, messages to the reporter and the
 * organisation, sharing the full report with the organisation's safeguarding
 * lead, and the history of everything that has happened.
 *
 * Each action saves on its own. Every change is written to the incident's
 * history by the server, so nothing here edits or removes a past entry.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Send from 'lucide-react/icons/send';
import Share2 from 'lucide-react/icons/share-2';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { getFormattingLocale } from '@/lib/helpers';
import { adminVolunteering } from '../../../api/adminApi';
import { EmptyState } from '../../../components/EmptyState';
import { BrokerSkeleton } from '@/broker/components/BrokerSkeleton';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Select,
  SelectItem,
  Switch,
  Textarea,
} from '@/components/ui';
import { IncidentTimeline, type StaffTimelineEvent } from './IncidentTimeline';
import { IncidentFilingFields, todayIso, type FilingValues } from './IncidentFilingFields';

// ── Types ──────────────────────────────────────────────────────────────────────

type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'escalated' | 'closed';

interface Person { id: number; name: string; }

export interface StaffIncidentCase {
  id: number;
  type: string;
  severity: string;
  status: IncidentStatus;
  incident_date: string | null;
  created_at: string;
  organization_id: number | null;
  organization_name: string | null;
  opportunity_id: number | null;
  opportunity_title: string | null;
  title: string;
  description: string;
  category?: string;
  reported_by: number;
  reporter_name: string | null;
  subject_user_id: number | null;
  involved_user_id: number | null;
  subject_name: string | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  authority_notified: boolean;
  authority_reference: string | null;
  share: { organization_id: number; shared_at: string } | null;
  timeline: StaffTimelineEvent[];
  handlers: Person[];
  organisation_leads: Person[];
}

const STATUSES: IncidentStatus[] = ['open', 'investigating', 'resolved', 'escalated', 'closed'];
/** Resolving, escalating or closing is a decision: the server asks why. */
const NEEDS_REASON: IncidentStatus[] = ['resolved', 'escalated', 'closed'];
const NO_HANDLER = 'none';

const STATUS_COLORS: Record<string, 'warning' | 'success' | 'danger' | 'accent' | 'default'> = {
  open: 'warning', investigating: 'accent', resolved: 'success', escalated: 'danger', closed: 'default',
};
const SEVERITY_COLORS: Record<string, 'success' | 'warning' | 'danger'> = {
  low: 'success', medium: 'warning', high: 'danger', critical: 'danger',
};

function parsePayload<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '--';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value.replace(' ', 'T'));
  return withTime ? date.toLocaleString(getFormattingLocale()) : date.toLocaleDateString(getFormattingLocale());
}

function filingFrom(c: StaffIncidentCase): FilingValues {
  return {
    type: c.type,
    severity: c.severity,
    date: (c.incident_date || '').slice(0, 10),
    organizationId: c.organization_id ? String(c.organization_id) : '',
    opportunityId: c.opportunity_id ? String(c.opportunity_id) : '',
  };
}

/** Which save produced an error, so it is shown beside the right section. */
type Section = 'status' | 'handler' | 'filing' | 'authority' | 'note' | 'message' | 'share';

// ── Component ──────────────────────────────────────────────────────────────────

interface VolunteerIncidentCaseProps {
  incidentId: number;
  /** The incidents list this case was opened from. */
  backPath: string;
}

export function VolunteerIncidentCase({ incidentId, backPath }: VolunteerIncidentCaseProps) {
  const { t } = useTranslation('admin_volunteering');
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [incident, setIncident] = useState<StaffIncidentCase | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
  const [busy, setBusy] = useState<Section | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Section, string>>>({});

  const [status, setStatus] = useState<IncidentStatus>('open');
  const [reason, setReason] = useState('');
  const [handlerId, setHandlerId] = useState(NO_HANDLER);
  const [filing, setFiling] = useState<FilingValues>({ type: 'concern', severity: 'medium', date: '', organizationId: '', opportunityId: '' });
  const [authorityNotified, setAuthorityNotified] = useState(false);
  const [authorityReference, setAuthorityReference] = useState('');
  const [note, setNote] = useState('');
  const [audience, setAudience] = useState<'reporter' | 'organisation'>('reporter');
  const [message, setMessage] = useState('');

  usePageTitle(incident ? `#${incident.id} ${incident.title}` : t('volunteering.safeguarding_page_title'));

  const load = useCallback(async () => {
    try {
      const res = await adminVolunteering.getIncidentCase(incidentId);
      if (!res.success || !res.data) {
        setLoadState(res.code === 'NOT_FOUND' ? 'missing' : 'failed');
        return;
      }
      const data = parsePayload<StaffIncidentCase>(res.data);
      setIncident(data);
      setStatus(data.status);
      setHandlerId(data.assigned_to ? String(data.assigned_to) : NO_HANDLER);
      setFiling(filingFrom(data));
      setAuthorityNotified(!!data.authority_notified);
      setAuthorityReference(data.authority_reference || '');
      setLoadState('ready');
    } catch {
      setLoadState('failed');
    }
  }, [incidentId]);

  useEffect(() => { void load(); }, [load]);

  const people = useMemo(() => {
    const map: Record<number, string> = {};
    (incident?.handlers ?? []).forEach((h) => { map[h.id] = h.name; });
    return map;
  }, [incident]);

  /** Runs one save, shows the server's own reason beside the section if refused, reloads on success. */
  const run = async (section: Section, call: () => Promise<{ success: boolean; error?: string }>, done?: () => void) => {
    setBusy(section);
    setErrors((e) => ({ ...e, [section]: undefined }));
    try {
      const res = await call();
      if (res.success) {
        done?.();
        toast.success(t('volunteering.case_saved'));
        await load();
      } else {
        // admin-i18n-ignore: localized server message — every refusal from the incident endpoints is rendered through __('api.vol_incident_*').
        setErrors((e) => ({ ...e, [section]: res.error || t('volunteering.failed_to_update_incident') }));
      }
    } catch {
      setErrors((e) => ({ ...e, [section]: t('volunteering.failed_to_update_incident') }));
    }
    setBusy(null);
  };

  if (loadState === 'loading') {
    return <BrokerSkeleton variant="detail" />;
  }
  if (loadState !== 'ready' || !incident) {
    return (
      <div className="space-y-4">
        <BackLink to={tenantPath(backPath)} label={t('volunteering.case_back')} />
        <EmptyState
          icon={ShieldAlert}
          title={loadState === 'missing' ? t('volunteering.case_not_found') : t('volunteering.failed_to_load_incidents')}
        />
      </div>
    );
  }

  const hasOrganisation = !!incident.organization_id;
  const handlerChoices = incident.handlers.filter(
    (h) => h.id !== incident.subject_user_id && h.id !== incident.involved_user_id,
  );

  const saveStatus = () => {
    if (status === incident.status) return;
    if (NEEDS_REASON.includes(status) && reason.trim() === '') {
      setErrors((e) => ({ ...e, status: t('volunteering.case_status_reason_required') }));
      return;
    }
    void run('status', () => adminVolunteering.updateIncident(incident.id, {
      status,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    }), () => setReason(''));
  };

  const saveHandler = () => {
    void run('handler', () => adminVolunteering.updateIncident(incident.id, {
      assigned_to: handlerId === NO_HANDLER ? null : Number(handlerId),
    }));
  };

  const saveFiling = () => {
    if (filing.date && filing.date > todayIso()) {
      setErrors((e) => ({ ...e, filing: t('volunteering.incident_date_future') }));
      return;
    }
    // Only what changed is sent: a newly linked organisation is told.
    const before = filingFrom(incident);
    const data: Parameters<typeof adminVolunteering.updateIncident>[1] = {};
    if (filing.type !== before.type) data.incident_type = filing.type;
    if (filing.severity !== before.severity) data.severity = filing.severity;
    if (filing.date && filing.date !== before.date) data.incident_date = filing.date;
    if (filing.organizationId !== before.organizationId || filing.opportunityId !== before.opportunityId) {
      data.organization_id = filing.organizationId ? Number(filing.organizationId) : null;
      data.opportunity_id = filing.opportunityId ? Number(filing.opportunityId) : null;
    }
    if (Object.keys(data).length === 0) return;
    void run('filing', () => adminVolunteering.updateIncident(incident.id, data));
  };

  const saveAuthority = () => {
    void run('authority', () => adminVolunteering.updateIncident(incident.id, {
      authority_notified: authorityNotified,
      authority_reference: authorityNotified ? authorityReference.trim() : '',
    }));
  };

  const addNote = () => {
    if (note.trim() === '') {
      setErrors((e) => ({ ...e, note: t('volunteering.case_text_required') }));
      return;
    }
    void run('note', () => adminVolunteering.addIncidentNote(incident.id, note.trim()), () => setNote(''));
  };

  const sendMessage = () => {
    if (message.trim() === '') {
      setErrors((e) => ({ ...e, message: t('volunteering.case_text_required') }));
      return;
    }
    void run('message', () => adminVolunteering.sendIncidentMessage(incident.id, audience, message.trim()), () => setMessage(''));
  };

  const shareReport = () => { void run('share', () => adminVolunteering.shareIncident(incident.id)); };
  const withdrawShare = () => { void run('share', () => adminVolunteering.withdrawIncidentShare(incident.id)); };

  const fieldError = (section: Section) => errors[section]
    ? <p role="alert" className="text-sm text-danger">{errors[section]}</p>
    : null;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="space-y-2">
        <BackLink to={tenantPath(backPath)} label={t('volunteering.case_back')} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">{t('volunteering.case_reference', { id: incident.id })}</span>
          <Chip size="sm" variant="soft" color={STATUS_COLORS[incident.status] || 'default'}>
            {t(`volunteering.status_${incident.status}`)}
          </Chip>
          <Chip size="sm" variant="soft" color={SEVERITY_COLORS[incident.severity] || 'default'}>
            {t(`volunteering.severity_${incident.severity}`)}
          </Chip>
        </div>
        <h1 className="text-2xl font-semibold">{incident.title}</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {/* ── The report ── */}
          <Card className="border border-divider/70 shadow-sm shadow-black/[0.03]">
            <CardHeader><h2 className="font-semibold">{t('volunteering.case_report_heading')}</h2></CardHeader>
            <CardBody className="space-y-4">
              <p className="whitespace-pre-line text-sm">{incident.description}</p>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <Fact label={t('volunteering.col_reporter')} value={incident.reporter_name} />
                <Fact label={t('volunteering.col_subject')} value={incident.subject_name} />
                <Fact label={t('volunteering.col_incident_type')} value={t(`volunteering.incident_type_${incident.type}`)} />
                <Fact label={t('volunteering.incident_date_label')} value={formatDate(incident.incident_date)} />
                <Fact label={t('volunteering.reported_on')} value={formatDate(incident.created_at, true)} />
                <Fact label={t('volunteering.col_handled_by')} value={incident.assigned_to_name || t('volunteering.handled_by_nobody')} />
                <Fact label={t('volunteering.col_organization')} value={incident.organization_name} />
                <Fact label={t('volunteering.col_opportunity')} value={incident.opportunity_title} />
              </dl>
            </CardBody>
          </Card>

          {/* ── What is being done ── */}
          <Card className="border border-divider/70 shadow-sm shadow-black/[0.03]">
            <CardHeader><h2 className="font-semibold">{t('volunteering.case_actions_heading')}</h2></CardHeader>
            <CardBody className="space-y-6">
              <section aria-labelledby="case-status" className="space-y-3">
                <h3 id="case-status" className="text-sm font-semibold">{t('volunteering.status')}</h3>
                <Select
                  label={t('volunteering.status')}
                  selectedKeys={[status]}
                  onSelectionChange={(keys) => setStatus(((Array.from(keys)[0] as IncidentStatus) || status))}
                >
                  {STATUSES.map((s) => <SelectItem key={s} id={s}>{t(`volunteering.status_${s}`)}</SelectItem>)}
                </Select>
                <Textarea
                  label={t('volunteering.case_status_reason')}
                  description={t('volunteering.case_status_reason_help')}
                  value={reason}
                  maxLength={5000}
                  onValueChange={(v) => { setReason(v); setErrors((e) => ({ ...e, status: undefined })); }}
                />
                {fieldError('status')}
                <Button variant="primary" onPress={saveStatus} isLoading={busy === 'status'} isDisabled={status === incident.status}>
                  {t('volunteering.case_save_status')}
                </Button>
              </section>

              <section aria-labelledby="case-handler" className="space-y-3">
                <h3 id="case-handler" className="text-sm font-semibold">{t('volunteering.handled_by_label')}</h3>
                <Select
                  label={t('volunteering.handled_by_label')}
                  description={t('volunteering.handled_by_help')}
                  selectedKeys={[handlerId]}
                  onSelectionChange={(keys) => setHandlerId((Array.from(keys)[0] as string) || NO_HANDLER)}
                >
                  {[
                    <SelectItem key={NO_HANDLER} id={NO_HANDLER}>{t('volunteering.handled_by_nobody')}</SelectItem>,
                    // Nobody handles an incident about themselves (F-507).
                    ...handlerChoices.map((h) => <SelectItem key={String(h.id)} id={String(h.id)}>{h.name}</SelectItem>),
                  ]}
                </Select>
                {fieldError('handler')}
                <Button
                  variant="secondary"
                  onPress={saveHandler}
                  isLoading={busy === 'handler'}
                  isDisabled={handlerId === (incident.assigned_to ? String(incident.assigned_to) : NO_HANDLER)}
                >
                  {t('volunteering.case_save_handler')}
                </Button>
              </section>

              <section aria-labelledby="case-filing" className="space-y-3">
                <h3 id="case-filing" className="text-sm font-semibold">{t('volunteering.filing_heading')}</h3>
                <IncidentFilingFields
                  value={filing}
                  onChange={(next) => { setFiling(next); setErrors((e) => ({ ...e, filing: undefined })); }}
                  current={incident}
                />
                {fieldError('filing')}
                <Button variant="secondary" onPress={saveFiling} isLoading={busy === 'filing'}>
                  {t('volunteering.case_save_filing')}
                </Button>
              </section>

              <section aria-labelledby="case-authority" className="space-y-3">
                <h3 id="case-authority" className="text-sm font-semibold">{t('volunteering.authority_notified_label')}</h3>
                <Switch isSelected={authorityNotified} onValueChange={setAuthorityNotified}>
                  {t('volunteering.authority_notified_label')}
                </Switch>
                {authorityNotified && (
                  <Input
                    label={t('volunteering.authority_reference_label')}
                    description={t('volunteering.authority_reference_help')}
                    maxLength={100}
                    value={authorityReference}
                    onValueChange={setAuthorityReference}
                  />
                )}
                {fieldError('authority')}
                <Button
                  variant="secondary"
                  onPress={saveAuthority}
                  isLoading={busy === 'authority'}
                  isDisabled={authorityNotified === incident.authority_notified
                    && authorityReference.trim() === (incident.authority_reference || '')}
                >
                  {t('volunteering.case_save_authority')}
                </Button>
              </section>

              <section aria-labelledby="case-note" className="space-y-3">
                <h3 id="case-note" className="text-sm font-semibold">{t('volunteering.timeline_staff_note')}</h3>
                <Textarea
                  label={t('volunteering.case_note_label')}
                  description={t('volunteering.case_note_help')}
                  value={note}
                  maxLength={5000}
                  onValueChange={(v) => { setNote(v); setErrors((e) => ({ ...e, note: undefined })); }}
                />
                {fieldError('note')}
                <Button variant="secondary" onPress={addNote} isLoading={busy === 'note'}>
                  {t('volunteering.case_add_note')}
                </Button>
              </section>
            </CardBody>
          </Card>

          {/* ── History ── */}
          <Card className="border border-divider/70 shadow-sm shadow-black/[0.03]">
            <CardHeader><h2 className="font-semibold">{t('volunteering.case_timeline_heading')}</h2></CardHeader>
            <CardBody>
              <IncidentTimeline events={incident.timeline} people={people} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          {/* ── Messages ── */}
          <Card className="border border-divider/70 shadow-sm shadow-black/[0.03]">
            <CardHeader><h2 className="font-semibold">{t('volunteering.case_message_heading')}</h2></CardHeader>
            <CardBody className="space-y-3">
              <Select
                label={t('volunteering.case_message_to')}
                selectedKeys={[audience]}
                disabledKeys={hasOrganisation ? [] : ['organisation']}
                onSelectionChange={(keys) => setAudience(((Array.from(keys)[0] as 'reporter' | 'organisation') || 'reporter'))}
              >
                <SelectItem key="reporter" id="reporter">{t('volunteering.case_message_to_reporter')}</SelectItem>
                <SelectItem key="organisation" id="organisation">{t('volunteering.case_message_to_organisation')}</SelectItem>
              </Select>
              {!hasOrganisation && <p className="text-xs text-muted">{t('volunteering.case_message_no_org')}</p>}
              <Textarea
                label={t('volunteering.case_message_label')}
                description={t('volunteering.case_message_help')}
                value={message}
                maxLength={5000}
                onValueChange={(v) => { setMessage(v); setErrors((e) => ({ ...e, message: undefined })); }}
              />
              {fieldError('message')}
              <Button variant="primary" startContent={<Send size={16} />} onPress={sendMessage} isLoading={busy === 'message'}>
                {t('volunteering.case_message_send')}
              </Button>
            </CardBody>
          </Card>

          {/* ── Sharing with the organisation's safeguarding lead ── */}
          <Card className="border border-divider/70 shadow-sm shadow-black/[0.03]">
            <CardHeader><h2 className="font-semibold">{t('volunteering.case_share_heading')}</h2></CardHeader>
            <CardBody className="space-y-3">
              <p className="text-sm text-muted">{t('volunteering.case_share_explain')}</p>
              {!hasOrganisation ? (
                <p className="text-sm text-warning">{t('volunteering.case_share_no_org')}</p>
              ) : incident.share ? (
                <>
                  <p className="text-sm">{t('volunteering.case_shared_since', { date: formatDate(incident.share.shared_at, true) })}</p>
                  {fieldError('share')}
                  <Button variant="danger-soft" onPress={withdrawShare} isLoading={busy === 'share'}>
                    {t('volunteering.case_share_withdraw')}
                  </Button>
                </>
              ) : (
                <>
                  {incident.organisation_leads.length === 0 ? (
                    <p className="text-sm text-warning">{t('volunteering.case_share_no_lead')}</p>
                  ) : (
                    <p className="text-sm">
                      {t('volunteering.case_share_leads', { names: incident.organisation_leads.map((l) => l.name).join(', ') })}
                    </p>
                  )}
                  {fieldError('share')}
                  <Button
                    variant="secondary"
                    startContent={<Share2 size={16} />}
                    onPress={shareReport}
                    isLoading={busy === 'share'}
                    isDisabled={incident.organisation_leads.length === 0}
                  >
                    {t('volunteering.case_share_button')}
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
      <ArrowLeft size={14} aria-hidden="true" />
      {label}
    </Link>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value || '--'}</dd>
    </div>
  );
}

/** Admin route: /admin/volunteering/safeguarding/:id */
export default function VolunteerIncidentCaseRoute() {
  const { id } = useParams<{ id: string }>();
  return <VolunteerIncidentCase incidentId={Number(id)} backPath="/admin/volunteering/safeguarding" />;
}
