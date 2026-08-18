// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Accessibility Statement Page
 *
 * Static page with the platform's accessibility commitment,
 * conformance status, feedback options, and technical specifications.
 */

import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import Accessibility from 'lucide-react/icons/accessibility';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import MessageSquare from 'lucide-react/icons/message-square';
import Monitor from 'lucide-react/icons/monitor';
import Eye from 'lucide-react/icons/eye';
import Keyboard from 'lucide-react/icons/keyboard';
import Volume2 from 'lucide-react/icons/volume-2';
import Globe from 'lucide-react/icons/globe';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { CustomLegalDocument } from '@/components/legal/CustomLegalDocument';
import { PageMeta } from '@/components/seo/PageMeta';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { useLegalDocument } from '@/hooks/useLegalDocument';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function AccessibilityPage() {
  const { t } = useTranslation('legal');
  usePageTitle(t('accessibility.page_title'));
  const { branding, tenantPath } = useTenant();
  const { document: customDoc, loading } = useLegalDocument('accessibility');

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common:loading')} className="flex justify-center items-center min-h-[50vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (customDoc) {
    return <CustomLegalDocument document={customDoc} accentColor="indigo" />;
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-4xl mx-auto space-y-8"
    >
      <PageMeta title={t('accessibility.page_title')} description={t('accessibility.meta_description')} />
      {/* Hero */}
      <motion.div variants={itemVariants} className="text-center">
        <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 mb-4">
          <Accessibility className="w-10 h-10 text-accent dark:text-accent" aria-hidden="true" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-3">
          {t('accessibility.heading')}
        </h1>
        <p className="text-theme-muted text-lg max-w-2xl mx-auto">
          {t('accessibility.subtitle', { name: branding.name })}
        </p>
      </motion.div>

      {/* Our Commitment */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <Eye className="w-5 h-5 text-accent" aria-hidden="true" />
            {t('accessibility.commitment_title')}
          </h2>
          <div className="space-y-4 text-theme-muted">
            <p>
              {t('accessibility.commitment_body_1', { name: branding.name })}
            </p>
            <p>
              {t('accessibility.commitment_body_2')}
            </p>
          </div>

          {/* Accessibility Features */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
            {([
              {
                icon: Keyboard,
                titleKey: 'accessibility.feature_keyboard_title',
                descKey: 'accessibility.feature_keyboard_desc',
              },
              {
                icon: Eye,
                titleKey: 'accessibility.feature_visual_title',
                descKey: 'accessibility.feature_visual_desc',
              },
              {
                icon: Volume2,
                titleKey: 'accessibility.feature_screen_reader_title',
                descKey: 'accessibility.feature_screen_reader_desc',
              },
              {
                icon: Monitor,
                titleKey: 'accessibility.feature_responsive_title',
                descKey: 'accessibility.feature_responsive_desc',
              },
            ] as const).map((feature) => (
              <div
                key={feature.titleKey}
                className="flex items-start gap-3 p-4 rounded-xl bg-theme-elevated"
              >
                <div className="p-2 rounded-lg bg-accent/20 flex-shrink-0">
                  <feature.icon className="w-4 h-4 text-accent dark:text-accent" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium text-theme-primary text-sm">{t(feature.titleKey)}</p>
                  <p className="text-xs text-theme-subtle mt-1">{t(feature.descKey)}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </motion.div>

      {/* Conformance Status */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-500" aria-hidden="true" />
            {t('accessibility.conformance_title')}
          </h2>
          <div className="space-y-4 text-theme-muted">
            <p>
              {t('accessibility.conformance_body_1')}
            </p>
            <p>
              {t('accessibility.conformance_body_2_before', { name: branding.name })}{' '}
              <strong className="text-theme-primary">{t('accessibility.conformance_body_2_emphasis')}</strong>{' '}
              {t('accessibility.conformance_body_2_after')}
            </p>

            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-sm font-medium text-theme-success mb-2">
                {t('accessibility.standards_label')}
              </p>
              <ul className="space-y-2 text-sm text-theme-muted">
                {([
                  'accessibility.standard_wcag',
                  'accessibility.standard_aria',
                  'accessibility.standard_508',
                  'accessibility.standard_en301549',
                ] as const).map((key) => (
                  <li key={key} className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" aria-hidden="true" />
                    {t(key)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Feedback */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[var(--color-warning)]" aria-hidden="true" />
            {t('accessibility.feedback_title')}
          </h2>
          <div className="space-y-4 text-theme-muted">
            <p>
              {t('accessibility.feedback_intro', { name: branding.name })}
            </p>

            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-theme-primary font-medium min-w-[80px]">{t('accessibility.feedback_email_label')}:</span>
                <span>{t('accessibility.feedback_email_desc')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-theme-primary font-medium min-w-[80px]">{t('accessibility.feedback_response_label')}:</span>
                <span>{t('accessibility.feedback_response_desc')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-theme-primary font-medium min-w-[80px]">{t('accessibility.feedback_updates_label')}:</span>
                <span>{t('accessibility.feedback_updates_desc')}</span>
              </li>
            </ul>

            <div className="flex flex-wrap gap-3 mt-4">
              <Button as={Link} to={tenantPath("/contact")}
                className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                startContent={<MessageSquare className="w-4 h-4" aria-hidden="true" />}
              >
                {t('accessibility.report_issue')}
              </Button>
              <Button as={Link} to={tenantPath("/help")}
                variant="tertiary"
                className="bg-theme-elevated text-theme-primary"
              >
                {t('accessibility.help_center')}
              </Button>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Technical Specifications */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-[var(--color-info)]" aria-hidden="true" />
            {t('accessibility.tech_title')}
          </h2>
          <div className="space-y-4 text-theme-muted">
            <p>
              {t('accessibility.tech_intro', { name: branding.name })}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                'accessibility.tech_html5',
                'accessibility.tech_aria',
                'accessibility.tech_css',
                'accessibility.tech_js',
                'accessibility.tech_svg',
                'accessibility.tech_react',
              ] as const).map((key) => (
                <div
                  key={key}
                  className="flex items-center gap-2 p-3 rounded-lg bg-theme-elevated text-sm"
                >
                  <CheckCircle className="w-4 h-4 text-[var(--color-info)] flex-shrink-0" aria-hidden="true" />
                  <span className="text-theme-primary">{t(key)}</span>
                </div>
              ))}
            </div>

            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 mt-4">
              <p className="text-sm text-theme-muted">
                {t('accessibility.tech_recommendation')}
              </p>
            </div>

            <p className="text-sm text-theme-subtle mt-4">
              {t('accessibility.last_updated')}
            </p>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

export default AccessibilityPage;
