// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner With Us Page - Partnership opportunities, SROI impact, and strategic growth
 *
 * Tenant-specific "About" page for the hOUR Timebank community.
 * Visual sections:
 * 1. Hero with SROI headline
 * 2. Addressing the Funding Gap
 * 3. Impact cards (3-card grid)
 * 4. Partnership Opportunities
 * 5. Learn More sidebar-style links
 * 6. CTA card
 */

import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import Handshake from 'lucide-react/icons/handshake';
import ArrowRight from 'lucide-react/icons/arrow-right';
import TrendingUp from 'lucide-react/icons/trending-up';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Rocket from 'lucide-react/icons/rocket';
import Building2 from 'lucide-react/icons/building-2';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import Laptop from 'lucide-react/icons/laptop';
import GraduationCap from 'lucide-react/icons/graduation-cap';
import BookOpen from 'lucide-react/icons/book-open';
import FileText from 'lucide-react/icons/file-text';
import Users from 'lucide-react/icons/users';
import Target from 'lucide-react/icons/target';
import Lightbulb from 'lucide-react/icons/lightbulb';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageMeta } from '@/components/seo';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { RelatedPages } from './RelatedPages';

/* ───────────────────────── Data ───────────────────────── */

const impactCards = [
  {
    key: 'cost-savings',
    icon: TrendingUp,
    color: 'from-emerald-500 to-teal-500',
    bgAccent: 'bg-emerald-500/10',
    textAccent: 'text-emerald-600 dark:text-emerald-400',
    borderAccent: 'border-emerald-500/30',
  },
  {
    key: 'wellbeing',
    icon: ShieldCheck,
    color: 'from-blue-500 to-accent-gradient-end',
    bgAccent: 'bg-blue-500/10',
    textAccent: 'text-blue-600 dark:text-blue-400',
    borderAccent: 'border-blue-500/30',
  },
  {
    key: 'scalability',
    icon: Rocket,
    color: 'from-accent to-pink-500',
    bgAccent: 'bg-accent/10',
    textAccent: 'text-accent dark:text-accent',
    borderAccent: 'border-accent/30',
  },
];

const partnershipTypes = [
  {
    key: 'funder',
    icon: Building2,
  },
  {
    key: 'community',
    icon: HeartHandshake,
  },
  {
    key: 'technology',
    icon: Laptop,
  },
  {
    key: 'academic',
    icon: GraduationCap,
  },
];

const learnMoreLinks = [
  {
    icon: FileText,
    to: '/impact-summary',
  },
  {
    icon: Target,
    to: '/strategic-plan',
  },
  {
    icon: BookOpen,
    to: '/timebanking-guide',
  },
];

/* ───────────────────────── Animations ───────────────────────── */

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.12 } },
};

/* ───────────────────────── Component ───────────────────────── */

export function PartnerPage() {
  const { t } = useTranslation('about');
  usePageTitle(t('partner.page_title'));
  const { tenantPath } = useTenant();

  return (
    <>
    <PageMeta
      title={t('partner.page_title')}
      description={t('partner.meta_description')}
    />
    <div className="-mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 -my-4 sm:-my-6 md:-my-8 overflow-x-hidden">
      {/* ─── Breadcrumbs ─── */}
      <div className="px-4 sm:px-6 lg:px-8 pt-6">
        <Breadcrumbs items={[
          { label: t('partner.breadcrumb_about'), href: '/about' },
          { label: t('partner.page_title') },
        ]} />
      </div>

      {/* ─── Hero Section ─── */}
      <section className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 pointer-events-none opacity-20" aria-hidden="true">
          <div className="absolute top-10 left-1/3 w-72 h-72 bg-emerald-500 rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-1/3 w-72 h-72 bg-accent rounded-full blur-3xl" />
        </div>

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div {...fadeInUp} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-accent-gradient-end/20 mb-6">
              <Handshake className="w-8 h-8 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
            </div>
          </motion.div>

          <motion.h1
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-3xl sm:text-4xl md:text-5xl font-bold text-theme-primary mb-6"
          >
            {t('partner.page_title')}
          </motion.h1>

          <motion.p
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg sm:text-xl text-theme-muted max-w-2xl mx-auto"
          >
            {t('partner.hero_subtitle')}
          </motion.p>
        </div>
      </section>

      {/* ─── Together for Timebanking banner (prominent) ─── */}
      <section className="pb-4 sm:pb-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="sr-only">{t('partner.together_banner_heading')}</h2>
            {/* The graphic is dark-edged, so it fills the card edge to edge rather than sitting in a white frame. */}
            <div className="rounded-2xl overflow-hidden shadow-xl ring-1 ring-black/5">
              <picture>
                <source srcSet="/images/Timebanking-UK-and-Timebank-Ireland-Partners.webp" type="image/webp" />
                <img
                  src="/images/Timebanking-UK-and-Timebank-Ireland-Partners.webp"
                  alt={t('partner.together_banner_alt')}
                  className="w-full h-auto block"
                  loading="eager"
                  decoding="async"
                  width={1922}
                  height={818}
                />
              </picture>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Timebanking UK partnership announcement ─── */}
      <section className="py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <GlassCard className="p-8 sm:p-10 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 to-emerald-500" aria-hidden="true" />
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 p-3 rounded-xl bg-rose-500/10">
                  <HeartHandshake className="w-6 h-6 text-rose-500 dark:text-rose-400" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-theme-primary mb-4">
                    {t('partner.tbuk_heading')}
                  </h2>
                  <p className="text-theme-muted leading-relaxed mb-4">
                    {t('partner.tbuk_para1')}
                  </p>
                  <p className="text-theme-muted leading-relaxed">
                    {t('partner.tbuk_para2')}
                  </p>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </section>

      {/* ─── Technology Partner: Project NEXUS ─── */}
      <section className="py-12 sm:py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <GlassCard className="p-8 sm:p-10 text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-accent to-accent-gradient-end" aria-hidden="true" />
              <div className="inline-flex items-center justify-center p-2 rounded-xl bg-accent/10 mb-4">
                <Laptop className="w-5 h-5 text-accent" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold uppercase tracking-widest text-accent dark:text-accent mb-4">
                {t('partner.tech_partner_label')}
              </p>
              <picture>
                <source srcSet="/images/project-nexus-logo.webp" type="image/webp" />
                <img
                  src="/images/project-nexus-logo.webp"
                  alt={t('partner.tech_partner_logo_alt')}
                  className="w-64 sm:w-80 mx-auto mb-6"
                  loading="lazy"
                  decoding="async"
                  width={900}
                  height={900}
                />
              </picture>
              <h2 className="text-xl sm:text-2xl font-bold text-theme-primary mb-3">
                {t('partner.tech_partner_heading')}
              </h2>
              <p className="text-theme-muted max-w-xl mx-auto leading-relaxed">
                {t('partner.tech_partner_description')}
              </p>
            </GlassCard>
          </motion.div>
        </div>
      </section>

      {/* ─── Addressing the Funding Gap ─── */}
      <section className="py-12 sm:py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <GlassCard className="p-8 sm:p-10 relative overflow-hidden">
              {/* Accent bar */}
              <div
                className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500"
                aria-hidden="true"
              />

              <div className="flex items-start gap-4 mb-4">
                <div className="flex-shrink-0 p-3 rounded-xl bg-amber-500/15">
                  <Lightbulb className="w-6 h-6 text-[var(--color-warning)]" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-theme-primary mb-3">
                    {t('partner.funding_gap_heading')}
                  </h2>
                  <p className="text-theme-muted leading-relaxed mb-4">
                    {t('partner.funding_gap_para1')}
                  </p>
                  <p className="text-theme-muted leading-relaxed">
                    {t('partner.funding_gap_para2')}
                  </p>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </section>

      {/* ─── Impact Cards ─── */}
      <section className="py-12 sm:py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-emerald-500/5 to-transparent">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-10"
          >
            <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-3">
              {t('partner.why_partner_heading')}
            </h2>
            <p className="text-theme-muted max-w-lg mx-auto">
              {t('partner.why_partner_subtitle')}
            </p>
          </motion.div>

          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={stagger}
            className="grid sm:grid-cols-3 gap-6"
          >
            {impactCards.map((card, index) => (
              <motion.div key={card.key} variants={fadeInUp}>
                <GlassCard className="p-6 h-full text-center relative overflow-hidden group hover:scale-[1.02] transition-transform">
                  {/* Gradient top bar */}
                  <div
                    className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${card.color}`}
                    aria-hidden="true"
                  />

                  <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${card.bgAccent} mb-4`}>
                    <card.icon className={`w-6 h-6 ${card.textAccent}`} aria-hidden="true" />
                  </div>

                  <p className={`text-lg font-extrabold ${card.textAccent} mb-1`}>
                    {t(`partner.impact_card_${index}_highlight`)}
                  </p>
                  <h3 className="font-semibold text-theme-primary mb-2">{t(`partner.impact_card_${index}_title`)}</h3>
                  <p className="text-sm text-theme-muted leading-relaxed">{t(`partner.impact_card_${index}_description`)}</p>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Partner Logos Banner ─── */}
      <section className="py-12 sm:py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <GlassCard className="p-8 sm:p-10 text-center">
              <h2 className="text-xl sm:text-2xl font-bold text-theme-primary mb-6">
                {t('partner.our_partners_heading')}
              </h2>
              <picture>
                <source srcSet="/images/timebank_ireland_west_cork_partnership.webp" type="image/webp" />
                <img
                  src="/images/timebank_ireland_west_cork_partnership.webp"
                  alt={t('partner.partners_banner_alt')}
                  className="w-full max-w-3xl mx-auto rounded-lg bg-white p-4"
                  loading="lazy"
                  decoding="async"
                  width={700}
                  height={200}
                />
              </picture>
            </GlassCard>
          </motion.div>
        </div>
      </section>

      {/* ─── Partnership Opportunities ─── */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-3">
              {t('partner.partnership_opportunities_heading')}
            </h2>
            <p className="text-theme-muted max-w-lg mx-auto">
              {t('partner.partnership_opportunities_subtitle')}
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 gap-6">
            {partnershipTypes.map((type, index) => (
              <motion.div
                key={type.key}
                initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <GlassCard className="p-6 h-full group hover:scale-[1.01] transition-transform">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 p-3 rounded-xl bg-gradient-to-br from-accent/15 to-accent-gradient-end/15">
                      <type.icon className="w-6 h-6 text-accent dark:text-accent" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-theme-primary text-lg mb-1">{t(`partner.partnership_type_${index}_title`)}</h3>
                      <p className="text-theme-muted text-sm leading-relaxed">{t(`partner.partnership_type_${index}_description`)}</p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Learn More Links ─── */}
      <section className="py-12 sm:py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-accent/5 to-transparent">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-8"
          >
            <h2 className="text-xl sm:text-2xl font-bold text-theme-primary mb-2">
              {t('partner.learn_more_heading')}
            </h2>
          </motion.div>

          <div className="grid gap-4">
            {learnMoreLinks.map((link, linkIndex) => (
              <motion.div
                key={link.to}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: linkIndex * 0.08 }}
              >
                <Link to={tenantPath(link.to)} className="block">
                  <GlassCard className="p-5 group hover:scale-[1.01] transition-transform">
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0 p-2.5 rounded-xl bg-accent/15">
                        <link.icon className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-theme-primary">{t(`partner.learn_more_${linkIndex}_title`)}</h3>
                        <p className="text-sm text-theme-muted">{t(`partner.learn_more_${linkIndex}_description`)}</p>
                      </div>
                      <ArrowRight className="w-5 h-5 text-theme-subtle group-hover:text-accent transition-colors flex-shrink-0" aria-hidden="true" />
                    </div>
                  </GlassCard>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Related Pages ─── */}
      <RelatedPages current="/partner" />

      {/* ─── CTA Section ─── */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <GlassCard className="p-10 sm:p-14 text-center relative overflow-hidden">
              {/* Background gradient */}
              <div className="absolute inset-0 opacity-10 pointer-events-none" aria-hidden="true">
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-accent to-accent-gradient-end rounded-full blur-3xl" />
              </div>

              <div className="relative z-10">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-accent-gradient-end/20 mb-6">
                  <Users className="w-7 h-7 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                </div>

                <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-4">
                  {t('partner.cta_heading')}
                </h2>
                <p className="text-theme-muted max-w-lg mx-auto mb-8">
                  {t('partner.cta_subtitle')}
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button as={Link} to={tenantPath('/contact')}
                    size="lg"
                    className="w-full sm:w-auto bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold px-8"
                    endContent={<ArrowRight className="w-5 h-5" aria-hidden="true" />}
                  >
                    {t('partner.cta_contact')}
                  </Button>

                  <Button as={Link} to={tenantPath('/strategic-plan')}
                    size="lg"
                    variant="bordered"
                    className="w-full sm:w-auto border-theme-default text-theme-primary hover:bg-theme-hover"
                    startContent={<Target className="w-5 h-5" aria-hidden="true" />}
                  >
                    {t('partner.cta_view_plan')}
                  </Button>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </section>
    </div>
    </>
  );
}

export default PartnerPage;
