// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The admin dashboard's nudge towards "Make it yours" (warmth phase 6).
 *
 * Shown only while something is left to do, and only until this admin hides
 * it. It says nothing while it loads or if the read fails: a dashboard must
 * not gain an error box for an optional reminder. Hiding it is remembered in
 * this browser only (a per-viewer convenience); the page stays in the menu.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Sparkles from 'lucide-react/icons/sparkles';
import X from 'lucide-react/icons/x';
import { Button, Card } from '@/components/ui';
import { useTenant } from '@/contexts';
import { SetupProgress } from './SetupProgress';
import { useCommunitySetup } from './useCommunitySetup';

/** One key per community, so hiding it for one does not hide it for another. */
export function makeItYoursDismissKey(tenantId: number | string | null | undefined): string {
  return `nexus_make_it_yours_hidden_${tenantId ?? 'unknown'}`;
}

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function MakeItYoursCard() {
  const { t } = useTranslation('admin_system');
  const { tenant, tenantPath } = useTenant();
  const key = makeItYoursDismissKey(tenant?.id);
  const [dismissed, setDismissed] = useState(() => readDismissed(key));
  // No suggested colours here, so the server need not open the logo file.
  const { status } = useCommunitySetup(false);

  if (dismissed || status === null || status.total === 0 || status.done >= status.total) {
    return null;
  }

  const hide = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      // Private window or blocked storage: hidden for this visit only.
    }
  };

  return (
    <Card
      data-testid="make-it-yours-card"
      aria-labelledby="make-it-yours-card-title"
      className="rounded-2xl border border-accent/30 bg-accent-soft p-4 shadow-sm shadow-black/[0.03] sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-accent-soft-foreground"
        >
          <Sparkles size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="make-it-yours-card-title" className="text-base font-semibold tracking-tight text-foreground">
            {t('admin_settings.miy_card_title')}
          </h2>
          <p className="mt-0.5 text-sm leading-5 text-foreground">
            {t('admin_settings.miy_card_text', { name: tenant?.name || t('system.your_community') })}
          </p>
        </div>
        <Button
          isIconOnly
          size="sm"
          variant="tertiary"
          aria-label={t('admin_settings.miy_card_hide')}
          onPress={hide}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      </div>

      <SetupProgress status={status} className="mt-4" />

      <div className="mt-4">
        <Button
          as={Link}
          to={tenantPath('/admin/make-it-yours')}
          size="sm"
          variant="primary"
          endContent={<ArrowRight size={14} aria-hidden="true" />}
        >
          {status.done === 0 ? t('admin_settings.miy_card_start') : t('admin_settings.miy_card_continue')}
        </Button>
      </div>
    </Card>
  );
}

export default MakeItYoursCard;
