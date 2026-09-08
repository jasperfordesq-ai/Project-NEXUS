// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
/**
 * 404 Not Found Page
 */

import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import { Helmet } from 'react-helmet-async';
import Home from 'lucide-react/icons/house';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Search from 'lucide-react/icons/search';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts/TenantContext';
import { usePageTitle } from '@/hooks/usePageTitle';

export function NotFoundPage() {
  const { t } = useTranslation('utility');
  const { tenantPath, hasFeature } = useTenant();
  usePageTitle(t('not_found.page_title'));
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <PageMeta title={t('not_found.page_title')} noIndex />
      {/* Tell prerender services this is a real 404, not a 200.
          Without this, Prerender.io returns HTTP 200 for every "Page Not Found"
          page, which Google treats as a soft 404 (penalized worse than a real 404). */}
      <Helmet>
        <meta name="prerender-status-code" content="404" />
      </Helmet>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <GlassCard className="p-8 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 mb-6">
            <span className="text-5xl font-bold text-gradient">404</span>
          </div>

          <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('not_found.heading')}</h1>
          <p className="text-theme-muted mb-8">
            {t('not_found.description')}
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button as={Link} to={tenantPath('/')}
              className="flex-1 w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              startContent={<Home className="w-4 h-4" />}
            >
              {t('not_found.go_home')}
            </Button>
            {hasFeature('search') && (
              <Button as={Link} to={tenantPath('/search')}
                variant="flat"
                className="flex-1 w-full bg-theme-elevated text-theme-muted"
                startContent={<Search className="w-4 h-4" />}
              >
                {t('not_found.search')}
              </Button>
            )}
          </div>

          <Button
            variant="light"
            size="sm"
            className="mt-6 text-theme-subtle"
            startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
            onPress={() => window.history.back()}
          >
            {t('not_found.go_back')}
          </Button>
        </GlassCard>
      </motion.div>
    </div>
  );
}

export default NotFoundPage;
