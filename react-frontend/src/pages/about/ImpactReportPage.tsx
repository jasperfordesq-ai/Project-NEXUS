// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Impact Report Page - Full Social Impact Study (2023) for hOUR Timebank
 *
 * A long-form document-style page covering the complete SROI analysis,
 * member outcomes, activity data, case studies, and recommendations.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import FileText from 'lucide-react/icons/file-text';
import BookOpen from 'lucide-react/icons/book-open';
import BarChart3 from 'lucide-react/icons/chart-column';
import Activity from 'lucide-react/icons/activity';
import Users from 'lucide-react/icons/users';
import Calculator from 'lucide-react/icons/calculator';
import MessageSquare from 'lucide-react/icons/message-square';
import Lightbulb from 'lucide-react/icons/lightbulb';
import Quote from 'lucide-react/icons/quote';
import Download from 'lucide-react/icons/download';
import ExternalLink from 'lucide-react/icons/external-link';
import ChevronRight from 'lucide-react/icons/chevron-right';
import TrendingUp from 'lucide-react/icons/trending-up';
import Heart from 'lucide-react/icons/heart';
import ArrowUp from 'lucide-react/icons/arrow-up';
import Clock from 'lucide-react/icons/clock';
import LogIn from 'lucide-react/icons/log-in';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import Wallet from 'lucide-react/icons/wallet';
import Mail from 'lucide-react/icons/mail';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { PageMeta } from '@/components/seo';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { formatNumber, resolveAssetUrl } from '@/lib/helpers';
import { RelatedPages } from './RelatedPages';

/* ───────────────────────── Constants ───────────────────────── */

const FULL_REPORT_PDF = resolveAssetUrl('/uploads/tenants/hour-timebank/TBI-Social-Impact-Study-Final-Full-Report-May-23.pdf');
const EXEC_SUMMARY_PDF = resolveAssetUrl('/uploads/tenants/hour-timebank/TBI-Social-Impact-Study-Executive-Summary-Design-Version-Final.pdf');

/* ───────────────────────── Animations ───────────────────────── */

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
};

/* ───────────────────────── Table of Contents ───────────────────────── */

const tocSections = [
  { id: 'introduction', icon: BookOpen },
  { id: 'literature', icon: FileText },
  { id: 'activity', icon: Activity },
  { id: 'impact', icon: Users },
  { id: 'sroi', icon: Calculator },
  { id: 'discussion', icon: MessageSquare },
  { id: 'recommendations', icon: Lightbulb },
];

/* ───────────────────────── Component ───────────────────────── */

const scrollTo = (id: string) => {
  const el = document.getElementById(id);
  if (el) {
    const top = el.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top, behavior: 'smooth' });
  }
};

export function ImpactReportPage() {
  const { t } = useTranslation('about');
  const { tenantPath } = useTenant();
  usePageTitle(t('impact_report.page_title'));
  const [activeSection, setActiveSection] = useState('introduction');

  const handleScroll = useCallback(() => {
    const sections = tocSections.map((s) => ({
      id: s.id,
      el: document.getElementById(s.id),
    }));
    for (let i = sections.length - 1; i >= 0; i--) {
      const section = sections[i];
      if (section?.el) {
        const rect = section.el.getBoundingClientRect();
        if (rect.top <= 120) {
          setActiveSection(section.id);
          break;
        }
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <>
    <PageMeta
      title={t('impact_report.page_title')}
      description={t('impact_report.meta_description')}
    />
    <div className="-mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 -my-4 sm:-my-6 md:-my-8 overflow-x-hidden">
      {/* ─── Breadcrumbs ─── */}
      <div className="px-4 sm:px-6 lg:px-8 pt-6">
        <Breadcrumbs items={[
          { label: t('impact_report.breadcrumb_about'), href: '/about' },
          { label: t('impact_report.page_title') },
        ]} />
      </div>

      {/* ─── Hero Section ─── */}
      <section className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-20" aria-hidden="true">
          <div className="absolute top-10 left-1/4 w-72 h-72 bg-emerald-500 rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-1/4 w-72 h-72 bg-cyan-500 rounded-full blur-3xl" />
        </div>

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div {...fadeInUp} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 mb-6">
              <BarChart3 className="w-8 h-8 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
            </div>
          </motion.div>

          <motion.h1
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-3xl sm:text-4xl md:text-5xl font-bold text-theme-primary mb-4"
          >
            {t('impact_report.hero_title')}
          </motion.h1>

          <motion.p
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-xl text-theme-muted mb-2"
          >
            {t('impact_report.hero_org_year')}
          </motion.p>

          <motion.p
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="text-sm text-theme-subtle max-w-xl mx-auto mb-8"
          >
            {t('impact_report.hero_description')}
          </motion.p>

          <motion.div
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Button
              as="a"
              href={FULL_REPORT_PDF}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold"
              startContent={<Download className="w-4 h-4" aria-hidden="true" />}
            >
              {t('impact_report.download_full_report')}
            </Button>
            <Button
              as="a"
              href={EXEC_SUMMARY_PDF}
              target="_blank"
              rel="noopener noreferrer"
              variant="bordered"
              className="border-theme-default text-theme-primary hover:bg-theme-hover"
              startContent={<ExternalLink className="w-4 h-4" aria-hidden="true" />}
            >
              {t('impact_report.executive_summary_pdf')}
            </Button>
          </motion.div>
        </div>
      </section>

      {/* ─── Table of Contents ─── */}
      <section className="py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <GlassCard className="p-4 sm:p-6">
              <h2 className="text-sm font-semibold text-theme-subtle uppercase tracking-wider mb-4">
                {t('impact_report.toc_heading')}
              </h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {tocSections.map((section, index) => (
                  <Button
                    key={section.id}
                    type="button"
                    variant="tertiary"
                    onPress={() => scrollTo(section.id)}
                    className={`flex min-h-10 min-w-0 items-center justify-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      activeSection === section.id
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium'
                        : 'text-theme-muted hover:bg-theme-hover/50 hover:text-theme-primary'
                    }`}
                  >
                    <span className="flex-shrink-0 w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {index + 1}
                    </span>
                    <span className="truncate">{t(`impact_report.toc_${section.id}`)}</span>
                  </Button>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 1: Introduction & Context ─── */}
      <section id="introduction" className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={BookOpen} number={1} title={t('impact_report.toc_introduction')} />

            <div className="space-y-6 mt-6">
              <GlassCard className="p-6">
                <p className="text-theme-muted text-sm leading-relaxed mb-4">
                  {t('impact_report.intro_para')}
                </p>

                <h3 className="text-base font-semibold text-theme-primary mb-3">{t('impact_report.study_objectives_heading')}</h3>
                <ul className="space-y-2">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-theme-muted">
                      <ChevronRight className="w-4 h-4 text-emerald-500 dark:text-emerald-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{t(`impact_report.study_objective_${i}`)}</span>
                    </li>
                  ))}
                </ul>
              </GlassCard>

              {/* Case Study: Monica */}
              <CaseStudyCard
                name={t('impact_report.case_study_monica_name')}
                quote={t('impact_report.case_study_monica_quote')}
                accent="emerald"
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 2: Literature Review ─── */}
      <section id="literature" className="py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-emerald-500/5 to-transparent">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={FileText} number={2} title={t('impact_report.toc_literature')} />

            <div className="mt-6">
              <GlassCard className="p-6">
                <p className="text-theme-muted text-sm leading-relaxed mb-4">
                  {t('impact_report.literature_para')}
                </p>

                <div className="grid sm:grid-cols-2 gap-4 mt-4">
                  {[
                    {
                      key: 'wellbeing',
                      color: 'text-accent dark:text-accent',
                      bg: 'bg-accent/10',
                    },
                    {
                      key: 'isolation',
                      color: 'text-rose-500 dark:text-rose-400',
                      bg: 'bg-rose-500/10',
                    },
                    {
                      key: 'economic',
                      color: 'text-[var(--color-warning)]',
                      bg: 'bg-amber-500/10',
                    },
                    {
                      key: 'social-capital',
                      color: 'text-emerald-500 dark:text-emerald-400',
                      bg: 'bg-emerald-500/10',
                    },
                  ].map((item, index) => (
                    <div key={item.key} className={`p-4 rounded-xl ${item.bg}`}>
                      <h4 className={`text-sm font-semibold ${item.color} mb-1`}>{t(`impact_report.lit_review_${index}_title`)}</h4>
                      <p className="text-xs text-theme-muted leading-relaxed">{t(`impact_report.lit_review_${index}_description`)}</p>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 3: TBI Activity ─── */}
      <section id="activity" className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={Activity} number={3} title={t('impact_report.toc_activity')} />

            <div className="space-y-6 mt-6">
              <p className="text-theme-muted text-sm leading-relaxed">
                {t('impact_report.activity_para')}
              </p>

              {/* Activity Stats Table */}
              <GlassCard className="overflow-hidden">
                <Table aria-label={t('impact_report.aria.activity_statistics')} isStriped>
                  <TableHeader>
                    <TableColumn>{t('impact_report.activity_metric_header')}</TableColumn>
                    <TableColumn className="text-right">{t('impact_report.activity_value_header')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {[
                      { icon: Wallet, metric: t('impact_report.activity_metric_0'), value: t('impact_report.activity_value_0'), highlight: false },
                      { icon: ArrowRightLeft, metric: t('impact_report.activity_metric_1'), value: t('impact_report.activity_value_1'), highlight: false },
                      { icon: LogIn, metric: t('impact_report.activity_metric_2'), value: t('impact_report.activity_value_2'), highlight: false },
                      { icon: Clock, metric: t('impact_report.activity_metric_3'), value: t('impact_report.activity_value_3'), highlight: true },
                    ].map((row) => (
                      <TableRow key={row.metric}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-lg bg-emerald-500/10">
                              <row.icon className="w-4 h-4 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                            </div>
                            <span className="text-theme-muted">{row.metric}</span>
                          </div>
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${row.highlight ? 'text-emerald-600 dark:text-emerald-400' : 'text-theme-primary'}`}>
                          {row.value}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </GlassCard>

              <p className="text-xs text-theme-subtle leading-relaxed">
                {t('impact_report.activity_note')}
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 4: Impact & Demographics ─── */}
      <section id="impact" className="py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-accent/5 to-transparent">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={Users} number={4} title={t('impact_report.toc_impact')} />

            <div className="space-y-6 mt-6">
              <GlassCard className="p-6">
                <h3 className="text-base font-semibold text-theme-primary mb-4">{t('impact_report.demographics_heading')}</h3>
                <p className="text-theme-muted text-sm leading-relaxed mb-4">
                  {t('impact_report.demographics_para')}
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { band: '18\u201334', pct: '12%', color: 'from-cyan-500/20 to-blue-500/20' },
                    { band: '35\u201344', pct: '18%', color: 'from-accent/20 to-accent-gradient-end/20' },
                    { band: '45\u201364', pct: '42%', color: 'from-emerald-500/20 to-teal-500/20' },
                    { band: '65+', pct: '28%', color: 'from-amber-500/20 to-orange-500/20' },
                  ].map((age) => (
                    <div key={age.band} className={`p-3 rounded-xl bg-gradient-to-br ${age.color} text-center`}>
                      <p className="text-xs text-theme-subtle mb-1">{t('age_band', { band: age.band })}</p>
                      <p className="text-lg font-bold text-theme-primary">{age.pct}</p>
                    </div>
                  ))}
                </div>
              </GlassCard>

              {/* Outcomes */}
              <div className="grid sm:grid-cols-2 gap-4">
                <GlassCard className="p-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl" aria-hidden="true" />
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 rounded-lg bg-emerald-500/15">
                        <Users className="w-5 h-5 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                      </div>
                      <h3 className="font-semibold text-theme-primary">{t('impact_report.outcome_connection_heading')}</h3>
                    </div>
                    <p className="text-4xl font-bold text-emerald-700 dark:text-emerald-400 mb-1">
                      {formatNumber(0.95, { style: 'percent', maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-sm text-theme-muted">
                      {t('impact_report.outcome_connection_text')}
                    </p>
                  </div>
                </GlassCard>

                <GlassCard className="p-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl" aria-hidden="true" />
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 rounded-lg bg-rose-500/15">
                        <Heart className="w-5 h-5 text-rose-500 dark:text-rose-400" aria-hidden="true" />
                      </div>
                      <h3 className="font-semibold text-theme-primary">{t('impact_report.outcome_wellbeing_heading')}</h3>
                    </div>
                    <p className="text-4xl font-bold text-rose-700 dark:text-rose-400 mb-1">
                      {formatNumber(1, { style: 'percent', maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-sm text-theme-muted">
                      {t('impact_report.outcome_wellbeing_text')}
                    </p>
                  </div>
                </GlassCard>
              </div>

              {/* Case Study: Elaine */}
              <CaseStudyCard
                name={t('impact_report.case_study_elaine_name')}
                quote={t('impact_report.case_study_elaine_quote')}
                accent="indigo"
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 5: SROI Calculation ─── */}
      <section id="sroi" className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={Calculator} number={5} title={t('impact_report.toc_sroi')} />

            <div className="space-y-6 mt-6">
              {/* Big SROI result */}
              <GlassCard className="p-8 sm:p-10 text-center relative overflow-hidden">
                <div className="absolute inset-0 opacity-10 pointer-events-none" aria-hidden="true">
                  <div className="absolute top-0 left-0 w-64 h-64 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-full blur-3xl" />
                  <div className="absolute bottom-0 right-0 w-64 h-64 bg-gradient-to-tr from-amber-500 to-orange-500 rounded-full blur-3xl" />
                </div>

                <div className="relative z-10">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 mb-4">
                    <TrendingUp className="w-7 h-7 text-white" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-semibold text-theme-primary mb-2">{t('impact_report.sroi_heading')}</h3>
                  <p className="text-5xl sm:text-6xl font-extrabold text-gradient mb-3">
                    {t('impact_report.sroi_result_value')}
                  </p>
                  <p className="text-theme-muted text-sm max-w-md mx-auto">
                    {t('impact_report.sroi_description')}
                  </p>
                </div>
              </GlassCard>

              {/* Breakdown table */}
              <GlassCard className="overflow-hidden">
                <div className="p-4 sm:p-6 border-b border-theme-default">
                  <h3 className="text-base font-semibold text-theme-primary">{t('impact_report.sroi_breakdown_heading')}</h3>
                </div>
                <Table aria-label={t('impact_report.aria.sroi_breakdown')} isStriped>
                  <TableHeader>
                    <TableColumn>{t('impact_report.sroi_component_header')}</TableColumn>
                    <TableColumn className="text-right">{t('impact_report.sroi_value_header')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-theme-muted">{t('impact_report.sroi_total_investment')}</TableCell>
                      <TableCell className="text-right font-semibold text-theme-primary">{t('impact_report.sroi_total_investment_value')}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-theme-muted">{t('impact_report.sroi_total_present_value')}</TableCell>
                      <TableCell className="text-right font-semibold text-emerald-700 dark:text-emerald-400">{t('impact_report.sroi_total_present_value_amount')}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-semibold text-theme-primary">{t('impact_report.sroi_net_social_value')}</TableCell>
                      <TableCell className="text-right font-bold text-emerald-700 dark:text-emerald-400">{t('impact_report.sroi_net_social_value_amount')}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-bold text-theme-primary">{t('impact_report.sroi_ratio_label')}</TableCell>
                      <TableCell className="text-right font-extrabold text-emerald-700 dark:text-emerald-400 text-lg">{t('impact_report.sroi_ratio_value')}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </GlassCard>

              <GlassCard className="p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/15 flex-shrink-0">
                    <ArrowUp className="w-4 h-4 text-[var(--color-warning)]" aria-hidden="true" />
                  </div>
                  <p className="text-sm text-theme-muted leading-relaxed">
                    {t('impact_report.sroi_benchmark_note')}
                  </p>
                </div>
              </GlassCard>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 6: Discussion & Learning ─── */}
      <section id="discussion" className="py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-emerald-500/5 to-transparent">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={MessageSquare} number={6} title={t('impact_report.toc_discussion')} />

            <div className="space-y-6 mt-6">
              <GlassCard className="p-6">
                <p className="text-theme-muted text-sm leading-relaxed mb-4">
                  {t('impact_report.discussion_para')}
                </p>

                <div className="space-y-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-start gap-3">
                      <ChevronRight className="w-4 h-4 text-emerald-500 dark:text-emerald-400 flex-shrink-0 mt-1" aria-hidden="true" />
                      <div>
                        <h4 className="text-sm font-semibold text-theme-primary">{t(`impact_report.discussion_factor_${i}_title`)}</h4>
                        <p className="text-sm text-theme-muted leading-relaxed">{t(`impact_report.discussion_factor_${i}_description`)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 7: Recommendations ─── */}
      <section id="recommendations" className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={Lightbulb} number={7} title={t('impact_report.toc_recommendations')} />

            <div className="space-y-6 mt-6">
              <GlassCard className="overflow-hidden">
                <Table aria-label={t('impact_report.aria.recommendations')} isStriped>
                  <TableHeader>
                    <TableColumn className="w-8">#</TableColumn>
                    <TableColumn>{t('impact_report.rec_header')}</TableColumn>
                    <TableColumn>{t('impact_report.rec_priority_header')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {[
                      { key: 'rec-funding', priority: 'Critical' },
                      { key: 'rec-staffing', priority: 'High' },
                      { key: 'rec-measurement', priority: 'High' },
                      { key: 'rec-partnerships', priority: 'Medium' },
                      { key: 'rec-technology', priority: 'Medium' },
                      { key: 'rec-outreach', priority: 'Medium' },
                    ].map((row, idx) => (
                      <TableRow key={row.key}>
                        <TableCell className="text-theme-subtle font-medium">{idx + 1}</TableCell>
                        <TableCell className="text-theme-muted">{t(`impact_report.rec_${idx}`)}</TableCell>
                        <TableCell>
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            row.priority === 'Critical'
                              ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                              : row.priority === 'High'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : 'bg-accent/15 text-accent dark:text-accent'
                          }`}>
                            {row.priority}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </GlassCard>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Related Pages ─── */}
      <RelatedPages current="/impact-report" />

      {/* ─── Downloads & CTA ─── */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <GlassCard className="p-10 sm:p-14 text-center relative overflow-hidden">
              <div className="absolute inset-0 opacity-10 pointer-events-none" aria-hidden="true">
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-accent to-accent-gradient-end rounded-full blur-3xl" />
              </div>

              <div className="relative z-10">
                <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-4">
                  {t('impact_report.cta_heading')}
                </h2>
                <p className="text-theme-muted max-w-lg mx-auto mb-8">
                  {t('impact_report.cta_subtitle')}
                </p>

                <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
                  <Button
                    as="a"
                    href={FULL_REPORT_PDF}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="lg"
                    className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold"
                    startContent={<Download className="w-5 h-5" aria-hidden="true" />}
                  >
                    {t('impact_report.cta_full_report')}
                  </Button>
                  <Button
                    as="a"
                    href={EXEC_SUMMARY_PDF}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="lg"
                    variant="bordered"
                    className="border-theme-default text-theme-primary hover:bg-theme-hover"
                    startContent={<ExternalLink className="w-5 h-5" aria-hidden="true" />}
                  >
                    {t('impact_report.cta_exec_summary')}
                  </Button>
                </div>

                <div className="pt-4 border-t border-theme-default">
                  <p className="text-sm text-theme-subtle mb-3">{t('impact_report.cta_questions')}</p>
                  <Button as={Link} to={tenantPath('/contact')}
                    variant="light"
                    className="text-emerald-600 dark:text-emerald-400"
                    startContent={<Mail className="w-4 h-4" aria-hidden="true" />}
                  >
                    {t('impact_report.cta_contact')}
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

/* ───────────────────────── Sub-Components ───────────────────────── */

interface SectionHeadingProps {
  icon: React.ComponentType<{ className?: string }>;
  number: number;
  title: string;
}

function SectionHeading({ icon: Icon, number, title }: SectionHeadingProps) {
  const { t } = useTranslation('about');
  return (
    <div className="flex items-center gap-3">
      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
        <Icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      </div>
      <div>
        <p className="text-xs text-theme-subtle uppercase tracking-wider font-medium">{t('impact_report.section_label', { number })}</p>
        <h2 className="text-xl sm:text-2xl font-bold text-theme-primary">{title}</h2>
      </div>
    </div>
  );
}

interface CaseStudyCardProps {
  name: string;
  quote: string;
  accent: 'emerald' | 'indigo' | 'amber';
}

const colorMap = {
  emerald: {
    bg: 'bg-emerald-500/5',
    border: 'border-emerald-500/20',
    icon: 'text-emerald-500/60',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  indigo: {
    bg: 'bg-accent/5',
    border: 'border-accent/20',
    icon: 'text-accent/60',
    badge: 'bg-accent/15 text-accent dark:text-accent',
  },
  amber: {
    bg: 'bg-amber-500/5',
    border: 'border-amber-500/20',
    icon: 'text-[var(--color-warning)]/60',
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
};

function CaseStudyCard({ name, quote, accent }: CaseStudyCardProps) {
  const { t } = useTranslation('about');
  const colors = colorMap[accent];

  return (
    <GlassCard className={`p-6 ${colors.bg} border ${colors.border}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${colors.badge}`}>
          {t('impact_report.case_study_label')}
        </span>
        <span className="text-sm font-medium text-theme-primary">{name}</span>
      </div>
      <div className="flex gap-3">
        <Quote className={`w-5 h-5 ${colors.icon} flex-shrink-0 mt-0.5`} aria-hidden="true" />
        <p className="text-sm italic text-theme-muted leading-relaxed">
          &ldquo;{quote}&rdquo;
        </p>
      </div>
    </GlassCard>
  );
}

export default ImpactReportPage;
