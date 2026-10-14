// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import CircleHelp from 'lucide-react/icons/circle-help';
import {
  Disclosure,
  DisclosureBody,
  DisclosureContent,
  DisclosureHeading,
  DisclosureIndicator,
  DisclosureTrigger,
} from '@/components/ui/Disclosure';

export interface EventCheckInGuideProps {
  title: string;
  /** Who may record attendance. */
  who: string;
  /** When attendance can be recorded. */
  when: string;
  /** Numbered, plain-English steps. */
  steps: string[];
  /** What check-in does (or does not do) to time-credit balances; omit when the page says it elsewhere. */
  credits?: string;
  /** Open by default (the Manage page is busy, so it starts collapsed there). */
  defaultExpanded?: boolean;
}

/**
 * "How check-in works": the plain-English panel shown at the top of every
 * check-in page (E-105). A collapsible HeroUI Disclosure, so a volunteer on
 * the door can read it once and fold it away.
 */
export function EventCheckInGuide({
  title,
  who,
  when,
  steps,
  credits,
  defaultExpanded = true,
}: EventCheckInGuideProps) {
  return (
    <Disclosure
      defaultExpanded={defaultExpanded}
      className="rounded-xl border border-accent/30 bg-accent/5 px-4"
      data-testid="event-check-in-guide"
    >
      <DisclosureHeading>
        <DisclosureTrigger className="flex w-full min-h-11 items-center justify-between gap-3 py-2 text-left font-semibold text-theme-primary">
          <span className="flex min-w-0 items-center gap-2">
            <CircleHelp className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
            <span>{title}</span>
          </span>
          <DisclosureIndicator />
        </DisclosureTrigger>
      </DisclosureHeading>
      <DisclosureContent>
        <DisclosureBody className="space-y-3 pb-4 text-sm text-theme-primary">
          <p>{who}</p>
          <p>{when}</p>
          <ol className="list-decimal list-outside ms-5 space-y-1">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {credits && <p className="text-theme-muted">{credits}</p>}
        </DisclosureBody>
      </DisclosureContent>
    </Disclosure>
  );
}
