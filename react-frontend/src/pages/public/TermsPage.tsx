// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Terms of Service Page
 *
 * Fetches custom tenant-specific terms from the API (managed via admin
 * Legal Documents). Falls back to a generic default if no custom document
 * exists for this tenant.
 */

import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';
import { Chip } from '@/components/ui/Chip';
import { Separator } from '@/components/ui/Separator';
import FileText from 'lucide-react/icons/file-text';
import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import Ban from 'lucide-react/icons/ban';
import Shield from 'lucide-react/icons/shield';
import Handshake from 'lucide-react/icons/handshake';
import UserCog from 'lucide-react/icons/user-cog';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import MapPin from 'lucide-react/icons/map-pin';
import Scale from 'lucide-react/icons/scale';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Gem from 'lucide-react/icons/gem';
import MessageSquare from 'lucide-react/icons/message-square';
import Send from 'lucide-react/icons/send';
import CalendarDays from 'lucide-react/icons/calendar-days';
import Info from 'lucide-react/icons/info';
import CircleSlash from 'lucide-react/icons/circle-slash';
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
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function TermsPage() {
  const { t } = useTranslation('legal');
  usePageTitle(t('terms.page_title'));
  const { branding, tenantPath } = useTenant();
  const { document: customDoc, loading } = useLegalDocument('terms');

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common:loading')} className="flex justify-center items-center min-h-[50vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (customDoc) {
    return <CustomLegalDocument document={customDoc} accentColor="blue" />;
  }

  // Default fallback — generic terms content
  return (
    <>
      <PageMeta title={t('terms.page_title')} description={t('terms.meta_description')} />
      <DefaultTermsContent branding={branding} tenantPath={tenantPath} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Terms Content (shown when no custom document exists)
// ─────────────────────────────────────────────────────────────────────────────

const quickNavIcons = [
  { id: 'time-credits', key: 'terms.nav_time_credits', icon: Clock },
  { id: 'community', key: 'terms.nav_community_rules', icon: Users },
  { id: 'prohibited', key: 'terms.nav_prohibited', icon: Ban },
  { id: 'liability', key: 'terms.nav_liability', icon: Shield },
];

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

const prohibitedKeys = [
  'terms.prohibited_harassment',
  'terms.prohibited_fraud',
  'terms.prohibited_illegal',
  'terms.prohibited_spam',
  'terms.prohibited_impersonation',
  'terms.prohibited_sharing_private',
] as const;

function DefaultTermsContent({ branding, tenantPath }: { branding: { name: string }; tenantPath: (path: string) => string }) {
  const { t } = useTranslation('legal');

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-4xl mx-auto space-y-8"
    >
      {/* Hero Header */}
      <motion.div variants={itemVariants} className="text-center">
        <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 mb-4">
          <FileText className="w-10 h-10 text-[var(--color-info)]" aria-hidden="true" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-3">
          {t('terms.heading')}
        </h1>
        <p className="text-theme-muted text-lg max-w-2xl mx-auto">
          {t('terms.subtitle')}
        </p>
        <div className="flex items-center justify-center gap-2 mt-3 text-sm text-theme-subtle">
          <CalendarDays className="w-4 h-4" aria-hidden="true" />
          <span>{t('terms.last_updated')}</span>
        </div>
      </motion.div>

      {/* Quick Navigation */}
      <motion.div variants={itemVariants}>
        <div className="flex flex-wrap justify-center gap-3">
          {quickNavIcons.map((item) => (
            <Button
              key={item.id}
              variant="tertiary"
              onPress={() => scrollToSection(item.id)}
              className="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-xl bg-theme-elevated px-4 py-2 text-sm font-medium text-theme-primary transition-colors hover:bg-blue-500/10"
            >
              <item.icon className="w-4 h-4 text-[var(--color-info)]" aria-hidden="true" />
              {t(item.key)}
            </Button>
          ))}
        </div>
      </motion.div>

      {/* Introduction */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <h2 className="text-xl font-semibold text-theme-primary mb-3 flex items-center gap-2">
              <Handshake className="w-5 h-5 text-[var(--color-info)]" aria-hidden="true" />
              {t('terms.welcome_title', { name: branding.name })}
            </h2>
            <div className="space-y-3 text-theme-muted">
              <p>
                {t('terms.welcome_body_1')}
              </p>
              <p>
                {t('terms.welcome_body_2_before')}{' '}
                <strong className="text-theme-primary">{t('terms.welcome_body_2_emphasis')}</strong>{' '}
                {t('terms.welcome_body_2_after')}
              </p>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* 1. Time Credit System */}
      <motion.div variants={itemVariants} id="time-credits">
        <GlassCard className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <Chip size="sm" variant="tertiary" color="accent" className="text-xs font-bold">1</Chip>
            <Clock className="w-5 h-5 text-[var(--color-info)]" aria-hidden="true" />
            {t('terms.section1_title')}
          </h2>
          <p className="text-theme-muted mb-4">
            {t('terms.section1_intro_before')}{' '}
            <strong className="text-theme-primary">{t('terms.section1_intro_emphasis')}</strong>.
          </p>

          {/* Visual equality display */}
          <div className="flex flex-wrap items-center justify-center gap-4 my-6">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-theme-elevated">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <Clock className="w-6 h-6 text-[var(--color-info)]" aria-hidden="true" />
              </div>
              <span className="font-medium text-theme-primary">{t('terms.one_hour_service')}</span>
            </div>
            <span className="text-2xl font-bold text-[var(--color-info)]">=</span>
            <div className="flex items-center gap-3 p-4 rounded-xl bg-theme-elevated">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <Gem className="w-6 h-6 text-[var(--color-info)]" aria-hidden="true" />
              </div>
              <span className="font-medium text-theme-primary">{t('terms.one_time_credit')}</span>
            </div>
          </div>

          {/* Important notice */}
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 mb-4 flex items-start gap-3">
            <Info className="w-5 h-5 text-[var(--color-warning)] mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <h4 className="font-medium text-amber-700 dark:text-amber-400 text-sm mb-1">{t('terms.important')}</h4>
              <p className="text-sm text-theme-muted">
                {t('terms.credits_no_monetary_value')}
              </p>
            </div>
          </div>

          <ul className="space-y-2 text-theme-muted">
            {([
              'terms.credit_rule_1',
              'terms.credit_rule_2',
              'terms.credit_rule_3',
              'terms.credit_rule_4',
            ] as const).map((key) => (
              <li key={key} className="flex items-start gap-3">
                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      </motion.div>

      {/* 2. Account Responsibilities */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <Chip size="sm" variant="tertiary" color="accent" className="text-xs font-bold">2</Chip>
            <UserCog className="w-5 h-5 text-[var(--color-info)]" aria-hidden="true" />
            {t('terms.section2_title')}
          </h2>
          <p className="text-theme-muted mb-4">
            {t('terms.section2_intro')}
          </p>
          <ul className="space-y-3 text-theme-muted">
            {([
              { labelKey: 'terms.account_accurate_label', descKey: 'terms.account_accurate_desc' },
              { labelKey: 'terms.account_security_label', descKey: 'terms.account_security_desc' },
              { labelKey: 'terms.account_one_account_label', descKey: 'terms.account_one_account_desc' },
              { labelKey: 'terms.account_current_label', descKey: 'terms.account_current_desc' },
              { labelKey: 'terms.account_reachable_label', descKey: 'terms.account_reachable_desc' },
            ] as const).map((item) => (
              <li key={item.labelKey} className="flex items-start gap-3">
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                <span>
                  <strong className="text-theme-primary">{t(item.labelKey)}:</strong> {t(item.descKey)}
                </span>
              </li>
            ))}
          </ul>
        </GlassCard>
      </motion.div>

      {/* 3. Community Guidelines */}
      <motion.div variants={itemVariants} id="community">
        <GlassCard className="p-6 sm:p-8">
          <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 mb-4">
            <h2 className="text-xl font-semibold text-theme-primary mb-2 flex items-center gap-2">
              <Chip size="sm" variant="tertiary" color="accent" className="text-xs font-bold">3</Chip>
              <Users className="w-5 h-5 text-[var(--color-info)]" aria-hidden="true" />
              {t('terms.section3_title')}
            </h2>
            <p className="text-theme-muted text-sm">
              {t('terms.section3_intro_before')}{' '}
              <strong className="text-theme-primary">{t('terms.section3_intro_emphasis')}</strong>.
              {' '}{t('terms.section3_intro_after')}
            </p>
          </div>

          <ol className="space-y-3 text-theme-muted">
            {([
              { labelKey: 'terms.guideline_respect_label', descKey: 'terms.guideline_respect_desc' },
              { labelKey: 'terms.guideline_honour_label', descKey: 'terms.guideline_honour_desc' },
              { labelKey: 'terms.guideline_communicate_label', descKey: 'terms.guideline_communicate_desc' },
              { labelKey: 'terms.guideline_inclusive_label', descKey: 'terms.guideline_inclusive_desc' },
              { labelKey: 'terms.guideline_feedback_label', descKey: 'terms.guideline_feedback_desc' },
            ] as const).map((item, index) => (
              <li key={item.labelKey} className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <span className="text-xs font-bold text-[var(--color-info)]">{index + 1}</span>
                </div>
                <span>
                  <strong className="text-theme-primary">{t(item.labelKey)}</strong> — {t(item.descKey)}
                </span>
              </li>
            ))}
          </ol>
        </GlassCard>
      </motion.div>

      {/* 4. Prohibited Activities */}
      <motion.div variants={itemVariants} id="prohibited">
        <GlassCard className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <Chip size="sm" variant="tertiary" color="accent" className="text-xs font-bold">4</Chip>
            <Ban className="w-5 h-5 text-[var(--color-error)]" aria-hidden="true" />
            {t('terms.section4_title')}
          </h2>
          <p className="text-theme-muted mb-4">
            {t('terms.section4_intro')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {prohibitedKeys.map((key) => (
              <div
                key={key}
                className="flex items-center gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/10"
              >
                <CircleSlash className="w-4 h-4 text-[var(--color-error)] flex-shrink-0" aria-hidden="true" />
                <span className="text-sm text-theme-muted">{t(key)}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </motion.div>

      {/* 5. Safety & Meetings */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <Chip size="sm" variant="tertiary" color="accent" className="text-xs font-bold">5</Chip>
            <MapPin className="w-5 h-5 text-[var(--color-info)]" aria-hidden="true" />
            {t('terms.section5_title')}
          </h2>
          <p className="text-theme-muted mb-4">
            {t('terms.section5_intro')}
          </p>
          <ul className="space-y-3 text-theme-muted">
            {([
              { labelKey: 'terms.safety_first_meetings_label', descKey: 'terms.safety_first_meetings_desc' },
              { labelKey: 'terms.safety_verify_label', descKey: 'terms.safety_verify_desc' },
              { labelKey: 'terms.safety_instincts_label', descKey: 'terms.safety_instincts_desc' },
              { labelKey: 'terms.safety_report_label', descKey: 'terms.safety_report_desc' },
              { labelKey: 'terms.safety_records_label', descKey: 'terms.safety_records_desc' },
            ] as const).map((item) => (
              <li key={item.labelKey} className="flex items-start gap-3">
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                <span>
                  <strong className="text-theme-primary">{t(item.labelKey)}:</strong> {t(item.descKey)}
                </span>
              </li>
            ))}
          </ul>
        </GlassCard>
      </motion.div>

      {/* 6. Limitation of Liability */}
      <motion.div variants={itemVariants} id="liability">
        <GlassCard className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <Chip size="sm" variant="tertiary" color="accent" className="text-xs font-bold">6</Chip>
            <Scale className="w-5 h-5 text-[var(--color-info)]" aria-hidden="true" />
            {t('terms.section6_title')}
          </h2>
          <p className="text-theme-muted mb-4">
            {t('terms.section6_intro', { name: branding.name })}
          </p>
          <ul className="space-y-3 text-theme-muted">
            {([
              'terms.liability_no_guarantee',
              'terms.liability_no_disputes',
              'terms.liability_own_risk',
              'terms.liability_insurance',
            ] as const).map((key) => (
              <li key={key} className="flex items-start gap-3">
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <p className="text-sm text-theme-muted">
              {t('terms.liability_hold_harmless', { name: branding.name })}
            </p>
          </div>
        </GlassCard>
      </motion.div>

      {/* 7. Account Termination */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <Chip size="sm" variant="tertiary" color="accent" className="text-xs font-bold">7</Chip>
            <AlertTriangle className="w-5 h-5 text-[var(--color-warning)]" aria-hidden="true" />
            {t('terms.section7_title')}
          </h2>
          <p className="text-theme-muted mb-4">
            {t('terms.section7_intro')}
          </p>
          <ul className="space-y-2 text-theme-muted">
            {([
              'terms.termination_guidelines',
              'terms.termination_fraud',
              'terms.termination_harassment',
              'terms.termination_inactivity',
              'terms.termination_false_info',
            ] as const).map((key) => (
              <li key={key} className="flex items-start gap-3">
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-theme-muted mt-4">
            {t('terms.termination_self_close')}
          </p>
        </GlassCard>
      </motion.div>

      {/* 8. Changes to These Terms */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <Chip size="sm" variant="tertiary" color="accent" className="text-xs font-bold">8</Chip>
            <RefreshCw className="w-5 h-5 text-[var(--color-info)]" aria-hidden="true" />
            {t('terms.section8_title')}
          </h2>
          <p className="text-theme-muted mb-4">
            {t('terms.section8_intro')}
          </p>
          <ul className="space-y-2 text-theme-muted">
            {([
              'terms.changes_notify',
              'terms.changes_date_shown',
              'terms.changes_continued_use',
            ] as const).map((key) => (
              <li key={key} className="flex items-start gap-3">
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      </motion.div>

      {/* Contact CTA */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <div className="text-center">
            <div className="inline-flex p-3 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 mb-4">
              <MessageSquare className="w-8 h-8 text-[var(--color-info)]" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold text-theme-primary mb-2">
              {t('terms.cta_title')}
            </h2>
            <p className="text-theme-muted text-sm mb-6 max-w-lg mx-auto">
              {t('terms.cta_body')}
            </p>
            <Separator className="my-4" />
            <div className="flex flex-wrap justify-center gap-3 mt-4">
              <Button as={Link} to={tenantPath('/contact')}
                className="bg-gradient-to-r from-blue-500 to-cyan-600 text-white"
                startContent={<Send className="w-4 h-4" aria-hidden="true" />}
              >
                {t('terms.contact_us')}
              </Button>
              <Button as={Link} to={tenantPath('/privacy')}
                variant="tertiary"
                className="bg-theme-elevated text-theme-primary"
                startContent={<Shield className="w-4 h-4" aria-hidden="true" />}
              >
                {t('terms.privacy_policy_link')}
              </Button>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

export default TermsPage;
