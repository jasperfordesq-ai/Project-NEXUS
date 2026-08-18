// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Onboarding Page - Post-registration 5-step wizard
 *
 * Steps:
 *  1. Welcome      - Benefits overview, community introduction
 *  2. Your Profile - Upload profile photo + write bio (MANDATORY — cannot skip)
 *  3. Interests    - Select categories you're interested in (optional — can skip)
 *  4. Skills       - Mark which categories you can offer / need help with (optional)
 *  5. Confirm      - Profile preview + summary + auto-create listings
 *
 * Route: /onboarding
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from '@/lib/motion';

import { Separator } from '@/components/ui/Separator';
import Sparkles from 'lucide-react/icons/sparkles';
import ArrowRight from 'lucide-react/icons/arrow-right';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Heart from 'lucide-react/icons/heart';
import HandHeart from 'lucide-react/icons/hand-heart';
import HelpCircle from 'lucide-react/icons/circle-help';
import Rocket from 'lucide-react/icons/rocket';
import Camera from 'lucide-react/icons/camera';
import UserCircle from 'lucide-react/icons/circle-user';
import Upload from 'lucide-react/icons/upload';
import SkipForward from 'lucide-react/icons/skip-forward';
import PartyPopper from 'lucide-react/icons/party-popper';
import ImagePlus from 'lucide-react/icons/image-plus';
import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import Star from 'lucide-react/icons/star';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { TagGroup, Tag } from '@/components/ui/TagGroup';
import { Textarea } from '@/components/ui/Textarea';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { useOnboardingConfig } from '@/hooks/useOnboardingConfig';
import { useToast, useTenant, useAuth } from '@/contexts';
import { api } from '@/lib/api';
import { AVATAR_UPLOAD_ACCEPT, isAvatarFileTooLarge, isSupportedAvatarFile } from '@/lib/avatarUpload';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl } from '@/lib/helpers';
import { SafeguardingStep } from './SafeguardingStep';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Category {
  id: number;
  name: string;
  slug: string | null;
  color: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function OnboardingPage() {
  const { t } = useTranslation('onboarding');
  usePageTitle(t('page_title'));
  const navigate = useNavigate();
  const { tenantPath, tenant } = useTenant();
  const toast = useToast();
  const { user, refreshUser } = useAuth();

  // ── Admin-configurable onboarding settings ────────────────────────────────
  const { config: onboardingConfig, steps: configSteps, isLoading: configLoading } = useOnboardingConfig();

  // Derive dynamic constants from config (fall back to safe defaults)
  const TOTAL_STEPS = configSteps.length || 5;
  const MIN_BIO_LENGTH = onboardingConfig.bio_min_length || 10;
  const STEP_LABEL_KEYS = configSteps.map(s => `step_${s.slug}`);

  const tenantName = tenant?.branding?.name || tenant?.name || 'our community';

  // ── State ──────────────────────────────────────────────────────────────────

  const [currentStep, setCurrentStep] = useState(1);

  // Map step slugs to 1-based indices for compatibility with existing step rendering
  const stepSlugToIndex = useMemo(() => {
    const map = new Map<string, number>();
    configSteps.forEach((s, i) => map.set(s.slug, i + 1));
    return map;
  }, [configSteps]);

  // Get the slug for the current step number
  const currentStepSlug = configSteps[currentStep - 1]?.slug ?? '';

  // Check if a step is required by slug
  const isStepRequired = useCallback(
    (slug: string) => configSteps.find(s => s.slug === slug)?.required ?? false,
    [configSteps]
  );
  const [slideDirection, setSlideDirection] = useState(1);

  // Focus management for step transitions (accessibility)
  const stepContentRef = useRef<HTMLDivElement>(null);

  // Step 2: Profile photo + bio
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [bio, setBio] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Track whether existing user data has been loaded into wizard state (one-shot)
  const userDataLoaded = useRef(false);

  // Categories loaded from API
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  // Step 3: Selected interest category IDs
  const [selectedInterests, setSelectedInterests] = useState<number[]>([]);

  // Step 4: Skill offers and needs
  const [skillOffers, setSkillOffers] = useState<number[]>([]);
  const [skillNeeds, setSkillNeeds] = useState<number[]>([]);

  // Step 5: Submission + completion
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  // Track which steps have been visited (for stepper). Persisted to sessionStorage
  // so a refresh mid-wizard preserves the indicator's "visited" markers.
  const VISITED_STORAGE_KEY = 'onboarding_visited_steps';
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(() => {
    try {
      const raw = sessionStorage.getItem(VISITED_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(parsed.filter((n) => typeof n === 'number'));
        }
      }
    } catch { /* sessionStorage may be unavailable (private mode) */ }
    return new Set([1]);
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(VISITED_STORAGE_KEY, JSON.stringify(Array.from(visitedSteps)));
    } catch { /* ignore quota/availability errors */ }
  }, [visitedSteps]);

  // Guard against state updates after unmount
  const mountedRef = useRef(true);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Re-arm on every (re)mount: StrictMode runs this cleanup once on its
    // simulated unmount, so a cleanup-only effect would leave the ref false
    // for the component's whole life in dev.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    };
  }, []);

  // ── Redirect if fully completed (onboarding done + has photo + has bio) ───
  // Skip redirect when isComplete is true so the celebration animation plays
  // fully before the setTimeout navigates to dashboard.

  useEffect(() => {
    if (isComplete) return; // Let celebration animation play out
    if (user?.onboarding_completed === true) {
      navigate(tenantPath('/dashboard'), { replace: true });
    }
  }, [user?.onboarding_completed, navigate, tenantPath, isComplete]);

  // ── Pre-populate all wizard fields from existing user data (one-shot on mount) ──
  // Fetches /v2/onboarding/status to get existing interests and skills,
  // and reads bio from the user context. Runs once when user is available.

  useEffect(() => {
    if (userDataLoaded.current || !user) return;
    userDataLoaded.current = true;

    // Pre-fill bio from user context immediately (no extra API call needed)
    if (user.bio) {
      setBio(user.bio);
    }

    // Fetch existing interests/skills to pre-select them in steps 3 & 4
    api.get<{
      onboarding_completed: boolean;
      has_avatar: boolean;
      has_bio: boolean;
      interests: Array<{ category_id: number; interest_type: string }>;
    }>('/v2/onboarding/status').then(response => {
      if (!mountedRef.current || !response.success || !response.data) return;
      const interests = response.data.interests ?? [];
      setSelectedInterests(
        interests
          .filter(i => i.interest_type === 'interest')
          .map(i => i.category_id)
      );
      setSkillOffers(
        interests
          .filter(i => i.interest_type === 'skill_offer')
          .map(i => i.category_id)
      );
      setSkillNeeds(
        interests
          .filter(i => i.interest_type === 'skill_need')
          .map(i => i.category_id)
      );
    }).catch(() => {
      // Non-fatal: wizard still works, just starts with empty selections
    });
     
  }, [user]);

  // ── Move focus to step content on step change (screen reader accessibility) ──

  useEffect(() => {
    // Move focus to step content for screen reader users
    if (stepContentRef.current) {
      stepContentRef.current.focus();
    }
  }, [currentStep]);

  // ── If user already has photo+bio but onboarding_completed is false,
  //    skip ahead to step 3 so they don't re-do profile setup ────────────

  // If user already has photo+bio but onboarding_completed is false,
  // skip ahead past the profile step so they don't re-do it
  const profileStepIdx = stepSlugToIndex.get('profile') ?? 2;
  const nextAfterProfile = profileStepIdx + 1;

  const initialSkipDone = useRef(false);
  useEffect(() => {
    if (
      !initialSkipDone.current &&
      user?.avatar_url &&
      user?.bio &&
      user.bio.trim().length >= MIN_BIO_LENGTH &&
      currentStep <= profileStepIdx
    ) {
      initialSkipDone.current = true;
      setCurrentStep(nextAfterProfile);
      const visited = new Set<number>();
      for (let i = 1; i <= nextAfterProfile; i++) visited.add(i);
      setVisitedSteps(visited);
    }
  }, [user?.avatar_url, user?.bio, currentStep, profileStepIdx, nextAfterProfile, MIN_BIO_LENGTH]);

  // ── Load categories when reaching step 3 ───────────────────────────────

  useEffect(() => {
    if (currentStep >= 3 && categories.length === 0 && !categoriesLoading) {
      loadCategories();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lazy load categories at step 3; loadCategories excluded to avoid loop
  }, [currentStep]);

  const loadCategories = useCallback(async () => {
    try {
      setCategoriesLoading(true);
      const response = await api.get<Category[]>('/v2/onboarding/categories');
      if (response.success && response.data) {
        setCategories(Array.isArray(response.data) ? response.data : []);
      }
    } catch (error) {
      logError('Failed to load onboarding categories', error);
      toast.error(t('toast_categories_failed'), t('toast_try_again'));
    } finally {
      setCategoriesLoading(false);
    }
  }, [toast, t]);

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goToStep = useCallback((step: number) => {
    setSlideDirection(step > currentStep ? 1 : -1);
    setCurrentStep(step);
    setVisitedSteps((prev) => new Set([...prev, step]));
  }, [currentStep]);

  const goNextAnimated = useCallback(() => {
    const next = Math.min(currentStep + 1, TOTAL_STEPS);
    goToStep(next);
  }, [currentStep, goToStep, TOTAL_STEPS]);

  const goBackAnimated = useCallback(() => {
    const prev = Math.max(currentStep - 1, 1);
    goToStep(prev);
  }, [currentStep, goToStep]);

  // ── Avatar upload handler (Step 2) ───────────────────────────────────────

  const processAvatarFile = useCallback(async (file: File) => {
    if (!isSupportedAvatarFile(file)) {
      toast.error(t('toast_invalid_file_type'), t('toast_invalid_file_type_desc'));
      return;
    }

    if (isAvatarFileTooLarge(file)) {
      toast.error(t('toast_file_too_large'), t('toast_file_too_large_desc'));
      return;
    }

    try {
      setIsUploadingAvatar(true);
      const formData = new FormData();
      formData.append('avatar', file);

      const response = await api.upload<{ avatar_url: string }>('/v2/users/me/avatar', formData);
      if (!mountedRef.current) return;

      if (response.success && response.data) {
        await refreshUser();
        if (!mountedRef.current) return;
        toast.success(t('toast_photo_uploaded'), t('toast_photo_uploaded_desc'));
      } else {
        toast.error(t('toast_upload_failed'), response.error || t('toast_upload_failed_desc'));
      }
    } catch (error) {
      logError('Failed to upload avatar during onboarding', error);
      toast.error(t('toast_upload_failed'), t('toast_upload_failed_desc'));
    } finally {
      setIsUploadingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [toast, refreshUser, t]);

  const handleAvatarUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) processAvatarFile(file);
  }, [processAvatarFile]);

  // Drag-and-drop handlers for photo upload
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processAvatarFile(file);
  }, [processAvatarFile]);

  // ── Save bio + proceed handler (Step 2) ──────────────────────────────────

  const handleSaveProfileAndProceed = useCallback(async () => {
    if (!user?.avatar_url) {
      toast.error(t('toast_photo_required'), t('toast_photo_required_desc'));
      return;
    }
    if (bio.trim().length < MIN_BIO_LENGTH) {
      toast.error(t('toast_bio_required'), t('toast_bio_required_desc', { min: MIN_BIO_LENGTH }));
      return;
    }

    try {
      setIsSavingProfile(true);
      const response = await api.put('/v2/users/me', { bio: bio.trim() });
      if (!mountedRef.current) return;

      if (response.success) {
        await refreshUser();
        if (!mountedRef.current) return;
        goNextAnimated();
      } else {
        toast.error(t('toast_save_failed'), response.error || t('toast_save_failed_desc'));
      }
    } catch (error) {
      logError('Failed to save bio during onboarding', error);
      toast.error(t('toast_save_failed'), t('toast_save_failed_desc'));
    } finally {
      setIsSavingProfile(false);
    }
  }, [bio, user?.avatar_url, toast, refreshUser, goNextAnimated, t, MIN_BIO_LENGTH]);

  // ── Save interests + proceed handler (Step 3) ──────────────────────────

  const handleSaveInterestsAndProceed = useCallback(async () => {
    // Interests are saved atomically with skills in /v2/onboarding/complete.
    // Just advance — no separate API call needed.
    goNextAnimated();
  }, [goNextAnimated]);

  // Interest/skill multi-selection (steps 3–4) is handled directly by the
  // TagGroup `onSelectionChange` setters below — no per-item toggle handlers needed.

  // ── Category name lookup ─────────────────────────────────────────────────

  const categoryMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const cat of categories) {
      map.set(cat.id, cat.name);
    }
    return map;
  }, [categories]);

  const getCategoryName = useCallback(
    (id: number) => categoryMap.get(id) || 'Unknown',
    [categoryMap]
  );

  // ── Shared onboarding submission logic ──────────────────────────────────

  const submitOnboarding = useCallback(async (interests: number[], offers: number[], needs: number[]) => {
    try {
      setIsSubmitting(true);

      const response = await api.post('/v2/onboarding/complete', {
        interests,
        offers,
        needs,
      });

      if (!mountedRef.current) return;

      if (!response.success) {
        const message = response.error || t('toast_something_went_wrong');
        if (response.code === 'VALIDATION_REQUIRED_FIELD') {
          toast.error(t('toast_profile_incomplete'), message);
          goToStep(profileStepIdx);
        } else if (response.code === 'SESSION_EXPIRED') {
          navigate(tenantPath('/login'), { replace: true });
        } else {
          toast.error(t('toast_setup_failed'), message);
        }
        return;
      }

      setIsComplete(true);
      await refreshUser();
      if (!mountedRef.current) return;

      completionTimerRef.current = setTimeout(() => {
        toast.success(t('toast_welcome_aboard'), t('toast_profile_all_set'));
        navigate(tenantPath('/dashboard'));
      }, 1800);
    } catch (error) {
      logError('Failed to complete onboarding', error);
      toast.error(t('toast_setup_failed'), t('toast_something_went_wrong'));
    } finally {
      setIsSubmitting(false);
    }
  }, [toast, navigate, tenantPath, refreshUser, goToStep, profileStepIdx, t]);

  // ── Completion handler ───────────────────────────────────────────────────

  const handleComplete = useCallback(async () => {
    await submitOnboarding(selectedInterests, skillOffers, skillNeeds);
  }, [submitOnboarding, selectedInterests, skillOffers, skillNeeds]);

  // ── Skip handler (skips interests/skills — photo+bio already done) ──────

  const handleSkip = useCallback(async () => {
    await submitOnboarding([], [], []);
  }, [submitOnboarding]);

  // ── Animation variants ─────────────────────────────────────────────────

  // Honor prefers-reduced-motion (WCAG 2.3.3 / vestibular accessibility).
  // When reduced motion is requested, we cross-fade instead of horizontal slides
  // and skip the celebration spinning animation entirely.
  const prefersReducedMotion = useReducedMotion();

  const slideVariants = prefersReducedMotion
    ? {
        enter: { opacity: 0 },
        center: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        enter: (direction: number) => ({
          x: direction > 0 ? 60 : -60,
          opacity: 0,
        }),
        center: { x: 0, opacity: 1 },
        exit: (direction: number) => ({
          x: direction < 0 ? 60 : -60,
          opacity: 0,
        }),
      };

  // ── Derived state for Step 2 validation ──────────────────────────────────

  const hasAvatar = !!user?.avatar_url;
  const hasBio = bio.trim().length >= MIN_BIO_LENGTH;
  const profileStepComplete = hasAvatar && hasBio;

  // ── Completion celebration overlay (checked BEFORE redirect guard so the
  //    celebration screen actually renders — refreshUser() sets
  //    onboarding_completed=true which would otherwise cause return null) ───

  if (isComplete) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <motion.div
          initial={prefersReducedMotion ? false : { scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.5, ease: 'easeOut' }}
          className="text-center space-y-6"
        >
          <motion.div
            animate={prefersReducedMotion ? {} : {
              rotate: [0, -10, 10, -10, 10, 0],
              scale: [1, 1.2, 1],
            }}
            transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.8, delay: 0.3 }}
            className="inline-flex p-6 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20"
          >
            <PartyPopper className="w-16 h-16 text-emerald-500" aria-hidden="true" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.4 }}
          >
            <h1 className="text-3xl font-bold text-theme-primary mb-2">
              {t('complete_all_set')}
            </h1>
            <p className="text-theme-muted text-lg">
              {t('complete_welcome_to', { name: tenantName })}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.0 }}
          >
            <div role="status" aria-busy="true" aria-label={t('common:loading')} className="flex justify-center py-4"><Spinner size="sm" color="success" /></div>
            <p className="text-sm text-theme-subtle mt-2">{t('complete_redirecting')}</p>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  // ── Don't render wizard if fully completed (redirect is pending) ─────────

  if (user?.onboarding_completed === true) {
    return null;
  }

  // ── Wait for onboarding config to load ─────────────────────────────────

  if (configLoading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common:loading')} className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  // ── Guard against invalid step (e.g. config removed a step mid-session) ──

  if (!currentStepSlug) {
    goToStep(1);
    return null;
  }

  // ── Main Render ────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-6">
      <PageMeta title={t('page_meta.title')} noIndex />
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <h1 className="text-2xl font-bold text-theme-primary">{t('page_title')}</h1>
        <p className="text-theme-muted mt-1 text-sm">
          {t('subtitle')}
        </p>
      </motion.div>

      {/* Step Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        <StepIndicator
          currentStep={currentStep}
          totalSteps={TOTAL_STEPS}
          visitedSteps={visitedSteps}
          completedSteps={getCompletedSteps({
            hasAvatar,
            hasBio,
            selectedInterests,
            skillOffers,
            skillNeeds,
            stepSlugToIndex,
          })}
          onStepClick={(step) => {
            // Verify step still exists in config
            if (!configSteps[step - 1]?.slug) return;
            // Only allow clicking to visited steps or the current step
            // Never allow skipping step 2 (profile) if incomplete
            if (step <= currentStep || visitedSteps.has(step)) {
              if (step > profileStepIdx && !profileStepComplete) {
                toast.error(t('toast_complete_profile_first'), t('toast_photo_bio_required'));
                goToStep(profileStepIdx);
                return;
              }
              goToStep(step);
            }
          }}
          stepLabelKeys={STEP_LABEL_KEYS}
        />
      </motion.div>

      {/* Step Content */}
      <div ref={stepContentRef} tabIndex={-1} className="outline-none" aria-live="polite" aria-label={t('aria_step_progress', { step: currentStep, total: TOTAL_STEPS })}>
      <AnimatePresence mode="wait" custom={slideDirection}>
        <motion.div
          key={currentStep}
          custom={slideDirection}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          {/* ─── Step 1: Welcome ─── */}
          {currentStepSlug === 'welcome' && (
            <div className="space-y-6">
              <GlassCard className="p-5 text-center sm:p-8">
                <div className="flex items-center justify-center gap-4 mb-6">
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                    className="p-4 rounded-2xl bg-emerald-500/20"
                  >
                    <HandHeart
                      className="w-10 h-10 text-emerald-600 dark:text-emerald-400"
                      aria-hidden="true"
                    />
                  </motion.div>
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut', delay: 0.4 }}
                    className="p-4 rounded-2xl bg-rose-500/20"
                  >
                    <Heart
                      className="w-10 h-10 text-rose-600 dark:text-rose-400"
                      aria-hidden="true"
                    />
                  </motion.div>
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut', delay: 0.8 }}
                    className="p-4 rounded-2xl bg-amber-500/20"
                  >
                    <Sparkles
                      className="w-10 h-10 text-amber-600 dark:text-amber-400"
                      aria-hidden="true"
                    />
                  </motion.div>
                </div>

                <h2 className="text-xl font-bold text-theme-primary mb-2">
                  {t('welcome_title', { name: tenantName })}
                </h2>
                <p className="text-theme-muted max-w-md mx-auto">
                  {t('welcome_description')}
                </p>
              </GlassCard>

              {/* How it works cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <BenefitCard
                  icon={<Clock className="w-6 h-6 text-emerald-500" />}
                  title={t('benefit_earn_title')}
                  description={t('benefit_earn_desc')}
                />
                <BenefitCard
                  icon={<Users className="w-6 h-6 text-rose-500" />}
                  title={t('benefit_community_title')}
                  description={t('benefit_community_desc')}
                />
                <BenefitCard
                  icon={<Star className="w-6 h-6 text-[var(--color-warning)]" />}
                  title={t('benefit_skills_title')}
                  description={t('benefit_skills_desc')}
                />
              </div>

              <div className="flex justify-center pt-2">
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-10 font-semibold shadow-lg shadow-emerald-500/20"
                  endContent={<ArrowRight className="w-5 h-5" aria-hidden="true" />}
                  onPress={goNextAnimated}
                >
                  {t('lets_get_started')}
                </Button>
              </div>
            </div>
          )}

          {/* ─── Step 2: Your Profile (MANDATORY — photo + bio) ─── */}
          {currentStepSlug === 'profile' && (
            <div className="space-y-6">
              <GlassCard className="p-6">
                <h2 className="text-lg font-semibold text-theme-primary mb-1 flex items-center gap-2">
                  <UserCircle
                    className="w-5 h-5 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  {t('profile_title')}
                </h2>
                <p className="text-theme-muted text-sm mb-6">
                  {t('profile_description')}
                </p>

                {/* Avatar upload zone */}
                <div
                  className={`
                    flex flex-col items-center gap-4 mb-6 p-6 rounded-xl border-2 border-dashed transition-all duration-200
                    ${isDraggingOver
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : hasAvatar
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-theme-default bg-theme-elevated/50 hover:border-emerald-500/50'
                    }
                  `}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="relative group">
                    <Avatar
                      key={user?.avatar_url || 'no-avatar'}
                      src={resolveAvatarUrl(user?.avatar_url)}
                      name={user?.first_name || user?.name}
                      className="w-28 h-28 ring-4 ring-theme-default group-hover:ring-emerald-500/30 transition-all"
                      isBordered={hasAvatar}
                      color={hasAvatar ? 'success' : 'default'}
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={AVATAR_UPLOAD_ACCEPT}
                      onChange={handleAvatarUpload}
                      className="hidden"
                      aria-label={t('aria_upload_photo')}
                    />
                    {/* capture forces the OS camera — the plain picker no longer
                        offers one on modern Android (system photo picker). */}
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept={AVATAR_UPLOAD_ACCEPT}
                      capture="user"
                      onChange={handleAvatarUpload}
                      className="hidden"
                      aria-label={t('aria_take_photo')}
                    />
                    <Dropdown placement="bottom-end">
                      <DropdownTrigger>
                        <Button
                          isIconOnly
                          size="sm"
                          className="absolute bottom-1 right-1 rounded-full bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg min-w-0 w-9 h-9"
                          isDisabled={isUploadingAvatar}
                          isLoading={isUploadingAvatar}
                          aria-label={t('aria_upload_photo')}
                        >
                          {hasAvatar ? (
                            <Camera className="w-4 h-4" aria-hidden="true" />
                          ) : (
                            <ImagePlus className="w-4 h-4" aria-hidden="true" />
                          )}
                        </Button>
                      </DropdownTrigger>
                      <DropdownMenu
                        aria-label={t('aria_upload_photo')}
                        onAction={(key) => {
                          if (key === 'camera') cameraInputRef.current?.click();
                          if (key === 'library') fileInputRef.current?.click();
                        }}
                      >
                        <DropdownItem id="camera">{t('take_photo')}</DropdownItem>
                        <DropdownItem id="library">{t('choose_from_library')}</DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  </div>

                  {isUploadingAvatar ? (
                    <p role="status" aria-busy="true" aria-label={t('uploading')} className="text-sm text-theme-muted flex items-center gap-2">
                      <Spinner size="sm" aria-hidden="true" /> {t('uploading')}
                    </p>
                  ) : hasAvatar ? (
                    <div className="text-center">
                      <p className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 justify-center font-medium">
                        <CheckCircle className="w-4 h-4" aria-hidden="true" />
                        {t('photo_uploaded')}
                      </p>
                      <Button
                        variant="tertiary"
                        size="sm"
                        onPress={() => fileInputRef.current?.click()}
                        className="mt-1 min-h-6 min-w-0 p-0 text-xs text-theme-subtle underline hover:text-theme-muted"
                      >
                        {t('change_photo')}
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mb-2"
                        startContent={<Upload className="w-4 h-4" aria-hidden="true" />}
                        onPress={() => fileInputRef.current?.click()}
                      >
                        {t('choose_photo')}
                      </Button>
                      <p className="text-xs text-theme-subtle">
                        {t('photo_drag_hint')}
                      </p>
                    </div>
                  )}
                </div>

                {/* Bio textarea */}
                <div className="space-y-2">
                  <Textarea
                    label={t('bio_label')}
                    placeholder={t('bio_placeholder')}
                    value={bio}
                    onValueChange={setBio}
                    isDisabled={isSavingProfile}
                    minRows={3}
                    maxRows={6}
                    maxLength={5000}
                    description={
                      bio.trim().length < MIN_BIO_LENGTH
                        ? t('bio_min_chars', { min: MIN_BIO_LENGTH, current: bio.trim().length })
                        : t('bio_char_count', { count: bio.trim().length })
                    }
                    classNames={{
                      inputWrapper: 'bg-theme-elevated',
                    }}
                  />
                </div>

                {/* Validation checklist */}
                <div className="mt-4 p-3 rounded-lg bg-theme-elevated">
                  <p className="text-xs font-medium text-theme-muted mb-2">
                    {t('required_to_continue')}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <ValidationItem checked={hasAvatar} label={t('validation_photo')} />
                    <ValidationItem checked={hasBio} label={t('validation_bio', { min: MIN_BIO_LENGTH })} />
                  </div>
                </div>
              </GlassCard>

              {/* Navigation */}
              <div className="flex items-center justify-between">
                <Button
                  variant="tertiary"
                  className="text-theme-muted"
                  onPress={goBackAnimated}
                  startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('back')}
                </Button>
                <Button
                  className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium"
                  endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
                  onPress={handleSaveProfileAndProceed}
                  isLoading={isSavingProfile}
                  isDisabled={!profileStepComplete || isSavingProfile || isUploadingAvatar}
                >
                  {t('next')}
                </Button>
              </div>
            </div>
          )}

          {/* ─── Step 3: Select Interests (OPTIONAL) ─── */}
          {currentStepSlug === 'interests' && (
            <div className="space-y-6">
              <GlassCard className="p-6">
                <h2 className="text-lg font-semibold text-theme-primary mb-1 flex items-center gap-2">
                  <Heart
                    className="w-5 h-5 text-rose-500"
                    aria-hidden="true"
                  />
                  {t('interests_title')}
                </h2>
                <p className="text-theme-muted text-sm mb-6">
                  {t('interests_description')}
                </p>

                {categoriesLoading ? (
                  <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex items-center justify-center py-12">
                    <Spinner size="lg" />
                  </div>
                ) : categories.length === 0 ? (
                  <div className="text-center py-8">
                    <HelpCircle
                      className="w-10 h-10 text-theme-subtle mx-auto mb-2"
                      aria-hidden="true"
                    />
                    <p className="text-theme-muted text-sm">
                      {t('no_categories_available')}
                    </p>
                  </div>
                ) : (
                  <TagGroup
                    aria-label={t('interests_title')}
                    selectionMode="multiple"
                    selectedKeys={new Set(selectedInterests.map(String))}
                    onSelectionChange={(keys) => setSelectedInterests(keys === 'all' ? categories.map((c) => c.id) : Array.from(keys).map(Number))}
                  >
                    <TagGroup.List className="flex flex-wrap gap-2">
                      {categories.map((cat) => (
                        <Tag
                          key={cat.id}
                          id={String(cat.id)}
                          className="data-[selected=true]:bg-emerald-500/20 data-[selected=true]:text-emerald-600 dark:data-[selected=true]:text-emerald-400"
                        >
                          {cat.name}
                        </Tag>
                      ))}
                    </TagGroup.List>
                  </TagGroup>
                )}

                {categories.length > 0 && (
                  <p className="text-xs text-theme-subtle mt-4">
                    {selectedInterests.length === 0
                      ? t('select_or_skip')
                      : t('count_selected', { count: selectedInterests.length })}
                  </p>
                )}
              </GlassCard>

              <div className="flex items-center justify-between">
                <Button
                  variant="tertiary"
                  className="text-theme-muted"
                  onPress={goBackAnimated}
                  startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('back')}
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="tertiary"
                    className="text-theme-subtle"
                    onPress={goNextAnimated}
                    endContent={<SkipForward className="w-4 h-4" aria-hidden="true" />}
                  >
                    {t('skip')}
                  </Button>
                  <Button
                    className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium"
                    endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
                    onPress={handleSaveInterestsAndProceed}
                    isDisabled={categoriesLoading}
                  >
                    {t('next')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Step 4: Your Skills (OPTIONAL — shows ALL categories) ─── */}
          {currentStepSlug === 'skills' && (
            <div className="space-y-6">
              {/* Offers section */}
              <GlassCard className="p-6">
                <h2 className="text-lg font-semibold text-theme-primary mb-1 flex items-center gap-2">
                  <HandHeart
                    className="w-5 h-5 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  {t('skills_offer_title')}
                </h2>
                <p className="text-theme-muted text-sm mb-4">
                  {t('skills_offer_description')}
                </p>

                {categoriesLoading ? (
                  <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex items-center justify-center py-8">
                    <Spinner size="md" />
                  </div>
                ) : categories.length === 0 ? (
                  <p className="text-theme-subtle text-sm py-4">
                    {t('no_categories_skip')}
                  </p>
                ) : (
                  <TagGroup
                    aria-label={t('skills_offer_title')}
                    selectionMode="multiple"
                    selectedKeys={new Set(skillOffers.map(String))}
                    onSelectionChange={(keys) => setSkillOffers(keys === 'all' ? categories.map((c) => c.id) : Array.from(keys).map(Number))}
                  >
                    <TagGroup.List className="flex flex-wrap gap-2">
                      {categories.map((cat) => (
                        <Tag
                          key={cat.id}
                          id={String(cat.id)}
                          className="data-[selected=true]:bg-emerald-500/20 data-[selected=true]:text-emerald-600 dark:data-[selected=true]:text-emerald-400"
                        >
                          {cat.name}
                        </Tag>
                      ))}
                    </TagGroup.List>
                  </TagGroup>
                )}

                {skillOffers.length > 0 && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-3 font-medium">
                    {t('skills_to_offer_count', { count: skillOffers.length })}
                  </p>
                )}
              </GlassCard>

              {/* Needs section */}
              <GlassCard className="p-6">
                <h2 className="text-lg font-semibold text-theme-primary mb-1 flex items-center gap-2">
                  <HelpCircle
                    className="w-5 h-5 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  {t('skills_need_title')}
                </h2>
                <p className="text-theme-muted text-sm mb-4">
                  {t('skills_need_description')}
                </p>

                {categoriesLoading ? (
                  <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex items-center justify-center py-8">
                    <Spinner size="md" />
                  </div>
                ) : categories.length === 0 ? (
                  <p className="text-theme-subtle text-sm py-4">
                    {t('no_categories_skip')}
                  </p>
                ) : (
                  <TagGroup
                    aria-label={t('skills_need_title')}
                    selectionMode="multiple"
                    selectedKeys={new Set(skillNeeds.map(String))}
                    onSelectionChange={(keys) => setSkillNeeds(keys === 'all' ? categories.map((c) => c.id) : Array.from(keys).map(Number))}
                  >
                    <TagGroup.List className="flex flex-wrap gap-2">
                      {categories.map((cat) => (
                        <Tag
                          key={cat.id}
                          id={String(cat.id)}
                          className="data-[selected=true]:bg-amber-500/20 data-[selected=true]:text-amber-600 dark:data-[selected=true]:text-amber-400"
                        >
                          {cat.name}
                        </Tag>
                      ))}
                    </TagGroup.List>
                  </TagGroup>
                )}

                {skillNeeds.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-3 font-medium">
                    {t('skills_needed_count', { count: skillNeeds.length })}
                  </p>
                )}
              </GlassCard>

              <div className="flex items-center justify-between">
                <Button
                  variant="tertiary"
                  className="text-theme-muted"
                  onPress={goBackAnimated}
                  startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('back')}
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="tertiary"
                    className="text-theme-subtle"
                    onPress={goNextAnimated}
                    endContent={<SkipForward className="w-4 h-4" aria-hidden="true" />}
                  >
                    {t('skip')}
                  </Button>
                  <Button
                    className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium"
                    endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
                    onPress={goNextAnimated}
                  >
                    {t('next')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Safeguarding Step (conditional — only when admin enables it) ─── */}
          {currentStepSlug === 'safeguarding' && (
            <SafeguardingStep
              onNext={goNextAnimated}
              onBack={goBackAnimated}
              onSkip={!isStepRequired('safeguarding') ? goNextAnimated : undefined}
              isRequired={isStepRequired('safeguarding')}
              introText={onboardingConfig.safeguarding_intro_text}
            />
          )}

          {/* ─── Confirm + Complete ─── */}
          {currentStepSlug === 'confirm' && (
            <div className="space-y-6">
              {/* Profile preview card */}
              <GlassCard className="p-6">
                <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
                  <CheckCircle
                    className="w-5 h-5 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  {t('confirm_title')}
                </h2>

                {/* Mini profile card */}
                <div className="flex items-start gap-4 p-4 rounded-xl bg-theme-elevated mb-6">
                  <Avatar
                    src={resolveAvatarUrl(user?.avatar_url)}
                    name={user?.first_name || user?.name}
                    className="w-16 h-16 flex-shrink-0"
                    isBordered
                    color="success"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-theme-primary text-base">
                      {user?.first_name} {user?.last_name}
                    </p>
                    <p className="text-sm text-theme-muted line-clamp-2 mt-0.5">
                      {bio || user?.bio || t('no_bio_yet')}
                    </p>
                    <Button
                      variant="tertiary"
                      size="sm"
                      onPress={() => goToStep(profileStepIdx)}
                      className="mt-1 min-h-6 min-w-0 p-0 text-xs text-emerald-600 hover:underline dark:text-emerald-400"
                    >
                      {t('edit_profile')}
                    </Button>
                  </div>
                </div>

                <Separator className="my-4" />

                {/* Interests summary */}
                <div className="space-y-4">
                  <SummarySection
                    icon={<Heart className="w-4 h-4 text-rose-500" />}
                    title={t('summary_interests')}
                    items={selectedInterests}
                    getCategoryName={getCategoryName}
                    chipColor="accent"
                    emptyText={t('none_selected')}
                    onEdit={() => goToStep(stepSlugToIndex.get('interests') ?? 3)}
                  />

                  <Separator />

                  <SummarySection
                    icon={<HandHeart className="w-4 h-4 text-emerald-500" />}
                    title={t('summary_offers')}
                    items={skillOffers}
                    getCategoryName={getCategoryName}
                    chipColor="success"
                    emptyText={t('none_selected')}
                    onEdit={() => goToStep(stepSlugToIndex.get('skills') ?? 4)}
                  />

                  <Separator />

                  <SummarySection
                    icon={<HelpCircle className="w-4 h-4 text-[var(--color-warning)]" />}
                    title={t('summary_needs')}
                    items={skillNeeds}
                    getCategoryName={getCategoryName}
                    chipColor="warning"
                    emptyText={t('none_selected')}
                    onEdit={() => goToStep(stepSlugToIndex.get('skills') ?? 4)}
                  />
                </div>
              </GlassCard>

              {/* Action buttons */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  variant="tertiary"
                  className="text-theme-muted"
                  onPress={goBackAnimated}
                  startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('back')}
                </Button>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Button
                    variant="tertiary"
                    className="text-theme-subtle"
                    onPress={handleSkip}
                    isDisabled={isSubmitting}
                    endContent={<SkipForward className="w-4 h-4" aria-hidden="true" />}
                  >
                    {t('skip_for_now')}
                  </Button>
                  <Button
                    size="lg"
                    className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold shadow-lg shadow-emerald-500/20"
                    onPress={handleComplete}
                    isLoading={isSubmitting}
                    isDisabled={isSubmitting}
                    startContent={
                      !isSubmitting && (
                        <Rocket className="w-5 h-5" aria-hidden="true" />
                      )
                    }
                  >
                    {t('finish')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: determine which steps are "completed" for the stepper
// ─────────────────────────────────────────────────────────────────────────────

function getCompletedSteps(state: {
  hasAvatar: boolean;
  hasBio: boolean;
  selectedInterests: number[];
  skillOffers: number[];
  skillNeeds: number[];
  stepSlugToIndex: Map<string, number>;
}): Set<number> {
  const completed = new Set<number>();
  const idx = state.stepSlugToIndex;
  const welcomeIdx = idx.get('welcome') ?? 1;
  const profileIdx = idx.get('profile') ?? 2;
  const interestsIdx = idx.get('interests') ?? 3;
  const skillsIdx = idx.get('skills') ?? 4;

  completed.add(welcomeIdx); // Welcome is always "done" once visited
  if (state.hasAvatar && state.hasBio) completed.add(profileIdx);
  if (state.selectedInterests.length > 0) completed.add(interestsIdx);
  if (state.skillOffers.length > 0 || state.skillNeeds.length > 0) completed.add(skillsIdx);
  return completed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

// ── Step Indicator (dots + labels) ───────────────────────────────────────────

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  visitedSteps: Set<number>;
  completedSteps: Set<number>;
  onStepClick: (step: number) => void;
  stepLabelKeys: string[];
}

function StepIndicator({ currentStep, totalSteps, visitedSteps, completedSteps, onStepClick, stepLabelKeys }: StepIndicatorProps) {
  const { t } = useTranslation('onboarding');
  return (
    <div className="-mx-1 flex items-center justify-between overflow-x-auto px-1 pb-1">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isCurrent = step === currentStep;
        const isCompleted = completedSteps.has(step) && !isCurrent;
        const isVisited = visitedSteps.has(step);
        const isClickable = isVisited || step <= currentStep;

        return (
          <div key={step} className="flex min-w-[3rem] items-center flex-1 last:flex-initial">
            {/* Step dot + label */}
            <Button
              variant="ghost"
              onPress={() => isClickable && onStepClick(step)}
              aria-label={t('aria_step', { step, label: t(stepLabelKeys[i] ?? ''), status: isCompleted ? t('aria_completed') : isCurrent ? t('aria_current') : '' })}
              aria-current={isCurrent ? 'step' : undefined}
              isDisabled={!isClickable}
              className={`
                flex min-h-14 min-w-0 flex-col items-center gap-1 p-0 transition-all
                ${isClickable ? 'cursor-pointer' : 'cursor-default'}
              `}
            >
              <div
                className={`
                  w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 shrink-0
                  ${isCurrent
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30 scale-110'
                    : isCompleted
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      : 'bg-theme-elevated text-theme-subtle'
                  }
                `}
              >
                {isCompleted ? (
                  <CheckCircle className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <span>{step}</span>
                )}
              </div>
              <span
                className={`
                  text-[10px] font-medium hidden sm:block
                  ${isCurrent ? 'text-emerald-600 dark:text-emerald-400' : 'text-theme-subtle'}
                `}
              >
                {t(stepLabelKeys[i] ?? '')}
              </span>
            </Button>

            {/* Connector line */}
            {step < totalSteps && (
              <div className="flex-1 min-w-4 mx-1.5 sm:mx-2">
                <div
                  className={`
                    h-0.5 rounded-full transition-all duration-500
                    ${completedSteps.has(step) && (completedSteps.has(step + 1) || step + 1 === currentStep)
                      ? 'bg-emerald-500'
                      : 'bg-theme-elevated'
                    }
                  `}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Benefit Card ─────────────────────────────────────────────────────────────

interface BenefitCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function BenefitCard({ icon, title, description }: BenefitCardProps) {
  return (
    <GlassCard className="p-5 text-center">
      <div className="flex justify-center mb-3" aria-hidden="true">
        {icon}
      </div>
      <h3 className="font-semibold text-theme-primary text-sm mb-1">{title}</h3>
      <p className="text-xs text-theme-subtle leading-relaxed">{description}</p>
    </GlassCard>
  );
}

// ── Validation Item (checklist) ──────────────────────────────────────────────

function ValidationItem({ checked, label }: { checked: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <CheckCircle
        className={`w-4 h-4 transition-colors ${checked ? 'text-emerald-500' : 'text-theme-subtle'}`}
        aria-hidden="true"
      />
      <span className={checked ? 'text-theme-primary' : 'text-theme-subtle'}>
        {label}
      </span>
    </div>
  );
}

// ── Summary Section (Step 5) ─────────────────────────────────────────────────

interface SummarySectionProps {
  icon: React.ReactNode;
  title: string;
  items: number[];
  getCategoryName: (id: number) => string;
  chipColor: 'accent' | 'success' | 'warning';
  emptyText: string;
  onEdit: () => void;
}

function SummarySection({ icon, title, items, getCategoryName, chipColor, emptyText, onEdit }: SummarySectionProps) {
  const { t } = useTranslation('onboarding');
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-theme-muted flex items-center gap-2">
          {icon}
          {title}
        </h3>
        <Button
          variant="tertiary"
          size="sm"
          onPress={onEdit}
          className="min-h-6 min-w-0 p-0 text-xs text-emerald-600 hover:underline dark:text-emerald-400"
        >
          {t('edit')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.length > 0 ? (
          items.map((catId) => (
            <Chip key={catId} size="sm" variant="soft" color={chipColor}>
              {getCategoryName(catId)}
            </Chip>
          ))
        ) : (
          <p className="text-theme-subtle text-sm italic">{emptyText}</p>
        )}
      </div>
    </div>
  );
}

export default OnboardingPage;
