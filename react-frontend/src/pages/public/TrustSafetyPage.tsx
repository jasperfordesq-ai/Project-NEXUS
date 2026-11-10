// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Trust & Safety Page
 *
 * Single-purpose page that bridges the gap between the homepage's friendly
 * member-to-member framing and the legal language in the Terms (which is
 * explicit that the platform is a connection service, does not vet members,
 * does not provide insurance for exchanges, and does not supervise the
 * work members do for each other).
 *
 * Audience: prospective members, social prescribers, funders, and
 * safeguarding-conscious referrers who need a clear, plain-English
 * statement of how trust works on the platform before they sign up
 * or refer someone.
 */

import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import ShieldCheck from 'lucide-react/icons/shield-check';
import ListChecks from 'lucide-react/icons/list-checks';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import Scale from 'lucide-react/icons/scale';
import UserCheck from 'lucide-react/icons/user-check';
import MessageSquare from 'lucide-react/icons/message-square';
import Mail from 'lucide-react/icons/mail';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageMeta } from '@/components/seo/PageMeta';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

interface ListSection {
  icon: typeof ShieldCheck;
  titleKey: string;
  introKey?: string;
  itemsKey: string;
  count: number;
  itemKeyOverrides?: Record<number, string>;
}

const SECTIONS: ListSection[] = [
  { icon: ListChecks, titleKey: 'trust_safety.how_exchanges_title', introKey: 'trust_safety.how_exchanges_intro', itemsKey: 'trust_safety.how_exchanges_steps', count: 5 },
  { icon: ShieldCheck, titleKey: 'trust_safety.what_we_do_title', itemsKey: 'trust_safety.what_we_do_items', count: 6 },
  {
    icon: AlertTriangle,
    titleKey: 'trust_safety.what_we_dont_title',
    introKey: 'trust_safety.what_we_dont_intro',
    itemsKey: 'trust_safety.what_we_dont_items',
    count: 4,
    itemKeyOverrides: { 0: 'trust_safety.what_we_dont_vetting_item' },
  },
  {
    icon: HeartHandshake,
    titleKey: 'trust_safety.precautions_title',
    introKey: 'trust_safety.precautions_intro',
    itemsKey: 'trust_safety.precautions_items',
    count: 4,
    itemKeyOverrides: { 2: 'trust_safety.precautions_vetting_item' },
  },
  { icon: UserCheck, titleKey: 'trust_safety.vetting_title', introKey: 'trust_safety.vetting_attestation_body', itemsKey: '', count: 0 },
  { icon: Scale, titleKey: 'trust_safety.insurance_title', itemsKey: 'trust_safety.insurance_items', count: 4 },
  { icon: MessageSquare, titleKey: 'trust_safety.disputes_title', introKey: 'trust_safety.disputes_intro', itemsKey: 'trust_safety.disputes_steps', count: 4 },
  { icon: ShieldCheck, titleKey: 'trust_safety.responsibilities_title', introKey: 'trust_safety.responsibilities_intro', itemsKey: 'trust_safety.responsibilities_items', count: 5 },
  { icon: ListChecks, titleKey: 'trust_safety.rights_title', itemsKey: 'trust_safety.rights_items', count: 4 },
];

export function TrustSafetyPage() {
  const { t } = useTranslation('legal');
  const { branding, tenantPath } = useTenant();
  usePageTitle(t('trust_safety.page_title'));

  // Robust brand-name resolution so the {{name}} placeholder in the legal
  // copy can never render literally (regression observed when prerender
  // snapshots ran before tenant bootstrap completed — see CHANGELOG 2026-05-14).
  const brandName = branding.name?.trim() || 'this platform';

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-4xl mx-auto space-y-8 px-4 sm:px-6 lg:px-8 py-8"
    >
      <PageMeta
        title={t('trust_safety.page_title')}
        description={t('trust_safety.meta_description', { name: brandName })}
      />

      {/* Hero */}
      <motion.div variants={itemVariants} className="text-center">
        <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-accent-gradient-end/20 mb-4">
          <ShieldCheck className="w-10 h-10 text-emerald-500" aria-hidden="true" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-3">
          {t('trust_safety.heading')}
        </h1>
        <p className="text-theme-muted text-lg max-w-2xl mx-auto">
          {t('trust_safety.subtitle', { name: brandName })}
        </p>
      </motion.div>

      {/* Safeguarding callout — top of page so it's findable in a hurry */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-5 sm:p-6 border-l-4 border-rose-500/60">
          <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-rose-500" aria-hidden="true" />
            {t('trust_safety.safeguarding_title')}
          </h2>
          <p className="text-theme-muted text-sm sm:text-base mb-3">
            {t('trust_safety.safeguarding_body')}
          </p>
          <ul className="text-sm text-theme-muted space-y-1 list-disc pl-5">
            <li>{t('trust_safety.safeguarding_step_1')}</li>
            <li>{t('trust_safety.safeguarding_step_2')}</li>
            <li>{t('trust_safety.safeguarding_step_3')}</li>
          </ul>
        </GlassCard>
      </motion.div>

      {/* Main sections */}
      {SECTIONS.map((section) => {
        const Icon = section.icon;
        const items = section.count > 0
          ? Array.from({ length: section.count }, (_, i) => t(
              section.itemKeyOverrides?.[i] ?? `${section.itemsKey}.${i}`,
              { name: brandName },
            ))
          : [];

        return (
          <motion.div key={section.titleKey} variants={itemVariants}>
            <GlassCard className="p-6 sm:p-8">
              <h2 className="text-xl font-semibold text-theme-primary mb-4 flex items-center gap-2">
                <Icon className="w-5 h-5 text-accent" aria-hidden="true" />
                {t(section.titleKey, { name: brandName })}
              </h2>
              {section.introKey && (
                <p className="text-theme-muted mb-4">{t(section.introKey, { name: brandName })}</p>
              )}
              {items.length > 0 && (
                <ul className="space-y-2">
                  {items.map((item, i) => (
                    <li
                      key={i}
                      className="text-theme-muted flex gap-3"
                    >
                      <span
                        className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent-soft-foreground text-xs font-semibold inline-flex items-center justify-center mt-0.5"
                        aria-hidden="true"
                      >
                        {i + 1}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </motion.div>
        );
      })}

      {/* Contact CTA */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6 sm:p-8 text-center">
          <div className="inline-flex p-3 rounded-xl bg-accent/15 mb-3">
            <Mail className="w-6 h-6 text-accent" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-semibold text-theme-primary mb-2">
            {t('trust_safety.contact_cta_title')}
          </h2>
          <p className="text-theme-muted mb-5 max-w-xl mx-auto">
            {t('trust_safety.contact_cta_body')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button as={Link} to={tenantPath('/contact')} variant="primary" size="lg">
              {t('trust_safety.contact_cta_button')}
            </Button>
            <Button as={Link} to={tenantPath('/community-guidelines')} variant="tertiary" size="lg">
              {t('trust_safety.community_guidelines_link')}
            </Button>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

export default TrustSafetyPage;
