// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * NEXUS API Type Definitions
 * Matches the PHP backend API contracts from docs/API_CONTRACT_REFERENCE.md
 */

// ─────────────────────────────────────────────────────────────────────────────
// User Types
// ─────────────────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  email?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  avatar?: string | null;
  avatar_url?: string | null;
  bio?: string;
  tagline?: string;
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
  skills?: string[];
  // Note: `moderator` is retained here as a *group-member* role (see GroupMember,
  // which extends User) and for pre-migration legacy data. It is no longer an
  // assignable platform role — the admin role selector and AdminUsersController
  // allow-lists reject it.
  role?: 'member' | 'admin' | 'moderator' | 'broker' | 'tenant_admin' | 'super_admin';
  is_super_admin?: boolean;
  is_god?: boolean;
  is_tenant_super_admin?: boolean;
  is_admin?: boolean;
  status?: 'active' | 'inactive' | 'suspended' | 'pending';
  tenant_id?: number;
  tenant_slug?: string;
  balance?: number;
  total_earned?: number;
  total_spent?: number;
  total_hours_given?: number;
  total_hours_received?: number;
  groups_count?: number;
  events_attended?: number;
  rating?: number;
  community_rank_score?: number;
  xp?: number;
  level?: number;
  showcased_badges?: ShowcasedBadge[];
  phone?: string;
  profile_type?: 'individual' | 'organisation';
  organization_name?: string;
  date_of_birth?: string;
  has_2fa_enabled?: boolean;
  preferred_layout?: 'modern';
  preferred_language?: string;
  preferred_theme?: 'light' | 'dark' | 'system';
  onboarding_completed?: boolean;
  email_verified_at?: string | null;
  created_at?: string;
  updated_at?: string;
  last_login_at?: string;
  distance?: number;
  is_verified?: boolean;
  /** If set, this user originates from a federated partner tenant. */
  federated_partner_id?: number | string | null;
  /** Aggregated cross-federation reputation score (0–5). */
  federated_reputation_score?: number;
  /** Total number of federated reviews aggregated across partners. */
  federated_reputation_count?: number;
}

export interface UserProfile extends User {
  interests?: string[];
  badges?: Badge[];
  stats?: UserStats;
  reviews_count?: number;
  average_rating?: number;
  listings_count?: number;
  notification_preferences?: NotificationPreferences;
  privacy_settings?: PrivacySettings;
}

export interface UserStats {
  hours_given: number;
  hours_received: number;
  listings_count: number;
  reviews_count: number;
  average_rating: number;
  connections_count: number;
}

export interface NotificationPreferences {
  email_digest: 'daily' | 'monthly' | 'none';
  push_enabled: boolean;
  email_on_message: boolean;
  email_on_match: boolean;
}

export interface PrivacySettings {
  profile_visible: boolean;
  show_balance: boolean;
  show_location: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
  platform?: 'web' | 'mobile' | 'pwa';
}

export interface LoginSuccessResponse {
  success: true;
  user: User;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in?: number;
  token_type: 'Bearer';
  is_mobile?: boolean;
  token: string;  // Legacy alias for access_token
  trusted_device_token?: string;
  config?: {
    modules?: Record<string, boolean>;
  };
}

export interface TwoFactorRequiredResponse {
  success: false;
  requires_2fa: true;
  two_factor_token: string;
  methods: ('totp' | 'backup_code' | 'webauthn')[];
  allow_trusted_device?: boolean;
  trusted_device_days?: number;
  code: 'AUTH_2FA_REQUIRED';
  message: string;
  user: {
    id: number;
    first_name: string;
    email_masked: string;
  };
}

export type LoginResponse = LoginSuccessResponse | TwoFactorRequiredResponse;

export interface TwoFactorVerifyRequest {
  two_factor_token?: string;  // Optional - managed by AuthContext
  code: string;
  use_backup_code?: boolean;
  trust_device?: boolean;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface RefreshTokenResponse {
  success: true;
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  is_mobile?: boolean;
  token: string;
  refresh_token?: string;
  refresh_expires_in?: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  password_confirmation: string;
  first_name: string;
  last_name: string;
  tenant_id?: number;
  tenant_slug?: string;
  profile_type?: 'individual' | 'organisation';
  organization_name?: string;
  location: string;
  latitude?: number;
  longitude?: number;
  phone: string;
  terms_accepted: boolean;
  newsletter_opt_in?: boolean;
  invite_code?: string;
  // Epoch milliseconds when the form was first rendered. The server rejects
  // submissions that arrive < 5s later as bot probes (mirrors the client-side
  // gate so a scripted POST can't bypass it).
  form_started_at?: number;
}

export interface RegisterResponse {
  success: true;
  user: User;
  message?: string;
  access_token?: string;
  refresh_token?: string;
  token_type?: 'Bearer';
  expires_in?: number;
  refresh_expires_in?: number;
  requires_verification?: boolean;
  requires_approval?: boolean;
  next_steps?: string[];
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
  password_confirmation: string;
}

export interface TotpStatusResponse {
  success: true;
  enabled: boolean;
  setup_required: boolean;
  backup_codes_remaining: number;
  trusted_devices: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing Types
// ─────────────────────────────────────────────────────────────────────────────

export type ListingType = 'offer' | 'request';
export type ListingStatus = 'active' | 'paused' | 'completed' | 'expired' | 'deleted' | 'pending' | 'rejected';

export interface Listing {
  id: number;
  user_id: number;
  title: string;
  description: string;
  type: ListingType;
  category_id: number | null;
  category_name?: string;
  category_color?: string;
  estimated_hours?: number;
  hours_estimate?: number;  // Alias for estimated_hours (frontend compatibility)
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  image_url?: string | null;
  gallery?: string[];
  images?: Array<{ id: number; url: string; sort_order: number; alt_text?: string | null }>;
  availability?: {
    slots?: string[];
    notes?: string;
  } | null;
  status: ListingStatus | null;
  federated_visibility?: 'none' | 'listed' | 'bookable';
  service_type?: 'physical_only' | 'remote_only' | 'hybrid' | 'location_dependent' | null;
  views_count?: number;
  view_count?: number;
  contact_count?: number;
  save_count?: number;
  responses_count?: number;
  is_favorited?: boolean;
  is_featured?: boolean;
  featured_until?: string | null;
  expires_at?: string | null;
  renewed_at?: string | null;
  renewal_count?: number;
  skill_tags?: string[];
  moderation_status?: 'pending_review' | 'approved' | 'rejected' | null;
  rejection_reason?: string | null;
  can_edit?: boolean;
  can_delete?: boolean;
  is_reported?: boolean;  // Whether current user has already reported this listing
  reciprocity_match?: 'one_way' | 'mutual' | null;  // Set by MatchRank when viewer has a matching offer/request
  created_at: string;
  updated_at: string;

  // Reciprocity: other listings by the same member
  member_offers?: Array<{ id: number; title: string; type: string; hours_estimate?: number }>;
  member_requests?: Array<{ id: number; title: string; type: string; hours_estimate?: number }>;

  // Trust signals
  author_verified?: boolean;
  author_rating?: number;
  author_reviews_count?: number;
  author_exchanges_count?: number;

  // Nested author info
  author_name?: string;
  author_avatar?: string | null;
  user?: {
    id: number;
    first_name: string;
    last_name: string;
    name?: string;  // Computed name (frontend compatibility)
    avatar?: string | null;
    tagline?: string;
    average_rating?: number;
    reviews_count?: number;
    member_since?: string;
  };

  // Nested category (frontend compatibility)
  category?: {
    id: number;
    name: string;
    slug: string;
    color?: string;
  };

  /** Distance from proximity filter origin, in km (set when near_lat/near_lng/radius_km params used) */
  distance_km?: number;
}

export interface ListingDetail extends Listing {
  author_email?: string;
  attributes?: ListingAttribute[];
  is_liked?: boolean;
  likes_count?: number;
  comments_count?: number;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface ListingAttribute {
  id: number;
  name: string;
  slug: string;
  value: string;
}

export interface ListingCreateRequest {
  title: string;
  description: string;
  type: ListingType;
  category_id: number;
  estimated_hours: number;
  location?: string;
  image_path?: string;
}

export interface ListingUpdateRequest {
  title?: string;
  description?: string;
  status?: ListingStatus;
  category_id?: number;
  estimated_hours?: number;
  location?: string;
}

export interface ListingFilters {
  type?: ListingType;
  category_id?: number;
  q?: string;
  status?: ListingStatus;
  user_id?: number;
  cursor?: string;
  per_page?: number;
  skills?: string;
  featured_first?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing Analytics Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ListingAnalytics {
  listing_id: number;
  title: string;
  summary: {
    total_views: number;
    unique_viewers: number;
    total_contacts: number;
    total_saves: number;
    contact_rate: number;
    save_rate: number;
    views_trend_percent: number;
  };
  views_over_time: Array<{ date: string; count: number }>;
  contacts_over_time: Array<{ date: string; count: number }>;
  contact_types: Array<{ contact_type: string; count: number }>;
  period_days: number;
  created_at: string;
  expires_at: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved Search Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SavedSearch {
  id: number;
  name: string;
  query_params: Record<string, string>;
  notify_on_new: boolean;
  last_run_at: string | null;
  last_result_count: number | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Category Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Category {
  id: number;
  name: string;
  slug: string;
  icon?: string;
  color?: string;
  parent_id?: number;
  children?: Category[];
  listings_count?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bookmark Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Bookmark {
  id: number;
  bookmarkable_type: string;
  bookmarkable_id: number;
  collection_id: number | null;
  created_at: string;
}

export interface BookmarkCollection {
  id: number;
  name: string;
  description: string | null;
  is_default: boolean;
  bookmarks_count?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Conversation {
  id: number;
  // Backend returns other_user (this is the primary field)
  other_user: {
    id: number;
    name: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string | null;
    avatar?: string | null;  // Alias for avatar_url
    is_online?: boolean;
  };
  // Alias for other_user (deprecated, prefer other_user)
  participant?: {
    id: number;
    first_name?: string;
    last_name?: string;
    name?: string;
    avatar?: string | null;
    is_online?: boolean;
    last_seen_at?: string;
  };
  last_message?: Message;
  unread_count: number;
  listing_context?: {
    id: number;
    title: string;
    status?: string;
  };
  created_at?: string;
  updated_at?: string;
}

export interface Message {
  id: number;
  body: string;           // Backend returns 'body' (primary field)
  content?: string;       // Alias for body (deprecated)
  sender_id: number;
  is_own?: boolean;       // True if current user sent this message
  is_voice?: boolean;     // True if voice message
  audio_url?: string;
  audio_duration?: number;
  transcript?: string;
  transcript_language?: string;
  sender?: {
    id: number;
    name: string;
    avatar_url?: string;
  };
  is_read?: boolean;
  sent_at?: string;
  created_at: string;
  read_at?: string | null;
  attachments?: MessageAttachment[];
  reactions?: Record<string, number>;  // { emoji: count }
  is_edited?: boolean;
  is_deleted?: boolean;
}

export interface MessageAttachment {
  id: number;
  url: string;
  type: 'image' | 'file';
  name: string;
  size: number;
}

export interface SendMessageRequest {
  recipient_id?: number;
  conversation_id?: number;
  content: string;
  listing_id?: number;
}

export interface UnreadCountResponse {
  count: number;
  conversations_with_unread: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet Types
// ─────────────────────────────────────────────────────────────────────────────

export interface WalletBalance {
  balance: number;
  pending_incoming: number;
  pending_outgoing: number;
  pending_in?: number;   // Alias for pending_incoming (API returns both)
  pending_out?: number;  // Alias for pending_outgoing (API returns both)
  total_earned: number;
  total_spent: number;
  transaction_count: number;
  currency: 'hours';
  last_transaction_at?: string;
}

export type TransactionType = 'credit' | 'debit';
export type TransactionStatus = 'pending' | 'completed' | 'cancelled' | 'disputed' | 'refunded';

export interface Transaction {
  id: number;
  type: TransactionType;
  amount: number;
  balance_after: number;
  status: TransactionStatus;
  description: string;
  listing_id?: number;
  listing_title?: string;
  other_party?: {
    id: number;
    first_name: string;
    last_name: string;
    name?: string;  // Computed name (frontend compatibility)
    avatar?: string | null;
  };
  // Alias for other_party (frontend compatibility)
  other_user?: {
    id: number;
    name: string;
    avatar?: string | null;
  };
  created_at: string;
  completed_at?: string;
  // Extended fields (W4, W8)
  transaction_type?: 'transfer' | 'exchange' | 'donation' | 'starting_balance' | 'admin_grant' | 'community_fund' | 'federation';
  category_id?: number | null;
  prep_time?: number | null;
  // Federation inbound (from external partners). `source: 'federation'` signals a read-only audit
  // row. `id` is negative for federation rows to stay numeric while never colliding with native txns.
  source?: 'native' | 'federation';
  federation?: {
    transaction_id: number;
    partner_id: number;
    partner_name: string;
    external_sender_name: string;
  };
}

export interface TransferRequest {
  recipient_id: number;
  amount: number;
  description: string;
  listing_id?: number;
  category_id?: number;
}

export interface TransferResponse {
  transaction_id: number;
  amount: number;
  new_balance: number;
  recipient: {
    id: number;
    first_name: string;
    last_name: string;
  };
  message: string;
}

export interface WalletUserSearchResult {
  id: number;
  first_name: string;
  last_name: string;
  name?: string;      // Computed display name from API
  username?: string | null;
  avatar?: string | null;
}

// W8 - Transaction Categories
export interface TransactionCategory {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  sort_order: number;
  is_system: boolean;
}

// W1 - Community Fund
export interface CommunityFundBalance {
  id: number;
  balance: number;
  total_deposited: number;
  total_withdrawn: number;
  total_donated: number;
  description: string;
}

export interface CommunityFundTransaction {
  id: number;
  type: 'deposit' | 'withdrawal' | 'donation' | 'starting_balance_grant';
  amount: number;
  balance_after: number;
  description: string;
  user_name?: string;
  user_avatar?: string;
  admin_name?: string;
  created_at: string;
}

// W10 - Exchange Ratings
export interface ExchangeRating {
  id: number;
  rater: {
    id: number;
    name: string;
    avatar_url?: string | null;
  };
  rated: {
    id: number;
    name: string;
    avatar_url?: string | null;
  };
  rating: number;
  comment?: string | null;
  role: 'requester' | 'provider';
  created_at: string;
}

export interface UserRating {
  average: number | null;
  count: number;
}

// W6 - Credit Donations
export interface CreditDonation {
  id: number;
  donor_id: number;
  recipient_type: 'user' | 'community_fund';
  recipient_id?: number | null;
  amount: number;
  message?: string | null;
  donor_name?: string;
  donor_avatar?: string;
  recipient_name?: string;
  recipient_avatar?: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Types
// ─────────────────────────────────────────────────────────────────────────────

export type RsvpStatus = 'attending' | 'maybe' | 'not_attending';

export type EventStatus = 'active' | 'cancelled' | 'completed' | 'postponed' | 'draft';
export type EventPublicationState = 'draft' | 'pending_review' | 'published' | 'archived';
export type EventOperationalState = 'scheduled' | 'postponed' | 'cancelled' | 'completed';

export interface EventSeries {
  id: number;
  title: string;
  description?: string | null;
  event_count: number;
  creator?: string;
}

export interface Event {
  id: number;
  title: string;
  description: string;
  start_date: string;
  end_date?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  is_online: boolean;
  online_url?: string;
  cover_image?: string | null;
  organizer: {
    id: number;
    first_name: string;
    last_name: string;
    name?: string;
    avatar?: string | null;
    avatar_url?: string | null;
  };
  group?: {
    id: number;
    name: string;
    slug?: string;
  };
  attendees_count: number;
  maybe_count?: number;
  max_attendees?: number | null;
  spots_left?: number | null;
  is_full?: boolean;
  category_name?: string;
  interested_count?: number;
  rsvp_status?: RsvpStatus | null;
  user_rsvp?: RsvpStatus | null;
  can_edit?: boolean;
  // E5: Cancellation
  status?: EventStatus;
  publication_state?: EventPublicationState;
  operational_state?: EventOperationalState;
  lifecycle_version?: number;
  cancellation_reason?: string | null;
  // E7: Series
  series_id?: number | null;
  series?: EventSeries | null;
  // E1: Recurrence
  parent_event_id?: number | null;
  is_recurring?: boolean;
  is_recurring_template?: number | boolean;
  recurrence_frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  /** True when this event belongs to a recurring series (template or occurrence) */
  is_series?: boolean;
  /** Number of occurrences in the series within the active time window */
  series_count?: number;
  /** Upcoming dates in the series (detail page only) */
  series_occurrences?: Array<{ id: number; start_time: string; date?: string | null }>;
  // INF6: Video conferencing
  video_url?: string | null;
  allow_remote_attendance?: boolean;
  // E3: Waitlist
  waitlist_count?: number;
  rsvp_counts?: {
    going: number;
    interested: number;
  };
  recent_attendees?: Array<{
    id: number;
    first_name: string;
    last_name: string;
    avatar?: string | null;
  }>;
  created_at: string;
  updated_at?: string;
  /** Distance from proximity filter origin, in km (set when near_lat/near_lng/radius_km params used) */
  distance_km?: number;
}

export interface EventCreateRequest {
  title: string;
  description: string;
  start_date: string;
  end_date?: string;
  location?: string;
  is_online?: boolean;
  online_url?: string;
  max_attendees?: number;
  group_id?: number;
  // E1: Recurrence fields
  recurrence_frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  recurrence_interval?: number;
  recurrence_days?: string;
  recurrence_ends_type?: 'never' | 'after_count' | 'on_date';
  recurrence_ends_after_count?: number;
  recurrence_ends_on_date?: string;
  // E7: Series
  series_id?: number;
}

export interface RsvpRequest {
  status: RsvpStatus;
}

export interface RsvpResponse {
  status: RsvpStatus | 'waitlisted';
  rsvp_counts: { going: number; interested: number };
  waitlist_position?: number | null;
  message?: string;
}

export interface EventAttendanceRecord {
  user_id: number;
  name: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string | null;
  checked_in_at: string;
  checked_in_by?: string;
  hours_credited?: number | null;
  notes?: string | null;
}

export interface EventReminder {
  remind_before_minutes: number;
  reminder_type: 'platform' | 'email' | 'both';
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  scheduled_for: string;
}

// E4: Reminder Preferences
export interface EventReminderPreferences {
  remind_before_minutes: number;
  email_enabled: boolean;
  push_enabled: boolean;
}

export interface WaitlistEntry {
  id: number;
  name: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string | null;
  position: number;
  joined_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Group Types
// ─────────────────────────────────────────────────────────────────────────────

export type GroupVisibility = 'public' | 'private' | 'secret';
export type MembershipStatus = 'active' | 'pending' | 'invited' | 'banned' | 'rejected' | null;

export interface Group {
  id: number;
  name: string;
  slug?: string;
  description: string;
  image_url?: string | null;        // Backend returns image_url
  cover_image?: string | null;      // Alias for cover_image_url
  cover_image_url?: string | null;  // Backend returns cover_image_url
  category_id?: number;
  category_name?: string;
  member_count?: number;            // Backend returns member_count
  members_count: number;            // Alias (deprecated)
  posts_count?: number;
  is_member?: boolean;
  is_admin?: boolean;
  membership_status?: MembershipStatus;
  visibility: GroupVisibility;
  rules?: string;
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
  type_id?: number | null;
  parent_id?: number | null;
  template_id?: number | null;
  template_features?: Record<string, boolean> | string[] | null;
  primary_color?: string | null;
  accent_color?: string | null;
  owner?: {
    id: number;
    name?: string;
    avatar_url?: string | null;
  };
  admins?: Array<{
    id: number;
    first_name?: string;
    last_name?: string;
    name?: string;
    avatar?: string | null;
    avatar_url?: string | null;
  }>;
  recent_members?: Array<{
    id: number;
    name?: string;
    first_name?: string;
    last_name?: string;
    avatar?: string | null;
    avatar_url?: string | null;
  }>;
  // Sub-groups (returned by backend for parent groups)
  sub_groups?: Array<{
    id: number;
    name: string;
    member_count: number;
  }>;
  // Viewer's membership info (when authenticated)
  viewer_membership?: {
    status: 'none' | 'active' | 'pending' | 'invited' | 'banned';
    role: 'member' | 'admin' | 'owner' | null;
    is_admin: boolean;
    capabilities?: {
      can_join: boolean;
      can_leave: boolean;
      can_cancel_request: boolean;
      can_invite: boolean;
      can_manage_members: boolean;
      can_manage_admins: boolean;
      can_delete: boolean;
    };
  };
  type?: {
    id: number;
    name?: string;
    icon?: string;
    color?: string;
  };
  is_featured?: boolean;
  federated_visibility?: 'none' | 'listed' | 'joinable';
  tags?: Array<{ id: number; name: string }>;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feed Post Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FeedPost {
  id: number;
  user_id: number;
  content: string;
  type?: 'text' | 'image' | 'poll';
  media_urls?: string[];
  likes_count: number;
  comments_count: number;
  is_liked?: boolean;
  author: {
    id: number;
    name: string;
    avatar?: string | null;
  };
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  message?: string;  // Alias for body (frontend compatibility)
  read_at?: string | null;
  link?: string | null;  // Navigation URL from backend (e.g. "/messages/123")
  action_url?: string;
  data?: Record<string, unknown>;
  created_at: string;
  // Grouped notification fields
  is_grouped?: boolean;
  group_key?: string;
  group_count?: number;
  actors?: Array<{ id: number; name: string; avatar_url?: string | null }>;
  remaining_count?: number;
  latest_at?: string;
  notification_ids?: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Search Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchResults {
  query: string;
  total_results: number;
  results: {
    listings?: Array<Listing & { highlight?: string }>;
    users?: Array<{
      id: number;
      name: string;
      avatar?: string | null;
      skills?: string[];
    }>;
    events?: Array<{
      id: number;
      title: string;
      start_date: string;
    }>;
    groups?: Array<{
      id: number;
      name: string;
      members_count: number;
    }>;
    podcasts?: Array<{
      id: number;
      type: 'podcast_show' | 'podcast_episode';
      podcast_kind: 'show' | 'episode';
      show_slug: string;
      episode_slug?: string;
      title: string;
      summary?: string | null;
    }>;
  };
}

export interface SearchSuggestions {
  suggestions: string[];
}

export interface SearchFilters {
  q: string;
  types?: string;  // Comma-separated: 'listings,users,events,groups,podcasts'
  limit?: number;
  limit_per_type?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gamification Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GamificationProfile {
  xp: number;
  level: number;
  level_name: string;
  xp_to_next_level: number;
  total_xp_for_next_level: number;
  rank: number;
  rank_percentile: number;
  streak_days: number;
  badges_earned: number;
  badges_total: number;
  recent_achievements: Achievement[];
}

export interface ShowcasedBadge {
  badge_key: string;
  name: string;
  icon: string;
}

export interface Badge {
  id: number;
  name: string;
  description: string;
  icon: string;
  category: string;
  xp_value: number;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  earned: boolean;
  earned_at?: string | null;
  progress?: {
    current: number;
    target: number;
    percentage: number;
  };
}

export interface Achievement {
  id: number;
  type: string;
  name: string;
  description: string;
  xp_awarded: number;
  earned_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  user: {
    id: number;
    first_name: string;
    last_name: string;
    avatar?: string | null;
  };
  xp: number;
  level: number;
}

export interface Leaderboard {
  period: 'weekly' | 'monthly' | 'all_time';
  entries: LeaderboardEntry[];
  current_user?: {
    rank: number;
    xp: number;
    level: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PaginationMeta {
  per_page: number;
  has_more?: boolean;
  cursor?: string;
  current_page?: number;
  total_items?: number;
  total_pages?: number;
  total?: number;
  has_next_page?: boolean;
  has_previous_page?: boolean;
  next_cursor?: string;
  previous_cursor?: string;
  pagination_scope?: 'internal_partners' | 'external_partner' | string;
  cursor_scope?: 'internal_partners' | 'external_partner' | string;
  load_more_scope?: 'internal_partners' | 'external_partner' | 'none' | string;
  external_pagination_scope?: 'first_page_enrichment' | 'single_partner_result_set' | 'none' | string;
  external_results_paginated?: boolean;
  external_results_included?: boolean;
  source_counts?: {
    internal_returned?: number;
    internal_total_items?: number;
    external_returned?: number;
    returned_total?: number;
  };
  // Messages API returns conversation details in meta
  conversation?: {
    id: number;
    other_user: {
      id: number;
      name: string;
      first_name?: string;
      last_name?: string;
      avatar_url?: string | null;
      is_online?: boolean;
    };
    unread_count?: number;
    message_count?: number;
  };
  // Allow additional meta fields from various endpoints
  [key: string]: unknown;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface CursorPaginationParams {
  cursor?: string;
  per_page?: number;
}

export interface OffsetPaginationParams {
  page?: number;
  per_page?: number;
  sort?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantFeatures {
  events: boolean;
  groups: boolean;
  gamification: boolean;
  goals: boolean;
  blog: boolean;
  resources: boolean;
  caring_community: boolean;
  volunteering: boolean;
  exchange_workflow: boolean;
  organisations: boolean;
  federation: boolean;
  connections: boolean;
  reviews: boolean;
  polls: boolean;
  job_vacancies: boolean;
  ideation_challenges: boolean;
  direct_messaging: boolean;
  group_exchanges: boolean;
  search: boolean;
  ai_chat: boolean;
  marketplace: boolean;
  message_translation: boolean;
  member_premium: boolean;
  /** Identity verification (Stripe Identity "ID Verified" badge) — default ON. */
  identity_verification: boolean;
  partner_api: boolean;
  ai_agents: boolean;
  fadp_compliance: boolean;
  local_advertising: boolean;
  newsletter: boolean;
  merchant_coupons: boolean;
  regional_analytics: boolean;
  maps: boolean;
  /** Courses / learning module (alpha) — opt-in per tenant. */
  courses: boolean;
  /** Podcasts / community audio module — opt-in per tenant. */
  podcasts: boolean;
  /** Explore / Discover curated discovery page — default ON, gateable per tenant. */
  explore: boolean;
  /**
   * Partner venues — member pass QR scanned by venue staff to record
   * engagement at local partner premises. Engagement only: the platform
   * issues no coupon and applies no discount. Opt-in per tenant.
   */
  partner_venues: boolean;
  /**
   * Public events advertising — lets anonymous visitors browse published
   * events at /whats-on without an account. Registration still requires login.
   */
  public_events: boolean;
  /**
   * Attendance rewards — grants time credits on verified event check-in,
   * minted against the community. Additionally requires
   * EVENTS_ATTENDANCE_CREDIT_MODE=treasury and a per-event amount.
   */
  event_attendance_credits: boolean;
  /** Authenticator-app 2FA enrollment. Existing enrollments remain enforced when disabled. */
  two_factor_authentication: boolean;
  /** Passkey enrollment. Existing passkeys remain usable when disabled. */
  biometric_login: boolean;
}

export interface TenantModules {
  feed: boolean;
  listings: boolean;
  messages: boolean;
  wallet: boolean;
  notifications: boolean;
  profile: boolean;
  settings: boolean;
  dashboard: boolean;
}

export interface TenantBranding {
  name: string;
  tagline?: string;
  logo?: string;       // normalised from logo_url
  logo_url?: string;   // raw backend field
  logoDark?: string;   // normalised from logo_dark_url (dark-theme header variant)
  logo_dark_url?: string; // raw backend field
  logoShape?: 'wide' | 'landscape' | 'square'; // normalised from logo_shape (aspect bucket)
  logo_shape?: string; // raw backend field
  logoTone?: 'light' | 'dark'; // brightness of the light-slot logo (for contrast backdrop)
  logo_tone?: string; // raw backend field
  logoDarkTone?: 'light' | 'dark'; // brightness of the dark-slot logo
  logo_dark_tone?: string; // raw backend field
  favicon?: string;    // normalised from favicon_url
  favicon_url?: string; // raw backend field
  primaryColor?: string;
  primary_color?: string; // raw backend field
  secondaryColor?: string;
  og_image_url?: string;
}

export interface TenantSwitcherItem {
  id: number;
  name: string;
  slug: string;
  url: string;
  domain?: string;
  tagline?: string;
}

export interface TenantSwitcherConfig {
  source: string;
  items: TenantSwitcherItem[];
}

export interface AuthenticationConfig {
  'two_factor.allow_trusted_devices': boolean;
  'two_factor.trusted_device_days': number;
  'two_factor.backup_code_count': number;
  'passkeys.conditional_autofill': boolean;
}

export interface TenantConfig {
  id: number;
  name: string;
  slug: string;
  /** Uppercase ISO 4217 payment currency resolved by the tenant bootstrap. */
  currency?: string;
  tagline?: string;
  features: Partial<TenantFeatures>;
  modules?: Partial<TenantModules>;
  branding?: Partial<TenantBranding>;
  contact?: {
    email?: string;
    phone?: string;
    address?: string;
    location?: string;
    country_code?: string;
    latitude?: number;
    longitude?: number;
    service_area?: string;
  };
  social?: {
    facebook?: string;
    twitter?: string;
    instagram?: string;
    linkedin?: string;
    youtube?: string;
  };
  config?: {
    footer_text?: string;
    [key: string]: unknown;
  };
  seo?: {
    meta_title?: string;
    meta_description?: string;
    robots_directive?: string;
  };
  settings?: Record<string, unknown>;
  compliance?: {
    insurance_enabled?: boolean;
  };
  categories?: Category[];
  menu_pages?: {
    about?: { title: string; slug: string }[];
    footer?: { title: string; slug: string }[];
  };
  /** Listing module configuration */
  listing_config?: ListingConfig;
  /** Volunteering module configuration — tabs + feature options */
  volunteering_config?: VolunteeringConfig;
  /** Jobs module configuration */
  job_config?: JobConfig;
  /** Group tab visibility — which tabs are enabled for group detail view */
  group_tabs?: GroupTabConfig;
  /** Language codes supported by this tenant (e.g. ['en', 'ga'] or ['de', 'fr', 'it', 'en']) */
  supported_languages?: string[];
  /** Default language for this tenant (e.g. 'de' for Swiss tenants) */
  default_language?: string;
  /** Per-tenant landing page configuration (sections, content, ordering) */
  landing_page_config?: import('./landing-page').LandingPageConfig;
  /** Public-safe authentication capabilities and enrollment behavior. */
  authentication_config?: Partial<AuthenticationConfig>;
  /** Utility-bar tenant switcher options resolved by the backend. */
  tenant_switcher?: TenantSwitcherConfig;
  /**
   * Custom domain of the immediate parent tenant.
   * Present only for slug-only sub-tenants whose parent has a custom domain
   * (e.g. parent: timebanking.uk, child slug: cardiff → parent_domain: 'timebanking.uk').
   * When set, the SPA must use path-prefixed routing: timebanking.uk/cardiff/dashboard.
   */
  parent_domain?: string;
  /** This tenant's own React custom domain (e.g. pairc-goodman.com), if configured. */
  domain?: string;
  /**
   * Optional dedicated custom domain for the accessible (GOV.UK) frontend.
   * When set, the "Accessible version" link points at https://{accessible_domain}
   * (slug-less bare paths) instead of the shared
   * accessible.project-nexus.ie/{slug}/accessible.
   */
  accessible_domain?: string;
}

export interface GroupTabConfig {
  tab_feed: boolean;
  tab_discussion: boolean;
  tab_members: boolean;
  tab_events: boolean;
  tab_files: boolean;
  tab_announcements: boolean;
  tab_qa: boolean;
  tab_wiki: boolean;
  tab_media: boolean;
  tab_chatrooms: boolean;
  tab_tasks: boolean;
  tab_challenges: boolean;
  tab_analytics: boolean;
  tab_subgroups: boolean;
}

export interface ListingConfig {
  // Moderation
  'listing.moderation_enabled': boolean;
  'listing.auto_approve_trusted': boolean;
  // Limits
  'listing.max_per_user': number;
  'listing.max_images': number;
  'listing.max_image_size_mb': number;
  'listing.require_image': boolean;
  'listing.min_title_length': number;
  'listing.min_description_length': number;
  // Types & Options
  'listing.allow_offers': boolean;
  'listing.allow_requests': boolean;
  'listing.require_category': boolean;
  'listing.require_location': boolean;
  'listing.require_hours_estimate': boolean;
  'listing.enable_skill_tags': boolean;
  'listing.enable_service_type': boolean;
  // Expiry
  'listing.auto_expire_days': number;
  'listing.max_renewals': number;
  'listing.renewal_days': number;
  'listing.expiry_reminders': boolean;
  // Features
  'listing.enable_featured': boolean;
  'listing.featured_duration_days': number;
  'listing.enable_ai_descriptions': boolean;
  'listing.enable_reporting': boolean;
  'listing.enable_favourites': boolean;
  'listing.enable_map_view': boolean;
  'listing.enable_reciprocity': boolean;
}

export interface VolunteeringConfig {
  // Tab visibility (17 tabs)
  'volunteering.tab_opportunities': boolean;
  'volunteering.tab_applications': boolean;
  'volunteering.tab_hours': boolean;
  'volunteering.tab_recommended': boolean;
  'volunteering.tab_certificates': boolean;
  'volunteering.tab_alerts': boolean;
  'volunteering.tab_wellbeing': boolean;
  'volunteering.tab_credentials': boolean;
  'volunteering.tab_waitlist': boolean;
  'volunteering.tab_swaps': boolean;
  'volunteering.tab_group_signups': boolean;
  'volunteering.tab_hours_review': boolean;
  'volunteering.tab_expenses': boolean;
  'volunteering.tab_safeguarding': boolean;
  'volunteering.tab_community_projects': boolean;
  'volunteering.tab_donations': boolean;
  'volunteering.tab_accessibility': boolean;
  // Shifts & Applications
  'volunteering.swap_requires_admin': boolean;
  'volunteering.auto_approve_applications': boolean;
  'volunteering.require_org_note_on_decline': boolean;
  'volunteering.cancellation_deadline_hours': number;
  'volunteering.max_hours_per_shift': number;
  // Hours & Verification
  'volunteering.hours_require_verification': boolean;
  'volunteering.min_hours_for_certificate': number;
  // Emergency Alerts
  'volunteering.alert_default_expiry_hours': number;
  'volunteering.alert_skill_matching': boolean;
  // Expenses
  'volunteering.expenses_enabled': boolean;
  'volunteering.expense_require_receipt': boolean;
  'volunteering.expense_max_amount': number;
  // Wellbeing & Safety
  'volunteering.burnout_detection': boolean;
  'volunteering.guardian_consent_required': boolean;
  // Features
  'volunteering.enable_qr_checkin': boolean;
  'volunteering.enable_recurring_shifts': boolean;
  'volunteering.enable_reviews': boolean;
  'volunteering.enable_matching': boolean;
}

export interface JobConfig {
  // Tab / Page visibility
  'jobs.tab_browse': boolean;
  'jobs.tab_saved': boolean;
  'jobs.tab_my_postings': boolean;
  'jobs.page_kanban': boolean;
  'jobs.page_analytics': boolean;
  'jobs.page_bias_audit': boolean;
  'jobs.page_talent_search': boolean;
  'jobs.page_alerts': boolean;
  // Job Types & Posting Rules
  'jobs.allow_paid': boolean;
  'jobs.allow_volunteer': boolean;
  'jobs.allow_timebank': boolean;
  'jobs.require_salary': boolean;
  'jobs.default_currency': string;
  'jobs.max_postings_per_user': number;
  'jobs.default_deadline_days': number;
  // Moderation
  'jobs.moderation_enabled': boolean;
  'jobs.spam_detection': boolean;
  'jobs.auto_approve_trusted': boolean;
  // Applications & Pipeline
  'jobs.enable_cv_upload': boolean;
  'jobs.require_cover_message': boolean;
  'jobs.enable_interview_scheduling': boolean;
  'jobs.enable_offers': boolean;
  'jobs.enable_scorecards': boolean;
  'jobs.enable_pipeline_rules': boolean;
  'jobs.enable_blind_hiring': boolean;
  // Features
  'jobs.enable_featured': boolean;
  'jobs.featured_duration_days': number;
  'jobs.enable_ai_descriptions': boolean;
  'jobs.enable_skills_matching': boolean;
  'jobs.enable_referrals': boolean;
  'jobs.enable_templates': boolean;
  'jobs.enable_rss_feed': boolean;
  'jobs.enable_saved_profiles': boolean;
  'jobs.enable_employer_branding': boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// API Error Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: {
      field_errors?: Record<string, string[]>;
      retry_after_seconds?: number;
      [key: string]: unknown;
    };
  };
  meta?: {
    timestamp: string;
    request_id?: string;
  };
}

// Common error codes
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'INVALID_REFRESH_TOKEN'
  | 'INVALID_RESET_TOKEN'
  | 'INVALID_TOTP_CODE'
  | 'INVALID_CSRF_TOKEN'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_SUSPENDED'
  | 'EMAIL_NOT_VERIFIED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INSUFFICIENT_BALANCE'
  | 'EVENT_FULL'
  | 'ALREADY_CLAIMED'
  | 'INVALID_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'MAINTENANCE_MODE'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'SESSION_EXPIRED'
  | 'AUTH_2FA_REQUIRED'
  | 'AUTH_2FA_TOKEN_EXPIRED'
  | 'AUTH_2FA_MAX_ATTEMPTS'
  | 'AUTH_2FA_INVALID';

// ─────────────────────────────────────────────────────────────────────────────
// File Upload Types
// ─────────────────────────────────────────────────────────────────────────────

export type UploadType = 'avatar' | 'listing' | 'group' | 'message' | 'event';

export interface UploadResponse {
  path: string;
  webp_path?: string;
  url: string;
  webp_url?: string;
  mime_type: string;
  size_bytes: number;
  dimensions?: {
    width: number;
    height: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Review Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Review {
  id: number;
  reviewer: {
    id: number;
    first_name: string;
    last_name: string;
    avatar?: string | null;
  };
  rating: number;
  comment?: string;
  listing_id?: number;
  listing_title?: string;
  created_at: string;
}

export interface ReviewStats {
  average_rating: number;
  total_reviews: number;
  rating_distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exchange Types (Broker Controls)
// ─────────────────────────────────────────────────────────────────────────────

export type ExchangeStatus =
  | 'pending_provider'
  | 'pending_broker'
  | 'accepted'
  | 'in_progress'
  | 'pending_confirmation'
  | 'completed'
  | 'disputed'
  | 'cancelled';

export interface Exchange {
  id: number;
  listing_id: number;
  requester_id: number;
  provider_id: number;
  proposed_hours: number;
  prep_time?: number | null;
  status: ExchangeStatus;
  requester_confirmed_at?: string | null;
  requester_confirmed_hours?: number | null;
  provider_confirmed_at?: string | null;
  provider_confirmed_hours?: number | null;
  final_hours?: number | null;
  transaction_id?: number | null;
  broker_id?: number | null;
  broker_notes?: string | null;
  message?: string;
  created_at: string;
  updated_at?: string;

  // Nested relations
  listing?: {
    id: number;
    title: string;
    type: ListingType;
    description?: string;
    hours?: number;
  };
  requester?: {
    id: number;
    name: string;
    first_name?: string;
    last_name?: string;
    avatar?: string | null;
  };
  provider?: {
    id: number;
    name: string;
    first_name?: string;
    last_name?: string;
    avatar?: string | null;
  };

  // Status history for timeline
  status_history?: ExchangeHistoryEntry[];
}

export interface ExchangeHistoryEntry {
  action: string;
  new_status?: string;
  actor_name?: string;
  notes?: string;
  created_at: string;
}

export interface ExchangeConfig {
  exchange_workflow_enabled: boolean;
  direct_messaging_enabled: boolean;
  require_broker_approval: boolean;
  confirmation_deadline_hours: number;
}

export interface ExchangeCreateRequest {
  listing_id: number;
  proposed_hours: number;
  message?: string;
}

export interface ExchangeConfirmRequest {
  hours: number;
}

export interface ExchangeFilters {
  status?: ExchangeStatus | 'active';
  role?: 'requester' | 'provider';
  cursor?: string;
  per_page?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Federation Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FederationPartner {
  id: number | string;
  name: string;
  logo?: string | null;
  tagline?: string;
  location?: string;
  country?: string;
  member_count: number;
  federation_level: number;
  federation_level_name?: string;
  permissions?: string[];
  partnership_since?: string;
  is_external?: boolean;
}

export interface FederatedEvent {
  id: number;
  title: string;
  description: string;
  start_date: string;
  end_date?: string;
  location?: string;
  is_online?: boolean;
  online_url?: string;
  cover_image?: string | null;
  attendees_count: number;
  max_attendees?: number;
  organizer?: {
    id: number;
    name: string;
    avatar?: string | null;
  };
  timebank: {
    id: number;
    name: string;
  };
  created_at?: string;
}

export interface FederatedListing {
  id: number | string;
  title: string;
  description: string;
  type: 'offer' | 'request';
  category_name?: string;
  image_url?: string | null;
  estimated_hours?: number;
  location?: string;
  author?: {
    id: number;
    name: string;
    avatar?: string | null;
  };
  timebank: {
    id: number | string;
    name: string;
  };
  created_at?: string;
  is_external?: boolean;
  external_partner_id?: number;
  partner_name?: string;
}

export interface FederatedGroup {
  id: number | string;
  name: string;
  description?: string | null;
  privacy?: string | null;
  member_count: number;
  cover_image?: string | null;
  timebank: {
    id: number | string;
    name: string;
  };
  created_at?: string;
  external_partner_id?: number;
  partner_name?: string;
}

export interface FederatedMember {
  id: number | string;
  name?: string;
  first_name?: string;
  last_name?: string;
  avatar?: string | null;
  bio?: string;
  skills?: string[];
  location?: string;
  service_reach?: string;
  messaging_enabled?: boolean;
  transactions_enabled?: boolean;
  tenant_id?: number | string;
  tenant_name?: string;
  timebank: {
    id: number | string;
    name: string;
  };
  is_external?: boolean;
  partner_name?: string;
  /** Aggregated cross-federation reputation score (0–5). */
  reputation_score?: number;
  /** Total number of reviews aggregated across partners. */
  reputation_count?: number;
}

export interface FederationConnection {
  id: number;
  user_id: number;
  name: string;
  avatar_url?: string | null;
  tenant_id: number;
  tenant_name: string;
  status: 'pending' | 'accepted' | 'rejected';
  message?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface FederatedMessage {
  id: number;
  subject: string;
  body: string;
  direction: 'inbound' | 'outbound';
  status: 'unread' | 'delivered' | 'read';
  read_at?: string | null;
  created_at: string;
  sender: {
    id: number;
    name: string;
    avatar?: string | null;
    tenant_id: number | string;
    tenant_name: string;
  };
  receiver: {
    id: number;
    name: string;
    avatar?: string | null;
    tenant_id: number | string;
    tenant_name: string;
  };
  reference_message_id?: number;
  is_external?: boolean;
  external_partner_id?: number;
}

export interface FederationStatus {
  enabled: boolean;
  tenant_federation_enabled?: boolean;
  partnerships_count?: number;
  federation_optin?: boolean;
  messages_count?: number;
  transactions_count?: number;
}

export interface FederationActivityItem {
  id: number;
  type: 'message_received' | 'message_sent' | 'transaction_received' | 'transaction_sent' | 'partnership_approved' | 'member_joined';
  title: string;
  description: string;
  created_at: string;
  actor?: {
    id?: number;
    name: string;
    avatar?: string | null;
    tenant_name?: string;
  };
}

export interface FederationSettings {
  profile_visible_federated?: boolean;
  appear_in_federated_search?: boolean;
  show_skills_federated?: boolean;
  show_location_federated?: boolean;
  show_reviews_federated?: boolean;
  messaging_enabled_federated?: boolean;
  transactions_enabled_federated?: boolean;
  email_notifications?: boolean;
  service_reach: 'local_only' | 'remote_ok' | 'travel_ok';
  travel_radius_km?: number;
  federation_optin?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Map & Geolocation Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NearbyListing extends Listing {
  distance_km: number;
}

export interface NearbyEvent {
  id: number;
  title: string;
  location?: string;
  start_time: string;
  latitude: number;
  longitude: number;
  distance_km: number;
}

export interface NearbyMember {
  id: number;
  first_name: string;
  last_name: string;
  avatar_url?: string | null;
  tagline?: string;
  location?: string;
  latitude: number;
  longitude: number;
  distance_km: number;
}

export interface GeographicCluster {
  lat: number;
  lng: number;
  count: number;
  area: string;
}

export interface GeographyAnalytics {
  member_locations: GeographicCluster[];
  total_with_location: number;
  total_members: number;
  coverage_percentage: number;
  top_areas: Array<{ area: string; count: number; percentage: number }>;
}
