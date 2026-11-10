// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The bars of the dashboard's "hours shared, month by month" chart. Kept in
 * its own file so the charting library stays out of the dashboard's own
 * bundle: CommunityHoursChart loads this only when there is something to draw.
 *
 * Drawn inside an `aria-hidden` box (the numbers are read from the list beside
 * it), so the chart's own keyboard layer is switched off — nothing hidden from
 * a screen reader may take focus. No animation when the member, or their
 * device, asks for reduced motion.
 */

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { CHART_TOKEN_COLORS } from '@/lib/chartColors';
import { useReducedMotion } from '@/lib/motion';
import type { CommunityHoursPoint } from './CommunityHoursChart';

const tooltipStyle = {
  borderRadius: '8px',
  border: `1px solid ${CHART_TOKEN_COLORS.border}`,
  backgroundColor: CHART_TOKEN_COLORS.surface,
  color: CHART_TOKEN_COLORS.foreground,
};

interface CommunityHoursBarsProps {
  points: ReadonlyArray<CommunityHoursPoint>;
  /** The name of the figure, shown in the hover box (the card's own heading). */
  label: string;
}

export function CommunityHoursBars({ points, label }: CommunityHoursBarsProps) {
  const reducedMotion = useReducedMotion();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={[...points]} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} accessibilityLayer={false}>
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'currentColor' }} tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: 'var(--accent)', fillOpacity: 0.08 }}
          contentStyle={tooltipStyle}
          labelStyle={{ fontWeight: 600 }}
          formatter={(_value, _name, item) => [(item?.payload as CommunityHoursPoint | undefined)?.formatted ?? '', label]}
        />
        <Bar
          dataKey="hours"
          name={label}
          fill="var(--accent-strong)"
          radius={[6, 6, 0, 0]}
          maxBarSize={48}
          isAnimationActive={!reducedMotion}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default CommunityHoursBars;
