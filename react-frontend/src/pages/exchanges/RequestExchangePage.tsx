// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
/**
 * Request Exchange Page - Create a new exchange request for a listing
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import Clock from 'lucide-react/icons/clock';
import User from 'lucide-react/icons/user';
import Tag from 'lucide-react/icons/tag';
import Send from 'lucide-react/icons/send';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs } from '@/components/navigation';
import { LoadingScreen, EmptyState } from '@/components/feedback';
import { useAuth, useToast, useTenant } from '@/contexts';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl } from '@/lib/helpers';
import { MAX_EXCHANGE_HOURS } from '@/lib/exchange-status';
import type { Listing, ExchangeConfig } from '@/types/api';

export function RequestExchangePage() {
  const { t } = useTranslation('exchanges');
  usePageTitle(t('request.page_title'));
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [listing, setListing] = useState<Listing | null>(null);
  const [config, setConfig] = useState<ExchangeConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Synchronous re-entry guard for the submit handler. A useState flag alone is
  // not enough: React batches the setIsSubmitting(true) update, so two submits in
  // the same tick (a rapid double-click, or Enter pressed twice during a slow
  // request) both observe the old `false` and each fire a POST /v2/exchanges,
  // creating duplicate pending requests. The native <form> also submits on Enter,
  // which bypasses the Button's pointer-events-only pending state. A ref updates
  // synchronously, so a second submit is rejected before it can re-enter.
  const isSubmittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const [proposedHours, setProposedHours] = useState('');
  const [prepTime, setPrepTime] = useState('');
  const [message, setMessage] = useState('');

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadData = useCallback(async () => {
    if (!id) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      // Load listing and config in parallel
      const [listingResponse, configResponse] = await Promise.all([
        api.get<Listing>(`/v2/listings/${id}`),
        api.get<ExchangeConfig>('/v2/exchanges/config'),
      ]);

      if (controller.signal.aborted) return;

      if (listingResponse.success && listingResponse.data) {
        setListing(listingResponse.data);
        // Pre-fill hours with listing estimate
        const estimatedHours = listingResponse.data?.hours_estimate || listingResponse.data?.estimated_hours;
        if (estimatedHours) {
          setProposedHours(estimatedHours.toString());
        }
      } else {
        setError(tRef.current('request.listing_not_found'));
      }

      if (configResponse.success && configResponse.data) {
        setConfig(configResponse.data);
        if (!configResponse.data?.exchange_workflow_enabled) {
          setError(tRef.current('request.workflow_not_enabled'));
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(tRef.current('request.load_failed'));
      logError('Failed to load listing', err);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Ignore a second submit while the first request is still in flight.
    if (isSubmittingRef.current) return;

    if (!listing) return;

    const hours = parseFloat(proposedHours);
    if (isNaN(hours) || hours <= 0) {
      toastRef.current.error(tRef.current('toast.invalid_hours'));
      return;
    }

    if (hours > MAX_EXCHANGE_HOURS) {
      toastRef.current.error(tRef.current('toast.max_hours', { max: MAX_EXCHANGE_HOURS }));
      return;
    }

    try {
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      const prepTimeVal = parseFloat(prepTime);
      const response = await api.post<{ id: number }>('/v2/exchanges', {
        listing_id: listing.id,
        proposed_hours: hours,
        prep_time: !isNaN(prepTimeVal) && prepTimeVal > 0 ? prepTimeVal : undefined,
        message: message.trim() || undefined,
      });

      if (response.success && response.data) {
        toastRef.current.success(tRef.current('toast.request_sent'));
        navigate(tenantPath(`/exchanges/${response.data.id}`));
      } else {
        // A 4xx (already-requested, validation, rate-limited, forbidden) resolves
        // to { success: false } WITHOUT throwing, and — being < 500 — does not fire
        // the global error toast. Without this branch the failure is silent: the
        // spinner stops and nothing happens. Surface the server's (localised)
        // message, falling back to the generic copy.
        toastRef.current.error(response.error || tRef.current('toast.request_failed'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.request_failed'));
      logError('Failed to create exchange request', err);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <LoadingScreen message={t('request.loading')} />;
  }

  if (error || !listing || !config?.exchange_workflow_enabled) {
    return (
      <EmptyState
        icon={<ArrowRightLeft className="w-12 h-12" />}
        title={error || t('request.cannot_request')}
        description={t('request.not_available')}
        action={
          <Button as={Link} to={tenantPath("/listings")} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
            {t('browse_listings')}
          </Button>
        }
      />
    );
  }

  // Can't request your own listing
  if (listing.user_id === user?.id) {
    return (
      <EmptyState
        icon={<ArrowRightLeft className="w-12 h-12" />}
        title={t('request.own_listing_title')}
        description={t('request.own_listing_description')}
        action={
          <Button as={Link} to={tenantPath(`/listings/${listing.id}`)} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
            {t('request.view_listing')}
          </Button>
        }
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-5xl space-y-6"
    >
      <PageMeta title={t('page_meta.request.title')} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('request.breadcrumb_listings'), href: '/listings' },
        { label: listing?.title || t('request.breadcrumb_listing'), href: id ? `/listings/${id}` : '/listings' },
        { label: t('request.breadcrumb_request') },
      ]} />

      {/* Header */}
      <header className="overflow-hidden rounded-2xl border border-theme-default bg-theme-surface">
        <div className="flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15">
              <ArrowRightLeft className="h-7 w-7 text-emerald-500" aria-hidden="true" />
            </div>
            <h1 className="text-3xl font-bold leading-tight text-theme-primary sm:text-4xl">
              {t('request.title')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-theme-muted sm:text-base">
              {t('request.subtitle')}
            </p>
          </div>
          <div className="rounded-xl border border-theme-default bg-theme-elevated px-4 py-3 lg:min-w-72">
            <span className="block text-xs font-medium uppercase tracking-wide text-theme-subtle">{t('request.summary_estimate')}</span>
            <span className="mt-1 block font-semibold text-theme-primary">
              {t('request.estimated_hours', { hours: listing.hours_estimate || listing.estimated_hours || '?' })}
            </span>
          </div>
        </div>
      </header>

      {/* Listing Summary */}
      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar
            src={resolveAvatarUrl(listing.user?.avatar)}
            name={listing.user?.name || t('unknown')}
            size="lg"
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold leading-tight text-theme-primary">
              {listing.title}
            </h2>
            <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-theme-muted">
              <span className="flex items-center gap-1">
                <User className="w-4 h-4" aria-hidden="true" />
                {listing.user?.name || t('unknown')}
              </span>
              {listing.category_name && (
                <span className="flex items-center gap-1">
                  <Tag className="w-4 h-4" aria-hidden="true" />
                  {listing.category_name}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" aria-hidden="true" />
                {t('request.estimated_hours', { hours: listing.hours_estimate || listing.estimated_hours || '?' })}
              </span>
            </div>
            <Chip
              size="sm"
              variant="flat"
              color={listing.type === 'offer' ? 'success' : 'warning'}
              className="mt-3"
            >
              {listing.type === 'offer' ? t('request.service_offer') : t('request.service_request')}
            </Chip>
          </div>
        </div>
      </GlassCard>

      {/* Request Form */}
      <GlassCard className="p-5 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-8">
          <div>
            <h2 className="text-xl font-semibold text-theme-primary">{t('request.form_heading')}</h2>
            <p className="mt-1 text-sm leading-6 text-theme-muted">{t('request.form_description')}</p>
          </div>
          <div>
            <Input
              type="number"
              label={t('request.proposed_hours_label')}
              placeholder={t('request.proposed_hours_placeholder')}
              value={proposedHours}
              onChange={(e) => setProposedHours(e.target.value)}
              min="0.5"
              max={MAX_EXCHANGE_HOURS}
              step="0.5"
              isRequired
              endContent={<span className="text-theme-muted">{t('request.hours_unit')}</span>}
              description={t('request.proposed_hours_description', { max: MAX_EXCHANGE_HOURS })}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
          </div>

          <div>
            <Input
              type="number"
              label={t('request.prep_time_label')}
              placeholder={t('request.prep_time_placeholder')}
              value={prepTime}
              onChange={(e) => setPrepTime(e.target.value)}
              min="0"
              max="10"
              step="0.25"
              endContent={<span className="text-theme-muted">{t('request.hours_unit')}</span>}
              description={t('request.prep_time_description')}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
          </div>

          <div>
            <Textarea
              label={t('request.message_label')}
              placeholder={t('request.message_placeholder')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              minRows={3}
              maxRows={6}
              description={t('request.message_description')}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
          </div>

          {config?.require_broker_approval && (
            <div className="bg-amber-500/10 rounded-lg p-4 text-sm">
              <p className="text-theme-warning font-medium">{t('request.broker_approval_title')}</p>
              <p className="text-theme-muted mt-1">
                {t('request.broker_approval_description')}
              </p>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 pt-4 sm:flex-row">
            <Button
              type="button"
              variant="flat"
              className="flex-1 bg-theme-elevated text-theme-primary"
              onPress={() => navigate(tenantPath(id ? `/listings/${id}` : '/listings'))}
            >
              {t('request.cancel')}
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
              startContent={<Send className="w-4 h-4" aria-hidden="true" />}
              isLoading={isSubmitting}
              isDisabled={isSubmitting}
            >
              {t('request.send_request')}
            </Button>
          </div>
        </form>
      </GlassCard>
    </motion.div>
  );
}

export default RequestExchangePage;
