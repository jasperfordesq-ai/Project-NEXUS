// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared vocabulary for the Risk Tags page and its form modal: level and
 * category keys, their icons, and the form both create and edit fill.
 */

import type { LucideIcon } from 'lucide-react';
import Shield from 'lucide-react/icons/shield';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ShieldHalf from 'lucide-react/icons/shield-half';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import Banknote from 'lucide-react/icons/banknote';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import Scale from 'lucide-react/icons/scale';
import Star from 'lucide-react/icons/star';
import Tag from 'lucide-react/icons/tag';
import type { RiskTag } from '@/admin/api/types';

export const RISK_LEVEL_KEYS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevelKey = (typeof RISK_LEVEL_KEYS)[number];

export const RISK_CATEGORY_KEYS = [
  'safeguarding',
  'financial',
  'health_safety',
  'legal',
  'reputation',
  'fraud',
  'other',
] as const;

// Risk level filter is mirrored to `?level=` so stat-card deep-links work.
// `elevated` is not a stored level: it means high + critical, the same set
// the broker dashboard's "High-risk listings" tile counts and links here with.
export const RISK_LEVEL_FILTERS = ['all', 'elevated', 'critical', 'high', 'medium', 'low'] as const;
export type RiskLevelFilter = (typeof RISK_LEVEL_FILTERS)[number];

// Category → decorative icon. Unknown categories fall back to a neutral tag.
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  safeguarding: Shield,
  financial: Banknote,
  health_safety: HeartPulse,
  legal: Scale,
  reputation: Star,
  fraud: TriangleAlert,
  other: Tag,
};

// Level → icon used in tabs and the KPI header (severity-coded).
export const LEVEL_ICONS: Record<RiskLevelFilter, LucideIcon> = {
  all: Shield,
  elevated: ShieldAlert,
  critical: ShieldAlert,
  high: TriangleAlert,
  medium: ShieldHalf,
  low: ShieldCheck,
};

export interface RiskTagFormValues {
  listing_id: string;
  risk_level: RiskLevelKey;
  risk_category: string;
  risk_notes: string;
  member_visible_notes: string;
  requires_approval: boolean;
  insurance_required: boolean;
}

export const EMPTY_RISK_TAG_FORM: RiskTagFormValues = {
  listing_id: '',
  risk_level: 'medium',
  risk_category: '',
  risk_notes: '',
  member_visible_notes: '',
  requires_approval: false,
  insurance_required: false,
};

export function riskTagFormFromTag(tag: RiskTag): RiskTagFormValues {
  return {
    listing_id: String(tag.listing_id),
    risk_level: tag.risk_level,
    risk_category: tag.risk_category,
    risk_notes: tag.risk_notes ?? '',
    member_visible_notes: tag.member_visible_notes ?? '',
    requires_approval: tag.requires_approval,
    insurance_required: tag.insurance_required,
  };
}

/** A listing as the picker and the modal pass it around. */
export interface ListingSummary {
  id: number;
  title: string;
  owner_name?: string;
}

/**
 * The register row as the API returns it. `owner_id` is not in the shared
 * type yet: the endpoint currently selects `owner_name` only, so the owner's
 * name opens the member window as soon as the backend adds the id.
 */
export type RiskTagRow = RiskTag & { owner_id?: number | null };
