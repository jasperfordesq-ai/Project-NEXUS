// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * NEXUS API Response Schemas (Zod)
 *
 * Runtime validation schemas for critical API responses.
 * These schemas validate the ESSENTIAL fields only — extra fields are allowed
 * via .passthrough() so the API can evolve without breaking validation.
 *
 * Used ONLY in development mode for diagnostics. In production these are
 * never imported (tree-shaken away by the dev-mode guard in validateResponse).
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Base API Response Envelope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the base API response wrapper returned by api.ts after unwrapping.
 * After api.ts processes the raw response, it returns:
 *   { success, data?, error?, message?, code?, meta? }
 */
export const apiResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  meta: z.object({
    per_page: z.number().optional(),
    has_more: z.boolean().optional(),
    cursor: z.string().nullable().optional(),
    next_cursor: z.string().nullable().optional(),
    previous_cursor: z.string().nullable().optional(),
    current_page: z.number().optional(),
    total_items: z.number().optional(),
    total_pages: z.number().optional(),
    total: z.number().optional(),
    from: z.number().optional(),
    to: z.number().optional(),
    last_page: z.number().optional(),
    has_next_page: z.boolean().optional(),
    has_previous_page: z.boolean().optional(),
    path: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// User Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the essential fields of a User object.
 * Many fields are optional because the backend returns different subsets
 * depending on the endpoint (e.g., /me vs /users/:id vs login response).
 */
export const userSchema = z.object({
  id: z.number(),
  email: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  name: z.string().optional(),
  username: z.string().optional(),
  avatar: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  role: z.enum(['member', 'admin', 'moderator', 'tenant_admin', 'super_admin']).optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'pending']).optional(),
  tenant_id: z.number().optional(),
  tenant_slug: z.string().optional(),
  balance: z.number().optional(),
  level: z.number().optional(),
  onboarding_completed: z.boolean().optional(),
  created_at: z.string().optional(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Login Response Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a successful login response (after api.ts unwraps `data`).
 * The login endpoint returns user + tokens at the top level (not inside `data`),
 * so api.ts returns the full response as `data` because `'data' in response` is false.
 */
export const loginSuccessResponseSchema = z.object({
  success: z.literal(true).optional(),
  user: userSchema,
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  token: z.string().optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional(),
}).passthrough();

/**
 * Validates a 2FA-required response.
 */
export const twoFactorRequiredSchema = z.object({
  requires_2fa: z.literal(true),
  two_factor_token: z.string(),
  methods: z.array(z.string()),
  allow_trusted_device: z.boolean().optional(),
  trusted_device_days: z.number().int().min(1).max(365).optional(),
}).passthrough();

/**
 * Validates either a success or 2FA response from login.
 */
export const loginResponseSchema = z.union([
  loginSuccessResponseSchema,
  twoFactorRequiredSchema,
  z.object({ requires_2fa_setup: z.literal(true), two_factor_token: z.string().min(1) }).passthrough(),
]);

// ─────────────────────────────────────────────────────────────────────────────
// Paginated Response Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the pagination meta object.
 */
export const paginationMetaSchema = z.object({
  per_page: z.number(),
  has_more: z.boolean().optional(),
  cursor: z.string().nullable().optional(),
  next_cursor: z.string().nullable().optional(),
  previous_cursor: z.string().nullable().optional(),
  current_page: z.number().optional(),
  total_items: z.number().optional(),
  total_pages: z.number().optional(),
  total: z.number().optional(),
  from: z.number().optional(),
  to: z.number().optional(),
  last_page: z.number().optional(),
  has_next_page: z.boolean().optional(),
  has_previous_page: z.boolean().optional(),
  path: z.string().optional(),
});

/**
 * Creates a paginated response schema for a given item schema.
 * Validates that `data` is an array and `meta` has pagination fields.
 */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    meta: paginationMetaSchema,
  }).passthrough();
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the essential fields of a Listing object.
 */
export const listingSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  type: z.enum(['offer', 'request']),
  user_id: z.number(),
  category_id: z.number().nullable().optional(),
  status: z.enum(['active', 'paused', 'completed', 'expired', 'deleted']).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  // Optional nested author
  user: z.object({
    id: z.number(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    name: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Tenant Bootstrap Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the tenant bootstrap response.
 * This is the most critical schema — if bootstrap fails, the app cannot function.
 */
export const tenantBootstrapSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  tagline: z.string().optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  modules: z.record(z.string(), z.boolean()).optional(),
  authentication_config: z.object({
    'two_factor.allow_trusted_devices': z.boolean().optional(),
    'two_factor.trusted_device_days': z.number().optional(),
    'two_factor.backup_code_count': z.number().optional(),
    'passkeys.conditional_autofill': z.boolean().optional(),
  }).passthrough().optional(),
  branding: z.object({
    name: z.string().optional(),
    tagline: z.string().optional(),
    logo: z.string().nullable().optional(),
    logo_url: z.string().nullable().optional(),
    logo_dark_url: z.string().nullable().optional(),
    logo_shape: z.string().optional(),
    logo_tone: z.string().optional(),
    logo_dark_tone: z.string().optional(),
    favicon: z.string().nullable().optional(),
    favicon_url: z.string().nullable().optional(),
    primaryColor: z.string().optional(),
    primary_color: z.string().optional(),
  }).passthrough().optional(),
  contact: z.object({
    email: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
  }).passthrough().optional(),
  categories: z.array(z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
  }).passthrough()).optional(),
  tenant_switcher: z.object({
    source: z.string(),
    items: z.array(z.object({
      id: z.number(),
      name: z.string(),
      slug: z.string(),
      url: z.string(),
      domain: z.string().optional(),
      tagline: z.string().optional(),
    }).passthrough()),
  }).passthrough().optional(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Wallet Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the wallet balance response.
 */
export const walletBalanceSchema = z.object({
  balance: z.number(),
  total_earned: z.number(),
  total_spent: z.number(),
  currency: z.string().optional(),
}).passthrough();

/**
 * Validates a transaction object.
 */
export const transactionSchema = z.object({
  id: z.number(),
  type: z.enum(['credit', 'debit']),
  amount: z.number(),
  status: z.enum(['pending', 'completed', 'cancelled', 'disputed', 'refunded']),
  description: z.string(),
  created_at: z.string(),
}).passthrough();

/**
 * Validates a time-credit transfer response.
 * Returned by POST /api/v2/wallet/transfer.
 */
export const transferResponseSchema = z.object({
  transaction_id: z.number(),
  amount: z.number(),
  new_balance: z.number(),
  recipient: z.object({
    id: z.number(),
    first_name: z.string(),
    last_name: z.string(),
  }).passthrough(),
  message: z.string(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Group Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a Group object.
 * Covers the essential required fields returned by GET /api/v2/groups and
 * GET /api/v2/groups/:id.
 */
export const groupSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  visibility: z.enum(['public', 'private', 'secret']),
  members_count: z.number(),
  created_at: z.string(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Feed Post Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a FeedPost object.
 * Returned by GET /api/v2/feed.
 */
export const feedPostSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  content: z.string(),
  likes_count: z.number(),
  comments_count: z.number(),
  author: z.object({
    id: z.number(),
    name: z.string(),
  }).passthrough(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Messaging Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a Message object.
 * The primary field from the backend is `body`; `content` is a deprecated alias.
 */
export const messageSchema = z.object({
  id: z.number(),
  body: z.string(),
  sender_id: z.number(),
  created_at: z.string(),
}).passthrough();

/**
 * Validates a Conversation object.
 * Returned by GET /api/v2/conversations.
 */
export const conversationSchema = z.object({
  id: z.number(),
  other_user: z.object({
    id: z.number(),
    name: z.string(),
  }).passthrough(),
  unread_count: z.number(),
}).passthrough();

/**
 * Validates the unread message count response.
 * Returned by GET /api/v2/messages/unread-count.
 */
export const unreadCountSchema = z.object({
  count: z.number(),
  conversations_with_unread: z.number(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Exchange Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates an Exchange object.
 * Returned by GET /api/v2/exchanges and GET /api/v2/exchanges/:id.
 */
export const exchangeSchema = z.object({
  id: z.number(),
  listing_id: z.number(),
  requester_id: z.number(),
  provider_id: z.number(),
  proposed_hours: z.number(),
  status: z.enum([
    'pending_provider',
    'pending_broker',
    'accepted',
    'in_progress',
    'pending_confirmation',
    'completed',
    'disputed',
    'cancelled',
  ]),
  created_at: z.string(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Notification Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a Notification object.
 * Returned by GET /api/v2/notifications.
 */
export const notificationSchema = z.object({
  id: z.number(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  created_at: z.string(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Upload Response Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates an upload response.
 * Returned by POST /api/v2/upload.
 */
export const uploadResponseSchema = z.object({
  path: z.string(),
  url: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Admin — Dashboard Stats Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the admin dashboard stats response.
 * Returned by GET /api/v2/admin/dashboard/stats.
 */
export const adminDashboardStatsSchema = z.object({
  total_users: z.number(),
  active_users: z.number(),
  pending_users: z.number(),
  total_listings: z.number(),
  active_listings: z.number(),
  pending_listings: z.number().optional(),
  total_transactions: z.number(),
  total_hours_exchanged: z.number(),
  new_users_this_month: z.number(),
  new_listings_this_month: z.number(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Admin — User Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates an AdminUser object.
 * Returned by GET /api/v2/admin/users and GET /api/v2/admin/users/:id.
 */
export const adminUserSchema = z.object({
  id: z.number(),
  name: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  email: z.string(),
  username: z.string().optional(),
  avatar: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  role: z.enum(['member', 'admin', 'moderator', 'tenant_admin', 'super_admin']),
  status: z.enum(['active', 'inactive', 'suspended', 'pending', 'banned']),
  tenant_id: z.number().optional(),
  balance: z.number(),
  has_2fa_enabled: z.boolean(),
  is_super_admin: z.boolean(),
  created_at: z.string(),
  last_active_at: z.string().nullable().optional(),
}).passthrough();

/**
 * Validates a paginated users list response.
 * Returned by GET /api/v2/admin/users.
 */
export const adminUsersResponseSchema = z.object({
  data: z.array(adminUserSchema),
  meta: paginationMetaSchema,
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Admin — Settings Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the admin settings response.
 * Returned by GET /api/v2/admin/settings.
 */
export const adminSettingsResponseSchema = z.object({
  tenant_id: z.number(),
  tenant: z.object({
    name: z.string(),
    description: z.string(),
    contact_email: z.string(),
    contact_phone: z.string(),
  }).passthrough(),
  settings: z.object({
    registration_mode: z.string().nullable(),
    email_verification: z.string().nullable(),
    admin_approval: z.string().nullable(),
    maintenance_mode: z.string().nullable(),
    partner_logo_label: z.string().nullable().optional(),
    partner_logo_link_url: z.string().nullable().optional(),
  }).passthrough(),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Admin — Tenant Config Schema (Features & Modules)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the tenant feature/module config response.
 * Returned by GET /api/v2/admin/config.
 */
export const tenantConfigSchema = z.object({
  tenant_id: z.number(),
  features: z.record(z.string(), z.boolean()),
  modules: z.record(z.string(), z.boolean()),
}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Admin — Listings Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates an AdminListing object.
 * Returned by GET /api/v2/admin/listings.
 */
export const adminListingSchema = z.object({
  id: z.number(),
  title: z.string(),
  type: z.string(),
  status: z.enum(['active', 'pending', 'inactive', 'archived']),
  user_id: z.number(),
  user_name: z.string(),
  created_at: z.string(),
}).passthrough();

/**
 * Validates a paginated listings list response.
 * Returned by GET /api/v2/admin/listings.
 */
export const adminListingsResponseSchema = z.object({
  data: z.array(adminListingSchema),
  meta: paginationMetaSchema,
}).passthrough();
