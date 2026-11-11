// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Where are we" — a row of steps joined by a line, the finished ones filled
 * in the community colour, the current one ringed (warmth plan Phase 4 B5).
 *
 * An ordered list, so screen readers hear "list, 4 items" and each step's
 * state; the current step carries aria-current="step". Labels wrap under each
 * dot on narrow screens rather than squeezing.
 */

import Check from 'lucide-react/icons/check';

export interface TrackerStep {
  key: string;
  label: string;
}

interface StepTrackerProps {
  steps: readonly TrackerStep[];
  /** Index of the current step; steps before it are done. */
  current: number;
  /** Mark every step done (the journey is complete). */
  complete?: boolean;
  /** Accessible name for the list, e.g. "Exchange progress". */
  label: string;
  /** Read out with finished steps, e.g. "done". */
  doneText: string;
  /** Read out with the current step, e.g. "current step". */
  currentText: string;
  className?: string;
}

export function StepTracker({ steps, current, complete = false, label, doneText, currentText, className = '' }: StepTrackerProps) {
  return (
    <ol aria-label={label} className={`flex w-full items-start ${className}`}>
      {steps.map((step, index) => {
        const done = complete || index < current;
        const isCurrent = !complete && index === current;
        const last = index === steps.length - 1;
        return (
          <li
            key={step.key}
            aria-current={isCurrent ? 'step' : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center text-center"
          >
            {!last && (
              <span
                aria-hidden="true"
                className={`absolute top-4 left-[calc(50%+1.25rem)] right-[calc(-50%+1.25rem)] h-0.5 rounded-full ${
                  done ? 'bg-accent-strong' : 'bg-theme-default'
                }`}
              />
            )}
            <span
              aria-hidden="true"
              className={`relative z-10 flex size-8 items-center justify-center rounded-full text-sm font-semibold ${
                done
                  ? 'bg-accent-strong text-white'
                  : isCurrent
                    ? 'bg-accent-soft text-accent-soft-foreground ring-2 ring-accent-strong ring-offset-2 ring-offset-[var(--surface-solid)]'
                    : 'bg-theme-elevated text-theme-muted'
              }`}
            >
              {done ? <Check className="size-4" /> : index + 1}
            </span>
            <span className={`mt-2 px-1 text-xs leading-tight sm:text-sm ${isCurrent ? 'font-semibold text-theme-primary' : 'text-theme-secondary'}`}>
              {step.label}
              <span className="sr-only">{done ? ` (${doneText})` : isCurrent ? ` (${currentText})` : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default StepTracker;
