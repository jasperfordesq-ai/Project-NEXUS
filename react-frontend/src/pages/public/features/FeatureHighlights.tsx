// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The friendly top of the features page: a handful of large cards saying, in a
 * member's own words, what a person can do in THIS community (owner, 14 Nov
 * 2026: the page was "very, very overwhelming for the end user").
 *
 * 🔴 A card is shown only when its part of the site is switched on for this
 * community. That is what lets the long availability warning the page used to
 * open with shrink to one line above the full list: these cards never promise
 * something the community lacks. Do not add a card without a gate.
 *
 * 🔴 Caring Community never gets a card. It is unfinished and the owner's rule
 * (26 Oct 2026) is that it is not promoted anywhere. A test enforces it.
 *
 * Each card is one link to the real page. A signed-out visitor sees the
 * standard padlock on the ones that need a sign-in (owner, 13 Nov 2026).
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import HandHeart from 'lucide-react/icons/hand-heart';
import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import CalendarDays from 'lucide-react/icons/calendar-days';
import UsersRound from 'lucide-react/icons/users-round';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import MessageCircle from 'lucide-react/icons/message-circle';
import Newspaper from 'lucide-react/icons/newspaper';
import Smartphone from 'lucide-react/icons/smartphone';
import Languages from 'lucide-react/icons/languages';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ArrowRight from 'lucide-react/icons/arrow-right';
import { Card } from '@/components/ui/Card';
import { SignInLock } from '@/components/navigation/SignInLock';
import { showsSignInLock } from '@/components/navigation/signInRequired';
import { useAuth, useTenant } from '@/contexts';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { categoryColour } from '@/lib/categoryColours';
import type { TenantFeatures, TenantModules } from '@/types';

type Gate = { module: keyof TenantModules } | { feature: keyof TenantFeatures };

interface Highlight {
  /** Wording lives at `features_page.welcome.cards.<key>`. */
  key: string;
  /** Every one of these must be switched on for the card to show. */
  gates: readonly Gate[];
  path: string;
  icon: ReactNode;
}

const ICON = 'size-6';

// Order is the order a newcomer meets the site in: share, be thanked for it,
// meet people, then the places people gather.
//
// 🔴 A card's gates must be the SAME keys that guard its page: the
// <FeatureGate> on its route in routes/AppRoutes.tsx, plus anything the page
// itself refuses on. A card gated more loosely than its page sends people to a
// "coming soon" or "switched off" screen.
const HIGHLIGHTS: readonly Highlight[] = [
  { key: 'share', gates: [{ module: 'listings' }], path: '/listings', icon: <HandHeart className={ICON} aria-hidden="true" /> },
  { key: 'credits', gates: [{ module: 'wallet' }], path: '/wallet', icon: <Clock className={ICON} aria-hidden="true" /> },
  { key: 'people', gates: [{ feature: 'connections' }], path: '/members', icon: <Users className={ICON} aria-hidden="true" /> },
  { key: 'events', gates: [{ feature: 'events' }], path: '/events', icon: <CalendarDays className={ICON} aria-hidden="true" /> },
  { key: 'groups', gates: [{ feature: 'groups' }], path: '/groups', icon: <UsersRound className={ICON} aria-hidden="true" /> },
  { key: 'volunteering', gates: [{ feature: 'volunteering' }], path: '/volunteering', icon: <HeartHandshake className={ICON} aria-hidden="true" /> },
  // The messages page needs both: with direct messaging off it opens on a
  // "messaging is switched off" notice (MessagesPage.tsx).
  { key: 'messages', gates: [{ module: 'messages' }, { feature: 'direct_messaging' }], path: '/messages', icon: <MessageCircle className={ICON} aria-hidden="true" /> },
  { key: 'feed', gates: [{ module: 'feed' }], path: '/feed', icon: <Newspaper className={ICON} aria-hidden="true" /> },
];

interface GoodToKnow {
  /** Wording lives at `features_page.welcome.good_to_know.<key>`. */
  key: string;
  /** An open page that says more; none when there is no such page. */
  path?: string;
  icon: ReactNode;
}

const GOOD_TO_KNOW: readonly GoodToKnow[] = [
  { key: 'phone', path: '/install-app', icon: <Smartphone className="size-5" aria-hidden="true" /> },
  { key: 'language', icon: <Languages className="size-5" aria-hidden="true" /> },
  { key: 'safety', path: '/trust-and-safety', icon: <ShieldCheck className="size-5" aria-hidden="true" /> },
];

const LINK_FOCUS =
  'rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function FeatureHighlights() {
  const { t } = useTranslation('public');
  const { tenantPath, hasFeature, hasModule, supportedLanguages } = useTenant();
  const { isAuthenticated, isLoading } = useAuth();
  const palette = useSitePalette();

  const switchedOn = HIGHLIGHTS.filter(({ gates }) =>
    gates.every((gate) => ('module' in gate ? hasModule(gate.module) : hasFeature(gate.feature)))
  );

  // "In your language" is only true where there is a choice to make.
  const goodToKnow = GOOD_TO_KNOW.filter(
    (item) => item.key !== 'language' || supportedLanguages.length > 1
  );

  return (
    <>
      {switchedOn.length > 0 && (
        <section aria-labelledby="features-cards-heading" className="space-y-4">
          <h2 id="features-cards-heading" className="text-xl font-semibold text-foreground">
            {t('features_page.welcome.cards_heading')}
          </h2>
          <ul className="grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {switchedOn.map((item, index) => {
              const locked = showsSignInLock(item.path, { isAuthenticated, isLoading });
              // The community's own colours, one per card, in a fixed order so
              // a card keeps its colour from one visit to the next.
              const tint = categoryColour(palette[index % palette.length]).band;
              return (
                <li key={item.key}>
                  <Link to={tenantPath(item.path)} className={`group block h-full ${LINK_FOCUS}`}>
                    <Card className="h-full border border-border shadow-sm transition-shadow group-hover:shadow-md">
                      <Card.Content className="flex flex-row items-start gap-4 p-0 sm:p-1">
                        <span className={`inline-flex shrink-0 rounded-2xl p-3 ${tint}`}>{item.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-semibold text-foreground">
                              {t(`features_page.welcome.cards.${item.key}.title`)}
                            </h3>
                            {locked ? (
                              <SignInLock className="ms-auto" />
                            ) : (
                              <ArrowRight
                                className="ms-auto size-4 shrink-0 text-theme-muted transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                                aria-hidden="true"
                              />
                            )}
                          </div>
                          <p className="mt-1 text-sm leading-6 text-theme-muted">
                            {t(`features_page.welcome.cards.${item.key}.body`)}
                          </p>
                        </div>
                      </Card.Content>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="features-good-to-know-heading" className="space-y-4">
        <h2 id="features-good-to-know-heading" className="text-xl font-semibold text-foreground">
          {t('features_page.welcome.good_to_know_heading')}
        </h2>
        <ul className={`grid list-none gap-4 ${goodToKnow.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {goodToKnow.map((item) => {
            const body = (
              <span className="flex h-full items-start gap-3 rounded-2xl bg-accent-soft p-4">
                <span className="mt-0.5 shrink-0 text-accent">{item.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    {t(`features_page.welcome.good_to_know.${item.key}.title`)}
                  </span>
                  <span className="mt-0.5 block text-sm leading-6 text-theme-secondary">
                    {t(`features_page.welcome.good_to_know.${item.key}.body`)}
                  </span>
                </span>
              </span>
            );
            return (
              <li key={item.key}>
                {item.path ? (
                  <Link to={tenantPath(item.path)} className={`block h-full ${LINK_FOCUS} hover:underline`}>
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

export default FeatureHighlights;
