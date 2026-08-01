// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner venue directory — the local premises a member can visit with their
 * membership pass. `offer_summary` describes whatever the venue itself chooses
 * to offer; the platform neither issues nor enforces any discount.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import Store from 'lucide-react/icons/store';
import MapPin from 'lucide-react/icons/map-pin';
import QrCode from 'lucide-react/icons/qr-code';
import ExternalLink from 'lucide-react/icons/external-link';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant } from '@/contexts';
import { partnerVenuesApi, type PartnerVenue } from '@/lib/partner-venues-api';

export default function PartnerVenuesPage() {
  const { t } = useTranslation('venues');
  usePageTitle(t('directory.title'));

  const { tenantPath } = useTenant();
  const [venues, setVenues] = useState<PartnerVenue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const res = await partnerVenuesApi.directory();
      if (cancelled) return;
      if (res.success && res.data) {
        setVenues(res.data.venues ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('directory.title')}</h1>
          <p className="text-theme-muted mt-1">{t('directory.intro')}</p>
        </div>
        <Button color="primary" as={Link} to={tenantPath('/venues/pass')}>
          <QrCode className="w-4 h-4 mr-2" aria-hidden="true" />
          {t('directory.my_pass')}
        </Button>
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <Spinner className="mx-auto" aria-label={t('loading')} />
        </div>
      ) : venues.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <Store className="w-10 h-10 text-theme-muted mx-auto" aria-hidden="true" />
          <p className="text-theme-muted">{t('directory.empty')}</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {venues.map((venue) => (
            <Card key={venue.id} className="p-5 space-y-3">
              <div className="flex items-start gap-3">
                {venue.logo_url ? (
                  <img
                    src={venue.logo_url}
                    alt=""
                    className="w-10 h-10 rounded object-cover flex-shrink-0"
                  />
                ) : (
                  <Store className="w-10 h-10 text-theme-muted flex-shrink-0" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <h2 className="font-semibold truncate">{venue.name}</h2>
                  {venue.category && (
                    <Chip variant="secondary">
                      {t(`categories.${venue.category}`, { defaultValue: venue.category })}
                    </Chip>
                  )}
                </div>
              </div>

              {venue.offer_summary && (
                <p className="text-sm font-medium text-[var(--color-primary)]">
                  {venue.offer_summary}
                </p>
              )}

              {venue.description && (
                <p className="text-sm text-theme-muted line-clamp-3">{venue.description}</p>
              )}

              {(venue.address_line || venue.city) && (
                <p className="text-sm text-theme-muted flex items-start gap-1.5">
                  <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <span>{[venue.address_line, venue.city, venue.postcode].filter(Boolean).join(', ')}</span>
                </p>
              )}

              {venue.website && (
                <a
                  href={venue.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[var(--color-primary)] underline inline-flex items-center gap-1"
                >
                  {t('directory.visit_website')}
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
