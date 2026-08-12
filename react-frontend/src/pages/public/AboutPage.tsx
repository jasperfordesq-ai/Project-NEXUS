// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * About Page - Platform showcase with mission, how it works, values, and stats
 *
 * Visual sections:
 * 1. Hero banner with mission statement
 * 2. How It Works — 4-step visual guide
 * 3. Core Values — icon cards
 * 4. Platform Stats — live from API
 * 5. CTA section
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import Hexagon from 'lucide-react/icons/hexagon';
import UserPlus from 'lucide-react/icons/user-plus';
import Search from 'lucide-react/icons/search';
import Handshake from 'lucide-react/icons/handshake';
import Coins from 'lucide-react/icons/coins';
import Scale from 'lucide-react/icons/scale';
import Heart from 'lucide-react/icons/heart';
import Shield from 'lucide-react/icons/shield';
import Sprout from 'lucide-react/icons/sprout';
import Users from 'lucide-react/icons/users';
import Clock from 'lucide-react/icons/clock';
import ListTodo from 'lucide-react/icons/list-todo';
import Globe from 'lucide-react/icons/globe';
import ArrowRight from 'lucide-react/icons/arrow-right';
import HelpCircle from 'lucide-react/icons/circle-help';
import Mail from 'lucide-react/icons/mail';
import Code from 'lucide-react/icons/code';
import Crown from 'lucide-react/icons/crown';
import Star from 'lucide-react/icons/star';
import Award from 'lucide-react/icons/award';
import BookOpen from 'lucide-react/icons/book-open';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageMeta } from '@/components/seo';
import { useTenant, useAuth } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import contributors from '@/data/contributors.json';

/* ─────────────── Types ─────────────── */

interface PlatformStats {
  members: number;
  hours_exchanged: number;
  listings: number;
  skills: number;
  communities: number;
}

/* ─────────────── Data ─────────────── */

const steps = [
  {
    icon: UserPlus,
    color: 'from-accent to-blue-500',
  },
  {
    icon: Search,
    color: 'from-accent to-pink-500',
  },
  {
    icon: Handshake,
    color: 'from-cyan-500 to-teal-500',
  },
  {
    icon: Coins,
    color: 'from-amber-500 to-orange-500',
  },
];

const values = [
  {
    icon: Scale,
    color: 'text-accent dark:text-accent',
    bg: 'bg-accent/15',
  },
  {
    icon: Heart,
    color: 'text-rose-500 dark:text-rose-400',
    bg: 'bg-rose-500/15',
  },
  {
    icon: Shield,
    color: 'text-emerald-500 dark:text-emerald-400',
    bg: 'bg-emerald-500/15',
  },
  {
    icon: Sprout,
    color: 'text-teal-500 dark:text-teal-400',
    bg: 'bg-teal-500/15',
  },
];

/* ─────────────── Helpers ─────────────── */

function formatStatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toLocaleString(getFormattingLocale());
}

/* ─────────────── Animations ─────────────── */

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.12 } },
};

/* ─────────────── Component ─────────────── */

export function AboutPage() {
  const { t } = useTranslation('public');
  const { branding, tenantPath } = useTenant();
  usePageTitle(t('about.meta_title', { name: branding?.name || 'About' }));
  const { isAuthenticated } = useAuth();
  const [stats, setStats] = useState<PlatformStats | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  const loadStats = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await api.get<PlatformStats>('/v2/platform/stats');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setStats(response.data);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load platform stats on about page', err);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const statItems = stats
    ? [
        { icon: Users, value: formatStatNumber(stats.members), label: t('about.stats.members') },
        { icon: Clock, value: formatStatNumber(stats.hours_exchanged), label: t('about.stats.hours_exchanged') },
        { icon: ListTodo, value: formatStatNumber(stats.listings), label: t('about.stats.active_listings') },
        { icon: Globe, value: formatStatNumber(stats.communities), label: t('about.stats.communities') },
      ]
    : null;

  return (
    <>
      <PageMeta
        title={t('about.meta_title', { name: branding.name })}
        description={t('about.meta_description', { name: branding.name })}
      />

      <div className="-mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 -my-4 sm:-my-6 md:-my-8 overflow-x-hidden">
        {/* ─── Hero Section ─── */}
        <section className="relative py-20 sm:py-28 px-4 sm:px-6 lg:px-8 overflow-hidden">
          {/* Background blurs */}
          <div className="absolute inset-0 pointer-events-none opacity-20" aria-hidden="true">
            <div className="absolute top-10 left-1/4 w-72 h-72 bg-accent rounded-full blur-3xl" />
            <div className="absolute bottom-10 right-1/4 w-72 h-72 bg-accent rounded-full blur-3xl" />
          </div>

          <div className="max-w-4xl mx-auto text-center relative z-10">
            <motion.div {...fadeInUp} transition={{ duration: 0.6 }}>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 mb-6">
                <Hexagon className="w-8 h-8 text-accent dark:text-accent" aria-hidden="true" />
              </div>
            </motion.div>

            <motion.h1
              {...fadeInUp}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-3xl sm:text-4xl md:text-5xl font-bold text-theme-primary mb-6"
            >
              {t('about.hero_title', { name: branding.name })}
            </motion.h1>

            <motion.p
              {...fadeInUp}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-lg sm:text-xl text-theme-muted max-w-2xl mx-auto"
            >
              {t('about.hero_description', { name: branding.name })}
            </motion.p>
          </div>
        </section>

        {/* ─── How It Works ─── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-3">
                {t('about.how_it_works.title')}
              </h2>
              <p className="text-theme-muted max-w-lg mx-auto">
                {t('about.how_it_works.subtitle')}
              </p>
            </motion.div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {steps.map((step, index) => (
                <motion.div
                  key={step.color}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                >
                  <GlassCard className="p-6 h-full text-center relative group hover:scale-[1.02] transition-transform overflow-hidden">
                    {/* Step number */}
                    <div className="absolute top-2 right-2 w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent-gradient-end flex items-center justify-center text-white text-sm font-bold">
                      {index + 1}
                    </div>

                    <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br ${step.color} mb-4`}>
                      <step.icon className="w-7 h-7 text-white" aria-hidden="true" />
                    </div>

                    <h3 className="font-semibold text-theme-primary mb-2">{t(`about.how_it_works.steps.${index}.title`)}</h3>
                    <p className="text-sm text-theme-muted">{t(`about.how_it_works.steps.${index}.description`)}</p>
                  </GlassCard>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Our Values ─── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-accent/5 to-transparent">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-3">
                {t('about.values.title')}
              </h2>
              <p className="text-theme-muted max-w-lg mx-auto">
                {t('about.values.subtitle', { name: branding.name })}
              </p>
            </motion.div>

            <div className="grid sm:grid-cols-2 gap-6">
              {values.map((value, index) => (
                <motion.div
                  key={value.bg}
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
                        <h3 className="font-semibold text-theme-primary text-lg mb-1">{t(`about.values.items.${index}.title`)}</h3>
                        <p className="text-theme-muted text-sm leading-relaxed">{t(`about.values.items.${index}.description`)}</p>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Platform Stats ─── */}
        {statItems && (
          <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto">
              <motion.div
                initial="initial"
                whileInView="animate"
                viewport={{ once: true }}
                variants={stagger}
                className="grid grid-cols-2 sm:grid-cols-4 gap-6"
              >
                {statItems.map((stat) => (
                  <motion.div key={stat.label} variants={fadeInUp}>
                    <GlassCard className="p-6 text-center">
                      <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-accent/15 mb-3">
                        <stat.icon className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                      </div>
                      <p className="text-2xl sm:text-3xl font-bold text-gradient">{stat.value}</p>
                      <p className="text-sm text-theme-subtle mt-1">{stat.label}</p>
                    </GlassCard>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </section>
        )}

        {/* ─── Credits & Open Source ─── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-accent/5 to-transparent">
          <div className="max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-3">
                {t('about.credits.title')}
              </h2>
              <p className="text-theme-muted max-w-lg mx-auto">
                {t('about.credits.subtitle')}
              </p>
            </motion.div>

            <div className="grid sm:grid-cols-2 gap-6 mb-8">
              {/* Creator & Founders (from contributors.json) */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <GlassCard className="p-6 h-full">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2.5 rounded-xl bg-accent/15">
                      <Crown className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                    </div>
                    <h3 className="font-semibold text-theme-primary text-lg">{t('about.credits.creator')}</h3>
                  </div>
                  {contributors.filter(c => c.type === 'creator').map(c => (
                    <p key={c.name} className="text-theme-primary font-medium mb-4">{c.name}</p>
                  ))}

                  <h4 className="text-sm font-semibold text-theme-muted mb-2">{t('about.credits.founders_heading')}</h4>
                  <ul className="space-y-1 text-sm text-theme-muted">
                    {contributors.filter(c => c.type === 'creator' || c.type === 'founder').map(c => (
                      <li key={c.name}>{c.name}</li>
                    ))}
                  </ul>
                </GlassCard>
              </motion.div>

              {/* Contributors (from contributors.json) */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <GlassCard className="p-6 h-full">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2.5 rounded-xl bg-accent/15">
                      <Star className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                    </div>
                    <h3 className="font-semibold text-theme-primary text-lg">{t('about.credits.contributors')}</h3>
                  </div>
                  <ul className="space-y-2 text-sm text-theme-muted mb-4">
                    {contributors.filter(c => c.type === 'contributor').map(c => (
                      <li key={c.name}><span className="text-theme-primary font-medium">{c.name}</span> — {c.role}</li>
                    ))}
                  </ul>

                  {contributors.some(c => c.note?.includes('social impact study')) && (
                    <>
                      <h4 className="text-sm font-semibold text-theme-muted mb-2">{t('about.credits.research_heading')}</h4>
                      <p className="text-sm text-theme-muted">
                        {t('about.credits.research_description', { name: contributors.find(c => c.note?.includes('social impact study'))?.name })}
                      </p>
                    </>
                  )}
                </GlassCard>
              </motion.div>
            </div>

            {/* Acknowledgements & License (from contributors.json) */}
            <div className="grid sm:grid-cols-2 gap-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
              >
                <GlassCard className="p-6 h-full">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2.5 rounded-xl bg-amber-500/15">
                      <Award className="w-5 h-5 text-[var(--color-warning)]" aria-hidden="true" />
                    </div>
                    <h3 className="font-semibold text-theme-primary text-lg">{t('about.credits.acknowledgements')}</h3>
                  </div>
                  <ul className="space-y-1 text-sm text-theme-muted">
                    {contributors.filter(c => c.type === 'acknowledgement').map(c => (
                      <li key={c.name}>{c.name}{c.role !== 'Research Foundation' ? `, ${c.role}` : ''}</li>
                    ))}
                  </ul>
                </GlassCard>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
              >
                <GlassCard className="p-6 h-full">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2.5 rounded-xl bg-emerald-500/15">
                      <Code className="w-5 h-5 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                    </div>
                    <h3 className="font-semibold text-theme-primary text-lg">{t('about.credits.open_source')}</h3>
                  </div>
                  <p className="text-sm text-theme-muted mb-3">
                    {t('about.credits.license_text')}
                  </p>
                  <div className="flex flex-col gap-2">
                    <a
                      href="https://github.com/jasperfordesq-ai/Project-NEXUS"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm font-medium text-accent dark:text-accent hover:text-accent dark:hover:text-accent transition-colors"
                    >
                      <BookOpen className="w-4 h-4" aria-hidden="true" />
                      {t('about.credits.v1_source')}
                    </a>
                    <a
                      href="https://github.com/jasperfordesq-ai/api.project-nexus.net"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm font-medium text-accent dark:text-accent hover:text-accent dark:hover:text-accent transition-colors"
                    >
                      <BookOpen className="w-4 h-4" aria-hidden="true" />
                      {t('about.credits.v2_source')}
                    </a>
                  </div>
                </GlassCard>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ─── CTA Section ─── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <GlassCard className="p-6 sm:p-10 lg:p-14 text-center relative overflow-hidden">
                {/* Background gradient */}
                <div className="absolute inset-0 opacity-10 pointer-events-none" aria-hidden="true">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-accent to-accent-gradient-end rounded-full blur-3xl" />
                  <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-emerald-500 to-teal-500 rounded-full blur-3xl" />
                </div>

                <div className="relative z-10">
                  <h2 className="text-2xl sm:text-3xl font-bold text-theme-primary mb-4">
                    {t('about.cta.title')}
                  </h2>
                  <p className="text-theme-muted max-w-lg mx-auto mb-8">
                    {t('about.cta.description')}
                  </p>

                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    {isAuthenticated ? (
                      <Button
                        as={Link}
                        to={tenantPath("/dashboard")}
                        size="lg"
                        className="w-full sm:w-auto bg-gradient-to-r from-accent to-accent-gradient-end text-white font-semibold px-8"
                        endContent={<ArrowRight className="w-5 h-5" aria-hidden="true" />}
                      >
                        {t('about.cta.dashboard')}
                      </Button>
                    ) : (
                      <Button
                        as={Link}
                        to={tenantPath("/register")}
                        size="lg"
                        className="w-full sm:w-auto bg-gradient-to-r from-accent to-accent-gradient-end text-white font-semibold px-8"
                        endContent={<ArrowRight className="w-5 h-5" aria-hidden="true" />}
                      >
                        {t('about.cta.join')}
                      </Button>
                    )}

                    <Button
                      as={Link}
                      to={tenantPath("/help")}
                      size="lg"
                      variant="secondary"
                      className="w-full sm:w-auto border-theme-default text-theme-primary hover:bg-theme-hover"
                      startContent={<HelpCircle className="w-5 h-5" aria-hidden="true" />}
                    >
                      {t('about.cta.help_center')}
                    </Button>

                    <Button
                      as={Link}
                      to={tenantPath("/contact")}
                      size="lg"
                      variant="secondary"
                      className="w-full sm:w-auto border-theme-default text-theme-primary hover:bg-theme-hover"
                      startContent={<Mail className="w-5 h-5" aria-hidden="true" />}
                    >
                      {t('about.cta.contact_us')}
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

export default AboutPage;
