// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * NEXUS React Frontend - Main App Component
 *
 * Routes structure:
 * - All routes work at both / and /:tenantSlug/ prefix (Phase 0-1 TRS-001)
 * - TenantShell provides TenantProvider + AuthProvider per route group
 * - Public routes (no auth required)
 * - Protected routes (auth required)
 * - Feature-gated routes (based on tenant config)
 *
 * @see docs/TRS-001-TENANT-RESOLUTION-SPEC.md
 */

import { Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { I18nProvider } from '@heroui/react';
import { getFormattingLocale } from '@/lib/helpers';

// Contexts (app-wide only — tenant-scoped contexts are inside TenantShell)
import { ToastProvider } from '@/contexts/ToastContext';
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CookieConsentProvider } from '@/contexts/CookieConsentContext';

// Layout Components
import { ScrollToTop } from '@/components/routing/ScrollToTop';
import { TenantShell } from '@/components/routing/TenantShell';
import { LoadingScreen } from '@/components/feedback/LoadingScreen';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
/**
 * Give date-entry widgets the same locale the rest of the app formats with.
 *
 * DatePicker, DateField and Calendar get their segment order (DD/MM vs MM/DD)
 * and first day of week from React Aria, which defaults to the BROWSER's
 * language when no I18nProvider is present. Without this the same screen could
 * show a British date and an American date entry field side by side.
 *
 * Subscribes to i18n so the tree re-renders on a language change; the region
 * half comes from the community via getFormattingLocale().
 */
function LocalizedInputs({ children }: { children: React.ReactNode }) {
  useTranslation();
  return <I18nProvider locale={getFormattingLocale()}>{children}</I18nProvider>;
}

function App() {
  return (
    <HelmetProvider>
      <ThemeProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ScrollToTop />
          <LocalizedInputs>
          <CookieConsentProvider>
            <ToastProvider>
              <ErrorBoundary>
                <ConfirmDialogProvider>
                <Suspense fallback={<LoadingScreen />}>
                  <Routes>
                    {/* Single catch-all route â€” TenantShell detects tenant slug from
                        the first path segment (if it's not reserved like "admin").
                        When a slug IS found, TenantShell renders a nested <Routes>
                        with the slug stripped so child routes match correctly.
                        This avoids the `:tenantSlug/*` dynamic param route which caused
                        React Router v6 to rank `/:tenantSlug/listings` higher than
                        `/admin/*` (splat routes rank lowest in RRv6). */}
                    <Route path="/*" element={<TenantShell />} />
                  </Routes>
                </Suspense>
                </ConfirmDialogProvider>
              </ErrorBoundary>
            </ToastProvider>
          </CookieConsentProvider>
          </LocalizedInputs>
        </BrowserRouter>
      </ThemeProvider>
    </HelmetProvider>
  );
}

export default App;
