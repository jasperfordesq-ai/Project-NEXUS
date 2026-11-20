// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Community paused
 *
 * Shown on the member side when a community is paused for non-payment
 * (`billing_paused` on the tenant bootstrap). Everyone sees it there, the
 * community's own admins included: only the admin panel and the sign-in
 * pages stay open (see TenantShell).
 *
 * 🔴 This page never says why. Members are not told it is about money; the
 * reason is for the community's admins, in the admin panel banner.
 *
 * The admin-panel link is offered by what the account IS, not by its role
 * string: admin levels held as flags are never written to `users.role`.
 */

import CirclePause from 'lucide-react/icons/circle-pause';
import LogIn from 'lucide-react/icons/log-in';
import LogOut from 'lucide-react/icons/log-out';
import Settings from 'lucide-react/icons/settings';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageMeta } from '@/components/seo';
import { useAuth, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { hasAdminPanelAccess } from '@/lib/access';

export function CommunityPausedPage() {
  const { t } = useTranslation('public');
  const { tenant, tenantPath } = useTenant();
  const { user, logout } = useAuth();

  const community = tenant?.name || 'Project NEXUS';
  const title = t('community_paused.title', { community });
  usePageTitle(title);

  const isAdmin = hasAdminPanelAccess(user);

  return (
    <div className="min-h-screen bg-linear-to-br from-accent-soft to-surface flex items-center justify-center p-4">
      <PageMeta title={title} noIndex />
      {/* Temporary, like maintenance: crawlers should come back later and
          must not replace what they hold for this community with this page. */}
      <Helmet>
        <meta name="prerender-status-code" content="503" />
        <meta name="prerender-header" content="Retry-After: 86400" />
      </Helmet>
      <Card className="max-w-lg w-full">
        <Card.Content className="text-center py-12 px-6 gap-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-linear-to-br from-accent-strong to-accent-soft rounded-full flex items-center justify-center">
              <CirclePause size={40} className="text-white" aria-hidden="true" />
            </div>
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl font-bold text-foreground">{title}</h1>
            <p className="text-lg text-muted">{t('community_paused.body')}</p>
          </div>

          {isAdmin ? (
            <div className="pt-4 border-t border-divider">
              <Button
                as={Link}
                to={tenantPath('/admin')}
                startContent={<Settings size={18} aria-hidden="true" />}
                size="sm"
              >
                {t('community_paused.go_to_admin')}
              </Button>
            </div>
          ) : null}

          {!user ? (
            <div className="pt-4 border-t border-divider">
              <Button
                as={Link}
                to={tenantPath('/login')}
                startContent={<LogIn size={18} aria-hidden="true" />}
                size="sm"
              >
                {t('community_paused.organiser_sign_in')}
              </Button>
            </div>
          ) : (
            // This page is shown without the site's header, so the way out
            // has to be here: a member on a shared computer must be able to
            // sign out. Sign-out stays open for a paused community.
            <div className={isAdmin ? '' : 'pt-4 border-t border-divider'}>
              <Button
                variant="tertiary"
                size="sm"
                startContent={<LogOut size={18} aria-hidden="true" />}
                onPress={() => void logout()}
              >
                {t('community_paused.sign_out')}
              </Button>
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}

export default CommunityPausedPage;
