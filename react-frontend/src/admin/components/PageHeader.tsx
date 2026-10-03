// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Page Header
 * Consistent page title, description, and action buttons.
 * Automatically shows a contextual help button (?) when the current route
 * has an entry in the HELP_CONTENT registry.
 * Inside an AdminEmbed (broker panel) it collapses to its actions only, and
 * when the host page provides an element in its own header those actions
 * are rendered there, so the content area starts with the content.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import HelpCircle from 'lucide-react/icons/help-circle';
import type { HelpArticle } from '../data/helpContent';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { AdminEmbedActions, useAdminEmbed } from './AdminEmbedContext';

const AdminHelpDrawer = lazy(() =>
  import('./AdminHelpDrawer').then((module) => ({ default: module.AdminHelpDrawer }))
);

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, subtitle, icon, actions }: PageHeaderProps) {
  const { t } = useTranslation(['admin_nav', 'admin_help']);
  const body = description ?? subtitle;
  const { embedded } = useAdminEmbed();
  const location = useLocation();
  const [article, setArticle] = useState<HelpArticle | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const normalizedPath = location.pathname.replace(/^\/[^/]+(?=\/(?:admin|caring|super-admin))/, '');
    void import('../data/helpContent').then(({ getHelpContent }) => {
      if (cancelled) return;
      const helpContent = getHelpContent(t);
      setArticle(helpContent[normalizedPath] ?? helpContent[location.pathname] ?? null);
    });

    setArticle(null);
    setHelpOpen(false);
    return () => {
      cancelled = true;
    };
  }, [location.pathname, t]);

  // Embedded in another panel (the broker panel): that panel already shows
  // the title and description, so only the action buttons are rendered, as a
  // slim toolbar row — or nothing when there are none. See AdminEmbedContext.
  if (embedded) {
    if (!actions) return null;
    return (
      <AdminEmbedActions
        fallback={
          <div className="mb-4 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
            {actions}
          </div>
        }
      >
        {actions}
      </AdminEmbedActions>
    );
  }

  return (
    <>
      <Card className="mb-6 rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
        <Card.Content className="p-4 sm:p-5">
          <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-3">
                {icon && (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    {icon}
                  </span>
                )}
                <h1 className="min-w-0 break-words text-2xl font-semibold text-foreground [overflow-wrap:anywhere] sm:text-3xl">{title}</h1>
                {article && (
                  <Button
                    isIconOnly
                    size="sm"
                    variant="tertiary"
                    onPress={() => setHelpOpen(true)}
                    className="ml-1 shrink-0 text-muted hover:text-accent"
                    aria-label={t('shared.open_page_help')}
                    title={t('shared.help')}
                  >
                    <HelpCircle size={16} />
                  </Button>
                )}
              </div>
              {body && (
                <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-muted [overflow-wrap:anywhere]">{body}</p>
              )}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
          </div>
        </Card.Content>
      </Card>
      {article && helpOpen && (
        <Suspense fallback={null}>
          <AdminHelpDrawer
            article={article}
            isOpen={helpOpen}
            onClose={() => setHelpOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}

export default PageHeader;
