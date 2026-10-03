// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The always-available "Help & support" launcher for signed-in members.
 *
 * One button, two shapes, switched at `lg` (1024px) — the breakpoint at which
 * MobileTabBar disappears (see its 🔴 note; keep the two in step):
 *
 * - Below `lg` it is a round 48px icon button docked just ABOVE the bottom tab
 *   bar, at the bottom-right. Its label stays in the accessibility tree (sr-only),
 *   so it is announced as "Help & support" at every width. It sits in the slot
 *   BackToTop has always stacked above (BackToTop's `8.75rem` offset), clears the
 *   podcast mini-player through `--miniplayer-offset`, and respects the
 *   home-indicator inset. A labelled pill there covered card content on phones,
 *   which is why the launcher was once hidden on small screens entirely — and,
 *   being `md:block`, it then sat BEHIND the tab bar from 768px to 1023px.
 * - From `lg` up it is the labelled pill at the bottom-right corner.
 *
 * On routes where the tab bar is not shown (a message thread, onboarding) the
 * small-screen launcher is not shown either: there it would sit over a composer
 * or a full-height page. index.css also hides it while the on-screen keyboard is
 * up or a bottom sheet / cookie banner covers the tab bar (`[data-support-launcher]`).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import LifeBuoy from 'lucide-react/icons/life-buoy';

import { ReportProblemDialog } from '@/components/feedback/ReportProblemButton';
import { useMobileTabBarVisible } from '@/components/layout/MobileTabBar';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';

export function FloatingReportProblemButton() {
  const { t } = useTranslation('common');
  const { isAuthenticated } = useAuth();
  const tabBarVisible = useMobileTabBarVisible();
  const [isOpen, setIsOpen] = useState(false);

  // Logged-in users only — keeps anonymous traffic from spamming support reports / Sentry.
  if (!isAuthenticated) {
    return null;
  }

  return (
    <>
      <div
        data-testid="floating-report-problem"
        data-support-launcher
        className={[
          'fixed z-280',
          'right-[calc(var(--safe-area-right)+0.75rem)] bottom-[calc(var(--safe-area-bottom)+5.25rem+var(--miniplayer-offset,0rem))]',
          'lg:right-6 lg:bottom-[calc(1.5rem+var(--miniplayer-offset,0rem))]',
          tabBarVisible ? '' : 'hidden lg:block',
        ].join(' ')}
      >
        <Button
          type="button"
          variant="ghost"
          onPress={() => setIsOpen(true)}
          data-testid="floating-report-problem-trigger"
          className={[
            'group h-12 min-h-12 w-12 min-w-12 gap-2 rounded-full p-0',
            'border border-[var(--border-default)] bg-[var(--surface-dropdown)] text-theme-primary',
            'shadow-lg shadow-black/15 dark:shadow-black/40',
            'hover:border-accent/50 hover:bg-[var(--surface-dropdown)]',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            'motion-safe:transition-[transform,border-color,box-shadow] motion-safe:duration-150 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-xl',
            'lg:w-auto lg:pe-5 lg:ps-1.5',
          ].join(' ')}
        >
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[var(--color-primary)] group-hover:bg-accent/15"
          >
            <LifeBuoy className="size-5" strokeWidth={2.25} />
          </span>
          <span className="sr-only text-sm font-semibold lg:not-sr-only">
            {t('report_problem.trigger')}
          </span>
        </Button>
      </div>

      <ReportProblemDialog isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}

export default FloatingReportProblemButton;
