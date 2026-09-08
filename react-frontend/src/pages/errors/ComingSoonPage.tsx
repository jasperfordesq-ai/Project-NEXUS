// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
/**
 * Coming Soon Page - For features not yet implemented
 */

import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import Home from 'lucide-react/icons/house';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Construction from 'lucide-react/icons/construction';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts/TenantContext';
import { usePageTitle } from '@/hooks/usePageTitle';

interface ComingSoonPageProps {
  feature?: string;
}

export function ComingSoonPage({ feature = 'This feature' }: ComingSoonPageProps) {
  const { t } = useTranslation('utility');
  const { tenantPath, hasModule } = useTenant();
  usePageTitle(t('coming_soon.page_title'));
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <PageMeta title={t('coming_soon.page_title')} noIndex />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <GlassCard className="p-8 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 mb-6">
            <Construction className="w-10 h-10 text-amber-400" />
          </div>

          <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('coming_soon.heading')}</h1>
          <p className="text-theme-muted mb-8">
            {t('coming_soon.description', { feature })}
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button as={Link} to={tenantPath(hasModule('dashboard') ? '/dashboard' : '/')}
              className="flex-1 w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              startContent={<Home className="w-4 h-4" />}
            >
              {hasModule('dashboard') ? t('coming_soon.dashboard') : t('not_found.go_home')}
            </Button>
            <Button
              variant="flat"
              className="w-full bg-theme-elevated text-theme-muted flex-1"
              startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
              onPress={() => window.history.back()}
            >
              {t('coming_soon.go_back')}
            </Button>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}

export default ComingSoonPage;
