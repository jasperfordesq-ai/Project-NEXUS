// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VolunteeringWelcome — a one-time, dismissible "getting started" panel shown to
 * signed-in members the first time they open the volunteering page. It spells out
 * the three-step flow (find → log → get credited) so a first-time volunteer never
 * has to guess. Dismissal is remembered in localStorage; the always-on
 * "How volunteering works" helper remains as a permanent reference afterwards.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import Sparkles from 'lucide-react/icons/sparkles';
import X from 'lucide-react/icons/x';
import Search from 'lucide-react/icons/search';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTenant } from '@/contexts';

const STORAGE_KEY = 'nexus_vol_welcome_dismissed_v1';

/** Whether this browser has already dismissed the welcome. */
export function isVolunteeringWelcomeDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

interface VolunteeringWelcomeProps {
  /** Told when the member dismisses it, so the page can show its short "How it works" line instead. */
  onDismiss?: () => void;
  /** When given, "Find opportunities" moves to the list on this page instead of linking to it. */
  onFind?: () => void;
}

export function VolunteeringWelcome({ onDismiss, onFind }: VolunteeringWelcomeProps = {}) {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const [dismissed, setDismissed] = useState<boolean>(isVolunteeringWelcomeDismissed);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* private mode / storage disabled — still hide for this session */
    }
    setDismissed(true);
    onDismiss?.();
  };

  const steps = [
    { n: 1, title: t('welcome.step1_title'), desc: t('welcome.step1_desc'), tone: 'bg-rose-500/10 text-rose-500' },
    { n: 2, title: t('welcome.step2_title'), desc: t('welcome.step2_desc'), tone: 'bg-sky-500/10 text-sky-500' },
    { n: 3, title: t('welcome.step3_title'), desc: t('welcome.step3_desc'), tone: 'bg-emerald-500/10 text-emerald-500' },
  ];

  return (
    <GlassCard className="relative p-5 border border-rose-500/20">
      <Button
        isIconOnly
        size="sm"
        variant="tertiary"
        className="absolute right-2 top-2 min-h-11 min-w-11 rtl:left-2 rtl:right-auto"
        onPress={dismiss}
        aria-label={t('welcome.dismiss')}
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </Button>

      <div className="flex items-center gap-2 mb-1 pr-8">
        <Sparkles className="w-5 h-5 text-rose-500 shrink-0" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-theme-primary">{t('welcome.title')}</h2>
      </div>
      <p className="text-sm text-theme-muted mb-4">{t('welcome.subtitle')}</p>

      <ol className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {steps.map((s) => (
          <li key={s.n} className="flex items-start gap-3">
            <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${s.tone}`} aria-hidden="true">{s.n}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-theme-primary">{s.title}</p>
              <p className="text-xs text-theme-muted">{s.desc}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 sm:flex-row">
        {onFind ? (
          // Already on the volunteering home: take the member straight to the list.
          <Button
            variant="primary"
            className="min-h-11 w-full sm:w-auto bg-linear-to-r from-rose-600 to-pink-700 text-white"
            startContent={<Search className="w-4 h-4" aria-hidden="true" />}
            onPress={() => { dismiss(); onFind(); }}
          >
            {t('welcome.find_cta')}
          </Button>
        ) : (
          <Button
            as={Link}
            to={tenantPath('/volunteering')}
            variant="primary"
            className="min-h-11 w-full sm:w-auto bg-linear-to-r from-rose-600 to-pink-700 text-white"
            startContent={<Search className="w-4 h-4" aria-hidden="true" />}
            onPress={dismiss}
          >
            {t('welcome.find_cta')}
          </Button>
        )}
        <Button variant="tertiary" className="min-h-11 w-full sm:w-auto" onPress={dismiss}>
          {t('welcome.dismiss')}
        </Button>
      </div>
    </GlassCard>
  );
}

export default VolunteeringWelcome;
