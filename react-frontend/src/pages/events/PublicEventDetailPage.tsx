// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Public event detail for anonymous visitors.
 *
 * Shows what an event is, when and where — plus venue accessibility, which is
 * published deliberately because it is what a disabled visitor needs in order
 * to decide whether to come. Registration requires an account, so the only
 * action offered is sign-in.
 *
 * Emits schema.org/Event JSON-LD, same as the member detail page, so a public
 * listing can earn rich results.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import Calendar from 'lucide-react/icons/calendar';
import MapPin from 'lucide-react/icons/map-pin';
import Video from 'lucide-react/icons/video';
import Accessibility from 'lucide-react/icons/accessibility';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { publicEventsApi, type PublicEventDetail } from '@/lib/public-events-api';
import { getFormattingLocale } from '@/lib/helpers';

export default function PublicEventDetailPage() {
  const { t } = useTranslation('events');
  const { id } = useParams<{ id: string }>();
  const { tenantPath, tenant } = useTenant();

  const [event, setEvent] = useState<PublicEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  usePageTitle(event?.title ?? t('public.title'));

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    void (async () => {
      const res = await publicEventsApi.get(id);
      if (cancelled) return;

      if (res.success && res.data) {
        setEvent(res.data);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Spinner className="mx-auto" aria-label={t('public.loading')} />
      </div>
    );
  }

  if (notFound || !event) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center space-y-4">
        <PageMeta title={t('public.not_found_title')} noIndex />
        <h1 className="text-2xl font-semibold">{t('public.not_found_title')}</h1>
        <p className="text-theme-muted">{t('public.not_found_body')}</p>
        <Button as={Link} to={tenantPath('/whats-on')} variant="secondary">
          {t('public.back_to_events')}
        </Button>
      </div>
    );
  }

  const start = event.start_time ? new Date(event.start_time) : null;
  // getFormattingLocale() inline, per the locale-formatting contract.
  const whenLabel = start && !Number.isNaN(start.getTime())
    ? start.toLocaleString(getFormattingLocale(), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        ...(event.all_day ? {} : { hour: '2-digit', minute: '2-digit' }),
      })
    : '';

  const accessibility = event.accessibility;
  const accessibilityItems = accessibility
    ? ([
        ['step_free', accessibility.step_free],
        ['accessible_toilet', accessibility.accessible_toilet],
        ['hearing_loop', accessibility.hearing_loop],
        ['quiet_space', accessibility.quiet_space],
        ['seating', accessibility.seating],
        ['parking', accessibility.parking],
      ] as const).filter(([, value]) => value === true)
    : [];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title ?? '',
    startDate: event.start_time ?? undefined,
    endDate: event.end_time ?? undefined,
    eventAttendanceMode: event.is_online
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    description: event.description ?? undefined,
    image: event.image_url ?? undefined,
    location: event.is_online
      ? { '@type': 'VirtualLocation', name: tenant?.name ?? '' }
      : event.location
        ? { '@type': 'Place', name: event.location, address: event.location }
        : undefined,
    organizer: event.organizer_name
      ? { '@type': 'Organization', name: event.organizer_name }
      : undefined,
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <PageMeta
        title={event.title ?? t('public.title')}
        description={event.description?.slice(0, 160) ?? undefined}
      />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      {event.image_url && (
        <img
          src={event.image_url}
          alt=""
          className="w-full max-h-80 object-cover rounded-xl"
        />
      )}

      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">{event.title}</h1>
        {event.category?.name && <Chip variant="secondary">{event.category.name}</Chip>}
      </header>

      <Card className="p-6 space-y-3">
        {whenLabel && (
          <p className="flex items-start gap-2">
            <Calendar className="w-5 h-5 mt-0.5 text-theme-muted flex-shrink-0" aria-hidden="true" />
            <span>{whenLabel}</span>
          </p>
        )}

        {event.is_online ? (
          <p className="flex items-start gap-2">
            <Video className="w-5 h-5 mt-0.5 text-theme-muted flex-shrink-0" aria-hidden="true" />
            <span>{t('public.online')}</span>
          </p>
        ) : event.location ? (
          <p className="flex items-start gap-2">
            <MapPin className="w-5 h-5 mt-0.5 text-theme-muted flex-shrink-0" aria-hidden="true" />
            <span>{event.location}</span>
          </p>
        ) : null}

        {event.organizer_name && (
          <p className="text-theme-muted">
            {t('public.hosted_by', { name: event.organizer_name })}
          </p>
        )}
      </Card>

      {event.description && (
        <Card className="p-6">
          <p className="whitespace-pre-wrap">{event.description}</p>
        </Card>
      )}

      {(accessibilityItems.length > 0 || accessibility?.notes) && (
        <Card className="p-6 space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Accessibility className="w-5 h-5" aria-hidden="true" />
            {t('public.accessibility_heading')}
          </h2>
          {accessibilityItems.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {accessibilityItems.map(([key]) => (
                <li key={key}>
                  <Chip color="success" variant="secondary">
                    {t(`public.accessibility.${key}`)}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
          {accessibility?.notes && (
            <p className="text-sm text-theme-muted whitespace-pre-wrap">{accessibility.notes}</p>
          )}
        </Card>
      )}

      <Card className="p-6 text-center space-y-3">
        <p className="text-theme-muted">{t('public.register_prompt')}</p>
        <Button color="primary" as={Link} to={tenantPath('/login')}>
          {t('public.login_cta')}
        </Button>
      </Card>
    </div>
  );
}
