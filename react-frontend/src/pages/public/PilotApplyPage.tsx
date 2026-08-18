// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AG44 — Self-service tenant provisioning public form.
 *
 * POST /api/v2/provisioning-requests
 * GET  /api/v2/provisioning-requests/check-slug/{slug}
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { motion } from '@/lib/motion';

import Building from 'lucide-react/icons/building';
import Globe from 'lucide-react/icons/globe';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import XCircle from 'lucide-react/icons/x-circle';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Checkbox, CheckboxGroup } from '@/components/ui/Checkbox';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

const COUNTRIES = ['CH', 'DE', 'AT', 'FR', 'IT', 'IE', 'GB', 'US', 'NL', 'BE', 'LU', 'ES', 'PT', 'PL'];
const CATEGORIES = ['kiss_cooperative', 'caring_community', 'community'] as const;
const BUCKETS = ['under_50', '50_250', '250_1000', '1000_5000', '5000_plus'] as const;
const LANGUAGES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'ja', 'ar', 'ga'] as const;

interface FormState {
  applicant_name: string;
  applicant_email: string;
  applicant_phone: string;
  org_name: string;
  country_code: string;
  region_or_canton: string;
  requested_slug: string;
  requested_subdomain: string;
  tenant_category: string;
  languages: string[];
  default_language: string;
  expected_member_count_bucket: string;
  intended_use: string;
}

type SlugState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'unavailable'; reason: string };

// Stable per-mount captcha question
function makeCaptcha(): { a: number; b: number } {
  return { a: 3 + Math.floor(Math.random() * 7), b: 2 + Math.floor(Math.random() * 7) };
}

const inputClasses = {
  inputWrapper: 'bg-theme-elevated border-theme-default',
  label: 'text-theme-muted',
  input: 'text-theme-primary placeholder:text-theme-subtle',
};

export function PilotApplyPage() {
  const { t } = useTranslation('common');
  const { tenantPath } = useTenant();
  usePageTitle(t('provisioning.meta.title'));

  const [form, setForm] = useState<FormState>({
    applicant_name: '',
    applicant_email: '',
    applicant_phone: '',
    org_name: '',
    country_code: 'CH',
    region_or_canton: '',
    requested_slug: '',
    requested_subdomain: '',
    tenant_category: 'community',
    languages: ['en'],
    default_language: 'en',
    expected_member_count_bucket: '',
    intended_use: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [statusToken, setStatusToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slugStatus, setSlugStatus] = useState<SlugState>({ state: 'idle' });

  const captcha = useMemo(makeCaptcha, []);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  // Live slug availability check (debounced)
  useEffect(() => {
    const slug = form.requested_slug.trim().toLowerCase();
    if (slug.length < 3) {
      setSlugStatus({ state: 'idle' });
      return;
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) {
      setSlugStatus({ state: 'unavailable', reason: 'invalid_format' });
      return;
    }
    setSlugStatus({ state: 'checking' });
    const handle = setTimeout(async () => {
      try {
        const res = await api.get(`/v2/provisioning-requests/check-slug/${encodeURIComponent(slug)}`);
        const data = (res && typeof res === 'object' && 'data' in res ? (res as { data: unknown }).data : res) as
          | { available: boolean; reason?: string }
          | undefined;
        if (data && data.available) {
          setSlugStatus({ state: 'available' });
        } else {
          setSlugStatus({ state: 'unavailable', reason: data?.reason ?? 'taken' });
        }
      } catch (err) {
        logError('Slug availability check failed', err);
        setSlugStatus({ state: 'idle' });
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [form.requested_slug]);

  const canSubmit =
    form.applicant_name.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.applicant_email.trim()) &&
    form.org_name.trim().length > 0 &&
    form.requested_slug.trim().length >= 3 &&
    slugStatus.state !== 'unavailable' &&
    slugStatus.state !== 'checking' &&
    form.tenant_category &&
    captchaAnswer.trim().length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    if (parseInt(captchaAnswer, 10) !== captcha.a + captcha.b) {
      setError(t('provisioning.errors.captcha_failed'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        applicant_name: form.applicant_name.trim(),
        applicant_email: form.applicant_email.trim(),
        applicant_phone: form.applicant_phone.trim() || undefined,
        org_name: form.org_name.trim(),
        country_code: form.country_code || 'CH',
        region_or_canton: form.region_or_canton.trim() || undefined,
        requested_slug: form.requested_slug.trim().toLowerCase(),
        requested_subdomain: form.requested_subdomain.trim().toLowerCase() || undefined,
        tenant_category: form.tenant_category,
        languages: form.languages.length > 0 ? form.languages : ['en'],
        default_language: form.default_language || 'en',
        expected_member_count_bucket: form.expected_member_count_bucket || undefined,
        intended_use: form.intended_use.trim() || undefined,
        captcha_token: `${captcha.a}+${captcha.b}=${captchaAnswer.trim()}`,
      };

      const res = await api.post('/v2/provisioning-requests', payload);
      const data = (res && typeof res === 'object' && 'data' in res ? (res as { data: unknown }).data : res) as
        | { status_token?: string }
        | undefined;
      if (data?.status_token) setStatusToken(data.status_token);
      setSubmitted(true);
    } catch (err) {
      logError('PilotApplyPage submit failed', err);
      setError(err instanceof Error ? err.message : t('provisioning.errors.submit_failed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-12">
        <PageMeta title={t('provisioning.meta.title')} description={t('provisioning.meta.description')} />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard className="p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/20 mb-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('provisioning.success_title')}</h1>
            <p className="text-theme-muted mb-6">{t('provisioning.success_body')}</p>
            {statusToken && (
              <p className="text-xs text-theme-subtle mb-6 break-all">
                <Link to={tenantPath(`/pilot-apply/status/${statusToken}`)} className="text-accent hover:underline">
                  {t('provisioning.status_title')}
                </Link>
              </p>
            )}
            <Button as={Link} to={tenantPath('/')}
              variant="tertiary"
              className="bg-theme-elevated text-theme-muted"
              startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
            >
              {t('provisioning.success_back')}
            </Button>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
      <PageMeta title={t('provisioning.meta.title')} description={t('provisioning.meta.description')} />

      <motion.div className="text-center mb-8" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-accent/20 to-emerald-500/20 mb-4">
          <Building className="w-7 h-7 text-accent" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold text-theme-primary mb-2">{t('provisioning.hero_title')}</h1>
        <p className="text-theme-muted">{t('provisioning.hero_subtitle')}</p>
      </motion.div>

      <GlassCard className="p-5 sm:p-8">
        <p className="text-sm text-theme-muted mb-5">{t('provisioning.intro')}</p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-400 text-sm" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Applicant */}
          <Input
            label={t('provisioning.fields.applicant_name')}
            isRequired
            value={form.applicant_name}
            onValueChange={v => set('applicant_name', v)}
            classNames={inputClasses} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              type="email"
              label={t('provisioning.fields.applicant_email')}
              isRequired
              value={form.applicant_email}
              onValueChange={v => set('applicant_email', v)}
              classNames={inputClasses} />
            <Input
              type="tel"
              label={t('provisioning.fields.applicant_phone')}
              placeholder="+1 555 123 4567"
              value={form.applicant_phone}
              onValueChange={v => set('applicant_phone', v)}
              classNames={inputClasses} />
          </div>

          {/* Organisation */}
          <Input
            label={t('provisioning.fields.org_name')}
            isRequired
            value={form.org_name}
            onValueChange={v => set('org_name', v)}
            classNames={inputClasses} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label={t('provisioning.fields.country_code')}
              selectedKeys={form.country_code ? [form.country_code] : []}
              onSelectionChange={keys => set('country_code', (Array.from(keys)[0] as string) ?? 'CH')}
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
                value: 'text-theme-primary',
              }}
            >
              {COUNTRIES.map(c => <SelectItem key={c} id={c}>{c}</SelectItem>)}
            </Select>
            <Input
              label={t('provisioning.fields.region_or_canton')}
              value={form.region_or_canton}
              onValueChange={v => set('region_or_canton', v)}
              classNames={inputClasses} />
          </div>

          {/* Slug */}
          <div>
            <Input
              label={t('provisioning.fields.requested_slug')}
              description={t('provisioning.fields.requested_slug_help')}
              isRequired
              value={form.requested_slug}
              onValueChange={v => set('requested_slug', v.toLowerCase())}
              classNames={inputClasses}
              endContent={
                slugStatus.state === 'checking' ? <Spinner size="sm" aria-hidden="true" /> :
                slugStatus.state === 'available' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden="true" /> :
                slugStatus.state === 'unavailable' ? <XCircle className="w-4 h-4 text-rose-500" aria-hidden="true" /> :
                null
              } />
            {slugStatus.state === 'checking' && (
              <p className="text-xs text-theme-subtle mt-1">{t('provisioning.slug_status.checking')}</p>
            )}
            {slugStatus.state === 'available' && (
              <p className="text-xs text-emerald-700 mt-1">{t('provisioning.slug_status.available')}</p>
            )}
            {slugStatus.state === 'unavailable' && (
              <p className="text-xs text-rose-700 mt-1">
                {t(`provisioning.slug_status.${slugStatus.reason}`)}
              </p>
            )}
          </div>

          <Input
            label={t('provisioning.fields.requested_subdomain')}
            value={form.requested_subdomain}
            onValueChange={v => set('requested_subdomain', v.toLowerCase())}
            classNames={inputClasses}
            startContent={<Globe className="w-4 h-4 text-theme-subtle" aria-hidden="true" />} />

          {/* Category */}
          <Select
            label={t('provisioning.fields.tenant_category')}
            isRequired
            selectedKeys={form.tenant_category ? [form.tenant_category] : []}
            onSelectionChange={keys => set('tenant_category', (Array.from(keys)[0] as string) ?? 'community')}
            classNames={{
              trigger: 'bg-theme-elevated border-theme-default',
              label: 'text-theme-muted',
              value: 'text-theme-primary',
            }}
          >
            {CATEGORIES.map(c => (
              <SelectItem key={c} id={c}>{t(`provisioning.categories.${c}`)}</SelectItem>
            ))}
          </Select>

          {/* Languages */}
          <CheckboxGroup
            label={t('provisioning.fields.languages')}
            value={form.languages}
            onValueChange={v => set('languages', v)}
            orientation="horizontal"
            classNames={{ label: 'text-theme-muted text-sm' }}
          >
            {LANGUAGES.map(l => (
              <Checkbox key={l} value={l} classNames={{ label: 'text-theme-primary text-sm' }}>
                {l.toUpperCase()}
              </Checkbox>
            ))}
          </CheckboxGroup>
          <Select
            label={t('provisioning.fields.default_language')}
            selectedKeys={form.default_language ? [form.default_language] : []}
            onSelectionChange={keys => set('default_language', (Array.from(keys)[0] as string) ?? 'en')}
            classNames={{
              trigger: 'bg-theme-elevated border-theme-default',
              label: 'text-theme-muted',
              value: 'text-theme-primary',
            }}
          >
            {form.languages.map(l => <SelectItem key={l} id={l}>{l.toUpperCase()}</SelectItem>)}
          </Select>

          {/* Bucket */}
          <Select
            label={t('provisioning.fields.expected_member_count_bucket')}
            selectedKeys={form.expected_member_count_bucket ? [form.expected_member_count_bucket] : []}
            onSelectionChange={keys => set('expected_member_count_bucket', (Array.from(keys)[0] as string) ?? '')}
            classNames={{
              trigger: 'bg-theme-elevated border-theme-default',
              label: 'text-theme-muted',
              value: 'text-theme-primary',
            }}
          >
            {BUCKETS.map(b => <SelectItem key={b} id={b}>{t(`provisioning.buckets.${b}`)}</SelectItem>)}
          </Select>

          {/* Intended use */}
          <Textarea
            label={t('provisioning.fields.intended_use')}
            placeholder={t('provisioning.fields.intended_use_placeholder')}
            minRows={3}
            value={form.intended_use}
            onValueChange={v => set('intended_use', v)}
            classNames={inputClasses} />

          {/* Captcha */}
          <Input
            label={`${t('provisioning.fields.captcha')} — ${captcha.a} + ${captcha.b} = ?`}
            isRequired
            type="number"
            value={captchaAnswer}
            onValueChange={setCaptchaAnswer}
            classNames={inputClasses} />

          <Button
            type="submit"
            isLoading={submitting}
            isDisabled={!canSubmit || submitting}
            className="w-full bg-gradient-to-r from-accent to-emerald-600 text-white font-medium"
            size="lg"
            spinner={<Spinner size="sm" />}
          >
            {submitting ? t('provisioning.submitting') : t('provisioning.submit')}
          </Button>
        </form>
      </GlassCard>
    </div>
  );
}

export default PilotApplyPage;
