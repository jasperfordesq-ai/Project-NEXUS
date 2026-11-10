// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { SourceRepositoryLink } from './SourceRepositoryLink';

/**
 * Auth Layout - simplified layout for auth pages (no navbar/footer).
 *
 * Kept in a separate module from the full app Layout so login/register startup
 * does not import the navbar, mobile drawer, footer, podcast player, push
 * notifications, session modals, or other authenticated-shell code.
 */
export function AuthLayout() {
  const { t } = useTranslation('common');
  const year = new Date().getFullYear();

  return (
    <div className="page-wash min-h-screen max-w-[100vw] flex flex-col overflow-x-clip">
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-4 focus-visible:left-4 focus-visible:z-[9999] focus-visible:px-4 focus-visible:py-2 focus-visible:bg-[var(--color-primary)] focus-visible:text-white focus-visible:rounded-lg focus-visible:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {t('accessibility.skip_to_content')}
      </a>

      <div className="absolute top-[calc(var(--safe-area-top)+1rem)] right-[calc(var(--safe-area-right)+1rem)] z-20">
        <LanguageSwitcher
          triggerClassName="border border-theme-default bg-theme-elevated text-theme-primary shadow-sm backdrop-blur hover:border-theme-primary/40 hover:bg-theme-hover"
        />
      </div>

      <main id="main-content" className="relative z-10 flex-1">
        <Outlet />
      </main>

      <footer className="relative z-10 px-4 py-4 pb-[calc(var(--safe-area-bottom)+1rem)] text-center" data-nosnippet>
        <div className="flex flex-col items-center justify-center gap-2">
          <SourceRepositoryLink compact className="max-w-[18rem] justify-center" />
          <p className="text-xs text-theme-subtle">
            <span className="font-medium text-theme-secondary">{t('footer.project_nexus')}</span>
            <span aria-hidden="true"> &middot; </span>
            <span>{t('footer.agpl_notice', { year })}</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default AuthLayout;
