// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import X from 'lucide-react/icons/x';
import Download from 'lucide-react/icons/download';
import { useTenant } from '@/contexts/TenantContext';
import { useCookieConsent } from '@/contexts/CookieConsentContext';
import { useInstallPrompt, shouldOfferInstall } from '@/lib/installPrompt';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safeStorage';
import { IosInstallModal } from './IosInstallModal';
import { Button } from '@/components/ui/Button';

const DISMISS_KEY = 'nexus_install_banner_dismissed';
const FIRST_SEEN_KEY = 'nexus_install_banner_first_seen';
// Wait this long after first visit before showing the banner — gives the user
// time to actually try the app before we ask them to install it. Stripe,
// Linear, GitHub all use a similar grace period.
const GRACE_MS = 60 * 1000;

/**
 * Dismissible install banner. Shown once per device:
 *   - Hidden if the user has already dismissed it (localStorage flag).
 *   - Hidden if the app is already installed.
 *   - Hidden if no install affordance is available (non-Chromium, non-iOS Safari).
 *   - Hidden for the first GRACE_MS after first visit so we don't ambush
 *     first-time users.
 *
 * Renders inline in Layout above main content. No layout shift on load —
 * the visibility check happens in an effect after mount.
 */
export function InstallBanner() {
  const { t } = useTranslation('common');
  const { branding } = useTenant();
  const { showBanner: isCookieBannerVisible } = useCookieConsent();
  const state = useInstallPrompt();
  const [visible, setVisible] = useState(false);
  const [iosOpen, setIosOpen] = useState(false);
  const appName = branding.name?.trim() || 'NEXUS';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isCookieBannerVisible) {
      setVisible(false);
      return;
    }
    if (!shouldOfferInstall(state)) return;
    if (safeLocalStorageGet(DISMISS_KEY) === '1') return;

    let firstSeen = Number(safeLocalStorageGet(FIRST_SEEN_KEY) || 0);
    if (!firstSeen) {
      firstSeen = Date.now();
      safeLocalStorageSet(FIRST_SEEN_KEY, String(firstSeen));
    }

    const elapsed = Date.now() - firstSeen;
    if (elapsed >= GRACE_MS) {
      setVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), GRACE_MS - elapsed);
    return () => window.clearTimeout(timer);
  }, [isCookieBannerVisible, state]);

  if (!visible || isCookieBannerVisible) return null;

  const dismiss = () => {
    setVisible(false);
    safeLocalStorageSet(DISMISS_KEY, '1');
  };

  const onInstall = () => {
    if (state.canPrompt) {
      void state.promptInstall().then((outcome) => {
        if (outcome === 'accepted') dismiss();
      });
      return;
    }
    if (state.isIosSafari) {
      setIosOpen(true);
    }
  };

  return (
    <>
      <div
        role="region"
        aria-label={t('install.banner_aria')}
        className="relative z-20 mx-3 mt-3 sm:mx-6 sm:mt-4 rounded-xl border border-accent/30 bg-gradient-to-r from-accent/10 to-accent-gradient-end/10 px-4 py-3 flex items-center gap-3"
        data-nosnippet
      >
        <div className="shrink-0 w-9 h-9 rounded-lg bg-accent/20 inline-flex items-center justify-center">
          <Download className="w-4 h-4 text-accent dark:text-accent" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-theme-primary truncate">
            {t('install.banner_title', { appName })}
          </p>
          <p className="text-xs text-theme-muted truncate">
            {state.isIosSafari
              ? t('install.banner_sub_ios')
              : t('install.banner_sub')}
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0 bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
          onPress={onInstall}
        >
          {t('install.cta')}
        </Button>
        <Button
          isIconOnly
          variant="light"
          size="sm"
          aria-label={t('install.banner_dismiss')}
          className="shrink-0 text-theme-muted hover:text-theme-primary"
          onPress={dismiss}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </Button>
      </div>
      <IosInstallModal isOpen={iosOpen} onClose={() => setIosOpen(false)} />
    </>
  );
}

export default InstallBanner;
