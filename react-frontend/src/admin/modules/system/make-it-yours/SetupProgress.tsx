// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "3 of 6 done" — the bar and, optionally, the list of steps. Shared by the
 * "Make it yours" page and the admin dashboard's card, so the two can never
 * disagree about how far a community has got.
 *
 * HeroUI ProgressBar, through the app's Progress wrapper. A Meter would be
 * the closer word for "a quantity in a known range", but React Aria gives it
 * `role="meter progressbar"`, which axe 4 reports as a critical
 * aria-allowed-attr failure (seen in the browser, 13 Nov 2026). A progress
 * bar is announced correctly everywhere and is what the rest of the app uses.
 */

import { useTranslation } from 'react-i18next';
import CircleCheck from 'lucide-react/icons/circle-check';
import Circle from 'lucide-react/icons/circle';
import { Progress } from '@/components/ui';
import type { CommunitySetupStatus, CommunitySetupStepKey } from '../../../api/adminApi';

/** The page's anchor for a step, so the list can jump to it. */
export function setupStepAnchor(key: CommunitySetupStepKey): string {
  return `make-it-yours-${key}`;
}

export interface SetupProgressProps {
  status: Pick<CommunitySetupStatus, 'steps' | 'done' | 'total'>;
  /** Show each step with its tick, as jump links (the page) — or the meter alone (the card). */
  showSteps?: boolean;
  className?: string;
}

export function SetupProgress({ status, showSteps = false, className = '' }: SetupProgressProps) {
  const { t } = useTranslation('admin_system');
  const complete = status.total > 0 && status.done >= status.total;
  const summary = t('admin_settings.miy_progress', { done: status.done, total: status.total });

  return (
    <div className={className} data-testid="setup-progress">
      <Progress
        value={status.done}
        minValue={0}
        maxValue={Math.max(1, status.total)}
        color={complete ? 'success' : 'primary'}
        label={t('admin_settings.miy_progress_label')}
        showValueLabel
        valueLabel={summary}
        className="w-full"
        // Both in the page's main text colour: this bar also sits on the dashboard
        // card's tinted background, where muted grey fell to 4.08:1 (axe, 13 Nov 2026).
        classNames={{ label: 'text-sm font-medium text-foreground', value: 'text-sm tabular-nums text-foreground' }}
      />

      {showSteps && (
        <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {status.steps.map((step) => (
            <li key={step.key} data-testid={`setup-progress-step-${step.key}`} data-done={step.done ? 'true' : 'false'}>
              <a
                href={`#${setupStepAnchor(step.key)}`}
                className="inline-flex items-center gap-2 rounded-md text-sm text-foreground underline-offset-4 outline-solid outline-transparent hover:underline focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
              >
                {step.done ? (
                  <CircleCheck size={18} className="shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <Circle size={18} className="shrink-0 text-muted" aria-hidden="true" />
                )}
                <span>{t(`admin_settings.miy_step_${step.key}`)}</span>
                {/* The tick is a picture; say the state in words for a screen reader. */}
                <span className="sr-only">
                  {step.done ? t('admin_settings.miy_done') : t('admin_settings.miy_to_do')}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SetupProgress;
