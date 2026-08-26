// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Legal Hub Page
 *
 * Central hub linking to all legal and compliance documents.
 * GDPR transparency commitment with cards for each legal document.
 */

import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import { Separator } from '@/components/ui/Separator';
import Scale from 'lucide-react/icons/scale';
import Shield from 'lucide-react/icons/shield';
import FileText from 'lucide-react/icons/file-text';
import Cookie from 'lucide-react/icons/cookie';
import Accessibility from 'lucide-react/icons/accessibility';
import CalendarDays from 'lucide-react/icons/calendar-days';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Handshake from 'lucide-react/icons/handshake';
import Send from 'lucide-react/icons/send';
import Users from 'lucide-react/icons/users';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Hexagon from 'lucide-react/icons/hexagon';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ExternalLink from 'lucide-react/icons/external-link';
import Building from 'lucide-react/icons/building';
import Trash2 from 'lucide-react/icons/trash-2';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';

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

const legalDocumentDefs = [
  {
    titleKey: 'hub.doc_privacy_title',
    descKey: 'hub.doc_privacy_desc',
    icon: Shield,
    path: '/privacy',
    color: 'text-accent',
    bg: 'bg-accent/20',
    gradient: 'from-accent/20 to-accent-gradient-end/20',
    updatedKey: 'hub.doc_updated_feb_2026',
  },
  {
    titleKey: 'hub.doc_terms_title',
    descKey: 'hub.doc_terms_desc',
    icon: FileText,
    path: '/terms',
    color: 'text-[var(--color-info)]',
    bg: 'bg-blue-500/20',
    gradient: 'from-blue-500/20 to-cyan-500/20',
    updatedKey: 'hub.doc_updated_feb_2026',
  },
  {
    titleKey: 'hub.doc_cookies_title',
    descKey: 'hub.doc_cookies_desc',
    icon: Cookie,
    path: '/cookies',
    color: 'text-[var(--color-warning)]',
    bg: 'bg-amber-500/20',
    gradient: 'from-amber-500/20 to-orange-500/20',
    updatedKey: 'hub.doc_updated_feb_2026',
  },
  {
    titleKey: 'hub.doc_accessibility_title',
    descKey: 'hub.doc_accessibility_desc',
    icon: Accessibility,
    path: '/accessibility',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/20',
    gradient: 'from-emerald-500/20 to-green-500/20',
    updatedKey: 'hub.doc_updated_feb_2026',
  },
  {
    titleKey: 'hub.doc_community_guidelines_title',
    descKey: 'hub.doc_community_guidelines_desc',
    icon: Users,
    path: '/community-guidelines',
    color: 'text-violet-500',
    bg: 'bg-violet-500/20',
    gradient: 'from-violet-500/20 to-fuchsia-500/20',
    updatedKey: 'hub.doc_updated_feb_2026',
  },
  {
    titleKey: 'hub.doc_acceptable_use_title',
    descKey: 'hub.doc_acceptable_use_desc',
    icon: ShieldCheck,
    path: '/acceptable-use',
    color: 'text-teal-500',
    bg: 'bg-teal-500/20',
    gradient: 'from-teal-500/20 to-cyan-500/20',
    updatedKey: 'hub.doc_updated_feb_2026',
  },
  {
    titleKey: 'hub.doc_trust_safety_title',
    descKey: 'hub.doc_trust_safety_desc',
    icon: ShieldCheck,
    path: '/trust-and-safety',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/20',
    gradient: 'from-emerald-500/20 to-accent-gradient-end/20',
    updatedKey: 'hub.doc_updated_feb_2026',
  },
  {
    titleKey: 'account_deletion.heading',
    descKey: 'account_deletion.meta_description',
    icon: Trash2,
    path: '/account-deletion',
    color: 'text-[var(--color-error)]',
    bg: 'bg-red-500/20',
    gradient: 'from-red-500/20 to-rose-500/20',
    updatedKey: 'hub.doc_updated_aug_2026',
  },
  {
    titleKey: 'child_safety.heading',
    descKey: 'child_safety.meta_description',
    icon: ShieldAlert,
    path: '/child-safety',
    color: 'text-rose-500',
    bg: 'bg-rose-500/20',
    gradient: 'from-rose-500/20 to-orange-500/20',
    updatedKey: 'hub.doc_updated_aug_2026',
  },
];

export function LegalHubPage() {
  const { t } = useTranslation('legal');
  usePageTitle(t('hub.page_title'));
  const { branding, tenantPath, tenant } = useTenant();

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-4xl mx-auto space-y-8"
    >
      <PageMeta title={t('page_meta.legal_hub.title')} description={t('page_meta.legal_hub.description')} />
      {/* Hero Header */}
      <motion.div variants={itemVariants} className="text-center">
        <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 mb-4">
          <Scale className="w-10 h-10 text-accent dark:text-accent" aria-hidden="true" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-3">
          {t('hub.heading')}
        </h1>
        <p className="text-theme-muted text-lg max-w-2xl mx-auto">
          {t('hub.subtitle')}
        </p>
      </motion.div>

      {/* Tenant Legal Entity Info */}
      {tenant?.config?.footer_text && (
        <motion.div variants={itemVariants}>
          <GlassCard className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 shrink-0">
                <Building className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-theme-primary mb-1">
                  {branding.name}
                </h2>
                <p className="text-sm text-theme-muted whitespace-pre-line">
                  {tenant.config.footer_text}
                </p>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* GDPR Commitment Banner */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <div className="p-4 rounded-xl bg-accent/10 border border-accent/20">
            <h2 className="text-xl font-semibold text-theme-primary mb-3 flex items-center gap-2">
              <Handshake className="w-5 h-5 text-accent" aria-hidden="true" />
              {t('hub.commitment_title')}
            </h2>
            <div className="space-y-3 text-theme-muted">
              <p>
                {t('hub.commitment_body_1', { name: branding.name })}
              </p>
              <p>
                {t('hub.commitment_body_2_before')}{' '}
                <strong className="text-theme-primary">{t('hub.commitment_body_2_emphasis')}</strong>{' '}
                {t('hub.commitment_body_2_after')}
              </p>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Legal Document Cards */}
      <motion.div variants={itemVariants}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {legalDocumentDefs.map((doc) => (
            <GlassCard key={doc.titleKey} hoverable className="p-6 flex flex-col">
              <div className="flex items-start gap-4 mb-4">
                <div className={`p-3 rounded-xl bg-gradient-to-br ${doc.gradient} flex-shrink-0`}>
                  <doc.icon className={`w-6 h-6 ${doc.color}`} aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-theme-primary">{t(doc.titleKey)}</h3>
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-theme-subtle">
                    <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t(doc.updatedKey)}</span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-theme-muted flex-1 mb-4">
                {t(doc.descKey)}
              </p>
              <Button as={Link} to={tenantPath(doc.path)}
                variant="tertiary"
                className="w-full bg-theme-elevated text-theme-primary"
                endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
              >
                {t('hub.read_document')}
              </Button>
            </GlassCard>
          ))}
        </div>
      </motion.div>

      {/* Platform Legal Documents */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <div className="flex items-start gap-3 mb-5">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-slate-500/20 to-blue-500/20 shrink-0">
              <Hexagon className="w-5 h-5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-theme-primary">
                {t('hub.platform_section_title')}
              </h2>
              <p className="text-sm text-theme-muted mt-1">
                {t('hub.platform_section_desc')}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button as={Link} to={tenantPath('/platform/terms')}
              variant="tertiary"
              className="w-full bg-slate-500/10 text-theme-primary justify-start gap-2"
              startContent={<FileText className="w-4 h-4 text-slate-500" aria-hidden="true" />}
              endContent={<ExternalLink className="w-3 h-3 text-theme-subtle" aria-hidden="true" />}
            >
              {t('hub.platform_terms')}
            </Button>
            <Button as={Link} to={tenantPath('/platform/privacy')}
              variant="tertiary"
              className="w-full bg-slate-500/10 text-theme-primary justify-start gap-2"
              startContent={<Shield className="w-4 h-4 text-slate-500" aria-hidden="true" />}
              endContent={<ExternalLink className="w-3 h-3 text-theme-subtle" aria-hidden="true" />}
            >
              {t('hub.platform_privacy')}
            </Button>
            <Button as={Link} to={tenantPath('/platform/disclaimer')}
              variant="tertiary"
              className="w-full bg-slate-500/10 text-theme-primary justify-start gap-2"
              startContent={<AlertTriangle className="w-4 h-4 text-slate-500" aria-hidden="true" />}
              endContent={<ExternalLink className="w-3 h-3 text-theme-subtle" aria-hidden="true" />}
            >
              {t('hub.platform_disclaimer')}
            </Button>
          </div>
        </GlassCard>
      </motion.div>

      {/* Contact CTA */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8">
          <div className="text-center">
            <div className="inline-flex p-3 rounded-2xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 mb-4">
              <Scale className="w-8 h-8 text-accent dark:text-accent" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold text-theme-primary mb-2">
              {t('hub.cta_title')}
            </h2>
            <p className="text-theme-muted text-sm mb-6 max-w-lg mx-auto">
              {t('hub.cta_body')}
            </p>
            <Separator className="my-4" />
            <div className="flex flex-wrap justify-center gap-3 mt-4">
              <Button as={Link} to={tenantPath('/contact')}
                className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                startContent={<Send className="w-4 h-4" aria-hidden="true" />}
              >
                {t('hub.contact_team')}
              </Button>
              <Button as={Link} to={tenantPath('/privacy')}
                variant="tertiary"
                className="bg-theme-elevated text-theme-primary"
                startContent={<Shield className="w-4 h-4" aria-hidden="true" />}
              >
                {t('hub.privacy_policy_link')}
              </Button>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

export default LegalHubPage;
