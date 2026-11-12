import { Card, Chip } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ReactNode } from 'react';

interface PublicEmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  tips?: string[];
  accent?: 'emerald' | 'indigo' | 'amber' | 'blue' | 'rose';
}

const accentClasses = {
  emerald: 'from-emerald-500/20 to-teal-500/10 text-emerald-500 dark:text-emerald-300',
  indigo: 'from-accent/20 to-sky-500/10 text-accent dark:text-accent',
  amber: 'from-amber-500/20 to-orange-500/10 text-amber-500 dark:text-amber-300',
  blue: 'from-blue-500/20 to-accent-gradient-end/10 text-blue-500 dark:text-blue-300',
  rose: 'from-rose-500/20 to-fuchsia-500/10 text-rose-500 dark:text-rose-300',
} satisfies Record<string, string>;

export function PublicEmptyState({
  icon,
  title,
  description,
  action,
  tips,
  accent = 'indigo',
}: PublicEmptyStateProps) {
  return (
    <Card className="rounded-lg border border-theme-default bg-theme-surface/80 shadow-sm">
      <Card.Content className="items-center px-5 py-10 text-center sm:px-8">
        {/* The same small scene as the site's other empty pages (EmptyState):
            a soft shape in the companion colour behind the icon and a few dots
            beside it. Decoration only. */}
        <div data-testid="public-empty-scene" className="relative mb-7 mt-2" aria-hidden="true">
          <span className="absolute -inset-4 rotate-6 rounded-[42%_58%_55%_45%/48%_42%_58%_52%] bg-companion-soft" />
          <span className="absolute -right-5 -top-1 size-3 rounded-full bg-companion/60" />
          <span className="absolute -left-6 bottom-1 size-2 rounded-full bg-accent/40" />
          <div className={`relative rounded-2xl bg-gradient-to-br p-4 ${accentClasses[accent]}`}>
            {icon}
          </div>
        </div>
        <h2 className="text-xl font-semibold text-theme-primary">{title}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-theme-muted">{description}</p>
        {tips?.length ? (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {tips.map((tip) => (
              <Chip key={tip} size="sm" variant="tertiary" className="bg-theme-elevated text-theme-secondary">
                {tip}
              </Chip>
            ))}
          </div>
        ) : null}
        {action ? <div className="mt-6">{action}</div> : null}
      </Card.Content>
    </Card>
  );
}

export default PublicEmptyState;
