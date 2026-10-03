// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared types and small building blocks for the safeguarding panels.
 *
 * The safeguarding work used to be one dashboard with four tabs. Brokers told
 * us the tabs hid things, so each tab is now its own page in the broker panel
 * (Members' support needs, Guardians, Support actions), and each page renders
 * one of the panels in this folder. The flagged-messages tab listed the same
 * message copies as the Messages queue and was merged into it. What the
 * panels share lives here.
 */

import { useMemo } from 'react';
import type { Key } from '@heroui/react/rac';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';

// ─────────────────────────────────────────────────────────────────────────────
// Types (API shapes)
// ─────────────────────────────────────────────────────────────────────────────

export interface GuardianAssignment {
  id: number;
  ward: { id: number; name: string; avatar_url?: string | null };
  guardian: { id: number; name: string; avatar_url?: string | null };
  status: 'active' | 'revoked' | 'expired';
  consent_given: boolean;
  created_at: string;
  expires_at?: string;
}

/** Trigger keys that change what a member can do — see SafeguardingSupportNeedsService. */
export const PROTECTION_KEYS = [
  'requires_vetted_interaction',
  'requires_broker_approval',
  'restricts_messaging',
  'restricts_matching',
] as const;
export type ProtectionKey = (typeof PROTECTION_KEYS)[number];

/** GET /v2/admin/safeguarding/member-preferences row. */
export interface MemberSupportNeed {
  user_id: number;
  user_name: string;
  user_avatar?: string | null;
  options: { option_key: string; label: string; is_declination: boolean }[];
  consent_given_at: string;
  has_triggers: boolean;
  is_declination_only: boolean;
  /** Protections the member's answers switch on, in display order. */
  protections?: ProtectionKey[];
  /** When staff last marked the member as seen, if since their latest answer. */
  seen_at?: string | null;
  seen_by_name?: string | null;
  needs_review?: boolean;
}

/**
 * A live co-decide action awaiting the supported member's answer — from
 * GET /v2/admin/safeguarding/support-actions. Staff see these so that when a
 * member confirms OFFLINE (phone / in person / paper), the confirmation can
 * be recorded here. The raw payload is deliberately not exposed; only the
 * safe summary travels.
 */
export interface SupportActionRow {
  id: number;
  action_type: 'listing_create' | 'credit_transfer';
  payload_summary: { title?: string | null; amount?: number | null; recipient_id?: number | null; recipient_name?: string | null };
  supported_name: string | null;
  supporter_name: string | null;
  created_at: string | null;
  expires_at: string | null;
}

export const ATTEST_CHANNELS = ['phone', 'in_person', 'paper'] as const;
export type AttestChannel = (typeof ATTEST_CHANNELS)[number];

/**
 * Legal-basis attestation (guardian redesign phase 6). Staff record that they
 * SIGHTED the formal authority behind act-alone power. Closed vocabularies
 * mirror SupportAuthorityAttestationService — free text cannot invent an
 * authority type or a revocation reason.
 */
export const AUTHORITY_TYPES = ['dmr_court_order', 'power_of_attorney', 'edm_assistant_agreement', 'co_decision_agreement'] as const;
export type AuthorityType = (typeof AUTHORITY_TYPES)[number];
export const REVOCATION_REASONS = ['authority_ended', 'superseded', 'entered_in_error', 'expired', 'other_documented'] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

export interface AuthorityAttestation {
  id: number;
  authority_type: AuthorityType;
  decision: 'active' | 'revoked';
  scope_summary: string | null;
  attested_at: string | null;
  revoked_at: string | null;
  revocation_reason_code: string | null;
}

export interface AuthorityRelationship {
  relationship_id: number;
  supporter_name: string | null;
  supported_name: string | null;
  relationship_type: string;
  attestations: AuthorityAttestation[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tell the broker panel's sidebar to refresh its counts now rather than at its
 * next one-minute poll — fired after an action that changes a count.
 */
export const BROKER_BADGES_REFRESH_EVENT = 'nexus:broker-badges-refresh';
export function requestBadgeRefresh(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BROKER_BADGES_REFRESH_EVENT));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter bar — a row of buttons, one per view of the list, each with its count
// ─────────────────────────────────────────────────────────────────────────────

export interface SafeguardingFilterOption<K extends string> {
  key: K;
  label: string;
  count?: number;
}

export function SafeguardingFilterBar<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** Accessible name for the group, e.g. "Show". */
  label: string;
  options: SafeguardingFilterOption<K>[];
  value: K;
  onChange: (next: K) => void;
}) {
  const selectedKeys = useMemo(() => new Set<Key>([value]), [value]);
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      isDetached
      size="sm"
      className="flex-wrap"
      selectedKeys={selectedKeys}
      onSelectionChange={(keys) => {
        const next = Array.from(keys)[0];
        if (typeof next === 'string' && options.some((o) => o.key === next)) {
          onChange(next as K);
        }
      }}
    >
      {options.map((option) => (
        <ToggleButton
          key={option.key}
          id={option.key}
          className="data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
        >
          {option.label}
          {typeof option.count === 'number' && (
            <span className="tabular-nums opacity-80">({option.count})</span>
          )}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
