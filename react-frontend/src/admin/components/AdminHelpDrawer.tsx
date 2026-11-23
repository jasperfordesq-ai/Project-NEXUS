// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Link } from 'react-router-dom';
import LightbulbIcon from 'lucide-react/icons/lightbulb';
import TriangleAlertIcon from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';

import type { HelpArticle } from '../data/helpContent';
import { Chip } from '@/components/ui/Chip';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerHeading,
} from '@/components/ui/Drawer';
import { Separator } from '@/components/ui/Separator';

interface AdminHelpDrawerProps {
  article: HelpArticle;
  isOpen: boolean;
  onClose: () => void;
}

export function AdminHelpDrawer({ article, isOpen, onClose }: AdminHelpDrawerProps) {
  const { t: tNav } = useTranslation('admin_nav');
  const { tenantPath } = useTenant();
  // The article arrives already in the reader's language: PageHeader reads it
  // from the `admin_help` locale file (getHelpContent()). Its text used to be
  // passed through the translator a second time, as if each sentence were a
  // key. Nothing matched, so in development every line read "[missing]
  // admin_help:…", and on the live site every line of every article was
  // reported as a missing translation.
  const articleTitle = article.title;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      placement="right"
      size="md"
      closeLabel={tNav('help_drawer.close_panel')}
      classNames={{
        base: '!w-full !max-w-[min(24rem,calc(100dvw-var(--safe-area-left)-var(--safe-area-right)))] !p-0',
        closeButton: '!top-[calc(var(--safe-area-top)+0.5rem)] right-2 size-11 text-muted',
      }}
    >
      <DrawerContent aria-label={tNav('help_drawer.aria_label', { title: articleTitle })}>
        <DrawerHeader className="shrink-0 border-b border-divider px-5 py-4 pr-14 pt-[calc(var(--safe-area-top)+1rem)]">
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-muted">
            {tNav('help_drawer.label')}
          </p>
          <DrawerHeading className="text-base font-bold leading-snug text-foreground">
            {articleTitle}
          </DrawerHeading>
        </DrawerHeader>

        <DrawerBody className="!m-0 space-y-5 px-5 py-4 pb-[calc(var(--safe-area-bottom)+1rem)]">
          <p className="text-sm leading-relaxed text-muted">
            {article.summary}
          </p>

          {article.steps && article.steps.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                  {tNav('help_drawer.how_to_use')}
                </h3>
                <ol className="space-y-3">
                  {article.steps.map((step, idx) => (
                    <li key={step.label} className="flex gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent-soft-foreground">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug text-foreground">
                          {step.label}
                        </p>
                        {step.detail && (
                          <p className="mt-0.5 text-xs leading-relaxed text-muted">
                            {step.detail}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}

          {article.tips && article.tips.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                  {tNav('help_drawer.tips')}
                </h3>
                <ul className="space-y-2">
                  {article.tips.map((tip) => (
                    <li
                      key={tip}
                      className="flex gap-2.5 rounded-lg bg-surface px-3 py-2.5 text-xs leading-relaxed text-muted"
                    >
                      <LightbulbIcon
                        size={14}
                        className="mt-0.5 shrink-0 text-warning"
                        aria-hidden="true"
                      />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {article.caution && (
            <>
              <Separator />
              <div className="flex gap-2.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-3 text-xs leading-relaxed text-danger-soft-foreground">
                <TriangleAlertIcon
                  size={14}
                  className="mt-0.5 shrink-0 text-danger"
                  aria-hidden="true"
                />
                <span>{article.caution}</span>
              </div>
            </>
          )}

          {article.relatedPaths && article.relatedPaths.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                  {tNav('help_drawer.related_pages')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {article.relatedPaths.map((rel) => (
                    <Chip
                      key={rel.path}
                      as={Link}
                      // With the community's name in the address where the
                      // address carries one, like every other link in the app.
                      to={tenantPath(rel.path)}
                      size="sm"
                      variant="secondary"
                      className="cursor-pointer"
                      onClick={onClose}
                    >
                      {rel.label}
                    </Chip>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="h-4" />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

export default AdminHelpDrawer;
