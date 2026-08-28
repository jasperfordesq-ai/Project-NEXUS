// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Progress } from '@/components/ui/Progress';
import { Slider } from '@/components/ui/Slider';
import { Textarea } from '@/components/ui/Textarea';
/**
 * Employer Brand Page - View an employer's open jobs, branding, and culture.
 * Route: /jobs/employers/:userId
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from '@/lib/motion';
import Briefcase from 'lucide-react/icons/briefcase';
import MapPin from 'lucide-react/icons/map-pin';
import Wifi from 'lucide-react/icons/wifi';
import Building2 from 'lucide-react/icons/building-2';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Star from 'lucide-react/icons/star';
import MessageSquare from 'lucide-react/icons/message-square';
import { useTranslation } from 'react-i18next';
import { LoadingScreen } from '@/components/feedback';
import { Breadcrumbs } from '@/components/navigation';
import { useTenant, useAuth } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

interface EmployerProfile {
  id: number;
  name: string;
  avatar_url: string | null;
  tagline: string | null;
  company_size: string | null;
  open_jobs_count: number;
}

interface EmployerJob {
  id: number;
  title: string;
  type: string;
  commitment: string;
  location: string | null;
  is_remote: boolean;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_negotiable: boolean;
  deadline: string | null;
  benefits: string[] | null;
  created_at: string;
}

interface ReviewerInfo {
  id: number;
  name: string;
  avatar_url: string | null;
}

interface EmployerReview {
  id: number;
  rating: number;
  comment: string;
  dimensions: { respect: number; communication: number; flexibility: number; impact: number } | null;
  reviewer: ReviewerInfo | null;
  created_at: string;
}

interface ReviewStats {
  average_rating: number | null;
  total_reviews: number;
  distribution: Record<number, number>;
}

/** Render 1-5 stars with filled/unfilled state */
function StarRating({ rating, size = 16, interactive, onChange, getStarLabel }: {
  rating: number;
  size?: number;
  interactive?: boolean;
  onChange?: (r: number) => void;
  getStarLabel?: (rating: number) => string;
}) {
  return (
    <span className="inline-flex gap-0.5" role={interactive ? 'radiogroup' : undefined}>
      {[1, 2, 3, 4, 5].map((v) => {
        const star = (
          <Star
            size={size}
            className={`${v <= rating ? 'text-warning fill-warning' : 'text-muted/60'} ${interactive ? 'hover:scale-110 transition-transform' : ''}`}
            aria-hidden="true"
          />
        );
        // Interactive stars must be real focusable controls so keyboard and
        // screen-reader users can set a rating (WCAG 2.1.1) — not click-only SVGs.
        return interactive && onChange ? (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={v === rating}
            aria-label={getStarLabel ? getStarLabel(v) : undefined}
            onClick={() => onChange(v)}
            className="p-0.5 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
          >
            {star}
          </button>
        ) : (
          <span key={v}>{star}</span>
        );
      })}
    </span>
  );
}

function formatSalaryRange(
  min: number | null,
  max: number | null,
  currency: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const currencyCode = currency && /^[A-Z]{3}$/.test(currency) ? currency : t('salary.currency_eur');
  const formatter = new Intl.NumberFormat(getFormattingLocale(), {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 0,
  });

  if (min && max) {
    return t('salary_display', { min: formatter.format(min), max: formatter.format(max) });
  }

  if (min) {
    return t('salary.min_only', { min: formatter.format(min) });
  }

  if (max) {
    return t('salary.max_only', { max: formatter.format(max) });
  }

  return '';
}

export function EmployerBrandPage() {
  const { t } = useTranslation('jobs');
  const { userId } = useParams<{ userId: string }>();
  const { tenantPath } = useTenant();
  const { user, isAuthenticated } = useAuth();
  const abortRef = useRef<AbortController | null>(null);
  // Separate abort guard for reviews so fast employer→employer navigation can't
  // render a previous employer's reviews over the new one.
  const reviewsAbortRef = useRef<AbortController | null>(null);

  const [employer, setEmployer] = useState<EmployerProfile | null>(null);
  const [jobs, setJobs] = useState<EmployerJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reviewDateFormatter = useMemo(() => new Intl.DateTimeFormat(getFormattingLocale()), []);

  // Reviews state
  const [reviews, setReviews] = useState<EmployerReview[]>([]);
  const [reviewStats, setReviewStats] = useState<ReviewStats | null>(null);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [dimRespect, setDimRespect] = useState(3);
  const [dimCommunication, setDimCommunication] = useState(3);
  const [dimFlexibility, setDimFlexibility] = useState(3);
  const [dimImpact, setDimImpact] = useState(3);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [hasReviewed, setHasReviewed] = useState(false);

  usePageTitle(employer?.name ?? t('employer.page_title'));

  const loadReviews = useCallback(async () => {
    if (!userId) return;
    reviewsAbortRef.current?.abort();
    const controller = new AbortController();
    reviewsAbortRef.current = controller;
    try {
      const res = await api.get<{ reviews: EmployerReview[]; stats: ReviewStats }>(`/v2/jobs/employer-reviews/${userId}`);
      if (controller.signal.aborted) return;
      if (res.success && res.data) {
        const payload = 'data' in (res.data as Record<string, unknown>) && !Array.isArray(res.data)
          ? (res.data as unknown as { data: { reviews: EmployerReview[]; stats: ReviewStats } }).data
          : res.data;
        setReviews(payload.reviews ?? []);
        setReviewStats(payload.stats ?? null);
        // Check if current user already reviewed
        if (user?.id && payload.reviews?.some((r: EmployerReview) => r.reviewer?.id === user.id)) {
          setHasReviewed(true);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('EmployerBrandPage: reviews load failed', err);
    }
  }, [userId, user?.id]);

  const submitReview = useCallback(async () => {
    if (!userId || reviewRating < 1) return;
    setSubmittingReview(true);
    setReviewError(null);
    try {
      const res = await api.post('/v2/jobs/employer-reviews', {
        employer_id: parseInt(userId),
        rating: reviewRating,
        comment: reviewComment,
        respect: dimRespect,
        communication: dimCommunication,
        flexibility: dimFlexibility,
        impact: dimImpact,
      });
      if (res.success) {
        setShowReviewForm(false);
        setHasReviewed(true);
        setReviewRating(0);
        setReviewComment('');
        loadReviews();
      } else {
        setReviewError((res as { error?: string }).error ?? t('employer.review_submit_failed'));
      }
    } catch (err) {
      logError('EmployerBrandPage: review submit failed', err);
      setReviewError(t('employer.review_submit_failed'));
    } finally {
      setSubmittingReview(false);
    }
  }, [userId, reviewRating, reviewComment, dimRespect, dimCommunication, dimFlexibility, dimImpact, loadReviews, t])

  const loadData = useCallback(async () => {
    if (!userId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      const jobsRes = await api.get<{ data: EmployerJob[] }>(`/v2/jobs?user_id=${userId}&status=open&per_page=50`);

      if (controller.signal.aborted) return;

      const jobList = jobsRes.success && jobsRes.data
        ? (Array.isArray(jobsRes.data) ? jobsRes.data as EmployerJob[] : ((jobsRes.data as { data: EmployerJob[] }).data ?? []))
        : [];

      setJobs(jobList);

      if (jobList.length > 0) {
        setEmployer({
          id: parseInt(userId),
          name: t('employer.employer_jobs'),
          avatar_url: null,
          tagline: null,
          company_size: null,
          open_jobs_count: jobList.length,
        });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('EmployerBrandPage: load failed', err);
      setError(t('employer.error'));
    } finally {
      setIsLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    loadData();
    loadReviews();
    return () => {
      abortRef.current?.abort();
      reviewsAbortRef.current?.abort();
    };
  }, [loadData, loadReviews]);

  if (isLoading) return <LoadingScreen />;
  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <GlassCard className="p-8 text-center">
          <p className="text-theme-muted">{error}</p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <PageMeta
        title={employer?.name ?? t('page_meta.employer_brand.title')}
        description={t('employer.meta_description', { count: jobs.length })}
        image={employer?.avatar_url ?? undefined}
        type="profile"
      />
      <Breadcrumbs items={[
        { label: t('nav.jobs'), href: '/jobs' },
        { label: employer?.name ?? t('employer.page_title') },
      ]} />

      {/* Employer header */}
      <GlassCard className="p-6">
        <div className="flex items-start gap-4">
          <Avatar
            src={employer?.avatar_url ?? undefined}
            name={employer?.name}
            size="lg"
            className="shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-theme-primary">{employer?.name}</h1>
            {employer?.tagline && (
              <p className="text-sm text-theme-secondary italic mt-1">&ldquo;{employer.tagline}&rdquo;</p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              {employer?.company_size && (
                <Chip size="sm" variant="tertiary">
                  <Building2 size={12} />
                  <Chip.Label>{t('employer.employees', { size: employer.company_size })}</Chip.Label>
                </Chip>
              )}
              <Chip size="sm" variant="tertiary" color="accent">
                <Briefcase size={12} />
                <Chip.Label>{t('employer.open_roles_count', { count: jobs.length })}</Chip.Label>
              </Chip>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Job listings */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-theme-primary px-1">
          {t('employer.open_roles_heading')}
        </h2>
        {jobs.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <Briefcase size={32} className="mx-auto text-theme-muted mb-2" />
            <p className="text-theme-muted">{t('employer.no_roles')}</p>
          </GlassCard>
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.05 } } }}
            className="space-y-3"
          >
            {jobs.map((job) => (
              <motion.div
                key={job.id}
                variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }}
              >
                <GlassCard className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1 min-w-0">
                      <Link
                        to={tenantPath(`/jobs/${job.id}`)}
                        className="font-semibold text-theme-primary hover:text-accent transition-colors line-clamp-2"
                      >
                        {job.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-theme-muted">
                        {job.is_remote ? (
                          <span className="flex items-center gap-1">
                            <Wifi size={11} aria-hidden="true" />
                            {t('remote')}
                          </span>
                        ) : job.location ? (
                          <span className="flex items-center gap-1">
                            <MapPin size={11} aria-hidden="true" />
                            {job.location}
                          </span>
                        ) : null}
                        <Chip size="sm" variant="tertiary">
                          {t(`commitment.${job.commitment}`)}
                        </Chip>
                        <Chip
                          size="sm"
                          variant="tertiary"
                          color={job.type === 'paid' ? 'accent' : job.type === 'volunteer' ? 'success' : 'default'}
                        >
                          {t(`type.${job.type}`)}
                        </Chip>
                        {(job.salary_min || job.salary_max) && (
                          <span>
                            {formatSalaryRange(job.salary_min, job.salary_max, job.salary_currency, t)}
                          </span>
                        )}
                        {job.salary_negotiable && !job.salary_min && (
                          <span>{t('salary.negotiable')}</span>
                        )}
                      </div>
                      {job.benefits && job.benefits.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {job.benefits.slice(0, 4).map((b) => (
                            <Chip key={b} size="sm" variant="soft" color="success">
                              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                              <Chip.Label>{b}</Chip.Label>
                            </Chip>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      as={Link}
                      to={tenantPath(`/jobs/${job.id}`)}
                      size="sm"
                      variant="flat"
                      color="primary"
                      className="w-full sm:w-auto"
                      endContent={<ChevronRight size={14} />}
                    >
                      {t('apply.view')}
                    </Button>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Employer Reviews Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-base font-semibold text-theme-primary">
            {t('employer.reviews_heading')}
          </h2>
          {isAuthenticated && !hasReviewed && !showReviewForm && (
            <Button
              size="sm"
              color="primary"
              variant="flat"
              startContent={<MessageSquare size={14} />}
              onPress={() => setShowReviewForm(true)}
            >
              {t('employer.leave_review')}
            </Button>
          )}
        </div>

        {/* Stats card */}
        {reviewStats && reviewStats.total_reviews > 0 && (
          <GlassCard className="p-5">
            <div className="flex flex-col sm:flex-row gap-6">
              {/* Average rating */}
              <div className="flex flex-col items-center gap-1 min-w-[100px]">
                <span className="text-3xl font-bold text-theme-primary">
                  {reviewStats.average_rating ?? '—'}
                </span>
                <StarRating rating={Math.round(reviewStats.average_rating ?? 0)} size={18} />
                <span className="text-xs text-theme-muted">
                  {t('employer.reviews_count', { count: reviewStats.total_reviews })}
                </span>
              </div>
              {/* Distribution */}
              <div className="flex-1 space-y-1.5">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = reviewStats.distribution[star] ?? 0;
                  const pct = reviewStats.total_reviews > 0 ? (count / reviewStats.total_reviews) * 100 : 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-xs">
                      <span className="w-3 text-right text-theme-secondary">{star}</span>
                      <Star size={11} className="text-warning fill-warning shrink-0" />
                      <Progress
                        size="sm"
                        value={pct}
                        color="warning"
                        className="flex-1"
                        aria-label={t('employer.star_distribution', { count, star })}
                      />
                      <span className="w-6 text-right text-theme-muted">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </GlassCard>
        )}

        {/* Review form */}
        {showReviewForm && (
          <GlassCard className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-theme-primary">
              {t('employer.write_review')}
            </h3>

            {reviewError && (
              <div className="text-sm text-danger bg-danger-50 rounded-lg p-3">{reviewError}</div>
            )}

            {/* Overall rating */}
            <div>
              <label className="text-xs font-medium text-theme-secondary mb-1 block">
                {t('employer.overall_rating')}
              </label>
              <StarRating
                rating={reviewRating}
                size={24}
                interactive
                onChange={setReviewRating}
                getStarLabel={(value) => t('employer.star_option', { count: value })}
              />
            </div>

            {/* Dimension sliders */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Slider
                label={t('employer.dim_respect')}
                step={1}
                minValue={1}
                maxValue={5}
                value={dimRespect}
                onChange={(v) => setDimRespect(v as number)}
                size="sm"
                color="primary"
                showSteps
                marks={[{ value: 1, label: '1' }, { value: 3, label: '3' }, { value: 5, label: '5' }]}
              />
              <Slider
                label={t('employer.dim_communication')}
                step={1}
                minValue={1}
                maxValue={5}
                value={dimCommunication}
                onChange={(v) => setDimCommunication(v as number)}
                size="sm"
                color="primary"
                showSteps
                marks={[{ value: 1, label: '1' }, { value: 3, label: '3' }, { value: 5, label: '5' }]}
              />
              <Slider
                label={t('employer.dim_flexibility')}
                step={1}
                minValue={1}
                maxValue={5}
                value={dimFlexibility}
                onChange={(v) => setDimFlexibility(v as number)}
                size="sm"
                color="primary"
                showSteps
                marks={[{ value: 1, label: '1' }, { value: 3, label: '3' }, { value: 5, label: '5' }]}
              />
              <Slider
                label={t('employer.dim_impact')}
                step={1}
                minValue={1}
                maxValue={5}
                value={dimImpact}
                onChange={(v) => setDimImpact(v as number)}
                size="sm"
                color="primary"
                showSteps
                marks={[{ value: 1, label: '1' }, { value: 3, label: '3' }, { value: 5, label: '5' }]}
              />
            </div>

            {/* Comment */}
            <Textarea
              label={t('employer.review_comment')}
              placeholder={t('employer.review_comment_placeholder')}
              value={reviewComment}
              onValueChange={setReviewComment}
              variant="bordered"
              minRows={3}
              maxRows={6}
            />

            {/* Actions */}
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="flat"
                onPress={() => { setShowReviewForm(false); setReviewError(null); }}
              >
                {t('cancel')}
              </Button>
              <Button
                size="sm"
                color="primary"
                isDisabled={reviewRating < 1}
                isLoading={submittingReview}
                onPress={submitReview}
              >
                {t('employer.submit_review')}
              </Button>
            </div>
          </GlassCard>
        )}

        {/* Review cards */}
        {reviews.length === 0 && !showReviewForm ? (
          <GlassCard className="p-8 text-center">
            <Star size={32} className="mx-auto text-theme-muted mb-2" />
            <p className="text-theme-muted">{t('employer.no_reviews')}</p>
          </GlassCard>
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.05 } } }}
            className="space-y-3"
          >
            {reviews.map((review) => (
              <motion.div
                key={review.id}
                variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }}
              >
                <GlassCard className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar
                      src={review.reviewer?.avatar_url ?? undefined}
                      name={review.reviewer?.name}
                      size="sm"
                      className="shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-theme-primary">
                          {review.reviewer?.name ?? t('employer.anonymous')}
                        </span>
                        <StarRating rating={review.rating} size={13} />
                        <span className="text-xs text-theme-muted">
                          {review.created_at ? reviewDateFormatter.format(new Date(review.created_at)) : ''}
                        </span>
                      </div>
                      {review.comment && (
                        <p className="text-sm text-theme-secondary mt-1">{review.comment}</p>
                      )}
                      {review.dimensions && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {Object.entries(review.dimensions).map(([key, val]) => (
                            <Chip key={key} size="sm" variant="tertiary">
                              {t(`employer.dim_${key}`, key)}: {val}/5
                            </Chip>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default EmployerBrandPage;
