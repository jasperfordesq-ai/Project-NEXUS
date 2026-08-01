// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Public "what's on" listing for anonymous visitors.
 *
 * Deliberately a separate, much smaller page than the member EventsPage: it
 * reads the reduced public projection (no RSVP state, no attendee data, no
 * joining links) and offers a sign-in call to action instead of registration
 * controls. Only rendered when a community has opted into `public_events`.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import Calendar from 'lucide-react/icons/calendar';
import MapPin from 'lucide-react/icons/map-pin';
import Video from 'lucide-react/icons/video';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { useAuth, useTenant } from '@/contexts';
import { publicEventsApi, type PublicEvent } from '@/lib/public-events-api';
import { getFormattingLocale } from '@/lib/helpers';

function formatWhen(event: PublicEvent): string {
  if (!event.start_time) return '';

  const start = new Date(event.start_time);
  if (Number.isNaN(start.getTime())) return '';

  // getFormattingLocale() is called inline rather than passed in: the
  // locale-formatting contract requires it at the toLocaleString call site.
  return start.toLocaleString(getFormattingLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(event.all_day ? {} : { hour: '2-digit', minute: '2-digit' }),
  });
}

export default function PublicEventsListPage() {
  const { t } = useTranslation('events');
  usePageTitle(t('public.title'));

  const { tenantPath, tenant } = useTenant();
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await publicEventsApi.list();
    if (res.success && Array.isArray(res.data)) {
      setEvents(res.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
      <PageMeta
        title={t('public.title')}
        description={t('public.meta_description', { community: tenant?.name ?? '' })}
      />

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{t('public.title')}</h1>
        <p className="text-theme-muted">{t('public.intro')}</p>
      </header>

      {loading ? (
        <div className="py-20 text-center">
          <Spinner className="mx-auto" aria-label={t('public.loading')} />
        </div>
      ) : events.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <Calendar className="w-10 h-10 text-theme-muted mx-auto" aria-hidden="true" />
          <p className="text-theme-muted">{t('public.empty')}</p>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {events.map((event) => (
            <li key={event.id}>
              <Card className="h-full p-5 space-y-3">
                {event.image_url && (
                  <img
                    src={event.image_url}
                    alt=""
                    className="w-full h-40 object-cover rounded-lg"
                    loading="lazy"
                  />
                )}

                <div className="space-y-1">
                  <Link
                    to={tenantPath(`/whats-on/${event.id}`)}
                    className="text-lg font-semibold hover:underline"
                  >
                    {event.title}
                  </Link>
                  <p className="text-sm text-theme-muted">{formatWhen(event)}</p>
                </div>

                {event.category?.name && (
                  <Chip variant="secondary">{event.category.name}</Chip>
                )}

                {event.is_online ? (
                  <p className="text-sm text-theme-muted flex items-center gap-1.5">
                    <Video className="w-4 h-4" aria-hidden="true" />
                    {t('public.online')}
                  </p>
                ) : event.location ? (
                  <p className="text-sm text-theme-muted flex items-start gap-1.5">
                    <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                    <span>{event.location}</span>
                  </p>
                ) : null}

                {event.organizer_name && (
                  <p className="text-sm text-theme-muted">
                    {t('public.hosted_by', { name: event.organizer_name })}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {isAuthenticated ? (
        // TenantShell picks the registry by PATH, so a signed-in member who
        // follows a shared /whats-on link still lands here — hand them
        // through to their full member events page instead of a sign-in CTA.
        <Card className="p-6 text-center space-y-3">
          <p className="text-theme-muted">{t('public.member_prompt')}</p>
          <Button color="primary" as={Link} to={tenantPath('/events')}>
            {t('public.member_cta')}
          </Button>
        </Card>
      ) : (
        <Card className="p-6 text-center space-y-3">
          <p className="text-theme-muted">{t('public.join_prompt')}</p>
          <Button
            color="primary"
            onPress={() => navigate(tenantPath('/login'), { state: { from: tenantPath(location.pathname) + location.search } })}
          >
            {t('public.login_cta')}
          </Button>
        </Card>
      )}
    </div>
  );
}
