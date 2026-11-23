// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A list of communities that fits its card at every width.
 *
 * Billing control and Branch payments were tables with a fixed minimum width
 * (1,500px and 1,180px) that scrolled sideways inside their card. The scroll
 * bar went unnoticed and the columns past it went unread (owner, 23 Nov 2026).
 * Both are still one HeroUI table — same roles, same keyboard movement — but
 * each row is laid out as a CSS grid: aligned columns from the `xl`
 * breakpoint, and below it a stacked block per community with the column's
 * name above each part.
 *
 * 🔴 Do not give a table using this a `min-w-[…]`. The whole point is that
 * nothing has to be found by scrolling sideways.
 *
 * 🔴 A "member" count on these pages is two numbers. A plan's limit is on
 * ACTIVE members (signed in within the server's window: the pricing page's
 * definition). Everyone with an account is shown beside it for information
 * and is checked against nothing. `MemberNumbers` labels both, because
 * "35 / 50" read as a fault beside a community of 274.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Meter, MeterFill, MeterTrack } from '@/components/ui';
import { formatNumber } from '@/lib/helpers';

// One grid for the heading row and every community's row, so the columns line
// up from `xl`. Written out in full twice: the stylesheet only keeps class
// names it can read whole in the source.
const ROW_COLUMNS = 'xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.15fr)_12.5rem]';
const HEAD_COLUMNS = 'xl:[&>tr]:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.15fr)_12.5rem]';

// Branch plans: the plan, its member number, a price in each currency, whether
// it is offered, and its actions.
const PLAN_ROW_COLUMNS = 'xl:grid-cols-[minmax(0,1.9fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_12.5rem]';
const PLAN_HEAD_COLUMNS = 'xl:[&>tr]:grid-cols-[minmax(0,1.9fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_12.5rem]';

/** The shared Table's `classNames` for one column template. */
function gridClasses(rowColumns: string, headColumns: string) {
  return {
    table: '!block',
    thead: `block max-xl:sr-only [&>tr]:grid [&>tr]:gap-x-4 [&>tr]:px-4 ${headColumns}`,
    th: '!px-0 after:!hidden',
    tbody: 'block',
    tr: `grid grid-cols-1 gap-x-4 gap-y-4 px-4 py-4 sm:grid-cols-2 ${rowColumns}`,
    td: '!block !h-auto min-w-0 !border-0 !bg-transparent !p-0',
  } as const;
}

/**
 * `classNames` for the shared Table: five columns (the community, three of
 * facts, and its actions) from `xl`; one block per community below it, two
 * parts to a line from `sm`.
 */
export const COMMUNITY_GRID_CLASSES = gridClasses(ROW_COLUMNS, HEAD_COLUMNS);

/** The same layout for Branch plans' six columns. */
export const PLAN_GRID_CLASSES = gridClasses(PLAN_ROW_COLUMNS, PLAN_HEAD_COLUMNS);

/** The first cell of a row: the whole line when stacked, one column from `xl`. */
export const COMMUNITY_GRID_LEAD_CELL = 'sm:col-span-2 xl:col-span-1';

// In columns (from `xl`) the name is indented; stacked, the whole block is, so
// a community still sits visibly under the one above it. Shallower on a small
// screen, where every 16px counts.
const NAME_INDENT = ['xl:pl-0', 'xl:pl-4', 'xl:pl-8', 'xl:pl-12', 'xl:pl-16', 'xl:pl-20'] as const;
const BLOCK_INDENT = ['max-xl:ml-0', 'max-xl:ml-4', 'max-xl:ml-8', 'max-xl:ml-10', 'max-xl:ml-12', 'max-xl:ml-12'] as const;

function indentStep(steps: number): number {
  return Math.min(NAME_INDENT.length - 1, Math.max(0, steps));
}

/** `steps`: how many levels below the top of the list the community sits. */
export function nameIndentFor(steps: number): string {
  return NAME_INDENT[indentStep(steps)] ?? NAME_INDENT[0];
}

export function blockIndentFor(steps: number): string {
  return BLOCK_INDENT[indentStep(steps)] ?? BLOCK_INDENT[0];
}

/**
 * The column's name above a block when the rows are stacked (below `xl` the
 * heading row is off screen). Hidden from assistive technology: the table
 * already ties each cell to its column heading.
 */
export function StackedLabel({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="mb-1.5 block text-xs font-medium text-muted xl:hidden">
      {children}
    </span>
  );
}

/**
 * A community's payment standing as one word, for the chip both billing lists
 * show. One copy: Billing control and Branch payments each had their own.
 * Exempt wins: an exempt community is never paused, whatever is above it.
 */
export type StandingState = 'open' | 'paused' | 'paused_from_above' | 'exempt';

export function standingStateOf(standing: { exempt: boolean; suspended_at: string | null; locked: boolean }): StandingState {
  if (standing.exempt) return 'exempt';
  if (standing.suspended_at !== null) return 'paused';
  if (standing.locked) return 'paused_from_above';
  return 'open';
}

export const STANDING_COLOR: Record<StandingState, 'success' | 'warning' | 'danger' | 'default'> = {
  open: 'success',
  paused: 'danger',
  paused_from_above: 'warning',
  // Neutral: an exemption is not a warning, and the brand colour read as one.
  exempt: 'default',
};

/**
 * Where the active members stand against the plan's member number, as the
 * server worked it out (MemberLevel, from the platform's one warning percent).
 * No screen works this out itself: `full` is exactly at the number, `over` is
 * past it.
 */
export type MembersLevel = 'ok' | 'near' | 'full' | 'over';

const MEMBERS_TEXT: Record<MembersLevel, string> = {
  ok: 'font-medium',
  near: 'font-medium text-warning',
  full: 'font-semibold text-danger',
  over: 'font-semibold text-danger',
};

const MEMBERS_METER: Record<MembersLevel, 'accent' | 'warning' | 'danger'> = {
  ok: 'accent',
  near: 'warning',
  full: 'danger',
  over: 'danger',
};

interface MemberNumbersProps {
  /** Signed in within the server's window, whole branch: what a plan's limit counts. */
  active: number;
  /** The plan's member number; null with no plan or no limit. */
  max: number | null;
  /** Of the limit, as the server worked it out; shown in brackets when given. */
  percent?: number | null;
  level: MembersLevel;
  /** Everyone in the branch with an account in good standing. Left out when the server did not send it. */
  total?: number;
  /** Extra label and value pairs under "All members". */
  children?: ReactNode;
  activeTestId?: string;
  totalTestId?: string;
}

/**
 * A bar against the plan's limit, then "Active members" and "All members",
 * each named. Only the active number is ever coloured.
 */
export function MemberNumbers({ active, max, percent = null, level, total, children, activeTestId, totalTestId }: MemberNumbersProps) {
  const { t } = useTranslation('super_admin');

  const againstLimit = max === null
    ? formatNumber(active)
    : t('branch_payments.members_of_max', { active: formatNumber(active), max: formatNumber(max) });
  const activeText = max !== null && percent !== null ? `${againstLimit} (${percent}%)` : againstLimit;

  return (
    <div className="flex flex-col gap-1.5">
      {max !== null ? (
        <Meter
          aria-label={t('branch_payments.col_members')}
          value={Math.min(active, max)}
          maxValue={max}
          valueLabel={againstLimit}
          color={MEMBERS_METER[level]}
          size="sm"
          className="max-w-48"
        >
          <MeterTrack>
            <MeterFill />
          </MeterTrack>
        </Meter>
      ) : null}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted">{t('branch_payments.col_members')}</dt>
        <dd data-testid={activeTestId} className={MEMBERS_TEXT[level]}>{activeText}</dd>
        {typeof total === 'number' ? (
          <>
            <dt className="text-muted">{t('branch_payments.members_all')}</dt>
            <dd data-testid={totalTestId}>{formatNumber(total)}</dd>
          </>
        ) : null}
        {children}
      </dl>
    </div>
  );
}

/** What "active" means, said once above the list. */
export function ActiveMembersNote({ days, icon }: { days: number; icon: ReactNode }) {
  const { t } = useTranslation('super_admin');

  return (
    <p className="flex items-start gap-2 px-4 py-3 text-xs text-muted">
      {icon}
      <span>{t('branch_payments.members_note', { days: formatNumber(days) })}</span>
    </p>
  );
}
