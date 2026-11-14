// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One group of questions on the FAQ page: the group's picture, name and one
 * line about it on the left, its questions on the right. On a phone the two
 * stack. On a wide screen the left side stays in view while a long group is
 * read, so the reader always knows which group they are in.
 */

import type { ReactNode } from 'react';

export interface FaqSectionProps {
  /** The section's id. A topic tile jumps to it, so it must be unique on the page. */
  id: string;
  icon: ReactNode;
  /** Background and text colour of the picture's tile (see `categoryColour().band`). */
  tint: string;
  title: string;
  description?: string;
  children: ReactNode;
}

export function FaqSection({ id, icon, tint, title, description, children }: FaqSectionProps) {
  const headingId = `${id}-heading`;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      // The offset keeps the heading clear of the fixed site header after a jump.
      className="grid scroll-mt-28 gap-4 lg:grid-cols-3 lg:gap-8"
    >
      <div className="flex items-start gap-3 lg:sticky lg:top-[calc(var(--app-header-desktop-offset,5.5rem)+0.75rem)] lg:flex-col lg:self-start">
        <span className={`inline-flex shrink-0 rounded-2xl p-3 ${tint}`}>{icon}</span>
        <div className="min-w-0">
          <h2 id={headingId} className="text-xl font-semibold text-foreground">
            {title}
          </h2>
          {description && <p className="mt-1 text-theme-muted">{description}</p>}
        </div>
      </div>
      <div className="min-w-0 lg:col-span-2">{children}</div>
    </section>
  );
}

export default FaqSection;
