// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SellerShippingOptionsPage — seller configuration for marketplace shipping.
 */

import { Link } from 'react-router-dom';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Truck from 'lucide-react/icons/truck';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ShippingOptionsManager } from '@/components/marketplace/ShippingOptionsManager';
import { PageMeta } from '@/components/seo/PageMeta';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useAuth, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';

export function SellerShippingOptionsPage() {
  const { t } = useTranslation('marketplace');
  const { user } = useAuth();
  const { tenantPath } = useTenant();

  usePageTitle(t('shipping.page_title'));

  return (
    <>
      <PageMeta title={t('shipping.page_title')} noIndex />
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        <Button
          as={Link}
          to={tenantPath('/marketplace/my-listings')}
          variant="tertiary"
          size="sm"
          startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
        >
          {t('shipping.back_to_listings')}
        </Button>

        {/* The same soft panel in the community colour that opens the offers,
            events and groups pages (AWID: warmer, more inviting). */}
        <PublicPageHero
          size="compact"
          title={t('shipping.page_title')}
          description={t('shipping.page_subtitle')}
          icon={<Truck className="h-6 w-6" aria-hidden="true" />}
          accent="indigo"
        />

        <ShippingOptionsManager sellerId={user?.id ?? 0} />
      </div>
    </>
  );
}

export default SellerShippingOptionsPage;
