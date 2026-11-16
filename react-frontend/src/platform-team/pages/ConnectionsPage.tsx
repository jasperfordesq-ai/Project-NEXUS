// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Keys and connections.
 *
 * Which outside services this server has a key for
 * (`GET /v2/platform-team/connections`, platform team only), grouped, each
 * shown as "Set up" or "Not set up" with an icon AND the words.
 *
 * 🔴 The server sends a yes or no per service and nothing else: this page
 * never shows a key or any part of one. Expiry dates are not recorded
 * anywhere, so none are shown, and the page says so.
 *
 * Ends with "Where three other controls are": consent types, the identity
 * check fee, and a line that the old list of server keys was replaced by this
 * page (F-626).
 *
 * Service names are proper names, so they are constants here, not wording.
 *
 * 🔴 Read-only. The only control reloads.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CircleCheck from 'lucide-react/icons/circle-check';
import CircleMinus from 'lucide-react/icons/circle-minus';

export interface Connection {
  key: string;
  group: string;
  configured: boolean;
}

export interface ConnectionsReport {
  connections: Connection[];
}

/** Groups in the order the page shows them; a group the server adds later is shown last. */
const GROUP_ORDER = [
  'email', 'live_updates', 'notifications', 'payments', 'ai', 'maps_translation',
  'search', 'error_reports', 'protection', 'alerts', 'sign_in', 'other',
] as const;

/** Proper names, the same in every language. Absent = the name is wording (`connections.name.<key>`). */
const SERVICE_NAMES: Record<string, string> = {
  gmail_api: 'Gmail API',
  postmark: 'Postmark',
  smtp: 'SMTP',
  pusher: 'Pusher',
  fcm: 'Firebase Cloud Messaging',
  expo: 'Expo',
  stripe: 'Stripe',
  stripe_webhook: 'Stripe',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  google_maps: 'Google Maps',
  google_translate: 'Google Translate',
  meilisearch: 'Meilisearch',
  sentry: 'Sentry',
  cloudflare_origin: 'Cloudflare',
  turnstile: 'Turnstile',
  clamav: 'ClamAV',
  slack_slo_alerts: 'Slack',
  slack_email_alerts: 'Slack',
  google_sign_in: 'Google',
  facebook_sign_in: 'Facebook',
  apple_sign_in: 'Apple',
  mailchimp: 'Mailchimp',
};

/** Services that need a line to tell them apart, or to say what they are. */
const DETAIL_KEYS = new Set(['stripe_webhook', 'cloudflare_origin', 'slack_slo_alerts', 'slack_email_alerts', 'file_storage']);

export function ConnectionsPage() {
  const { t } = useTranslation('platform_team');
  const { tenantPath } = useTenant();
  usePageTitle(t('connections.title'));

  const [report, setReport] = useState<ConnectionsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<ConnectionsReport>('/v2/platform-team/connections');
      if (res.success && res.data && Array.isArray(res.data.connections)) {
        setReport(res.data);
      } else {
        setReport(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load keys and connections', err);
      setReport(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connections = report?.connections ?? [];
  const groups = [
    ...GROUP_ORDER,
    ...Array.from(new Set(connections.map((c) => c.group))).filter((g) => !(GROUP_ORDER as readonly string[]).includes(g)),
  ]
    .map((group) => ({ group, items: connections.filter((c) => c.group === group) }))
    .filter(({ items }) => items.length > 0);
  const done = connections.filter((c) => c.configured).length;

  const name = (key: string) => SERVICE_NAMES[key] ?? t(`connections.name.${key}`);

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('connections.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('connections.intro')}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('connections.never_shown')}</p>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('connections.no_expiry')}</p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !report ? (
        <div role="status" aria-busy="true" aria-label={t('connections.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !report ? (
        <LoadError title={t('connections.load_error_title')} onRetry={() => void load()} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-base font-medium text-foreground">
            {t('connections.count', { done, total: connections.length })}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {groups.map(({ group, items }) => (
              <Card key={group} data-testid={`connections-group-${group}`}>
                <CardBody className="gap-3 p-4">
                  <h2 className="text-lg font-semibold text-foreground">{t(`connections.group.${group}`)}</h2>
                  <ul className="flex flex-col gap-2">
                    {items.map((item) => (
                      <li
                        key={item.key}
                        data-testid={`connection-${item.key}`}
                        className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{name(item.key)}</p>
                          {DETAIL_KEYS.has(item.key) ? (
                            <p className="text-xs text-muted">{t(`connections.detail.${item.key}`)}</p>
                          ) : null}
                        </div>
                        {item.configured ? (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-success">
                            <CircleCheck size={16} aria-hidden="true" />
                            {t('connections.status.set_up')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-muted">
                            <CircleMinus size={16} aria-hidden="true" />
                            {t('connections.status.not_set_up')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Card className="mt-6" data-testid="connections-elsewhere">
        <CardBody className="gap-2 p-4">
          <h2 className="text-lg font-semibold text-foreground">{t('connections.elsewhere.title')}</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground">
            <li>
              <Link className="text-primary underline" to={tenantPath('/admin/enterprise/gdpr/consent-types')}>
                {t('connections.elsewhere.consent_types')}
              </Link>
            </li>
            <li>
              <Link
                className="text-primary underline"
                to={`${tenantPath('/admin/module-configuration')}?configure=identity_verification`}
              >
                {t('connections.elsewhere.identity_fee')}
              </Link>
            </li>
            <li>{t('connections.elsewhere.secrets_replaced')}</li>
          </ul>
        </CardBody>
      </Card>
    </section>
  );
}

export default ConnectionsPage;
