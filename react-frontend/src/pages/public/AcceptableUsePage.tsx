// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Acceptable Use Policy Page
 *
 * Displays the tenant's custom AUP document if one exists. Otherwise falls
 * back to a generic v1.0 default — the same pattern used by TermsPage /
 * PrivacyPage. Trust & Safety and the Terms link here as if a real policy
 * exists, so we ship one rather than a "being prepared" placeholder.
 */

import { motion } from '@/lib/motion';import ShieldCheck from 'lucide-react/icons/shield-check';
import Ban from 'lucide-react/icons/ban';
import UserX from 'lucide-react/icons/user-x';
import Bot from 'lucide-react/icons/bot';
import Bug from 'lucide-react/icons/bug';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Lock from 'lucide-react/icons/lock';
import Scale from 'lucide-react/icons/scale';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { CustomLegalDocument } from '@/components/legal/CustomLegalDocument';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { useLegalDocument } from '@/hooks/useLegalDocument';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

interface AcceptableUseSectionConfig {
  icon?: React.ReactNode;
  titleKey: string;
  paragraphs?: string[];
  listKey?: string;
  listCount?: number;
}

const ACCEPTABLE_USE_SECTIONS: AcceptableUseSectionConfig[] = [
  { titleKey: 'acceptable_use.sections.scope.title', paragraphs: ['acceptable_use.sections.scope.body'] },
  {
    icon: <Scale className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'acceptable_use.sections.illegal.title',
    paragraphs: ['acceptable_use.sections.illegal.body'],
    listKey: 'acceptable_use.sections.illegal.items',
    listCount: 4,
  },
  {
    icon: <UserX className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'acceptable_use.sections.fraud.title',
    listKey: 'acceptable_use.sections.fraud.items',
    listCount: 4,
  },
  {
    icon: <AlertTriangle className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'acceptable_use.sections.harm.title',
    listKey: 'acceptable_use.sections.harm.items',
    listCount: 6,
  },
  {
    icon: <Ban className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'acceptable_use.sections.content.title',
    listKey: 'acceptable_use.sections.content.items',
    listCount: 4,
  },
  {
    icon: <Bot className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'acceptable_use.sections.misuse.title',
    listKey: 'acceptable_use.sections.misuse.items',
    listCount: 5,
  },
  {
    icon: <Bug className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'acceptable_use.sections.interference.title',
    listKey: 'acceptable_use.sections.interference.items',
    listCount: 5,
  },
  {
    icon: <Lock className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'acceptable_use.sections.account.title',
    listKey: 'acceptable_use.sections.account.items',
    listCount: 4,
  },
  {
    titleKey: 'acceptable_use.sections.enforcement.title',
    paragraphs: ['acceptable_use.sections.enforcement.body', 'acceptable_use.sections.enforcement.appeal'],
  },
  {
    titleKey: 'acceptable_use.sections.reporting.title',
    paragraphs: ['acceptable_use.sections.reporting.body'],
  },
  {
    titleKey: 'acceptable_use.sections.changes.title',
    paragraphs: ['acceptable_use.sections.changes.body'],
  },
];

export function AcceptableUsePage() {
  const { t } = useTranslation('legal');
  usePageTitle(t('acceptable_use.page_title'));
  const { branding } = useTenant();
  const { document: customDoc, loading } = useLegalDocument('acceptable_use');

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common:loading')} className="flex justify-center items-center min-h-[50vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (customDoc) {
    return (
      <>
        <PageMeta
          title={t('page_meta.acceptable_use.title')}
          description={t('page_meta.acceptable_use.description', { name: branding.name })}
        />
        <CustomLegalDocument document={customDoc} />
      </>
    );
  }

  const platformName = branding?.name || t('acceptable_use.default_platform_name');

  return (
    <>
      <PageMeta
        title={t('page_meta.acceptable_use.title')}
        description={t('page_meta.acceptable_use.description', { name: branding.name })}
      />
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-4xl mx-auto space-y-6"
      >
        <motion.div variants={itemVariants} className="text-center">
          <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 mb-4">
            <ShieldCheck className="w-10 h-10 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-3">
            {t('acceptable_use.heading')}
          </h1>
          <p className="text-theme-muted text-base sm:text-lg max-w-2xl mx-auto">
            {t('acceptable_use.subtitle', { platformName })}
          </p>
          <p className="text-xs text-theme-subtle mt-3">{t('acceptable_use.version')}</p>
        </motion.div>

        <motion.div variants={itemVariants}>
          <GlassCard className="p-6 sm:p-8 space-y-6 legal-content">
            {ACCEPTABLE_USE_SECTIONS.map((section) => (
              <Section key={section.titleKey} icon={section.icon} title={t(section.titleKey)}>
                {section.paragraphs?.map((key) => (
                  <p key={key}>{t(key, { platformName })}</p>
                ))}
                {section.listKey && section.listCount ? (
                  <ul>
                    {Array.from({ length: section.listCount }, (_, index) => (
                      <li key={index}>{t(`${section.listKey}.${index}`)}</li>
                    ))}
                  </ul>
                ) : null}
              </Section>
            ))}
          </GlassCard>
        </motion.div>
      </motion.div>
    </>
  );
}

interface SectionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

function Section({ title, icon, children }: SectionProps) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl sm:text-2xl font-semibold text-theme-primary flex items-center gap-2">
        {icon ? <span className="text-emerald-500 dark:text-emerald-400">{icon}</span> : null}
        {title}
      </h2>
      <div className="text-theme-muted text-sm sm:text-base leading-relaxed space-y-2 [&_ul]:list-disc [&_ul]:ms-6 [&_ul]:space-y-1 [&_strong]:text-theme-primary">
        {children}
      </div>
    </section>
  );
}

export default AcceptableUsePage;
