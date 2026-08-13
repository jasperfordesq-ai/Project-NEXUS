import { getFormattingLocale } from '@/lib/helpers';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import CheckCircle from 'lucide-react/icons/check-circle';
import ShieldCheck from 'lucide-react/icons/shield-check';
import UserRoundCheck from 'lucide-react/icons/user-round-check';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo';
import { useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import api from '@/lib/api';
import { logError } from '@/lib/logger';

interface CaregiverLink {
  cared_for_id: number;
  cared_for_name: string;
}

interface CoverRequest {
  id: number;
  cared_for_id: number;
  cared_for_name: string;
  title: string;
  briefing: string | null;
  starts_at: string;
  ends_at: string;
  urgency: 'planned' | 'soon' | 'urgent';
  status: 'open' | 'matched' | 'accepted' | 'cancelled' | 'completed';
  minimum_trust_tier: number;
  matched_supporter_name: string | null;
}

interface Candidate {
  id: number;
  name: string;
  avatar_url: string | null;
  location: string | null;
  trust_tier: number;
  verification_status: string;
  skills: string[];
  skill_matches: number;
}

function unwrapData<T>(raw: { data?: T } | T): T {
  return raw && typeof raw === 'object' && 'data' in raw ? (raw as { data: T }).data : raw as T;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(getFormattingLocale(), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CoverCarePage() {
  const { t } = useTranslation('caring_community');
  const { tenantPath } = useTenant();
  const { showToast } = useToast();
  usePageTitle(t('cover.title'));

  const [links, setLinks] = useState<CaregiverLink[]>([]);
  const [requests, setRequests] = useState<CoverRequest[]>([]);
  const [candidates, setCandidates] = useState<Record<number, Candidate[]>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);

  const [caredForId, setCaredForId] = useState('');
  const [title, setTitle] = useState('');
  const [briefing, setBriefing] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [skills, setSkills] = useState('');
  const [minimumTrustTier, setMinimumTrustTier] = useState('1');
  const [urgency, setUrgency] = useState('planned');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [linksRes, requestsRes] = await Promise.all([
        api.get<{ data: CaregiverLink[] } | CaregiverLink[]>('/v2/caring-community/caregiver/links'),
        api.get<{ data: CoverRequest[] } | CoverRequest[]>('/v2/caring-community/caregiver/cover-requests'),
      ]);
      if (!linksRes.success || !requestsRes.success) {
        showToast(linksRes.error ?? requestsRes.error ?? t('cover.errors.load'), 'error');
        setLinks([]);
        setRequests([]);
        return;
      }
      const nextLinks = unwrapData<CaregiverLink[]>(linksRes.data ?? []);
      setLinks(nextLinks);
      setRequests(unwrapData<CoverRequest[]>(requestsRes.data ?? []));
      const firstLink = nextLinks[0];
      if (!caredForId && firstLink) {
        setCaredForId(String(firstLink.cared_for_id));
      }
    } catch (err: unknown) {
      logError('CoverCarePage.load', err);
      showToast(t('cover.errors.load'), 'error');
    } finally {
      setLoading(false);
    }
  }, [caredForId, showToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const createRequest = async () => {
    if (!caredForId || !title.trim() || !startsAt || !endsAt) return;
    setSubmitting(true);
    try {
      const res = await api.post('/v2/caring-community/caregiver/cover-requests', {
        cared_for_id: Number(caredForId),
        title: title.trim(),
        briefing: briefing.trim() || null,
        starts_at: startsAt,
        ends_at: endsAt,
        required_skills: skills,
        minimum_trust_tier: Number(minimumTrustTier),
        urgency,
      });
      if (!res.success) {
        showToast(res.error ?? t('cover.errors.create'), 'error');
        return;
      }
      setTitle('');
      setBriefing('');
      setStartsAt('');
      setEndsAt('');
      setSkills('');
      showToast(t('cover.created'), 'success');
      await load();
    } catch (err: unknown) {
      logError('CoverCarePage.createRequest', err);
      showToast(t('cover.errors.create'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const loadCandidates = async (requestId: number) => {
    setActionId(requestId);
    try {
      const res = await api.get<{ data: Candidate[] } | Candidate[]>(
        `/v2/caring-community/caregiver/cover-requests/${requestId}/candidates`,
      );
      if (!res.success) {
        showToast(res.error ?? t('cover.errors.candidates'), 'error');
        return;
      }
      setCandidates((prev) => ({ ...prev, [requestId]: unwrapData<Candidate[]>(res.data ?? []) }));
    } catch (err: unknown) {
      logError('CoverCarePage.loadCandidates', err);
      showToast(t('cover.errors.candidates'), 'error');
    } finally {
      setActionId(null);
    }
  };

  const assignCandidate = async (requestId: number, supporterId: number) => {
    setActionId(requestId);
    try {
      const res = await api.post(`/v2/caring-community/caregiver/cover-requests/${requestId}/assign`, {
        supporter_id: supporterId,
      });
      if (!res.success) {
        showToast(res.error ?? t('cover.errors.assign'), 'error');
        return;
      }
      showToast(t('cover.assigned'), 'success');
      await load();
    } catch (err: unknown) {
      logError('CoverCarePage.assignCandidate', err);
      showToast(t('cover.errors.assign'), 'error');
    } finally {
      setActionId(null);
    }
  };

  return (
    <>
      <PageMeta title={t('cover.title')} description={t('cover.subtitle')} noIndex />
      <div className="space-y-6">
        <Link
          to={tenantPath('/caring-community/caregiver')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('caregiver.dashboard_title')}
        </Link>

        <GlassCard className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/15">
              <UserRoundCheck className="h-6 w-6 text-accent" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight text-theme-primary sm:text-3xl">
                {t('cover.title')}
              </h1>
              <p className="mt-2 max-w-3xl text-base leading-7 text-theme-muted">
                {t('cover.subtitle')}
              </p>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <Select
              label={t('cover.fields.cared_for')}
              selectedKeys={caredForId ? [caredForId] : []}
              onSelectionChange={(keys) => setCaredForId(String(Array.from(keys)[0] ?? ''))}
              variant="bordered"
            >
              {links.map((link) => (
                <SelectItem key={String(link.cared_for_id)} id={String(link.cared_for_id)}>{link.cared_for_name}</SelectItem>
              ))}
            </Select>
            <Input
              label={t('cover.fields.title')}
              value={title}
              onValueChange={setTitle}
              variant="bordered"
              isRequired
            />
            <Input
              label={t('cover.fields.starts_at')}
              type="datetime-local"
              value={startsAt}
              onValueChange={setStartsAt}
              variant="bordered"
              isRequired
            />
            <Input
              label={t('cover.fields.ends_at')}
              type="datetime-local"
              value={endsAt}
              onValueChange={setEndsAt}
              variant="bordered"
              isRequired
            />
            <Input
              label={t('cover.fields.skills')}
              value={skills}
              onValueChange={setSkills}
              variant="bordered"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label={t('cover.fields.trust_tier')}
                selectedKeys={[minimumTrustTier]}
                onSelectionChange={(keys) => setMinimumTrustTier(String(Array.from(keys)[0] ?? '1'))}
                variant="bordered"
              >
                {[0, 1, 2, 3, 4, 5].map((tier) => (
                  <SelectItem key={String(tier)} id={String(tier)}>{t('cover.trust_tier', { tier })}</SelectItem>
                ))}
              </Select>
              <Select
                label={t('cover.fields.urgency')}
                selectedKeys={[urgency]}
                onSelectionChange={(keys) => setUrgency(String(Array.from(keys)[0] ?? 'planned'))}
                variant="bordered"
              >
                {['planned', 'soon', 'urgent'].map((item) => (
                  <SelectItem key={item} id={item}>{t(`cover.urgency.${item}`)}</SelectItem>
                ))}
              </Select>
            </div>
            <Textarea
              className="lg:col-span-2"
              label={t('cover.fields.briefing')}
              value={briefing}
              onValueChange={setBriefing}
              variant="bordered"
              minRows={3}
            />
          </div>
          <div className="mt-5">
            <Button
              color="primary"
              isLoading={submitting}
              startContent={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
              onPress={() => void createRequest()}
            >
              {t('cover.create')}
            </Button>
          </div>
        </GlassCard>

        {loading && (
          <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-8">
            <Spinner />
          </div>
        )}

        {!loading && requests.length === 0 && (
          <GlassCard className="p-8 text-center text-theme-muted">{t('cover.empty')}</GlassCard>
        )}

        <div className="space-y-4">
          {requests.map((request) => (
            <GlassCard key={request.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip color="primary" variant="flat" size="sm">{request.cared_for_name}</Chip>
                    <Chip color={request.urgency === 'urgent' ? 'danger' : 'default'} variant="flat" size="sm">
                      {t(`cover.urgency.${request.urgency}`)}
                    </Chip>
                    <Chip color={request.status === 'open' ? 'warning' : 'success'} variant="flat" size="sm">
                      {t(`cover.status.${request.status}`)}
                    </Chip>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-theme-primary">{request.title}</h2>
                  <p className="mt-1 text-sm text-theme-muted">
                    {formatDateTime(request.starts_at)} - {formatDateTime(request.ends_at)}
                  </p>
                  {request.briefing && (
                    <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-6 text-theme-muted">
                      {request.briefing}
                    </p>
                  )}
                  {request.matched_supporter_name && (
                    <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-success">
                      <CheckCircle className="h-4 w-4" aria-hidden="true" />
                      {t('cover.matched_with', { name: request.matched_supporter_name })}
                    </p>
                  )}
                </div>
                {request.status === 'open' && (
                  <Button
                    variant="flat"
                    color="primary"
                    isLoading={actionId === request.id}
                    onPress={() => void loadCandidates(request.id)}
                  >
                    {t('cover.find_candidates')}
                  </Button>
                )}
              </div>

              {(candidates[request.id] ?? []).length > 0 && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {(candidates[request.id] ?? []).map((candidate) => (
                    <div key={candidate.id} className="rounded-lg border border-theme-default bg-theme-elevated p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Avatar src={candidate.avatar_url ?? undefined} name={candidate.name} size="sm" />
                          <div>
                            <p className="font-medium text-theme-primary">{candidate.name}</p>
                            <p className="text-xs text-theme-muted">{candidate.location ?? t('cover.location_unknown')}</p>
                          </div>
                        </div>
                        <Chip size="sm" variant="flat" color="success">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          {t('cover.trust_tier', { tier: candidate.trust_tier })}
                        </Chip>
                      </div>
                      <p className="mt-3 text-xs text-theme-muted">
                        {t('cover.skill_matches', { count: candidate.skill_matches })}
                      </p>
                      <Button
                        className="mt-3"
                        size="sm"
                        color="primary"
                        variant="flat"
                        isLoading={actionId === request.id}
                        onPress={() => void assignCandidate(request.id, candidate.id)}
                      >
                        {t('cover.assign')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      </div>
    </>
  );
}
