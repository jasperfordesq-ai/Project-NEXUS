// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — the page shown at `/platform-team` itself, and for an
 * address inside the panel that does not exist.
 *
 * A placeholder until the home page (platform health at a glance) is built in
 * phase 3. It says plainly what the panel is and that the menu is the way in,
 * rather than redirecting to an arbitrary page.
 */

import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';

export function PlatformTeamIndex({ notFound = false }: { notFound?: boolean }) {
  const { t } = useTranslation('platform_team');
  usePageTitle(t('nav.brand'));

  return (
    <section className="mx-auto max-w-2xl py-10">
      <h1 className="text-2xl font-semibold text-foreground">
        {notFound ? t('index.not_found_title') : t('index.title')}
      </h1>
      <p className="mt-3 text-base text-muted">
        {notFound ? t('index.not_found_body') : t('index.body')}
      </p>
    </section>
  );
}

export default PlatformTeamIndex;
