// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Impact Summary Page - hOUR Timebank social impact overview
 *
 * Highlights the key "1 to 16" social return on investment finding
 * with wellbeing outcomes, public health potential, and strategic document links.
 */

import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import TrendingUp from 'lucide-react/icons/trending-up';
import Heart from 'lucide-react/icons/heart';
import Stethoscope from 'lucide-react/icons/stethoscope';
import FileText from 'lucide-react/icons/file-text';
import Compass from 'lucide-react/icons/compass';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Quote from 'lucide-react/icons/quote';
import Sparkles from 'lucide-react/icons/sparkles';
import Users from 'lucide-react/icons/users';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Mail from 'lucide-react/icons/mail';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageMeta } from '@/components/seo';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { RelatedPages } from './RelatedPages';
import { formatNumber } from '@/lib/helpers';

/* ───────────────────────── Animations ───────────────────────── */

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.12 } },
};

/* ───────────────────────── Component ───────────────────────── */

export function ImpactSummaryPage() {
  const { t } = useTranslation('about');
  const { tenantPath } = useTenant();
  usePageTitle(t('impact_summary.page_title'));

  return (
    <>
    <PageMeta
      title={t('impact_summary.page_title')}
      description={t('impact_summary.meta_description')}
    />
    <div className="-mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 -my-4 sm:-my-6 md:-my-8 overflow-x-hidden">
      {/* ─── Breadcrumbs ─── */}
      <div className="px-4 sm:px-6 lg:px-8 pt-6">
        <Breadcrumbs items={[
          { label: t('impact_summary.breadcrumb_about'), href: '/about' },
          { label: t('impact_summary.page_title') },
        ]} />
      </div>

      {/* ─── Hero Section ─── */}
      <section className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 overflow-hidden">
        {/* Background blurs */}
        <div className="absolute inset-0 pointer-events-none opacity-20" aria-hidden="true">
          <div className="absolute top-10 left-1/4 w-72 h-72 bg-emerald-500 rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-1/4 w-72 h-72 bg-accent rounded-full blur-3xl" />
        </div>

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div {...fadeInUp} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 mb-6">
              <TrendingUp className="w-8 h-8 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
            </div>
          </motion.div>

          <motion.h1
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-3xl sm:text-4xl md:text-5xl font-bold text-theme-primary mb-4"
          >
            {t('impact_summary.page_title')}
          </motion.h1>

          {/* Hero stat */}
          <motion.div
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mb-6"
          >
            <GlassCard className="inline-block px-8 py-5 mx-auto">
              <h2 className="flex items-center gap-3 justify-center text-2xl sm:text-3xl md:text-4xl font-extrabold text-gradient">
                <Sparkles className="w-6 h-6 text-[var(--color-warning)] flex-shrink-0" aria-hidden="true" />
                <span>
                  {t('impact_summary.hero_headline')}
                </span>
              </h2>
            </GlassCard>
          </motion.div>

          <motion.p
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="text-lg text-theme-muted max-w-2xl mx-auto"
          >
            {t('impact_summary.hero_subtitle')}
          </motion.p>
        </div>
      </section>

      {/* ─── Key Stats Banner ─── */}
      <section className="py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={stagger}
            className="grid grid-cols-2 sm:grid-cols-4 gap-4"
          >
            {[
              { value: '€16', label: t('impact_summary.stat_return_label'), icon: TrendingUp, color: 'text-emerald-500 dark:text-emerald-400', bg: 'bg-emerald-500/15' },
              { value: formatNumber(1, { style: 'percent', maximumFractionDigits: 0 }), label: t('impact_summary.stat_wellbeing_label'), icon: Heart, color: 'text-rose-500 dark:text-rose-400', bg: 'bg-rose-500/15' },
              { value: formatNumber(0.95, { style: 'percent', maximumFractionDigits: 0 }), label: t('impact_summary.stat_connected_label'), icon: Users, color: 'text-accent dark:text-accent', bg: 'bg-accent/15' },
              { value: '€803K', label: t('impact_summary.stat_value_label'), icon: ShieldCheck, color: 'text-[var(--color-warning)]', bg: 'bg-amber-500/15' },
            ].map((stat) => (
              <motion.div key={stat.label} variants={fadeInUp}>
                <GlassCard className="p-5 text-center">
                  <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl ${stat.bg} mb-3`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} aria-hidden="true" />
                  </div>
                  <p className="text-2xl sm:text-3xl font-bold text-gradient">{stat.value}</p>
                  <p className="text-sm text-theme-subtle mt-1">{stat.label}</p>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── Two-Column Impact Cards ─── */}
      <section className="py-12 sm:py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Wellbeing Card */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <GlassCard className="p-6 sm:p-8 h-full relative overflow-hidden">
                {/* Green accent line */}
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-emerald-500 to-teal-500 rounded-l" aria-hidden="true" />

                <div className="pl-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2.5 rounded-xl bg-emerald-500/15">
                      <Heart className="w-6 h-6 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                    </div>
                    <h2 className="text-xl font-bold text-theme-primary">{t('impact_summary.wellbeing_heading')}</h2>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-1 w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                        <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                          {formatNumber(1, { style: 'percent', maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      <p className="text-theme-muted text-sm leading-relaxed">
                        {t('impact_summary.wellbeing_100_text')}
                      </p>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-1 w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                        <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                          {formatNumber(0.95, { style: 'percent', maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      <p className="text-theme-muted text-sm leading-relaxed">
                        {t('impact_summary.wellbeing_95_text')}
                      </p>
                    </div>

                    {/* Blockquote */}
                    <div className="mt-6 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                      <div className="flex gap-3">
                        <Quote className="w-5 h-5 text-emerald-500/60 flex-shrink-0 mt-0.5" aria-hidden="true" />
                        <div>
                          <p className="text-sm italic text-theme-muted leading-relaxed">
                            {t('impact_summary.wellbeing_quote')}
                          </p>
                          <p className="text-xs text-theme-subtle mt-2">
                            {t('impact_summary.wellbeing_quote_attribution')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </GlassCard>
            </motion.div>

            {/* Public Health Card */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <GlassCard className="p-6 sm:p-8 h-full relative overflow-hidden">
                {/* Blue accent line */}
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-accent to-blue-500 rounded-l" aria-hidden="true" />

                <div className="pl-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2.5 rounded-xl bg-accent/15">
                      <Stethoscope className="w-6 h-6 text-accent dark:text-accent" aria-hidden="true" />
                    </div>
                    <h2 className="text-xl font-bold text-theme-primary">{t('impact_summary.public_health_heading')}</h2>
                  </div>

                  <div className="space-y-4">
                    <p className="text-theme-muted text-sm leading-relaxed">
                      {t('impact_summary.public_health_para1')}
                    </p>

                    <p className="text-theme-muted text-sm leading-relaxed">
                      {t('impact_summary.public_health_para2')}
                    </p>

                    {/* Blockquote */}
                    <div className="mt-6 p-4 rounded-xl bg-accent/5 border border-accent/20">
                      <div className="flex gap-3">
                        <Quote className="w-5 h-5 text-accent/60 flex-shrink-0 mt-0.5" aria-hidden="true" />
                        <div>
                          <p className="text-sm italic text-theme-muted leading-relaxed">
                            {t('impact_summary.public_health_quote')}
                          </p>
                          <p className="text-xs text-theme-subtle mt-2">
                            {t('impact_summary.public_health_quote_attribution')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ─── Strategic Documents ─── */}
      <section className="py-12 sm:py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-accent/5 to-transparent">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-10"
          >
            <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-3">
              {t('impact_summary.strategic_docs_heading')}
            </h2>
            <p className="text-theme-muted max-w-lg mx-auto">
              {t('impact_summary.strategic_docs_subtitle')}
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Impact Report Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
            >
              <Link to={tenantPath('/impact-report')}>
                <GlassCard hoverable className="p-6 h-full text-center group hover:scale-[1.02] transition-transform">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 mb-4">
                    <FileText className="w-7 h-7 text-white" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-semibold text-theme-primary mb-2">{t('impact_summary.impact_report_title')}</h3>
                  <p className="text-sm text-theme-muted mb-4">
                    {t('impact_summary.impact_report_description')}
                  </p>
                  <div className="flex items-center justify-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400 group-hover:gap-3 transition-all">
                    {t('impact_summary.read_report')} <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </div>
                </GlassCard>
              </Link>
            </motion.div>

            {/* Strategic Plan Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
            >
              <Link to={tenantPath('/strategic-plan')}>
                <GlassCard hoverable className="p-6 h-full text-center group hover:scale-[1.02] transition-transform">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-accent-gradient-end mb-4">
                    <Compass className="w-7 h-7 text-white" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-semibold text-theme-primary mb-2">{t('impact_summary.strategic_plan_title')}</h3>
                  <p className="text-sm text-theme-muted mb-4">
                    {t('impact_summary.strategic_plan_description')}
                  </p>
                  <div className="flex items-center justify-center gap-2 text-sm font-medium text-accent dark:text-accent group-hover:gap-3 transition-all">
                    {t('impact_summary.read_plan')} <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </div>
                </GlassCard>
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ─── Related Pages ─── */}
      <RelatedPages current="/impact-summary" />

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
                <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-4">
                  {t('impact_summary.cta_heading')}
                </h2>
                <p className="text-theme-muted max-w-lg mx-auto mb-8">
                  {t('impact_summary.cta_subtitle')}
                </p>

                <Button as={Link} to={tenantPath('/contact')}
                  size="lg"
                  className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold px-8"
                  startContent={<Mail className="w-5 h-5" aria-hidden="true" />}
                >
                  {t('impact_summary.cta_contact')}
                </Button>
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </section>
    </div>
    </>
  );
}

export default ImpactSummaryPage;
