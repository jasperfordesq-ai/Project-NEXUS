// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Panel TypeScript Types
 * Types for admin API requests and responses
 */

// ─────────────────────────────────────────────────────────────────────────────
// Groups - Advanced Management (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

export interface GroupType {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  member_count: number;
  created_at: string;
}

export interface GroupMember {
  user_id: number;
  user_name: string;
  user_avatar?: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
}

export interface GroupRecommendation {
  user_id: number;
  user_name: string;
  group_id: number;
  group_name: string;
  score: number;
  joined: boolean;
  created_at: string;
}

export interface FeaturedGroup {
  group_id: number;
  name: string;
  member_count: number;
  engagement_score?: number;
  geographic_diversity?: number;
  ranking_score?: number;
  is_featured: boolean;
  manual_rank?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Groups — Tags, Collections & Auto-Assign Rules
// ─────────────────────────────────────────────────────────────────────────────

export interface GroupTag {
  id: number;
  tenant_id?: number;
  name: string;
  slug: string;
  color: string | null;
  usage_count: number;
  created_at?: string | null;
}

export interface GroupCollectionGroup {
  id: number;
  name: string;
  image_url?: string | null;
  cached_member_count?: number;
  visibility?: string;
}

export interface GroupCollection {
  id: number;
  tenant_id?: number;
  name: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active?: boolean | number;
  groups: GroupCollectionGroup[];
  group_count: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export type GroupAutoAssignRuleType = 'location' | 'interest' | 'role' | 'attribute';

export interface GroupAutoAssignRule {
  id: number;
  tenant_id?: number;
  group_id: number;
  group_name?: string;
  rule_type: GroupAutoAssignRuleType;
  rule_value: string;
  is_active: boolean | number;
  created_at?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Residency Verification (AG43 — caring_community)
// ─────────────────────────────────────────────────────────────────────────────

export interface ResidencyVerification {
  id: number;
  tenant_id: number;
  user_id: number;
  declared_municipality: string;
  declared_postcode: string;
  declared_address: string | null;
  evidence_note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  attested_by: number | null;
  attested_at: string | null;
  rejection_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
  member?: { id: number; name: string; email: string | null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminDashboardStats {
  total_users: number;
  active_users: number;
  pending_users: number;
  total_listings: number;
  active_listings: number;
  pending_listings?: number;
  total_transactions: number;
  total_hours_exchanged: number;
  new_users_this_month: number;
  new_listings_this_month: number;
}

export interface MonthlyTrend {
  month: string;
  users: number;
  listings: number;
  transactions: number;
  hours: number;
}

export interface ActivityLogEntry {
  id: number;
  user_id: number;
  user_name: string;
  user_email?: string;
  user_avatar?: string | null;
  action: string;
  description: string | null;
  description_code?: string | null;
  description_params?: Record<string, string | number>;
  ip_address?: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// User Management
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  username?: string;
  avatar?: string | null;
  avatar_url?: string | null;
  role: 'member' | 'admin' | 'moderator' | 'tenant_admin' | 'super_admin';
  status: 'active' | 'inactive' | 'suspended' | 'pending' | 'banned';
  email_verified_at?: string | null;
  tenant_id?: number;
  balance: number;
  total_earned?: number;
  total_spent?: number;
  has_2fa_enabled: boolean;
  is_super_admin: boolean;
  is_god?: boolean;
  is_tenant_super_admin?: boolean;
  is_admin?: boolean;
  listing_count?: number;
  profile_type?: string;
  level?: number;
  badges_count?: number;
  created_at: string;
  last_active_at?: string | null;
  last_login_at?: string | null;
  onboarding_completed?: boolean;
}

export interface AdminUserDetail extends AdminUser {
  bio?: string;
  tagline?: string;
  location?: string;
  phone?: string;
  profile_type?: 'individual' | 'organisation';
  organization_name?: string;
  badges: AdminBadge[];
  permissions?: string[];
  roles?: string[];
  insurance_status?: 'none' | 'pending' | 'verified' | 'expired';
}

export interface AdminBadge {
  id: number;
  name: string;
  slug: string;
  description: string;
  icon?: string;
  awarded_at: string;
}

export interface UserListParams {
  page?: number;
  limit?: number;
  status?: 'all' | 'active' | 'pending' | 'suspended' | 'banned' | 'never_logged_in' | 'onboarding_incomplete';
  role?: string;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  tenant_id?: number | string;
}

export interface CreateUserPayload {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  status?: string;
  phone?: string;
  password?: string;
  send_welcome_email?: boolean;
}

export interface UpdateUserPayload {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  role?: string;
  status?: string;
  bio?: string;
  tagline?: string;
  location?: string;
  profile_type?: 'individual' | 'organisation';
  organization_name?: string;
}

export interface UserConsent {
  consent_type: string;
  name: string;
  description: string | null;
  category: string | null;
  is_required: boolean;
  consent_given: boolean;
  consent_version: string | null;
  given_at: string | null;
  withdrawn_at: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config & Features
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantConfig {
  tenant_id: number;
  features: Record<string, boolean>;
  modules: Record<string, boolean>;
  security_impact?: {
    biometric_login?: {
      credential_count: number;
      registered_users: number;
      passkey_only_users: number;
    };
  };
}

export interface CacheStats {
  redis_connected: boolean;
  redis_memory_used: string;
  redis_keys_count: number;
  cache_hit_rate: number;
}

export interface BackgroundJob {
  id: string;
  translation_key: string;
  /** @deprecated Display copy is translated client-side from translation_key. */
  name?: string;
  status: 'idle' | 'running' | 'failed';
  last_run_at: string | null;
  next_run_at: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Listings Administration
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminListing {
  id: number;
  title: string;
  description?: string;
  type: string;
  status: 'active' | 'pending' | 'inactive' | 'archived';
  user_id: number;
  user_name: string;
  user_email?: string;
  user_avatar?: string | null;
  category_id?: number | null;
  category_name?: string | null;
  hours_estimated?: number | null;
  is_featured?: boolean;
  price?: number | null;
  tenant_id?: number;
  tenant_name?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface FeaturedListing {
  id: number;
  listing_id: number;
  title: string;
  type: string;
  user_id: number;
  user_name: string;
  featured_at: string;
  featured_by?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Categories & Attributes
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminCategory {
  id: number;
  name: string;
  slug: string;
  color: string;
  type: 'listing' | 'event' | 'blog' | 'vol_opportunity';
  listing_count: number;
  created_at: string;
}

export interface AdminAttribute {
  id: number;
  name: string;
  slug: string;
  type: string;
  options?: string[] | null;
  category_id: number | null;
  category_name: string | null;
  is_active: boolean;
  target_type: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gamification
// ─────────────────────────────────────────────────────────────────────────────

export interface GamificationStats {
  total_badges_awarded: number;
  active_users: number;
  total_xp_awarded: number;
  active_campaigns: number;
  badge_distribution: Array<{
    badge_key?: string;
    badge_name: string;
    name_code?: string | null;
    count: number;
  }>;
}

export interface Campaign {
  id: number;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  badge_id?: number;
  badge_key?: string;
  badge_name: string;
  target_audience: string;
  start_date: string | null;
  end_date: string | null;
  total_awards?: number;
  created_at: string;
}

export interface BadgeDefinition {
  id: number | null;
  key: string;
  name: string;
  name_code?: string | null;
  description: string;
  description_code?: string | null;
  icon: string;
  type: 'built_in' | 'custom';
  awarded_count: number;
}

export interface BadgeConfigEntry {
  key: string;
  name: string;
  name_code?: string | null;
  description: string;
  description_code?: string | null;
  icon: string;
  type: string;
  threshold: number;
  msg: string;
  badge_tier: 'core' | 'template' | 'custom';
  badge_class: 'quantity' | 'quality' | 'special' | 'verification';
  threshold_type: string;
  evaluation_method: string;
  config_json: Record<string, unknown> | null;
  rarity: string;
  xp_value: number;
  is_enabled: boolean;
  has_override: boolean;
}

export interface BadgeConfigUpdate {
  is_enabled: boolean;
  custom_threshold: number;
  custom_name: string;
  custom_description: string;
  custom_icon: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching & Broker
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchApproval {
  id: number;
  user_1_id: number;
  user_1_name: string;
  user_1_email?: string;
  user_1_avatar?: string | null;
  user_2_id: number;
  user_2_name: string;
  user_2_email?: string;
  user_2_avatar?: string | null;
  listing_id?: number | null;
  listing_title?: string | null;
  listing_type?: string | null;
  listing_description?: string | null;
  match_score: number;
  match_type?: string;
  match_reasons?: string[];
  distance_km?: number | null;
  status: 'pending' | 'approved' | 'rejected';
  notes?: string | null;
  created_at: string;
  reviewed_at?: string | null;
  reviewer_id?: number | null;
  reviewer_name?: string | null;
}

export interface MatchApprovalDetail extends MatchApproval {
  user_1_bio?: string | null;
  user_1_location?: string | null;
  user_2_bio?: string | null;
  user_2_location?: string | null;
  listing_status?: string | null;
  category_name?: string | null;
}

export interface MatchApprovalStats {
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  avg_approval_time: number;
  approval_rate: number;
}

export interface MatchingGatesConfig {
  geo_hard_gate: boolean;
  missing_coords_mode: 'remote_only' | 'tenant_wide';
  dormancy_days: number;
  owner_dismissal_threshold: number;
}

export interface MatchingPillarWeights {
  relevance: number;
  feasibility: number;
  trust: number;
}

export interface MatchingAdjustments {
  mutual_bonus: number;
  freshness_max: number;
  semantic_boost: number;
  knn_boost: number;
}

export interface MatchingAiConfig {
  semantic_signal: boolean;
  llm_explanations: boolean;
  explanation_top_n: number;
  /** Read-only — whether the tenant's AI keys/limits allow the AI layer */
  available: boolean;
}

export interface SmartMatchingConfig {
  category_weight: number;
  skill_weight: number;
  proximity_weight: number;
  freshness_weight: number;
  reciprocity_weight: number;
  quality_weight: number;
  proximity_bands: Array<{ distance_km: number; score: number }>;
  enabled?: boolean;
  broker_approval_enabled?: boolean;
  max_distance_km?: number;
  min_match_score?: number;
  hot_match_threshold?: number;
  gates?: MatchingGatesConfig;
  engine_version?: 1 | 2;
  pillars?: MatchingPillarWeights;
  adjustments?: MatchingAdjustments;
  ai?: MatchingAiConfig;
}

export interface MatchingOverviewStats {
  total_matches_today?: number;
  total_matches_week?: number;
  total_matches_month: number;
  hot_matches_count: number;
  mutual_matches_count?: number;
  avg_match_score: number;
  avg_distance_km: number;
  cache_entries: number;
  cache_hit_rate?: number;
  active_users_matching: number;
}

export interface MatchingGateImpactStats {
  degraded_users_count: number;
  active_users_count: number;
  listings_without_coords: number;
  remote_listings_count: number;
  active_listings_count: number;
  dismiss_reasons: Record<string, number>;
  algorithm_version_mix: Record<string, number>;
}

export interface MatchingPillarAverages {
  sample_size: number;
  pillars: {
    relevance?: number;
    feasibility?: number;
    trust?: number;
  };
}

export interface MatchingStatsResponse {
  overview: MatchingOverviewStats;
  score_distribution: Record<string, number>;
  distance_distribution: Record<string, number>;
  broker_approval_enabled: boolean;
  pending_approvals: number;
  approved_count: number;
  rejected_count: number;
  approval_rate: number;
  gate_impact?: MatchingGateImpactStats;
  pillar_averages?: MatchingPillarAverages;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timebanking
// ─────────────────────────────────────────────────────────────────────────────

export interface TimebankingStats {
  total_transactions: number;
  total_volume: number;
  avg_transaction: number;
  active_alerts: number;
  top_earners: Array<{ user_id: number; user_name: string; amount: number }>;
  top_spenders: Array<{ user_id: number; user_name: string; amount: number }>;
}

export interface FraudAlert {
  id: number;
  user_id: number;
  user_name: string;
  alert_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'reviewing' | 'resolved' | 'dismissed';
  description: string;
  created_at: string;
}

export interface OrgWallet {
  id: number;
  org_id: number;
  org_name: string;
  balance: number;
  total_in: number;
  total_out: number;
  member_count: number;
  created_at: string;
}

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
  user_id: number | null;
  user_name: string;
  user_avatar: string;
  admin_id: number | null;
  admin_name: string;
  created_at: string;
}

export interface UserFinancialReport {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  avatar_url: string | null;
  balance: number;
  total_earned: number;
  total_spent: number;
  transaction_count: number;
}

export interface WalletGrant {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  amount: number;
  reason: string;
  granted_by: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Newsletters
// ─────────────────────────────────────────────────────────────────────────────

export interface Newsletter {
  id: number;
  name: string;
  subject: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent';
  recipients_count: number;
  open_rate: number;
  click_rate: number;
  sent_at: string | null;
  created_at: string;
}

export interface NewsletterBounce {
  id: number;
  newsletter_id: number;
  email: string;
  bounce_type: 'hard' | 'soft' | 'complaint';
  bounce_reason: string;
  bounced_at: string;
  campaign_name?: string;
  newsletter_subject?: string;
}

export interface SuppressionListEntry {
  email: string;
  reason: string;
  suppressed_at: string;
  bounce_count: number;
}

export interface ResendInfo {
  newsletter_id: number;
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  non_openers_count: number;
  non_clickers_count: number;
}

export interface ResendOptions {
  target: 'non_openers' | 'non_clickers' | 'segment';
  segment_id?: number;
  subject_override?: string;
}

export interface SendTimeData {
  heatmap: Array<{
    day_of_week: number;
    hour: number;
    engagement_score: number;
    opens: number;
    clicks: number;
  }>;
  recommendations: Array<{
    day_of_week: number;
    hour: number;
    score: number;
    description: string;
  }>;
  insights: string;
}

export interface NewsletterDiagnostics {
  queue_status: {
    total: number;
    pending: number;
    sending: number;
    sent: number;
    failed: number;
  };
  bounce_rate: number;
  sender_score: number;
  sender_score_breakdown: {
    bounce_penalty: number;
    complaint_penalty: number;
    failure_penalty: number;
    suppression_penalty: number;
    volume_bonus: number;
  };
  configuration: {
    smtp_configured: boolean;
    api_configured: boolean;
    tracking_enabled: boolean;
  };
  health_status: 'healthy' | 'warning' | 'critical';
}

export interface BounceTrendEntry {
  week_label: string;
  week_start: string;
  bounce_type: string;
  count: number;
}

export interface BounceReasonSummary {
  reason: string;
  bounce_type: string;
  count: number;
}

export interface BounceTrendsData {
  trends: BounceTrendEntry[];
  summary: BounceReasonSummary[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Enterprise
// ─────────────────────────────────────────────────────────────────────────────

export interface Role {
  id: number;
  name: string;
  slug: string;
  description: string;
  permissions: string[];
  users_count: number;
  created_at: string;
}

export interface GdprRequest {
  id: number;
  user_id: number;
  user_name: string;
  user_email?: string;
  type: 'access' | 'erasure' | 'portability' | 'rectification' | 'restriction' | 'objection';
  status: 'pending' | 'processing' | 'completed' | 'rejected';
  notes?: string;
  created_at: string;
  completed_at?: string;
}

export type LegalDocumentType =
  | 'terms'
  | 'privacy'
  | 'cookies'
  | 'accessibility'
  | 'community_guidelines'
  | 'acceptable_use';

export type LegalAcceptanceMode = 'registration' | 'login' | 'first_use' | 'none';

/**
 * A legal document record. Content is NOT stored here — it lives in
 * {@link LegalDocumentVersion}. `version_number` / `effective_date` reflect the
 * current published version (null when nothing is published yet); `version_count`
 * is the total number of versions (draft + published).
 * Boolean-like flags arrive from the API as 0/1 integers — coerce with Boolean().
 */
export interface LegalDocument {
  id: number;
  tenant_id?: number;
  title: string;
  type: string;
  slug?: string;
  current_version_id: number | null;
  requires_acceptance: boolean | 0 | 1;
  acceptance_required_for: LegalAcceptanceMode;
  notify_on_update: boolean | 0 | 1;
  is_active: boolean | 0 | 1;
  version_number?: string | null;
  effective_date?: string | null;
  version_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface LegalDocumentVersion {
  id: number;
  document_id: number;
  version_number: string;
  version_label?: string | null;
  content: string;
  content_plain: string;
  summary_of_changes?: string | null;
  effective_date?: string | null;
  published_at?: string | null;
  is_draft: boolean;
  is_current: boolean;
  notification_sent?: boolean;
  notification_sent_at?: string | null;
  created_by: number;
  created_by_name?: string;
  published_by?: number | null;
  published_by_name?: string | null;
  created_at: string;
}

export interface VersionComparison {
  version1: LegalDocumentVersion;
  version2: LegalDocumentVersion;
  diff_html: string;
  changes_count: number;
}

export interface ComplianceStats {
  total_users: number;
  overall_compliance_rate: number;
  users_pending_acceptance: number;
  documents: Array<{
    id: number;
    document_type: string;
    title: string;
    current_version_id: number | null;
    version_number: string;
    effective_date: string | null;
    users_accepted: number;
    users_not_accepted: number;
    acceptance_rate: number;
  }>;
}

export interface UserAcceptance {
  user_id: number;
  user_name: string;
  user_email: string;
  version_id: number;
  version_number: string;
  accepted_at: string;
  acceptance_method: string;
  ip_address: string | null;
}

export interface SystemHealth {
  php_version: string;
  memory_usage: string;
  memory_limit: string;
  db_connected: boolean;
  redis_connected: boolean;
  redis_memory: string;
  db_size: string;
  uptime: string;
  server_time: string;
  os: string;
  sys_memory?: {
    total: string;
    available: string;
    used: string;
    used_pct: number;
  };
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Array<{
    code: string;
    params?: Record<string, string | number | null>;
    /** @deprecated Legacy history rows may still contain a server-authored name. */
    name?: string;
    status: 'ok' | 'fail';
    free?: string;
    total?: string;
  }>;
}

export type SeoAuditStatus = 'pass' | 'warning' | 'fail';

export type SeoAuditCheckCode =
  | 'tenant_metadata'
  | 'seo_settings'
  | 'blog_meta'
  | 'page_meta'
  | 'kb_meta'
  | 'redirect_health'
  | 'duplicate_titles'
  | 'sitemap_coverage'
  | 'canonical_urls'
  | 'open_graph'
  | 'content_quality'
  | 'unknown';

export type SeoAuditIssueCode =
  | 'missing_homepage_meta_title'
  | 'homepage_meta_title_too_long'
  | 'missing_meta_description'
  | 'meta_description_too_long'
  | 'meta_description_too_short'
  | 'missing_homepage_h1'
  | 'canonical_urls_not_enabled'
  | 'open_graph_not_enabled'
  | 'twitter_cards_not_enabled'
  | 'title_suffix_missing'
  | 'blog_post_meta_missing'
  | 'additional_results_truncated'
  | 'cms_page_meta_title_missing'
  | 'kb_article_titles_missing'
  | 'redirect_chain'
  | 'redirect_loop'
  | 'self_redirect'
  | 'duplicate_meta_title'
  | 'sitemap_empty'
  | 'sitemap_low_coverage'
  | 'sitemap_static_pages_missing'
  | 'sitemap_profiles_missing'
  | 'canonical_generation_disabled'
  | 'custom_canonical_urls_high'
  | 'open_graph_sharing_disabled'
  | 'twitter_cards_disabled'
  | 'open_graph_default_image_missing'
  | 'thin_blog_content'
  | 'untitled_published_pages'
  | 'legacy_result_requires_rerun'
  | 'unknown';

export type SeoAuditParams = Record<string, string | number | boolean | null>;

export interface SeoAuditIssue {
  code: SeoAuditIssueCode;
  params: SeoAuditParams;
}

export interface SeoAuditCheck {
  code: SeoAuditCheckCode;
  params: SeoAuditParams;
  status: SeoAuditStatus;
  issues: SeoAuditIssue[];
  issue_count: number;
  points: number;
  max_points: number;
}

export interface SeoAuditResult {
  checks: SeoAuditCheck[];
  score: number;
  max_score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A';
  run_at: string;
  stored_at?: string;
}

export interface GdprDashboardStats {
  total_requests: number;
  pending_requests: number;
  total_consents: number;
  total_breaches: number;
}

export interface GdprConsent {
  id: number;
  user_id: number;
  user_name: string;
  consent_type: string;
  consent_type_name?: string | null;
  consented: boolean;
  consented_at?: string;
  created_at: string;
}

export interface GdprBreach {
  id: number;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'contained' | 'resolved';
  reported_at: string;
}

export interface GdprAuditEntry {
  id: number;
  admin_id: number;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id: number;
  old_value: string | null;
  new_value: string | null;
  ip_address: string | null;
  description: string;
  created_at: string;
}

export interface EnterpriseDashboardStats {
  user_count: number;
  role_count: number;
  pending_gdpr_requests: number;
  health_status: 'healthy' | 'degraded' | 'unhealthy';
  db_connected: boolean;
  redis_connected: boolean;
  memory_percent: number;
  disk_percent: number;
  recent_gdpr_activity: Array<{
    id: number;
    action: string;
    entity_type: string;
    created_at: string;
    user_name: string;
  }>;
}

export interface ErrorLogEntry {
  id: number;
  user_id?: number;
  user_name?: string;
  action: string;
  description: string;
  ip_address?: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enterprise — Extended Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GdprRequestDetail extends GdprRequest {
  request_type: string;
  priority: string;
  verified_at: string | null;
  acknowledged_at: string | null;
  processed_at: string | null;
  processed_by: number | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  export_file_path: string | null;
  export_expires_at: string | null;
  rejection_reason: string | null;
  metadata: Record<string, unknown> | null;
  timeline: GdprTimelineEntry[];
  sla_deadline: string;
  sla_days_remaining: number;
  sla_overdue: boolean;
}

export interface GdprTimelineEntry {
  id: number;
  action: string;
  entity_type: string;
  entity_id: number;
  old_value: string | null;
  new_value: string | null;
  admin_id: number;
  user_name: string;
  ip_address: string | null;
  created_at: string;
}

export interface ConsentType {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  is_required: boolean;
  legal_basis: string | null;
  retention_days: number | null;
  display_order: number;
  is_active: boolean;
  current_version: string | null;
  granted_count: number;
  denied_count: number;
  created_at: string;
  updated_at: string | null;
}

export interface ConsentTypeUser {
  user_id: number;
  user_name: string;
  user_email: string;
  consent_given: boolean;
  given_at: string | null;
  ip_address: string | null;
  version: string | null;
}

export interface GdprBreachDetail extends GdprBreach {
  breach_type: string;
  data_categories_affected: string[] | null;
  number_of_records_affected: number | null;
  number_of_users_affected: number | null;
  detected_at: string | null;
  occurred_at: string | null;
  contained_at: string | null;
  resolved_at: string | null;
  reported_to_authority: boolean;
  dpa_notified_at: string | null;
  authority_reference: string | null;
  users_notified: boolean;
  remediation_actions: string | null;
  root_cause: string | null;
  lessons_learned: string | null;
  prevention_measures: string | null;
  escalated_at: string | null;
  created_by: number | null;
  created_by_name: string | null;
}

export interface GdprStatistics {
  requests_by_status: Record<string, number>;
  requests_by_type: Record<string, number>;
  total_requests: number;
  pending_count: number;
  overdue_count: number;
  avg_processing_days: number | null;
  active_breaches: number;
  consent_coverage_percent: number;
  compliance_score: number;
}

export interface GdprTrendData {
  months: string[];
  requests: number[];
  breaches: number[];
  comparison: {
    this_month_requests: number;
    last_month_requests: number;
    this_month_completed: number;
    last_month_completed: number;
  };
}

export interface LogFile {
  name: string;
  size: string;
  size_bytes: number;
  modified_at: string;
  line_count: number;
}

export interface LogFileContent {
  filename: string;
  content: Array<{ line: number; text: string; level?: string }>;
  total_lines: number;
  filtered_count: number;
}

export interface SystemRequirements {
  php: { version: string; meets_minimum: boolean };
  extensions: Array<{ name: string; loaded: boolean; required: boolean }>;
  writable_directories: Array<{ path: string; writable: boolean }>;
  services: Array<{ name: string; status: 'ok' | 'fail' }>;
  ini_settings: Record<string, string>;
}

export interface HealthCheckHistoryEntry {
  id: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheckResult['checks'];
  latency_ms: number | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// System
// ─────────────────────────────────────────────────────────────────────────────

export interface CronJob {
  id: number;
  slug: string;
  translation_key: string;
  /** @deprecated Display copy is translated client-side from translation_key. */
  name?: string;
  command: string;
  schedule: string;
  status: 'active' | 'disabled';
  category: string;
  /** @deprecated Display copy is translated client-side from translation_key. */
  description?: string;
  last_run_at: string | null;
  last_status: 'success' | 'failed' | null;
  next_run_at: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Blog
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminBlogPost {
  id: number;
  title: string;
  slug: string;
  content?: string;
  excerpt?: string;
  status: 'draft' | 'published';
  featured_image?: string | null;
  author_id: number;
  author_name?: string;
  category_id?: number | null;
  category_name?: string;
  meta_title?: string | null;
  meta_description?: string | null;
  noindex?: boolean;
  created_at: string;
  updated_at?: string;
}

export interface CreateBlogPostPayload {
  title: string;
  slug?: string;
  content?: string;
  excerpt?: string;
  status?: 'draft' | 'published';
  featured_image?: string | null;
  category_id?: number;
  meta_title?: string;
  meta_description?: string;
  noindex?: boolean;
}

export type UpdateBlogPostPayload = Partial<CreateBlogPostPayload>;

// ─────────────────────────────────────────────────────────────────────────────
// Broker Controls
// ─────────────────────────────────────────────────────────────────────────────

export interface BrokerDashboardStats {
  // Each metric is `null` when the controller's per-query try/catch
  // failed to compute it. Frontend renders null as a dash and surfaces
  // the partial-load banner — silently coercing to 0 would hide real
  // safeguarding alerts during a DB hiccup.
  pending_exchanges: number | null;
  unreviewed_messages: number | null;
  high_risk_listings: number | null;
  monitored_users: number | null;
  vetting_review_requests: number | null;
  safeguarding_alerts: number | null;
  onboarding_safeguarding_flags: number | null;
  recent_activity: BrokerActivityEntry[];
  /** True when one or more metrics failed to load. */
  _partial?: boolean;
  /** Names of metrics that returned null. */
  _failed_metrics?: string[];
}

export interface BrokerActivityEntry {
  id: number;
  /**
   * 'activity' for activity_log rows, 'audit' for org_audit_log rows.
   * Used by the frontend to build a stable composite React key —
   * id values collide across the two tables.
   */
  source: 'activity' | 'audit';
  user_id: number | null;
  first_name: string | null;
  last_name: string | null;
  action_type: string;
  details: string | null;
  created_at: string;
}

export interface ExchangeRequest {
  id: number;
  requester_id: number;
  requester_name: string;
  provider_id: number;
  provider_name: string;
  listing_id?: number;
  listing_title?: string;
  status: string;
  broker_id?: number;
  broker_notes?: string;
  broker_conditions?: string;
  broker_approved_at?: string;
  final_hours?: number;
  created_at: string;
}

export interface RiskTag {
  id: number;
  listing_id: number;
  listing_title?: string;
  owner_name?: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  risk_category: string;
  risk_notes?: string;
  member_visible_notes?: string;
  requires_approval: boolean;
  insurance_required: boolean;
  dbs_required: boolean;
  tagged_by_name?: string;
  created_at: string;
}

export interface BrokerMessage {
  id: number;
  sender_id: number;
  sender_name: string;
  receiver_id: number;
  receiver_name: string;
  related_listing_id?: number;
  listing_title?: string;
  message_body?: string;
  copy_reason?: string;
  conversation_key?: string;
  original_message_id?: number;
  sent_at?: string;
  archived_at?: string;
  archive_id?: number;
  reviewed_by?: number;
  reviewed_at?: string;
  flagged: boolean;
  flag_reason?: string;
  flag_severity?: string;
  created_at: string;
}

export interface ConversationMessage {
  id: number;
  sender_id: number;
  sender_name: string;
  receiver_id: number;
  body: string;
  subject?: string;
  listing_id?: number;
  created_at: string;
  is_edited?: boolean;
  is_deleted?: boolean;
}

export interface BrokerMessageDetail {
  copy: BrokerMessage & {
    message_body: string;
    conversation_key: string;
    copy_reason: string;
    original_message_id: number;
    sent_at: string;
  };
  thread: ConversationMessage[];
  archive: {
    id: number;
    decision: 'approved' | 'flagged';
    decision_notes?: string;
    decided_by_name: string;
    decided_at: string;
  } | null;
}

export interface BrokerArchive {
  id: number;
  sender_name: string;
  receiver_name: string;
  listing_title?: string;
  copy_reason: string;
  decision: 'approved' | 'flagged';
  decision_notes?: string;
  decided_by_name: string;
  decided_at: string;
  flag_reason?: string;
  flag_severity?: string;
  created_at: string;
}

export interface BrokerArchiveDetail extends BrokerArchive {
  tenant_id: number;
  broker_copy_id: number;
  sender_id: number;
  receiver_id: number;
  related_listing_id?: number;
  target_message_body: string;
  target_message_sent_at: string;
  conversation_snapshot: ConversationMessage[];
  decided_by: number;
}

export interface MonitoredUser {
  id: number;
  user_id: number;
  user_name: string;
  under_monitoring: boolean;
  monitoring_reason?: string;
  monitoring_started_at?: string;
  monitoring_expires_at?: string;
  messaging_disabled?: boolean;
  restricted_by?: number;
}

export interface BrokerConfig {
  // Messaging
  broker_messaging_enabled: boolean;
  broker_copy_all_messages: boolean;
  broker_copy_threshold_hours: number;
  new_member_monitoring_days: number;
  require_exchange_for_listings: boolean;
  // Risk Tagging
  risk_tagging_enabled: boolean;
  auto_flag_high_risk: boolean;
  require_approval_high_risk: boolean;
  notify_on_high_risk_match: boolean;
  // Exchange Workflow
  broker_approval_required: boolean;
  auto_approve_low_risk: boolean;
  exchange_timeout_days: number;
  max_hours_without_approval: number;
  confirmation_deadline_hours: number;
  allow_hour_adjustment: boolean;
  max_hour_variance_percent: number;
  expiry_hours: number;
  // Broker Visibility / Message Copy
  broker_visible_to_members: boolean;
  show_broker_name: boolean;
  broker_contact_email: string;
  copy_first_contact: boolean;
  copy_new_member_messages: boolean;
  copy_high_risk_listing_messages: boolean;
  random_sample_percentage: number;
  retention_days: number;
  // Compliance & Safeguarding
  insurance_enabled: boolean;
  enforce_insurance_on_exchanges: boolean;
  insurance_expiry_warning_days: number;
}

export interface ExchangeHistoryEntry {
  id: number;
  exchange_id: number;
  actor_id?: number;
  actor_name?: string;
  action: string;
  notes?: string;
  created_at: string;
}

export interface ExchangeDetail {
  exchange: ExchangeRequest & {
    requester_email?: string;
    requester_avatar?: string;
    provider_email?: string;
    provider_avatar?: string;
    listing_type?: string;
    hours_offered?: number;
  };
  history: ExchangeHistoryEntry[];
  risk_tag?: RiskTag | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Groups
// ─────────────────────────────────────────────────────────────────────────────

export type GroupStatus = 'pending_review' | 'active' | 'dormant' | 'archived' | 'rejected';
export type GroupVisibility = 'public' | 'private' | 'hidden';

export interface AdminGroup {
  id: number;
  name: string;
  description?: string;
  image_url?: string | null;
  cover_image_url?: string | null;
  visibility: GroupVisibility;
  status: GroupStatus;
  creator_name?: string;
  member_count: number;
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
  type_id?: number | null;
  type?: { id: number; name: string; icon?: string; color?: string } | null;
  is_featured?: boolean;
  federated_visibility?: 'none' | 'listed' | 'joinable';
  primary_color?: string | null;
  accent_color?: string | null;
  tenant_name?: string;
  stats?: { posts_count: number; events_count: number; activity_score: number };
  created_at: string;
}

export interface GroupApproval {
  id: number;
  group_id: number;
  group_name: string;
  user_id: number;
  user_name: string;
  status: string;
  created_at: string;
}

export interface GroupAnalyticsData {
  total_groups: number;
  total_members: number;
  avg_members_per_group: number;
  active_groups: number;
  pending_approvals: number;
  most_active_groups: Array<{ id: number; name: string; member_count: number }>;
}

export interface GroupModerationItem {
  id: number;
  name: string;
  status: string;
  report_count: number;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    current_page: number;
    /** @deprecated Use current_page — kept for backwards compatibility */
    page?: number;
    total_pages: number;
    per_page: number;
    total: number;
    has_more: boolean;
    base_url?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin — Tenants
// ─────────────────────────────────────────────────────────────────────────────

export interface SuperAdminDashboardStats {
  total_tenants: number;
  active_tenants: number;
  total_users: number;
  total_listings: number;
  hub_tenants: number;
  inactive_tenants: number;
}

export interface SuperAdminTenant {
  id: number;
  name: string;
  slug: string;
  domain: string;
  /** Optional dedicated custom domain for the accessible (GOV.UK) frontend. */
  accessible_domain?: string;
  tagline?: string;
  description?: string;
  parent_id: number | null;
  parent_name?: string;
  depth: number;
  is_active: boolean;
  allows_subtenants: boolean;
  max_depth: number;
  user_count?: number;
  listing_count?: number;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  meta_title?: string;
  meta_description?: string;
  h1_headline?: string;
  hero_intro?: string;
  og_image_url?: string;
  robots_directive?: string;
  seo_organization_type?: string;
  location_name?: string;
  country_code?: string;
  service_area?: string;
  latitude?: string;
  longitude?: string;
  social_facebook?: string;
  social_twitter?: string;
  social_instagram?: string;
  social_linkedin?: string;
  social_youtube?: string;
  features?: Record<string, boolean>;
  configuration?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
}

export interface SuperAdminTenantDetail extends SuperAdminTenant {
  children: SuperAdminTenant[];
  admins: SuperAdminUser[];
  breadcrumb: Array<{ id: number; name: string }>;
}

/**
 * Dry-run report from GET /v2/admin/super/tenants/{id}/purge-preview — the row
 * counts and external resources a permanent purge would remove. Powers the
 * god-only purge confirmation dialog.
 */
export interface TenantPurgePreview {
  success: boolean;
  dry_run: boolean;
  tenant: { id: number; name: string; slug: string };
  tables: Record<string, number>;
  totals: { tables_touched: number; rows: number };
  members_to_delete: number;
  superadmins_reassigned: number;
  external: Record<string, unknown>;
  warnings: string[];
  manual_followups: string[];
}

export interface CreateTenantPayload {
  parent_id?: number;
  name: string;
  slug: string;
  domain?: string;
  accessible_domain?: string;
  tagline?: string;
  description?: string;
  allows_subtenants?: boolean;
  max_depth?: number;
  is_active?: boolean;
  features?: Record<string, boolean>;
  configuration?: Record<string, unknown>;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  meta_title?: string;
  meta_description?: string;
  h1_headline?: string;
  hero_intro?: string;
  og_image_url?: string;
  robots_directive?: string;
  seo_organization_type?: string;
  location_name?: string;
  country_code?: string;
  service_area?: string;
  latitude?: string;
  longitude?: string;
  social_facebook?: string;
  social_twitter?: string;
  social_instagram?: string;
  social_linkedin?: string;
  social_youtube?: string;
}

export interface UpdateTenantPayload {
  name?: string;
  slug?: string;
  domain?: string;
  accessible_domain?: string;
  tagline?: string;
  description?: string;
  is_active?: boolean;
  allows_subtenants?: boolean;
  max_depth?: number;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  meta_title?: string;
  meta_description?: string;
  h1_headline?: string;
  hero_intro?: string;
  og_image_url?: string;
  robots_directive?: string;
  seo_organization_type?: string;
  location_name?: string;
  country_code?: string;
  service_area?: string;
  latitude?: string;
  longitude?: string;
  social_facebook?: string;
  social_twitter?: string;
  social_instagram?: string;
  social_linkedin?: string;
  social_youtube?: string;
  features?: Record<string, boolean>;
  configuration?: Record<string, unknown>;
}

export interface TenantHierarchyNode {
  id: number;
  name: string;
  slug: string;
  parent_id: number | null;
  depth: number;
  is_active: boolean;
  allows_subtenants: boolean;
  user_count: number;
  children: TenantHierarchyNode[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin — Cross-Tenant Users
// ─────────────────────────────────────────────────────────────────────────────

export interface SuperAdminUser {
  id: number;
  first_name: string;
  last_name: string;
  name: string;
  email: string;
  role: string;
  status: string;
  tenant_id: number;
  tenant_name?: string;
  is_super_admin: boolean;
  is_tenant_super_admin: boolean;
  created_at: string;
  last_login_at?: string | null;
}

export interface SuperAdminUserDetail extends SuperAdminUser {
  location?: string;
  phone?: string;
  avatar?: string | null;
  balance?: number;
}

export interface CreateSuperUserPayload {
  tenant_id: number;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  role?: string;
  location?: string;
  phone?: string;
  is_tenant_super_admin?: boolean;
}

export interface SuperUserListParams {
  page?: number;
  limit?: number;
  search?: string;
  tenant_id?: number;
  role?: string;
  super_admins?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin — Bulk Operations
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkMoveUsersPayload {
  user_ids: number[];
  target_tenant_id: number;
  grant_super_admin?: boolean;
}

export interface BulkUpdateTenantsPayload {
  tenant_ids: number[];
  action: 'activate' | 'deactivate' | 'enable_hub' | 'disable_hub';
}

export interface BulkOperationResult {
  success: boolean;
  moved_count?: number;
  updated_count: number;
  total_requested: number;
  errors: Array<string | { code: string; params?: Record<string, string | number> }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin — Audit
// ─────────────────────────────────────────────────────────────────────────────

export interface SuperAuditEntry {
  id: number;
  action_type: string;
  target_type: string;
  target_id: number | null;
  target_label: string | null;
  target_label_code?: string | null;
  target_label_params?: Record<string, string | number>;
  actor_id: number;
  actor_name?: string;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  description: string | null;
  description_code?: string | null;
  description_params?: Record<string, string | number>;
  created_at: string;
}

export interface SuperAuditParams {
  action_type?: string;
  target_type?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin — Federation Controls
// ─────────────────────────────────────────────────────────────────────────────

export interface FederationSystemControls {
  federation_enabled: boolean;
  whitelist_mode_enabled: boolean;
  max_federation_level: number;
  cross_tenant_profiles_enabled: boolean;
  cross_tenant_messaging_enabled: boolean;
  cross_tenant_transactions_enabled: boolean;
  cross_tenant_listings_enabled: boolean;
  cross_tenant_events_enabled: boolean;
  cross_tenant_groups_enabled: boolean;
  emergency_lockdown_active: boolean;
  emergency_lockdown_reason?: string;
  updated_at?: string;
  // External partner federation kill switch — traffic to/from OTHER
  // installations. Independent of the cross_tenant_* flags above, which gate
  // federation between tenants inside this install.
  external_federation_enabled: boolean;
  external_protocol_nexus_enabled: boolean;
  external_protocol_komunitin_enabled: boolean;
  external_protocol_credit_commons_enabled: boolean;
  external_protocol_legacy_v1_enabled: boolean;
  external_protocol_webhooks_enabled: boolean;
  external_protocol_hour_transfer_enabled: boolean;
  external_protocol_aggregates_enabled: boolean;
  external_federation_disabled_reason?: string | null;
  external_federation_updated_at?: string | null;
}

/** Effective external federation posture, from the external-status endpoint. */
export interface FederationExternalStatus {
  platform_enabled: boolean;
  master_enabled: boolean;
  effective: boolean;
  emergency_lockdown_active: boolean;
  reason: string | null;
  protocols: Record<string, boolean>;
  blocked_last_24h: Record<string, number>;
}

export interface FederationWhitelistEntry {
  tenant_id: number;
  tenant_name: string;
  tenant_domain?: string;
  added_by: number;
  added_at: string;
  notes?: string;
}

export interface FederationPartnership {
  id: number;
  tenant_1_id: number;
  tenant_1_name: string;
  tenant_2_id: number;
  tenant_2_name: string;
  status: 'pending' | 'active' | 'suspended' | 'terminated';
  created_at: string;
}

export interface FederationStatusOverview {
  system_controls: FederationSystemControls;
  partnership_stats: { total: number; active: number; pending: number; suspended: number };
  whitelisted_count: number;
  recent_audit: SuperAuditEntry[];
}

export interface TenantFederationFeatures {
  tenant_id: number;
  tenant_name: string;
  tenant_domain: string | null;
  is_whitelisted: boolean;
  active_partnerships_count: number;
  federation_enabled: boolean;
  directory_visible: boolean;
  profiles_enabled: boolean;
  messaging_enabled: boolean;
  transactions_enabled: boolean;
  listings_enabled: boolean;
  events_enabled: boolean;
  groups_enabled: boolean;
  features?: Record<string, boolean>;
  partnerships?: FederationPartnership[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminNavItem {
  label: string;
  href: string;
  icon: string;
  badge?: string | number;
  children?: AdminNavItem[];
}

export interface AdminNavSection {
  key: string;
  label: string;
  icon: string;
  items?: AdminNavItem[];
  href?: string;
  condition?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vetting Records (TOL2 compliance)
// ─────────────────────────────────────────────────────────────────────────────

export interface VettingRecord {
  user_id: number;
  first_name: string;
  last_name: string;
  email: string;
  avatar_url?: string | null;
  attestation_id: number | null;
  decision: 'confirmed' | 'revoked' | 'not_confirmed';
  certification_codes: string[];
  is_expired: boolean;
  confirmed_by: number | null;
  confirmed_at: string | null;
  revoked_by: number | null;
  revoked_at: string | null;
  revocation_reason_code: string | null;
  review_due_at: string | null;
  authority_expires_at: string | null;
  policy_version: string | null;
  review_request_id: number | null;
  review_status: 'pending' | 'resolved' | null;
  requested_at: string | null;
  policy: SafeguardingVettingPolicy;
}

export interface VettingStats {
  total_members: number;
  confirmed: number;
  revoked: number;
  expired: number;
  not_confirmed: number;
  review_pending?: number;
  review_requested?: number;
  policy: SafeguardingVettingPolicy;
}

export interface SafeguardingVettingPolicy {
  configured: boolean;
  contact_policy_available: boolean;
  jurisdiction: string;
  scheme_code: string | null;
  attestation_code: string | null;
  purpose_code: string;
  scope_type: string;
  scope_identifier: string;
  policy_version: string | null;
  label: string;
  attestation_label: string | null;
  preset: string | null;
  certification_options: VettingCertificationOption[];
}

export interface VettingCertificationOption {
  code: string;
  jurisdiction: string;
  label: string;
  authority_expiry_required: boolean;
}

export interface SafeguardingJurisdictionOption {
  code: string;
  label: string;
  attestation_code: string | null;
  attestation_label: string | null;
  available_for_contact_policy: boolean;
  contact_policy_available: boolean;
  certification_options: VettingCertificationOption[];
}

export interface VettingPolicyResponse {
  policy: SafeguardingVettingPolicy;
  jurisdictions: SafeguardingJurisdictionOption[];
  revocation_reason_codes: string[];
  review_resolution_codes: Array<'no_change' | 'duplicate_request' | 'member_contacted'>;
}

export interface VettingAttestation {
  id: number;
  user_id: number;
  scheme_code: string;
  attestation_code: string;
  certification_codes: string[];
  purpose_code: string;
  scope_type: string;
  scope_identifier: string;
  scope_summary: string | null;
  private_notes: string | null;
  review_due_at: string | null;
  authority_expires_at: string | null;
  is_expired: boolean;
  decision: 'confirmed' | 'revoked';
  confirmed_at: string | null;
  revoked_at: string | null;
  revocation_reason_code: string | null;
  policy_version: string;
  confirmer_first_name?: string | null;
  confirmer_last_name?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Insurance Certificates (compliance)
// ─────────────────────────────────────────────────────────────────────────────

export interface InsuranceCertificate {
  id: number;
  user_id: number;
  first_name: string;
  last_name: string;
  email: string;
  avatar_url?: string;
  insurance_type: 'public_liability' | 'professional_indemnity' | 'employers_liability' | 'product_liability' | 'personal_accident' | 'other';
  status: 'pending' | 'submitted' | 'verified' | 'expired' | 'rejected' | 'revoked';
  provider_name: string | null;
  policy_number: string | null;
  coverage_amount: number | null;
  start_date: string | null;
  expiry_date: string | null;
  certificate_file_path: string | null;
  verified_by: number | null;
  verifier_first_name: string | null;
  verifier_last_name: string | null;
  verified_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface InsuranceStats {
  total: number;
  /** Records with literal status='pending'. */
  pending: number;
  /** Records with literal status='submitted' (sent for verification). */
  submitted?: number;
  /**
   * pending + submitted — pre-verification states the broker still owns.
   * This is what the "Pending Review" stat card and the dashboard's
   * insurance count (if added) should mean. Legacy `pending` field is
   * kept for backwards compatibility with pre-update API responses.
   */
  pending_review?: number;
  verified: number;
  expired: number;
  expiring_soon: number;
  rejected?: number;
  revoked?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Settings Response
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminSettingsResponse {
  tenant_id: number;
  tenant: {
    name: string;
    description: string;
    contact_email: string;
    contact_phone: string;
  };
  settings: {
    registration_mode: string | null;
    email_verification: string | null;
    admin_approval: string | null;
    maintenance_mode: string | null;
    footer_text: string | null;
    partner_logo_url: string | null;
    partner_logo_label: string | null;
    partner_logo_link_url: string | null;
    powered_by_label: string | null;
    powered_by_image_light: string | null;
    powered_by_image_dark: string | null;
    powered_by_url: string | null;
    default_currency: string | null;
    map_provider: string | null;
    geocoding_provider: string | null;
    /** Masked on read ("AIza••••••••YJ4"). Empty string on write clears the override. */
    google_maps_api_key: string | null;
    google_maps_api_key_set?: boolean;
    google_maps_map_id: string | null;
    /** Masked on read. */
    maptiler_api_key: string | null;
    maptiler_api_key_set?: boolean;
    /** Masked on read. OS Data Hub key for the Ordnance Survey Maps API. */
    os_maps_api_key?: string | null;
    os_maps_api_key_set?: boolean;
    /** '0' = disabled; 5–480 minutes when enabled. */
    inactivity_timeout_minutes?: string | null;
    /** Accessible (GOV.UK alpha) header background colour — #rrggbb or null for the default black. */
    header_bg_color?: string | null;
    /** Accessible header accent line colour — #rrggbb or null (defaults to the background, or GOV.UK blue when no background is set). */
    header_accent_color?: string | null;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron Job Monitoring
// ─────────────────────────────────────────────────────────────────────────────

export interface CronLog {
  id: number;
  job_id: string;
  job_name: string;
  status: 'success' | 'failed';
  output: string;
  duration_seconds: number;
  executed_at: string;
  executed_by: string; // 'cron' or 'manual-{user_id}'
}

export interface CronJobSettings {
  job_id: string;
  is_enabled: boolean;
  custom_schedule?: string;
  notify_on_failure: boolean;
  notify_emails?: string;
  max_retries: number;
  timeout_seconds: number;
}

export interface GlobalCronSettings {
  default_notify_email?: string;
  log_retention_days: number;
  max_concurrent_jobs: number;
}

export interface CronHealthMetrics {
  health_score: number;
  recent_failures: Array<{
    job_name: string;
    failed_at: string;
    reason: string;
  }>;
  jobs_failed_24h: number;
  jobs_overdue: Array<{
    job_id: string;
    job_name: string;
    last_run: string;
    expected_interval: string;
  }>;
  avg_success_rate_7d: number;
  alert_status: 'critical' | 'warning' | 'healthy';
}

// ─────────────────────────────────────────────────────────────────────────────
// Match Approvals
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchApproval {
  id: number;
  user_a_id: number;
  user_b_id: number;
  user_a_name: string;
  user_b_name: string;
  user_a_avatar?: string | null;
  user_b_avatar?: string | null;
  match_score: number;
  reasoning: string[];
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  skills_overlap?: string[];
  interests_overlap?: string[];
  location_proximity?: number;
}

export interface MatchStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  avg_score: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Content Moderation
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminFeedPost {
  id: number;
  user_id: number;
  tenant_id: number;
  tenant_name: string;
  user_name: string;
  user_avatar?: string | null;
  content: string;
  type: string;
  image_url?: string | null;
  is_hidden: boolean;
  is_flagged?: boolean;
  likes_count?: number;
  comments_count: number;
  visibility?: string;
  created_at: string;
}

export interface AdminComment {
  id: number;
  user_id: number;
  tenant_id: number;
  tenant_name: string;
  user_name: string;
  user_avatar?: string | null;
  content_type: 'listing' | 'event' | 'post' | 'blog';
  content_id: number;
  content_title?: string;
  content: string;
  is_hidden: boolean;
  is_flagged: boolean;
  reports_count: number;
  created_at: string;
}

export interface AdminReview {
  id: number;
  reviewer_id: number;
  tenant_id: number;
  tenant_name: string;
  reviewer_name: string;
  reviewer_avatar?: string | null;
  reviewee_id: number;
  reviewee_name: string;
  reviewee_avatar?: string | null;
  rating: number;
  content: string;
  is_hidden: boolean;
  is_flagged: boolean;
  reports_count: number;
  created_at: string;
}

export type AdminReportTargetType =
  | 'listing'
  | 'user'
  | 'message'
  | 'post'
  | 'comment'
  | 'story'
  | 'event'
  | 'poll'
  | 'goal'
  | 'review'
  | 'resource'
  | 'volunteer'
  | 'challenge'
  | 'job'
  | 'blog'
  | 'discussion';

export interface AdminReport {
  id: number;
  reporter_id: number;
  tenant_id: number;
  tenant_name: string;
  reporter_name: string;
  reporter_avatar?: string | null;
  /** The type of thing that was reported (reports.target_type). */
  content_type: AdminReportTargetType;
  /** The id of the reported item within content_type (reports.target_id). */
  target_id: number;
  /** Human-readable name/title of the target (member name, listing/event title). */
  target_label?: string | null;
  /** Short content excerpt for post/comment/review targets. */
  target_preview?: string | null;
  /** Avatar of the target member, or the content author for content targets. */
  target_avatar?: string | null;
  /** Author of the reported content (or the reported member for user targets). */
  target_author_id?: number | null;
  target_author_name?: string | null;
  /** False when the reported row no longer exists (deleted content). */
  target_exists?: boolean;
  reason: string;
  status: 'open' | 'pending' | 'resolved' | 'dismissed';
  created_at: string;
  updated_at?: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
}

export type AdminSupportReportStatus = 'open' | 'triaged' | 'resolved' | 'closed';
export type AdminSupportReportImpact = 'blocked' | 'major' | 'minor' | 'cosmetic';

export interface AdminSupportReportUser {
  id: number;
  name: string;
  email?: string | null;
  avatar_url?: string | null;
  role?: string | null;
}

export interface AdminSupportReport {
  id: number;
  tenant_id: number;
  tenant_name?: string | null;
  user_id: number | null;
  assigned_user_id: number | null;
  reference: string;
  source: string;
  summary: string;
  description: string;
  impact: AdminSupportReportImpact;
  status: AdminSupportReportStatus;
  module?: string | null;
  route?: string | null;
  page_url?: string | null;
  sentry_event_id?: string | null;
  sentry_issue_url?: string | null;
  diagnostics?: Record<string, unknown> | null;
  user_agent?: string | null;
  triage_notes?: string | null;
  triaged_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  reporter?: AdminSupportReportUser | null;
  assignee?: AdminSupportReportUser | null;
}

export interface AdminSupportReportStats {
  total: number;
  open: number;
  triaged: number;
  resolved: number;
  closed: number;
  blocked: number;
  major: number;
  unassigned: number;
}

export interface AdminSupportReportUpdatePayload {
  status?: AdminSupportReportStatus;
  assigned_user_id?: number | null;
  triage_notes?: string | null;
  sentry_event_id?: string | null;
  sentry_issue_url?: string | null;
}

export interface ModerationStats {
  feed_posts_total: number;
  feed_posts_hidden: number;
  feed_posts_flagged: number;
  comments_total: number;
  comments_hidden: number;
  comments_flagged: number;
  reviews_total: number;
  reviews_hidden: number;
  reviews_flagged: number;
  reports_pending: number;
  reports_resolved: number;
  reports_dismissed: number;
  // Direct keys from /v2/admin/reports/stats
  pending?: number;
  resolved?: number;
  dismissed?: number;
  total?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin - Tenant Management
// ─────────────────────────────────────────────────────────────────────────────

export interface SuperTenant {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  tagline: string | null;
  description: string | null;
  parent_id: number | null;
  parent_name?: string | null;
  is_active: boolean;
  allows_subtenants: boolean;
  max_depth: number;
  depth: number;
  path: string;
  user_count: number;
  child_count: number;
  can_manage: boolean;
  relationship: 'self' | 'ancestor' | 'descendant' | 'other';
  meta_title?: string | null;
  meta_description?: string | null;
  meta_keywords?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  facebook_url?: string | null;
  twitter_url?: string | null;
  linkedin_url?: string | null;
  instagram_url?: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin - User Management
// ─────────────────────────────────────────────────────────────────────────────

export interface SuperUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  tenant_id: number;
  tenant_name: string;
  role: string;
  status: 'active' | 'inactive' | 'suspended';
  is_super_admin: boolean;
  is_tenant_super_admin: boolean;
  avatar?: string | null;
  location?: string | null;
  phone?: string | null;
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin - Audit Logs
// ─────────────────────────────────────────────────────────────────────────────

export interface FederationAuditEntry {
  id: number;
  level: 'critical' | 'warning' | 'info' | 'debug';
  action_type: string;
  category: 'system' | 'tenant' | 'partnership' | 'profile' | 'messaging' | 'transaction';
  actor_id: number | null;
  actor_name: string | null;
  actor_email: string | null;
  tenant_from_id: number | null;
  tenant_to_id: number | null;
  ip_address: string | null;
  user_agent: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditStats {
  actions_30d: number;
  tenant_changes_30d: number;
  user_changes_30d: number;
  active_admins_30d: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin - Federation
// ─────────────────────────────────────────────────────────────────────────────

export interface FederationStats {
  system_enabled: boolean;
  whitelist_mode: boolean;
  whitelisted_count: number;
  active_partnerships: number;
  pending_requests: number;
  federation_enabled_count: number;
  profiles_enabled: boolean;
  messaging_enabled: boolean;
  transactions_enabled: boolean;
  listings_enabled: boolean;
  events_enabled: boolean;
  groups_enabled: boolean;
  emergency_lockdown_active: boolean;
  emergency_lockdown_reason?: string | null;
}

export interface WhitelistedTenant {
  tenant_id: number;
  tenant_name: string;
  tenant_domain: string | null;
  approved_by: string;
  approved_at: string;
  notes?: string | null;
}

export interface Partnership {
  id: number;
  tenant_a_id: number;
  tenant_a_name: string;
  tenant_b_id: number;
  tenant_b_name: string;
  level: number;
  level_name: string;
  status: 'active' | 'pending' | 'suspended' | 'terminated';
  features_enabled: {
    profiles: boolean;
    messaging: boolean;
    transactions: boolean;
    listings: boolean;
    events: boolean;
    groups: boolean;
  };
  created_at: string;
  suspended_at?: string | null;
  suspended_reason?: string | null;
  terminated_at?: string | null;
  terminated_reason?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM (Member Notes, Coordinator Tasks, Tags)
// ─────────────────────────────────────────────────────────────────────────────

export interface CrmDashboardStats {
  total_members: number;
  active_members: number;
  new_this_month: number;
  pending_approvals: number;
  open_tasks: number;
  overdue_tasks: number;
  total_notes: number;
  never_logged_in: number;
  retention_rate: number;
}

export interface CrmFunnelStage {
  code: string;
  /** @deprecated Display copy is translated client-side from code. */
  name?: string;
  count: number;
  color: string;
}

export interface CrmFunnelData {
  stages: CrmFunnelStage[];
  monthly_registrations: Array<{ month: string; count: number }>;
}

export interface MemberNote {
  id: number;
  tenant_id: number;
  user_id: number;
  author_id: number;
  content: string;
  category: 'general' | 'outreach' | 'support' | 'onboarding' | 'concern' | 'follow_up';
  is_pinned: number;
  created_at: string;
  updated_at: string;
  user_name: string;
  user_avatar: string | null;
  author_name: string;
}

export interface CoordinatorTask {
  id: number;
  tenant_id: number;
  assigned_to: number;
  user_id: number | null;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  due_date: string | null;
  completed_at: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  assigned_to_name: string;
  created_by_name: string;
  user_name: string | null;
  user_avatar: string | null;
}

export interface MemberTag {
  id: number;
  tenant_id: number;
  user_id: number;
  tag: string;
  created_by: number;
  created_at: string;
  user_name?: string;
}

export interface TagSummary {
  tag: string;
  member_count: number;
}

export interface CrmAdmin {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
  role: string;
}

export interface TimelineEntry {
  id: number;
  user_id: number;
  user_name: string;
  user_avatar: string | null;
  activity_type: string;
  description_code: string;
  description_params: Record<string, string | number | null>;
  /** @deprecated Display copy is translated client-side from description_code. */
  description?: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
