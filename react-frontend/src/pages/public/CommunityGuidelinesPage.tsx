// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Community Guidelines Page
 *
 * Displays the tenant's custom community guidelines document if one exists.
 * Otherwise falls back to a generic v1.0 default — the same pattern used by
 * TermsPage / PrivacyPage. Trust & Safety links to this page as if it
 * exists, so a real policy is shipped here rather than a "being prepared"
 * placeholder.
 */

import { motion } from '@/lib/motion';import Users from 'lucide-react/icons/users';
import Heart from 'lucide-react/icons/heart';
import Shield from 'lucide-react/icons/shield';
import MessageCircle from 'lucide-react/icons/message-circle';
import EyeOff from 'lucide-react/icons/eye-off';
import Flag from 'lucide-react/icons/flag';
import Gavel from 'lucide-react/icons/gavel';
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

interface GuidelineSectionConfig {
  icon?: React.ReactNode;
  titleKey: string;
  paragraphs?: string[];
  listKey?: string;
  listCount?: number;
}

const GUIDELINE_SECTIONS: GuidelineSectionConfig[] = [
  {
    icon: <Heart className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'community_guidelines.sections.kind.title',
    paragraphs: ['community_guidelines.sections.kind.body'],
    listKey: 'community_guidelines.sections.kind.items',
    listCount: 3,
  },
  {
    icon: <Shield className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'community_guidelines.sections.honest.title',
    paragraphs: ['community_guidelines.sections.honest.body'],
    listKey: 'community_guidelines.sections.honest.items',
    listCount: 4,
  },
  {
    icon: <MessageCircle className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'community_guidelines.sections.relevant.title',
    paragraphs: ['community_guidelines.sections.relevant.body'],
    listKey: 'community_guidelines.sections.relevant.items',
    listCount: 3,
  },
  {
    icon: <EyeOff className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'community_guidelines.sections.privacy.title',
    paragraphs: ['community_guidelines.sections.privacy.body'],
    listKey: 'community_guidelines.sections.privacy.items',
    listCount: 4,
  },
  {
    icon: <Users className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'community_guidelines.sections.in_person.title',
    paragraphs: ['community_guidelines.sections.in_person.body'],
    listKey: 'community_guidelines.sections.in_person.items',
    listCount: 5,
  },
  {
    icon: <Flag className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'community_guidelines.sections.report.title',
    paragraphs: ['community_guidelines.sections.report.body_before'],
    listKey: 'community_guidelines.sections.report.items',
    listCount: 3,
  },
  {
    icon: <Gavel className="w-5 h-5" aria-hidden="true" />,
    titleKey: 'community_guidelines.sections.enforcement.title',
    paragraphs: ['community_guidelines.sections.enforcement.body_before'],
    listKey: 'community_guidelines.sections.enforcement.items',
    listCount: 5,
  },
  {
    titleKey: 'community_guidelines.sections.changes.title',
    paragraphs: ['community_guidelines.sections.changes.body'],
  },
];

export function CommunityGuidelinesPage() {
  const { t } = useTranslation('legal');
  usePageTitle(t('community_guidelines.page_title'));
  const { branding } = useTenant();
  const { document: customDoc, loading } = useLegalDocument('community_guidelines');

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
          title={t('page_meta.community_guidelines.title')}
          description={t('page_meta.community_guidelines.description', { name: branding.name })}
        />
        <CustomLegalDocument document={customDoc} />
      </>
    );
  }

  const communityName = branding?.name || t('community_guidelines.default_community_name');

  return (
    <>
      <PageMeta
        title={t('page_meta.community_guidelines.title')}
        description={t('page_meta.community_guidelines.description', { name: branding.name })}
      />
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-4xl mx-auto space-y-6"
      >
        <motion.div variants={itemVariants} className="text-center">
          <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-blue-500/20 to-accent-gradient-end/20 mb-4">
            <Users className="w-10 h-10 text-[var(--color-info)]" aria-hidden="true" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-3">
            {t('community_guidelines.heading')}
          </h1>
          <p className="text-theme-muted text-base sm:text-lg max-w-2xl mx-auto">
            {t('community_guidelines.subtitle', { communityName })}
          </p>
          <p className="text-xs text-theme-subtle mt-3">{t('community_guidelines.version')}</p>
        </motion.div>

        <motion.div variants={itemVariants}>
          <GlassCard className="p-6 sm:p-8 space-y-6 legal-content">
            {GUIDELINE_SECTIONS.map((section) => (
              <Section key={section.titleKey} icon={section.icon} title={t(section.titleKey)}>
                {section.paragraphs?.map((key) => <p key={key}>{t(key)}</p>)}
                {section.listKey && section.listCount ? (
                  <ul>
                    {Array.from({ length: section.listCount }, (_, index) => (
                      <li key={index}>{t(`${section.listKey}.${index}`)}</li>
                    ))}
                  </ul>
                ) : null}
                {section.titleKey === 'community_guidelines.sections.report.title' && (
                  <p>{t('community_guidelines.sections.report.body_after')}</p>
                )}
                {section.titleKey === 'community_guidelines.sections.enforcement.title' && (
                  <>
                    <p>{t('community_guidelines.sections.enforcement.body_serious')}</p>
                    <p>{t('community_guidelines.sections.enforcement.body_appeal')}</p>
                  </>
                )}
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
        {icon ? <span className="text-[var(--color-info)]">{icon}</span> : null}
        {title}
      </h2>
      <div className="text-theme-muted text-sm sm:text-base leading-relaxed space-y-2 [&_ul]:list-disc [&_ul]:ms-6 [&_ul]:space-y-1 [&_strong]:text-theme-primary">
        {children}
      </div>
    </section>
  );
}

export default CommunityGuidelinesPage;
