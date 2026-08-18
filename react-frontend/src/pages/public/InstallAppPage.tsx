// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Install app page ("Get the app").
 *
 * Replaces the two install affordances that used to fire a browser prompt or a
 * modal straight away: the dismissible Layout banner (withdrawn 2026-08-12) and
 * the profile-menu / mobile-drawer item, which now link here.
 *
 * Why a page and not a prompt: install works today on Android Chrome and on
 * Windows Chrome/Edge, and is unreliable on Apple devices. A one-tap prompt
 * cannot say that, so a large share of members were being offered something
 * that would not work for them. This page explains the options in plain
 * English, states what is broken, and only offers the native prompt on a
 * browser that has actually given us one.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import Apple from 'lucide-react/icons/apple';
import ArrowDownToLine from 'lucide-react/icons/arrow-down-to-line';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import Download from 'lucide-react/icons/download';
import Globe from 'lucide-react/icons/globe';
import HelpCircle from 'lucide-react/icons/help-circle';
import Laptop from 'lucide-react/icons/laptop';
import LifeBuoy from 'lucide-react/icons/life-buoy';
import Smartphone from 'lucide-react/icons/smartphone';
import Store from 'lucide-react/icons/store';
// Imported from the focused modules rather than the '@/components/ui' barrel:
// public route surfaces are performance-critical and the barrel would pull every
// primitive into this chunk (enforced by scripts/check-bundle-budget.mjs).
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Tab, Tabs } from '@/components/ui/Tabs';
import { PageMeta } from '@/components/seo/PageMeta';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { useInstallPrompt } from '@/lib/installPrompt';

type DeviceKey = 'android' | 'iphone' | 'windows' | 'mac';

/**
 * Which device tab to open on. `BrowserKind` already tells us iOS vs Android
 * vs desktop, but every desktop browser except Safari collapses to
 * `chrome-desktop` / `edge-desktop` / `firefox-desktop` regardless of the
 * operating system — so a Mac running Chrome would land on the Windows steps.
 * The user-agent check separates those two.
 */
function detectDevice(browser: string): DeviceKey {
  if (browser === 'ios-safari' || browser === 'ios-other') return 'iphone';
  if (browser === 'chrome-android' || browser === 'samsung' || browser === 'firefox-android') {
    return 'android';
  }
  if (browser === 'macos-safari') return 'mac';
  if (typeof window !== 'undefined' && /Macintosh|Mac OS X/.test(window.navigator.userAgent)) {
    return 'mac';
  }
  return 'windows';
}

const DEVICE_STEPS: Record<DeviceKey, { steps: string[]; noteKey?: string; isApple: boolean }> = {
  android: {
    steps: ['steps_android_1', 'steps_android_2', 'steps_android_3', 'steps_android_4'],
    noteKey: 'steps_android_note',
    isApple: false,
  },
  iphone: {
    steps: ['steps_iphone_1', 'steps_iphone_2', 'steps_iphone_3', 'steps_iphone_4'],
    isApple: true,
  },
  windows: {
    steps: ['steps_windows_1', 'steps_windows_2', 'steps_windows_3', 'steps_windows_4'],
    isApple: false,
  },
  mac: {
    steps: ['steps_mac_1', 'steps_mac_2', 'steps_mac_3', 'steps_mac_4'],
    noteKey: 'steps_mac_note',
    isApple: true,
  },
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export function InstallAppPage() {
  const { t } = useTranslation('public');
  const { branding, tenantPath } = useTenant();
  const install = useInstallPrompt();

  // Falls back to a neutral name so the {{name}} placeholder can never render
  // literally when tenant bootstrap has not settled (same guard as the legal
  // pages — see TrustSafetyPage).
  const appName = branding.name?.trim() || 'this platform';
  usePageTitle(t('install_app.page_title'));

  const detected = useMemo(() => detectDevice(install.browser), [install.browser]);
  const [device, setDevice] = useState<DeviceKey>(detected);

  const deviceTabs: Array<{ key: DeviceKey; label: string; icon: typeof Smartphone }> = [
    { key: 'android', label: t('install_app.steps_tab_android'), icon: Smartphone },
    { key: 'iphone', label: t('install_app.steps_tab_iphone'), icon: Smartphone },
    { key: 'windows', label: t('install_app.steps_tab_windows'), icon: Laptop },
    { key: 'mac', label: t('install_app.steps_tab_mac'), icon: Laptop },
  ];

  const appTypes = [
    {
      id: 'browser',
      icon: Globe,
      tone: 'text-sky-500',
      toneBg: 'from-sky-500/20 to-sky-500/5',
      title: t('install_app.type_browser_title'),
      tag: t('install_app.type_browser_tag'),
      tagColor: 'default' as const,
      body: t('install_app.type_browser_body', { name: appName }),
      points: [
        t('install_app.type_browser_point_1'),
        t('install_app.type_browser_point_2'),
        t('install_app.type_browser_point_3'),
      ],
    },
    {
      id: 'pwa',
      icon: ArrowDownToLine,
      tone: 'text-emerald-500',
      toneBg: 'from-emerald-500/20 to-emerald-500/5',
      title: t('install_app.type_pwa_title'),
      tag: t('install_app.type_pwa_tag'),
      tagColor: 'success' as const,
      body: t('install_app.type_pwa_body', { name: appName }),
      points: [
        t('install_app.type_pwa_point_1'),
        t('install_app.type_pwa_point_2'),
        t('install_app.type_pwa_point_3'),
        t('install_app.type_pwa_point_4'),
        t('install_app.type_pwa_point_5'),
      ],
    },
    {
      // The Expo/React Native app in mobile/ — one codebase targeting both
      // platforms (iOS bundleIdentifier + Android package are both configured in
      // mobile/app.json). Deliberately described as "the proper app" rather than
      // by platform: Android's release path is set up (EAS website/production
      // profiles, managed keystore, FCM) while iOS still needs an Apple
      // developer account and App Store review, which is what type_native_status
      // says. The Capacitor wrapper is deliberately NOT mentioned — it would
      // give members a third thing to choose between while its future is still
      // an open question.
      id: 'native',
      // Third of three cards in a two-column grid, so it spans the full row
      // rather than leaving a hole beside it — and it is the longest card.
      wide: true,
      icon: Store,
      tone: 'text-violet-500',
      toneBg: 'from-violet-500/20 to-violet-500/5',
      title: t('install_app.type_native_title'),
      tag: t('install_app.type_native_tag'),
      tagColor: 'warning' as const,
      body: t('install_app.type_native_body'),
      points: [
        t('install_app.type_native_point_1'),
        t('install_app.type_native_point_2'),
        t('install_app.type_native_point_3'),
        t('install_app.type_native_point_4'),
      ],
      note: t('install_app.type_native_status'),
    },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="mx-auto max-w-4xl space-y-8 px-1 py-4 sm:px-4 sm:py-8"
      data-testid="install-app-page"
    >
      <PageMeta
        title={t('install_app.page_title')}
        description={t('install_app.meta_description', { name: appName })}
      />

      {/* Hero */}
      <motion.header variants={itemVariants} className="text-center">
        <div className="mb-4 inline-flex rounded-2xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 p-4">
          <Download className="h-9 w-9 text-accent" aria-hidden="true" />
        </div>
        <h1 className="mb-3 text-3xl font-bold text-theme-primary sm:text-4xl">
          {t('install_app.heading')}
        </h1>
        <p className="mx-auto max-w-2xl text-base text-theme-secondary sm:text-lg">
          {t('install_app.subheading', { name: appName })}
        </p>
      </motion.header>

      {/* One-tap install, only where the browser actually offered us a prompt. */}
      {install.isInstalled ? (
        <motion.div variants={itemVariants}>
          <Alert
            color="success"
            title={t('install_app.already_installed_title')}
            description={t('install_app.already_installed_body')}
          />
        </motion.div>
      ) : install.canPrompt ? (
        <motion.div variants={itemVariants} className="flex flex-col items-center gap-2">
          <Button
            size="lg"
            className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white sm:w-auto sm:px-10"
            startContent={<Download className="h-5 w-5" aria-hidden="true" />}
            onPress={() => { void install.promptInstall(); }}
            data-testid="install-app-prompt"
          >
            {t('install_app.install_now')}
          </Button>
          <p className="text-sm text-theme-muted">{t('install_app.install_now_hint')}</p>
        </motion.div>
      ) : null}

      {/* Honest status — what works, what does not. */}
      <motion.section variants={itemVariants} aria-labelledby="install-status-heading">
        <GlassCard className="p-5 sm:p-6">
          <h2
            id="install-status-heading"
            className="mb-4 text-xl font-semibold text-theme-primary"
          >
            {t('install_app.status_title')}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('install_app.status_working_label')}
              </p>
              <ul className="space-y-1.5 text-sm text-theme-secondary">
                <li>{t('install_app.status_working_android')}</li>
                <li>{t('install_app.status_working_windows')}</li>
              </ul>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('install_app.status_issues_label')}
              </p>
              <p className="text-sm text-theme-secondary">
                {t('install_app.status_issues_apple', { name: appName })}
              </p>
            </div>
          </div>

          <p className="mt-4 text-sm text-theme-secondary">
            {t('install_app.status_meanwhile', { name: appName })}
          </p>
          <p className="mt-2 text-sm font-medium text-theme-primary">
            {t('install_app.status_updates')}
          </p>
        </GlassCard>
      </motion.section>

      {/* Why Apple is the awkward one. Members were being told "it does not work
          on Apple" with no reason, which reads as our fault. These three points
          are Apple's own platform rules, not a defect we introduced. */}
      <motion.section variants={itemVariants} aria-labelledby="install-apple-heading">
        <GlassCard className="p-5 sm:p-6">
          <h2
            id="install-apple-heading"
            className="mb-2 flex items-center gap-2 text-xl font-semibold text-theme-primary"
          >
            <Apple className="h-5 w-5 shrink-0 text-theme-secondary" aria-hidden="true" />
            {t('install_app.apple_why_title')}
          </h2>
          <p className="mb-4 text-sm text-theme-secondary">
            {t('install_app.apple_why_intro', { name: appName })}
          </p>
          <ol className="space-y-3">
            {['apple_why_1', 'apple_why_2', 'apple_why_3'].map((key, index) => (
              <li key={key} className="flex items-start gap-3">
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-theme-elevated text-xs font-semibold text-theme-secondary"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="text-sm leading-relaxed text-theme-secondary">
                  {t(`install_app.${key}`)}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-lg bg-accent/10 p-3 text-sm font-medium text-theme-primary">
            {t('install_app.apple_why_outcome')}
          </p>
        </GlassCard>
      </motion.section>

      {/* The four kinds of app */}
      <motion.section variants={itemVariants} aria-labelledby="install-types-heading">
        <h2
          id="install-types-heading"
          className="mb-2 text-2xl font-bold text-theme-primary"
        >
          {t('install_app.types_title')}
        </h2>
        <p className="mb-5 text-sm text-theme-secondary sm:text-base">
          {t('install_app.types_intro', { name: appName })}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {appTypes.map((type) => {
            const Icon = type.icon;
            return (
              <GlassCard
                key={type.id}
                className={`flex h-full flex-col gap-3 p-5 ${'wide' in type && type.wide ? 'sm:col-span-2' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`inline-flex rounded-xl bg-gradient-to-br ${type.toneBg} p-2.5`}>
                    <Icon className={`h-5 w-5 ${type.tone}`} aria-hidden="true" />
                  </div>
                  <Chip size="sm" variant="flat" color={type.tagColor}>
                    {type.tag}
                  </Chip>
                </div>

                <h3 className="text-lg font-semibold text-theme-primary">{type.title}</h3>
                <p className="text-sm leading-relaxed text-theme-secondary">{type.body}</p>

                {type.points ? (
                  <ul className="space-y-1.5">
                    {type.points.map((point) => (
                      <li key={point} className="flex items-start gap-2 text-sm text-theme-secondary">
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
                          aria-hidden="true"
                        />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {type.note ? (
                  <p className="mt-auto rounded-lg bg-theme-elevated p-3 text-sm text-theme-muted">
                    {type.note}
                  </p>
                ) : null}

                {type.id === 'pwa' ? (
                  <Button
                    as="a"
                    href="#install-steps"
                    variant="flat"
                    size="sm"
                    className="mt-3 w-full bg-accent/10 text-accent hover:bg-accent/20"
                  >
                    {t('install_app.type_pwa_cta')}
                  </Button>
                ) : null}
              </GlassCard>
            );
          })}
        </div>
      </motion.section>

      {/* Per-device steps */}
      <motion.section
        variants={itemVariants}
        id="install-steps"
        aria-labelledby="install-steps-heading"
        className="scroll-mt-24"
      >
        <h2
          id="install-steps-heading"
          className="mb-2 text-2xl font-bold text-theme-primary"
        >
          {t('install_app.steps_title')}
        </h2>
        <p className="mb-4 text-sm text-theme-secondary sm:text-base">
          {t('install_app.steps_intro')}
        </p>

        <Tabs
          aria-label={t('install_app.steps_title')}
          selectedKey={device}
          onSelectionChange={(key) => setDevice(String(key) as DeviceKey)}
          variant="bordered"
          classNames={{ tabList: 'w-full', panel: 'pt-4' }}
        >
          {deviceTabs.map((tab) => {
            const TabIcon = tab.icon;
            const config = DEVICE_STEPS[tab.key];
            return (
              <Tab
                key={tab.key}
                title={
                  <span className="flex items-center gap-1.5">
                    <TabIcon className="h-4 w-4" aria-hidden="true" />
                    {tab.label}
                  </span>
                }
              >
                <GlassCard className="p-5 sm:p-6">
                  <h3 className="mb-4 text-lg font-semibold text-theme-primary">
                    {t(`install_app.steps_${tab.key}_title`)}
                  </h3>

                  {config.isApple ? (
                    <div className="mb-4">
                      <Alert color="warning" description={t('install_app.steps_apple_warning')} />
                    </div>
                  ) : null}

                  <ol className="space-y-4">
                    {config.steps.map((stepKey, index) => (
                      <li key={stepKey} className="flex items-start gap-3">
                        <span
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent"
                          aria-hidden="true"
                        >
                          {index + 1}
                        </span>
                        <span className="pt-0.5 text-sm leading-relaxed text-theme-secondary">
                          {t(`install_app.${stepKey}`)}
                        </span>
                      </li>
                    ))}
                  </ol>

                  {config.noteKey ? (
                    <p className="mt-5 rounded-lg bg-theme-elevated p-3 text-sm text-theme-muted">
                      {t(`install_app.${config.noteKey}`)}
                    </p>
                  ) : null}
                </GlassCard>
              </Tab>
            );
          })}
        </Tabs>

        <GlassCard className="mt-4 p-5">
          <h3 className="mb-2 flex items-center gap-2 text-base font-semibold text-theme-primary">
            <HelpCircle className="h-4 w-4 text-accent" aria-hidden="true" />
            {t('install_app.steps_missing_title')}
          </h3>
          <p className="text-sm text-theme-secondary">{t('install_app.steps_missing_body')}</p>
        </GlassCard>
      </motion.section>

      {/* Help */}
      <motion.section variants={itemVariants} aria-labelledby="install-help-heading">
        <GlassCard className="p-5 text-center sm:p-6">
          {/* self-center: GlassCard's Card is a column flexbox, so an
              inline-flex child would otherwise stretch the full card width. */}
          <div className="mb-3 inline-flex self-center rounded-xl bg-accent/10 p-3">
            <LifeBuoy className="h-6 w-6 text-accent" aria-hidden="true" />
          </div>
          <h2
            id="install-help-heading"
            className="mb-2 text-xl font-semibold text-theme-primary"
          >
            {t('install_app.help_title')}
          </h2>
          <p className="mx-auto mb-4 max-w-xl text-sm text-theme-secondary">
            {t('install_app.help_body')}
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              as={Link}
              to={tenantPath('/contact')}
              className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white sm:w-auto"
            >
              {t('install_app.help_cta')}
            </Button>
            <Button
              as={Link}
              to={tenantPath('/help')}
              variant="flat"
              className="w-full bg-theme-elevated text-theme-secondary sm:w-auto"
            >
              {t('install_app.help_secondary_cta')}
            </Button>
          </div>
        </GlassCard>
      </motion.section>
    </motion.div>
  );
}

export default InstallAppPage;
