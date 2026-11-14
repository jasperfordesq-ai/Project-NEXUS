// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Features page — members first (owner, 14 Nov 2026).
 *
 * The page used to open with three blocks of explanation and then list all
 * 118 catalogue entries at once: twelve screens, written mostly for someone
 * weighing up the software. It is now three parts, in the order a member
 * needs them:
 *
 *   1. `FeatureHighlights` — a handful of friendly cards for what this
 *      community has switched on, each a link to the real page.
 *   2. `FeatureCatalogue`  — the full list of what the software can do, one
 *      closed row per group, with search.
 *   3. `TechnicalNotes`    — labels, tech stack, open source, security.
 *
 * The rules that made the old page honest still hold and now live beside the
 * code they govern: the availability note, the maturity labels and the two
 * kinds of federation in `features/FeatureCatalogue.tsx`; the version-bearing
 * copy in `features/TechnicalNotes.tsx`; the gating of the cards in
 * `features/FeatureHighlights.tsx`. Read those before changing this page.
 *
 * The page replaces the previous "Development Status" page; the old route
 * still redirects here so existing bookmarks survive.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Sparkles from 'lucide-react/icons/sparkles';
import { Button } from '@/components/ui/Button';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAuth, useTenant } from '@/contexts';
import { FeatureHighlights } from './features/FeatureHighlights';
import { FeatureCatalogue } from './features/FeatureCatalogue';
import { TechnicalNotes } from './features/TechnicalNotes';

export function FeaturesPage() {
  const { t } = useTranslation('public');
  const { tenantPath, branding } = useTenant();
  const { isAuthenticated, isLoading } = useAuth();
  usePageTitle(t('features_page.title'));

  // Only for someone we know is signed out. While the sign-in check is still
  // running a member reloading the page would otherwise be asked to join.
  const invitesToJoin = !isAuthenticated && !isLoading;

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-4 sm:px-6 lg:px-8">
      <PageMeta
        title={t('features_page.meta_title')}
        description={t('features_page.meta_description', { name: branding.name })}
      />

      <PublicPageHero
        title={t('features_page.welcome.heading', { name: branding.name })}
        description={t('features_page.welcome.body')}
        icon={<Sparkles className="h-7 w-7" aria-hidden="true" />}
        action={
          invitesToJoin ? (
            <Button as={Link} to={tenantPath('/register')} variant="primary" size="lg">
              {t('features_page.welcome.join')}
            </Button>
          ) : undefined
        }
      />

      <FeatureHighlights />
      <FeatureCatalogue />
      <TechnicalNotes />
    </div>
  );
}

export default FeaturesPage;
