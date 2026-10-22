// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Home Page - Per-tenant customizable landing page
 *
 * Delegates to LandingPageRenderer which reads the tenant's landing page
 * configuration (sections, content, ordering) and renders accordingly.
 * Falls back to sensible defaults when no custom config is set.
 */

import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo';
import { LandingPageRenderer } from '@/components/landing';
import { useTenant } from '@/contexts/TenantContext';
import { usePrerenderReady } from '@/hooks/usePrerenderReady';
import { MasterTenantChooser } from './MasterTenantChooser';

export function HomePage() {
  const { t } = useTranslation('public');
  const { tenant, isLoading, error } = useTenant();
  usePrerenderReady(!isLoading && tenant != null && error === null);

  // The master tenant (id 1) is the platform root, not a working community.
  // Its home is a "Choose your community" directory so visitors who land here
  // by accident (e.g. an error redirect to the platform root) can get back to
  // their own community. Every other tenant renders the normal landing page.
  if (tenant?.id === 1) {
    return <MasterTenantChooser />;
  }

  return (
    <>
      {/* No usePageTitle here: it sets document.title via useEffect and races
          Helmet, which left prerendered snapshots with a bare "Home" title.
          PageMeta (Helmet) handles <title> as part of the React tree, which
          the prerenderer captures correctly. */}
      <PageMeta
        tenantHome
        title={t('home.meta_title')}
        description={t('home.meta_description')}
        keywords={t('home.meta_keywords')}
      />
      <div className="-mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 -my-4 sm:-my-6 md:-my-8 overflow-x-hidden">
        <LandingPageRenderer />
      </div>
    </>
  );
}

export default HomePage;
