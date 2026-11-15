// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The community's shared goal on the dashboard (warmth phase 6, D1).
 *
 * The community's admin sets one goal on "Make it yours" ("Let's share 500
 * hours by spring"). This shows the whole community's progress towards it —
 * a community total, never a figure for one member — with the days left.
 * When the target is reached, each member sees one celebration as the card
 * comes into view (remembered on this device once it has played, never for
 * anyone who asks for less motion) and the card says
 * it was reached. With no goal running, up to three finished goals are listed
 * quietly as "What we've done together". Nothing at all for a community that
 * has never set one.
 *
 * Read from GET /v2/community/this-month, the request the other dashboard
 * moments already make, so the client shares it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Flag from 'lucide-react/icons/flag';
import PartyPopper from 'lucide-react/icons/party-popper';
import { Card, CardBody } from '@/components/ui/Card';
import { ConfettiCelebration } from '@/components/ui/ConfettiCelebration';
import { Progress } from '@/components/ui/Progress';
import { useAuth, useTenant } from '@/contexts';
import { useSiteAccent } from '@/contexts/SiteAccentContext';
import { api } from '@/lib/api';
import { confettiColoursFor } from '@/lib/confettiColours';
import { getFormattingLocale } from '@/lib/helpers';

export type CommunityGoalMetric = 'hours' | 'exchanges' | 'offers' | 'events';

export interface CommunityGoalRunning {
  id: string;
  title: string;
  metric: CommunityGoalMetric;
  target: number;
  current: number;
  starts_on: string;
  ends_on: string;
  days_left: number;
  reached: boolean;
}

export interface CommunityGoalDone {
  id: string;
  title: string;
  metric: CommunityGoalMetric;
  target: number;
  final_count: number;
  reached: boolean;
  starts_on: string;
  ends_on: string;
}

interface GoalReply {
  community_goal?: CommunityGoalRunning | null;
  community_goals_done?: CommunityGoalDone[] | null;
}

const METRICS: readonly CommunityGoalMetric[] = ['hours', 'exchanges', 'offers', 'events'];
const DONE_SHOWN = 3;
/** How long the confetti plays before the celebration counts as seen. */
export const CELEBRATION_MS = 1500;
const STANDARD_ACCENT = '#5b5ede';

function isMetric(value: unknown): value is CommunityGoalMetric {
  return typeof value === 'string' && (METRICS as readonly string[]).includes(value);
}

/** One celebration per member per goal; a changed target or metric is a new goal. */
function celebrationKey(tenantId: unknown, userId: unknown, goal: CommunityGoalRunning): string {
  return `nexus_goal_celebrated_${String(tenantId)}_${String(userId)}_${goal.id}_${goal.metric}_${goal.target}`;
}

function wasCelebrated(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function prefersLessMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** "3.5 of 500 hours shared" — the plural follows the target, the noun it goes with. */
function useProgressLine() {
  const { t } = useTranslation('dashboard');
  const locale = getFormattingLocale();
  return (metric: CommunityGoalMetric, current: number, target: number) => {
    const values = {
      count: target,
      current: current.toLocaleString(locale),
      target: target.toLocaleString(locale),
    };
    switch (metric) {
      case 'exchanges':
        return t('community_goal.progress_exchanges', values);
      case 'offers':
        return t('community_goal.progress_offers', values);
      case 'events':
        return t('community_goal.progress_events', values);
      default:
        return t('community_goal.progress_hours', values);
    }
  };
}

export function CommunityGoal({ className = '' }: { className?: string }) {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const { tenant } = useTenant();
  const accent = useSiteAccent() ?? STANDARD_ACCENT;
  const progressLine = useProgressLine();
  const [goal, setGoal] = useState<CommunityGoalRunning | null>(null);
  const [finished, setFinished] = useState<CommunityGoalDone[]>([]);
  // The key of a celebration showing now, or null.
  const [celebrationKeyShown, setCelebrationKey] = useState<string | null>(null);
  const [inView, setInView] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const celebrate = celebrationKeyShown !== null && inView;
  const userId = user?.id;
  const tenantId = tenant?.id;

  useEffect(() => {
    let cancelled = false;
    api.get<GoalReply>('/v2/community/this-month')
      .then((res) => {
        if (cancelled || !res.success) return;
        const raw = res.data?.community_goal;
        const running = raw && isMetric(raw.metric) && raw.target > 0 ? raw : null;
        setGoal(running);
        const done = Array.isArray(res.data?.community_goals_done) ? res.data.community_goals_done : [];
        setFinished(done.filter((entry) => isMetric(entry.metric) && entry.target > 0).slice(0, DONE_SHOWN));

        // The celebration: once per member per goal. Decided with the goal so
        // the card never redraws for it; remembered (below) only once it has
        // had time to play, so a card that is replaced at once still gets it.
        const key = running?.reached && userId ? celebrationKey(tenantId, userId, running) : null;
        setCelebrationKey(key && !wasCelebrated(key) && !prefersLessMotion() ? key : null);
      })
      .catch(() => {
        // No answer, no goal. The month highlight logs the same failure.
      });
    return () => {
      cancelled = true;
    };
  }, [userId, tenantId]);

  // The card sits below the fold on a phone: the confetti waits until the
  // member can actually see the card.
  useEffect(() => {
    setInView(false);
    if (!celebrationKeyShown) return undefined;
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.5 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [celebrationKeyShown]);

  // Remember the celebration once it has played.
  useEffect(() => {
    if (!celebrate || !celebrationKeyShown) return undefined;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(celebrationKeyShown, '1');
      } catch {
        // Storage unavailable: it may celebrate again next visit.
      }
    }, CELEBRATION_MS);
    return () => window.clearTimeout(timer);
  }, [celebrate, celebrationKeyShown]);

  const confetti = useMemo(() => confettiColoursFor(accent), [accent]);

  if (goal) {
    const percent = Math.round(Math.min(100, Math.max(0, (goal.current / goal.target) * 100)) * 10) / 10;
    const daysLeft = Math.max(0, Math.round(goal.days_left));

    return (
      <Card data-testid="community-goal" className={`relative overflow-hidden border-0 bg-accent-soft shadow-none ${className}`}>
        {celebrate && (
          <div data-testid="community-goal-confetti">
            <ConfettiCelebration show colors={confetti} />
          </div>
        )}
        <CardBody className="relative flex flex-row items-start gap-4 p-4 sm:p-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-strong text-white shadow-sm">
            {goal.reached ? <PartyPopper className="size-5" aria-hidden="true" /> : <Flag className="size-5" aria-hidden="true" />}
          </span>
          <div ref={cardRef} className="min-w-0 flex-1 space-y-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-theme-secondary">
                {goal.reached ? t('community_goal.reached_label') : t('community_goal.label')}
              </p>
              <h2 className="break-words text-base font-bold text-theme-primary">{goal.title}</h2>
            </div>
            <Progress
              aria-label={t('community_goal.progress_label')}
              value={percent}
              size="sm"
              className="w-full"
            />
            <p className="text-sm leading-6 text-theme-secondary">
              {progressLine(goal.metric, goal.current, goal.target)}
              <span aria-hidden="true"> · </span>
              {goal.reached
                ? t('community_goal.reached_body')
                : daysLeft === 0
                  ? t('community_goal.last_day')
                  : t('community_goal.days_left', { count: daysLeft })}
            </p>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (finished.length === 0) return null;

  return (
    <Card data-testid="community-goals-done" className={`border border-divider/70 bg-surface shadow-none ${className}`}>
      <CardBody className="p-4 sm:p-5">
        <h2 className="text-base font-semibold text-theme-primary">{t('community_goal.done_title')}</h2>
        <ul className="mt-3 space-y-2">
          {finished.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-baseline sm:gap-2">
              <span className="break-words font-medium text-theme-primary">{entry.title}</span>
              <span className="text-theme-secondary">
                {progressLine(entry.metric, entry.final_count, entry.target)}
                {entry.reached && (
                  <>
                    <span aria-hidden="true"> · </span>
                    {t('community_goal.done_reached')}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export default CommunityGoal;
