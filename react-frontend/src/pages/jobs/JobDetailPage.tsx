// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { useDisclosure } from '@/components/ui/useDisclosure';
/**
 * Job Detail Page - Full vacancy detail with apply, save, match, pipeline
 *
 * Features:
 * - Full description, skills, contact info, salary display
 * - Apply modal with message textarea
 * - Save/bookmark toggle (J1)
 * - Skills match percentage badge (J2)
 * - Application pipeline stages (J3)
 * - Application status history (J4)
 * - "Am I Qualified?" tool (J5)
 * - Job renewal for owners (J7)
 * - Featured badge (J10)
 * - Salary/compensation display (J9)
 * - Analytics link for owners (J8)
 * - Edit/delete for owner
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { toJsonLd } from '@/lib/json-ld';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Briefcase from 'lucide-react/icons/briefcase';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo/PageMeta';
import { EmptyState } from '@/components/feedback';
import { SocialInteractionPanel } from '@/components/social/SocialInteractionPanel';
import { TranslateButton } from '@/components/i18n/TranslateButton';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';

import type {
  JobVacancy,
  Application,
  MatchResult,
  QualificationResult,
  QualificationData,
  InlineInterview,
  InlineOffer,
} from '@/components/jobs/JobDetailTypes';
import { parseArrayResponse } from '@/components/jobs/JobDetailTypes';

import { JobDetailHeader } from '@/components/jobs/JobDetailHeader';
import { JobOwnerBanner } from '@/components/jobs/JobOwnerBanner';
import { InlineInterviewCard } from '@/components/jobs/InlineInterviewCard';
import { InlineOfferCard } from '@/components/jobs/InlineOfferCard';
import { JobDescriptionCard } from '@/components/jobs/JobDescriptionCard';
import { JobApplicationsList } from '@/components/jobs/JobApplicationsList';
import { JobPipelineRules } from '@/components/jobs/JobPipelineRules';
import { JobMetadataSidebar } from '@/components/jobs/JobMetadataSidebar';
import { ApplySection } from '@/components/jobs/ApplySection';
import {
  ApplyModal,
  QualificationModal,
  RenewModal,
  DeleteModal,
  DeclineModal,
} from '@/components/jobs/JobModals';
import { SimilarJobs } from '@/components/jobs/SimilarJobs';
import { AiChatDrawer } from '@/components/jobs/AiChatDrawer';

interface SavedProfile {
  cv_filename?: string;
  cover_text?: string;
}

interface SalaryBenchmark {
  role_keyword: string;
  salary_min: number;
  salary_max: number;
  salary_median: number;
  salary_type: string;
  currency: string;
}

type SavedProfilePayload = SavedProfile | { profile?: SavedProfile | null };
type SalaryBenchmarkPayload = SalaryBenchmark | { benchmark?: SalaryBenchmark | null };

function extractSavedProfile(payload: SavedProfilePayload | null | undefined): SavedProfile | null {
  if (!payload || typeof payload !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(payload, 'profile')) {
    return (payload as { profile?: SavedProfile | null }).profile ?? null;
  }
  return payload as SavedProfile;
}

function extractSalaryBenchmark(payload: SalaryBenchmarkPayload | null | undefined): SalaryBenchmark | null {
  if (!payload || typeof payload !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(payload, 'benchmark')) {
    return (payload as { benchmark?: SalaryBenchmark | null }).benchmark ?? null;
  }
  return payload as SalaryBenchmark;
}

// ---------------------------------------------------------------------------
// JSON-LD helper
// ---------------------------------------------------------------------------

function buildJobPostingSchema(vacancy: JobVacancy, tenantPath: (p: string) => string): string {
  const base = window.location.origin;
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    'title': vacancy.title,
    'description': vacancy.description ?? '',
    'datePosted': vacancy.created_at ?? new Date().toISOString(),
    'validThrough': vacancy.deadline ?? undefined,
    'employmentType': vacancy.commitment === 'full_time' ? 'FULL_TIME'
                    : vacancy.commitment === 'part_time' ? 'PART_TIME'
                    : vacancy.commitment === 'one_off' ? 'CONTRACTOR'
                    : 'OTHER',
    'jobLocationType': vacancy.is_remote ? 'TELECOMMUTE' : undefined,
    'url': base + tenantPath(`/jobs/${vacancy.id}`),
  };

  if (vacancy.location && !vacancy.is_remote) {
    schema['jobLocation'] = {
      '@type': 'Place',
      'address': { '@type': 'PostalAddress', 'addressLocality': vacancy.location },
    };
  }

  if (vacancy.salary_min || vacancy.salary_max) {
    schema['baseSalary'] = {
      '@type': 'MonetaryAmount',
      'currency': vacancy.salary_currency ?? 'EUR',
      'value': {
        '@type': 'QuantitativeValue',
        'minValue': vacancy.salary_min ?? undefined,
        'maxValue': vacancy.salary_max ?? undefined,
        'unitText': vacancy.salary_type?.toUpperCase() ?? 'YEAR',
      },
    };
  }

  if (vacancy.skills_required) {
    schema['skills'] = vacancy.skills_required;
  }

  if (vacancy.organization?.name) {
    schema['hiringOrganization'] = {
      '@type': 'Organization',
      'name': vacancy.organization.name,
      ...(vacancy.organization.logo_url ? { 'logo': vacancy.organization.logo_url } : {}),
    };
  } else if (vacancy.creator?.name) {
    schema['hiringOrganization'] = {
      '@type': 'Organization',
      'name': vacancy.creator.name,
    };
  }

  return toJsonLd(schema);
}

export function JobDetailPage() {
  const { t } = useTranslation('jobs');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const applyModal = useDisclosure({
    onOpen: async () => {
      try {
        const res = await api.get<SavedProfilePayload>('/v2/jobs/saved-profile');
        if (res.success && res.data) {
          setSavedProfile(extractSavedProfile(res.data));
        } else {
          setSavedProfile(null);
        }
      } catch {
        setSavedProfile(null);
      }
      setUsingSavedProfile(false);
    },
  });
  const qualifiedModal = useDisclosure();
  const renewModal = useDisclosure();
  const deleteModal = useDisclosure();

  const [vacancy, setVacancy] = useState<JobVacancy | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showApplications, setShowApplications] = useState(true);
  const [isLoadingApps, setIsLoadingApps] = useState(false);
  // Member-written title + description, translated together on one press (31 Oct 2026).
  const [translatedDesc, setTranslatedDesc] = useState<string | null>(null);
  const [translatedTitle, setTranslatedTitle] = useState<string | null>(null);
  const onTranslatedText = useCallback((text: string, isTranslated: boolean) => setTranslatedDesc(isTranslated ? text : null), []);
  const onTranslatedFields = useCallback((fields: Record<string, string> | null) => setTranslatedTitle(fields?.title ?? null), []);

  // CV Upload state
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvParsed, setCvParsed] = useState<{ skills: string[]; summary?: string } | null>(null);

  // J1: Saved state
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // J2: Match percentage
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  // J5: Qualification assessment
  const [qualification, setQualification] = useState<QualificationResult | null>(null);
  const [isLoadingQualification, setIsLoadingQualification] = useState(false);

  // Match explanation card (inline, auto-loaded)
  const [qualificationData, setQualificationData] = useState<QualificationData | null>(null);

  // J7: Renewal
  const [renewDays, setRenewDays] = useState(30);
  const [isRenewing, setIsRenewing] = useState(false);

  // Feature 5: Saved profile (one-click apply)
  const [savedProfile, setSavedProfile] = useState<SavedProfile | null>(null);
  const [usingSavedProfile, setUsingSavedProfile] = useState(false);

  // Feature 2: Salary benchmark for owners
  const [benchmark, setBenchmark] = useState<SalaryBenchmark | null>(null);

  // Similar jobs
  const [similarJobs, setSimilarJobs] = useState<JobVacancy[]>([]);

  // AI Job Chat
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiChatMessages, setAiChatMessages] = useState<Array<{role: 'user' | 'assistant'; content: string}>>([]);
  const [aiChatInput, setAiChatInput] = useState('');
  const [aiChatLoading, setAiChatLoading] = useState(false);

  // Inline interview/offer response
  const [pendingInterview, setPendingInterview] = useState<InlineInterview | null>(null);
  const [pendingOffer, setPendingOffer] = useState<InlineOffer | null>(null);
  const [isRespondingInterview, setIsRespondingInterview] = useState(false);
  const [isRespondingOffer, setIsRespondingOffer] = useState(false);
  const [showDeclineInterviewModal, setShowDeclineInterviewModal] = useState(false);
  const [showDeclineOfferModal, setShowDeclineOfferModal] = useState(false);
  const [declineNotes, setDeclineNotes] = useState('');

  usePageTitle(vacancy?.title ?? t('detail.loading'));

  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const isOwner = vacancy && user && vacancy.user_id === user.id;

  const loadVacancy = useCallback(async () => {
    if (!id) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<JobVacancy>(`/v2/jobs/${id}`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setVacancy(response.data);
        setIsSaved(response.data.is_saved ?? false);
      } else {
        setError(tRef.current('detail.not_found'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load job vacancy', err);
      setError(tRef.current('detail.unable_to_load'));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadVacancy();
  }, [loadVacancy]);

  // Eagerly fetch saved profile
  useEffect(() => {
    if (!isAuthenticated || isOwner || !vacancy || vacancy.has_applied) return;
    api.get<SavedProfilePayload>('/v2/jobs/saved-profile')
      .then((res) => { if (res.success && res.data) setSavedProfile(extractSavedProfile(res.data)); })
      .catch(() => {});
  }, [isAuthenticated, isOwner, vacancy]);

  // J2: Load match percentage
  useEffect(() => {
    if (!id || !isAuthenticated || !vacancy || isOwner) return;
    const loadMatch = async () => {
      try {
        const response = await api.get<MatchResult>(`/v2/jobs/${id}/match`);
        if (response.success && response.data) {
          setMatchResult(response.data);
        }
      } catch (err) {
        if (import.meta.env.DEV) console.warn('Match load failed:', err);
      }
    };
    loadMatch();
  }, [id, isAuthenticated, vacancy, isOwner]);

  // Load qualification data for the inline "Why You Match" card
  useEffect(() => {
    if (!id || !isAuthenticated || !vacancy || isOwner) return;
    const loadQualData = async () => {
      try {
        const qualRes = await api.get<QualificationData>(`/v2/jobs/${id}/qualified`);
        if (qualRes.success && qualRes.data) setQualificationData(qualRes.data as QualificationData);
      } catch (err) {
        if (import.meta.env.DEV) console.warn('Qualification load failed:', err);
      }
    };
    loadQualData();
  }, [id, isAuthenticated, vacancy, isOwner]);

  // Feature 2: Load salary benchmark for owners
  useEffect(() => {
    if (!vacancy || !isOwner) return;
    const controller = new AbortController();
    api.get<SalaryBenchmarkPayload>(`/v2/jobs/salary-benchmark?title=${encodeURIComponent(vacancy.title)}`, { signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted && res.success && res.data) {
          setBenchmark(extractSalaryBenchmark(res.data));
        }
      })
      .catch((err) => { if (import.meta.env.DEV) console.warn('Non-critical:', err); });
    return () => { controller.abort(); };
  }, [vacancy, isOwner]);

  // Load similar jobs by category
  useEffect(() => {
    if (!vacancy?.category || !vacancy?.id) return;
    const controller = new AbortController();
    api.get<{ data: JobVacancy[] } | JobVacancy[]>(`/v2/jobs?category=${encodeURIComponent(vacancy.category)}&per_page=5&exclude=${vacancy.id}&status=open`, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted || !res.success || !res.data) return;
        const items = parseArrayResponse<JobVacancy>(res.data);
        setSimilarJobs(items.filter((j) => j.id !== vacancy.id).slice(0, 4));
      })
      .catch((err) => { if (import.meta.env.DEV) console.warn('Non-critical:', err); });
    return () => { controller.abort(); };
  }, [vacancy?.category, vacancy?.id]);

  // Load pending interview/offer for current user's application
  useEffect(() => {
    if (!vacancy || !vacancy.has_applied || isOwner || !isAuthenticated) return;
    const stage = vacancy.application_stage ?? vacancy.application_status;
    if (stage !== 'interview' && stage !== 'offer') return;

    const controller = new AbortController();
    const load = async () => {
      try {
        const [interviewsRes, offersRes] = await Promise.all([
          api.get<{ data: InlineInterview[] } | InlineInterview[]>('/v2/jobs/my-interviews'),
          api.get<{ data: InlineOffer[] } | InlineOffer[]>('/v2/jobs/my-offers'),
        ]);
        if (controller.signal.aborted) return;

        const interviews: InlineInterview[] = interviewsRes.success && interviewsRes.data
          ? parseArrayResponse<InlineInterview>(interviewsRes.data)
          : [];

        const offers: InlineOffer[] = offersRes.success && offersRes.data
          ? parseArrayResponse<InlineOffer>(offersRes.data)
          : [];

        const applicationId = vacancy.application_id;
        const myInterview = interviews.find((iv) =>
          iv.status === 'proposed' && (!applicationId || iv.application_id === applicationId)
        );
        const myOffer = offers.find((of_) =>
          of_.status === 'pending' && (!applicationId || of_.application_id === applicationId)
        );

        if (myInterview) setPendingInterview(myInterview);
        if (myOffer) setPendingOffer(myOffer);
      } catch {
        // Non-critical
      }
    };
    load();
    return () => { controller.abort(); };
  }, [vacancy, isOwner, isAuthenticated]);

  // Interview accept/decline handlers
  const handleAcceptInterview = async () => {
    if (!pendingInterview) return;
    setIsRespondingInterview(true);
    try {
      const response = await api.put(`/v2/jobs/interviews/${pendingInterview.id}/accept`, {});
      if (response.success) {
        toastRef.current.success(tRef.current('inline_response.interview_accepted'));
        setPendingInterview({ ...pendingInterview, status: 'accepted' });
        loadVacancy();
      } else {
        toastRef.current.error(tRef.current('something_wrong'));
      }
    } catch (err) {
      logError('Failed to accept interview', err);
      toastRef.current.error(tRef.current('something_wrong'));
    } finally {
      setIsRespondingInterview(false);
    }
  };

  const handleDeclineInterview = async () => {
    if (!pendingInterview) return;
    setIsRespondingInterview(true);
    try {
      const response = await api.put(`/v2/jobs/interviews/${pendingInterview.id}/decline`, { notes: declineNotes || undefined });
      if (response.success) {
        toastRef.current.success(tRef.current('inline_response.interview_declined'));
        setPendingInterview({ ...pendingInterview, status: 'declined' });
        setShowDeclineInterviewModal(false);
        setDeclineNotes('');
        loadVacancy();
      } else {
        toastRef.current.error(tRef.current('something_wrong'));
      }
    } catch (err) {
      logError('Failed to decline interview', err);
      toastRef.current.error(tRef.current('something_wrong'));
    } finally {
      setIsRespondingInterview(false);
    }
  };

  // Offer accept/reject handlers
  const handleAcceptOffer = async () => {
    if (!pendingOffer) return;
    setIsRespondingOffer(true);
    try {
      const response = await api.put(`/v2/jobs/offers/${pendingOffer.id}/accept`, {});
      if (response.success) {
        toastRef.current.success(tRef.current('inline_response.offer_accepted'));
        setPendingOffer({ ...pendingOffer, status: 'accepted' });
        loadVacancy();
      } else {
        toastRef.current.error(tRef.current('something_wrong'));
      }
    } catch (err) {
      logError('Failed to accept offer', err);
      toastRef.current.error(tRef.current('something_wrong'));
    } finally {
      setIsRespondingOffer(false);
    }
  };

  const handleDeclineOffer = async () => {
    if (!pendingOffer) return;
    setIsRespondingOffer(true);
    try {
      const response = await api.put(`/v2/jobs/offers/${pendingOffer.id}/reject`, { reason: declineNotes || undefined });
      if (response.success) {
        toastRef.current.success(tRef.current('inline_response.offer_declined'));
        setPendingOffer({ ...pendingOffer, status: 'rejected' });
        setShowDeclineOfferModal(false);
        setDeclineNotes('');
        loadVacancy();
      } else {
        toastRef.current.error(tRef.current('something_wrong'));
      }
    } catch (err) {
      logError('Failed to decline offer', err);
      toastRef.current.error(tRef.current('something_wrong'));
    } finally {
      setIsRespondingOffer(false);
    }
  };

  const loadApplications = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoadingApps(true);
      const response = await api.get<Application[]>(`/v2/jobs/${id}/applications`);
      if (response.success && response.data) {
        setApplications(response.data);
      }
    } catch (err) {
      logError('Failed to load applications', err);
    } finally {
      setIsLoadingApps(false);
    }
  }, [id]);

  useEffect(() => {
    if (showApplications && isOwner) {
      loadApplications();
    }
  }, [showApplications, isOwner, loadApplications]);

  const handleApply = async () => {
    if (!id || isSubmitting) return;
    setIsSubmitting(true);
    try {
      let response;
      if (cvFile) {
        const formData = new FormData();
        formData.append('message', applyMessage || '');
        formData.append('cv', cvFile);
        response = await api.upload(`/v2/jobs/${id}/apply`, formData);
      } else {
        response = await api.post(`/v2/jobs/${id}/apply`, {
          message: applyMessage || null,
        });
      }
      if (response.success) {
        const appId = (response as { data?: { id?: number } }).data?.id;
        if (cvFile && appId) {
          try {
            const parseRes = await api.get<{ skills?: string[]; summary?: string }>(`/v2/jobs/applications/${appId}/parse-cv`);
            if (parseRes.success && parseRes.data) {
              const parsed = parseRes.data;
              setCvParsed({ skills: parsed.skills ?? [], summary: parsed.summary });
              const count = parsed.skills?.length ?? 0;
              if (count > 0) {
                toastRef.current.success(
                  tRef.current('cv.parsed_toast', { count })
                );
              } else {
                toastRef.current.success(tRef.current('apply.success'));
              }
            } else {
              toastRef.current.success(tRef.current('apply.success'));
            }
          } catch (err) {
            toastRef.current.error(tRef.current('apply.cv_parse_error'));
            if (import.meta.env.DEV) console.warn('CV parse failed:', err);
          }
        } else {
          toastRef.current.success(tRef.current('apply.success'));
        }
        applyModal.onClose();
        if (applyMessage.trim()) {
          api.put('/v2/jobs/saved-profile', { headline: '', cover_text: applyMessage.trim() }).catch((err) => { if (import.meta.env.DEV) console.warn('Non-critical:', err); });
        }
        setApplyMessage('');
        setCvFile(null);
        setSavedProfile(null);
        setUsingSavedProfile(false);
        loadVacancy();
      } else {
        toastRef.current.error((response as { error?: string }).error || tRef.current('apply.error'));
      }
    } catch (err) {
      logError('Failed to apply for job', err);
      toastRef.current.error(tRef.current('apply.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCvDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type)) {
      if (file.size <= 5 * 1024 * 1024) {
        setCvFile(file);
      } else {
        toastRef.current.error(tRef.current('apply.cv_too_large'));
      }
    } else {
      toastRef.current.error(tRef.current('apply.cv_invalid_type'));
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      const response = await api.delete(`/v2/jobs/${id}`);
      if (response.success) {
        toastRef.current.success(tRef.current('detail.deleted'));
        deleteModal.onClose();
        navigate(tenantPath('/jobs'));
      } else {
        toastRef.current.error(tRef.current('detail.delete_error'));
      }
    } catch (err) {
      logError('Failed to delete vacancy', err);
      toastRef.current.error(tRef.current('detail.delete_error'));
    }
  };

  const handleToggleSave = async () => {
    if (!id || isSaving) return;
    setIsSaving(true);
    try {
      if (isSaved) {
        const response = await api.delete(`/v2/jobs/${id}/save`);
        if (response.success) {
          setIsSaved(false);
          toastRef.current.success(tRef.current('saved.unsave_success'));
        }
      } else {
        const response = await api.post(`/v2/jobs/${id}/save`, {});
        if (response.success) {
          setIsSaved(true);
          toastRef.current.success(tRef.current('saved.save_success'));
        }
      }
    } catch (err) {
      logError('Failed to toggle save', err);
      toastRef.current.error(tRef.current('saved.save_error'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateAppStatus = async (applicationId: number, status: string) => {
    try {
      const response = await api.put(`/v2/jobs/applications/${applicationId}`, { status });
      if (response.success) {
        toastRef.current.success(tRef.current('detail.status_updated'));
        loadApplications();
      } else {
        toastRef.current.error(tRef.current('detail.status_update_error'));
      }
    } catch (err) {
      logError('Failed to update application status', err);
      toastRef.current.error(tRef.current('detail.status_update_error'));
    }
  };

  const handleCheckQualification = async () => {
    if (!id) return;
    setIsLoadingQualification(true);
    qualifiedModal.onOpen();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await api.get<QualificationResult>(`/v2/jobs/${id}/qualified`, { signal: controller.signal });
      if (response.success && response.data) {
        setQualification(response.data);
      }
    } catch (err) {
      logError('Failed to load qualification', err);
    } finally {
      clearTimeout(timeout);
      setIsLoadingQualification(false);
    }
  };

  const handleRenew = async () => {
    if (!id) return;
    setIsRenewing(true);
    try {
      const response = await api.post(`/v2/jobs/${id}/renew`, { days: renewDays });
      if (response.success) {
        toastRef.current.success(tRef.current('renew.success'));
        renewModal.onClose();
        loadVacancy();
      } else {
        toastRef.current.error(tRef.current('renew.error'));
      }
    } catch (err) {
      logError('Failed to renew job', err);
      toastRef.current.error(tRef.current('renew.error'));
    } finally {
      setIsRenewing(false);
    }
  };

  const handleAiChat = useCallback(async () => {
    if (!id || !aiChatInput.trim() || aiChatLoading) return;
    const userMsg = aiChatInput.trim();
    setAiChatInput('');
    setAiChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setAiChatLoading(true);
    try {
      const res = await api.post(`/v2/jobs/${id}/ai-chat`, {
        message: userMsg,
        history: aiChatMessages,
      });
      if (res.success && res.data) {
        const data = res.data as { reply: string };
        setAiChatMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      } else {
        setAiChatMessages(prev => [...prev, { role: 'assistant', content: tRef.current('ai_chat.error_response') }]);
      }
    } catch {
      setAiChatMessages(prev => [...prev, { role: 'assistant', content: tRef.current('ai_chat.error_generic') }]);
    } finally {
      setAiChatLoading(false);
    }
  }, [id, aiChatInput, aiChatLoading, aiChatMessages]);

  // J9: Format salary display (EU Pay Transparency)
  const formatSalary = () => {
    if (!vacancy) return null;
    if (vacancy.salary_negotiable && !vacancy.salary_min && !vacancy.salary_max) return null;
    if (!vacancy.salary_min && !vacancy.salary_max) return null;
    const currency = vacancy.salary_currency || '';
    const typeLabel = vacancy.salary_type ? ` / ${t(`salary.${vacancy.salary_type}`)}` : '';
    if (vacancy.salary_min && vacancy.salary_max) {
      return `${currency}${Number(vacancy.salary_min).toLocaleString(getFormattingLocale())} \u2013 ${currency}${Number(vacancy.salary_max).toLocaleString(getFormattingLocale())}${typeLabel}`;
    }
    if (vacancy.salary_min) return `${t('salary.min_only', { min: `${currency}${Number(vacancy.salary_min).toLocaleString(getFormattingLocale())}` })}${typeLabel}`;
    if (vacancy.salary_max) return `${t('salary.max_only', { max: `${currency}${Number(vacancy.salary_max).toLocaleString(getFormattingLocale())}` })}${typeLabel}`;
    return null;
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6" role="status" aria-busy="true" aria-label={t('common:loading')}>
        <PageMeta title={t('detail.loading')} noIndex />
        <CardRowsSkeleton className="p-6" />
      </div>
    );
  }

  // Error state
  if (error || !vacancy) {
    return (
      <>
        <PageMeta title={error || t('detail.not_found')} noIndex />
        <EmptyState
          icon={<Briefcase className="w-12 h-12" aria-hidden="true" />}
          title={error || t('detail.not_found')}
          description={t('detail.not_found_desc')}
          action={
            <div className="flex gap-2">
              <Button as={Link} to={tenantPath('/jobs')} variant="flat" className="bg-theme-elevated text-theme-muted">
                {t('detail.browse_vacancies')}
              </Button>
              <Button
                className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
                onPress={loadVacancy}
              >
                {t('detail.try_again')}
              </Button>
            </div>
          }
        />
      </>
    );
  }

  const deadlineDate = vacancy.deadline ? new Date(vacancy.deadline) : null;
  const isPastDeadline = deadlineDate ? deadlineDate < new Date() : false;
  const vacancySocial = vacancy as JobVacancy & {
    is_liked?: boolean;
    likes_count?: number;
    comments_count?: number;
  };

  return (
    <>
      <article className="space-y-6">
        <PageMeta
          title={vacancy.title}
          description={vacancy.description?.replace(/\s+/g, ' ').trim().slice(0, 160)}
          image={vacancy.organization?.logo_url || undefined}
          type="article"
          publishedTime={vacancy.created_at}
          modifiedTime={vacancy.renewed_at || vacancy.created_at}
        />
        <Helmet>
          <script type="application/ld+json">
            {buildJobPostingSchema(vacancy, tenantPath)}
          </script>
        </Helmet>

        {/* Back nav */}
        <Link to={tenantPath('/jobs')} className="inline-flex items-center gap-2 text-theme-muted hover:text-theme-primary transition-colors">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {t('back_to_jobs')}
        </Link>

        {/* Header Card */}
        <JobDetailHeader
          vacancy={vacancy}
          isOwner={!!isOwner}
          isAuthenticated={isAuthenticated}
          isSaved={isSaved}
          isSaving={isSaving}
          isPastDeadline={isPastDeadline}
          matchResult={matchResult}
          formatSalary={formatSalary}
          tenantPath={tenantPath}
          onToggleSave={handleToggleSave}
          onRenewOpen={renewModal.onOpen}
          onDeleteOpen={deleteModal.onOpen}
          displayTitle={translatedTitle}
          onCopyLink={async () => {
            const jobUrl = window.location.origin + tenantPath(`/jobs/${vacancy.id}`);
            await navigator.clipboard.writeText(jobUrl);
            toastRef.current.success(tRef.current('share.copied'));
          }}
        />

        {/* Owner management banner */}
        {isOwner && (
          <JobOwnerBanner
            vacancy={vacancy}
            tenantPath={tenantPath}
            onVacancyUpdated={() => {
              loadVacancy();
            }}
          />
        )}

        {/* Inline Interview Response Card */}
        {!isOwner && vacancy.has_applied && pendingInterview && (
          <InlineInterviewCard
            pendingInterview={pendingInterview}
            isResponding={isRespondingInterview}
            onAccept={handleAcceptInterview}
            onDeclineOpen={() => { setDeclineNotes(''); setShowDeclineInterviewModal(true); }}
          />
        )}

        {/* Inline Offer Response Card */}
        {!isOwner && vacancy.has_applied && pendingOffer && (
          <InlineOfferCard
            pendingOffer={pendingOffer}
            isResponding={isRespondingOffer}
            onAccept={handleAcceptOffer}
            onDeclineOpen={() => { setDeclineNotes(''); setShowDeclineOfferModal(true); }}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            <JobDescriptionCard
              vacancy={vacancy}
              isOwner={!!isOwner}
              isAuthenticated={isAuthenticated}
              matchResult={matchResult}
              qualificationData={qualificationData}
              onCheckQualification={handleCheckQualification}
              displayDescription={translatedDesc}
              translateButton={(
                <TranslateButton
                  contentType="job"
                  contentId={vacancy.id}
                  sourceText={vacancy.description ?? ''}
                  sourceLocale={null}
                  onTextChange={onTranslatedText}
                  extraFields={{ title: vacancy.title }}
                  onFieldsChange={onTranslatedFields}
                  className="mt-1"
                />
              )}
            />

            <GlassCard className="p-4 sm:p-5">
              <SocialInteractionPanel
                targetType="job"
                targetId={vacancy.id}
                initialLiked={vacancySocial.is_liked ?? false}
                initialLikesCount={vacancySocial.likes_count ?? 0}
                initialCommentsCount={vacancySocial.comments_count ?? 0}
                title={vacancy.title}
                description={vacancy.description}
                targetOwnerId={vacancy.user_id}
              />
            </GlassCard>

            {/* Apply button (mobile) */}
            <div className="lg:hidden">
              <ApplySection
                vacancy={vacancy}
                isAuthenticated={isAuthenticated}
                isOwner={!!isOwner}
                isSubmitting={isSubmitting}
                savedProfile={savedProfile}
                tenantPath={tenantPath}
                onApplyOpen={applyModal.onOpen}
                onQuickApplySuccess={() => {
                  toastRef.current.success(tRef.current('apply.success'));
                  setSavedProfile(null);
                  loadVacancy();
                }}
                onQuickApplyError={(msg) => toastRef.current.error(msg)}
                setIsSubmitting={setIsSubmitting}
              />
            </div>

            {/* Applications pipeline (owner view) */}
            {isOwner && (
              <JobApplicationsList
                vacancy={vacancy}
                applications={applications}
                isLoadingApps={isLoadingApps}
                showApplications={showApplications}
                onToggleShow={() => setShowApplications(!showApplications)}
                onUpdateStatus={handleUpdateAppStatus}
                onRefresh={loadApplications}
                tenantPath={tenantPath}
                navigateFn={navigate}
              />
            )}

            {/* Pipeline Automation Rules (owner-only) */}
            {isOwner && id && (
              <JobPipelineRules jobId={id} />
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Apply section (desktop) */}
            <div className="hidden lg:block">
              <ApplySection
                vacancy={vacancy}
                isAuthenticated={isAuthenticated}
                isOwner={!!isOwner}
                isSubmitting={isSubmitting}
                savedProfile={savedProfile}
                tenantPath={tenantPath}
                onApplyOpen={applyModal.onOpen}
                onQuickApplySuccess={() => {
                  toastRef.current.success(tRef.current('apply.success'));
                  setSavedProfile(null);
                  loadVacancy();
                }}
                onQuickApplyError={(msg) => toastRef.current.error(msg)}
                setIsSubmitting={setIsSubmitting}
              />
            </div>

            {/* Details card */}
            <JobMetadataSidebar
              vacancy={vacancy}
              isOwner={!!isOwner}
              benchmark={benchmark}
              formatSalary={formatSalary}
            />
          </div>
        </div>

        {/* Modals */}
        <ApplyModal
          isOpen={applyModal.isOpen}
          onOpenChange={(open) => { if (!open) applyModal.onClose(); else applyModal.onOpen(); }}
          applyMessage={applyMessage}
          setApplyMessage={setApplyMessage}
          cvFile={cvFile}
          setCvFile={setCvFile}
          cvParsed={cvParsed}
          setCvParsed={setCvParsed}
          isSubmitting={isSubmitting}
          savedProfile={savedProfile}
          setSavedProfile={setSavedProfile}
          usingSavedProfile={usingSavedProfile}
          setUsingSavedProfile={setUsingSavedProfile}
          onApply={handleApply}
          onCvDrop={handleCvDrop}
          onCvTooBig={() => toastRef.current.error(tRef.current('apply.cv_too_large'))}
        />

        <QualificationModal
          isOpen={qualifiedModal.isOpen}
          onOpenChange={qualifiedModal.onOpenChange}
          qualification={qualification}
          isLoading={isLoadingQualification}
          hasApplied={vacancy.has_applied}
          vacancyStatus={vacancy.status}
          onApplyOpen={applyModal.onOpen}
        />

        <RenewModal
          isOpen={renewModal.isOpen}
          onOpenChange={renewModal.onOpenChange}
          renewDays={renewDays}
          setRenewDays={setRenewDays}
          isRenewing={isRenewing}
          onRenew={handleRenew}
        />

        <DeleteModal
          isOpen={deleteModal.isOpen}
          onOpenChange={deleteModal.onOpenChange}
          onDelete={handleDelete}
        />

        <DeclineModal
          isOpen={showDeclineInterviewModal}
          titleKey="inline_response.interview_decline"
          notesLabelKey="inline_response.decline_notes_label"
          notesPlaceholderKey="inline_response.decline_notes_placeholder"
          declineNotes={declineNotes}
          setDeclineNotes={setDeclineNotes}
          isLoading={isRespondingInterview}
          onClose={() => setShowDeclineInterviewModal(false)}
          onConfirm={handleDeclineInterview}
        />

        <DeclineModal
          isOpen={showDeclineOfferModal}
          titleKey="inline_response.offer_decline"
          notesLabelKey="inline_response.decline_reason_label"
          notesPlaceholderKey="inline_response.decline_reason_placeholder"
          declineNotes={declineNotes}
          setDeclineNotes={setDeclineNotes}
          isLoading={isRespondingOffer}
          onClose={() => setShowDeclineOfferModal(false)}
          onConfirm={handleDeclineOffer}
        />

        {/* Similar Jobs */}
        <SimilarJobs jobs={similarJobs} tenantPath={tenantPath} />
      </article>

      {/* AI Chat Drawer */}
      {isAuthenticated && vacancy && !isOwner && (
        <AiChatDrawer
          isOpen={aiChatOpen}
          messages={aiChatMessages}
          inputValue={aiChatInput}
          isLoading={aiChatLoading}
          onOpen={() => setAiChatOpen(true)}
          onClose={() => setAiChatOpen(false)}
          onInputChange={setAiChatInput}
          onSend={handleAiChat}
        />
      )}
    </>
  );
}

export default JobDetailPage;
