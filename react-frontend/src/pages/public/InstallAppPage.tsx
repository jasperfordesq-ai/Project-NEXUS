// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Install app page ("Get the app").
 *
 * The native app (Expo, mobile/) is published as one all-communities app,
 * "Timebank Global", on Google Play (since 2026-08-26) and on Apple's App
 * Store (since 2026-10-31). This page leads with the two official store
 * badges, then offers QR codes for visitors on a computer, then the website as
 * the always-available alternative and the home-screen (PWA) steps.
 *
 * 🔴 The early-release notice must stay above the store badges in reading
 * order: the owner asked for it to remain while these are early versions, and
 * a test pins the order.
 *
 * Store badges are the official artwork, served locally from
 * public/images/store-badges/ in every language Apple and Google publish one
 * for. Both companies' guidelines forbid altering the artwork, so the badges
 * are only ever scaled — never recoloured, cropped or redrawn — and the
 * trademark attribution at the foot of the page is required by both.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import Bell from 'lucide-react/icons/bell';
import Camera from 'lucide-react/icons/camera';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import Download from 'lucide-react/icons/download';
import Globe from 'lucide-react/icons/globe';
import HelpCircle from 'lucide-react/icons/help-circle';
import Laptop from 'lucide-react/icons/laptop';
import LifeBuoy from 'lucide-react/icons/life-buoy';
import Mail from 'lucide-react/icons/mail';
import MessageSquareHeart from 'lucide-react/icons/message-square-heart';
import QrCode from 'lucide-react/icons/qr-code';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Smartphone from 'lucide-react/icons/smartphone';
import Users from 'lucide-react/icons/users';
import Zap from 'lucide-react/icons/zap';
// Imported from the focused modules rather than the '@/components/ui' barrel:
// public route surfaces are performance-critical and the barrel would pull every
// primitive into this chunk (enforced by scripts/check-bundle-budget.mjs).
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Tab, Tabs } from '@/components/ui/Tabs';
import { PageMeta } from '@/components/seo/PageMeta';
import { QrCodeImage } from '@/components/volunteering/QrCodeImage';
import { useAuth, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { useInstallPrompt } from '@/lib/installPrompt';
import {
  ANDROID_PLAY_STORE_URL,
  IOS_APP_STORE_URL,
  NATIVE_APP_STORE_NAME,
} from '@/config/externalLinks';

type DeviceKey = 'android' | 'iphone' | 'windows' | 'mac';
type StoreKey = 'apple' | 'google';

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

/**
 * Languages with an official localised badge. Apple publishes none in Irish
 * and Google none in Irish, so `ga` (and anything unknown) gets the English
 * artwork; the link text around it is still translated.
 */
const APPLE_BADGE_LANGS = new Set(['en', 'ar', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt']);
const GOOGLE_BADGE_LANGS = APPLE_BADGE_LANGS;

function badgeLang(language: string | undefined, available: Set<string>): string {
  const base = (language ?? 'en').toLowerCase().split('-')[0] ?? 'en';
  return available.has(base) ? base : 'en';
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

interface StoreBadgeProps {
  store: StoreKey;
  language: string | undefined;
  label: string;
  testId: string;
}

/**
 * One official store badge as a link. The two artworks are drawn differently:
 * Apple's SVG is the badge alone (40 units tall), while Google's PNG carries
 * transparent clear space on every side (the badge is 167 of its 250 pixels
 * tall). Scaling Google's image to 1.5x the height and pulling the spare space
 * back with negative margin makes the two visible badges the same height,
 * without touching the artwork itself.
 */
function StoreBadge({ store, language, label, testId }: StoreBadgeProps) {
  const isApple = store === 'apple';
  const lang = badgeLang(language, isApple ? APPLE_BADGE_LANGS : GOOGLE_BADGE_LANGS);
  const src = isApple
    ? `/images/store-badges/app-store-${lang}.svg`
    : `/images/store-badges/google-play-${lang}.png`;

  return (
    <a
      href={isApple ? IOS_APP_STORE_URL : ANDROID_PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center rounded-lg transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent motion-reduce:transition-none motion-reduce:hover:scale-100"
      data-testid={testId}
    >
      {isApple ? (
        <img src={src} alt={label} width={150} height={50} className="h-[50px] w-auto" />
      ) : (
        <img src={src} alt={label} width={194} height={75} className="-mx-[12px] -my-[12.5px] h-[75px] w-auto max-w-none" />
      )}
    </a>
  );
}

export function InstallAppPage() {
  const { t, i18n } = useTranslation('public');
  const { branding, tenantPath } = useTenant();
  const install = useInstallPrompt();
  const { isAuthenticated } = useAuth();
  // AWID accessibility report (Oct 2026), point 15: the QR codes were the only
  // way from a computer to the app, and a blind member cannot scan one. A
  // signed-in member can have the links emailed to their own address.
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const emailLinks = async () => {
    setEmailState('sending');
    try {
      const response = await api.post('/v2/app-links/email', {});
      setEmailState(response.success ? 'sent' : 'failed');
    } catch {
      setEmailState('failed');
    }
  };

  // Falls back to a neutral name so the {{name}} placeholder can never render
  // literally when tenant bootstrap has not settled (same guard as the legal
  // pages — see TrustSafetyPage).
  const appName = branding.name?.trim() || 'this platform';
  usePageTitle(t('install_app.page_title'));

  const detected = useMemo(() => detectDevice(install.browser), [install.browser]);
  const [device, setDevice] = useState<DeviceKey>(detected);

  // An Android visitor sees Google Play first; everyone else sees Apple first.
  const storeOrder: StoreKey[] = detected === 'android' ? ['google', 'apple'] : ['apple', 'google'];
  const badgeLabel = (store: StoreKey) =>
    store === 'apple' ? t('install_app.badge_apple_alt') : t('install_app.badge_google_alt');

  const deviceTabs: Array<{ key: DeviceKey; label: string; icon: typeof Smartphone }> = [
    { key: 'android', label: t('install_app.steps_tab_android'), icon: Smartphone },
    { key: 'iphone', label: t('install_app.steps_tab_iphone'), icon: Smartphone },
    { key: 'windows', label: t('install_app.steps_tab_windows'), icon: Laptop },
    { key: 'mac', label: t('install_app.steps_tab_mac'), icon: Laptop },
  ];

  const features = [
    { key: 'notifications', icon: Bell, tone: 'text-amber-500', toneBg: 'from-amber-500/20 to-amber-500/5' },
    { key: 'camera', icon: Camera, tone: 'text-sky-500', toneBg: 'from-sky-500/20 to-sky-500/5' },
    { key: 'speed', icon: Zap, tone: 'text-violet-500', toneBg: 'from-violet-500/20 to-violet-500/5' },
    { key: 'communities', icon: Users, tone: 'text-emerald-500', toneBg: 'from-emerald-500/20 to-emerald-500/5' },
  ];

  const faqs = ['free', 'account', 'name', 'early', 'devices', 'website', 'pwa'];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="mx-auto max-w-5xl space-y-8 px-1 py-4 sm:space-y-10 sm:px-4 sm:py-8"
      data-testid="install-app-page"
    >
      <PageMeta
        title={t('install_app.page_title')}
        description={t('install_app.meta_description', { name: appName })}
      />

      {/* Hero — heading, the early-release notice, then the two store badges. */}
      <motion.section variants={itemVariants} aria-labelledby="install-hero-heading">
        <GlassCard className="relative overflow-hidden p-6 text-center sm:p-10">
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/15 via-transparent to-accent-gradient-end/15"
            aria-hidden="true"
          />
          <div className="relative flex flex-col items-center">
            <Chip size="sm" variant="flat" color="success" className="mb-4">
              {t('install_app.hero_tag')}
            </Chip>
            <div className="mb-4 inline-flex rounded-2xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 p-4">
              <Smartphone className="h-9 w-9 text-accent" aria-hidden="true" />
            </div>
            <h1
              id="install-hero-heading"
              className="mb-3 text-3xl font-bold text-theme-primary sm:text-5xl"
            >
              {t('install_app.heading')}
            </h1>
            <p className="mx-auto mb-6 max-w-2xl text-base text-theme-secondary sm:text-lg">
              {t('install_app.subheading', { name: appName, app: NATIVE_APP_STORE_NAME })}
            </p>

            {/* Sits directly above the store badges so nobody reaches a store
                link without reading that the app is still in development. */}
            <div
              className="mb-6 max-w-2xl rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-start"
              data-testid="install-early-notice"
              role="note"
            >
              <p className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-theme-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('install_app.early_title')}
              </p>
              <p className="text-sm leading-relaxed text-theme-secondary">
                {t('install_app.early_body')}
              </p>
            </div>

            <div
              className="flex flex-wrap items-center justify-center gap-4"
              data-testid="install-store-badges"
            >
              {storeOrder.map((store) => (
                <StoreBadge
                  key={store}
                  store={store}
                  language={i18n.language}
                  label={badgeLabel(store)}
                  testId={`install-badge-${store}`}
                />
              ))}
            </div>

            <ul className="mt-5 flex flex-col items-center gap-1.5 text-sm text-theme-muted sm:flex-row sm:gap-5">
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                {t('install_app.fact_free')}
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                {t('install_app.fact_ios')}
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                {t('install_app.fact_android')}
              </li>
            </ul>
          </div>
        </GlassCard>
      </motion.section>

      {/* QR codes for visitors on a computer. Hidden on phone-sized screens,
          where scanning a code on your own screen is impossible and the badges
          above already open the store app; kept on tablets and up. Each code
          reuses QrCodeImage, which lazy-loads the generator and degrades to a
          plain link, so this can never become a dead end on a stale deploy. */}
      <motion.section
        variants={itemVariants}
        aria-labelledby="install-qr-heading"
        className="hidden sm:block"
        data-testid="install-qr-section"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="inline-flex rounded-xl bg-accent/10 p-2.5">
            <QrCode className="h-5 w-5 text-accent" aria-hidden="true" />
          </div>
          <div>
            <h2 id="install-qr-heading" className="text-2xl font-bold text-theme-primary">
              {t('install_app.qr_title')}
            </h2>
            <p className="text-sm text-theme-secondary">{t('install_app.qr_intro')}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['apple', 'google'] as StoreKey[]).map((store) => (
            <GlassCard key={store} className="flex flex-col items-center gap-4 p-6 text-center">
              <h3 className="text-lg font-semibold text-theme-primary">
                {t(store === 'apple' ? 'install_app.qr_apple_title' : 'install_app.qr_google_title')}
              </h3>
              <div className="rounded-2xl bg-white p-3 shadow-sm">
                <QrCodeImage
                  value={store === 'apple' ? IOS_APP_STORE_URL : ANDROID_PLAY_STORE_URL}
                  alt={t(store === 'apple' ? 'install_app.qr_apple_alt' : 'install_app.qr_google_alt')}
                  size={168}
                />
              </div>
              {/* The link as plain text too, so it can be read aloud, copied
                  or typed on the phone without scanning anything. */}
              <p
                className="max-w-full select-all break-all text-xs text-theme-secondary"
                data-testid={`install-qr-link-${store}`}
              >
                {store === 'apple' ? IOS_APP_STORE_URL : ANDROID_PLAY_STORE_URL}
              </p>
              <StoreBadge
                store={store}
                language={i18n.language}
                label={badgeLabel(store)}
                testId={`install-qr-badge-${store}`}
              />
            </GlassCard>
          ))}
        </div>
        {isAuthenticated ? (
          <GlassCard className="mt-4 flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-theme-secondary">{t('install_app.email_links_hint')}</p>
            <Button
              variant="flat"
              className="w-full shrink-0 bg-accent/10 text-accent hover:bg-accent/20 sm:w-auto"
              startContent={<Mail className="h-4 w-4" aria-hidden="true" />}
              isLoading={emailState === 'sending'}
              isDisabled={emailState === 'sent'}
              onPress={() => { void emailLinks(); }}
              data-testid="install-email-links"
            >
              {t('install_app.email_links_button')}
            </Button>
          </GlassCard>
        ) : null}
        <p role="status" className="mt-2 text-sm text-theme-secondary" data-testid="install-email-links-status">
          {emailState === 'sent' ? t('install_app.email_links_sent') : null}
          {emailState === 'failed' ? t('install_app.email_links_failed') : null}
        </p>
      </motion.section>

      {/* What the app gives you over the website. */}
      <motion.section variants={itemVariants} aria-labelledby="install-features-heading">
        <h2 id="install-features-heading" className="mb-2 text-2xl font-bold text-theme-primary">
          {t('install_app.features_title')}
        </h2>
        <p className="mb-5 text-sm text-theme-secondary sm:text-base">
          {t('install_app.features_intro', { name: appName })}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <GlassCard key={feature.key} className="flex h-full flex-row items-start gap-4 p-5">
                <div className={`inline-flex shrink-0 rounded-xl bg-gradient-to-br ${feature.toneBg} p-2.5`}>
                  <Icon className={`h-5 w-5 ${feature.tone}`} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="mb-1 text-base font-semibold text-theme-primary">
                    {t(`install_app.feature_${feature.key}_title`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-theme-secondary">
                    {t(`install_app.feature_${feature.key}_body`, { name: appName })}
                  </p>
                </div>
              </GlassCard>
            );
          })}
        </div>
      </motion.section>

      {/* Early feedback invitation — the reason this is framed as an early release. */}
      <motion.section variants={itemVariants} aria-labelledby="install-feedback-heading">
        <GlassCard className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="inline-flex h-fit shrink-0 self-start rounded-xl bg-accent/10 p-3">
            <MessageSquareHeart className="h-6 w-6 text-accent" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h2 id="install-feedback-heading" className="mb-1.5 text-lg font-semibold text-theme-primary">
              {t('install_app.feedback_title')}
            </h2>
            <p className="text-sm leading-relaxed text-theme-secondary">
              {t('install_app.feedback_body')}
            </p>
          </div>
          <Button
            as={Link}
            to={tenantPath('/contact')}
            variant="flat"
            className="w-full shrink-0 bg-accent/10 text-accent hover:bg-accent/20 sm:w-auto"
            data-testid="install-feedback-cta"
          >
            {t('install_app.feedback_cta')}
          </Button>
        </GlassCard>
      </motion.section>

      {/* The website: always available, and the most stable option while the
          apps are early releases. Only the action at the bottom varies (one-tap
          install where the browser offered a prompt, a confirmation if already
          installed, otherwise the steps further down). */}
      <motion.section variants={itemVariants} aria-labelledby="install-web-stable-heading">
        <GlassCard
          className="!border-2 !border-emerald-500/50 p-5 sm:p-6"
          data-testid="install-web-stable"
        >
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 p-2.5">
              <Globe className="h-5 w-5 text-emerald-500" aria-hidden="true" />
            </div>
            <Chip size="sm" variant="flat" color="success">
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {t('install_app.web_stable_tag')}
              </span>
            </Chip>
          </div>
          <h2
            id="install-web-stable-heading"
            className="mb-3 text-xl font-bold text-theme-primary sm:text-2xl"
          >
            {t('install_app.web_stable_title', { name: appName })}
          </h2>
          <p className="mb-4 text-base leading-relaxed text-theme-primary">
            {t('install_app.web_stable_lead')}
          </p>
          <ul className="mb-4 space-y-2">
            {['web_stable_point_2', 'web_stable_point_3'].map((key) => (
              <li key={key} className="flex items-start gap-2 text-sm text-theme-secondary sm:text-base">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                <span>{t(`install_app.${key}`)}</span>
              </li>
            ))}
          </ul>
          <p className="mb-5 text-sm leading-relaxed text-theme-secondary">
            {t('install_app.web_stable_install_note')}
          </p>

          {install.isInstalled ? (
            <Alert
              color="success"
              title={t('install_app.already_installed_title')}
              description={t('install_app.already_installed_body')}
            />
          ) : install.canPrompt ? (
            <div className="flex flex-col items-center gap-2">
              <Button
                size="lg"
                className="w-full bg-gradient-to-r from-accent-strong to-accent-strong-end text-white sm:w-auto sm:px-10"
                startContent={<Download className="h-5 w-5" aria-hidden="true" />}
                onPress={() => { void install.promptInstall(); }}
                data-testid="install-app-prompt"
              >
                {t('install_app.install_now')}
              </Button>
              <p className="text-sm text-theme-muted">{t('install_app.install_now_hint')}</p>
            </div>
          ) : (
            <Button
              as="a"
              href="#install-steps"
              variant="flat"
              className="w-full bg-accent/10 text-accent hover:bg-accent/20 sm:w-auto"
              data-testid="install-web-stable-steps"
            >
              {t('install_app.web_stable_steps_cta')}
            </Button>
          )}
        </GlassCard>
      </motion.section>

      {/* Frequently asked questions. */}
      <motion.section variants={itemVariants} aria-labelledby="install-faq-heading">
        <h2 id="install-faq-heading" className="mb-4 flex items-center gap-2 text-2xl font-bold text-theme-primary">
          <HelpCircle className="h-6 w-6 shrink-0 text-accent" aria-hidden="true" />
          {t('install_app.faq_title')}
        </h2>
        <Accordion variant="splitted" selectionMode="multiple" data-testid="install-faq">
          {faqs.map((key) => {
            const question = t(`install_app.faq_${key}_q`, { app: NATIVE_APP_STORE_NAME });
            return (
              <AccordionItem key={key} id={key} aria-label={question} title={question}>
                <p className="text-sm leading-relaxed text-theme-secondary">
                  {t(`install_app.faq_${key}_a`, { name: appName, app: NATIVE_APP_STORE_NAME })}
                </p>
              </AccordionItem>
            );
          })}
        </Accordion>
      </motion.section>

      {/* Home-screen (PWA) steps, per device. */}
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
              className="w-full bg-gradient-to-r from-accent-strong to-accent-strong-end text-white sm:w-auto"
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

      {/* Required by Apple's and Google's badge guidelines. */}
      <p className="px-2 text-center text-xs leading-relaxed text-theme-muted" data-testid="install-trademarks">
        {t('install_app.trademarks')}
      </p>
    </motion.div>
  );
}

export default InstallAppPage;
