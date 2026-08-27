// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Frontend-specific type extensions
 * These types extend API types with computed properties for UI convenience
 */

import { resolveUserDisplayName } from '@/lib/helpers';
import type { User as ApiUser, Listing as ApiListing } from './api';

// ─────────────────────────────────────────────────────────────────────────────
// Extended User type with computed name
// ─────────────────────────────────────────────────────────────────────────────

export interface FrontendUser extends ApiUser {
  /** Computed full name for display */
  name: string;
}

/**
 * Transform API user to frontend user with computed name
 */
export function transformUser(user: ApiUser): FrontendUser {
  return {
    ...user,
    // Organisation accounts are identified by `organization_name`, never by the
    // contact person in first_name/last_name -- resolveUserDisplayName() is the
    // single place that precedence lives.
    name: resolveUserDisplayName(user, 'Unknown'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extended Listing type with computed user name
// ─────────────────────────────────────────────────────────────────────────────

export interface FrontendListing extends ApiListing {
  /** Alias for estimated_hours */
  hours_estimate?: number;
}

export function transformListing(listing: ApiListing): FrontendListing {
  return {
    ...listing,
    hours_estimate: listing.estimated_hours,
  };
}
