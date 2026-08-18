// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AG71 — Pilot Region Inquiry & Qualification Funnel
 *
 * Public multi-step form for municipalities to express interest in
 * becoming a Caring Community pilot region.  Converts the "Jetzt Pilotregion
 * werden!" CTA into a real intake pipeline.
 *
 * Steps:
 *   1. Your Municipality — basic details + Caring Community cooperative presence
 *   2. Your Needs       — modules, timeline, budget, existing tool
 *   3. Contact Details  — name, email, phone, role, notes
 *
 * On success the fit-score label is shown (qualitative, no number).
 * POST /v2/pilot-inquiry
 */

import { useState } from 'react';
import { motion, AnimatePresence } from '@/lib/motion';

import MapPin from 'lucide-react/icons/map-pin';
import CheckCircle from 'lucide-react/icons/check-circle';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Star from 'lucide-react/icons/star';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Checkbox, CheckboxGroup } from '@/components/ui/Checkbox';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormState {
  // Step 1 — Municipality
  municipality_name: string;
  region: string;
  country: string;
  population: string;
  has_kiss_cooperative: boolean;
  // Step 2 — Needs
  interest_modules: string[];
  has_existing_digital_tool: boolean;
  existing_tool_name: string;
  timeline_months: string;
  budget_indication: string;
  // Step 3 — Contact
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  contact_role: string;
  notes: string;
}

interface SubmitResult {
  fit_score: number;
  stage: string;
}

const TOTAL_STEPS = 3;

// ─── Step progress indicator ──────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  const { t } = useTranslation('pilot_inquiry');
  return (
    <div className="flex items-center justify-between mb-6">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1;
        const isActive = step === current;
        const isDone   = step < current;
        return (
          <div key={step} className="flex items-center flex-1">
            <div
              className={[
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors',
                isDone  ? 'bg-emerald-500 text-white' :
                isActive ? 'bg-accent text-white' :
                          'bg-theme-elevated text-theme-muted',
              ].join(' ')}
            >
              {isDone ? <CheckCircle className="w-4 h-4" aria-hidden="true" /> : step}
            </div>
            {step < total && (
              <div className={[
                'flex-1 h-1 mx-2 rounded transition-colors',
                step < current ? 'bg-emerald-500' : 'bg-theme-elevated',
              ].join(' ')} />
            )}
          </div>
        );
      })}
      <p className="text-xs text-theme-muted ml-4 whitespace-nowrap">
        {t('step', { current, total })}
      </p>
    </div>
  );
}

// ─── Step labels ─────────────────────────────────────────────────────────────

function StepTitle({ step }: { step: number }) {
  const { t } = useTranslation('pilot_inquiry');
  const labels: Record<number, string> = {
    1: t('steps.municipality'),
    2: t('steps.needs'),
    3: t('steps.contact'),
  };
  return (
    <h2 className="text-lg font-semibold text-theme-primary mb-4">
      {labels[step] ?? ''}
    </h2>
  );
}

// ─── Input class helper ────────────────────────────────────────────────────

const inputClasses = {
  inputWrapper: 'bg-theme-elevated border-theme-default',
  label: 'text-theme-muted',
  input: 'text-theme-primary placeholder:text-theme-subtle',
};

// ─── Main page ────────────────────────────────────────────────────────────────

export function PilotInquiryPage() {
  const { t } = useTranslation('pilot_inquiry');
  const { tenantPath } = useTenant();
  usePageTitle(t('meta.title'));

  const [step, setStep]       = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult]   = useState<SubmitResult | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    municipality_name:       '',
    region:                  '',
    country:                 'CH',
    population:              '',
    has_kiss_cooperative:    false,
    interest_modules:        [],
    has_existing_digital_tool: false,
    existing_tool_name:      '',
    timeline_months:         '',
    budget_indication:       '',
    contact_name:            '',
    contact_email:           '',
    contact_phone:           '',
    contact_role:            '',
    notes:                   '',
  });

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  // ── Validation per step ────────────────────────────────────────────────────

  function canAdvance(): boolean {
    if (step === 1) return form.municipality_name.trim().length > 0;
    if (step === 3) {
      return (
        form.contact_name.trim().length > 0 &&
        form.contact_email.trim().length > 0 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email.trim())
      );
    }
    return true;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        municipality_name:        form.municipality_name.trim(),
        region:                   form.region.trim() || undefined,
        country:                  form.country || 'CH',
        population:               form.population ? parseInt(form.population, 10) : undefined,
        has_kiss_cooperative:     form.has_kiss_cooperative ? 1 : 0,
        interest_modules:         form.interest_modules,
        has_existing_digital_tool: form.has_existing_digital_tool ? 1 : 0,
        existing_tool_name:       form.existing_tool_name.trim() || undefined,
        timeline_months:          form.timeline_months !== '' ? parseInt(form.timeline_months, 10) : undefined,
        budget_indication:        form.budget_indication || undefined,
        contact_name:             form.contact_name.trim(),
        contact_email:            form.contact_email.trim(),
        contact_phone:            form.contact_phone.trim() || undefined,
        contact_role:             form.contact_role.trim() || undefined,
        notes:                    form.notes.trim() || undefined,
        source:                   'website_cta',
      };

      const res = await api.post('/v2/pilot-inquiry', payload);
      const data = ('data' in res ? res.data : res) as { fit_score?: number; stage?: string };
      setResult({ fit_score: data.fit_score ?? 0, stage: data.stage ?? 'new' });
    } catch (err) {
      logError('PilotInquiryPage submit failed', err);
      setError(err instanceof Error ? err.message : t('submitting'));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Fit label ─────────────────────────────────────────────────────────────

  function fitLabel(score: number): { label: string; color: string } {
    if (score >= 60) return { label: t('success_excellent'), color: 'text-emerald-500' };
    if (score >= 40) return { label: t('success_good'),      color: 'text-amber-500' };
    return              { label: t('success_interested'),    color: 'text-accent' };
  }

  // ─── Success state ────────────────────────────────────────────────────────

  if (result) {
    const { label, color } = fitLabel(result.fit_score);
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-12">
        <PageMeta
          title={t('meta.title')}
          description={t('meta.description')} />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard className="p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/20 mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-400" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">
              {t('success_title')}
            </h1>
            <div className={`flex items-center justify-center gap-2 text-lg font-semibold mb-4 ${color}`}>
              <Star className="w-5 h-5" aria-hidden="true" />
              {label}
            </div>
            <p className="text-theme-muted mb-6">{t('success_followup')}</p>
            <Button as={Link} to={tenantPath('/')}
              variant="tertiary"
              className="bg-theme-elevated text-theme-muted"
              startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
            >
              {t('success_back')}
            </Button>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // ─── Form ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
      <PageMeta
        title={t('meta.title')}
        description={t('meta.description')} />

      {/* Hero */}
      <motion.div
        className="text-center mb-8"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-accent/20 to-emerald-500/20 mb-4">
          <MapPin className="w-7 h-7 text-accent" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold text-theme-primary mb-2">
          {t('hero_title')}
        </h1>
        <p className="text-theme-muted">{t('hero_subtitle')}</p>
      </motion.div>

      <GlassCard className="p-5 sm:p-8">
        <StepIndicator current={step} total={TOTAL_STEPS} />
        <StepTitle step={step} />

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 text-theme-danger text-sm" role="alert">
            {error}
          </div>
        )}

        <AnimatePresence mode="wait">
          {/* ── Step 1: Municipality ────────────────────────────────────── */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <Input
                label={t('fields.municipality_name')}
                isRequired
                value={form.municipality_name}
                onValueChange={v => set('municipality_name', v)}
                classNames={inputClasses} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={t('fields.region')}
                  value={form.region}
                  onValueChange={v => set('region', v)}
                  classNames={inputClasses} />
                <Input
                  label={t('fields.country')}
                  value={form.country}
                  onValueChange={v => set('country', v.toUpperCase().slice(0, 2))}
                  maxLength={2}
                  classNames={inputClasses} />
              </div>
              <Input
                label={t('fields.population')}
                type="number"
                value={form.population}
                onValueChange={v => set('population', v)}
                classNames={inputClasses} />
              <div className="flex items-center justify-between p-4 rounded-xl bg-theme-elevated border border-theme-default">
                <span className="text-sm text-theme-primary">
                  {t('fields.has_kiss')}
                </span>
                <Switch
                  isSelected={form.has_kiss_cooperative}
                  onValueChange={v => set('has_kiss_cooperative', v)}
                  size="sm"
                  color="success" />
              </div>
            </motion.div>
          )}

          {/* ── Step 2: Needs ────────────────────────────────────────────── */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <CheckboxGroup
                label={t('fields.modules')}
                value={form.interest_modules}
                onValueChange={v => set('interest_modules', v)}
                classNames={{
                  label: 'text-theme-muted text-sm mb-1',
                }}
              >
                {(['time_banking', 'caring_community', 'local_marketplace', 'municipal_announcements'] as const).map(mod => (
                  <Checkbox key={mod} value={mod} classNames={{ label: 'text-theme-primary text-sm' }}>
                    {t(`modules.${mod}`)}
                  </Checkbox>
                ))}
              </CheckboxGroup>

              <div className="flex items-center justify-between p-4 rounded-xl bg-theme-elevated border border-theme-default">
                <span className="text-sm text-theme-primary">
                  {t('fields.has_existing_tool')}
                </span>
                <Switch
                  isSelected={form.has_existing_digital_tool}
                  onValueChange={v => set('has_existing_digital_tool', v)}
                  size="sm"
                  color="warning" />
              </div>

              {form.has_existing_digital_tool && (
                <Input
                  label={t('fields.existing_tool')}
                  value={form.existing_tool_name}
                  onValueChange={v => set('existing_tool_name', v)}
                  classNames={inputClasses} />
              )}

              <Select
                label={t('fields.timeline')}
                selectedKeys={form.timeline_months !== '' ? [form.timeline_months] : []}
                onSelectionChange={keys => {
                  const val = Array.from(keys)[0] as string | undefined;
                  set('timeline_months', val ?? '');
                }}
                classNames={{
                  trigger: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                  value: 'text-theme-primary',
                }}
              >
                <SelectItem key="0" id="0">{t('timeline_options.asap')}</SelectItem>
                <SelectItem key="6" id="6">{t('timeline_options.6m')}</SelectItem>
                <SelectItem key="12" id="12">{t('timeline_options.1y')}</SelectItem>
                <SelectItem key="24" id="24">{t('timeline_options.2y')}</SelectItem>
                <SelectItem key="99" id="99">{t('timeline_options.explore')}</SelectItem>
              </Select>

              <Select
                label={t('fields.budget')}
                selectedKeys={form.budget_indication ? [form.budget_indication] : []}
                onSelectionChange={keys => {
                  const val = Array.from(keys)[0] as string | undefined;
                  set('budget_indication', val ?? '');
                }}
                classNames={{
                  trigger: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                  value: 'text-theme-primary',
                }}
              >
                <SelectItem key="under_5k" id="under_5k">{t('budget_options.under_5k')}</SelectItem>
                <SelectItem key="5k_10k" id="5k_10k">{t('budget_options.5k_10k')}</SelectItem>
                <SelectItem key="10k_25k" id="10k_25k">{t('budget_options.10k_25k')}</SelectItem>
                <SelectItem key="25k_plus" id="25k_plus">{t('budget_options.25k_plus')}</SelectItem>
                <SelectItem key="unknown" id="unknown">{t('budget_options.unknown')}</SelectItem>
              </Select>
            </motion.div>
          )}

          {/* ── Step 3: Contact ──────────────────────────────────────────── */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <Input
                label={t('fields.contact_name')}
                isRequired
                value={form.contact_name}
                onValueChange={v => set('contact_name', v)}
                classNames={inputClasses} />
              <Input
                type="email"
                label={t('fields.contact_email')}
                isRequired
                value={form.contact_email}
                onValueChange={v => set('contact_email', v)}
                classNames={inputClasses} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  type="tel"
                  label={t('fields.contact_phone')}
                  value={form.contact_phone}
                  onValueChange={v => set('contact_phone', v)}
                  classNames={inputClasses} />
                <Input
                  label={t('fields.contact_role')}
                  value={form.contact_role}
                  onValueChange={v => set('contact_role', v)}
                  classNames={inputClasses} />
              </div>
              <Textarea
                label={t('fields.notes')}
                minRows={3}
                value={form.notes}
                onValueChange={v => set('notes', v)}
                classNames={{
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                  input: 'text-theme-primary placeholder:text-theme-subtle',
                }} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-6 gap-3">
          {step > 1 ? (
            <Button
              variant="tertiary"
              className="bg-theme-elevated text-theme-muted"
              startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
              onPress={() => setStep(s => s - 1)}
            >
              {t('back')}
            </Button>
          ) : (
            <div />
          )}

          {step < TOTAL_STEPS ? (
            <Button
              variant="primary"
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white font-medium"
              endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
              isDisabled={!canAdvance()}
              onPress={() => setStep(s => s + 1)}
            >
              {t('next')}
            </Button>
          ) : (
            <Button
              variant="primary"
              className="bg-gradient-to-r from-accent to-emerald-600 text-white font-medium"
              isLoading={submitting}
              isDisabled={!canAdvance() || submitting}
              spinner={<Spinner size="sm" />}
              onPress={handleSubmit}
            >
              {submitting ? t('submitting') : t('submit')}
            </Button>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

export default PilotInquiryPage;
