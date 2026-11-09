// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { NumberField } from '@/components/ui/NumberField';
import { Progress } from '@/components/ui/Progress';
import { Select, SelectItem } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
/**
 * Employer Onboarding Wizard - Guided first-time setup for employers.
 *
 * Multi-step wizard: Welcome -> Organization Profile -> Post First Job -> Success
 * Progress is persisted in localStorage so it survives page reloads.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import Briefcase from 'lucide-react/icons/briefcase';
import Building2 from 'lucide-react/icons/building-2';
import Rocket from 'lucide-react/icons/rocket';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import ArrowRight from 'lucide-react/icons/arrow-right';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Lightbulb from 'lucide-react/icons/lightbulb';
import Globe from 'lucide-react/icons/globe';
import DollarSign from 'lucide-react/icons/dollar-sign';
import MapPin from 'lucide-react/icons/map-pin';
import Clock from 'lucide-react/icons/clock';
import Tag from 'lucide-react/icons/tag';
import Star from 'lucide-react/icons/star';
import { useTranslation } from 'react-i18next';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { safeLocalStorageGet, safeLocalStorageSetJSON, safeLocalStorageRemove } from '@/lib/safeStorage';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';

const STORAGE_KEY = 'nexus_employer_onboarding';
const TOTAL_STEPS = 4;

const JOB_TYPES = ['paid', 'volunteer', 'timebank'] as const;
const COMMITMENT_TYPES = ['full_time', 'part_time', 'flexible', 'one_off'] as const;

interface WizardState {
  step: number;
  orgName: string;
  orgTagline: string;
  orgSize: string;
  orgWebsite: string;
  jobTitle: string;
  jobDescription: string;
  jobType: string;
  jobCommitment: string;
  jobLocation: string;
  jobIsRemote: boolean;
  jobSkills: string;
  jobDeadline: string;
  jobSalaryMin: string;
  jobSalaryMax: string;
  jobSalaryCurrency: string;
  jobSalaryNegotiable: boolean;
  createdJobId: number | null;
}

const INITIAL_STATE: WizardState = {
  step: 0,
  orgName: '',
  orgTagline: '',
  orgSize: '',
  orgWebsite: '',
  jobTitle: '',
  jobDescription: '',
  jobType: 'paid',
  jobCommitment: 'flexible',
  jobLocation: '',
  jobIsRemote: false,
  jobSkills: '',
  jobDeadline: '',
  jobSalaryMin: '',
  jobSalaryMax: '',
  jobSalaryCurrency: '',
  jobSalaryNegotiable: false,
  createdJobId: null,
};

const stepVariants = {
  enter: { opacity: 0, x: 40 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -40 },
};

export function EmployerOnboardingPage() {
  const { t } = useTranslation('jobs');
  usePageTitle(t('onboarding.title'));
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [state, setState] = useState<WizardState>(() => {
    try {
      const saved = safeLocalStorageGet(STORAGE_KEY);
      if (saved) {
        return { ...INITIAL_STATE, ...JSON.parse(saved) };
      }
    } catch {
      // ignore
    }
    return INITIAL_STATE;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Persist state to localStorage
  useEffect(() => {
    safeLocalStorageSetJSON(STORAGE_KEY, state);
  }, [state]);

  const updateState = useCallback((updates: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const goNext = useCallback(() => {
    setState((prev) => ({ ...prev, step: Math.min(prev.step + 1, TOTAL_STEPS - 1) }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => ({ ...prev, step: Math.max(prev.step - 1, 0) }));
  }, []);

  const handlePostJob = async () => {
    setErrors({});

    if (!state.jobTitle.trim()) {
      setErrors({ jobTitle: t('form.validation.title_required') });
      return;
    }
    if (!state.jobDescription.trim()) {
      setErrors({ jobDescription: t('form.validation.description_required') });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        title: state.jobTitle.trim(),
        description: state.jobDescription.trim(),
        type: state.jobType,
        commitment: state.jobCommitment,
        location: state.jobLocation || null,
        is_remote: state.jobIsRemote,
        skills_required: state.jobSkills || null,
        deadline: state.jobDeadline || null,
      };

      if (state.jobSalaryMin) payload.salary_min = parseFloat(state.jobSalaryMin.replace(/[,\s]/g, ''));
      if (state.jobSalaryMax) payload.salary_max = parseFloat(state.jobSalaryMax.replace(/[,\s]/g, ''));
      if (state.jobSalaryCurrency) payload.salary_currency = state.jobSalaryCurrency;
      payload.salary_negotiable = state.jobSalaryNegotiable;

      const response = await api.post<{ id: number }>('/v2/jobs', payload);
      if (response.success && response.data) {
        const jobId = response.data.id;
        updateState({ createdJobId: jobId, step: 3 });
        safeLocalStorageRemove(STORAGE_KEY);
        toast.success(t('form.create_success'));
      } else {
        toast.error(response.error || t('form.create_error'));
      }
    } catch (err) {
      logError('Failed to create job from onboarding', err);
      toast.error(t('form.create_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinish = () => {
    safeLocalStorageRemove(STORAGE_KEY);
    navigate(tenantPath('/jobs'));
  };

  const progressPercentage = ((state.step + 1) / TOTAL_STEPS) * 100;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageMeta title={t('page_meta.employer_onboarding.title')} noIndex />
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to={tenantPath('/jobs')}
          className="inline-flex items-center gap-2 text-theme-muted hover:text-theme-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {t('detail.browse_vacancies')}
        </Link>
      </div>

      {/* Progress */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-2 text-sm text-theme-muted">
          <span>{t(`onboarding.step_${['welcome', 'organization', 'first_job', 'success'][state.step]}`)}</span>
          <span>{state.step + 1} / {TOTAL_STEPS}</span>
        </div>
        <Progress
          value={progressPercentage}
          color="primary"
          className="max-w-full"
          aria-label={t('onboarding.aria_progress')}
        />
      </GlassCard>

      {/* Step Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={state.step}
          variants={stepVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.25 }}
        >
          {state.step === 0 && (
            <StepWelcome onNext={goNext} />
          )}
          {state.step === 1 && (
            <StepOrganization
              state={state}
              user={user}
              onChange={updateState}
              onNext={goNext}
              onBack={goBack}
            />
          )}
          {state.step === 2 && (
            <StepPostJob
              state={state}
              errors={errors}
              isSubmitting={isSubmitting}
              onChange={updateState}
              onSubmit={handlePostJob}
              onBack={goBack}
            />
          )}
          {state.step === 3 && (
            <StepSuccess
              state={state}
              tenantPath={tenantPath}
              onFinish={handleFinish}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// Step 1: Welcome
function StepWelcome({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation('jobs');

  return (
    <GlassCard className="p-8 text-center space-y-6">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 flex items-center justify-center mx-auto">
        <Rocket className="w-10 h-10 text-accent" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-2xl font-bold text-theme-primary mb-3">
          {t('onboarding.welcome_title')}
        </h1>
        <p className="text-theme-muted max-w-md mx-auto leading-relaxed">
          {t('onboarding.welcome_desc')}
        </p>
      </div>
      <Button
        className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
        size="lg"
        endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
        onPress={onNext}
      >
        {t('onboarding.get_started')}
      </Button>
    </GlassCard>
  );
}

// Step 2: Organization Profile
interface OnboardingUser {
  id: number;
  organization_name?: string;
  organization?: { id?: number; name?: string } | null;
}

interface StepOrgProps {
  state: WizardState;
  user: OnboardingUser | null;
  onChange: (updates: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

function StepOrganization({ state, user, onChange, onNext, onBack }: StepOrgProps) {
  const { t } = useTranslation('jobs');

  // Check if user has a linked organization
  const hasOrg = user?.organization?.id;

  return (
    <GlassCard className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
          <Building2 className="w-6 h-6 text-blue-400" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-theme-primary">{t('onboarding.org_title')}</h2>
          <p className="text-sm text-theme-muted">{t('onboarding.org_desc')}</p>
        </div>
      </div>

      {hasOrg ? (
        <div className="p-4 rounded-lg bg-success/5 border border-success/20">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-success" aria-hidden="true" />
            <div>
              <p className="font-medium text-theme-primary">{user?.organization?.name}</p>
              <p className="text-sm text-theme-muted">{t('onboarding.org_linked')}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Input
            label={t('onboarding.org_name')}
            placeholder={t('onboarding.org_name_placeholder')}
            value={state.orgName}
            onValueChange={(v) => onChange({ orgName: v })}
            classNames={{
              input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
              inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
            }}
          />
          <Input
            label={t('onboarding.org_tagline')}
            placeholder={t('onboarding.org_tagline_placeholder')}
            value={state.orgTagline}
            onValueChange={(v) => onChange({ orgTagline: v })}
            classNames={{
              input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
              inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
            }}
          />
          <Select
            label={t('onboarding.org_size')}
            placeholder={t('onboarding.org_size_placeholder')}
            selectedKeys={state.orgSize ? [state.orgSize] : []}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as string;
              onChange({ orgSize: val });
            }}
            classNames={{
              trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              value: 'text-theme-primary',
            }}
          >
            <SelectItem key="1-10" id="1-10">{t('onboarding.org_size_1_10')}</SelectItem>
            <SelectItem key="11-50" id="11-50">{t('onboarding.org_size_11_50')}</SelectItem>
            <SelectItem key="51-200" id="51-200">{t('onboarding.org_size_51_200')}</SelectItem>
            <SelectItem key="201+" id="201+">{t('onboarding.org_size_201_plus')}</SelectItem>
          </Select>
          <Input
            label={t('onboarding.org_website')}
            placeholder={t('onboarding.org_website_placeholder')}
            value={state.orgWebsite}
            onValueChange={(v) => onChange({ orgWebsite: v })}
            startContent={<Globe className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            classNames={{
              input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
              inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
            }}
          />
        </div>
      )}

      <div className="flex justify-between">
        <Button
          variant="flat"
          className="bg-theme-elevated text-theme-muted"
          startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
          onPress={onBack}
        >
          {t('onboarding.back')}
        </Button>
        <div className="flex gap-2">
          <Button
            variant="light"
            className="text-theme-muted"
            onPress={onNext}
          >
            {t('onboarding.skip')}
          </Button>
          <Button
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
            endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
            onPress={onNext}
          >
            {t('onboarding.next')}
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}

// Step 3: Post Your First Job
interface StepJobProps {
  state: WizardState;
  errors: Record<string, string>;
  isSubmitting: boolean;
  onChange: (updates: Partial<WizardState>) => void;
  onSubmit: () => void;
  onBack: () => void;
}

function StepPostJob({ state, errors, isSubmitting, onChange, onSubmit, onBack }: StepJobProps) {
  const { t } = useTranslation('jobs');

  return (
    <GlassCard className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
          <Briefcase className="w-6 h-6 text-green-400" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-theme-primary">{t('onboarding.job_title')}</h2>
          <p className="text-sm text-theme-muted">{t('onboarding.job_desc')}</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Title */}
        <Input
          label={t('form.title_label')}
          placeholder={t('form.title_placeholder')}
          value={state.jobTitle}
          onValueChange={(v) => onChange({ jobTitle: v })}
          isInvalid={!!errors.jobTitle}
          errorMessage={errors.jobTitle}
          isRequired
          classNames={{
            input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
            inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
          }}
        />

        {/* Description */}
        <Textarea
          label={t('form.description_label')}
          placeholder={t('form.description_placeholder')}
          value={state.jobDescription}
          onValueChange={(v) => onChange({ jobDescription: v })}
          isInvalid={!!errors.jobDescription}
          errorMessage={errors.jobDescription}
          isRequired
          minRows={4}
          classNames={{
            input: 'bg-transparent text-theme-primary',
            inputWrapper: 'bg-theme-elevated border-theme-default',
          }}
        />

        {/* Type & Commitment */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label={t('form.type_label')}
            selectedKeys={[state.jobType]}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as string;
              onChange({ jobType: val });
            }}
            classNames={{
              trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              value: 'text-theme-primary',
            }}
          >
            {JOB_TYPES.map((type) => (
              <SelectItem key={type} id={type}>{t(`type.${type}`)}</SelectItem>
            ))}
          </Select>

          <Select
            label={t('form.commitment_label')}
            selectedKeys={[state.jobCommitment]}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as string;
              onChange({ jobCommitment: val });
            }}
            classNames={{
              trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              value: 'text-theme-primary',
            }}
          >
            {COMMITMENT_TYPES.map((c) => (
              <SelectItem key={c} id={c}>{t(`commitment.${c}`)}</SelectItem>
            ))}
          </Select>
        </div>

        {/* Location */}
        <div className="flex items-center gap-4">
          <Input
            label={t('form.location_label')}
            placeholder={t('form.location_placeholder')}
            value={state.jobLocation}
            onValueChange={(v) => onChange({ jobLocation: v })}
            startContent={<MapPin className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            className="flex-1"
            classNames={{
              input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
              inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
            }}
          />
          <Switch
            isSelected={state.jobIsRemote}
            onValueChange={(v) => onChange({ jobIsRemote: v })}
            size="sm"
          >
            <span className="text-sm text-theme-muted">{t('remote')}</span>
          </Switch>
        </div>

        {/* Skills */}
        <Input
          label={t('form.skills_label')}
          placeholder={t('form.skills_placeholder')}
          description={t('form.skills_hint')}
          value={state.jobSkills}
          onValueChange={(v) => onChange({ jobSkills: v })}
          startContent={<Tag className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
          classNames={{
            input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
            inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
          }}
        />

        {/* Deadline */}
        <Input
          label={t('form.deadline_label')}
          type="date"
          value={state.jobDeadline}
          onValueChange={(v) => onChange({ jobDeadline: v })}
          startContent={<Clock className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
          classNames={{
            input: 'bg-transparent text-theme-primary',
            inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
          }}
        />

        {/* Salary */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-theme-subtle" aria-hidden="true" />
            <span className="text-sm font-medium text-theme-primary">{t('form.salary_section')}</span>
          </div>
          <p className="text-xs text-theme-muted">{t('onboarding.salary_hint')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <NumberField
              fullWidth
              minValue={0}
              value={state.jobSalaryMin ? Number(state.jobSalaryMin) : undefined}
              onChange={(v) => onChange({ jobSalaryMin: v === undefined ? '' : String(v) })}
            >
              <Label className="text-theme-primary">{t('form.salary_min_label')}</Label>
              <NumberField.Group className="bg-theme-elevated border-theme-default hover:bg-theme-hover">
                <NumberField.DecrementButton />
                <NumberField.Input className="bg-transparent text-theme-primary" />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
            <NumberField
              fullWidth
              minValue={0}
              value={state.jobSalaryMax ? Number(state.jobSalaryMax) : undefined}
              onChange={(v) => onChange({ jobSalaryMax: v === undefined ? '' : String(v) })}
            >
              <Label className="text-theme-primary">{t('form.salary_max_label')}</Label>
              <NumberField.Group className="bg-theme-elevated border-theme-default hover:bg-theme-hover">
                <NumberField.DecrementButton />
                <NumberField.Input className="bg-transparent text-theme-primary" />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
            <Input
              label={t('form.salary_currency_label')}
              placeholder={t('form.salary_currency_placeholder')}
              value={state.jobSalaryCurrency}
              onValueChange={(v) => onChange({ jobSalaryCurrency: v })}
              classNames={{
                input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              }}
            />
          </div>
          <Switch
            isSelected={state.jobSalaryNegotiable}
            onValueChange={(v) => onChange({ jobSalaryNegotiable: v })}
            size="sm"
          >
            <span className="text-sm text-theme-muted">{t('form.salary_negotiable_label')}</span>
          </Switch>
        </div>
      </div>

      <div className="flex justify-between">
        <Button
          variant="flat"
          className="bg-theme-elevated text-theme-muted"
          startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
          onPress={onBack}
        >
          {t('onboarding.back')}
        </Button>
        <Button
          className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
          onPress={onSubmit}
          isLoading={isSubmitting}
        >
          {isSubmitting ? t('onboarding.posting') : t('onboarding.post_job')}
        </Button>
      </div>
    </GlassCard>
  );
}

// Step 4: Success
interface StepSuccessProps {
  state: WizardState;
  tenantPath: (path: string) => string;
  onFinish: () => void;
}

function StepSuccess({ state, tenantPath, onFinish }: StepSuccessProps) {
  const { t } = useTranslation('jobs');

  return (
    <GlassCard className="p-8 text-center space-y-6">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center mx-auto">
        <CheckCircle className="w-10 h-10 text-green-400" aria-hidden="true" />
      </div>

      <div>
        <h2 className="text-2xl font-bold text-theme-primary mb-2">
          {t('onboarding.success_title')}
        </h2>
        <p className="text-theme-muted max-w-md mx-auto">
          {t('onboarding.success_desc')}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        {state.createdJobId && (
          <Button as={Link} to={tenantPath(`/jobs/${state.createdJobId}`)}
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
            startContent={<Briefcase className="w-4 h-4" aria-hidden="true" />}
          >
            {t('onboarding.view_job')}
          </Button>
        )}
        <Button as={Link} to={tenantPath('/jobs/create')}
          variant="flat"
          className="bg-theme-elevated text-theme-muted"
        >
          {t('onboarding.post_another')}
        </Button>
      </div>

      {/* Tips */}
      <div className="mt-6 text-left">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="w-5 h-5 text-warning" aria-hidden="true" />
          <h3 className="font-semibold text-theme-primary">{t('onboarding.tips_title')}</h3>
        </div>
        <ul className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-theme-muted">
              <Star className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" aria-hidden="true" />
              {t(`onboarding.tip_${i}`)}
            </li>
          ))}
        </ul>
      </div>

      <Button
        variant="flat"
        className="bg-theme-elevated text-theme-muted mt-4"
        onPress={onFinish}
      >
        {t('onboarding.go_to_jobs')}
      </Button>
    </GlassCard>
  );
}

export default EmployerOnboardingPage;
