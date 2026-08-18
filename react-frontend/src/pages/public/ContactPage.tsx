// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contact Page
 *
 * Uses V2 API: POST /api/v2/contact
 */

import { useState, type FormEvent } from 'react';
import { useTurnstile } from '@/hooks/useTurnstile';
import { motion } from '@/lib/motion';
import { Helmet } from 'react-helmet-async';import Mail from 'lucide-react/icons/mail';
import MessageSquare from 'lucide-react/icons/message-square';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useTenant, useAuth } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

export function ContactPage() {
  const { t } = useTranslation('public');
  const { branding, tenantPath, tenant } = useTenant();
  const { user, isAuthenticated } = useAuth();
  usePageTitle(t('contact.title'));

  // ContactPoint structured data — helps Google Knowledge Graph and Bing
  // surface the right way to reach the organisation. Only emits a contact
  // point if the tenant has actually configured an email or phone.
  const contactInfo = tenant?.contact;
  const contactPointSchema = (contactInfo?.email || contactInfo?.phone) ? {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: branding.name || 'NEXUS',
    url: typeof window !== 'undefined' ? window.location.origin : '',
    contactPoint: [{
      '@type': 'ContactPoint',
      contactType: 'customer support',
      ...(contactInfo.email ? { email: contactInfo.email } : {}),
      ...(contactInfo.phone ? { telephone: contactInfo.phone } : {}),
      availableLanguage: ['en', 'ga'],
    }],
  } : null;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileArmed, setTurnstileArmed] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || '',
    email: user?.email || '',
    subject: '',
    message: '',
  });

  // Cloudflare Turnstile — explicit-render hook. Required for lazy-loaded
  // pages because Cloudflare's api.js auto-discovery only scans the DOM
  // once on script load (no MutationObserver), so SPA-routed pages that
  // mount after that scan never get a widget rendered.
  const {
    token: turnstileToken,
    status: turnstileStatus,
    siteKey: turnstileSiteKey,
    containerRef: turnstileRef,
    reset: resetTurnstile,
  } = useTurnstile({ enabled: turnstileArmed });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (turnstileSiteKey && !turnstileToken) {
      setTurnstileArmed(true);
      return;
    }
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await api.post('/v2/contact', {
        name: formData.name,
        email: formData.email,
        subject: formData.subject || 'General Inquiry',
        message: formData.message,
        turnstile_token: turnstileToken || undefined,
      });

      if (response.success) {
        setSubmitted(true);
      } else {
        // Turnstile token is single-use — reset so the user can retry without
        // a stuck disabled submit button.
        if (turnstileSiteKey) resetTurnstile();
        setError(response.error || t('contact.error_fallback'));
      }
    } catch (err) {
      logError('Failed to submit contact form', err);
      if (turnstileSiteKey) resetTurnstile();
      setError(t('contact.error_fallback'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <PageMeta title={t('contact.title')} description={t('contact.meta_description')} />
      {contactPointSchema && (
        <Helmet>
          <script type="application/ld+json">
            {JSON.stringify(contactPointSchema).replace(/</g, '\\u003c')}
          </script>
        </Helmet>
      )}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <GlassCard className="p-5 sm:p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 mb-4">
              <MessageSquare aria-hidden="true" className="w-8 h-8 text-accent dark:text-accent" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary">{t('contact.title')}</h1>
            <p className="text-theme-muted mt-2">
              {t('contact.subtitle', { name: branding.name })}
            </p>
          </div>

          {submitted ? (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 mb-4">
                <Mail className="w-8 h-8 text-green-400" aria-hidden="true" />
              </div>
              <h2 className="text-xl font-semibold text-theme-primary mb-2">{t('contact.success_title')}</h2>
              <p className="text-theme-muted mb-4">
                {t('contact.success_message')}
              </p>
              <Button as={Link} to={tenantPath('/help')}
                variant="tertiary"
                className="bg-theme-elevated text-theme-muted"
                startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
              >
                {t('contact.back_to_help')}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} onFocusCapture={() => setTurnstileArmed(true)} className="space-y-5">
              {error && (
                <div role="alert" className="p-3 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-400 text-sm">
                  {error}
                </div>
              )}

              <Input
                label={t('contact.form.name_label')}
                placeholder={t('contact.form.name_placeholder')}
                isRequired
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                classNames={{
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                  input: 'text-theme-primary placeholder:text-theme-subtle',
                }} />

              <Input
                type="email"
                label={t('contact.form.email_label')}
                placeholder={t('contact.form.email_placeholder')}
                isRequired
                value={formData.email}
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                classNames={{
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                  input: 'text-theme-primary placeholder:text-theme-subtle',
                }} />

              <Select
                label={t('contact.form.subject_label')}
                placeholder={t('contact.form.subject_placeholder')}
                selectedKeys={formData.subject ? [formData.subject] : []}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0] as string;
                  setFormData((prev) => ({ ...prev, subject: selected || '' }));
                }}
                classNames={{
                  trigger: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                  value: 'text-theme-primary',
                }}
              >
                <SelectItem key="general" id="general">{t('contact.form.subjects.general')}</SelectItem>
                <SelectItem key="account" id="account">{t('contact.form.subjects.account')}</SelectItem>
                <SelectItem key="technical" id="technical">{t('contact.form.subjects.technical')}</SelectItem>
                <SelectItem key="feedback" id="feedback">{t('contact.form.subjects.feedback')}</SelectItem>
                <SelectItem key="other" id="other">{t('contact.form.subjects.other')}</SelectItem>
              </Select>

              <Textarea
                label={t('contact.form.message_label')}
                placeholder={t('contact.form.message_placeholder')}
                minRows={4}
                isRequired
                value={formData.message}
                onChange={(e) => setFormData((prev) => ({ ...prev, message: e.target.value }))}
                classNames={{
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                  input: 'text-theme-primary placeholder:text-theme-subtle',
                }} />

              {turnstileSiteKey && turnstileArmed && (
                <div>
                  <div ref={turnstileRef} className="my-2 min-h-[1px]" />
                  {turnstileStatus === 'error' && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                      {t('contact.turnstile_error')}
                    </p>
                  )}
                </div>
              )}

              <Button
                type="submit"
                isLoading={isSubmitting}
                isDisabled={!formData.name.trim() || !formData.email.trim() || !formData.message.trim() || (!!turnstileSiteKey && turnstileArmed && !turnstileToken)}
                className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white font-medium"
                size="lg"
                spinner={<Spinner size="sm" aria-hidden="true" />}
              >
                {t('contact.form.submit')}
              </Button>

              {!isAuthenticated && (
                <p className="text-xs text-theme-subtle text-center">
                  {t('contact.form.login_prompt_before')}{' '}
                  <Link to={tenantPath('/login')} className="text-accent hover:underline">
                    {t('contact.form.login_link')}
                  </Link>{' '}
                  {t('contact.form.login_prompt_after')}
                </p>
              )}
            </form>
          )}
        </GlassCard>
      </motion.div>
    </div>
  );
}

export default ContactPage;
