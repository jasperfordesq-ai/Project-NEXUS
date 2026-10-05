// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * DonationsTab — money gifts to the community (not time credits).
 *
 * Three things live here: the community's fundraising campaigns ("giving
 * days" in the database) split into live / coming up / past, a three-tile
 * summary, and the member's own gifts and pledges. Card payments go through
 * the Stripe checkout; bank transfer / PayPal / cash are recorded as a
 * pending pledge that an administrator confirms when the money arrives.
 *
 * Every amount is shown in the community's currency. The server refuses any
 * other currency for both pledges and card payments, so the UI never offers a
 * choice.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Banknote from 'lucide-react/icons/banknote';
import Building2 from 'lucide-react/icons/building-2';
import Calendar from 'lucide-react/icons/calendar';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import CreditCard from 'lucide-react/icons/credit-card';
import EyeOff from 'lucide-react/icons/eye-off';
import FileText from 'lucide-react/icons/file-text';
import HandHeart from 'lucide-react/icons/hand-heart';
import Heart from 'lucide-react/icons/heart';
import Hourglass from 'lucide-react/icons/hourglass';
import Info from 'lucide-react/icons/info';
import Megaphone from 'lucide-react/icons/megaphone';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Users from 'lucide-react/icons/users';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Progress } from '@/components/ui/Progress';
import { Radio, RadioGroup } from '@/components/ui/Radio';
import { Select, SelectItem } from '@/components/ui/Select';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { EmptyState } from '@/components/feedback';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { formatCurrency, formatDateValue, getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

const DonationCheckout = lazy(() =>
  import('@/components/donations/DonationCheckout').then((module) => ({ default: module.DonationCheckout })),
);

/* ───────────────────────── Types ───────────────────────── */

type CampaignStatus = 'active' | 'upcoming' | 'ended';

interface GivingDay {
  id: number;
  title: string;
  description: string | null;
  goal_amount: number;
  raised_amount: number;
  donor_count?: number;
  start_date: string;
  end_date: string;
  starts_at?: string;
  ends_at?: string;
  is_active?: boolean;
  status?: CampaignStatus;
  /** The organisation the campaign raises money for; null = the whole community. */
  organization_id?: number | null;
  organization_name?: string | null;
}

type DonationStatus = 'pending' | 'completed' | 'failed' | 'refunded';

interface Donation {
  id: number;
  amount: number | string;
  currency?: string | null;
  payment_method: string | null;
  payment_reference?: string | null;
  message: string | null;
  anonymous?: boolean;
  is_anonymous?: boolean | number;
  status: DonationStatus;
  giving_day_id?: number | null;
  giving_day_title?: string | null;
  organization_name?: string | null;
  created_at: string;
}

interface PledgeForm {
  giving_day_id: number | null;
  amount: string;
  payment_method: PledgeMethod;
  payment_reference: string;
  message: string;
  anonymous: boolean;
}

/* ───────────────────────── Constants ───────────────────────── */

/** Card payments never go through the pledge form — they have a real checkout. */
const PLEDGE_METHODS = ['bank_transfer', 'paypal', 'cash'] as const;
type PledgeMethod = (typeof PLEDGE_METHODS)[number];

/** The value the campaign Select uses for "no campaign — general support". */
const GENERAL_FUND = 'general';

const STATUS_COLOR: Record<DonationStatus, 'success' | 'warning' | 'danger' | 'default'> = {
  completed: 'success',
  pending: 'warning',
  failed: 'danger',
  refunded: 'default',
};

const CAMPAIGN_CHIP_COLOR: Record<CampaignStatus, 'success' | 'accent' | 'default'> = {
  active: 'success',
  upcoming: 'accent',
  ended: 'default',
};

// Volunteering brand gradient — mirrors VOL_GRADIENT in VolunteeringPage.
const VOL_GRADIENT_BASE = 'bg-linear-to-r from-rose-500 to-pink-600';
const VOL_GRADIENT = `${VOL_GRADIENT_BASE} text-white`;

const EMPTY_PLEDGE: PledgeForm = {
  giving_day_id: null,
  amount: '',
  payment_method: 'bank_transfer',
  payment_reference: '',
  message: '',
  anonymous: false,
};

/* ───────────────────────── Helpers ───────────────────────── */

function campaignStatus(day: GivingDay): CampaignStatus {
  if (day.status) return day.status;
  return day.is_active === false ? 'ended' : 'active';
}

function isAnonymous(d: Donation): boolean {
  return Boolean(d.anonymous ?? d.is_anonymous);
}

/** The server records Stripe gifts as `stripe`; every unknown method reads as "Other". */
function methodKey(method: string | null | undefined): 'card' | PledgeMethod | 'other' {
  if (method === 'stripe' || method === 'card') return 'card';
  if ((PLEDGE_METHODS as readonly string[]).includes(method ?? '')) return method as PledgeMethod;
  return 'other';
}

/** Whole calendar days from today to `iso` (negative when in the past). */
function daysFromToday(iso: string): number {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return 0;
  const today = new Date();
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((b - a) / 86_400_000);
}

function relativeDays(iso: string): string {
  try {
    return new Intl.RelativeTimeFormat(getFormattingLocale(), { numeric: 'auto' }).format(daysFromToday(iso), 'day');
  } catch {
    return '';
  }
}

/** Dates arrive as `YYYY-MM-DD`; parse them as local calendar days, not UTC midnight. */
function calendarDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  return formatDateValue(date);
}

/* ───────────────────────── Component ───────────────────────── */

export function DonationsTab() {
  const { t } = useTranslation('volunteering');
  const { tenant, tenantPath } = useTenant();
  const toast = useToast();
  const currency = (tenant?.currency || 'EUR').toUpperCase();

  const [givingDays, setGivingDays] = useState<GivingDay[]>([]);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState<PledgeForm>(EMPTY_PLEDGE);

  const pledgeModal = useDisclosure();
  const checkoutModal = useDisclosure();
  const [checkoutGivingDayId, setCheckoutGivingDayId] = useState<number | undefined>();

  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      const [daysRes, donationsRes] = await Promise.all([
        api.get<GivingDay[]>('/v2/volunteering/giving-days'),
        api.get<Donation[] | { items: Donation[] }>('/v2/volunteering/donations'),
      ]);
      if (controller.signal.aborted) return;

      // A non-thrown success:false must not fall through and render the empty
      // state with zero totals — surface a retryable error instead.
      if (!daysRes.success || !donationsRes.success) {
        setError(tRef.current('donations.load_error'));
        return;
      }

      setGivingDays(Array.isArray(daysRes.data) ? daysRes.data : []);

      const payload = donationsRes.data;
      const items = Array.isArray(payload)
        ? payload
        : payload && Array.isArray((payload as { items?: unknown }).items)
          ? (payload as { items: Donation[] }).items
          : [];
      setDonations(items);
      setHasLoaded(true);
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load donations data', err);
      setError(tRef.current('donations.load_error'));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  /* ── Derived view ── */

  const grouped = useMemo(() => {
    const live: GivingDay[] = [];
    const upcoming: GivingDay[] = [];
    const past: GivingDay[] = [];
    for (const day of givingDays) {
      const status = campaignStatus(day);
      if (status === 'active') live.push(day);
      else if (status === 'upcoming') upcoming.push(day);
      else past.push(day);
    }
    return { live, upcoming, past };
  }, [givingDays]);

  const stats = useMemo(() => {
    const raised = grouped.live.reduce((sum, d) => sum + (Number(d.raised_amount) || 0), 0);
    const given = donations
      .filter((d) => d.status === 'completed')
      .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
    const pending = donations.filter((d) => d.status === 'pending').length;
    return { liveCount: grouped.live.length, raised, given, pending };
  }, [grouped.live, donations]);

  const campaignTitles = useMemo(() => {
    const map = new Map<number, string>();
    for (const day of givingDays) map.set(day.id, day.title);
    return map;
  }, [givingDays]);

  const money = (value: number | string, code?: string | null) =>
    formatCurrency(Number(value) || 0, (code || currency).toUpperCase());

  /* ── Actions ── */

  const openCheckout = (dayId?: number) => {
    setCheckoutGivingDayId(dayId);
    checkoutModal.onOpen();
  };

  const openPledge = (dayId?: number) => {
    setForm({ ...EMPTY_PLEDGE, giving_day_id: dayId ?? null });
    pledgeModal.onOpen();
  };

  const submitPledge = async (onClose: () => void) => {
    const amount = parseFloat(form.amount);
    if (!form.amount || Number.isNaN(amount) || amount <= 0) {
      toastRef.current.error(tRef.current('donations.invalid_amount'));
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await api.post('/v2/volunteering/donations', {
        giving_day_id: form.giving_day_id,
        amount,
        currency,
        payment_method: form.payment_method,
        payment_reference: form.payment_reference.trim() || null,
        message: form.message.trim() || null,
        is_anonymous: form.anonymous,
      });

      if (response.success) {
        toastRef.current.success(tRef.current('donations.pledge_success'));
        onClose();
        void load();
      } else {
        toastRef.current.error(response.error || tRef.current('donations.submit_error'));
      }
    } catch (err) {
      logError('Failed to record donation pledge', err);
      toastRef.current.error(tRef.current('donations.submit_error_retry'));
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ── Render helpers ── */

  const renderCampaign = (day: GivingDay) => {
    const status = campaignStatus(day);
    const goal = Number(day.goal_amount) || 0;
    const raised = Number(day.raised_amount) || 0;
    const pct = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0;
    const endIso = day.ends_at ?? day.end_date;
    const startIso = day.starts_at ?? day.start_date;
    const dateLine =
      status === 'ended'
        ? t('donations.ended_on', { date: calendarDate(endIso) })
        : status === 'upcoming'
          ? `${t('donations.starts_on', { date: calendarDate(startIso) })} · ${relativeDays(startIso)}`
          : `${t('donations.ends_on', { date: calendarDate(endIso) })} · ${relativeDays(endIso)}`;

    return (
      <GlassCard key={day.id} className={`p-5 ${status === 'ended' ? 'opacity-80' : ''}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-lg font-semibold text-theme-primary">{day.title}</h4>
              <Chip size="sm" color={CAMPAIGN_CHIP_COLOR[status]} variant="soft">
                {t(`donations.day_status.${status}`)}
              </Chip>
            </div>
            {day.organization_name && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-theme-secondary">
                <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('donations.for_organisation', { name: day.organization_name })}
              </p>
            )}
            {day.description && (
              <p className="mt-1 text-sm text-theme-muted">{day.description}</p>
            )}

            <div className="mt-4">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                <span className="font-medium text-theme-primary tabular-nums">
                  {t('donations.raised_of_goal', { raised: money(raised), goal: money(goal) })}
                </span>
                <span className="text-theme-muted tabular-nums">{t('donations.percent_funded', { percent: pct })}</span>
              </div>
              <Progress
                size="md"
                value={pct}
                classNames={{ indicator: VOL_GRADIENT_BASE, track: 'bg-theme-hover' }}
                aria-label={t('donations.progress_aria', { percent: pct })}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-subtle">
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {t('donations.donors_count', { count: day.donor_count ?? 0 })}
              </span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                {dateLine}
              </span>
            </div>
          </div>

          {status === 'active' && (
            <div className="flex flex-col gap-2 sm:flex-row lg:w-48 lg:shrink-0 lg:flex-col">
              <Button
                size="sm"
                className={`${VOL_GRADIENT} w-full`}
                startContent={<CreditCard className="h-4 w-4" aria-hidden="true" />}
                onPress={() => openCheckout(day.id)}
              >
                {t('donations.donate_with_card')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                startContent={<Banknote className="h-4 w-4" aria-hidden="true" />}
                onPress={() => openPledge(day.id)}
              >
                {t('donations.record_pledge')}
              </Button>
            </div>
          )}
        </div>
      </GlassCard>
    );
  };

  const renderSection = (title: string, hint: string | null, days: GivingDay[]) =>
    days.length > 0 && (
      <section className="space-y-3" aria-label={title}>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-theme-secondary">{title}</h3>
          {hint && <p className="text-xs text-theme-subtle">{hint}</p>}
        </div>
        <div className="space-y-4">{days.map(renderCampaign)}</div>
      </section>
    );

  const renderDonation = (d: Donation) => {
    const method = methodKey(d.payment_method);
    const campaign = d.giving_day_title
      ?? (d.giving_day_id != null ? campaignTitles.get(d.giving_day_id) : undefined)
      ?? t('donations.fund_options.general');
    const canViewReceipt = d.status === 'completed' && method === 'card';

    return (
      <GlassCard key={d.id} className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-theme-primary tabular-nums">{money(d.amount, d.currency)}</span>
              <Chip size="sm" color={STATUS_COLOR[d.status] ?? 'default'} variant="soft">
                {t(`donations.status.${d.status}`)}
              </Chip>
              {isAnonymous(d) && (
                <Chip size="sm" variant="soft" startContent={<EyeOff className="h-3 w-3" aria-hidden="true" />}>
                  {t('donations.anonymous')}
                </Chip>
              )}
            </div>
            <p className="mt-1 text-sm text-theme-secondary">{campaign}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-subtle">
              {d.organization_name && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('donations.for_organisation', { name: d.organization_name })}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                {method === 'card'
                  ? <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                  : <Banknote className="h-3.5 w-3.5" aria-hidden="true" />}
                {t(`donations.methods.${method}`)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                {formatDateValue(d.created_at)}
              </span>
            </div>
            {d.message && <p className="mt-2 text-sm text-theme-muted">{d.message}</p>}
            {d.status === 'pending' && (
              <p className="mt-2 inline-flex items-start gap-1.5 text-xs text-theme-muted">
                <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t('donations.pending_pledge_note')}
              </p>
            )}
          </div>
          {canViewReceipt && (
            <Button
              as={Link}
              to={tenantPath(`/donations/${d.id}/receipt`)}
              size="sm"
              variant="tertiary"
              className="w-full sm:w-auto sm:shrink-0"
              startContent={<FileText className="h-4 w-4" aria-hidden="true" />}
            >
              {t('donations.view_receipt')}
            </Button>
          )}
        </div>
      </GlassCard>
    );
  };

  const showSkeleton = isLoading && !hasLoaded && !error;
  const nothingYet = hasLoaded && givingDays.length === 0 && donations.length === 0;

  return (
    <div className="space-y-6">
      {/* Header: title left, the three actions right. On phones the actions
          become equal-width rows instead of a ragged left-aligned stack. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <HandHeart className="h-5 w-5 text-rose-500" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('donations.heading')}</h2>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center lg:shrink-0">
          <Button
            size="sm"
            variant="tertiary"
            className="w-full sm:w-auto"
            startContent={<RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />}
            onPress={() => void load()}
            isDisabled={isLoading}
          >
            {t('donations.refresh')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="w-full sm:w-auto"
            startContent={<Banknote className="h-4 w-4" aria-hidden="true" />}
            onPress={() => openPledge()}
          >
            {t('donations.record_pledge')}
          </Button>
          <Button
            size="sm"
            className={`${VOL_GRADIENT} w-full sm:w-auto`}
            startContent={<CreditCard className="h-4 w-4" aria-hidden="true" />}
            onPress={() => openCheckout()}
          >
            {t('donations.donate_with_card')}
          </Button>
        </div>
      </div>

      {/* What donations actually are — money to support the community, NOT time
          credits. This distinction was a persistent source of confusion. */}
      <GlassCard className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-lg bg-rose-500/10 p-2 text-rose-600 dark:text-rose-400">
            <Info className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-theme-primary">{t('donations.intro_title')}</h3>
            <p className="text-sm text-theme-muted">{t('donations.intro_desc')}</p>
            <p className="mt-1 text-xs text-theme-subtle">{t('donations.currency_fixed_hint', { currency })}</p>
          </div>
        </div>
      </GlassCard>

      {/* Error */}
      {error && !isLoading && (
        <Alert
          color="danger"
          title={error}
          endContent={
            <Button size="sm" variant="secondary" onPress={() => void load()}>
              {t('try_again')}
            </Button>
          }
        />
      )}

      {/* Loading (first load only — a refresh dims the content instead) */}
      {showSkeleton && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          {[1, 2, 3].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {hasLoaded && (
        <div className={`space-y-6 transition-opacity ${isLoading ? 'opacity-60' : ''}`} aria-busy={isLoading || undefined}>
          {/* Summary tiles */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <GlassCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500">
                  <Megaphone className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-theme-muted">{t('donations.stats.live_campaigns')}</p>
                  <p className="text-xl font-bold text-theme-primary tabular-nums">{stats.liveCount.toLocaleString(getFormattingLocale())}</p>
                </div>
              </div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-theme-muted">{t('donations.stats.raised')}</p>
                  <p className="text-xl font-bold text-theme-primary tabular-nums">{money(stats.raised)}</p>
                  <p className="text-xs text-theme-subtle">{t('donations.stats.raised_hint')}</p>
                </div>
              </div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
                  <Heart className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-theme-muted">{t('donations.stats.you_gave')}</p>
                  <p className="text-xl font-bold text-theme-primary tabular-nums">{money(stats.given)}</p>
                  {stats.pending > 0 && (
                    <p className="text-xs text-theme-subtle">
                      {t('donations.stats.pending_pledges', { number: stats.pending.toLocaleString(getFormattingLocale()) })}
                    </p>
                  )}
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Nothing at all yet */}
          {nothingYet && (
            <EmptyState
              icon={<Heart className="h-12 w-12" aria-hidden="true" />}
              title={t('donations.empty_title')}
              description={t('donations.empty_description')}
              action={
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className={VOL_GRADIENT}
                    startContent={<CreditCard className="h-4 w-4" aria-hidden="true" />}
                    onPress={() => openCheckout()}
                  >
                    {t('donations.donate_with_card')}
                  </Button>
                  <Button
                    variant="secondary"
                    startContent={<Banknote className="h-4 w-4" aria-hidden="true" />}
                    onPress={() => openPledge()}
                  >
                    {t('donations.record_pledge')}
                  </Button>
                </div>
              }
            />
          )}

          {/* Campaigns */}
          {renderSection(t('donations.live_campaigns'), null, grouped.live)}
          {renderSection(t('donations.upcoming_campaigns'), null, grouped.upcoming)}
          {renderSection(t('donations.past_campaigns'), t('donations.past_campaigns_hint'), grouped.past)}

          {/* My donations */}
          {donations.length > 0 && (
            <section className="space-y-3" aria-label={t('donations.my_donations')}>
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-theme-secondary">{t('donations.my_donations')}</h3>
                <p className="text-xs text-theme-subtle">{t('donations.my_donations_hint')}</p>
              </div>
              <div className="space-y-3">{donations.map(renderDonation)}</div>
            </section>
          )}
        </div>
      )}

      {/* Stripe checkout */}
      {checkoutModal.isOpen && (
        <Suspense fallback={null}>
          <DonationCheckout
            isOpen={checkoutModal.isOpen}
            onClose={checkoutModal.onClose}
            givingDayId={checkoutGivingDayId}
            beneficiaryName={
              checkoutGivingDayId != null
                ? givingDays.find((day) => day.id === checkoutGivingDayId)?.organization_name ?? undefined
                : undefined
            }
            onDonationComplete={() => void load()}
          />
        </Suspense>
      )}

      {/* Pledge modal */}
      <Modal
        isOpen={pledgeModal.isOpen}
        onOpenChange={pledgeModal.onOpenChange}
        size="lg"
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2 text-theme-primary">
                <Banknote className="h-5 w-5" aria-hidden="true" />
                {t('donations.record_pledge')}
              </ModalHeader>
              <ModalBody className="gap-4">
                <p className="text-sm text-theme-muted">{t('donations.pledge_intro')}</p>

                <Select
                  label={t('donations.form.campaign')}
                  variant="secondary"
                  selectedKeys={new Set([form.giving_day_id != null ? String(form.giving_day_id) : GENERAL_FUND])}
                  onSelectionChange={(keys) => {
                    const [key] = Array.from(keys as Set<string | number>);
                    const next = key == null || String(key) === GENERAL_FUND ? null : Number(key);
                    setForm((f) => ({ ...f, giving_day_id: Number.isNaN(next as number) ? null : next }));
                  }}
                >
                  <SelectItem key={GENERAL_FUND} id={GENERAL_FUND}>{t('donations.fund_options.general')}</SelectItem>
                  {grouped.live.map((day) => (
                    <SelectItem key={String(day.id)} id={String(day.id)}>{day.title}</SelectItem>
                  ))}
                </Select>

                <Input
                  label={t('donations.form.amount')}
                  type="number"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  inputMode="decimal"
                  variant="secondary"
                  value={form.amount}
                  onValueChange={(v) => setForm((f) => ({ ...f, amount: v }))}
                  startContent={<Banknote className="h-4 w-4 text-theme-subtle" aria-hidden="true" />}
                  endContent={<span className="text-xs font-semibold text-theme-subtle">{currency}</span>}
                  placeholder={t('donations.placeholder_amount')}
                  isRequired
                />

                <RadioGroup
                  label={t('donations.form.payment_method')}
                  orientation="horizontal"
                  value={form.payment_method}
                  onValueChange={(value) => setForm((f) => ({ ...f, payment_method: value as PledgeMethod }))}
                >
                  {PLEDGE_METHODS.map((pm) => (
                    <Radio key={pm} value={pm}>
                      {t(`donations.methods.${pm}`)}
                    </Radio>
                  ))}
                </RadioGroup>

                <Input
                  label={t('donations.form.reference')}
                  variant="secondary"
                  value={form.payment_reference}
                  onValueChange={(v) => setForm((f) => ({ ...f, payment_reference: v }))}
                  description={t('donations.form.reference_hint')}
                  maxLength={255}
                />

                <Textarea
                  label={t('donations.form.message')}
                  variant="secondary"
                  value={form.message}
                  onValueChange={(v) => setForm((f) => ({ ...f, message: v }))}
                  maxRows={3}
                />

                <Switch
                  isSelected={form.anonymous}
                  onValueChange={(v) => setForm((f) => ({ ...f, anonymous: v }))}
                  size="sm"
                >
                  {t('donations.anonymous_toggle')}
                </Switch>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('donations.cancel')}</Button>
                <Button
                  className={VOL_GRADIENT}
                  onPress={() => void submitPledge(onClose)}
                  isLoading={isSubmitting}
                  isDisabled={!form.amount || parseFloat(form.amount) <= 0}
                >
                  {t('donations.confirm')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default DonationsTab;
