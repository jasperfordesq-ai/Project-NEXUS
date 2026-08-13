// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ReactNode } from 'react';
import Sparkles from 'lucide-react/icons/sparkles';
import { Chip } from '@/components/ui';

interface PublicPageHeroStat {
  label: string;
  value: string;
}

interface PublicPageHeroProps {
  eyebrow: string;
  title: string;
  description: string;
  icon: ReactNode;
  accent?: 'emerald' | 'indigo' | 'amber' | 'blue' | 'rose';
  action?: ReactNode;
  stats?: PublicPageHeroStat[];
}

const accentClasses = {
  emerald: {
    icon: 'from-emerald-500/20 to-teal-500/20 text-emerald-500 dark:text-emerald-300',
    chipColor: 'success',
    line: 'from-emerald-500 via-teal-500 to-cyan-500',
  },
  indigo: {
    icon: 'from-accent/20 to-sky-500/20 text-accent dark:text-accent',
    chipColor: 'accent',
    line: 'from-accent via-sky-500 to-cyan-500',
  },
  amber: {
    icon: 'from-amber-500/20 to-orange-500/20 text-amber-500 dark:text-amber-300',
    chipColor: 'warning',
    line: 'from-amber-500 via-orange-500 to-rose-500',
  },
  blue: {
    icon: 'from-blue-500/20 to-accent-gradient-end/20 text-blue-500 dark:text-blue-300',
    chipColor: 'accent',
    line: 'from-blue-500 via-accent to-violet-500',
  },
  rose: {
    icon: 'from-rose-500/20 to-fuchsia-500/20 text-rose-500 dark:text-rose-300',
    chipColor: 'danger',
    line: 'from-rose-500 via-fuchsia-500 to-accent-gradient-end',
  },
} satisfies Record<string, {
  icon: string;
  chipColor: 'accent' | 'success' | 'warning' | 'danger';
  line: string;
}>;

export function PublicPageHero({
  eyebrow,
  title,
  description,
  icon,
  accent = 'indigo',
  action,
  stats,
}: PublicPageHeroProps) {
  const classes = accentClasses[accent];

  return (
    <section
      data-public-page-hero="true"
      className="relative overflow-hidden border-b border-theme-default pb-6 pt-2 sm:pb-8"
    >
      <div className={`absolute inset-x-0 bottom-0 h-px bg-linear-to-r ${classes.line}`} aria-hidden="true" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          {/* The icon goes in startContent, NOT in children: children are wrapped
              in <Chip.Label>, and Tailwind's reset makes an <svg> display:block,
              which broke the label onto a second line. As startContent it is a
              flex sibling of the label and centres against the text. */}
          <Chip
            color={classes.chipColor}
            size="sm"
            variant="soft"
            className="mb-4 py-1 font-medium"
            startContent={<Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          >
            {eyebrow}
          </Chip>
          <div className="flex items-start gap-4">
            <div className={`hidden rounded-2xl bg-gradient-to-br p-3 shadow-sm sm:inline-flex ${classes.icon}`}>
              {icon}
            </div>
            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight text-theme-primary sm:text-4xl">
                {title}
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-theme-muted">
                {description}
              </p>
            </div>
          </div>
        </div>
        {(action || stats?.length) && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
            {stats?.length ? (
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                {stats.map((stat) => (
                  <div
                    key={`${stat.label}-${stat.value}`}
                    className="rounded-xl border border-theme-default bg-theme-elevated px-3 py-2 text-left shadow-sm"
                  >
                    <p className="text-lg font-bold leading-none text-theme-primary">{stat.value}</p>
                    <p className="mt-1 text-xs text-theme-subtle">{stat.label}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {action}
          </div>
        )}
      </div>
    </section>
  );
}

export default PublicPageHero;
