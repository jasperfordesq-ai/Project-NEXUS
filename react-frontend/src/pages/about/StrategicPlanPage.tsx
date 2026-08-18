// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Strategic Plan Page - hOUR Timebank Strategic Plan 2026-2030
 *
 * Covers vision, mission, SWOT analysis, strategic pillars with KPIs,
 * Year 1 roadmap, and risk mitigation.
 */

import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Compass from 'lucide-react/icons/compass';
import Download from 'lucide-react/icons/download';
import Eye from 'lucide-react/icons/eye';
import Rocket from 'lucide-react/icons/rocket';
import Target from 'lucide-react/icons/target';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import TrendingUp from 'lucide-react/icons/trending-up';
import Lightbulb from 'lucide-react/icons/lightbulb';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import Sprout from 'lucide-react/icons/sprout';
import DollarSign from 'lucide-react/icons/dollar-sign';
import Calendar from 'lucide-react/icons/calendar';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Mail from 'lucide-react/icons/mail';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { PageMeta } from '@/components/seo';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { resolveAssetUrl } from '@/lib/helpers';
import { RelatedPages } from './RelatedPages';

/* ───────────────────────── Constants ───────────────────────── */

const STRATEGIC_PLAN_PDF = resolveAssetUrl('/uploads/tenants/hour-timebank/Timebank-Ireland-Strategic-Plan-2026-2030.pdf');

/* ───────────────────────── Animations ───────────────────────── */

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
};

/* ───────────────────────── Table of Contents ───────────────────────── */

const tocSections = [
  { id: 'executive-summary' },
  { id: 'vision-mission' },
  { id: 'swot' },
  { id: 'pillars' },
  { id: 'roadmap' },
  { id: 'risks' },
];

/* ───────────────────────── Component ───────────────────────── */

const scrollTo = (id: string) => {
  const el = document.getElementById(id);
  if (el) {
    const top = el.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top, behavior: 'smooth' });
  }
};

export function StrategicPlanPage() {
  const { t } = useTranslation('about');
  const { tenantPath } = useTenant();
  usePageTitle(t('strategic_plan.page_title'));

  return (
    <>
    <PageMeta
      title={t('strategic_plan.page_title')}
      description={t('strategic_plan.meta_description')}
    />
    <div className="-mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 -my-4 sm:-my-6 md:-my-8 overflow-x-hidden">
      {/* ─── Breadcrumbs ─── */}
      <div className="px-4 sm:px-6 lg:px-8 pt-6">
        <Breadcrumbs items={[
          { label: t('strategic_plan.breadcrumb_about'), href: '/about' },
          { label: t('strategic_plan.breadcrumb_plan') },
        ]} />
      </div>

      {/* ─── Hero Section ─── */}
      <section className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-20" aria-hidden="true">
          <div className="absolute top-10 left-1/4 w-72 h-72 bg-accent rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-1/4 w-72 h-72 bg-accent rounded-full blur-3xl" />
        </div>

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div {...fadeInUp} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 mb-6">
              <Compass className="w-8 h-8 text-accent dark:text-accent" aria-hidden="true" />
            </div>
          </motion.div>

          <motion.h1
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-3xl sm:text-4xl md:text-5xl font-bold text-theme-primary mb-4"
          >
            {t('strategic_plan.page_title')}
          </motion.h1>

          <motion.p
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg sm:text-xl text-theme-muted max-w-2xl mx-auto mb-3"
          >
            {t('strategic_plan.hero_tagline')}
          </motion.p>

          <motion.p
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="text-sm text-theme-subtle max-w-xl mx-auto mb-8"
          >
            {t('strategic_plan.hero_subtitle')}
          </motion.p>

          <motion.div
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <Button
              as="a"
              href={STRATEGIC_PLAN_PDF}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white font-semibold"
              startContent={<Download className="w-4 h-4" aria-hidden="true" />}
            >
              {t('strategic_plan.download_plan')}
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
                {t('strategic_plan.toc_heading')}
              </h2>
              <div className="flex flex-wrap gap-2">
                {tocSections.map((section, index) => (
                  <Button
                    key={section.id}
                    type="button"
                    variant="tertiary"
                    onPress={() => scrollTo(section.id)}
                    className="flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-theme-muted transition-colors hover:bg-accent/10 hover:text-accent dark:hover:text-accent"
                  >
                    <span className="flex-shrink-0 w-6 h-6 rounded-md bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 flex items-center justify-center text-xs font-bold text-accent dark:text-accent">
                      {index + 1}
                    </span>
                    <span>{t(`strategic_plan.toc_${section.id}`)}</span>
                  </Button>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 1: Executive Summary ─── */}
      <section id="executive-summary" className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={Target} number={1} title={t('strategic_plan.toc_executive-summary')} />

            <div className="space-y-6 mt-6">
              <GlassCard className="p-6">
                <p className="text-theme-muted text-sm leading-relaxed mb-6">
                  {t('strategic_plan.exec_summary_para')}
                </p>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="p-5 rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/20">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 rounded-lg bg-emerald-500/15">
                        <Sprout className="w-5 h-5 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                      </div>
                      <h3 className="font-semibold text-theme-primary">{t('strategic_plan.goal_1_heading')}</h3>
                    </div>
                    <p className="text-sm text-theme-muted leading-relaxed">
                      {t('strategic_plan.goal_1_text')}
                    </p>
                  </div>

                  <div className="p-5 rounded-xl bg-gradient-to-br from-accent/10 to-blue-500/10 border border-accent/20">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 rounded-lg bg-accent/15">
                        <DollarSign className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                      </div>
                      <h3 className="font-semibold text-theme-primary">{t('strategic_plan.goal_2_heading')}</h3>
                    </div>
                    <p className="text-sm text-theme-muted leading-relaxed">
                      {t('strategic_plan.goal_2_text')}
                    </p>
                  </div>
                </div>
              </GlassCard>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 2: Vision & Mission ─── */}
      <section id="vision-mission" className="py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-accent/5 to-transparent">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={Eye} number={2} title={t('strategic_plan.toc_vision-mission')} />

            <div className="grid sm:grid-cols-2 gap-6 mt-6">
              {/* Mission */}
              <GlassCard className="p-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-accent to-blue-500 rounded-l" aria-hidden="true" />
                <div className="pl-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-2 rounded-lg bg-accent/15">
                      <Rocket className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                    </div>
                    <h3 className="text-lg font-bold text-accent dark:text-accent">{t('strategic_plan.mission_heading')}</h3>
                  </div>
                  <p className="text-sm text-theme-muted leading-relaxed">
                    {t('strategic_plan.mission_text')}
                  </p>
                </div>
              </GlassCard>

              {/* Vision */}
              <GlassCard className="p-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-emerald-500 to-teal-500 rounded-l" aria-hidden="true" />
                <div className="pl-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-2 rounded-lg bg-emerald-500/15">
                      <Eye className="w-5 h-5 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                    </div>
                    <h3 className="text-lg font-bold text-theme-success">{t('strategic_plan.vision_heading')}</h3>
                  </div>
                  <p className="text-sm text-theme-muted leading-relaxed">
                    {t('strategic_plan.vision_text')}
                  </p>
                </div>
              </GlassCard>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 3: SWOT Analysis ─── */}
      <section id="swot" className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={ShieldAlert} number={3} title={t('strategic_plan.toc_swot')} />

            <div className="grid sm:grid-cols-2 gap-4 mt-6">
              {/* Strengths */}
              <SwotCard
                title={t('strategic_plan.swot_strengths_title')}
                accent="emerald"
                icon={CheckCircle2}
                items={[0, 1, 2, 3, 4].map(i => t(`strategic_plan.swot_strengths_${i}`))}
              />

              {/* Weaknesses */}
              <SwotCard
                title={t('strategic_plan.swot_weaknesses_title')}
                accent="rose"
                icon={AlertTriangle}
                items={[0, 1, 2, 3, 4].map(i => t(`strategic_plan.swot_weaknesses_${i}`))}
              />

              {/* Opportunities */}
              <SwotCard
                title={t('strategic_plan.swot_opportunities_title')}
                accent="indigo"
                icon={Lightbulb}
                items={[0, 1, 2, 3, 4].map(i => t(`strategic_plan.swot_opportunities_${i}`))}
              />

              {/* Threats */}
              <SwotCard
                title={t('strategic_plan.swot_threats_title')}
                accent="amber"
                icon={ShieldAlert}
                items={[0, 1, 2, 3, 4].map(i => t(`strategic_plan.swot_threats_${i}`))}
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 4: Strategic Pillars ─── */}
      <section id="pillars" className="py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-accent/5 to-transparent">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={TrendingUp} number={4} title={t('strategic_plan.toc_pillars')} />

            <div className="space-y-8 mt-6">
              {/* Pillar 1 */}
              <GlassCard className="overflow-hidden">
                <div className="p-5 sm:p-6 border-b border-theme-default bg-gradient-to-r from-emerald-500/5 to-teal-500/5">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-emerald-500/15">
                      <Sprout className="w-5 h-5 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-xs text-theme-subtle uppercase tracking-wider font-medium">{t('strategic_plan.pillar_1_label')}</p>
                      <h3 className="text-lg font-bold text-theme-primary">{t('strategic_plan.pillar_1_title')}</h3>
                    </div>
                  </div>
                </div>
                <Table aria-label={t('strategic_plan.aria.pillar_1_initiatives')} isStriped>
                  <TableHeader>
                    <TableColumn>{t('strategic_plan.pillar_initiative_header')}</TableColumn>
                    <TableColumn>{t('strategic_plan.pillar_priority_header')}</TableColumn>
                    <TableColumn>{t('strategic_plan.pillar_kpi_header')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {[0, 1, 2, 3, 4, 5].map((idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-theme-muted">{t(`strategic_plan.pillar_1_row_${idx}_initiative`)}</TableCell>
                        <TableCell>
                          <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-theme-success">
                            {t(`strategic_plan.pillar_1_row_${idx}_priority`)}
                          </span>
                        </TableCell>
                        <TableCell className="text-theme-muted">{t(`strategic_plan.pillar_1_row_${idx}_kpi`)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </GlassCard>

              {/* Pillar 2 */}
              <GlassCard className="overflow-hidden">
                <div className="p-5 sm:p-6 border-b border-theme-default bg-gradient-to-r from-accent/5 to-blue-500/5">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-accent/15">
                      <DollarSign className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-xs text-theme-subtle uppercase tracking-wider font-medium">{t('strategic_plan.pillar_2_label')}</p>
                      <h3 className="text-lg font-bold text-theme-primary">{t('strategic_plan.pillar_2_title')}</h3>
                    </div>
                  </div>
                </div>
                <Table aria-label={t('strategic_plan.aria.pillar_2_initiatives')} isStriped>
                  <TableHeader>
                    <TableColumn>{t('strategic_plan.pillar_initiative_header')}</TableColumn>
                    <TableColumn>{t('strategic_plan.pillar_priority_header')}</TableColumn>
                    <TableColumn>{t('strategic_plan.pillar_kpi_header')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {[0, 1, 2, 3, 4, 5].map((idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-theme-muted">{t(`strategic_plan.pillar_2_row_${idx}_initiative`)}</TableCell>
                        <TableCell>
                          <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent/15 text-accent dark:text-accent">
                            {t(`strategic_plan.pillar_2_row_${idx}_priority`)}
                          </span>
                        </TableCell>
                        <TableCell className="text-theme-muted">{t(`strategic_plan.pillar_2_row_${idx}_kpi`)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </GlassCard>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 5: Year 1 Roadmap ─── */}
      <section id="roadmap" className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={Calendar} number={5} title={t('strategic_plan.toc_roadmap')} />

            <div className="mt-6">
              <GlassCard className="overflow-hidden">
                <Table aria-label={t('strategic_plan.aria.year_1_roadmap')} isStriped>
                  <TableHeader>
                    <TableColumn className="min-w-[160px]">{t('strategic_plan.roadmap_activity_header')}</TableColumn>
                    <TableColumn className="text-center min-w-[90px]">{t('strategic_plan.roadmap_q1')}</TableColumn>
                    <TableColumn className="text-center min-w-[90px]">{t('strategic_plan.roadmap_q2')}</TableColumn>
                    <TableColumn className="text-center min-w-[90px]">{t('strategic_plan.roadmap_q3')}</TableColumn>
                    <TableColumn className="text-center min-w-[90px]">{t('strategic_plan.roadmap_q4')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {[
                      {
                        key: 'roadmap-funding',
                        q1: 'submit' as const,
                        q2: 'secure' as const,
                        q3: null,
                        q4: null,
                      },
                      {
                        key: 'roadmap-platform',
                        q1: 'pitch' as const,
                        q2: 'launch' as const,
                        q3: 'launch' as const,
                        q4: 'launch' as const,
                      },
                      {
                        key: 'roadmap-onboarding',
                        q1: null,
                        q2: 'pitch' as const,
                        q3: 'ongoing' as const,
                        q4: 'ongoing' as const,
                      },
                      {
                        key: 'roadmap-partnerships',
                        q1: null,
                        q2: 'launch' as const,
                        q3: 'ongoing' as const,
                        q4: 'ongoing' as const,
                      },
                      {
                        key: 'roadmap-measurement',
                        q1: 'pitch' as const,
                        q2: 'pitch' as const,
                        q3: 'secure' as const,
                        q4: null,
                      },
                      {
                        key: 'roadmap-operations',
                        q1: 'ongoing' as const,
                        q2: 'ongoing' as const,
                        q3: 'ongoing' as const,
                        q4: 'ongoing' as const,
                      },
                      {
                        key: 'roadmap-expansion',
                        q1: 'submit' as const,
                        q2: 'secure' as const,
                        q3: null,
                        q4: null,
                      },
                      {
                        key: 'roadmap-evaluation',
                        q1: null,
                        q2: null,
                        q3: null,
                        q4: 'launch' as const,
                      },
                    ].map((row, idx) => {
                      const qCell = (cell: RoadmapBadgeProps['type'] | null, key: string) => (
                        <TableCell key={key} className="text-center">
                          {cell ? <RoadmapBadge label={t(`strategic_plan.badge_${cell}`)} type={cell} /> : (
                            <span className="text-theme-subtle">&mdash;</span>
                          )}
                        </TableCell>
                      );
                      return (
                        <TableRow key={row.key}>
                          <TableCell className="text-theme-muted font-medium">{t(`strategic_plan.roadmap_activity_${idx}`)}</TableCell>
                          {qCell(row.q1, 'q1')}
                          {qCell(row.q2, 'q2')}
                          {qCell(row.q3, 'q3')}
                          {qCell(row.q4, 'q4')}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </GlassCard>

              {/* Badge Legend */}
              <div className="flex flex-wrap gap-3 mt-4 justify-center">
                {(['submit', 'secure', 'launch', 'ongoing', 'pitch'] as const).map((type) => (
                  <div key={type} className="flex items-center gap-1.5">
                    <RoadmapBadge label={t(`strategic_plan.badge_${type}`)} type={type} />
                    <span className="text-xs text-theme-subtle">{t(`strategic_plan.badge_${type}`)}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Section 6: Risk & Mitigation ─── */}
      <section id="risks" className="py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-accent/5 to-transparent">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <SectionHeading icon={ShieldAlert} number={6} title={t('strategic_plan.toc_risks')} />

            <div className="mt-6">
              <GlassCard className="overflow-hidden">
                <Table aria-label={t('strategic_plan.aria.risk_and_mitigation')} isStriped>
                  <TableHeader>
                    <TableColumn>{t('strategic_plan.risk_header')}</TableColumn>
                    <TableColumn className="text-center w-24">{t('strategic_plan.likelihood_header')}</TableColumn>
                    <TableColumn className="text-center w-24">{t('strategic_plan.impact_header')}</TableColumn>
                    <TableColumn>{t('strategic_plan.mitigation_header')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {[
                      { key: 'risk-funding', likelihood: 'High' as const, impact: 'Critical' as const },
                      { key: 'risk-adoption', likelihood: 'Medium' as const, impact: 'High' as const },
                      { key: 'risk-capacity', likelihood: 'Medium' as const, impact: 'Medium' as const },
                      { key: 'risk-technical', likelihood: 'Low' as const, impact: 'Medium' as const },
                      { key: 'risk-retention', likelihood: 'Medium' as const, impact: 'High' as const },
                    ].map((row, idx) => (
                      <TableRow key={row.key}>
                        <TableCell className="text-theme-muted font-medium">{t(`strategic_plan.risk_${idx}_name`)}</TableCell>
                        <TableCell className="text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            row.likelihood === 'High'
                              ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                              : row.likelihood === 'Medium'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          }`}>
                            {t(`strategic_plan.risk_${idx}_likelihood`)}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            row.impact === 'Critical'
                              ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                              : row.impact === 'High'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : 'bg-accent/15 text-accent dark:text-accent'
                          }`}>
                            {t(`strategic_plan.risk_${idx}_impact`)}
                          </span>
                        </TableCell>
                        <TableCell className="text-theme-muted text-xs leading-relaxed">{t(`strategic_plan.risk_${idx}_mitigation`)}</TableCell>
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
      <RelatedPages current="/strategic-plan" />

      {/* ─── CTA Section ─── */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <GlassCard className="p-10 sm:p-14 text-center relative overflow-hidden">
              <div className="absolute inset-0 opacity-10 pointer-events-none" aria-hidden="true">
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-accent to-accent-gradient-end rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-emerald-500 to-teal-500 rounded-full blur-3xl" />
              </div>

              <div className="relative z-10">
                <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-4">
                  {t('strategic_plan.cta_heading')}
                </h2>
                <p className="text-theme-muted max-w-lg mx-auto mb-8">
                  {t('strategic_plan.cta_subtitle')}
                </p>

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button
                    as="a"
                    href={STRATEGIC_PLAN_PDF}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="lg"
                    className="bg-gradient-to-r from-accent to-accent-gradient-end text-white font-semibold px-8"
                    startContent={<Download className="w-5 h-5" aria-hidden="true" />}
                  >
                    {t('strategic_plan.cta_download')}
                  </Button>
                  <Button as={Link} to={tenantPath('/contact')}
                    size="lg"
                    variant="bordered"
                    className="w-full sm:w-auto border-theme-default text-theme-primary hover:bg-theme-hover"
                    startContent={<Mail className="w-5 h-5" aria-hidden="true" />}
                  >
                    {t('strategic_plan.cta_contact')}
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
      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 flex items-center justify-center">
        <Icon className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
      </div>
      <div>
        <p className="text-xs text-theme-subtle uppercase tracking-wider font-medium">{t('strategic_plan.section_label', { number })}</p>
        <h2 className="text-xl sm:text-2xl font-bold text-theme-primary">{title}</h2>
      </div>
    </div>
  );
}

/* ─── SWOT Card ─── */

interface SwotCardProps {
  title: string;
  accent: 'emerald' | 'rose' | 'indigo' | 'amber';
  icon: React.ComponentType<{ className?: string }>;
  items: string[];
}

const colorMap = {
  emerald: {
    gradient: 'from-emerald-500/10 to-teal-500/10',
    border: 'border-emerald-500/20',
    iconBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-500 dark:text-emerald-400',
    titleColor: 'text-emerald-600 dark:text-emerald-400',
    bullet: 'text-emerald-500 dark:text-emerald-400',
  },
  rose: {
    gradient: 'from-rose-500/10 to-pink-500/10',
    border: 'border-rose-500/20',
    iconBg: 'bg-rose-500/15',
    iconColor: 'text-rose-500 dark:text-rose-400',
    titleColor: 'text-rose-600 dark:text-rose-400',
    bullet: 'text-rose-500 dark:text-rose-400',
  },
  indigo: {
    gradient: 'from-accent/10 to-blue-500/10',
    border: 'border-accent/20',
    iconBg: 'bg-accent/15',
    iconColor: 'text-accent dark:text-accent',
    titleColor: 'text-accent dark:text-accent',
    bullet: 'text-accent dark:text-accent',
  },
  amber: {
    gradient: 'from-amber-500/10 to-orange-500/10',
    border: 'border-amber-500/20',
    iconBg: 'bg-amber-500/15',
    iconColor: 'text-[var(--color-warning)]',
    titleColor: 'text-amber-600 dark:text-amber-400',
    bullet: 'text-[var(--color-warning)]',
  },
};

function SwotCard({ title, accent, icon: Icon, items }: SwotCardProps) {
  const colors = colorMap[accent];

  return (
    <GlassCard className={`p-5 border ${colors.border} bg-gradient-to-br ${colors.gradient}`}>
      <div className="flex items-center gap-2 mb-4">
        <div className={`p-2 rounded-lg ${colors.iconBg}`}>
          <Icon className={`w-5 h-5 ${colors.iconColor}`} aria-hidden="true" />
        </div>
        <h3 className={`text-base font-bold ${colors.titleColor}`}>{title}</h3>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-theme-muted">
            <ChevronRight className={`w-3.5 h-3.5 ${colors.bullet} flex-shrink-0 mt-0.5`} aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

/* ─── Roadmap Badge ─── */

interface RoadmapBadgeProps {
  label: string;
  type: 'submit' | 'secure' | 'launch' | 'ongoing' | 'pitch';
}

const styles = {
  submit: 'bg-accent/15 text-accent dark:text-accent',
  secure: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  launch: 'bg-accent/15 text-accent dark:text-accent',
  ongoing: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  pitch: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};

function RoadmapBadge({ label, type }: RoadmapBadgeProps) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${styles[type]}`}>
      {label}
    </span>
  );
}

export default StrategicPlanPage;
