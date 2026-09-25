// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Organisation Detail Page - View organisation profile, opportunities, and stats
 *
 * Uses V2 API:
 * - GET /api/v2/volunteering/organisations/{id}
 * - GET /api/v2/volunteering/opportunities?organization_id={id}
 * - GET /api/v2/volunteering/reviews/organization/{id}
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams, Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import MapPin from 'lucide-react/icons/map-pin';
import Globe from 'lucide-react/icons/globe';
import Mail from 'lucide-react/icons/mail';
import Clock from 'lucide-react/icons/clock';
import Star from 'lucide-react/icons/star';
import Users from 'lucide-react/icons/users';
import Heart from 'lucide-react/icons/heart';
import Calendar from 'lucide-react/icons/calendar';
import Briefcase from 'lucide-react/icons/briefcase';
import ChevronRight from 'lucide-react/icons/chevron-right';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ExternalLink from 'lucide-react/icons/external-link';
import Send from 'lucide-react/icons/send';
import Building2 from 'lucide-react/icons/building-2';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { EmptyState, LoadingScreen } from '@/components/feedback';
import { Breadcrumbs } from '@/components/navigation';
import { useAuth, useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { getOpportunityCategoryName, type OpportunityCategory } from '@/lib/volunteering';
import { extractCollectionItems } from '@/pages/volunteering/extractCollectionItems';

/* ───────────────────────── Types ───────────────────────── */

interface OrganisationDetail {
  id: number;
  name: string;
  description: string | null;
  logo_url: string | null;
  website: string | null;
  contact_email: string | null;
  opportunity_count: number;
  total_hours: number;
  volunteer_count: number;
  average_rating: number | null;
  review_count: number;
  created_at: string;
}

interface Opportunity {
  id: number;
  title: string;
  description: string;
  location: string;
  skills_needed: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  is_remote: boolean;
  /** String on some endpoints, { id, name, color } object on others — always unwrap via getOpportunityCategoryName(). */
  category: OpportunityCategory;
  organization: { id: number; name: string; logo_url: string | null };
  created_at: string;
  has_applied?: boolean;
}

interface Review {
  id: number;
  rating: number;
  comment: string;
  // Public payloads may omit the author's internal id (see contract a) — the
  // profile link is rendered only when an id is present.
  author: { id?: number | null; name: string; avatar: string | null };
  created_at: string;
}

/* ───────────────────────── Main Component ───────────────────────── */

export function OrganisationDetailPage() {
  const { t } = useTranslation(['community', 'volunteering']);
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated } = useAuth();
  const { tenantPath, volunteeringConfig } = useTenant();
  const toast = useToast();
  const reviewsEnabled = volunteeringConfig?.['volunteering.enable_reviews'] !== false;

  const [organisation, setOrganisation] = useState<OrganisationDetail | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

  // Apply modal
  const applyModal = useDisclosure();
  const [selectedOpp, setSelectedOpp] = useState<Opportunity | null>(null);
  const [applyMessage, setApplyMessage] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  // Review modal
  const reviewModal = useDisclosure();
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  usePageTitle(organisation?.name ?? t('organisation_detail.page_title'));

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  const loadData = useCallback(async () => {
    if (!id) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      // Load org details, opportunities, and enabled secondary data in parallel.
      const [orgRes, oppsRes, reviewsRes] = await Promise.all([
        api.get<OrganisationDetail>(`/v2/volunteering/organisations/${id}`),
        // api.get() already unwraps { data: [...], meta: {...} } → oppsRes.data = Opportunity[]
        api.get<Opportunity[]>(`/v2/volunteering/opportunities?organization_id=${id}&per_page=50`),
        reviewsEnabled
          ? api.get<{ reviews: Review[] }>(`/v2/volunteering/reviews/organization/${id}`)
          : Promise.resolve({ success: true, data: { reviews: [] } }),
      ]);

      if (controller.signal.aborted) return;

      if (orgRes.success && orgRes.data) {
        setOrganisation(orgRes.data as OrganisationDetail);
      } else {
        setError(tRef.current('organisation_detail.not_found'));
        return;
      }

      if (oppsRes.success && oppsRes.data) {
        setOpportunities(extractCollectionItems<Opportunity>(oppsRes.data));
      }

      if (reviewsEnabled && reviewsRes.success && reviewsRes.data) {
        const reviewsData = reviewsRes.data as { reviews?: Review[] };
        setReviews(reviewsData.reviews ?? []);
      } else if (!reviewsEnabled) {
        setReviews([]);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load organisation', err);
      setError(tRef.current('organisation_detail.error_load_retry'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [id, reviewsEnabled]);

  useEffect(() => {
    loadData();
    return () => { abortRef.current?.abort(); };
  }, [loadData]);

  // Detect whether the signed-in user owns/admins THIS org, to show a "Manage"
  // shortcut straight to the organisation dashboard.
  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    api.get<unknown>('/v2/volunteering/my-organisations')
      .then((res) => {
        if (cancelled || !res.success || !res.data) return;
        const items = extractCollectionItems<{ id: number; status: string; member_role: string }>(res.data);
        setCanManage(items.some((o) => o.id === Number(id) && ['approved', 'active'].includes(o.status) && ['owner', 'admin'].includes(o.member_role)));
      })
      .catch(() => { /* silent — manage shortcut just won't show */ });
    return () => { cancelled = true; };
  }, [isAuthenticated, id]);

  const handleApply = async () => {
    if (!selectedOpp) return;
    try {
      setIsApplying(true);
      const response = await api.post(`/v2/volunteering/opportunities/${selectedOpp.id}/apply`, {
        message: applyMessage || undefined,
      });
      if (response.success) {
        applyModal.onClose();
        setApplyMessage('');
        setSelectedOpp(null);
        toast.success(t('applied_success', { ns: 'volunteering' }));
        loadData();
      } else {
        toast.error(response.error || t('apply_error', { ns: 'volunteering' }));
      }
    } catch (err) {
      logError('Failed to apply', err);
      toast.error(t('apply_error', { ns: 'volunteering' }));
    } finally {
      setIsApplying(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!id || reviewRating < 1) {
      toast.error(t('organisation_detail.rating_required'));
      return;
    }

    try {
      setIsSubmittingReview(true);
      const response = await api.post('/v2/volunteering/reviews', {
        target_type: 'organization',
        target_id: Number(id),
        rating: reviewRating,
        comment: reviewComment.trim() || undefined,
      });

      if (response.success) {
        toast.success(t('organisation_detail.review_success'));
        setReviewRating(0);
        setReviewComment('');
        reviewModal.onClose();
        loadData();
      } else {
        toast.error(response.error || t('organisation_detail.review_error'));
      }
    } catch (err) {
      logError('Failed to submit organisation review', err);
      toast.error(t('organisation_detail.review_error'));
    } finally {
      setIsSubmittingReview(false);
    }
  };

  if (isLoading) {
    return (
      <>
        <PageMeta title={t('organisation_detail.loading')} noIndex />
        <LoadingScreen message={t('organisation_detail.loading')} />
      </>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageMeta title={t('organisation_detail.unable_to_load')} noIndex />
        <Breadcrumbs items={[
          { label: t('organisation_detail.breadcrumb_volunteering'), href: tenantPath('/volunteering') },
          { label: t('organisation_detail.breadcrumb_organisations'), href: tenantPath('/organisations') },
          { label: t('organisation_detail.breadcrumb_error') },
        ]} />
        <GlassCard className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('organisation_detail.unable_to_load')}</h2>
          <p className="text-theme-muted mb-4" role="alert">{error}</p>
          <div className="flex gap-3 justify-center">
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={() => loadData()}
            >
              {t('organisation_detail.try_again')}
            </Button>
            <Button as={Link} to={tenantPath("/organisations")} variant="secondary" className="bg-theme-elevated text-theme-muted">
              {t('organisation_detail.browse_organisations')}
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  if (!organisation) return <PageMeta title={t('organisation_detail.breadcrumb_organisations')} noIndex />;

  const activeOpps = opportunities.filter((o) => o.is_active);
  const organisationMetaDescription = (
    organisation.description ||
    t('organisation_detail.meta_description_fallback', {
      name: organisation.name,
      count: activeOpps.length,
    })
  ).replace(/\s+/g, ' ').trim().slice(0, 160);

  return (
    <div className="space-y-6">
      <PageMeta
        title={organisation.name}
        description={organisationMetaDescription}
        image={organisation.logo_url || undefined}
        type="profile"
      />
      <Helmet>
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: organisation?.name,
            ...(organisation?.description ? { description: organisation.description.substring(0, 300) } : {}),
            ...(organisation?.logo_url ? { logo: organisation.logo_url } : {}),
            ...(organisation?.website ? { url: organisation.website } : {}),
          }).replace(/</g, '\\u003c')}
        </script>
      </Helmet>
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('organisation_detail.breadcrumb_volunteering'), href: tenantPath('/volunteering') },
        { label: t('organisation_detail.breadcrumb_organisations'), href: tenantPath('/organisations') },
        { label: organisation.name },
      ]} />

      {/* Hero Section */}
      <GlassCard className="p-6 md:p-8">
        <div className="flex flex-col sm:flex-row items-start gap-6">
          <Avatar
            name={organisation.name}
            src={organisation.logo_url ?? undefined}
            className="w-20 h-20 flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-theme-primary">{organisation.name}</h1>

            {organisation.description && (
              <p className="text-theme-muted mt-3">{organisation.description}</p>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3 mt-4">
              {canManage && (
                <Button as={Link} to={tenantPath(`/volunteering/org/${organisation.id}/dashboard`)}
                  className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                  startContent={<Building2 className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('organisation_detail.manage_button')}
                </Button>
              )}
              {organisation.website && (
                <Button as="a" href={organisation.website} target="_blank" rel="noopener noreferrer"
                  variant="secondary"
                  className="bg-theme-elevated text-theme-muted"
                  startContent={<Globe className="w-4 h-4" aria-hidden="true" />}
                  endContent={<ExternalLink className="w-3 h-3" aria-hidden="true" />}
                >
                  {t('organisation_detail.website')}
                </Button>
              )}
              {organisation.contact_email && (
                <Button as="a" href={`mailto:${organisation.contact_email}`}
                  variant="secondary"
                  className="bg-theme-elevated text-theme-muted"
                  startContent={<Mail className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('organisation_detail.contact')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Stats Cards */}
      <div className={`grid grid-cols-2 ${reviewsEnabled ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4`}>
        <GlassCard className="p-4 text-center">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500/10 mx-auto mb-2">
            <Heart className="w-5 h-5 text-rose-400" aria-hidden="true" />
          </div>
          <dl>
            <dd className="text-xl font-bold text-theme-primary">{organisation.opportunity_count}</dd>
            <dt className="text-xs text-theme-muted">{t('organisation_detail.opportunities')}</dt>
          </dl>
        </GlassCard>

        <GlassCard className="p-4 text-center">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent/10 mx-auto mb-2">
            <Users className="w-5 h-5 text-accent" aria-hidden="true" />
          </div>
          <dl>
            <dd className="text-xl font-bold text-theme-primary">{organisation.volunteer_count}</dd>
            <dt className="text-xs text-theme-muted">{t('organisation_detail.volunteers')}</dt>
          </dl>
        </GlassCard>

        <GlassCard className="p-4 text-center">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 mx-auto mb-2">
            <Clock className="w-5 h-5 text-emerald-400" aria-hidden="true" />
          </div>
          <dl>
            <dd className="text-xl font-bold text-theme-primary">{organisation.total_hours}</dd>
            <dt className="text-xs text-theme-muted">{t('organisation_detail.hours_logged')}</dt>
          </dl>
        </GlassCard>

        {reviewsEnabled && (
        <GlassCard className="p-4 text-center">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10 mx-auto mb-2">
            <Star className="w-5 h-5 text-amber-400" aria-hidden="true" />
          </div>
          <dl>
            <dd className="text-xl font-bold text-theme-primary">
              {organisation.average_rating ? organisation.average_rating.toFixed(1) : '—'}
            </dd>
            <dt className="text-xs text-theme-muted">
              {organisation.review_count > 0 ? t('organisation_detail.review_count', { count: organisation.review_count }) : t('organisation_detail.no_reviews')}
            </dt>
          </dl>
        </GlassCard>
        )}
      </div>

      {/* Active Opportunities */}
      <div>
        <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-rose-400" aria-hidden="true" />
          {t('organisation_detail.active_opportunities')}
          {activeOpps.length > 0 && (
            <Chip size="sm" variant="soft" className="text-theme-subtle">{activeOpps.length}</Chip>
          )}
        </h2>

        {activeOpps.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="w-12 h-12" aria-hidden="true" />}
            title={t('organisation_detail.no_active_opportunities')}
            description={t('organisation_detail.no_opportunities_description')}
          />
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3"
          >
            {activeOpps.map((opp) => (
              <GlassCard key={opp.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-theme-primary">{opp.title}</h3>
                    {opp.description && (
                      <p className="text-sm text-theme-muted mt-1 line-clamp-2">{opp.description}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-theme-subtle">
                      {opp.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" aria-hidden="true" />
                          {opp.location}
                        </span>
                      )}
                      {opp.is_remote && (
                        <Chip size="sm" variant="soft" color="accent" startContent={<Globe className="w-3 h-3" aria-hidden="true" />}>
                          {t('organisation_detail.remote')}
                        </Chip>
                      )}
                      {opp.start_date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" aria-hidden="true" />
                          {new Date(opp.start_date).toLocaleDateString(getFormattingLocale())}
                          {opp.end_date ? `${t('date_range_separator', { ns: 'volunteering' })}${new Date(opp.end_date).toLocaleDateString(getFormattingLocale())}` : ''}
                        </span>
                      )}
                      {getOpportunityCategoryName(opp.category) && (
                        <Chip size="sm" variant="soft" className="text-theme-subtle">{getOpportunityCategoryName(opp.category)}</Chip>
                      )}
                    </div>

                    {opp.has_applied && (
                      <Chip size="sm" color="success" variant="soft" className="mt-2">
                        {t('organisation_detail.applied')}
                      </Chip>
                    )}
                  </div>

                  {isAuthenticated && !opp.has_applied && (
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-rose-500 to-pink-600 text-white flex-shrink-0"
                      endContent={<ChevronRight className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => {
                        setSelectedOpp(opp);
                        setApplyMessage('');
                        applyModal.onOpen();
                      }}
                    >
                      {t('organisation_detail.apply')}
                    </Button>
                  )}
                </div>
              </GlassCard>
            ))}
          </motion.div>
        )}
      </div>

      {reviewsEnabled && (
      <div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-400" aria-hidden="true" />
            {t('organisation_detail.reviews')}
            <Chip size="sm" variant="soft" className="text-theme-subtle">{reviews.length}</Chip>
          </h2>
          {isAuthenticated && (
            <Button
              size="sm"
              variant="secondary"
              className="bg-theme-elevated text-theme-primary"
              startContent={<Star className="w-4 h-4" aria-hidden="true" />}
              onPress={reviewModal.onOpen}
            >
              {t('organisation_detail.write_review')}
            </Button>
          )}
        </div>

        {reviews.length === 0 ? (
          <GlassCard className="p-5 text-sm text-theme-muted">
            {t('organisation_detail.no_reviews')}
          </GlassCard>
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
            <GlassCard key={review.id} className="p-4">
              <div className="flex items-start gap-3">
                {review.author.id != null ? (
                  <Link to={tenantPath(`/profile/${review.author.id}`)}>
                    <Avatar
                      name={review.author.name}
                      src={resolveAvatarUrl(review.author.avatar) || undefined}
                      size="sm"
                    />
                  </Link>
                ) : (
                  <Avatar
                    name={review.author.name}
                    src={resolveAvatarUrl(review.author.avatar) || undefined}
                    size="sm"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {review.author.id != null ? (
                      <Link
                        to={tenantPath(`/profile/${review.author.id}`)}
                        className="font-semibold text-sm text-theme-primary hover:underline"
                      >
                        {review.author.name}
                      </Link>
                    ) : (
                      <span className="font-semibold text-sm text-theme-primary">
                        {review.author.name}
                      </span>
                    )}
                    <div className="flex items-center gap-0.5">
                      <span className="sr-only">{t('organisation_detail.rating_sr', { n: review.rating })}</span>
                      {Array.from({ length: 5 }, (_, i) => (
                        <Star
                          key={i}
                          className={`w-3 h-3 ${i < review.rating ? 'text-amber-400 fill-amber-400' : 'text-theme-subtle'}`}
                          aria-hidden="true"
                        />
                      ))}
                    </div>
                    <span className="text-xs text-theme-subtle">
                      {new Date(review.created_at).toLocaleDateString(getFormattingLocale())}
                    </span>
                  </div>
                  {review.comment && (
                    <p className="text-sm text-theme-muted">{review.comment}</p>
                  )}
                </div>
              </div>
            </GlassCard>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Apply Modal */}
      <Modal isOpen={applyModal.isOpen} onClose={applyModal.onClose} size="lg" classNames={{
        base: 'bg-overlay border border-theme-default',
      }}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">
            {t('organisation_detail.apply_to_volunteer')}
          </ModalHeader>
          <ModalBody className="space-y-4">
            {selectedOpp && (
              <div>
                <h3 className="font-semibold text-theme-primary">{selectedOpp.title}</h3>
                <p className="text-sm text-theme-muted">{organisation.name}</p>
              </div>
            )}
            <Textarea
              label={t('organisation_detail.cover_message_label')}
              placeholder={t('organisation_detail.cover_message_placeholder')}
              value={applyMessage}
              onChange={(e) => setApplyMessage(e.target.value)}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={applyModal.onClose} className="text-theme-muted">{t('organisation_detail.cancel')}</Button>
            <Button
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              onPress={handleApply}
              isLoading={isApplying}
              startContent={<Send className="w-4 h-4" aria-hidden="true" />}
            >
              {t('organisation_detail.submit_application')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {reviewsEnabled && (
      <Modal isOpen={reviewModal.isOpen} onClose={reviewModal.onClose} size="md" classNames={{
        base: 'bg-overlay border border-theme-default',
      }}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('organisation_detail.review_modal_title')}</ModalHeader>
          <ModalBody className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-theme-muted">{t('organisation_detail.rating_label')}</p>
              <div className="flex gap-1" role="radiogroup" aria-label={t('organisation_detail.rating_label')}>
                {Array.from({ length: 5 }, (_, i) => {
                  const rating = i + 1;
                  return (
                    // as="button" renders a native element so role/aria-checked reach
                    // the DOM — React Aria's filterDOMProps strips them on the default path.
                    <Button
                      key={rating}
                      as="button"
                      isIconOnly
                      size="sm"
                      variant="tertiary"
                      role="radio"
                      aria-checked={reviewRating === rating}
                      aria-label={t('organisation_detail.rating_sr', { n: rating })}
                      onPress={() => setReviewRating(rating)}
                    >
                      <Star
                        className={`w-5 h-5 ${rating <= reviewRating ? 'text-amber-400 fill-amber-400' : 'text-theme-subtle'}`}
                        aria-hidden="true"
                      />
                    </Button>
                  );
                })}
              </div>
            </div>
            <Textarea
              label={t('organisation_detail.comment_label')}
              placeholder={t('organisation_detail.comment_placeholder')}
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              minRows={3}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={reviewModal.onClose} className="text-theme-muted">{t('organisation_detail.cancel')}</Button>
            <Button
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-white"
              isLoading={isSubmittingReview}
              onPress={handleSubmitReview}
            >
              {t('organisation_detail.submit_review')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      )}
    </div>
  );
}

export default OrganisationDetailPage;
