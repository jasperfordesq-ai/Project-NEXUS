// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GettingStartedCard — one short list for a member with something left to set
 * up (warmth phase 6, B5).
 *
 * The dashboard used to carry two separate nudges for this: a "finish setting
 * up your profile" banner (welcome steps not finished) and a "add a photo of
 * yourself" prompt. A newcomer met both, plus the location prompt and the
 * say-hello strip. This is the one card that replaces the first two: what is
 * done, what is left, and a link to each thing that is left.
 *
 * The list holds only what the community uses: the welcome steps when they are
 * switched on, a photo, and an offer or request when offers and requests are
 * on. It shows while something is left. "Not now" puts it away for 30 days —
 * it never nags — and it is gone for good once everything is done.
 *
 * `hasListing` comes from the dashboard's own figures; null means "not known
 * yet", and the card waits rather than flash a line it may have to tick.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Circle from 'lucide-react/icons/circle';
import Sparkles from 'lucide-react/icons/sparkles';
import X from 'lucide-react/icons/x';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { isStockAvatar } from '@/components/ui/Avatar';
import { useAuth, useTenant } from '@/contexts';
import { isNewMember } from '@/lib/newMember';
import { welcomeStepsSwitchedOn } from '@/lib/welcomeSteps';

const DAY_MS = 86_400_000;
const QUIET_FOR_DAYS = 30;

/** Where "Not now" is remembered. The second key is the old photo prompt's: a member who put that away stays undisturbed. */
function storageKeys(userId: unknown): string[] {
  return [`nexus_getting_started_closed_${String(userId)}`, `nexus_photo_prompt_closed_${String(userId)}`];
}

function isQuiet(keys: string[], now: number): boolean {
  try {
    return keys.some((key) => {
      const closedAt = Number(localStorage.getItem(key));
      return Number.isFinite(closedAt) && closedAt > 0 && now - closedAt < QUIET_FOR_DAYS * DAY_MS;
    });
  } catch {
    return false;
  }
}

/** True when the member has uploaded a photo of their own (the stock silhouette does not count). */
export function hasOwnPhoto(user: { avatar?: string | null; avatar_url?: string | null } | null | undefined): boolean {
  const photo = user?.avatar_url || user?.avatar;
  return Boolean(photo) && !isStockAvatar(photo);
}

export interface GettingStartedCardProps {
  /** Whether the member has an offer or request up. null = not known yet. */
  hasListing: boolean | null;
  /** Whether this community uses offers and requests. */
  listingsOn: boolean;
  className?: string;
}

export function GettingStartedCard({ hasListing, listingsOn, className = '' }: GettingStartedCardProps) {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const { tenant, branding, tenantPath } = useTenant();
  const keys = storageKeys(user?.id);
  const [closed, setClosed] = useState(() => isQuiet(keys, Date.now()));

  if (!user?.id || closed || hasListing === null) return null;

  const stepsOn = welcomeStepsSwitchedOn(tenant?.settings as Record<string, unknown> | undefined);
  const items = [
    ...(stepsOn
      ? [{
          key: 'steps',
          done: user.onboarding_completed !== false,
          to: tenantPath('/onboarding'),
          title: t('getting_started.steps_title'),
          body: t('getting_started.steps_body'),
        }]
      : []),
    {
      key: 'photo',
      done: hasOwnPhoto(user),
      to: tenantPath('/settings'),
      title: t('getting_started.photo_title'),
      body: t('getting_started.photo_body'),
    },
    ...(listingsOn
      ? [{
          key: 'offer',
          done: hasListing,
          to: tenantPath('/listings/create'),
          title: t('getting_started.offer_title'),
          body: t('getting_started.offer_body'),
        }]
      : []),
  ];
  const done = items.filter((item) => item.done).length;
  if (done === items.length) return null;

  const close = () => {
    setClosed(true);
    try {
      localStorage.setItem(keys[0]!, String(Date.now()));
    } catch {
      // Storage unavailable: it simply shows again next visit.
    }
  };

  const communityName = branding?.name || tenant?.name || '';
  const heading = isNewMember(user.created_at) && communityName
    ? t('getting_started.title_new', { name: communityName })
    : t('getting_started.title');

  return (
    <Card data-testid="getting-started" className={`border-0 bg-accent-soft shadow-none ${className}`}>
      <CardBody className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-strong text-white shadow-sm">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-theme-primary">{heading}</h2>
            <p className="text-sm leading-6 text-theme-secondary">{t('getting_started.progress', { done, total: items.length })}</p>
          </div>
          <Button isIconOnly size="sm" variant="tertiary" aria-label={t('getting_started.close')} onPress={close}>
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.key} data-done={item.done ? 'true' : 'false'}>
              {item.done ? (
                <div className="flex items-center gap-3 px-3 py-1.5">
                  <CheckCircle className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-sm text-theme-secondary">{item.title}</span>
                  <span className="sr-only">{t('getting_started.done')}</span>
                </div>
              ) : (
                <Link
                  to={item.to}
                  className="flex items-center gap-3 rounded-xl bg-theme-elevated px-3 py-3 transition-colors hover:bg-theme-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Circle className="size-5 shrink-0 text-theme-subtle" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-theme-primary">{item.title}</span>
                    <span className="block text-sm leading-6 text-theme-secondary">{item.body}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-theme-subtle rtl:rotate-180" aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export default GettingStartedCard;
