// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BrokerPageShell — the shared page frame for every broker page.
 *
 * Renders the header card (icon tile + title + description + actions), an
 * optional toolbar row (filters / tabs / search), then the page content with
 * a soft fade-up entrance (CSS-transition-backed motion shim; the global
 * reduced-motion attribute collapses it to instant).
 */

import type { ReactNode } from 'react';
import { isValidElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import BookOpen from 'lucide-react/icons/book-open';
import { useTenant } from '@/contexts';
import { motion } from '@/lib/motion';
import type { BrokerStatColor } from './BrokerStatCard';

/** A guide article in the broker help centre (`/broker/help/:section/:article`). */
export interface BrokerPageHelp {
  sectionId: string;
  articleId: string;
}

/**
 * Quiet "How this page works" link into the plain-English guide. Lives in
 * its own component so pages (and tests) that pass no `help` never touch the
 * tenant context.
 */
function BrokerPageHelpLink({ help }: { help: BrokerPageHelp }) {
  const { t } = useTranslation('broker');
  const { tenantPath } = useTenant();
  return (
    <Link
      to={tenantPath(`/broker/help/${help.sectionId}/${help.articleId}`)}
      className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
    >
      <BookOpen size={15} aria-hidden="true" />
      {t('common.how_this_page_works')}
    </Link>
  );
}

interface BrokerPageShellProps {
  title: string;
  description?: ReactNode;
  /** Lucide icon (component reference or pre-rendered element) shown in a color tile beside the title. */
  icon?: LucideIcon | ReactNode;
  /** Semantic color of the icon tile — match the page's domain (see BrokerStatCard). */
  color?: BrokerStatColor;
  /** Right-aligned header actions (refresh, create, export…). */
  actions?: ReactNode;
  /** Toolbar row rendered between header and content — filters, tabs, search. */
  toolbar?: ReactNode;
  /** Guide article to link as "How this page works" under the description. */
  help?: BrokerPageHelp;
  children: ReactNode;
}

const tileClass: Record<BrokerStatColor, string> = {
  accent: 'text-accent bg-accent/10',
  success: 'text-success bg-success/10',
  warning: 'text-warning bg-warning/10',
  danger: 'text-danger bg-danger/10',
  neutral: 'text-muted bg-surface-tertiary',
};

export function BrokerPageShell({
  title,
  description,
  icon: Icon,
  color = 'accent',
  actions,
  toolbar,
  help,
  children,
}: BrokerPageShellProps) {
  const IconAsComponent = Icon as LucideIcon;
  const iconNode = Icon ? (isValidElement(Icon) ? Icon : <IconAsComponent size={20} />) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="mb-6 rounded-2xl border border-divider/70 bg-surface p-4 shadow-sm shadow-black/[0.03] sm:p-5">
        <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-3">
              {iconNode && (
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10 ${tileClass[color]}`}
                >
                  {iconNode}
                </span>
              )}
              <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere] sm:text-3xl">
                {title}
              </h1>
            </div>
            {description && (
              <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-muted [overflow-wrap:anywhere]">
                {description}
              </p>
            )}
            {help && <BrokerPageHelpLink help={help} />}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
        </div>
      </div>

      {toolbar && (
        <div className="mb-4 rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
          {toolbar}
        </div>
      )}

      {children}
    </motion.div>
  );
}

export default BrokerPageShell;
