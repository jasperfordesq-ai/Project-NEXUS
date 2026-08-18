// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MyOrganisationsPage — Lists all volunteer organisations the user owns/manages.
 * Each card links to the org dashboard.
 *
 * API: GET /api/v2/volunteering/my-organisations
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { extractCollectionItems } from './extractCollectionItems';
import { motion } from '@/lib/motion';
import Building2 from 'lucide-react/icons/building-2';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Plus from 'lucide-react/icons/plus';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { PageMeta } from '@/components/seo/PageMeta';
import { Breadcrumbs } from '@/components/navigation';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { useTranslation } from 'react-i18next';

interface MyOrg {
  id: number;
  name: string;
  description: string | null;
  status: string;
  member_role: string;
  contact_email: string | null;
  website: string | null;
  logo_url?: string | null;
}

function memberRoleLabelKey(role: string): string {
  switch (role) {
    case 'owner':
      return 'member_roles.owner';
    case 'admin':
      return 'member_roles.admin';
    default:
      return 'member_roles.member';
  }
}

export default function MyOrganisationsPage() {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const [orgs, setOrgs] = useState<MyOrg[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  usePageTitle(t('my_organisations_title'));

  const loadOrgs = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(false);
    api.get<unknown>('/v2/volunteering/my-organisations')
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.success && res.data) {
          const items = extractCollectionItems<MyOrg>(res.data);
          setOrgs(items);
        } else {
          // A failed request must not masquerade as "no organisations" — surface
          // a retryable error instead of the empty state.
          setError(true);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        logError('Failed to load my organisations', err);
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    loadOrgs();
    return () => { abortRef.current?.abort(); };
  }, [loadOrgs]);

  const managedOrgs = orgs.filter(o => ['owner', 'admin'].includes(o.member_role));
  const pendingOrgs = orgs.filter(o => o.status === 'pending');
  const declinedOrgs = orgs.filter(o => o.status === 'declined');

  return (
    <>
      <PageMeta title={t('my_organisations_title')} noIndex />
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <Breadcrumbs
        items={[
          { label: t('breadcrumb_volunteering'), href: tenantPath('/volunteering') },
          { label: t('my_organisations') },
        ]}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
            <Building2 className="w-7 h-7 text-rose-400" aria-hidden="true" />
            {t('my_organisations')}
          </h1>
          <p className="text-theme-muted mt-1">
            {t('my_organisations_subtitle')}
          </p>
        </div>
        <Button
          as={Link}
          to={tenantPath('/organisations/register')}
          className="bg-gradient-to-r from-rose-500 to-pink-600 text-white sm:shrink-0"
          startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
        >
          {t('register_organisation')}
        </Button>
      </div>

      {isLoading ? (
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{t('my_organisations_load_error')}</p>
          <Button
            className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
            onPress={loadOrgs}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      ) : managedOrgs.length === 0 && pendingOrgs.length === 0 && declinedOrgs.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-100 to-pink-100 dark:from-rose-900/30 dark:to-pink-900/30 flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-8 h-8 text-rose-500" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-semibold text-theme-primary mb-2">
            {t('my_organisations_none')}
          </h2>
          <p className="text-theme-muted max-w-md mx-auto mb-6">
            {t('my_organisations_none_desc')}
          </p>
          <Button
            as={Link}
            to={tenantPath('/organisations/register')}
            className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
            startContent={<Plus className="w-4 h-4" />}
          >
            {t('register_organisation')}
          </Button>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {/* Pending orgs */}
          {pendingOrgs.length > 0 && (
            <GlassCard className="p-4 border-amber-500/30">
              <p className="text-sm text-theme-warning font-medium mb-2">
                {t('my_organisations_pending')}
              </p>
              {pendingOrgs.map((org) => (
                <div key={org.id} className="flex items-center gap-3 p-3 rounded-xl bg-theme-elevated">
                  <Building2 className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium text-theme-primary">{org.name}</p>
                    <p className="text-xs text-theme-muted">{t('my_organisations_pending_desc')}</p>
                  </div>
                  <Chip size="sm" color="warning" variant="soft">{t('status_pending')}</Chip>
                </div>
              ))}
            </GlassCard>
          )}

          {/* Declined orgs — previously rendered blank because they matched
              neither the pending section nor the active-status filter. */}
          {declinedOrgs.length > 0 && (
            <GlassCard className="p-4 border-red-500/30">
              <p className="text-sm text-theme-danger font-medium mb-2">
                {t('my_organisations_declined')}
              </p>
              {declinedOrgs.map((org) => (
                <div key={org.id} className="flex items-center gap-3 p-3 rounded-xl bg-theme-elevated">
                  <Building2 className="w-5 h-5 text-red-400 flex-shrink-0" aria-hidden="true" />
                  <div className="flex-1">
                    <p className="font-medium text-theme-primary">{org.name}</p>
                    <p className="text-xs text-theme-muted">{t('my_organisations_declined_desc')}</p>
                  </div>
                  <Chip size="sm" color="danger" variant="soft">{t('status_declined')}</Chip>
                </div>
              ))}
            </GlassCard>
          )}

          {/* Active orgs */}
          {managedOrgs.filter(o => o.status === 'approved' || o.status === 'active').map((org, idx) => (
            <motion.div
              key={org.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.08 }}
            >
              <Link to={tenantPath(`/volunteering/org/${org.id}/dashboard`)} className="block">
                <GlassCard hoverable className="p-6 transition-all hover:border-rose-500/40">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    {/* Org icon */}
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-7 h-7 text-white" aria-hidden="true" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-theme-primary">{org.name}</h2>
                        <Chip size="sm" color="success" variant="soft">{t('status_active')}</Chip>
                        <Chip size="sm" variant="soft">{t(memberRoleLabelKey(org.member_role))}</Chip>
                      </div>
                      {org.description && (
                        <p className="text-sm text-theme-muted mt-1 line-clamp-2">{org.description}</p>
                      )}
                    </div>

                    {/* CTA — the my-organisations API never returns a balance,
                        so the old balance stat rendered nothing. Removed. */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 sm:flex-shrink-0">
                      <span className="button button--primary button--md bg-gradient-to-r from-rose-500 to-pink-600 text-white">
                        {t('manage')}
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                </GlassCard>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
      </div>
    </>
  );
}
