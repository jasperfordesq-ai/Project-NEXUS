// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import Briefcase from 'lucide-react/icons/briefcase';
import MapPin from 'lucide-react/icons/map-pin';
import Wifi from 'lucide-react/icons/wifi';
import Clock from 'lucide-react/icons/clock';
import ChevronDown from 'lucide-react/icons/chevron-down';
import ChevronUp from 'lucide-react/icons/chevron-up';
import Calendar from 'lucide-react/icons/calendar';
import CalendarPlus from 'lucide-react/icons/calendar-plus';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import History from 'lucide-react/icons/history';
import MessageCircle from 'lucide-react/icons/message-circle';
import Video from 'lucide-react/icons/video';
import Download from 'lucide-react/icons/download';
import FileDown from 'lucide-react/icons/file-down';
import ExternalLink from 'lucide-react/icons/external-link';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { safeHref, webHref } from '@/lib/safeHref';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { EmptyState } from '@/components/feedback';

import { useTranslation } from 'react-i18next';
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApplicationVacancy {
  id: number;
  title: string;
  type: 'paid' | 'volunteer' | 'timebank';
  commitment: 'full_time' | 'part_time' | 'flexible' | 'one_off';
  status: string;
  location: string | null;
  is_remote: boolean;
  deadline: string | null;
  creator?: {
    id: number;
    name: string;
  };
}

interface ApplicationInterview {
  id: number;
  application_id: number;
  scheduled_at: string;
  interview_type: 'video' | 'phone' | 'in_person';
  status: 'proposed' | 'accepted' | 'declined';
  location_notes?: string | null;
  meeting_link?: string | null;
  duration_mins?: number;
}

interface ApplicationOffer {
  id: number;
  application_id: number;
  salary_offered: string | null;
  salary_currency: string;
  salary_type: 'hourly' | 'monthly' | 'annual';
  start_date: string | null;
  message: string | null;
  status: 'pending' | 'accepted' | 'rejected';
}

interface JobApplication {
  id: number;
  vacancy_id: number;
  user_id: number;
  status: string;
  stage: string;
  message: string | null;
  reviewer_notes: string | null;
  cv_path?: string | null;
  created_at: string;
  updated_at: string;
  vacancy: ApplicationVacancy;
  interview?: ApplicationInterview | null;
  offer?: ApplicationOffer | null;
}

interface ApplicationsResponse {
  items: JobApplication[];
  cursor: string | null;
  has_more: boolean;
}

interface HistoryEntry {
  id: number;
  application_id: number;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  notes: string | null;
  changed_by_name: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, 'default' | 'accent' | 'warning' | 'success' | 'danger'> = {
  applied: 'default',
  pending: 'default',
  screening: 'accent',
  reviewed: 'accent',
  interview: 'warning',
  offer: 'default',
  accepted: 'success',
  rejected: 'danger',
  withdrawn: 'default',
};

const TYPE_CHIP_COLORS: Record<string, 'accent' | 'success' | 'default'> = {
  paid: 'accent',
  volunteer: 'success',
  timebank: 'default',
};

const ACTIVE_STATUSES = new Set(['applied', 'pending', 'screening', 'reviewed', 'interview', 'offer']);
const ITEMS_PER_PAGE = 20;

/** Map history statuses to timeline dot colors */
const TIMELINE_DOT_COLORS: Record<string, string> = {
  applied: 'bg-surface-tertiary',
  pending: 'bg-surface-tertiary',
  screening: 'bg-accent',
  reviewed: 'bg-accent',
  interview: 'bg-warning',
  offer: 'bg-surface-tertiary',
  accepted: 'bg-success',
  rejected: 'bg-danger',
  withdrawn: 'bg-surface-secondary',
};

type FilterTab = 'all' | 'active' | 'accepted' | 'rejected';

const tabToStatus = (tab: FilterTab): string => {
  switch (tab) {
    case 'active':
      return 'applied,pending,screening,reviewed,interview,offer';
    case 'accepted':
      return 'accepted';
    case 'rejected':
      return 'rejected';
    default:
      return '';
  }
};

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
};

// ---------------------------------------------------------------------------
// ApplicationCard sub-component
// ---------------------------------------------------------------------------

interface ApplicationCardProps {
  application: JobApplication;
  onWithdraw: (app: JobApplication) => void;
  tenantPath: (path: string) => string;
  onMessageEmployer?: (creatorId: number, vacancyId: number) => void;
  onAcceptInterview?: (interviewId: number) => void;
  onDeclineInterview?: (interviewId: number) => void;
  onAcceptOffer?: (offerId: number) => void;
  onRejectOffer?: (offerId: number) => void;
}

function ApplicationCard({ application, onWithdraw, tenantPath, onMessageEmployer, onAcceptInterview, onDeclineInterview, onAcceptOffer, onRejectOffer }: ApplicationCardProps) {
  const { t } = useTranslation('jobs');
  const toast = useToast();
  const [messageExpanded, setMessageExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const { vacancy } = application;

  // The CV lives on a private disk and is streamed through an authenticated
  // endpoint (the applicant is authorized for their own CV) — never link the raw
  // storage path, which is not a public URL.
  const handleDownloadCv = async () => {
    try {
      await api.download(`/v2/jobs/applications/${application.id}/cv`, { filename: 'CV.pdf' });
    } catch (err) {
      logError('MyApplicationsPage: failed to download CV', err);
      toast.error(t('detail.cv_download_error'));
    }
  };

  const appliedDate = new Date(application.created_at);
  const updatedDate = new Date(application.updated_at);
  const datesAreDifferent = Math.abs(updatedDate.getTime() - appliedDate.getTime()) > 60_000;

  let deadlineLabel: React.ReactNode = null;
  if (vacancy.deadline) {
    const deadlineDate = new Date(vacancy.deadline);
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysUntilDeadline = Math.floor((deadlineDate.getTime() - Date.now()) / msPerDay);
    if (daysUntilDeadline < 0) {
      deadlineLabel = (
        <span className='flex items-center gap-1 text-xs text-danger'>
          <AlertTriangle size={12} aria-hidden="true" />
          {t('deadline_passed')}
        </span>
      );
    } else if (daysUntilDeadline < 7) {
      deadlineLabel = (
        <span className='flex items-center gap-1 text-xs text-warning font-medium'>
          <AlertTriangle size={12} aria-hidden="true" />
          {daysUntilDeadline === 0
            ? t('my_applications.deadline_today')
            : t('my_applications.days_left', { count: daysUntilDeadline })}
        </span>
      );
    } else {
      deadlineLabel = (
        <span className='flex items-center gap-1 text-xs text-theme-muted'>
          <Calendar size={12} />
          {deadlineDate.toLocaleDateString(getFormattingLocale())}
        </span>
      );
    }
  }

  const isActive = ACTIVE_STATUSES.has(application.status);

  return (
    <motion.div variants={itemVariants}>
      <GlassCard className='p-5'>
        {/* Header row */}
        <div className='flex flex-wrap items-start justify-between gap-3 mb-3'>
          <div className='flex-1 min-w-0'>
            <Link
              to={tenantPath(`/jobs/${vacancy.id}`)}
              className='text-base font-semibold text-theme-primary hover:text-accent transition-colors line-clamp-2'>
              {vacancy.title}
            </Link>
          </div>
          <div className='flex flex-wrap items-center gap-2 shrink-0'>
            <Chip
              color={TYPE_CHIP_COLORS[vacancy.type] ?? 'default'}
              size='sm'
              variant='tertiary'>
              {t(`type.${vacancy.type}`)}
            </Chip>
            <Chip
              color={STATUS_COLORS[application.status] ?? 'default'}
              size='sm'
              variant='tertiary'>
              {t(`application_status.${application.status}`)}
            </Chip>
          </div>
        </div>

        {/* Meta row */}
        <div className='flex flex-wrap items-center gap-3 mb-3 text-xs text-theme-muted'>
          <span className='flex items-center gap-1'>
            <Clock size={12} aria-hidden="true" />
            {t(`commitment.${vacancy.commitment}`)}
          </span>
          {vacancy.is_remote ? (
            <span className='flex items-center gap-1'>
              <Wifi size={12} aria-hidden="true" />
              {t('remote')}
            </span>
          ) : vacancy.location ? (
            <span className='flex items-center gap-1'>
              <MapPin size={12} aria-hidden="true" />
              {vacancy.location}
            </span>
          ) : null}
          {deadlineLabel}
        </div>

        {/* Dates row */}
        <div className='flex flex-wrap gap-3 mb-3 text-xs text-theme-muted'>
          <span>{t('my_applications.applied_date', { date: appliedDate.toLocaleDateString(getFormattingLocale()) })}</span>
          {datesAreDifferent && (
            <span>{t('my_applications.updated_date', { date: updatedDate.toLocaleDateString(getFormattingLocale()) })}</span>
          )}
        </div>

        {/* Cover message */}
        {application.message && (
          <div className='mb-3'>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setMessageExpanded((v) => !v)}
              className="mb-1 flex min-h-[28px] items-center gap-1 px-0 py-0 text-xs text-theme-muted transition-colors hover:text-theme-primary"
              startContent={messageExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            >
              {messageExpanded
                ? t('my_applications.hide_cover_message')
                : t('my_applications.show_cover_message')}
            </Button>
            <AnimatePresence initial={false}>
              {messageExpanded && (
                <motion.div
                  key='msg'
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className='overflow-hidden'>
                  <p className='text-sm text-theme-secondary bg-white/5 rounded-lg p-3 whitespace-pre-wrap'>
                    {application.message}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Reviewer notes */}
        {application.reviewer_notes && (
          <blockquote className='border-l-2 border-accent/40 pl-3 mb-3 text-sm text-theme-muted italic'>
            {application.reviewer_notes}
          </blockquote>
        )}

        {/* Interview section — inline details */}
        {application.interview && (
          <div className='mt-3 p-3 rounded-lg bg-surface-secondary dark:bg-surface-secondary border border-accent dark:border-accent'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div className='flex items-center gap-2 text-sm font-medium text-accent dark:text-accent'>
                <Video size={14} aria-hidden="true" />
                {t('interview_inline', {
                  date: new Date(application.interview.scheduled_at).toLocaleString(getFormattingLocale(), {
                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  }),
                  type: application.interview.interview_type === 'video'
                    ? t('interview.type_video')
                    : application.interview.interview_type === 'phone'
                    ? t('interview.type_phone')
                    : t('interview.type_in_person'),
                })}
              </div>
              <Chip
                size='sm'
                variant='tertiary'
                color={application.interview.status === 'accepted' ? 'success' : application.interview.status === 'declined' ? 'danger' : 'warning'}
              >
                {application.interview.status === 'accepted'
                  ? t('interview.accepted')
                  : application.interview.status === 'declined'
                  ? t('interview.declined')
                  : t('interview.proposed')}
              </Chip>
            </div>
            {application.interview.duration_mins && (
              <div className='text-xs text-accent dark:text-accent mt-1'>
                {t('interview.duration')}: {application.interview.duration_mins} {t('interview.minutes')}
              </div>
            )}
            <div className='flex flex-wrap items-center gap-2 mt-2'>
              {/* Join Video Call — meeting_link (Jitsi auto-generated or custom) */}
              {/* F-298: the employer types these; only a web URL becomes a link. */}
              {safeHref(application.interview.meeting_link) && (
                <Button
                  as='a'
                  href={safeHref(application.interview.meeting_link)}
                  target='_blank'
                  rel='noopener noreferrer'
                  size='sm'
                  variant='primary'
                  startContent={<Video size={14} aria-hidden="true" />}
                >
                  {t('interview.join_call')}
                </Button>
              )}
              {/* Fallback: Meeting link via location_notes for video interviews */}
              {!safeHref(application.interview.meeting_link) && application.interview.interview_type === 'video' && webHref(application.interview.location_notes) && (
                <Button
                  as='a'
                  href={webHref(application.interview.location_notes)}
                  target='_blank'
                  rel='noopener noreferrer'
                  size='sm'
                  variant='secondary'
                  startContent={<ExternalLink size={13} aria-hidden="true" />}
                >
                  {t('interview_join')}
                </Button>
              )}
              {application.interview.location_notes
                && (application.interview.interview_type !== 'video'
                  || (!safeHref(application.interview.meeting_link) && !webHref(application.interview.location_notes))) && (
                <span className='text-xs text-accent dark:text-accent'>
                  {application.interview.location_notes}
                </span>
              )}
              {/* Calendar links */}
              {application.interview.id && (
                <CalendarLinks interviewId={application.interview.id} />
              )}
              {/* Accept / Decline actions for proposed */}
              {application.interview.status === 'proposed' && (
                <>
                  {onAcceptInterview && (
                    <Button size='sm' variant='primary'
                      onPress={() => onAcceptInterview(application.interview!.id)}>
                      {t('interview.accept')}
                    </Button>
                  )}
                  {onDeclineInterview && (
                    <Button size='sm' variant='danger-soft'
                      onPress={() => onDeclineInterview(application.interview!.id)}>
                      {t('interview.decline')}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Offer section — inline details for all statuses */}
        {application.offer && (
          <div className={`mt-3 p-3 rounded-lg border ${
            application.offer.status === 'pending'
              ? 'bg-success-50 dark:bg-success-900/20 border-success-200 dark:border-success-800'
              : application.offer.status === 'accepted'
              ? 'bg-success-50 dark:bg-success-900/20 border-success-200 dark:border-success-800'
              : 'bg-danger-50 dark:bg-danger-900/20 border-danger-200 dark:border-danger-800'
          }`}>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div className='text-sm font-medium text-success-700 dark:text-success-300'>
                {application.offer.salary_offered
                  ? t('offer_inline', {
                      salary: `${application.offer.salary_currency} ${Number(application.offer.salary_offered).toLocaleString(getFormattingLocale())} / ${t(`salary.${application.offer.salary_type}`)}`,
                    })
                  : t('offer.title')}
              </div>
              <Chip
                size='sm'
                variant='tertiary'
                color={application.offer.status === 'accepted' ? 'success' : application.offer.status === 'rejected' ? 'danger' : 'warning'}
              >
                {application.offer.status === 'accepted'
                  ? t('offer.accepted')
                  : application.offer.status === 'rejected'
                  ? t('offer.rejected')
                  : t('inline_response.offer_pending')}
              </Chip>
            </div>
            {application.offer.start_date && (
              <div className='text-xs text-success-600 dark:text-success-400 mt-1'>
                {t('offer_start_date', {
                  date: new Date(application.offer.start_date).toLocaleDateString(getFormattingLocale()),
                })}
              </div>
            )}
            {application.offer.message && (
              <p className='text-xs text-muted mt-2 italic'>
                &ldquo;{application.offer.message}&rdquo;
              </p>
            )}
            {application.offer.status === 'pending' && (
              <div className='flex gap-2 mt-3'>
                {onAcceptOffer && (
                  <Button size='sm' variant='primary' onPress={() => onAcceptOffer(application.offer!.id)}>
                    {t('offer.accept')}
                  </Button>
                )}
                {onRejectOffer && (
                  <Button size='sm' variant='danger-soft' onPress={() => onRejectOffer(application.offer!.id)}>
                    {t('offer.reject')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className='flex justify-end gap-2 flex-wrap'>
          {/* Download CV */}
          {application.cv_path && (
            <Button
              onPress={handleDownloadCv}
              size='sm'
              variant='tertiary'
              className='bg-theme-elevated text-theme-muted'
              startContent={<FileDown size={13} aria-hidden="true" />}
            >
              {t('download_cv')}
            </Button>
          )}
          {/* Feature 6: Message Employer */}
          {application.vacancy.creator?.id && onMessageEmployer && (
            <Button
              size='sm'
              variant='tertiary'
              className='bg-theme-elevated text-theme-muted'
              startContent={<MessageCircle size={13} aria-hidden="true" />}
              onPress={() => onMessageEmployer(application.vacancy.creator!.id, application.vacancy_id)}
            >
              {t('apply.message_employer')}
            </Button>
          )}
          <Button
            size='sm'
            variant='tertiary'
            startContent={<History size={13} aria-hidden="true" />}
            onPress={() => {
              setHistoryOpen((v) => !v);
              if (!historyOpen && history.length === 0) {
                setHistoryLoading(true);
                api.get<HistoryEntry[]>(`/v2/jobs/applications/${application.id}/history`)
                  .then((res) => {
                    if (res.success && Array.isArray(res.data)) setHistory(res.data);
                  })
                  .catch((err: unknown) => {
                    logError('MyApplicationsPage: failed to load application history', err);
                  })
                  .finally(() => setHistoryLoading(false));
              }
            }}>
            {t('history.title')}
          </Button>
          {isActive && (
            <Button
              size='sm'
              variant='danger-soft'
              aria-label={t('my_applications.withdraw_aria', { title: application.vacancy.title })}
              onPress={() => onWithdraw(application)}>
              {t('my_applications.withdraw')}
            </Button>
          )}
        </div>

        {/* Inline history panel */}
        <AnimatePresence initial={false}>
          {historyOpen && (
            <motion.div
              key='history'
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className='overflow-hidden'>
              <div className='mt-3 pt-3 border-t border-divider'>
                <p className='text-xs font-semibold text-muted uppercase tracking-wide mb-3'>{t('history.status_history')}</p>
                {historyLoading && <div className='flex justify-center py-3'><div role="status" aria-busy="true" aria-label={t('loading')}><Spinner size='sm' /></div></div>}
                {!historyLoading && history.length === 0 && (
                  <p className='text-xs text-muted'>{t('history.empty')}</p>
                )}
                {!historyLoading && history.length > 0 && (
                  <ol className='relative ml-2'>
                    {history.map((entry, idx) => {
                      const isLast = idx === history.length - 1;
                      const dotColor = TIMELINE_DOT_COLORS[entry.to_status] ?? 'bg-surface-tertiary';
                      const statusKey = `timeline.${entry.to_status}` as const;
                      return (
                        <li key={entry.id} className='relative pl-5 pb-4 last:pb-0'>
                          {/* Connecting line */}
                          {!isLast && (
                            <span className='absolute left-[3px] top-3 bottom-0 w-0.5 bg-border' aria-hidden="true" />
                          )}
                          {/* Dot */}
                          <span className={`absolute left-0 top-1 w-2 h-2 rounded-full ring-2 ring-white dark:ring-surface ${dotColor}`} aria-hidden="true" />
                          <div className='min-w-0'>
                            <span className='text-xs font-medium text-foreground'>
                              {entry.from_status
                                ? t(`application_status.${entry.to_status}`)
                                : t(statusKey)}
                            </span>
                            {entry.notes && (
                              <p className='text-xs text-muted italic mt-0.5'>{entry.notes}</p>
                            )}
                            <div className='text-xs text-muted mt-0.5'>
                              {new Date(entry.changed_at).toLocaleDateString(getFormattingLocale(), { year: 'numeric', month: 'short', day: 'numeric' })}
                              {entry.changed_by_name && <span className='ml-1'>{t('history.by', { name: entry.changed_by_name })}</span>}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Calendar links helper
// ---------------------------------------------------------------------------

function CalendarLinks({ interviewId }: { interviewId: number }) {
  const { t } = useTranslation('jobs');
  const [links, setLinks] = useState<{ google?: string; outlook?: string; ics?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchLinks = useCallback(async () => {
    if (links || loading) return;
    setLoading(true);
    try {
      const res = await api.get(`/v2/jobs/interviews/${interviewId}/calendar-links`);
      if (res.success && res.data) setLinks(res.data as { google?: string; outlook?: string; ics?: string });
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [interviewId, links, loading]);

  if (!links) {
    return (
      <Button size="sm" variant="flat" startContent={<CalendarPlus size={14} aria-hidden="true" />} onPress={fetchLinks} isLoading={loading}>
        {t('interview.add_to_calendar')}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {links.google && (
        <Button size="sm" variant="flat" as="a" href={links.google} target="_blank" rel="noopener noreferrer" startContent={<CalendarPlus size={12} aria-hidden="true" />}>
          {t('interview.calendar_google')}
        </Button>
      )}
      {links.outlook && (
        <Button size="sm" variant="flat" as="a" href={links.outlook} target="_blank" rel="noopener noreferrer" startContent={<CalendarPlus size={12} aria-hidden="true" />}>
          {t('interview.calendar_outlook')}
        </Button>
      )}
      {links.ics && (
        <Button size="sm" variant="flat" as="a" href={links.ics} download="interview.ics" startContent={<Download size={12} />}>
          {t('interview.calendar_ics')}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton placeholder
// ---------------------------------------------------------------------------

function ApplicationSkeleton() {
  return (
    <GlassCard className='p-5 space-y-3'>
      <div className='flex justify-between'>
        <Skeleton className='h-5 w-2/3 rounded-lg' />
        <Skeleton className='h-5 w-20 rounded-full' />
      </div>
      <div className='flex gap-3'>
        <Skeleton className='h-4 w-24 rounded-lg' />
        <Skeleton className='h-4 w-20 rounded-lg' />
      </div>
      <Skeleton className='h-4 w-32 rounded-lg' />
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function MyApplicationsPage() {
  const { t } = useTranslation('jobs');
  usePageTitle(t('my_applications.title'));
  // Route is auth-gated by <ProtectedRoute> in App.tsx — no need to read auth here.
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const toast = useToast();

  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  // Bumped after every successful page load (fresh OR appended) so the
  // interview/offer merge effect re-runs and attaches to the latest list.
  const [mergeTick, setMergeTick] = useState(0);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [withdrawTarget, setWithdrawTarget] = useState<JobApplication | null>(null);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const { isOpen: isWithdrawOpen, onOpen: openWithdraw, onClose: closeWithdraw } = useDisclosure();

  // Confirm modal for destructive interview/offer responses (decline / reject).
  // Reuses the in-module Modal pattern (same as withdraw) so it works without the
  // global ConfirmDialogProvider being mounted in unit tests.
  const [pendingResponse, setPendingResponse] = useState<
    { kind: 'decline-interview' | 'reject-offer'; id: number } | null
  >(null);
  const [isResponding, setIsResponding] = useState(false);

  // GDPR data export
  const [isExportingGdpr, setIsExportingGdpr] = useState(false);

  const loadApplications = useCallback(
    async (append = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      try {
        const params = new URLSearchParams();
        params.set('per_page', String(ITEMS_PER_PAGE));
        const status = tabToStatus(activeTab);
        if (status) params.set('status', status);
        if (append && cursorRef.current) params.set('cursor', cursorRef.current);

        const res = await api.get<ApplicationsResponse>(`/v2/jobs/my-applications?${params.toString()}`);
        if (controller.signal.aborted) return;

        if (res.success && res.data && 'items' in res.data) {
          const data = res.data as ApplicationsResponse;
          cursorRef.current = data.cursor ?? null;
          setHasMore(data.has_more);
          setApplications((prev) => (append ? [...prev, ...data.items] : data.items));
          // Trigger interview/offer merge against the now-current list (incl. appended pages)
          setMergeTick((n) => n + 1);
        } else {
          const msg = (res as { error?: string }).error ?? tRef.current('my_applications.load_error');
          if (!append) setError(msg);
          toastRef.current.error(msg);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        logError('MyApplicationsPage', err);
        const msg = tRef.current('something_wrong');
        if (!append) setError(msg);
        toastRef.current.error(msg);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [activeTab],
  );

  // Fetch interviews and offers from API and merge them into the applications list.
  // Uses the functional updater so it merges against current state (including any
  // "load more" appended pages) rather than a captured snapshot.
  const mergeInterviewsAndOffers = useCallback(async () => {
    try {
      const [interviewsRes, offersRes] = await Promise.all([
        api.get<{ data: ApplicationInterview[] } | ApplicationInterview[]>('/v2/jobs/my-interviews'),
        api.get<{ data: ApplicationOffer[] } | ApplicationOffer[]>('/v2/jobs/my-offers'),
      ]);

      const interviews: ApplicationInterview[] = (() => {
        if (!interviewsRes.success || !interviewsRes.data) return [];
        const d = interviewsRes.data;
        return Array.isArray(d) ? d : ('data' in d ? d.data : []);
      })();

      const offers: ApplicationOffer[] = (() => {
        if (!offersRes.success || !offersRes.data) return [];
        const d = offersRes.data;
        return Array.isArray(d) ? d : ('data' in d ? d.data : []);
      })();

      // Build lookup maps by application_id
      const interviewMap = new Map<number, ApplicationInterview>();
      for (const iv of interviews) interviewMap.set(iv.application_id, iv);

      const offerMap = new Map<number, ApplicationOffer>();
      for (const of_ of offers) offerMap.set(of_.application_id, of_);

      setApplications((prev) => prev.map((app) => ({
        ...app,
        interview: interviewMap.get(app.id) ?? null,
        offer: offerMap.get(app.id) ?? null,
      })));
    } catch (err) {
      // Non-critical — interviews/offers are supplementary
      logError('MyApplicationsPage: failed to load interviews/offers', err);
    }
  }, []);

  useEffect(() => {
    cursorRef.current = null;
    setHasMore(false);
    setApplications([]);
    loadApplications();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps -- reset state when tab changes; loadApplications excluded to avoid loop

  // After each page load (fresh or "load more"), fetch interviews + offers and
  // merge them into the current list. Keyed on mergeTick (bumped per successful
  // load) so appended pages also get their interviews/offers attached.
  useEffect(() => {
    if (mergeTick > 0) {
      mergeInterviewsAndOffers();
    }
  }, [mergeTick, mergeInterviewsAndOffers]);

  // Feature 3: Interview accept/decline handlers
  const handleAcceptInterview = useCallback(async (interviewId: number) => {
    try {
      const response = await api.put(`/v2/jobs/interviews/${interviewId}/accept`, {});
      if (response.success) {
        toastRef.current.success(tRef.current('interview.accepted'));
        cursorRef.current = null;
        setHasMore(false);
        setApplications([]);
        loadApplications();
      } else {
        toastRef.current.error(tRef.current('something_wrong'));
      }
    } catch (err) {
      logError('MyApplicationsPage.handleAcceptInterview', err);
      toastRef.current.error(tRef.current('something_wrong'));
    }
  }, [loadApplications]);

  const handleDeclineInterview = useCallback(async (interviewId: number) => {
    try {
      const response = await api.put(`/v2/jobs/interviews/${interviewId}/decline`, {});
      if (response.success) {
        toastRef.current.success(tRef.current('interview.declined'));
        cursorRef.current = null;
        setHasMore(false);
        setApplications([]);
        loadApplications();
      } else {
        toastRef.current.error(tRef.current('something_wrong'));
      }
    } catch (err) {
      logError('MyApplicationsPage.handleDeclineInterview', err);
      toastRef.current.error(tRef.current('something_wrong'));
    }
  }, [loadApplications]);

  // Feature 3: Offer accept/reject handlers
  const handleAcceptOffer = useCallback(async (offerId: number) => {
    try {
      const response = await api.put(`/v2/jobs/offers/${offerId}/accept`, {});
      if (response.success) {
        toastRef.current.success(tRef.current('offer.accepted'));
        cursorRef.current = null;
        setHasMore(false);
        setApplications([]);
        loadApplications();
      } else {
        toastRef.current.error(tRef.current('something_wrong'));
      }
    } catch (err) {
      logError('MyApplicationsPage.handleAcceptOffer', err);
      toastRef.current.error(tRef.current('something_wrong'));
    }
  }, [loadApplications]);

  const handleRejectOffer = useCallback(async (offerId: number) => {
    try {
      const response = await api.put(`/v2/jobs/offers/${offerId}/reject`, {});
      if (response.success) {
        toastRef.current.success(tRef.current('offer.rejected'));
        cursorRef.current = null;
        setHasMore(false);
        setApplications([]);
        loadApplications();
      } else {
        toastRef.current.error(tRef.current('something_wrong'));
      }
    } catch (err) {
      logError('MyApplicationsPage.handleRejectOffer', err);
      toastRef.current.error(tRef.current('something_wrong'));
    }
  }, [loadApplications]);

  // Open the confirm modal for a destructive interview/offer response
  const requestDeclineInterview = useCallback((interviewId: number) => {
    setPendingResponse({ kind: 'decline-interview', id: interviewId });
  }, []);
  const requestRejectOffer = useCallback((offerId: number) => {
    setPendingResponse({ kind: 'reject-offer', id: offerId });
  }, []);

  // Run the confirmed destructive response, then close the modal
  const confirmPendingResponse = useCallback(async () => {
    if (!pendingResponse) return;
    setIsResponding(true);
    try {
      if (pendingResponse.kind === 'decline-interview') {
        await handleDeclineInterview(pendingResponse.id);
      } else {
        await handleRejectOffer(pendingResponse.id);
      }
    } finally {
      setIsResponding(false);
      setPendingResponse(null);
    }
  }, [pendingResponse, handleDeclineInterview, handleRejectOffer]);

  const handleWithdrawClick = (app: JobApplication) => {
    setWithdrawTarget(app);
    openWithdraw();
  };

  const handleGdprExport = async () => {
    setIsExportingGdpr(true);
    try {
      const res = await api.get('/v2/jobs/gdpr-export');
      if (res.success && res.data) {
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'my-job-data.json';
        a.click();
        URL.revokeObjectURL(url);
        toastRef.current.success(tRef.current('gdpr.export_success'));
      } else {
        // api.get resolves { success:false } on a 4xx/5xx WITHOUT throwing, so the
        // catch never fired — without this branch a failed export did nothing at all
        // (no download, no message), leaving the user unsure whether their GDPR data
        // request worked.
        toastRef.current.error((res as { error?: string }).error ?? tRef.current('something_wrong'));
      }
    } catch (err) {
      logError('GDPR export failed', err);
      toastRef.current.error(tRef.current('something_wrong'));
    } finally {
      setIsExportingGdpr(false);
    }
  };

  const confirmWithdraw = useCallback(async () => {
    if (!withdrawTarget) return;
    setIsWithdrawing(true);
    try {
      const res = await api.put(`/v2/jobs/applications/${withdrawTarget.id}`, { status: 'withdrawn' });
      if (res.success) {
        toastRef.current.success(tRef.current('withdraw.success'));
        closeWithdraw();
        // Refresh the list
        cursorRef.current = null;
        setHasMore(false);
        setApplications([]);
        loadApplications();
      } else {
        toastRef.current.error((res as { error?: string }).error ?? tRef.current('my_applications.withdraw_error'));
      }
    } catch (err) {
      logError('MyApplicationsPage.confirmWithdraw', err);
      toastRef.current.error(tRef.current('something_wrong'));
    } finally {
      setIsWithdrawing(false);
    }
  }, [withdrawTarget, closeWithdraw, loadApplications]);

  return (
    <div className='max-w-3xl mx-auto px-4 py-8'>
      <PageMeta
        title={t('page_meta.my_applications.title')}
        description={t('page_meta.my_applications.description')}
        noIndex
      />
      {/* Page header */}
      <div className='mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold text-theme-primary flex items-center gap-2'>
            <Briefcase size={24} aria-hidden="true" />
            {t('my_applications.title')}
          </h1>
          <p className='text-sm text-theme-muted mt-1'>
            {t('my_applications.subtitle')}
          </p>
        </div>
        <Button
          size='sm'
          variant='tertiary'
          className='bg-theme-elevated text-theme-muted self-start'
          startContent={<Download size={14} aria-hidden="true" />}
          isLoading={isExportingGdpr}
          onPress={handleGdprExport}
        >
          {t('gdpr.export_my_data')}
        </Button>
      </div>

      {/* Filter tabs */}
      <div className='mb-6'>
        <Tabs
          selectedKey={activeTab}
          onSelectionChange={(key) => setActiveTab(key as FilterTab)}
          variant='underlined'
          aria-label={t('my_applications.filter_aria')}
          classNames={{ tab: 'text-theme-muted data-[selected=true]:text-theme-primary' }}>
          <Tab key='all' title={t('my_applications.tab_all')} />
          <Tab key='active' title={t('my_applications.tab_active')} />
          <Tab key='accepted' title={t('my_applications.tab_accepted')} />
          <Tab key='rejected' title={t('my_applications.tab_rejected')} />
        </Tabs>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className='space-y-4' role="status" aria-label={t('loading')} aria-busy="true">
          <ApplicationSkeleton />
          <ApplicationSkeleton />
          <ApplicationSkeleton />
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <GlassCard className='p-8 text-center'>
          <p className='text-danger mb-4' role="alert">{error}</p>
          <Button variant='secondary' onPress={() => loadApplications()}>
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Empty state */}
      {!isLoading && !error && applications.length === 0 && (
        <EmptyState
          icon={<Briefcase className='w-12 h-12' aria-hidden="true" />}
          title={t('my_applications.empty_title')}
          description={
            activeTab === 'all'
              ? t('my_applications.empty_all')
              : t('my_applications.empty_filtered', { filter: t(`my_applications.tab_${activeTab}`) })
          }
          action={
            <Button as={Link} to={tenantPath('/jobs')} variant='primary'>
              {t('my_applications.browse_jobs')}
            </Button>
          }
        />
      )}

      {/* Applications list */}
      {!isLoading && !error && applications.length > 0 && (
        <>
          <motion.div
            variants={containerVariants}
            initial='hidden'
            animate='visible'
            className='space-y-4'>
            {applications.map((app) => (
              <ApplicationCard
                key={app.id}
                application={app}
                onMessageEmployer={(creatorId, vacancyId) =>
                  navigate(tenantPath(`/messages?user=${creatorId}&context=job&context_id=${vacancyId}`))
                }
                onWithdraw={handleWithdrawClick}
                tenantPath={tenantPath}
                onAcceptInterview={handleAcceptInterview}
                onDeclineInterview={requestDeclineInterview}
                onAcceptOffer={handleAcceptOffer}
                onRejectOffer={requestRejectOffer}
              />
            ))}
          </motion.div>

          {/* Load more */}
          {hasMore && (
            <div className='mt-6 flex justify-center'>
              <Button
                variant='secondary'
                isLoading={isLoadingMore}
                onPress={() => loadApplications(true)}>
                {t('load_more')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Withdraw confirmation modal */}
      <Modal isOpen={isWithdrawOpen} onClose={closeWithdraw} size='sm'>
        <ModalContent>
          <ModalHeader>{t('withdraw.confirm_title')}</ModalHeader>
          <ModalBody>
            <p className='text-sm text-theme-secondary'>
              {t('withdraw.confirm_message', {
                title: withdrawTarget?.vacancy.title ?? '',
              })}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='tertiary' onPress={closeWithdraw} isDisabled={isWithdrawing}>
              {t('withdraw.cancel')}
            </Button>
            <Button color='danger' onPress={confirmWithdraw} isLoading={isWithdrawing}>
              {t('withdraw.button')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Decline interview / reject offer confirmation modal */}
      <Modal
        isOpen={pendingResponse !== null}
        onClose={() => { if (!isResponding) setPendingResponse(null); }}
        size='sm'
      >
        <ModalContent>
          <ModalHeader>
            {pendingResponse?.kind === 'reject-offer'
              ? t('inline_response.offer_decline')
              : t('inline_response.interview_decline')}
          </ModalHeader>
          <ModalFooter>
            <Button
              variant='tertiary'
              onPress={() => setPendingResponse(null)}
              isDisabled={isResponding}
            >
              {t('common:cancel')}
            </Button>
            <Button color='danger' onPress={confirmPendingResponse} isLoading={isResponding}>
              {pendingResponse?.kind === 'reject-offer'
                ? t('offer.reject')
                : t('interview.decline')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default MyApplicationsPage;
