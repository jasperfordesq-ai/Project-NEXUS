// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Create Group Exchange Page - 4-step wizard
 *
 * Steps:
 *  1. Exchange Details - Title, description, the kind of exchange and its hours
 *  2. Add Participants - Search members, add each to giving time or receiving time
 *  3. Review Split    - What everyone will earn or pay, as worked out by the server
 *  4. Confirm & Create - Full summary, create button
 *
 * Five kinds, always in this order: workshop, team, equal, weighted, custom.
 * No arithmetic happens here: the review calls POST /v2/group-exchanges/preview
 * so what a member sees is exactly what settlement will do.
 *
 * Route: /group-exchanges/create
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import ArrowRight from 'lucide-react/icons/arrow-right';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Users from 'lucide-react/icons/users';
import GraduationCap from 'lucide-react/icons/graduation-cap';
import HandHelping from 'lucide-react/icons/hand-helping';
import Scale from 'lucide-react/icons/scale';
import Percent from 'lucide-react/icons/percent';
import PencilLine from 'lucide-react/icons/pencil-line';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Search from 'lucide-react/icons/search';
import Plus from 'lucide-react/icons/plus';
import X from 'lucide-react/icons/x';
import UserPlus from 'lucide-react/icons/user-plus';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Description } from '@/components/ui/Description';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { NumberField } from '@/components/ui/NumberField';
import { Progress } from '@/components/ui/Progress';
import { RadioGroup, Radio } from '@/components/ui/Radio';
import { SearchField } from '@/components/ui/SearchField';
import { Separator } from '@/components/ui/Separator';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { Breadcrumbs } from '@/components/navigation';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { useAuth, useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import type { User } from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** The five kinds of group exchange, in the order members see them everywhere. */
type SplitType = 'workshop' | 'team' | 'equal' | 'weighted' | 'custom';
type ParticipantRole = 'provider' | 'receiver';

interface Participant {
  user_id: number;
  name: string;
  avatar: string | null;
  role: ParticipantRole;
  hours: number;
  weight: number;
}

interface SearchResult {
  id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  avatar?: string;
  email?: string;
}

/** POST /v2/group-exchanges/preview — what everyone will earn or pay. */
interface PreviewLine {
  user_id: number;
  name: string | null;
  role: ParticipantRole;
  hours: number;
  verb: 'earns' | 'pays';
}

interface PreviewResult {
  lines: PreviewLine[];
  community_fund_hours: number;
  totals: { earned: number; paid: number; to_fund: number };
  problem: { code: string; message: string } | null;
}

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

const TOTAL_STEPS = 4;
const PREVIEW_ENDPOINT = '/v2/group-exchanges/preview';
const PREVIEW_DEBOUNCE_MS = 300;

function selfAsSearchResult(user: User): SearchResult {
  return {
    id: user.id,
    name: user.name,
    first_name: user.first_name,
    last_name: user.last_name,
    avatar_url: user.avatar_url ?? undefined,
    avatar: user.avatar ?? undefined,
  };
}

const SPLIT_TYPE_CARDS: { value: SplitType; icon: React.ReactNode }[] = [
  { value: 'workshop', icon: <GraduationCap className="w-6 h-6 text-accent" /> },
  { value: 'team', icon: <HandHelping className="w-6 h-6 text-accent" /> },
  { value: 'equal', icon: <Scale className="w-6 h-6 text-accent" /> },
  { value: 'weighted', icon: <Percent className="w-6 h-6 text-emerald-500" /> },
  { value: 'custom', icon: <PencilLine className="w-6 h-6 text-accent" /> },
];

// ─────────────────────────────────────────────────────────────────────────────
// What each kind needs from the form (the server does all the arithmetic)
// ─────────────────────────────────────────────────────────────────────────────

/** Workshop and team ask for one number that pre-fills people's own hours. */
function prefillApplies(kind: SplitType, role: ParticipantRole): boolean {
  return kind === 'workshop' || (kind === 'team' && role === 'provider');
}

/** Whether a person types their own hours for this kind. */
function entersOwnHours(kind: SplitType, role: ParticipantRole): boolean {
  return kind === 'custom' || prefillApplies(kind, role);
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The `total_hours` the server expects for each kind. */
function totalHoursFor(kind: SplitType, prefillHours: number, totalHours: number, participants: Participant[]): number {
  switch (kind) {
    case 'workshop':
    case 'team':
      return finiteOrZero(prefillHours);
    case 'equal':
    case 'weighted':
      return finiteOrZero(totalHours);
    default:
      return roundHours(
        participants.filter((p) => p.role === 'provider').reduce((sum, p) => sum + p.hours, 0),
      );
  }
}

// Shared classNames
const inputClassNames = {
  input: 'bg-transparent text-theme-primary',
  inputWrapper: 'bg-theme-elevated border-theme-default',
  label: 'text-theme-muted',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function CreateGroupExchangePage() {
  const { t } = useTranslation('group_exchanges');
  usePageTitle(t('create.page_title'));
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [slideDirection, setSlideDirection] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1: Exchange details
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [splitType, setSplitType] = useState<SplitType>('workshop');
  // NumberField works in numbers; NaN represents the empty state.
  // Workshop and team: one number that pre-fills people's own hours
  // (session length / hours per helper).
  const [prefillHours, setPrefillHours] = useState<number>(NaN);
  // Equal and weighted: the one total that is shared out.
  const [totalHours, setTotalHours] = useState<number>(NaN);

  // Step 2: Participants
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────────

  const goNext = useCallback(() => {
    setSlideDirection(1);
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, []);

  const goBack = useCallback(() => {
    setSlideDirection(-1);
    setCurrentStep((s) => Math.max(s - 1, 1));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1 validation
  // ─────────────────────────────────────────────────────────────────────────

  const needsPrefill = splitType === 'workshop' || splitType === 'team';
  const needsTotal = splitType === 'equal' || splitType === 'weighted';
  const canProceedStep1 =
    title.trim().length > 0
    && (needsPrefill ? prefillHours > 0 : needsTotal ? totalHours > 0 : true);

  // Changing the kind never removes anyone or any typed hours. Where the new
  // kind pre-fills people's hours, a person still on blank gets the number.
  const handleKindChange = useCallback((value: string) => {
    const next = value as SplitType;
    setSplitType(next);
    if (prefillHours > 0) {
      setParticipants((prev) =>
        prev.map((p) => (prefillApplies(next, p.role) && p.hours === 0 ? { ...p, hours: prefillHours } : p)),
      );
    }
  }, [prefillHours]);

  // Changing the pre-fill number updates everyone who has not been given their
  // own hours (blank, or still on the old number).
  const handlePrefillChange = useCallback((value: number | undefined) => {
    const next = value === undefined || Number.isNaN(value) ? NaN : value;
    const previous = prefillHours;
    setPrefillHours(next);
    setParticipants((prev) =>
      prev.map((p) => {
        if (!prefillApplies(splitType, p.role)) return p;
        const untouched = p.hours === 0 || (previous > 0 && p.hours === previous);
        return untouched ? { ...p, hours: next > 0 ? next : 0 } : p;
      }),
    );
  }, [prefillHours, splitType]);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Member search
  // ─────────────────────────────────────────────────────────────────────────

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);

    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    if (value.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        setIsSearching(true);
        // The member directory filters on the `q` param (not `search`); sending the
        // wrong name returned an unfiltered member list regardless of what was typed.
        const response = await api.get<{ data: SearchResult[] }>(`/v2/users?q=${encodeURIComponent(value.trim())}&limit=10`);

        if (response.success && response.data) {
          const results = Array.isArray(response.data) ? response.data : [];
          // Filter out current user and already-added participants
          const existingIds = new Set(participants.map((p) => p.user_id));
          if (user?.id) {
            existingIds.add(user.id);
          }
          setSearchResults(results.filter((r: SearchResult) => !existingIds.has(r.id)));
        }
      } catch (err) {
        logError('Failed to search users', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    setSearchTimeout(timeout);
  }, [participants, user?.id, searchTimeout]);

  const addParticipant = useCallback((result: SearchResult, role: ParticipantRole) => {
    const displayName = result.name || resolveUserDisplayName(result) || 'Unknown';
    const avatarUrl = result.avatar_url || result.avatar || null;

    setParticipants((prev) => [
      ...prev,
      {
        user_id: result.id,
        name: displayName,
        avatar: avatarUrl,
        role,
        // Workshop/team pre-fill the person's hours with the number from step 1.
        hours: prefillApplies(splitType, role) && prefillHours > 0 ? prefillHours : 0,
        weight: 1,
      },
    ]);

    // Remove from search results
    setSearchResults((prev) => prev.filter((r) => r.id !== result.id));
  }, [splitType, prefillHours]);

  const removeParticipant = useCallback((userId: number) => {
    setParticipants((prev) => prev.filter((p) => p.user_id !== userId));
  }, []);

  const updateParticipantHours = useCallback((userId: number, hours: number) => {
    setParticipants((prev) =>
      prev.map((p) => (p.user_id === userId ? { ...p, hours } : p))
    );
  }, []);

  const updateParticipantWeight = useCallback((userId: number, weight: number) => {
    setParticipants((prev) =>
      prev.map((p) => (p.user_id === userId ? { ...p, weight } : p))
    );
  }, []);

  const providers = participants.filter((p) => p.role === 'provider');
  const receivers = participants.filter((p) => p.role === 'receiver');
  const canProceedStep2 = providers.length >= 1 && receivers.length >= 1;

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: What everyone will earn or pay — worked out by the server
  // ─────────────────────────────────────────────────────────────────────────

  // The same body is used to preview and to create, so they cannot disagree.
  const requestBody = useMemo(() => ({
    split_type: splitType,
    total_hours: totalHoursFor(splitType, prefillHours, totalHours, participants),
    participants: participants.map((p) => ({
      user_id: p.user_id,
      role: p.role,
      hours: entersOwnHours(splitType, p.role) ? finiteOrZero(p.hours) : 0,
      weight: p.weight,
    })),
  }), [splitType, prefillHours, totalHours, participants]);
  const requestKey = JSON.stringify(requestBody);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle');
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const needsPreview = currentStep >= 3;

  useEffect(() => {
    if (!needsPreview) return;

    // Set when this run is superseded (or the page leaves the review), so a slow
    // answer that arrives after a newer request is ignored rather than shown.
    let superseded = false;
    setPreview(null);
    setPreviewStatus('loading');

    const timer = setTimeout(async () => {
      try {
        const response = await api.post<PreviewResult>(PREVIEW_ENDPOINT, JSON.parse(requestKey));
        if (superseded) return;
        if (response.success && response.data) {
          setPreview(response.data);
          setPreviewStatus('ready');
        } else {
          setPreviewStatus('error');
        }
      } catch (err) {
        if (superseded) return;
        logError('Failed to preview group exchange hours', err);
        setPreviewStatus('error');
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      superseded = true;
      clearTimeout(timer);
    };
  }, [needsPreview, requestKey, previewAttempt]);

  const canCreate = previewStatus === 'ready' && preview !== null && preview.problem === null;

  // ─────────────────────────────────────────────────────────────────────────
  // Step 4: Create exchange
  // ─────────────────────────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    if (!canCreate) return;
    try {
      setIsSubmitting(true);

      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        ...requestBody,
      };

      const response = await api.post<{ id: number }>('/v2/group-exchanges', payload);

      if (response.success && response.data) {
        const newId = response.data?.id;
        toastRef.current.success(tRef.current('toast.created'), tRef.current('toast.created_desc'));
        navigate(tenantPath(`/group-exchanges/${newId}`));
      } else {
        toastRef.current.error(tRef.current('toast.create_failed'), response.error || tRef.current('toast.error_occurred'));
      }
    } catch (err) {
      logError('Failed to create group exchange', err);
      toastRef.current.error(tRef.current('toast.create_failed'), tRef.current('toast.something_wrong'));
    } finally {
      setIsSubmitting(false);
    }
  }, [canCreate, title, description, requestBody, navigate, tenantPath]);

  // ─────────────────────────────────────────────────────────────────────────
  // Animation
  // ─────────────────────────────────────────────────────────────────────────

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 80 : -80,
      opacity: 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (direction: number) => ({
      x: direction < 0 ? 80 : -80,
      opacity: 0,
    }),
  };

  const stepLabels = [
    t('create.step_details'),
    t('create.step_participants'),
    t('create.step_review_split'),
    t('create.step_confirm'),
  ];
  const currentStepLabel = stepLabels[currentStep - 1] ?? t('create.step_details');

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-5xl space-y-6"
    >
      <PageMeta title={t('page_meta.create.title')} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('title'), href: '/group-exchanges' },
        { label: t('create.breadcrumb') },
      ]} />

      {/* Title */}
      <header className="overflow-hidden rounded-2xl border border-theme-default bg-theme-surface">
        <div className="flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15">
              <ArrowLeftRight className="h-7 w-7 text-accent" aria-hidden="true" />
            </div>
            <h1 className="text-3xl font-bold leading-tight text-theme-primary sm:text-4xl">
              {t('create.title')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-theme-muted sm:text-base">{t('create.subtitle')}</p>
          </div>
          <div className="rounded-xl border border-theme-default bg-theme-elevated px-4 py-3 lg:min-w-72">
            <span className="block text-xs font-medium uppercase tracking-wide text-theme-subtle">
              {t('create.current_step')}
            </span>
            <span className="mt-1 block font-semibold text-theme-primary">
              {t('create.step_of_named', { current: currentStep, total: TOTAL_STEPS, name: currentStepLabel })}
            </span>
          </div>
        </div>
      </header>

      {/* Step Indicator */}
      <div className="rounded-2xl border border-theme-default bg-theme-surface p-4">
      <div className="flex items-center">
        {stepLabels.map((label, idx) => {
          const stepNum = idx + 1;
          const isComplete = currentStep > stepNum;
          const isCurrent = currentStep === stepNum;
          return (
            <div key={stepNum} className="flex-1 flex items-center">
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                <div className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all
                  ${isComplete
                    ? 'bg-gradient-to-r from-accent to-accent-gradient-end text-white'
                    : isCurrent
                      ? 'bg-accent/20 text-accent ring-2 ring-accent'
                      : 'bg-theme-elevated text-theme-subtle'}
                `}>
                  {isComplete ? <CheckCircle className="w-4 h-4" aria-hidden="true" /> : stepNum}
                </div>
                <span className={`text-xs text-center hidden sm:block ${isCurrent ? 'text-theme-primary font-medium' : 'text-theme-subtle'}`}>
                  {label}
                </span>
              </div>
              {idx < stepLabels.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 rounded-full transition-all ${
                  currentStep > stepNum + 1
                    ? 'bg-gradient-to-r from-accent to-accent-gradient-end'
                    : currentStep > stepNum
                      ? 'bg-accent/40'
                      : 'bg-theme-elevated'
                }`} />
              )}
            </div>
          );
        })}
      </div>
      <Progress
        value={(currentStep / TOTAL_STEPS) * 100}
        size="sm"
        classNames={{
          indicator: 'bg-gradient-to-r from-accent to-accent-gradient-end',
          track: 'bg-theme-elevated',
        }}
        aria-label={t('create.step_of', { current: currentStep, total: TOTAL_STEPS })}
      />
      </div>

      {/* Step Content */}
      <AnimatePresence mode="wait" custom={slideDirection}>
        <motion.div
          key={currentStep}
          custom={slideDirection}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.25, ease: 'easeInOut' }}
        >
          {/* ─── Step 1: Exchange Details ─── */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <GlassCard className="p-6 sm:p-8">
                <h2 className="text-lg font-semibold text-theme-primary mb-2 flex items-center gap-2">
                  <ArrowLeftRight className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                  {t('create.exchange_details')}
                </h2>
                <p className="text-theme-muted text-sm mb-6">
                  {t('create.exchange_details_desc')}
                </p>

                <div className="space-y-4">
                  <Input
                    label={t('create.title_label')}
                    placeholder={t('create.title_placeholder')}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    isRequired
                    classNames={inputClassNames}
                  />

                  <Textarea
                    label={t('create.description_label')}
                    placeholder={t('create.description_placeholder')}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    minRows={4}
                    classNames={{
                      input: 'bg-transparent text-theme-primary',
                      inputWrapper: 'bg-theme-elevated border-theme-default',
                      label: 'text-theme-muted',
                    }}
                  />

                </div>
              </GlassCard>

              {/* Kind of exchange */}
              <GlassCard className="p-6 sm:p-8">
                <h2 className="text-lg font-semibold text-theme-primary mb-2 flex items-center gap-2">
                  <Scale className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                  {t('kinds.heading')}
                </h2>
                <p className="text-theme-muted text-sm mb-4">
                  {t('kinds.rule')}
                </p>

                <RadioGroup
                  aria-label={t('kinds.heading')}
                  value={splitType}
                  onChange={handleKindChange}
                  className="grid grid-cols-1 gap-3"
                >
                  {SPLIT_TYPE_CARDS.map((card) => (
                    <Radio
                      key={card.value}
                      value={card.value}
                      // Selected styling is applied directly: the theme's
                      // border/bg tokens are unlayered CSS, so they beat a
                      // data-[selected=true]: utility and the chosen card
                      // looked exactly like the others.
                      className={`cursor-pointer rounded-xl border-2 p-4 transition-all ${
                        splitType === card.value
                          ? 'border-accent bg-accent/10'
                          : 'border-theme-default bg-theme-elevated hover:border-accent/30 hover:bg-theme-hover'
                      }`}
                    >
                      {() => (
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 shrink-0" aria-hidden="true">
                            {card.icon}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-theme-primary text-sm mb-1">
                              {t('kinds.' + card.value + '.title')}
                            </h3>
                            <p className="text-xs text-theme-muted leading-relaxed">
                              {t('kinds.' + card.value + '.desc')}
                            </p>
                            {splitType === card.value && (
                              <p className="mt-2 rounded-lg bg-theme-surface px-3 py-2 text-xs text-theme-primary leading-relaxed">
                                {t('kinds.' + card.value + '.example')}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </Radio>
                  ))}
                </RadioGroup>

                {/* The one number this kind needs (custom needs none: each person types their own) */}
                {needsPrefill && (
                  <NumberField
                    value={prefillHours}
                    onChange={handlePrefillChange}
                    minValue={0.25}
                    step={0.25}
                    isRequired
                    formatOptions={{ maximumFractionDigits: 2 }}
                    className="w-full mt-6"
                  >
                    <Label className={inputClassNames.label}>
                      {splitType === 'workshop' ? t('inputs.session_length_label') : t('inputs.helper_hours_label')}
                    </Label>
                    <NumberField.Group className={inputClassNames.inputWrapper}>
                      <NumberField.DecrementButton />
                      <NumberField.Input className={inputClassNames.input} placeholder={t('inputs.hours_placeholder')} />
                      <NumberField.IncrementButton />
                    </NumberField.Group>
                    <Description>
                      {splitType === 'workshop' ? t('inputs.session_length_hint') : t('inputs.helper_hours_hint')}
                    </Description>
                  </NumberField>
                )}

                {needsTotal && (
                  <NumberField
                    value={totalHours}
                    onChange={(v) => setTotalHours(v ?? NaN)}
                    minValue={0.25}
                    step={0.25}
                    isRequired
                    formatOptions={{ maximumFractionDigits: 2 }}
                    className="w-full mt-6"
                  >
                    <Label className={inputClassNames.label}>{t('create.total_hours_label')}</Label>
                    <NumberField.Group className={inputClassNames.inputWrapper}>
                      <NumberField.DecrementButton />
                      <NumberField.Input className={inputClassNames.input} placeholder={t('create.total_hours_placeholder')} />
                      <NumberField.IncrementButton />
                    </NumberField.Group>
                  </NumberField>
                )}
              </GlassCard>

              {/* Navigation */}
              <div className="flex items-center justify-end">
                <Button
                  className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                  endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
                  onPress={goNext}
                  isDisabled={!canProceedStep1}
                >
                  {t('create.next')}
                </Button>
              </div>
            </div>
          )}

          {/* ─── Step 2: Add Participants ─── */}
          {currentStep === 2 && (
            <div className="space-y-6">
              {/* Search */}
              <GlassCard className="p-6 sm:p-8">
                <h2 className="text-lg font-semibold text-theme-primary mb-2 flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                  {t('create.add_participants')}
                </h2>
                <p className="text-theme-muted text-sm mb-4">
                  {t('create.add_participants_desc')}
                </p>

                <SearchField
                  placeholder={t('detail.search_members_placeholder')}
                  value={searchQuery}
                  onValueChange={handleSearchChange}
                  startContent={<Search className="w-4 h-4 text-theme-muted" aria-hidden="true" />}
                  endContent={isSearching ? <span role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })}><Spinner size="sm" /></span> : null}
                  classNames={inputClassNames}
                  aria-label={t('detail.search_members_aria')}
                />

                {/*
                  Results render INLINE in normal document flow — not an absolutely
                  positioned overlay. The old dropdown floated out of flow, so when the
                  search box sat low in the viewport the list fell below the fold with
                  no way to scroll to it (only the tops of the role buttons peeked out).
                  In-flow results grow the card and let the page scroll naturally.
                */}
                {searchQuery.trim().length >= 2 && (
                  <div className="mt-4" role="region" aria-label={t('detail.search_members_aria')}>
                    {searchResults.length > 0 ? (
                      <div className="max-h-96 overflow-y-auto rounded-xl border border-theme-default divide-y divide-theme-default/60">
                        {searchResults.map((result) => {
                          const displayName = result.name || resolveUserDisplayName(result) || 'Unknown';
                          return (
                            <div
                              key={result.id}
                              className="flex flex-wrap items-center justify-between gap-3 p-3 hover:bg-theme-hover transition-colors"
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <Avatar
                                  src={resolveAvatarUrl(result.avatar_url || result.avatar)}
                                  name={displayName}
                                  size="sm"
                                  className="shrink-0"
                                />
                                <div className="min-w-0">
                                  <p className="font-medium text-theme-primary text-sm truncate">{displayName}</p>
                                  {result.email && (
                                    <p className="text-xs text-theme-subtle truncate">{result.email}</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <Button
                                  size="sm"
                                  variant="flat"
                                  className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                                  onPress={() => addParticipant(result, 'provider')}
                                  startContent={<Plus className="w-3 h-3" aria-hidden="true" />}
                                >
                                  {t('roles.giving')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="flat"
                                  className="bg-amber-500/20 text-amber-700 dark:text-amber-400"
                                  onPress={() => addParticipant(result, 'receiver')}
                                  startContent={<Plus className="w-3 h-3" aria-hidden="true" />}
                                >
                                  {t('roles.receiving')}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : !isSearching ? (
                      <p className="rounded-xl border border-theme-default bg-theme-elevated/50 p-4 text-center text-sm text-theme-muted">
                        {t('detail.no_members_found')}
                      </p>
                    ) : null}
                  </div>
                )}

                {/*
                  The member directory never returns the viewer, so an organiser
                  who is also delivering the activity (a workshop leader, say)
                  could not add themselves at all. Offer it explicitly.
                */}
                {user?.id && !participants.some((p) => p.user_id === user.id) && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-theme-default p-3">
                    <p className="text-sm text-theme-muted">{t('create.add_yourself')}</p>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="flat"
                        className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                        onPress={() => addParticipant(selfAsSearchResult(user), 'provider')}
                        startContent={<Plus className="w-3 h-3" aria-hidden="true" />}
                      >
                        {t('roles.giving')}
                      </Button>
                      <Button
                        size="sm"
                        variant="flat"
                        className="bg-amber-500/20 text-amber-700 dark:text-amber-400"
                        onPress={() => addParticipant(selfAsSearchResult(user), 'receiver')}
                        startContent={<Plus className="w-3 h-3" aria-hidden="true" />}
                      >
                        {t('roles.receiving')}
                      </Button>
                    </div>
                  </div>
                )}
              </GlassCard>

              {/* Current Participants */}
              <GlassCard className="p-6 sm:p-8">
                <h3 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                  {t('detail.participants_heading', { count: participants.length })}
                </h3>

                {participants.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-12 h-12 text-theme-subtle mx-auto mb-3" />
                    <p className="text-theme-muted text-sm">{t('create.no_participants_yet')}</p>
                    <p className="text-theme-subtle text-xs mt-1">{t('create.add_participants_desc')}</p>
                  </div>
                ) : (
                  <>
                  {splitType === 'weighted' && (
                    <p className="mb-4 text-sm text-theme-muted">{t('inputs.effort_hint')}</p>
                  )}
                  {/* Giving time */}
                  {providers.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-sm font-medium text-theme-success mb-2">
                        {t('roles.giving_count', { count: providers.length })}
                      </h4>
                      <div className="space-y-2">
                        {providers.map((p) => (
                          <ParticipantRow
                            key={p.user_id}
                            participant={p}
                            splitType={splitType}
                            onRemove={() => removeParticipant(p.user_id)}
                            onHoursChange={(h) => updateParticipantHours(p.user_id, h)}
                            onWeightChange={(w) => updateParticipantWeight(p.user_id, w)}
                            inputClassNames={inputClassNames}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Receiving time */}
                  {receivers.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-theme-warning mb-2">
                        {t('roles.receiving_count', { count: receivers.length })}
                      </h4>
                      <div className="space-y-2">
                        {receivers.map((p) => (
                          <ParticipantRow
                            key={p.user_id}
                            participant={p}
                            splitType={splitType}
                            onRemove={() => removeParticipant(p.user_id)}
                            onHoursChange={(h) => updateParticipantHours(p.user_id, h)}
                            onWeightChange={(w) => updateParticipantWeight(p.user_id, w)}
                            inputClassNames={inputClassNames}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  </>
                )}
              </GlassCard>

              {/* Validation message */}
              {!canProceedStep2 && participants.length > 0 && (
                <div className="text-center text-sm text-theme-warning">
                  {t('create.validation_min_participants')}
                </div>
              )}

              {/* Navigation */}
              <StepNavigation
                onBack={goBack}
                onNext={goNext}
                isNextDisabled={!canProceedStep2}
              />
            </div>
          )}

          {/* ─── Step 3: Review Split ─── */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <GlassCard className="p-6 sm:p-8">
                <h2 className="text-lg font-semibold text-theme-primary mb-2 flex items-center gap-2">
                  <Scale className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                  {t('summary.heading')}
                </h2>
                <p className="text-theme-muted text-sm mb-6">
                  {t('create.hour_split_preview_desc')}
                </p>

                <PreviewSummary
                  status={previewStatus}
                  preview={preview}
                  onRetry={() => setPreviewAttempt((n) => n + 1)}
                />
              </GlassCard>

              <StepNavigation
                onBack={goBack}
                onNext={goNext}
                nextLabel={t('create.review')}
                isNextDisabled={previewStatus === 'loading'}
              />
            </div>
          )}

          {/* ─── Step 4: Confirm and Create ─── */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <GlassCard className="p-6 sm:p-8">
                <h2 className="text-lg font-semibold text-theme-primary mb-2 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  {t('create.review_your_exchange')}
                </h2>
                <p className="text-theme-muted text-sm mb-6">
                  {t('create.review_your_exchange_desc')}
                </p>

                <div className="space-y-4">
                  {/* Title & Description */}
                  <div>
                    <h3 className="text-sm font-medium text-theme-muted mb-1">{t('create.title_label')}</h3>
                    <p className="text-theme-primary font-semibold">{title}</p>
                  </div>

                  {description && (
                    <div>
                      <h3 className="text-sm font-medium text-theme-muted mb-1">{t('create.description_heading')}</h3>
                      <p className="text-theme-primary">{description}</p>
                    </div>
                  )}

                  <Separator />

                  {/* Kind & people */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-sm font-medium text-theme-muted mb-1">{t('create.kind_label')}</h3>
                      <Chip size="sm" variant="flat" color="primary">{t('kinds.' + splitType + '.title')}</Chip>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-theme-muted mb-1">{t('create.participants_label')}</h3>
                      <p className="text-theme-primary font-semibold">{participants.length}</p>
                    </div>
                  </div>

                  <Separator />

                  {/* What everyone will earn or pay */}
                  <div>
                    <h3 className="text-sm font-medium text-theme-muted mb-2">{t('summary.heading')}</h3>
                    <PreviewSummary
                      status={previewStatus}
                      preview={preview}
                      onRetry={() => setPreviewAttempt((n) => n + 1)}
                    />
                  </div>
                </div>
              </GlassCard>

              {/* Action buttons */}
              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="light"
                  className="text-theme-muted"
                  onPress={goBack}
                  startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('create.back')}
                </Button>
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                  onPress={handleCreate}
                  isLoading={isSubmitting}
                  isDisabled={!canCreate}
                  startContent={!isSubmitting && <CheckCircle className="w-5 h-5" aria-hidden="true" />}
                >
                  {t('create.create_exchange')}
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface ParticipantRowProps {
  participant: Participant;
  splitType: SplitType;
  onRemove: () => void;
  onHoursChange: (hours: number) => void;
  onWeightChange: (weight: number) => void;
  inputClassNames: Record<string, string>;
}

function ParticipantRow({ participant, splitType, onRemove, onHoursChange, onWeightChange, inputClassNames }: ParticipantRowProps) {
  const { t } = useTranslation('group_exchanges');
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-theme-elevated">
      <Avatar
        src={resolveAvatarUrl(participant.avatar)}
        name={participant.name}
        size="sm"
        className="shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-theme-primary text-sm truncate">{participant.name}</p>
        <Chip
          size="sm"
          variant="flat"
          color={participant.role === 'provider' ? 'success' : 'warning'}
        >
          {participant.role === 'provider' ? t('roles.giving') : t('roles.receiving')}
        </Chip>
      </div>

      {/* Own hours: workshop and custom for everyone, team for helpers only */}
      {entersOwnHours(splitType, participant.role) && (
        <NumberField
          value={participant.hours > 0 ? participant.hours : NaN}
          onChange={(v) => onHoursChange(v === undefined || Number.isNaN(v) ? 0 : v)}
          minValue={0}
          step={0.25}
          formatOptions={{ maximumFractionDigits: 2 }}
          className="w-28 shrink-0"
          aria-label={t('create.hours_for', { name: participant.name })}
        >
          <NumberField.Group className={inputClassNames.inputWrapper}>
            <NumberField.Input className={inputClassNames.input} placeholder={t('create.hours_placeholder')} />
            <span className="pr-2 text-theme-subtle text-xs">{t('create.hours_suffix')}</span>
          </NumberField.Group>
        </NumberField>
      )}

      {/* Share of the effort */}
      {splitType === 'weighted' && (
        <NumberField
          value={participant.weight > 0 ? participant.weight : NaN}
          onChange={(v) => onWeightChange(v === undefined || Number.isNaN(v) ? 0 : v)}
          minValue={0.1}
          step={0.1}
          formatOptions={{ maximumFractionDigits: 2 }}
          className="w-28 shrink-0"
          aria-label={t('inputs.effort_label', { name: participant.name })}
        >
          <NumberField.Group className={inputClassNames.inputWrapper}>
            <NumberField.Input className={inputClassNames.input} placeholder={t('create.weight_placeholder')} />
            <span className="pr-2 text-theme-subtle text-xs">{t('create.weight_suffix')}</span>
          </NumberField.Group>
        </NumberField>
      )}

      <Button
        isIconOnly
        size="sm"
        variant="flat"
        className="bg-red-500/20 text-red-400 shrink-0"
        onPress={onRemove}
        aria-label={t('detail.remove_participant', { name: participant.name })}
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}

/**
 * What everyone will earn or pay, exactly as the server worked it out. This
 * component only displays the answer; it never does arithmetic.
 */
interface PreviewSummaryProps {
  status: PreviewStatus;
  preview: PreviewResult | null;
  onRetry: () => void;
}

function PreviewSummary({ status, preview, onRetry }: PreviewSummaryProps) {
  const { t } = useTranslation('group_exchanges');

  if (status === 'error') {
    return (
      <Alert
        color="danger"
        role="alert"
        description={t('summary.unavailable')}
        endContent={(
          <Button size="sm" variant="flat" onPress={onRetry}>
            {t('try_again')}
          </Button>
        )}
      />
    );
  }

  if (status !== 'ready' || !preview) {
    return (
      <div role="status" aria-busy="true" className="flex items-center gap-3 text-sm text-theme-muted">
        <Spinner size="sm" />
        <span>{t('summary.checking')}</span>
      </div>
    );
  }

  const hoursText = (hours: number) => t('hours_count', { count: roundHours(Number(hours)) });
  const fund = roundHours(Number(preview.community_fund_hours) || 0);
  const totals = {
    paid: hoursText(preview.totals.paid),
    earned: hoursText(preview.totals.earned),
  };

  return (
    <div className="space-y-4">
      {preview.problem && (
        <Alert color="danger" role="alert" description={preview.problem.message} />
      )}

      <ul className="space-y-2">
        {preview.lines.map((line) => (
          <li
            key={`${line.user_id}-${line.role}`}
            className={`rounded-xl bg-theme-elevated p-3 text-sm font-medium ${
              line.role === 'provider'
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            {t(line.role === 'provider' ? 'summary.earns' : 'summary.pays', {
              name: line.name || t('summary.unknown_member'),
              hours: hoursText(line.hours),
            })}
          </li>
        ))}
        {fund > 0 && (
          <li className="rounded-xl bg-accent/10 p-3 text-sm font-medium text-theme-primary">
            {t('summary.to_fund', { count: fund })}
          </li>
        )}
      </ul>

      <p className="text-sm text-theme-muted">
        {fund > 0
          ? t('summary.totals_with_fund', { ...totals, fund: hoursText(fund) })
          : t('summary.totals', totals)}
      </p>
    </div>
  );
}

interface StepNavigationProps {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  isLoading?: boolean;
  isNextDisabled?: boolean;
}

function StepNavigation({ onBack, onNext, nextLabel, isLoading, isNextDisabled }: StepNavigationProps) {
  const { t } = useTranslation('group_exchanges');
  return (
    <div className="flex items-center justify-between">
      <Button
        variant="light"
        className="text-theme-muted"
        onPress={onBack}
        startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
      >
        {t('create.back')}
      </Button>
      <Button
        className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
        endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
        onPress={onNext}
        isLoading={isLoading}
        isDisabled={isNextDisabled}
      >
        {nextLabel || t('create.next')}
      </Button>
    </div>
  );
}

export default CreateGroupExchangePage;
