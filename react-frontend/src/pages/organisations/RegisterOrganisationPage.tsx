// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Register Organisation Page
 *
 * Allows authenticated users to register a volunteer organisation.
 * Organisations are created with status 'pending' and require admin approval.
 */

import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';

import Save from 'lucide-react/icons/save';
import Building2 from 'lucide-react/icons/building-2';
import Mail from 'lucide-react/icons/mail';
import Globe from 'lucide-react/icons/globe';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Breadcrumbs } from '@/components/navigation';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';

interface FormData {
  name: string;
  description: string;
  contact_email: string;
  website: string;
}

const initialFormData: FormData = {
  name: '',
  description: '',
  contact_email: '',
  website: '',
};

export default function RegisterOrganisationPage() {
  const { t } = useTranslation('community');
  usePageTitle(t('organisations.register_page_title'));
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Synchronous re-entry guard: isSubmitting is async state, so a double-Enter (the
  // form submits on Enter, bypassing the disabled button) or a fast double-click can
  // fire handleSubmit twice and register two organisations. This blocks the 2nd call.
  const submittingRef = useRef(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);

  function updateField<K extends keyof FormData>(field: K, value: FormData[K]) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function validateForm(): boolean {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = t('organisations.form_name_required');
    } else if (formData.name.trim().length < 3) {
      newErrors.name = t('organisations.form_name_min_length');
    }

    if (!formData.description.trim()) {
      newErrors.description = t('organisations.form_description_required');
    } else if (formData.description.trim().length < 20) {
      newErrors.description = t('organisations.form_description_min_length');
    }

    if (!formData.contact_email.trim()) {
      newErrors.contact_email = t('organisations.form_email_required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contact_email.trim())) {
      newErrors.contact_email = t('organisations.form_email_invalid');
    }

    if (formData.website.trim() && !/^https?:\/\/.+/.test(formData.website.trim())) {
      newErrors.website = t('organisations.form_website_invalid');
    }

    if (!agreedTerms) {
      setTermsError(t('organisations.terms_required'));
    } else {
      setTermsError(null);
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0 && agreedTerms;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return; // block a second in-flight submit

    if (!validateForm()) return;

    submittingRef.current = true;
    try {
      setIsSubmitting(true);

      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        contact_email: formData.contact_email.trim(),
        website: formData.website.trim() || undefined,
      };

      const response = await api.post<{ id: number }>('/v2/volunteering/organisations', payload);

      if (response.success && response.data) {
        toast.success(
          t('organisations.form_success_title'),
          t('organisations.form_success_message'),
        );
        navigate(tenantPath('/volunteering/my-organisations'));
      } else {
        toast.error(t('organisations.form_save_error'));
      }
    } catch (error) {
      logError('Failed to register organisation', error);
      toast.error(t('organisations.form_save_error'));
    } finally {
      setIsSubmitting(false);
      submittingRef.current = false;
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto space-y-6"
    >
      <PageMeta title={t('page_meta.register_organisation.title')} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('organisations.heading'), href: tenantPath('/organisations') },
        { label: t('organisations.register_page_title') },
      ]} />

      {/* Form */}
      <GlassCard className="p-6 sm:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
            <Building2 className="w-7 h-7 text-accent" aria-hidden="true" />
            {t('organisations.register_heading')}
          </h1>
          <p className="text-theme-muted mt-1">
            {t('organisations.register_subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Organisation Name */}
          <Input
            label={t('organisations.form_name_label')}
            placeholder={t('organisations.form_name_placeholder')}
            value={formData.name}
            onChange={(e) => updateField('name', e.target.value)}
            isInvalid={!!errors.name}
            errorMessage={errors.name}
            startContent={<Building2 className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
            }}
          />

          {/* Description */}
          <Textarea
            label={t('organisations.form_description_label')}
            placeholder={t('organisations.form_description_placeholder')}
            value={formData.description}
            onChange={(e) => updateField('description', e.target.value)}
            isInvalid={!!errors.description}
            errorMessage={errors.description}
            minRows={4}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
            }}
          />

          {/* Contact Email */}
          <Input
            type="email"
            label={t('organisations.form_email_label')}
            placeholder={t('organisations.form_email_placeholder')}
            value={formData.contact_email}
            onChange={(e) => updateField('contact_email', e.target.value)}
            isInvalid={!!errors.contact_email}
            errorMessage={errors.contact_email}
            startContent={<Mail className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
            }}
          />

          {/* Website (optional) */}
          <Input
            label={t('organisations.form_website_label')}
            placeholder={t('organisations.form_website_placeholder')}
            value={formData.website}
            onChange={(e) => updateField('website', e.target.value)}
            isInvalid={!!errors.website}
            errorMessage={errors.website}
            startContent={<Globe className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
            }}
          />

          {/* Terms & Conditions */}
          <div className="rounded-lg bg-theme-elevated border border-theme-default p-5 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-5 h-5 text-accent" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-theme-primary">
                {t('organisations.terms_heading')}
              </h3>
            </div>
            <ul className="text-xs text-theme-muted space-y-1.5 list-disc list-inside">
              <li>{t('organisations.terms_item_1')}</li>
              <li>{t('organisations.terms_item_2')}</li>
              <li>{t('organisations.terms_item_3')}</li>
              <li>{t('organisations.terms_item_4')}</li>
              <li>{t('organisations.terms_item_5')}</li>
            </ul>
            <div className="pt-2">
              <Checkbox
                isSelected={agreedTerms}
                onValueChange={(val) => {
                  setAgreedTerms(val);
                  if (val) setTermsError(null);
                }}
                size="sm"
                aria-describedby={termsError ? 'terms-error' : undefined}
                classNames={{
                  label: 'text-theme-muted text-sm',
                }}
              >
                {t('organisations.terms_agreement')}
              </Checkbox>
              {termsError && (
                <p id="terms-error" className="text-xs text-danger mt-1" role="alert">{termsError}</p>
              )}
            </div>
          </div>

          {/* Info notice */}
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {t('organisations.pending_approval_notice')}
            </p>
          </div>

          {/* Submit buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              className="flex-1 bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              startContent={<Save className="w-4 h-4" aria-hidden="true" />}
              isLoading={isSubmitting}
            >
              {t('organisations.form_submit')}
            </Button>
            <Button as={Link} to={tenantPath('/organisations')}
              type="button"
              variant="secondary"
              className="bg-theme-elevated text-theme-primary"
            >
              {t('organisations.form_cancel')}
            </Button>
          </div>
        </form>
      </GlassCard>
    </motion.div>
  );
}

export { RegisterOrganisationPage };
