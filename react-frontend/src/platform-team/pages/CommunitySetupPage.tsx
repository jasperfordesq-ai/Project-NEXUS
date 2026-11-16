// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Community setup.
 *
 * For each community, newest first: how far it has got with "Make it yours",
 * whether it has its own web address and an accessible-site address, whether
 * its privacy notice and terms are published, whether an administrator has
 * signed in, and whether its email goes out from its own account or the
 * platform's. A wide screen gets a table; a narrow one gets a card per
 * community. Every step is shown with an icon AND a word, never colour alone.
 *
 * 🔴 Yes/no facts only: no person is named on this page. Read-only.
 *
 * A step the server could not read arrives as null and is shown as "Not
 * available", never as "Not done".
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import CircleCheck from 'lucide-react/icons/circle-check';
import CircleDashed from 'lucide-react/icons/circle-dashed';
import CircleHelp from 'lucide-react/icons/circle-help';
import Info from 'lucide-react/icons/info';
import Mail from 'lucide-react/icons/mail';
import RefreshCw from 'lucide-react/icons/refresh-cw';

export interface CommunitySetupRow {
  id: number;
  name: string;
  slug: string | null;
  is_active: boolean;
  created_at: string | null;
  make_it_yours: { done: number; total: number } | null;
  own_address: boolean | null;
  accessible_address: boolean | null;
  privacy_notice_published: boolean | null;
  terms_published: boolean | null;
  first_admin_signed_in: boolean | null;
  email_sender: 'own' | 'platform' | null;
}

export interface CommunitySetup {
  max_communities: number;
  total_communities: number;
  truncated: boolean;
  unavailable: string[];
  communities: CommunitySetupRow[];
}

/** The yes/no steps, in the order the table shows them (after "Make it yours"). */
const STEPS = [
  'own_address',
  'accessible_address',
  'privacy_notice_published',
  'terms_published',
  'first_admin_signed_in',
] as const;
type Step = (typeof STEPS)[number];

export function CommunitySetupPage() {
  const { t, i18n } = useTranslation('platform_team');
  usePageTitle(t('community_setup.title'));

  const [setup, setSetup] = useState<CommunitySetup | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<CommunitySetup>('/v2/platform-team/community-setup');
      if (res.success && res.data && Array.isArray(res.data.communities)) {
        setSetup(res.data);
      } else {
        setSetup(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load community setup', err);
      setSetup(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const notAvailable = (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <CircleHelp size={16} className="shrink-0" aria-hidden="true" />
      {t('community_setup.not_available')}
    </span>
  );

  const yesNo = (value: boolean | null) => {
    if (value === null) return notAvailable;
    return value ? (
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <CircleCheck size={16} className="shrink-0 text-success" aria-hidden="true" />
        {t('community_setup.done')}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-muted">
        <CircleDashed size={16} className="shrink-0" aria-hidden="true" />
        {t('community_setup.not_done')}
      </span>
    );
  };

  const makeItYours = (value: CommunitySetupRow['make_it_yours']) => {
    if (value === null) return notAvailable;
    const complete = value.total > 0 && value.done >= value.total;
    const Icon = complete ? CircleCheck : CircleDashed;
    return (
      <span className={`inline-flex items-center gap-1.5 ${complete ? 'text-foreground' : 'text-muted'}`}>
        <Icon size={16} className={`shrink-0 ${complete ? 'text-success' : ''}`} aria-hidden="true" />
        {t('community_setup.make_it_yours_count', { done: value.done, total: value.total })}
      </span>
    );
  };

  const sender = (value: CommunitySetupRow['email_sender']) => {
    if (value === null) return notAvailable;
    return (
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <Mail size={16} className="shrink-0 text-muted" aria-hidden="true" />
        {value === 'own' ? t('community_setup.sender_own') : t('community_setup.sender_platform')}
      </span>
    );
  };

  const created = (iso: string | null): string | null => {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? null
      : t('community_setup.created_on', {
          date: date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }),
        });
  };

  const header = (community: CommunitySetupRow) => {
    const createdText = created(community.created_at);
    return (
      <>
        <span className="block break-words">{community.name}</span>
        {createdText ? <span className="mt-0.5 block text-xs font-normal text-muted">{createdText}</span> : null}
        {!community.is_active ? (
          <span className="mt-1 flex">
            <Chip size="sm" variant="soft" color="default">
              {t('community_setup.not_active')}
            </Chip>
          </span>
        ) : null}
      </>
    );
  };

  const label = (step: Step): string => t(`community_setup.column.${step}`);

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('community_setup.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('community_setup.intro')}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('community_setup.yes_no_only')}</p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !setup ? (
        <div role="status" aria-busy="true" aria-label={t('community_setup.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !setup ? (
        <LoadError title={t('community_setup.load_error_title')} onRetry={() => void load()} />
      ) : setup.communities.length === 0 ? (
        <p className="text-sm text-muted">{t('community_setup.empty')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {setup.unavailable.length > 0 ? (
            <p className="max-w-2xl text-sm text-warning-soft-foreground" role="status">
              {t('community_setup.unavailable_note')}
            </p>
          ) : null}

          <Card>
            <CardBody className="flex flex-row items-start gap-3 p-4">
              <Info size={20} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
              <ul className="flex min-w-0 list-none flex-col gap-2 text-sm text-foreground">
                <li>{t('community_setup.terms_note')}</li>
                <li>{t('community_setup.not_recorded')}</li>
              </ul>
            </CardBody>
          </Card>

          <p className="text-sm text-muted">
            {setup.truncated
              ? t('community_setup.truncated', { shown: setup.communities.length, total: setup.total_communities })
              : t('community_setup.community_count', { count: setup.communities.length })}
          </p>

          <div className="hidden overflow-x-auto rounded-xl border border-divider md:block">
            <table className="w-full border-collapse text-sm" data-testid="community-setup-table">
              <caption className="sr-only">{t('community_setup.title')}</caption>
              <thead>
                <tr className="bg-surface-secondary text-start text-xs text-muted">
                  <th scope="col" className="sticky start-0 z-10 min-w-48 bg-surface-secondary px-3 py-2 font-medium">
                    {t('community_setup.column.community')}
                  </th>
                  <th scope="col" className="min-w-28 px-3 py-2 align-bottom font-medium">
                    {t('community_setup.column.make_it_yours')}
                  </th>
                  {STEPS.map((step) => (
                    <th key={step} scope="col" className="min-w-28 px-3 py-2 align-bottom font-medium">
                      {label(step)}
                    </th>
                  ))}
                  <th scope="col" className="min-w-32 px-3 py-2 align-bottom font-medium">
                    {t('community_setup.column.email_sender')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {setup.communities.map((community) => (
                  <tr key={community.id} className="border-t border-divider">
                    <th scope="row" className="sticky start-0 z-10 bg-background px-3 py-2 text-start font-medium text-foreground">
                      {header(community)}
                    </th>
                    <td className="px-3 py-2">{makeItYours(community.make_it_yours)}</td>
                    {STEPS.map((step) => (
                      <td key={step} className="px-3 py-2">
                        {yesNo(community[step])}
                      </td>
                    ))}
                    <td className="px-3 py-2">{sender(community.email_sender)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden" data-testid="community-setup-list">
            {setup.communities.map((community) => (
              <li key={community.id}>
                <Card>
                  <CardBody className="p-4">
                    <h2 className="min-w-0 text-base font-semibold text-foreground">{header(community)}</h2>
                    <dl className="mt-3 flex flex-col gap-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <dt className="text-muted">{t('community_setup.column.make_it_yours')}</dt>
                        <dd>{makeItYours(community.make_it_yours)}</dd>
                      </div>
                      {STEPS.map((step) => (
                        <div key={step} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <dt className="text-muted">{label(step)}</dt>
                          <dd>{yesNo(community[step])}</dd>
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <dt className="text-muted">{t('community_setup.column.email_sender')}</dt>
                        <dd>{sender(community.email_sender)}</dd>
                      </div>
                    </dl>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default CommunitySetupPage;
