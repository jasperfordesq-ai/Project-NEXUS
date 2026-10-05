// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Report a volunteering safeguarding incident.
 *
 * Until October 2026 this form sent only a title, description, severity and
 * category, so every report reached staff with no organisation, opportunity or
 * person and with type "other" and today's date. It now asks for all of them;
 * every new field is optional except the type, which defaults to "a concern".
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import FileWarning from 'lucide-react/icons/file-warning';
import Search from 'lucide-react/icons/search';
import X from 'lucide-react/icons/x';
import { Autocomplete } from '@/components/ui/Autocomplete';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ListBoxItem } from '@/components/ui/ListBox';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useAuth, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

interface ReportOptionOrganisation { id: number; name: string; }
interface ReportOptionOpportunity { id: number; title: string; organization_id: number; organization_name: string; }
interface MemberResult { id: number; name: string; }

const INCIDENT_TYPE_KEYS = ['concern', 'allegation', 'disclosure', 'near_miss', 'other'] as const;
const SEVERITY_KEYS = ['low', 'medium', 'high', 'critical'] as const;

const EMPTY_FORM = {
  title: '',
  description: '',
  severity: 'low',
  category: '',
  incident_type: 'concern',
  incident_date: '',
  organization_id: '',
  opportunity_id: '',
};

/** Today as YYYY-MM-DD in the member's own time zone. */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

interface ReportIncidentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReported: () => void;
}

export function ReportIncidentModal({ isOpen, onClose, onReported }: ReportIncidentModalProps) {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const { user } = useAuth();

  const [form, setForm] = useState(EMPTY_FORM);
  const [person, setPerson] = useState<MemberResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);

  const [organisations, setOrganisations] = useState<ReportOptionOrganisation[]>([]);
  const [opportunities, setOpportunities] = useState<ReportOptionOpportunity[]>([]);
  const [optionsFailed, setOptionsFailed] = useState(false);

  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState<MemberResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);

  // The organisations and opportunities to choose from. A failure never blocks
  // the report — the member can still describe where it happened.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ organisations?: ReportOptionOrganisation[]; opportunities?: ReportOptionOpportunity[] }>('/v2/volunteering/incidents/report-options');
        if (cancelled) return;
        if (res.success && res.data) {
          setOrganisations(Array.isArray(res.data.organisations) ? res.data.organisations : []);
          setOpportunities(Array.isArray(res.data.opportunities) ? res.data.opportunities : []);
          setOptionsFailed(false);
        } else {
          setOptionsFailed(true);
        }
      } catch (err) {
        if (cancelled) return;
        logError('Failed to load incident report options', err);
        setOptionsFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  const searchMembers = useCallback(async (query: string) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    try {
      setIsSearching(true);
      const res = await api.get<MemberResult[]>(`/v2/users?q=${encodeURIComponent(query)}&limit=10`);
      if (controller.signal.aborted) return;
      if (res.success && Array.isArray(res.data)) {
        setPersonResults(res.data.filter((m) => m.id !== user?.id).map((m) => ({ id: m.id, name: m.name })));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to search members for an incident report', err);
    } finally {
      if (!controller.signal.aborted) setIsSearching(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!personQuery.trim()) { setPersonResults([]); return; }
    const timer = setTimeout(() => searchMembers(personQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [personQuery, searchMembers]);

  useEffect(() => () => { searchAbortRef.current?.abort(); }, []);

  const reset = () => {
    setForm(EMPTY_FORM);
    setPerson(null);
    setPersonQuery('');
    setPersonResults([]);
    setDateError(null);
  };

  const close = () => { reset(); onClose(); };

  const visibleOpportunities = form.organization_id
    ? opportunities.filter((o) => String(o.organization_id) === form.organization_id)
    : opportunities;

  const chooseOrganisation = (key: string | null) => {
    setForm((f) => {
      const keepOpportunity = !!key && opportunities.some((o) => String(o.id) === f.opportunity_id && String(o.organization_id) === key);
      return { ...f, organization_id: key ?? '', opportunity_id: keepOpportunity ? f.opportunity_id : '' };
    });
  };

  const chooseOpportunity = (key: string | null) => {
    const chosen = key ? opportunities.find((o) => String(o.id) === key) : undefined;
    // Picking an opportunity also says which organisation it was with.
    setForm((f) => ({ ...f, opportunity_id: key ?? '', organization_id: chosen ? String(chosen.organization_id) : f.organization_id }));
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.description.trim()) { toast.error(t('safeguarding.fill_required')); return; }
    if (form.description.trim().length < 20) { toast.error(t('safeguarding.description_min')); return; }
    if (form.incident_date && form.incident_date > todayIso()) { setDateError(t('safeguarding.incident_date_future')); return; }

    const payload: Record<string, string | number> = {
      title: form.title.trim(),
      description: form.description.trim(),
      severity: form.severity,
      incident_type: form.incident_type,
    };
    if (form.category.trim()) payload.category = form.category.trim();
    if (form.incident_date) payload.incident_date = form.incident_date;
    if (form.organization_id) payload.organization_id = Number(form.organization_id);
    if (form.opportunity_id) payload.opportunity_id = Number(form.opportunity_id);
    if (person) payload.subject_user_id = person.id;

    try {
      setIsSubmitting(true);
      const res = await api.post('/v2/volunteering/incidents', payload);
      if (res.success) {
        reset();
        onClose();
        toast.success(t('safeguarding.incident_reported'));
        onReported();
      } else {
        toast.error(t('safeguarding.incident_failed'));
      }
    } catch (err) {
      logError('Failed to report incident', err);
      toast.error(t('safeguarding.incident_failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const fieldWrapper = { inputWrapper: 'bg-theme-elevated border-theme-default' };
  const triggerWrapper = { trigger: 'bg-theme-elevated border-theme-default' };

  return (
    <Modal isOpen={isOpen} onClose={close} size="lg" scrollBehavior="inside" classNames={{ base: 'bg-overlay border border-theme-default' }}>
      <ModalContent>
        <ModalHeader className="text-theme-primary">
          <ModalHeading className="flex items-center gap-2">
            <FileWarning className="w-5 h-5 text-amber-400" aria-hidden="true" />
            {t('safeguarding.report_incident_title')}
          </ModalHeading>
        </ModalHeader>
        <ModalBody className="space-y-4">
          {/* A report form is never the way to get help for someone in danger right now. */}
          <div role="note" className="flex gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-theme-primary">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
            <p className="font-medium">{t('safeguarding.incident_emergency_warning')}</p>
          </div>
          {/* Said before they write anything: who is told, and what the organisation is not told. */}
          <details className="rounded-xl border border-theme-default bg-theme-elevated p-3 text-sm">
            <summary className="cursor-pointer font-medium text-theme-primary">{t('safeguarding.incident_who_is_told_summary')}</summary>
            <div className="mt-2 space-y-2 text-theme-muted">
              <p>{t('safeguarding.incident_who_is_told_staff')}</p>
              <p>{t('safeguarding.incident_who_is_told_organisation')}</p>
              <p>{t('safeguarding.incident_who_is_told_subject')}</p>
            </div>
          </details>
          <Input label={t('safeguarding.incident_title')} isRequired value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} classNames={fieldWrapper} />

          <Select
            label={t('safeguarding.incident_type')}
            selectedKeys={new Set([form.incident_type])}
            onSelectionChange={(keys) => { const val = Array.from(keys)[0] as string; if (val) setForm((f) => ({ ...f, incident_type: val })); }}
            classNames={triggerWrapper}
          >
            {INCIDENT_TYPE_KEYS.map((key) => (<SelectItem key={key} id={key}>{t(`safeguarding.incident_types.${key}`)}</SelectItem>))}
          </Select>

          <Input
            label={t('safeguarding.incident_date')}
            description={t('safeguarding.incident_date_hint')}
            type="date"
            max={todayIso()}
            value={form.incident_date}
            onChange={(e) => { setDateError(null); setForm((f) => ({ ...f, incident_date: e.target.value })); }}
            isInvalid={!!dateError}
            errorMessage={dateError ?? undefined}
            classNames={fieldWrapper}
          />

          {optionsFailed ? (
            <p className="text-sm text-theme-muted" role="status">{t('safeguarding.incident_options_unavailable')}</p>
          ) : (
            <>
              {organisations.length > 0 && (
                <Autocomplete
                  label={t('safeguarding.incident_organisation')}
                  placeholder={t('safeguarding.incident_organisation_placeholder')}
                  searchPlaceholder={t('safeguarding.incident_organisation_search')}
                  value={form.organization_id || null}
                  onChange={(key) => chooseOrganisation(key && !Array.isArray(key) ? String(key) : null)}
                  classNames={triggerWrapper}
                >
                  {organisations.map((org) => (
                    <ListBoxItem key={String(org.id)} id={String(org.id)} textValue={org.name}>{org.name}</ListBoxItem>
                  ))}
                </Autocomplete>
              )}
              {visibleOpportunities.length > 0 && (
                <Autocomplete
                  label={t('safeguarding.incident_opportunity')}
                  placeholder={t('safeguarding.incident_opportunity_placeholder')}
                  searchPlaceholder={t('safeguarding.incident_opportunity_search')}
                  value={form.opportunity_id || null}
                  onChange={(key) => chooseOpportunity(key && !Array.isArray(key) ? String(key) : null)}
                  classNames={triggerWrapper}
                >
                  {visibleOpportunities.map((opp) => (
                    <ListBoxItem key={String(opp.id)} id={String(opp.id)} textValue={`${opp.title} ${opp.organization_name}`}>
                      <div className="flex flex-col">
                        <span className="text-sm">{opp.title}</span>
                        {!form.organization_id && <span className="text-xs text-theme-subtle">{opp.organization_name}</span>}
                      </div>
                    </ListBoxItem>
                  ))}
                </Autocomplete>
              )}
            </>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium text-theme-primary">{t('safeguarding.incident_person')}</p>
            <p className="text-xs text-theme-muted">{t('safeguarding.incident_person_hint')}</p>
            {person ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-theme-default bg-theme-elevated px-3 py-2">
                <span className="text-sm font-medium text-theme-primary">{person.name}</span>
                <Button size="sm" variant="tertiary" startContent={<X className="w-4 h-4" aria-hidden="true" />} onPress={() => setPerson(null)}>
                  {t('safeguarding.incident_person_clear')}
                </Button>
              </div>
            ) : (
              <>
                <Input
                  aria-label={t('safeguarding.incident_person_search')}
                  placeholder={t('safeguarding.incident_person_search')}
                  value={personQuery}
                  onChange={(e) => setPersonQuery(e.target.value)}
                  startContent={<Search className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                  endContent={isSearching ? <Spinner size="sm" /> : undefined}
                  classNames={fieldWrapper}
                />
                {personResults.length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {personResults.map((member) => (
                      <Button
                        key={member.id}
                        variant="secondary"
                        className="w-full justify-start bg-theme-elevated text-left"
                        onPress={() => { setPerson(member); setPersonQuery(''); setPersonResults([]); }}
                      >
                        {member.name}
                      </Button>
                    ))}
                  </div>
                )}
                {personQuery.trim() && !isSearching && personResults.length === 0 && (
                  <p className="text-xs text-theme-subtle">{t('safeguarding.incident_person_empty')}</p>
                )}
              </>
            )}
          </div>

          <Textarea label={t('safeguarding.incident_description')} isRequired value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={2000} classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }} />

          <Select
            label={t('safeguarding.severity')}
            selectedKeys={new Set([form.severity])}
            onSelectionChange={(keys) => { const val = Array.from(keys)[0] as string; if (val) setForm((f) => ({ ...f, severity: val })); }}
            classNames={triggerWrapper}
          >
            {SEVERITY_KEYS.map((key) => (<SelectItem key={key} id={key}>{t(`safeguarding.severity_options.${key}`)}</SelectItem>))}
          </Select>

          <Input label={t('safeguarding.category')} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} classNames={fieldWrapper} />
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={close}>{t('safeguarding.cancel')}</Button>
          <Button className="bg-gradient-to-r from-amber-500 to-orange-600 text-white" onPress={handleSubmit} isLoading={isSubmitting} startContent={!isSubmitting ? <AlertTriangle className="w-4 h-4" aria-hidden="true" /> : undefined}>
            {t('safeguarding.submit_incident')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default ReportIncidentModal;
