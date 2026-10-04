// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One section of the admin Settings page: an anchored card with an icon tile,
 * a left-aligned title and description, optional badge and actions, and the
 * section's fields below a separator. The look matches the polished admin
 * dashboard and broker configuration cards.
 */

import type { ReactNode } from 'react';
import { Card, Separator } from '@/components/ui';

export type SettingsSectionTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

// Tailwind JIT needs full class names at build time.
const toneClass: Record<SettingsSectionTone, string> = {
  accent: 'text-accent bg-accent/10',
  success: 'text-success bg-success/10',
  warning: 'text-warning bg-warning/10',
  danger: 'text-danger bg-danger/10',
  neutral: 'text-muted bg-surface-tertiary',
};

/** Anchor id used by the page's jump links. */
export function settingsSectionAnchor(sectionId: string): string {
  return `settings-section-${sectionId}`;
}

export interface SettingsSectionProps {
  id: string;
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  tone?: SettingsSectionTone;
  /** Small chip beside the title (e.g. "God only"). */
  badge?: ReactNode;
  /** Right-aligned header controls (e.g. a link to an advanced page). */
  actions?: ReactNode;
  /** 'rows' renders children as a divided list; 'fields' as a padded stack. */
  layout?: 'rows' | 'fields';
  className?: string;
  children: ReactNode;
}

export function SettingsSection({
  id,
  icon,
  title,
  description,
  tone = 'accent',
  badge,
  actions,
  layout = 'fields',
  className = '',
  children,
}: SettingsSectionProps) {
  return (
    <Card
      id={settingsSectionAnchor(id)}
      aria-labelledby={`${settingsSectionAnchor(id)}-title`}
      className={`scroll-mt-24 rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03] ${className}`}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10 ${toneClass[tone]}`}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={`${settingsSectionAnchor(id)}-title`} className="text-base font-semibold tracking-tight text-foreground">
                {title}
              </h2>
              {badge}
            </div>
            {description && <p className="mt-0.5 text-sm leading-5 text-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
      </div>
      <Separator />
      {layout === 'rows' ? (
        <div className="divide-y divide-divider">{children}</div>
      ) : (
        <div className="flex flex-col gap-5 p-4 sm:p-5">{children}</div>
      )}
    </Card>
  );
}

export interface SettingsRowProps {
  label: ReactNode;
  help?: ReactNode;
  /** Chip rendered beside the label (e.g. "Super admin only"). */
  badge?: ReactNode;
  /** Muted label for a read-only row. */
  muted?: boolean;
  children: ReactNode;
}

/** A label/help pair on the left with its control on the right. */
export function SettingsRow({ label, help, badge, muted = false, children }: SettingsRowProps) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`font-medium ${muted ? 'text-muted' : 'text-foreground'}`}>{label}</p>
          {badge}
        </div>
        {help && <div className="mt-0.5 text-sm leading-5 text-muted">{help}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export default SettingsSection;
