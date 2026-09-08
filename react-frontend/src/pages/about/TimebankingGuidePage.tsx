// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Timebanking Guide Page - How timebanking works, impact stats, values, and CTAs
 *
 * Universal "About" page — content is generic to all timebanking communities.
 * Visual sections:
 * 1. Hero with subtitle
 * 2. Impact stats row (3 stat cards)
 * 3. How It Works - 3 simple steps
 * 4. Fundamental Values
 * 5. CTA card
 */

import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import Handshake from 'lucide-react/icons/handshake';
import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import Heart from 'lucide-react/icons/heart';
import ArrowRight from 'lucide-react/icons/arrow-right';
import TrendingUp from 'lucide-react/icons/trending-up';
import Sparkles from 'lucide-react/icons/sparkles';
import BookOpen from 'lucide-react/icons/book-open';
import Gem from 'lucide-react/icons/gem';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Network from 'lucide-react/icons/network';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageMeta } from '@/components/seo';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { useTenant, useAuth } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { RelatedPages } from './RelatedPages';

/* ───────────────────────── Data ───────────────────────── */

const impactStats = [
  {
    value: '16:1',
    color: 'from-accent to-blue-500',
    bgAccent: 'bg-accent/10',
    textAccent: 'text-accent dark:text-accent',
    icon: TrendingUp,
  },
  {
    value: '100%',
    color: 'from-emerald-500 to-teal-500',
    bgAccent: 'bg-emerald-500/10',
    textAccent: 'text-emerald-600 dark:text-emerald-400',
    icon: Heart,
  },
  {
    value: '95%',
    color: 'from-amber-500 to-orange-500',
    bgAccent: 'bg-amber-500/10',
    textAccent: 'text-amber-600 dark:text-amber-400',
    icon: Users,
  },
];

const steps = [
  {
    key: 'offer',
    icon: Handshake,
    color: 'from-accent to-accent-gradient-end',
  },
  {
    key: 'earn',
    icon: Clock,
    color: 'from-emerald-500 to-teal-500',
  },
  {
    key: 'spend',
    icon: Users,
    color: 'from-amber-500 to-orange-500',
  },
];

const values = [
  {
    key: 'equality',
    icon: Gem,
    color: 'text-accent dark:text-accent',
    bg: 'bg-accent/15',
  },
  {
    key: 'reciprocity',
    icon: RefreshCw,
    color: 'text-emerald-500 dark:text-emerald-400',
    bg: 'bg-emerald-500/15',
  },
  {
    key: 'recognition',
    icon: Sparkles,
    color: 'text-[var(--color-warning)]',
    bg: 'bg-amber-500/15',
  },
  {
    key: 'community',
    icon: Network,
    color: 'text-rose-500 dark:text-rose-400',
    bg: 'bg-rose-500/15',
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

export function TimebankingGuidePage() {
  const { t } = useTranslation('about');
  usePageTitle(t('timebanking_guide.page_title'));
  const { tenantPath, hasModule } = useTenant();
  const { isAuthenticated } = useAuth();

  return (
    <>
    <PageMeta
      title={t('timebanking_guide.page_title')}
      description={t('timebanking_guide.meta_description')}
    />
    <div className="-mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 -my-4 sm:-my-6 md:-my-8 overflow-x-hidden">
      {/* ─── Breadcrumbs ─── */}
      <div className="px-4 sm:px-6 lg:px-8 pt-6">
        <Breadcrumbs items={[
          { label: t('timebanking_guide.breadcrumb_about'), href: '/about' },
          { label: t('timebanking_guide.page_title') },
        ]} />
      </div>

      {/* ─── Hero Section ─── */}
      <section className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 pointer-events-none opacity-20" aria-hidden="true">
          <div className="absolute top-10 left-1/4 w-72 h-72 bg-accent rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-1/4 w-72 h-72 bg-emerald-500 rounded-full blur-3xl" />
        </div>

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div {...fadeInUp} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/20 to-emerald-500/20 mb-6">
              <BookOpen className="w-8 h-8 text-accent dark:text-accent" aria-hidden="true" />
            </div>
          </motion.div>

          <motion.h1
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-3xl sm:text-4xl md:text-5xl font-bold text-theme-primary mb-6"
          >
            {t('timebanking_guide.page_title')}
          </motion.h1>

          <motion.p
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg sm:text-xl text-theme-muted max-w-2xl mx-auto"
          >
            {t('timebanking_guide.hero_subtitle')}
          </motion.p>
        </div>
      </section>

      {/* ─── Impact Stats ─── */}
      <section className="py-12 sm:py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-accent/5 to-transparent">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-10"
          >
            <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-3">
              {t('timebanking_guide.proven_impact_heading')}
            </h2>
            <p className="text-theme-muted max-w-lg mx-auto">
              {t('timebanking_guide.proven_impact_subtitle')}
            </p>
          </motion.div>

          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={stagger}
            className="grid sm:grid-cols-3 gap-6"
          >
            {impactStats.map((stat) => (
              <motion.div key={stat.value} variants={fadeInUp}>
                <GlassCard className="p-6 text-center h-full relative overflow-hidden group hover:scale-[1.02] transition-transform">
                  {/* Gradient top bar */}
                  <div
                    className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${stat.color}`}
                    aria-hidden="true"
                  />

                  <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${stat.bgAccent} mb-4`}>
                    <stat.icon className={`w-6 h-6 ${stat.textAccent}`} aria-hidden="true" />
                  </div>

                  <p className={`text-4xl sm:text-5xl font-extrabold ${stat.textAccent} mb-2`}>
                    {stat.value}
                  </p>
                  <p className="font-semibold text-theme-primary mb-1">{t(`timebanking_guide.stat_${stat.value.replace(/[:%]/g, '')}_label`)}</p>
                  <p className="text-sm text-theme-muted">{t(`timebanking_guide.stat_${stat.value.replace(/[:%]/g, '')}_description`)}</p>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── How It Works: 3 Simple Steps ─── */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-3">
              {t('timebanking_guide.how_it_works_heading')}
            </h2>
            <p className="text-theme-muted max-w-lg mx-auto">
              {t('timebanking_guide.how_it_works_subtitle')}
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-3 gap-8">
            {steps.map((step, index) => (
              <motion.div
                key={step.key}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.15 }}
              >
                <GlassCard className="p-8 h-full text-center relative group hover:scale-[1.02] transition-transform overflow-hidden">
                  {/* Step number badge */}
                  <div className="absolute top-2 right-2 w-9 h-9 rounded-full bg-gradient-to-br from-accent to-accent-gradient-end flex items-center justify-center text-white text-sm font-bold shadow-lg">
                    {index + 1}
                  </div>

                  <div
                    className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br ${step.color} mb-5`}
                  >
                    <step.icon className="w-8 h-8 text-white" aria-hidden="true" />
                  </div>

                  <h3 className="text-lg font-semibold text-theme-primary mb-3">{t(`timebanking_guide.step_${index}_title`)}</h3>
                  <p className="text-theme-muted leading-relaxed">{t(`timebanking_guide.step_${index}_description`)}</p>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Our Fundamental Values ─── */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-accent-gradient-end/5 to-transparent">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-3">
              {t('timebanking_guide.values_heading')}
            </h2>
            <p className="text-theme-muted max-w-lg mx-auto">
              {t('timebanking_guide.values_subtitle')}
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 gap-6">
            {values.map((value, index) => (
              <motion.div
                key={value.key}
                initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <GlassCard className="p-6 h-full">
                  <div className="flex items-start gap-4">
                    <div className={`flex-shrink-0 p-3 rounded-xl ${value.bg}`}>
                      <value.icon className={`w-6 h-6 ${value.color}`} aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-theme-primary text-lg mb-1">
                        {t(`timebanking_guide.value_${index}_title`)}
                      </h3>
                      <p className="text-theme-muted text-sm leading-relaxed">
                        {t(`timebanking_guide.value_${index}_description`)}
                      </p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Related Pages ─── */}
      <RelatedPages current="/timebanking-guide" />

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
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-accent to-accent-gradient-end rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-emerald-500 to-teal-500 rounded-full blur-3xl" />
              </div>

              <div className="relative z-10">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-accent/20 to-emerald-500/20 mb-6">
                  <Sparkles className="w-7 h-7 text-accent dark:text-accent" aria-hidden="true" />
                </div>

                <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-4">
                  {t('timebanking_guide.cta_heading')}
                </h2>
                <p className="text-theme-muted max-w-lg mx-auto mb-8">
                  {t('timebanking_guide.cta_subtitle')}
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  {isAuthenticated ? (hasModule('listings') ? (
                    <Button
                      as={Link}
                      to={tenantPath('/listings')}
                      size="lg"
                      className="w-full sm:w-auto bg-gradient-to-r from-accent to-accent-gradient-end text-white font-semibold px-8"
                      endContent={<ArrowRight className="w-5 h-5" aria-hidden="true" />}
                    >
                      {t('timebanking_guide.cta_browse_listings')}
                    </Button>
                  ) : null) : (
                    <Button
                      as={Link}
                      to={tenantPath('/register')}
                      size="lg"
                      className="w-full sm:w-auto bg-gradient-to-r from-accent to-accent-gradient-end text-white font-semibold px-8"
                      endContent={<ArrowRight className="w-5 h-5" aria-hidden="true" />}
                    >
                      {t('timebanking_guide.cta_join_free')}
                    </Button>
                  )}

                  <Button
                    as={Link}
                    to={tenantPath('/partner')}
                    size="lg"
                    variant="bordered"
                    className="w-full sm:w-auto border-theme-default text-theme-primary hover:bg-theme-hover"
                    startContent={<Handshake className="w-5 h-5" aria-hidden="true" />}
                  >
                    {t('timebanking_guide.cta_partner')}
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

export default TimebankingGuidePage;
