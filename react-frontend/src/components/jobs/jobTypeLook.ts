// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * How a job's type looks: the colour of its label and the picture on its
 * tile. Defined once so the jobs list's card and the job form's live preview
 * cannot disagree (they did: audit of warmth phase 5, 12 Nov 2026).
 *
 * The label colours carry meaning and are the same in every community:
 * paid work is the success green, time-credit work the site accent.
 */

import type { LucideIcon } from 'lucide-react';
import Briefcase from 'lucide-react/icons/briefcase';
import DollarSign from 'lucide-react/icons/dollar-sign';
import Heart from 'lucide-react/icons/heart';
import Timer from 'lucide-react/icons/timer';

export const JOB_TYPE_CHIP_COLOURS: Record<string, 'success' | 'default' | 'accent'> = {
  paid: 'success',
  volunteer: 'default',
  timebank: 'accent',
};

export const JOB_TYPE_ICONS = {
  paid: DollarSign,
  volunteer: Heart,
  timebank: Timer,
} as const satisfies Record<string, LucideIcon>;

/** The picture for a job type; a briefcase for a type it does not know. */
export function jobTypeIcon(type: string): LucideIcon {
  return (JOB_TYPE_ICONS as Record<string, LucideIcon | undefined>)[type] ?? Briefcase;
}
