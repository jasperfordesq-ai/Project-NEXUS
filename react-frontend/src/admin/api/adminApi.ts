// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin API Client
 * Wraps the main api client with admin-specific endpoints
 */

import { api, API_BASE, type ApiResponse } from '@/lib/api';
import type {
  AdminDashboardStats,
  MonthlyTrend,
  ActivityLogEntry,
  AdminUser,
  AdminUserDetail,
  UserListParams,
  CreateUserPayload,
  UpdateUserPayload,
  TenantConfig,
  CacheStats,
  BackgroundJob,
  AdminListing,
  FeaturedListing,
  AdminCategory,
  AdminAttribute,
  GamificationStats,
  Campaign,
  MatchApproval,
  MatchApprovalDetail,
  MatchApprovalStats,
  SmartMatchingConfig,
  TimebankingStats,
  FraudAlert,
  OrgWallet,
  CommunityFundBalance,
  CommunityFundTransaction,
  UserFinancialReport,
  WalletGrant,
  CronJob,
  PaginatedResponse,
  AdminBlogPost,
  CreateBlogPostPayload,
  UpdateBlogPostPayload,
  BadgeDefinition,
  BadgeConfigEntry,
  BadgeConfigUpdate,
  BrokerDashboardStats,
  ExchangeRequest,
  ExchangeDetail,
  RiskTag,
  BrokerMessage,
  BrokerMessageDetail,
  BrokerArchive,
  BrokerArchiveDetail,
  MonitoredUser,
  BrokerConfig,
  AdminGroup,
  GroupStatus,
  GroupApproval,
  GroupAnalyticsData,
  GroupModerationItem,
  GroupType,
  GroupTag,
  GroupCollection,
  GroupAutoAssignRule,
  GroupAutoAssignRuleType,
  ResidencyVerification,
  GroupMember,
  GroupRecommendation,
  FeaturedGroup,
  EnterpriseDashboardStats,
  Role,
  GdprDashboardStats,
  GdprRequest,
  GdprRequestDetail,
  GdprConsent,
  GdprBreach,
  GdprBreachDetail,
  GdprAuditEntry,
  GdprStatistics,
  GdprTrendData,
  ConsentType,
  ConsentTypeUser,
  SystemHealth,
  HealthCheckResult,
  HealthCheckHistoryEntry,
  ErrorLogEntry,
  LogFile,
  LogFileContent,
  SystemRequirements,
  LegalDocument,
  LegalDocumentVersion,
  VersionComparison,
  ComplianceStats,
  UserAcceptance,
  Newsletter,
  NewsletterBounce,
  SuppressionListEntry,
  ResendInfo,
  SendTimeData,
  NewsletterDiagnostics,
  BounceTrendsData,
  SuperAdminDashboardStats,
  SuperAdminTenant,
  SuperAdminTenantDetail,
  TenantPurgePreview,
  CreateTenantPayload,
  UpdateTenantPayload,
  TenantHierarchyNode,
  SuperAdminUser,
  SuperAdminUserDetail,
  CreateSuperUserPayload,
  SuperUserListParams,
  BulkMoveUsersPayload,
  BulkUpdateTenantsPayload,
  BulkOperationResult,
  SuperAuditEntry,
  SuperAuditParams,
  FederationSystemControls,
  FederationExternalStatus,
  FederationWhitelistEntry,
  FederationPartnership,
  FederationStatusOverview,
  TenantFederationFeatures,
  VettingRecord,
  VettingStats,
  VettingPolicyResponse,
  VettingAttestation,
  InsuranceCertificate,
  InsuranceStats,
  CronLog,
  CronJobSettings,
  GlobalCronSettings,
  CronHealthMetrics,
  AdminFeedPost,
  AdminComment,
  AdminReview,
  AdminReport,
  AdminSupportReport,
  AdminSupportReportStats,
  AdminSupportReportUpdatePayload,
  AdminSupportReportUser,
  ModerationStats,
  CrmDashboardStats,
  CrmFunnelData,
  MemberNote,
  CoordinatorTask,
  MemberTag,
  TagSummary,
  CrmAdmin,
  TimelineEntry,
  SeoAuditResult,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

function buildQuery<T extends object>(params: T): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export const adminDashboard = {
  getStats: () =>
    api.get<AdminDashboardStats>('/v2/admin/dashboard/stats'),

  getTrends: (months = 6) =>
    api.get<MonthlyTrend[]>(`/v2/admin/dashboard/trends?months=${months}`),

  getActivity: (page = 1, limit = 20) =>
    api.get<ActivityLogEntry[]>(
      `/v2/admin/dashboard/activity?page=${page}&limit=${limit}`
    ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────

export const adminUsers = {
  list: (params: UserListParams = {}) =>
    api.get<PaginatedResponse<AdminUser>>(
      `/v2/admin/users${buildQuery(params)}`
    ),

  get: (id: number) =>
    api.get<AdminUserDetail>(`/v2/admin/users/${id}`),

  create: (data: CreateUserPayload) =>
    api.post<AdminUser>('/v2/admin/users', data),

  update: (id: number, data: UpdateUserPayload) =>
    api.put<AdminUser>(`/v2/admin/users/${id}`, data),

  delete: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/users/${id}`),

  approve: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/users/${id}/approve`),

  suspend: (id: number, reason?: string) =>
    api.post<{ success: boolean }>(`/v2/admin/users/${id}/suspend`, { reason }),

  ban: (id: number, reason?: string) =>
    api.post<{ success: boolean }>(`/v2/admin/users/${id}/ban`, { reason }),

  reactivate: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/users/${id}/reactivate`),

  reset2fa: (id: number, reason: string) =>
    api.post<{ success: boolean }>(`/v2/admin/users/${id}/reset-2fa`, { reason }),

  addBadge: (userId: number, badgeSlug: string) =>
    api.post<{ success: boolean }>(`/v2/admin/users/${userId}/badges`, { badge_slug: badgeSlug }),

  removeBadge: (userId: number, badgeId: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/users/${userId}/badges/${badgeId}`),

  recheckAllBadges: () =>
    api.post<{ success: boolean }>('/v2/admin/users/badges/recheck-all'),

  impersonate: (userId: number) =>
    api.post<{ token: string }>(`/v2/admin/users/${userId}/impersonate`),
  setSuperAdmin: (userId: number, grant: boolean) =>
    api.put<{ success: boolean }>(`/v2/admin/users/${userId}/super-admin`, { grant }),
  setGlobalSuperAdmin: (userId: number, grant: boolean) =>
    api.put<{ success: boolean }>(`/v2/admin/users/${userId}/global-super-admin`, { grant }),

  recheckUserBadges: (userId: number) =>
    api.post<{ rechecked: boolean; user_id: number; badges: import('./types').AdminBadge[] }>(`/v2/admin/users/${userId}/badges/recheck`),

  getConsents: (userId: number) =>
    api.get<import('./types').UserConsent[]>(`/v2/admin/users/${userId}/consents`),

  setPassword: (userId: number, password: string) =>
    api.post<{ success: boolean }>(`/v2/admin/users/${userId}/password`, { password }),

  sendPasswordReset: (userId: number) =>
    api.post<{ success: boolean }>(`/v2/admin/users/${userId}/send-password-reset`),

  sendVerificationEmail: (userId: number) =>
    api.post<{ sent: boolean; already_verified?: boolean; id: number }>(`/v2/admin/users/${userId}/send-verification-email`),

  sendWelcomeEmail: (userId: number) =>
    api.post<{ success: boolean }>(`/v2/admin/users/${userId}/send-welcome-email`),

  importUsers: (file: File, options?: { default_role?: string }) => {
    const formData = new FormData();
    formData.append('csv_file', file);
    if (options?.default_role) formData.append('default_role', options.default_role);
    return api.upload<{ imported: number; skipped: number; errors: string[]; total_rows: number }>('/v2/admin/users/import', formData);
  },

  downloadImportTemplate: () => {
    const baseUrl = import.meta.env.VITE_API_BASE || '/api';
    window.open(`${baseUrl}/v2/admin/users/import/template`, '_blank');
  },

  bulkApprove: (userIds: number[]) =>
    api.post<BulkActionResult>('/v2/admin/users/bulk-approve', { user_ids: userIds }),

  bulkSuspend: (userIds: number[], reason?: string) =>
    api.post<BulkActionResult>('/v2/admin/users/bulk-suspend', { user_ids: userIds, reason }),
};

// Shared bulk-action response shape
export interface BulkActionResult {
  success: number;
  failed: number;
  skipped_ids?: number[];
  errors?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Config (Features & Modules) — V2 API already exists
// ─────────────────────────────────────────────────────────────────────────────

export interface EventConfiguration {
  creation_role: 'members' | 'staff' | 'admins';
  moderation_required: boolean;
  registration_enabled: boolean;
  default_capacity: number;
  guest_registration_enabled: boolean;
  waitlist_enabled: boolean;
  timed_waitlist_offers_enabled: boolean;
  recurrence_enabled: boolean;
  reminders_enabled: boolean;
  organizer_broadcasts_enabled: boolean;
  offline_checkin_enabled: boolean;
  calendar_feeds_enabled: boolean;
  federation_sharing_enabled: boolean;
  safety_enforcement_mode: 'off' | 'shadow' | 'enforce' | null;
  notification_delivery_mode: 'direct' | 'shadow_outbox' | 'outbox_authoritative' | null;
  /** Monthly treasury ceiling for attendance rewards, in credits. Null = uncapped. */
  attendance_credit_monthly_cap: number | null;
}

export interface EventConfigurationCapabilities {
  recurrence_v2: boolean;
  rolling_recurrence: boolean;
  recurrence_definition_blueprints: boolean;
  timed_waitlist_offers: boolean;
  attendance_credits: boolean;
  optional_analytics_capture: boolean;
  registration_forms: boolean;
  invitation_campaigns: boolean;
  ticketing: boolean;
  agenda: boolean;
  offline_sync: boolean;
  broadcast_delivery: boolean;
  safety_evidence: boolean;
  federation_delivery: boolean;
  notification_consumer: boolean;
  notification_delivery: { resolved_mode: string; source: string; global_configuration_valid: boolean; tenant_configuration_valid: boolean | null };
  safety: { resolved_mode: string; source: string; configuration_valid: boolean; tenant_configuration_valid: boolean | null };
}

export interface EventConfigurationResponse {
  config: EventConfiguration;
  defaults: EventConfiguration;
  version: number;
  capabilities: EventConfigurationCapabilities;
  impact: {
    active_registrations: number;
    active_waitlist_entries: number;
    pending_reminders: number;
    active_calendar_tokens: number;
    shared_events: number;
    scheduled_broadcasts: number;
  };
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export interface EventConfigurationAuditEntry {
  id: number;
  action: 'events_configuration_updated' | 'events_configuration_defaults_restored';
  actor_id: number | null;
  actor_name: string | null;
  reason: string | null;
  version: number;
  changes: Record<string, { from: unknown; to: unknown }>;
  created_at: string;
}

export interface PlatformCapabilityRow {
  capability: string;
  type: 'bool' | 'enum';
  values: string[];
  value: string;
  source: 'platform_override' | 'environment';
  env_value: string;
}

export const adminConfig = {
  get: () =>
    api.get<TenantConfig>('/v2/admin/config'),

  // Platform rollout switches (platform super-admin only). These set the
  // ceiling each community's own event settings sit under.
  getPlatformCapabilities: () =>
    api.get<{ capabilities: PlatformCapabilityRow[] }>('/v2/admin/super/platform-capabilities'),

  setPlatformCapability: (capability: string, value: string | boolean, reason?: string) =>
    api.put<{ capabilities: PlatformCapabilityRow[] }>('/v2/admin/super/platform-capabilities', {
      capability,
      value,
      ...(reason ? { reason } : {}),
    }),

  clearPlatformCapability: (capability: string) =>
    api.put<{ capabilities: PlatformCapabilityRow[] }>('/v2/admin/super/platform-capabilities', {
      capability,
      clear: true,
    }),

  updateFeature: (feature: string, enabled: boolean, options?: { confirmDisable?: boolean }) =>
    api.put<{ success: boolean }>('/v2/admin/config/features', {
      feature,
      enabled,
      ...(options?.confirmDisable ? { confirm_disable: true } : {}),
    }),

  updateModule: (module: string, enabled: boolean) =>
    api.put<{ success: boolean }>('/v2/admin/config/modules', { module, enabled }),

  getEventConfig: () =>
    api.get<EventConfigurationResponse>('/v2/admin/config/events'),

  getEventConfigAuditLog: () =>
    api.get<EventConfigurationAuditEntry[]>('/v2/admin/config/events/audit-log'),

  updateEventConfig: (version: number, settings: EventConfiguration, reason: string, confirmDisruptive = false) =>
    api.put<EventConfigurationResponse>('/v2/admin/config/events', { version, settings, reason, confirm_disruptive: confirmDisruptive }),

  restoreEventConfigDefaults: (version: number, reason: string, keys?: Array<keyof EventConfiguration>) =>
    api.post<EventConfigurationResponse>('/v2/admin/config/events/restore-defaults', { version, reason, ...(keys ? { keys } : {}) }),

  getCacheStats: () =>
    api.get<CacheStats>('/v2/admin/cache/stats'),

  clearCache: (type: 'all' | 'tenant' = 'tenant') =>
    api.post<{ success: boolean }>('/v2/admin/cache/clear', { type }),

  getJobs: () =>
    api.get<BackgroundJob[]>('/v2/admin/background-jobs'),

  runJob: (jobId: string) =>
    api.post<{ success: boolean }>(`/v2/admin/background-jobs/${jobId}/run`),

  getLanguageConfig: () =>
    api.get<{ default_language: string; supported_languages: string[] }>(
      '/v2/admin/config/languages'
    ),

  updateLanguageConfig: (config: {
    default_language?: string;
    supported_languages?: string[];
  }) =>
    api.put<{ default_language: string; supported_languages: string[] }>(
      '/v2/admin/config/languages',
      config
    ),

  getGroupConfig: () =>
    api.get<{ config: Record<string, boolean | number | string>; defaults: Record<string, boolean | number | string> }>(
      '/v2/admin/config/groups'
    ),

  updateGroupConfig: (key: string, value: boolean | number | string) =>
    api.put<{ key: string; value: boolean | number | string }>(
      '/v2/admin/config/groups',
      { key, value }
    ),

  updateGroupConfigBulk: (settings: Record<string, boolean | number | string>) =>
    api.put<{ updated: Record<string, boolean | number | string> }>(
      '/v2/admin/config/groups/bulk',
      { settings }
    ),

  getListingConfig: () =>
    api.get<{ config: Record<string, boolean | number | string>; defaults: Record<string, boolean | number | string> }>(
      '/v2/admin/config/listings'
    ),

  updateListingConfig: (key: string, value: boolean | number | string) =>
    api.put<{ key: string; value: boolean | number | string }>(
      '/v2/admin/config/listings',
      { key, value }
    ),

  updateListingConfigBulk: (settings: Record<string, boolean | number | string>) =>
    api.put<{ updated: Record<string, boolean | number | string> }>(
      '/v2/admin/config/listings/bulk',
      { settings }
    ),

  getVolunteeringConfig: () =>
    api.get<{ config: Record<string, boolean | number | string>; defaults: Record<string, boolean | number | string> }>(
      '/v2/admin/config/volunteering'
    ),

  updateVolunteeringConfigBulk: (settings: Record<string, boolean | number | string>) =>
    api.put<{ updated: Record<string, boolean | number | string> }>(
      '/v2/admin/config/volunteering/bulk',
      { settings }
    ),

  getJobConfig: () =>
    api.get<{ config: Record<string, boolean | number | string>; defaults: Record<string, boolean | number | string> }>(
      '/v2/admin/config/jobs'
    ),

  updateJobConfigBulk: (settings: Record<string, boolean | number | string>) =>
    api.put<{ updated: Record<string, boolean | number | string> }>(
      '/v2/admin/config/jobs/bulk',
      { settings }
    ),

  getPodcastConfig: () =>
    api.get<{ config: Record<string, boolean | number | string>; defaults: Record<string, boolean | number | string> }>(
      '/v2/admin/config/podcasts'
    ),

  updatePodcastConfigBulk: (settings: Record<string, boolean | number | string>) =>
    api.put<{ updated: Record<string, boolean | number | string> }>(
      '/v2/admin/config/podcasts/bulk',
      { settings }
    ),

  getIdentityConfig: () =>
    api.get<{ config: Record<string, boolean | number | string>; defaults: Record<string, boolean | number | string> }>(
      '/v2/admin/config/identity'
    ),

  updateIdentityConfigBulk: (settings: Record<string, boolean | number | string>) =>
    api.put<{ updated: Record<string, boolean | number | string> }>(
      '/v2/admin/config/identity/bulk',
      { settings }
    ),

  getAuthenticationConfig: () =>
    api.get<{ config: Record<string, boolean | number | string>; defaults: Record<string, boolean | number | string> }>(
      '/v2/admin/config/authentication'
    ),

  updateAuthenticationConfigBulk: (settings: Record<string, boolean | number | string>) =>
    api.put<{ updated: Record<string, boolean | number | string> }>(
      '/v2/admin/config/authentication/bulk',
      { settings }
    ),

  // Translation config (INT9)
  getTranslationConfig: () =>
    api.get<{ config: Record<string, boolean | number | string>; defaults: Record<string, boolean | number | string> }>(
      '/v2/admin/config/translation'
    ),

  updateTranslationConfig: (key: string, value: boolean | number | string) =>
    api.put<{ key: string; value: boolean | number | string }>(
      '/v2/admin/config/translation',
      { key, value }
    ),

  // Translation glossary (INT10)
  getGlossary: (language?: string) =>
    api.get<{ items: Array<{ id: number; source_term: string; target_term: string; target_language: string; is_active: boolean }>; total: number }>(
      '/v2/admin/translation/glossary' + (language ? `?language=${language}` : '')
    ),

  createGlossaryEntry: (sourceTerm: string, targetTerm: string, targetLanguage: string) =>
    api.post<{ id: number }>(
      '/v2/admin/translation/glossary',
      { source_term: sourceTerm, target_term: targetTerm, target_language: targetLanguage }
    ),

  deleteGlossaryEntry: (id: number) =>
    api.delete<{ deleted: boolean }>(
      `/v2/admin/translation/glossary/${id}`
    ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Event attendance rewards (treasury mint) — per-event amount + claims ledger
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminAttendanceRewardInfo {
  event_id: number;
  attendance_credit_amount: number | null;
  ceiling: number;
  /** Platform env mode — 'treasury' when minting is possible, 'off' otherwise. */
  mode: string;
  claims: Array<{ status: string; count: number; total_amount: number }>;
}

export interface AdminAttendanceClaim {
  id: number;
  event_id: number;
  event_title: string | null;
  user_id: number;
  member_name: string | null;
  claim_type: 'attendance_reward' | 'attendance_reward_reversal';
  amount: number;
  status: 'pending' | 'completed' | 'failed' | 'reversed';
  failure_code: string | null;
  reversal_code: string | null;
  transaction_id: number | null;
  parent_claim_id: number | null;
  created_at: string;
  completed_at: string | null;
  failed_at: string | null;
  reversed_at: string | null;
}

export interface AdminAttendanceClaimsPage {
  claims: AdminAttendanceClaim[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
}

export const adminEventRewards = {
  getReward: (eventId: number) =>
    api.get<AdminAttendanceRewardInfo>(`/v2/admin/events/${eventId}/attendance-reward`),

  setReward: (eventId: number, amount: number | null) =>
    api.put<{ event_id: number; attendance_credit_amount: number | null; ceiling: number }>(
      `/v2/admin/events/${eventId}/attendance-reward`,
      { amount },
    ),

  listClaims: (params: {
    event_id?: number;
    status?: AdminAttendanceClaim['status'];
    claim_type?: AdminAttendanceClaim['claim_type'];
    from?: string;
    to?: string;
    page?: number;
    per_page?: number;
  } = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && `${value}` !== '') query.set(key, `${value}`);
    });
    const suffix = query.toString();
    return api.get<AdminAttendanceClaimsPage>(
      `/v2/admin/events/attendance-claims${suffix ? `?${suffix}` : ''}`,
    );
  },

  retryClaim: (claimId: number) =>
    api.post<{ status: string; claim_id: number | null; transaction_id: number | null }>(
      `/v2/admin/events/attendance-claims/${claimId}/retry`,
    ),

  reverseClaim: (claimId: number, reason: string) =>
    api.post<{ status: string; claim_id: number | null; transaction_id: number | null }>(
      `/v2/admin/events/attendance-claims/${claimId}/reverse`,
      { reason },
    ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Listings
// ─────────────────────────────────────────────────────────────────────────────

export const adminListings = {
  list: (params: { page?: number; status?: string; type?: string; search?: string } = {}) =>
    api.get<PaginatedResponse<AdminListing>>(
      `/v2/admin/listings${buildQuery(params)}`
    ),

  approve: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/listings/${id}/approve`),

  reject: (id: number, reason?: string) =>
    api.post<{ success: boolean }>(`/v2/admin/listings/${id}/reject`, reason ? { reason } : {}),

  feature: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/listings/${id}/feature`),

  unfeature: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/listings/${id}/feature`),

  delete: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/listings/${id}`),

  // Featured listings
  getFeatured: () =>
    api.get<FeaturedListing[]>('/v2/admin/listings/featured'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────────

export const adminCategories = {
  list: (params: { type?: string } = {}) =>
    api.get<AdminCategory[]>(`/v2/admin/categories${buildQuery(params)}`),

  create: (data: { name: string; color?: string; type?: string }) =>
    api.post<AdminCategory>('/v2/admin/categories', data),

  update: (id: number, data: { name?: string; color?: string; type?: string }) =>
    api.put<AdminCategory>(`/v2/admin/categories/${id}`, data),

  delete: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/categories/${id}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Attributes
// ─────────────────────────────────────────────────────────────────────────────

export const adminAttributes = {
  list: () =>
    api.get<AdminAttribute[]>('/v2/admin/attributes'),

  create: (data: { name: string; type?: string; category_id?: number | null }) =>
    api.post<AdminAttribute>('/v2/admin/attributes', data),

  update: (id: number, data: { name?: string; type?: string; category_id?: number | null; is_active?: boolean }) =>
    api.put<AdminAttribute>(`/v2/admin/attributes/${id}`, data),

  delete: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/attributes/${id}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Gamification
// ─────────────────────────────────────────────────────────────────────────────

export const adminGamification = {
  getStats: () =>
    api.get<GamificationStats>('/v2/admin/gamification/stats'),

  recheckAll: () =>
    api.post<{ success: boolean }>('/v2/admin/gamification/recheck-all'),

  bulkAward: (badgeSlug: string, userIds: number[]) =>
    api.post<{ success: boolean; awarded: number }>('/v2/admin/gamification/bulk-award', { badge_slug: badgeSlug, user_ids: userIds }),

  listCampaigns: () =>
    api.get<Campaign[]>('/v2/admin/gamification/campaigns'),

  createCampaign: (data: Partial<Campaign>) =>
    api.post<Campaign>('/v2/admin/gamification/campaigns', data),

  updateCampaign: (id: number, data: Partial<Campaign>) =>
    api.put<Campaign>(`/v2/admin/gamification/campaigns/${id}`, data),

  deleteCampaign: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/gamification/campaigns/${id}`),

  listBadges: () =>
    api.get<BadgeDefinition[]>('/v2/admin/gamification/badges'),

  createBadge: (data: { name: string; slug?: string; description: string; icon?: string; category?: string; xp?: number; is_active?: boolean }) =>
    api.post<BadgeDefinition>('/v2/admin/gamification/badges', data),

  deleteBadge: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/gamification/badges/${id}`),

  getBadgeConfig: () =>
    api.get<BadgeConfigEntry[]>('/v2/admin/gamification/badge-config'),

  updateBadgeConfig: (badgeKey: string, data: Partial<BadgeConfigUpdate>) =>
    api.put<{ success: boolean }>(`/v2/admin/gamification/badge-config/${badgeKey}`, data),

  resetBadgeConfig: (badgeKey: string) =>
    api.post<{ success: boolean }>(`/v2/admin/gamification/badge-config/${badgeKey}/reset`),

  listChallenges: (params: { limit?: number; offset?: number; challenge_type?: string; is_active?: boolean } = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && `${value}` !== '') query.set(key, `${value}`);
    });
    const suffix = query.toString();
    return api.get<AdminChallengesPage>(`/v2/admin/gamification/challenges${suffix ? `?${suffix}` : ''}`);
  },

  createChallenge: (data: AdminChallengePayload) =>
    api.post<AdminChallenge>('/v2/admin/gamification/challenges', data),

  updateChallenge: (id: number, data: Partial<AdminChallengePayload>) =>
    api.put<AdminChallenge>(`/v2/admin/gamification/challenges/${id}`, data),

  deleteChallenge: (id: number) =>
    api.delete<{ deleted: boolean }>(`/v2/admin/gamification/challenges/${id}`),
};

export interface AdminChallenge {
  id: number;
  tenant_id?: number;
  title: string;
  description: string | null;
  challenge_type: 'daily' | 'weekly' | 'monthly' | 'special';
  action_type: string;
  target_count: number;
  xp_reward: number;
  badge_reward: string | null;
  start_date: string;
  end_date: string;
  is_active: boolean | number;
  created_at?: string;
}

export interface AdminChallengePayload {
  title: string;
  description?: string | null;
  challenge_type: AdminChallenge['challenge_type'];
  action_type: string;
  target_count: number;
  xp_reward: number;
  badge_reward?: string | null;
  start_date: string;
  end_date: string;
  is_active?: boolean;
}

export interface AdminChallengesPage {
  challenges: AdminChallenge[];
  total: number;
  /** Only these action types ever progress — the form must not offer others. */
  supported_action_types: string[];
  challenge_types: Array<AdminChallenge['challenge_type']>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

export const adminMatching = {
  getConfig: () =>
    api.get<SmartMatchingConfig>('/v2/admin/matching/config'),

  updateConfig: (data: Partial<SmartMatchingConfig>) =>
    api.put<{ success: boolean }>('/v2/admin/matching/config', data),

  getMatchingStats: () =>
    api.get<unknown>('/v2/admin/matching/stats'),

  getApprovals: (params: { status?: string; page?: number } = {}) =>
    api.get<PaginatedResponse<MatchApproval>>(
      `/v2/admin/matching/approvals${buildQuery(params)}`
    ),

  getApproval: (id: number) =>
    api.get<MatchApprovalDetail>(`/v2/admin/matching/approvals/${id}`),

  getApprovalStats: (days = 30) =>
    api.get<MatchApprovalStats>(`/v2/admin/matching/approvals/stats?days=${days}`),

  approveMatch: (id: number, notes?: string) =>
    api.post<{ success: boolean }>(`/v2/admin/matching/approvals/${id}/approve`, { notes }),

  rejectMatch: (id: number, reason: string) =>
    api.post<{ success: boolean }>(`/v2/admin/matching/approvals/${id}/reject`, { reason }),

  clearCache: () =>
    api.post<{ success: boolean }>('/v2/admin/matching/cache/clear'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Timebanking
// ─────────────────────────────────────────────────────────────────────────────

export const adminTimebanking = {
  getStats: () =>
    api.get<TimebankingStats>('/v2/admin/timebanking/stats'),

  getAlerts: (params: { status?: string; page?: number } = {}) =>
    api.get<PaginatedResponse<FraudAlert>>(
      `/v2/admin/timebanking/alerts${buildQuery(params)}`
    ),

  updateAlertStatus: (id: number, status: string) =>
    api.put<{ success: boolean }>(`/v2/admin/timebanking/alerts/${id}`, { status }),

  adjustBalance: (userId: number, amount: number, reason: string) =>
    api.post<{ success: boolean }>('/v2/admin/timebanking/adjust-balance', { user_id: userId, amount, reason }),

  getOrgWallets: () =>
    api.get<OrgWallet[]>('/v2/admin/timebanking/org-wallets'),

  getCommunityFund: () =>
    api.get<CommunityFundBalance>('/v2/wallet/community-fund'),

  getCommunityFundTransactions: (params: { limit?: number; offset?: number } = {}) =>
    api.get<CommunityFundTransaction[]>(
      `/v2/wallet/community-fund/transactions${buildQuery(params)}`
    ),

  depositCommunityFund: (amount: number, description: string) =>
    api.post<{ balance: number }>('/v2/wallet/community-fund/deposit', { amount, description }),

  withdrawCommunityFund: (recipientId: number, amount: number, description: string) =>
    api.post<{ balance: number }>('/v2/wallet/community-fund/withdraw', {
      recipient_id: recipientId,
      amount,
      description,
    }),

  getUserReport: (params: { page?: number; search?: string } = {}) =>
    api.get<PaginatedResponse<UserFinancialReport>>(
      `/v2/admin/timebanking/user-report${buildQuery(params)}`
    ),

  getUserStatement: (params: { user_id: number; start_date?: string; end_date?: string }) =>
    api.get<{
      user: { id: number; first_name: string; last_name: string; email: string; balance: number };
      period: { start: string; end: string };
      summary: {
        total_transactions: number;
        hours_earned: number;
        hours_spent: number;
        net_change: number;
        current_balance: number;
      };
      transactions: Array<Record<string, unknown>>;
    }>(`/v2/admin/timebanking/user-statement${buildQuery(params)}`),

  downloadStatementCsv: async (userId: number, startDate?: string, endDate?: string) => {
    const params = buildQuery({
      user_id: userId,
      format: 'csv',
      start_date: startDate,
      end_date: endDate,
    });
    await api.download(`/v2/admin/timebanking/user-statement${params}`, {
      filename: `statement_${userId}_${new Date().toISOString().slice(0, 10)}.csv`,
    });
  },

  // Starting balance grants
  getGrants: (params: { page?: number; search?: string } = {}) =>
    api.get<PaginatedResponse<WalletGrant>>(
      `/v2/admin/wallet/grants${buildQuery(params)}`
    ),

  grantCredits: (data: { user_id: number; amount: number; reason: string }) =>
    api.post<{ success: boolean }>('/v2/admin/wallet/grant', data),
};

// ─────────────────────────────────────────────────────────────────────────────
// Blog
// ─────────────────────────────────────────────────────────────────────────────

export const adminBlog = {
  list: (params: { page?: number; status?: string; search?: string } = {}) =>
    api.get<PaginatedResponse<AdminBlogPost>>(
      `/v2/admin/blog${buildQuery(params)}`
    ),

  get: (id: number) =>
    api.get<AdminBlogPost>(`/v2/admin/blog/${id}`),

  create: (data: CreateBlogPostPayload) =>
    api.post<AdminBlogPost>('/v2/admin/blog', data),

  update: (id: number, data: UpdateBlogPostPayload) =>
    api.put<AdminBlogPost>(`/v2/admin/blog/${id}`, data),

  delete: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/blog/${id}`),

  toggleStatus: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/blog/${id}/toggle-status`),

  bulkDelete: (postIds: number[]) =>
    api.post<BulkActionResult>('/v2/admin/blog/bulk-delete', { post_ids: postIds }),

  bulkPublish: (postIds: number[]) =>
    api.post<BulkActionResult>('/v2/admin/blog/bulk-publish', { post_ids: postIds }),

  uploadFeaturedImage: (file: File, onUploadProgress?: (percent: number) => void) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'blog');
    return api.upload<{ url: string; path: string }>(
      '/v2/upload',
      formData,
      'file',
      onUploadProgress ? { onUploadProgress } : undefined,
    );
  },
};

export const adminMarketplace = {
  bulkReject: (listingIds: number[], reason: string) =>
    api.post<BulkActionResult>('/v2/admin/marketplace/bulk-reject', {
      listing_ids: listingIds,
      reason,
    }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Broker Controls
// ─────────────────────────────────────────────────────────────────────────────

export const adminBroker = {
  getDashboard: () =>
    api.get<BrokerDashboardStats>('/v2/admin/broker/dashboard'),

  getExchanges: (params: { page?: number; status?: string } = {}) =>
    api.get<PaginatedResponse<ExchangeRequest>>(
      `/v2/admin/broker/exchanges${buildQuery(params)}`
    ),

  approveExchange: (id: number, notes?: string) =>
    api.post<{ success: boolean }>(`/v2/admin/broker/exchanges/${id}/approve`, { notes }),

  rejectExchange: (id: number, reason: string) =>
    api.post<{ success: boolean }>(`/v2/admin/broker/exchanges/${id}/reject`, { reason }),

  getRiskTags: (params: { risk_level?: string } = {}) =>
    api.get<RiskTag[]>(`/v2/admin/broker/risk-tags${buildQuery(params)}`),

  getMessages: (params: { page?: number; filter?: string } = {}) =>
    api.get<PaginatedResponse<BrokerMessage>>(
      `/v2/admin/broker/messages${buildQuery(params)}`
    ),

  getUnreviewedCount: () =>
    api.get<{ count: number }>('/v2/admin/broker/messages/unreviewed-count'),

  reviewMessage: (id: number, notes?: string) =>
    api.post<{ success: boolean }>(`/v2/admin/broker/messages/${id}/review`, notes ? { notes } : {}),

  getMonitoring: () =>
    api.get<MonitoredUser[]>('/v2/admin/broker/monitoring'),

  flagMessage: (id: number, reason: string, severity: 'info' | 'warning' | 'concern' | 'urgent') =>
    api.post<{ success: boolean }>(`/v2/admin/broker/messages/${id}/flag`, { reason, severity }),

  setMonitoring: (userId: number, data: { under_monitoring: boolean; reason?: string; messaging_disabled?: boolean; expires_days?: number }) =>
    api.post<{ success: boolean }>(`/v2/admin/broker/monitoring/${userId}`, data),

  saveRiskTag: (listingId: number, data: {
    risk_level: 'low' | 'medium' | 'high' | 'critical';
    risk_category: string;
    risk_notes?: string;
    member_visible_notes?: string;
    requires_approval?: boolean;
    insurance_required?: boolean;
  }) => api.post<{ success: boolean }>(`/v2/admin/broker/risk-tags/${listingId}`, data),

  removeRiskTag: (listingId: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/broker/risk-tags/${listingId}`),

  getConfiguration: () =>
    api.get<BrokerConfig>('/v2/admin/broker/configuration'),

  saveConfiguration: (config: Partial<BrokerConfig>) =>
    api.post<BrokerConfig>('/v2/admin/broker/configuration', config),

  showExchange: (id: number) =>
    api.get<ExchangeDetail>(`/v2/admin/broker/exchanges/${id}`),

  showMessage: (id: number) =>
    api.get<BrokerMessageDetail>(`/v2/admin/broker/messages/${id}`),

  approveMessage: (id: number, notes?: string) =>
    api.post<{ success: boolean }>(`/v2/admin/broker/messages/${id}/approve`, { notes }),

  getArchives: (params: { page?: number; decision?: string; search?: string; from?: string; to?: string } = {}) =>
    api.get<PaginatedResponse<BrokerArchive>>(
      `/v2/admin/broker/archives${buildQuery(params)}`
    ),

  showArchive: (id: number) =>
    api.get<BrokerArchiveDetail>(`/v2/admin/broker/archives/${id}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Groups
// ─────────────────────────────────────────────────────────────────────────────

export const adminGroups = {
  list: (params: { page?: number; per_page?: number; status?: GroupStatus; search?: string } = {}) =>
    api.get<PaginatedResponse<AdminGroup>>(
      `/v2/admin/groups${buildQuery(params)}`
    ),

  getAnalytics: () =>
    api.get<GroupAnalyticsData>('/v2/admin/groups/analytics'),

  getApprovals: () =>
    api.get<GroupApproval[]>('/v2/admin/groups/approvals'),

  approveMember: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/groups/approvals/${id}/approve`),

  rejectMember: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/groups/approvals/${id}/reject`),

  getModeration: () =>
    api.get<GroupModerationItem[]>('/v2/admin/groups/moderation'),

  updateStatus: (id: number, status: GroupStatus) =>
    api.put<{ success: boolean }>(`/v2/admin/groups/${id}/status`, { status }),

  delete: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/groups/${id}`),

  // Group types
  getGroupTypes: () =>
    api.get<GroupType[]>('/v2/admin/groups/types'),

  createGroupType: (data: Partial<GroupType>) =>
    api.post<GroupType>('/v2/admin/groups/types', data),

  updateGroupType: (id: number, data: Partial<GroupType>) =>
    api.put<GroupType>(`/v2/admin/groups/types/${id}`, data),

  deleteGroupType: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/groups/types/${id}`),

  // Group detail
  getGroup: (id: number) =>
    api.get<AdminGroup>(`/v2/admin/groups/${id}`),

  updateGroup: (id: number, data: Partial<Pick<AdminGroup, 'name' | 'description' | 'location' | 'visibility' | 'type_id' | 'is_featured' | 'federated_visibility' | 'primary_color' | 'accent_color' | 'cover_image_url'>>) =>
    api.put<AdminGroup>(`/v2/admin/groups/${id}`, data),

  getMembers: (groupId: number, params?: { role?: string; limit?: number; offset?: number }) =>
    api.get<GroupMember[]>(`/v2/admin/groups/${groupId}/members${buildQuery(params || {})}`),

  promoteMember: (groupId: number, userId: number) =>
    api.post<{ success: boolean }>(`/v2/admin/groups/${groupId}/members/${userId}/promote`, {}),

  demoteMember: (groupId: number, userId: number) =>
    api.post<{ success: boolean }>(`/v2/admin/groups/${groupId}/members/${userId}/demote`, {}),

  kickMember: (groupId: number, userId: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/groups/${groupId}/members/${userId}`),

  // Geocoding
  geocodeGroup: (groupId: number) =>
    api.post<{ success: boolean }>(`/v2/admin/groups/${groupId}/geocode`, {}),

  batchGeocode: () =>
    api.post<{ success: boolean; geocoded: number }>('/v2/admin/groups/batch-geocode', {}),

  // Recommendations
  getRecommendationData: (params?: { limit?: number; offset?: number }) =>
    api.get<{ recommendations: GroupRecommendation[]; stats: { total: number; avg_score: number; join_rate: number } }>(`/v2/admin/groups/recommendations${buildQuery(params || {})}`),

  // Ranking
  getFeaturedGroups: () =>
    api.get<FeaturedGroup[]>('/v2/admin/groups/featured'),

  updateFeaturedGroups: () =>
    api.post<{ success: boolean }>('/v2/admin/groups/featured/update', {}),

  toggleFeatured: (groupId: number) =>
    api.put<{ success: boolean }>(`/v2/admin/groups/${groupId}/toggle-featured`, {}),

  // Tags
  getTags: (params: { q?: string; limit?: number } = {}) =>
    api.get<GroupTag[]>(`/v2/admin/group-tags${buildQuery(params)}`),

  createTag: (data: { name: string; color?: string | null }) =>
    api.post<GroupTag>('/v2/admin/group-tags', data),

  deleteTag: (tagId: number) =>
    api.delete<{ message: string }>(`/v2/admin/group-tags/${tagId}`),

  // Collections
  getCollections: () =>
    api.get<GroupCollection[]>('/v2/admin/group-collections'),

  createCollection: (data: { name: string; description?: string | null; image_url?: string | null; sort_order?: number }) =>
    api.post<{ id: number }>('/v2/admin/group-collections', data),

  updateCollection: (id: number, data: Partial<{ name: string; description: string | null; image_url: string | null; sort_order: number; is_active: boolean }>) =>
    api.put<{ message: string }>(`/v2/admin/group-collections/${id}`, data),

  deleteCollection: (id: number) =>
    api.delete<{ message: string }>(`/v2/admin/group-collections/${id}`),

  setCollectionGroups: (id: number, groupIds: number[]) =>
    api.put<{ message: string }>(`/v2/admin/group-collections/${id}/groups`, { group_ids: groupIds }),

  // Auto-assign rules
  getAutoAssignRules: () =>
    api.get<GroupAutoAssignRule[]>('/v2/admin/group-auto-assign-rules'),

  createAutoAssignRule: (data: { group_id: number; rule_type: GroupAutoAssignRuleType; rule_value: string }) =>
    api.post<{ id: number }>('/v2/admin/group-auto-assign-rules', data),

  updateAutoAssignRule: (id: number, data: Partial<Pick<GroupAutoAssignRule, 'group_id' | 'rule_type' | 'rule_value' | 'is_active'>>) =>
    api.put<{ id: number }>(`/v2/admin/group-auto-assign-rules/${id}`, data),

  deleteAutoAssignRule: (id: number) =>
    api.delete<{ message: string }>(`/v2/admin/group-auto-assign-rules/${id}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Residency Verification (AG43 — caring_community)
// ─────────────────────────────────────────────────────────────────────────────

export const adminResidency = {
  list: (status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') =>
    api.get<{ items: ResidencyVerification[] }>(`/v2/admin/residency-verifications${buildQuery({ status })}`),

  attest: (id: number, decision: 'approved' | 'rejected', reason?: string) =>
    api.post<{ status: string; verification: ResidencyVerification }>(
      `/v2/admin/residency-verifications/${id}/attest`,
      reason ? { decision, reason } : { decision }
    ),
};

// ─────────────────────────────────────────────────────────────────────────────
// System
// ─────────────────────────────────────────────────────────────────────────────

export const adminSystem = {
  getCronJobs: () =>
    api.get<CronJob[]>('/v2/admin/system/cron-jobs'),

  runCronJob: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/system/cron-jobs/${id}/run`),

  getActivityLog: (params: { page?: number; limit?: number } = {}) =>
    api.get<PaginatedResponse<ActivityLogEntry>>(
      `/v2/admin/system/activity-log${buildQuery(params)}`
    ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Enterprise
// ─────────────────────────────────────────────────────────────────────────────

export const adminEnterprise = {
  getDashboard: () =>
    api.get<EnterpriseDashboardStats>('/v2/admin/enterprise/dashboard'),

  getRoles: () =>
    api.get<Role[]>('/v2/admin/enterprise/roles'),

  getRole: (id: number) =>
    api.get<Role>(`/v2/admin/enterprise/roles/${id}`),

  createRole: (data: { name: string; description: string; permissions: string[] }) =>
    api.post<Role>('/v2/admin/enterprise/roles', data),

  updateRole: (id: number, data: Partial<Role>) =>
    api.put<Role>(`/v2/admin/enterprise/roles/${id}`, data),

  deleteRole: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/enterprise/roles/${id}`),

  getPermissions: () =>
    api.get<Record<string, string[]>>('/v2/admin/enterprise/permissions'),

  getGdprDashboard: () =>
    api.get<GdprDashboardStats>('/v2/admin/enterprise/gdpr/dashboard'),

  getGdprRequests: (params: { page?: number; status?: string } = {}) =>
    api.get<PaginatedResponse<GdprRequest>>(
      `/v2/admin/enterprise/gdpr/requests${buildQuery(params)}`
    ),

  updateGdprRequest: (id: number, data: { status: string; notes?: string }) =>
    api.put<{ success: boolean }>(`/v2/admin/enterprise/gdpr/requests/${id}`, data),

  getGdprConsents: () =>
    api.get<GdprConsent[]>('/v2/admin/enterprise/gdpr/consents'),

  getGdprBreaches: () =>
    api.get<GdprBreach[]>('/v2/admin/enterprise/gdpr/breaches'),

  createBreach: (data: { title: string; description?: string; severity?: string; affected_users?: number }) =>
    api.post<GdprBreach>('/v2/admin/enterprise/gdpr/breaches', data),

  getGdprAudit: (params: { page?: number; per_page?: number; action?: string; entity_type?: string; date_from?: string; date_to?: string; user_id?: number } = {}) =>
    api.get<PaginatedResponse<GdprAuditEntry>>(`/v2/admin/enterprise/gdpr/audit${buildQuery(params)}`),

  getGdprAuditExportUrl: (params: { action?: string; entity_type?: string; date_from?: string; date_to?: string; user_id?: number } = {}) =>
    `${API_BASE}/v2/admin/enterprise/gdpr/audit/export${buildQuery(params)}`,

  getMonitoring: () =>
    api.get<SystemHealth>('/v2/admin/enterprise/monitoring'),

  getHealthCheck: () =>
    api.get<HealthCheckResult>('/v2/admin/enterprise/monitoring/health'),

  getLogs: (params: { page?: number } = {}) =>
    api.get<PaginatedResponse<ErrorLogEntry>>(
      `/v2/admin/enterprise/monitoring/logs${buildQuery(params)}`
    ),

  getConfig: () =>
    api.get<Record<string, unknown>>('/v2/admin/enterprise/config'),

  updateConfig: (data: Record<string, unknown>) =>
    api.put<{ success: boolean }>('/v2/admin/enterprise/config', data),

  resetConfig: (keys?: string[]) =>
    api.post<{ success: boolean }>('/v2/admin/enterprise/config/reset', keys ? { keys } : {}),

  // GDPR Request Detail & Management
  getGdprRequest: (id: number) =>
    api.get<GdprRequestDetail>(`/v2/admin/enterprise/gdpr/requests/${id}`),

  createGdprRequest: (data: { user_id: number; type: string; priority?: string; notes?: string }) =>
    api.post<GdprRequest>('/v2/admin/enterprise/gdpr/requests', data),

  assignGdprRequest: (id: number, assignedTo: number) =>
    api.put<{ success: boolean }>(`/v2/admin/enterprise/gdpr/requests/${id}/assign`, { assigned_to: assignedTo }),

  addGdprRequestNote: (id: number, note: string) =>
    api.post<{ success: boolean }>(`/v2/admin/enterprise/gdpr/requests/${id}/notes`, { note }),

  generateGdprExport: (id: number) =>
    api.post<{ success: boolean; file_path?: string }>(`/v2/admin/enterprise/gdpr/requests/${id}/export`),

  // GDPR Consent Types
  getConsentTypes: () =>
    api.get<ConsentType[]>('/v2/admin/enterprise/gdpr/consent-types'),

  createConsentType: (data: Partial<ConsentType>) =>
    api.post<ConsentType>('/v2/admin/enterprise/gdpr/consent-types', data),

  updateConsentType: (id: number, data: Partial<ConsentType>) =>
    api.put<ConsentType>(`/v2/admin/enterprise/gdpr/consent-types/${id}`, data),

  deleteConsentType: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/enterprise/gdpr/consent-types/${id}`),

  getConsentTypeUsers: (slug: string, params: { page?: number; per_page?: number } = {}) =>
    api.get<PaginatedResponse<ConsentTypeUser>>(`/v2/admin/enterprise/gdpr/consent-types/${slug}/users${buildQuery(params)}`),

  exportConsentTypeUsers: (slug: string) =>
    `/v2/admin/enterprise/gdpr/consent-types/${slug}/export`,

  // GDPR Breach Detail
  getGdprBreach: (id: number) =>
    api.get<GdprBreachDetail>(`/v2/admin/enterprise/gdpr/breaches/${id}`),

  updateGdprBreach: (id: number, data: Partial<GdprBreachDetail>) =>
    api.put<{ success: boolean }>(`/v2/admin/enterprise/gdpr/breaches/${id}`, data),

  notifyDpa: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/enterprise/gdpr/breaches/${id}/notify-dpa`),

  // GDPR Statistics
  getGdprStatistics: () =>
    api.get<GdprStatistics>('/v2/admin/enterprise/gdpr/statistics'),

  // GDPR Trends (6-month history + period comparison)
  getGdprTrends: () =>
    api.get<GdprTrendData>('/v2/admin/enterprise/gdpr/trends'),

  // Monitoring — Log Files
  getLogFiles: () =>
    api.get<LogFile[]>('/v2/admin/enterprise/monitoring/log-files'),

  getLogFile: (filename: string, params: { lines?: number; level?: string } = {}) =>
    api.get<LogFileContent>(`/v2/admin/enterprise/monitoring/log-files/${filename}${buildQuery(params)}`),

  clearLogFile: (filename: string) =>
    api.delete<{ success: boolean }>(`/v2/admin/enterprise/monitoring/log-files/${filename}`),

  // Monitoring — Requirements & Health History
  getSystemRequirements: () =>
    api.get<SystemRequirements>('/v2/admin/enterprise/monitoring/requirements'),

  getHealthHistory: () =>
    api.get<HealthCheckHistoryEntry[]>('/v2/admin/enterprise/monitoring/health-history'),

};

// ─────────────────────────────────────────────────────────────────────────────
// Legal Documents
// ─────────────────────────────────────────────────────────────────────────────

export const adminLegalDocs = {
  list: () =>
    api.get<LegalDocument[]>('/v2/admin/legal-documents'),

  get: (id: number) =>
    api.get<LegalDocument>(`/v2/admin/legal-documents/${id}`),

  create: (data: {
    title: string;
    type: string;
    requires_acceptance?: boolean;
    acceptance_required_for?: string;
    notify_on_update?: boolean;
    is_active?: boolean;
  }) =>
    api.post<LegalDocument>('/v2/admin/legal-documents', data),

  update: (id: number, data: {
    title?: string;
    requires_acceptance?: boolean;
    acceptance_required_for?: string;
    notify_on_update?: boolean;
    is_active?: boolean;
  }) =>
    api.put<LegalDocument>(`/v2/admin/legal-documents/${id}`, data),

  delete: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/legal-documents/${id}`),

  // Version Management
  getVersions: (docId: number) =>
    api.get<LegalDocumentVersion[]>(`/v2/admin/legal-documents/${docId}/versions`),

  compareVersions: (docId: number, v1: number, v2: number) =>
    api.get<VersionComparison>(`/v2/admin/legal-documents/${docId}/versions/compare${buildQuery({ v1, v2 })}`),

  createVersion: (docId: number, data: { version_number: string; version_label?: string; content: string; summary_of_changes?: string; effective_date: string; is_draft?: boolean }) =>
    api.post<{ id: number }>(`/v2/admin/legal-documents/${docId}/versions`, data),

  updateVersion: (docId: number, versionId: number, data: { version_number?: string; version_label?: string; content?: string; summary_of_changes?: string; effective_date?: string }) =>
    api.put<{ updated: boolean }>(`/v2/admin/legal-documents/${docId}/versions/${versionId}`, data),

  deleteVersion: (docId: number, versionId: number) =>
    api.delete<{ deleted: boolean }>(`/v2/admin/legal-documents/${docId}/versions/${versionId}`),

  publishVersion: (versionId: number) =>
    api.post<{ published: boolean }>(`/v2/admin/legal-documents/versions/${versionId}/publish`, {}),

  // Compliance & Acceptance Tracking
  getComplianceStats: (docId?: number) =>
    api.get<ComplianceStats>(`/v2/admin/legal-documents/compliance${buildQuery({ doc_id: docId })}`),

  getAcceptances: (versionId: number, limit = 50, offset = 0) =>
    api.get<UserAcceptance[]>(`/v2/admin/legal-documents/versions/${versionId}/acceptances${buildQuery({ limit, offset })}`),

  exportAcceptances: (docId: number, startDate?: string, endDate?: string) => {
    const query = buildQuery({ start_date: startDate, end_date: endDate });
    return api.get<{ data: unknown }>(`/v2/admin/legal-documents/${docId}/acceptances/export${query}`);
  },

  // Notifications
  notifyUsers: (docId: number, versionId: number, notify: { target: 'all' | 'non_accepted' }) =>
    api.post<{ notified: boolean }>(`/v2/admin/legal-documents/${docId}/versions/${versionId}/notify`, notify),

  getUsersPendingCount: (docId: number, versionId: number) =>
    api.get<{ count: number }>(`/v2/admin/legal-documents/${docId}/versions/${versionId}/pending-count`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Newsletters
// ─────────────────────────────────────────────────────────────────────────────

export const adminNewsletters = {
  list: (params: { page?: number; status?: string } = {}) =>
    api.get<PaginatedResponse<Newsletter>>(`/v2/admin/newsletters${buildQuery(params)}`),

  get: (id: number) => api.get<Newsletter & Record<string, unknown>>(`/v2/admin/newsletters/${id}`),

  create: (data: Record<string, unknown>) =>
    api.post<Newsletter>('/v2/admin/newsletters', data),

  update: (id: number, data: Record<string, unknown>) =>
    api.put<Newsletter>(`/v2/admin/newsletters/${id}`, data),

  delete: (id: number) => api.delete<{ success: boolean }>(`/v2/admin/newsletters/${id}`),

  getSubscribers: (params?: { page?: number; per_page?: number; status?: string; search?: string }) =>
    api.get<PaginatedResponse<{ id: number; email: string; first_name?: string; last_name?: string; status: string; subscribed_at: string }>>(`/v2/admin/newsletters/subscribers${buildQuery(params || {})}`),

  addSubscriber: (data: { email: string; first_name?: string; last_name?: string }) =>
    api.post<{ success: boolean }>('/v2/admin/newsletters/subscribers', data),

  removeSubscriber: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/newsletters/subscribers/${id}`),

  importSubscribers: (rows: Array<{ email: string; first_name?: string; last_name?: string }>) =>
    api.post<{ imported: number; skipped: number; errors: string[] }>('/v2/admin/newsletters/subscribers/import', { rows }),

  exportSubscribers: () =>
    api.get<{ data: unknown }>('/v2/admin/newsletters/subscribers/export'),

  syncMembers: () =>
    api.post<{ synced: number }>('/v2/admin/newsletters/subscribers/sync', {}),

  getSegments: () => api.get<Array<{ id: number; name: string; rules: Record<string, unknown>; subscriber_count: number; created_at: string }>>('/v2/admin/newsletters/segments'),

  getSegment: (id: number) => api.get<{ id: number; name: string; rules: Record<string, unknown>; subscriber_count: number; created_at: string }>(`/v2/admin/newsletters/segments/${id}`),

  createSegment: (data: Record<string, unknown>) =>
    api.post<{ id: number; name: string }>('/v2/admin/newsletters/segments', data),

  updateSegment: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/v2/admin/newsletters/segments/${id}`, data),

  deleteSegment: (id: number) => api.delete<{ success: boolean }>(`/v2/admin/newsletters/segments/${id}`),

  previewSegment: (rules: Record<string, unknown>) =>
    api.post<{ matching_count: number; count?: number; sample?: Array<{ id: number; email: string; name: string }> }>('/v2/admin/newsletters/segments/preview', rules),

  getSegmentSuggestions: () => api.get<Array<{ name: string; description: string; match_type: string; rules: Array<{ field: string; operator: string; value: string }>; estimated_count: number }>>('/v2/admin/newsletters/segments/suggestions'),

  getTemplates: () => api.get<Array<{ id: number; name: string; subject: string; content: string; content_format?: string; design_json?: string | null; category?: string; description?: string; preview_text?: string; thumbnail?: string | null; created_at: string }>>('/v2/admin/newsletters/templates'),

  getTemplate: (id: number) => api.get<{ id: number; name: string; subject: string; content: string; content_format?: string; design_json?: string | null; category?: string; description?: string; preview_text?: string; thumbnail?: string | null; created_at: string }>(`/v2/admin/newsletters/templates/${id}`),

  createTemplate: (data: Record<string, unknown>) =>
    api.post<{ id: number; name: string }>('/v2/admin/newsletters/templates', data),

  updateTemplate: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/v2/admin/newsletters/templates/${id}`, data),

  deleteTemplate: (id: number) => api.delete<{ success: boolean }>(`/v2/admin/newsletters/templates/${id}`),

  duplicateTemplate: (id: number) =>
    api.post<{ id: number; name: string }>(`/v2/admin/newsletters/templates/${id}/duplicate`, {}),

  previewTemplate: (id: number) => api.get<{ html: string }>(`/v2/admin/newsletters/templates/${id}/preview`),

  getAnalytics: () => api.get<{ total_sent: number; total_opened: number; total_clicked: number; avg_open_rate: number; avg_click_rate: number }>('/v2/admin/newsletters/analytics'),

  // Bounce management
  getBounces: (params: { limit?: number; offset?: number; type?: string; startDate?: string; endDate?: string } = {}) =>
    api.get<PaginatedResponse<NewsletterBounce>>(`/v2/admin/newsletters/bounces${buildQuery(params)}`),

  getSuppressionList: () => api.get<SuppressionListEntry[]>('/v2/admin/newsletters/suppression-list'),

  unsuppress: (email: string) =>
    api.post<{ success: boolean }>(`/v2/admin/newsletters/suppression-list/${encodeURIComponent(email)}/unsuppress`, {}),

  suppress: (email: string) =>
    api.post<{ success: boolean }>(`/v2/admin/newsletters/suppression-list/${encodeURIComponent(email)}/suppress`, {}),

  // Resend workflow
  getResendInfo: (newsletterId: number) =>
    api.get<ResendInfo>(`/v2/admin/newsletters/${newsletterId}/resend-info`),

  resend: (newsletterId: number, options: { target: string; segment_id?: number; subject_override?: string }) =>
    api.post<{ success: boolean }>(`/v2/admin/newsletters/${newsletterId}/resend`, options),

  // Send-time optimizer
  getSendTimeData: (params?: { days?: number }) =>
    api.get<SendTimeData>(`/v2/admin/newsletters/send-time-optimizer${buildQuery(params || {})}`),

  // Diagnostics
  getDiagnostics: () => api.get<NewsletterDiagnostics>('/v2/admin/newsletters/diagnostics'),
  getBounceTrends: (params?: { weeks?: number }) =>
    api.get<BounceTrendsData>(`/v2/admin/newsletters/bounce-trends${buildQuery(params || {})}`),

  // Per-campaign stats
  getStats: (id: number) => api.get<{
    newsletter: Record<string, unknown>;
    delivery: Record<string, unknown>;
    engagement: Record<string, unknown>;
    ab_test: Record<string, unknown> | null;
    timeline: unknown[];
    top_links: unknown[];
    device_stats: Record<string, unknown>;
    recent_activity: unknown[];
    peak_engagement: Record<string, unknown>;
  }>(`/v2/admin/newsletters/${id}/stats`),

  selectAbWinner: (id: number, winner: 'a' | 'b') =>
    api.post<{ success: boolean }>(`/v2/admin/newsletters/${id}/ab-winner`, { winner }),

  // Send workflow
  sendNewsletter: (id: number) =>
    api.post<{ queued: number; status: string; message: string }>(`/v2/admin/newsletters/${id}/send`, {}),

  sendTest: (id: number) =>
    api.post<{ sent_to: string; message: string }>(`/v2/admin/newsletters/${id}/send-test`, {}),

  getRecipientCount: (params: {
    target_audience: string;
    segment_id?: number;
    target_groups?: number[];
    target_counties?: string[];
    target_towns?: string[];
  }) =>
    api.post<{ count: number }>('/v2/admin/newsletters/recipient-count', params),

  // Multi-format authoring: server-parity preview (preview == send) + image host.
  previewContent: (data: {
    content: string;
    content_format: string;
    subject?: string;
    preview_text?: string;
  }) =>
    api.post<{ html: string; text: string; subject: string }>('/v2/admin/newsletters/preview', data),

  uploadImage: (file: File) =>
    api.upload<{ url: string; path: string }>('/v2/upload', file, 'file'),

  // Asset library — the tenant's previously-uploaded images (browse + reuse).
  listImages: () =>
    api.get<{ images: { url: string; path: string; name: string }[] }>('/v2/upload/list'),

  // Duplicate
  duplicateNewsletter: (id: number) =>
    api.post<Newsletter>(`/v2/admin/newsletters/${id}/duplicate`, {}),

  // Activity log
  getActivity: (id: number, params?: { page?: number; per_page?: number; type?: string }) =>
    api.get<PaginatedResponse<{ id: number; type: string; description: string; created_at: string }>>(`/v2/admin/newsletters/${id}/activity${buildQuery(params || {})}`),

  // Per-subscriber engagement lists
  getOpeners: (id: number, params?: { page?: number; per_page?: number }) =>
    api.get<PaginatedResponse<{ email: string; name: string; opened_at: string }>>(`/v2/admin/newsletters/${id}/openers${buildQuery(params || {})}`),

  getClickers: (id: number, params?: { page?: number; per_page?: number }) =>
    api.get<PaginatedResponse<{ email: string; name: string; clicked_at: string }>>(`/v2/admin/newsletters/${id}/clickers${buildQuery(params || {})}`),

  getNonOpeners: (id: number, params?: { page?: number; per_page?: number }) =>
    api.get<PaginatedResponse<{ email: string; name: string }>>(`/v2/admin/newsletters/${id}/non-openers${buildQuery(params || {})}`),

  getOpenersNoClick: (id: number, params?: { page?: number; per_page?: number }) =>
    api.get<PaginatedResponse<{ email: string; name: string; opened_at: string }>>(`/v2/admin/newsletters/${id}/openers-no-click${buildQuery(params || {})}`),

  getEmailClients: (id: number) =>
    api.get<{ email_clients: Array<{ client: string; count: number; percentage?: number }> }>(`/v2/admin/newsletters/${id}/email-clients`),
};

// ─────────────────────────────────────────────────────────────────────────────
export const adminBuilderAssets = {
  uploadImage: (file: File) =>
    api.upload<{ url: string; path: string }>('/v2/upload', file, 'file'),

  listImages: () =>
    api.get<{ images: { url: string; path: string; name: string }[] }>('/v2/upload/list'),
};

// Volunteering
// ─────────────────────────────────────────────────────────────────────────────

export const adminVolunteering = {
  getOverview: () => api.get<{ total_opportunities: number; active_volunteers: number; pending_approvals: number; total_hours: number }>('/v2/admin/volunteering'),

  getApprovals: () => api.get<Array<{ id: number; user_id: number; user_name: string; opportunity_id: number; opportunity_title: string; status: string; created_at: string }>>('/v2/admin/volunteering/approvals'),

  approveApplication: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/volunteering/approvals/${id}/approve`, {}),

  declineApplication: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/volunteering/approvals/${id}/decline`, {}),

  getOrganizations: () => api.get<Array<{ id: number; name: string; opportunity_count: number; volunteer_count: number }>>('/v2/admin/volunteering/organizations'),

  // Organization wallet management
  adjustOrgWallet: (orgId: number, amount: number, reason: string) =>
    api.put(`/v2/admin/volunteering/organizations/${orgId}/wallet/adjust`, { amount, reason }),

  getOrgTransactions: (orgId: number, cursor?: string) =>
    api.get(`/v2/admin/volunteering/organizations/${orgId}/wallet/transactions?per_page=20${cursor ? `&cursor=${cursor}` : ''}`),

  updateOrgStatus: (orgId: number, status: 'active' | 'suspended') =>
    api.put(`/v2/admin/volunteering/organizations/${orgId}/status`, { status }),

  // Hours management
  listHours: (params?: { status?: string; cursor?: string }) => {
    const search = new URLSearchParams();
    if (params?.status) search.set('status', params.status);
    if (params?.cursor) search.set('cursor', params.cursor);
    const qs = search.toString();
    return api.get(`/v2/admin/volunteering/hours${qs ? `?${qs}` : ''}`);
  },

  verifyHours: (logId: number, action: 'approve' | 'decline') =>
    api.post(`/v2/admin/volunteering/hours/${logId}/verify`, { action }),

  // Admin-approval-gated shift swaps (path lives under /v2/volunteering/admin/swaps).
  // A swap requiring admin approval sits in 'admin_pending' until resolved here.
  getPendingSwaps: () =>
    api.get<Array<{
      id: number;
      status: string;
      message: string | null;
      requester: { id: number; name: string };
      recipient: { id: number; name: string };
      original_shift: { id: number; start_time: string; end_time: string; opportunity_title: string | null };
      proposed_shift: { id: number; start_time: string; end_time: string; opportunity_title: string | null };
      created_at: string;
    }>>('/v2/volunteering/admin/swaps'),

  decideSwap: (id: number, action: 'approve' | 'reject') =>
    api.put<{ id: number; status: string }>(`/v2/volunteering/admin/swaps/${id}`, { action }),

  // Applications with filters
  getApplications: (params?: { status?: string; cursor?: string }) => {
    const search = new URLSearchParams();
    if (params?.status) search.set('status', params.status);
    if (params?.cursor) search.set('cursor', params.cursor);
    const qs = search.toString();
    return api.get(`/v2/admin/volunteering/applications${qs ? `?${qs}` : ''}`);
  },

  // Expenses
  getExpenses: (cursor?: string) =>
    api.get('/v2/admin/volunteering/expenses' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '')),
  reviewExpense: (id: number, data: { status: string; review_notes?: string; payment_reference?: string }) =>
    api.put(`/v2/admin/volunteering/expenses/${id}`, data),
  exportExpenses: (filename?: string) => api.download('/v2/admin/volunteering/expenses/export', { filename }),
  getReceiptBlob: (id: number) => api.download(`/v2/admin/volunteering/expenses/${id}/receipt`),
  getExpensePolicies: () => api.get('/v2/admin/volunteering/expenses/policies'),
  updateExpensePolicies: (data: Record<string, unknown>) =>
    api.put('/v2/admin/volunteering/expenses/policies', data),

  getTrends: (period: string = 'week') =>
    api.get(`/v2/admin/volunteering/trends?period=${period}`),

  getActivityFeed: (limit: number = 20, days: number = 30) =>
    api.get(`/v2/admin/volunteering/activity-feed?limit=${limit}&days=${days}`),

  // Training
  getTraining: () => api.get('/v2/admin/volunteering/training'),
  verifyTraining: (id: number) => api.put(`/v2/admin/volunteering/training/${id}/verify`, {}),
  rejectTraining: (id: number, reason: string) => api.put(`/v2/admin/volunteering/training/${id}/reject`, { reason }),

  // Incidents
  getIncidents: () => api.get('/v2/admin/volunteering/incidents'),
  updateIncident: (id: number, data: { status: string; action_taken?: string; resolution_notes?: string }) =>
    api.put(`/v2/admin/volunteering/incidents/${id}`, data),

  // DLP
  assignDlp: (orgId: number, dlpUserId: number) =>
    api.put(`/v2/admin/volunteering/organizations/${orgId}/dlp`, { dlp_user_id: dlpUserId }),

  // Giving Days
  getGivingDays: () => api.get('/v2/admin/volunteering/giving-days'),
  createGivingDay: (data: Record<string, unknown>) => api.post('/v2/admin/volunteering/giving-days', data),
  updateGivingDay: (id: number, data: Record<string, unknown>) => api.put(`/v2/admin/volunteering/giving-days/${id}`, data),
  exportDonations: (filename?: string) =>
    api.download('/v2/admin/volunteering/donations/export', { filename }),

  // Guardian Consents
  getGuardianConsents: (params?: { status?: string; cursor?: number; limit?: number }) =>
    api.get(`/v2/admin/volunteering/guardian-consents${buildQuery(params || {})}`),

  // Community Projects
  getCommunityProjects: (params?: { status?: string; cursor?: string; per_page?: number }) =>
    api.get(`/v2/admin/volunteering/community-projects${buildQuery(params || {})}`),
  reviewCommunityProject: (id: number, data: { status: string; review_notes?: string }) =>
    api.put(`/v2/admin/volunteering/community-projects/${id}/review`, data),

  // Custom Fields
  getCustomFields: () => api.get('/v2/admin/volunteering/custom-fields'),
  createCustomField: (data: Record<string, unknown>) => api.post('/v2/admin/volunteering/custom-fields', data),
  updateCustomField: (id: number, data: Record<string, unknown>) => api.put(`/v2/admin/volunteering/custom-fields/${id}`, data),
  deleteCustomField: (id: number) => api.delete(`/v2/admin/volunteering/custom-fields/${id}`),

  // Organization CRUD + Members
  getOrgMembers: (orgId: number) => api.get(`/v2/admin/volunteering/organizations/${orgId}/members`),
  createOrganization: (data: Record<string, unknown>) => api.post('/v2/admin/volunteering/organizations', data),
  updateOrganization: (orgId: number, data: Record<string, unknown>) => api.put(`/v2/admin/volunteering/organizations/${orgId}`, data),

  // Reminders
  getReminderSettings: () => api.get('/v2/admin/volunteering/reminder-settings'),
  updateReminderSettings: (data: Record<string, unknown>) => api.put('/v2/admin/volunteering/reminder-settings', data),
  sendShiftReminders: () => api.post('/v2/admin/volunteering/send-shift-reminders', {}),

  // Webhooks
  getWebhooks: () => api.get('/v2/admin/volunteering/webhooks'),
  createWebhook: (data: Record<string, unknown>) => api.post('/v2/admin/volunteering/webhooks', data),
  updateWebhook: (id: number, data: Record<string, unknown>) => api.put(`/v2/admin/volunteering/webhooks/${id}`, data),
  deleteWebhook: (id: number) => api.delete(`/v2/admin/volunteering/webhooks/${id}`),
  testWebhook: (id: number) => api.post(`/v2/admin/volunteering/webhooks/${id}/test`, {}),
  getWebhookLogs: (id: number) => api.get(`/v2/admin/volunteering/webhooks/${id}/logs`),

  // Giving Day Donors & Trends
  getGivingDayDonors: (givingDayId: number, cursor?: string) =>
    api.get(`/v2/admin/volunteering/giving-days/${givingDayId}/donors?per_page=20${cursor ? `&cursor=${cursor}` : ''}`),

  getGivingDayTrends: (givingDayId: number, granularity: string = 'day') =>
    api.get(`/v2/admin/volunteering/giving-days/${givingDayId}/trends?granularity=${granularity}`),

  // Custom Fields reorder
  reorderCustomFields: (fieldIds: number[]) =>
    api.post('/v2/admin/volunteering/custom-fields/reorder', { field_ids: fieldIds }),

  // Reminder delivery logs
  getReminderLogs: (params?: { type?: string; channel?: string; per_page?: number; cursor?: string }) => {
    const search = new URLSearchParams();
    if (params?.type) search.set('type', params.type);
    if (params?.channel) search.set('channel', params.channel);
    if (params?.per_page) search.set('per_page', String(params.per_page));
    if (params?.cursor) search.set('cursor', params.cursor);
    const qs = search.toString();
    return api.get(`/v2/admin/volunteering/reminder-logs${qs ? `?${qs}` : ''}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Federation
// ─────────────────────────────────────────────────────────────────────────────

export const adminFederation = {
  getSettings: () => api.get<FederationSystemControls>('/v2/admin/federation/settings'),

  updateSettings: (data: Record<string, unknown>) =>
    api.put<{ success: boolean }>('/v2/admin/federation/settings', data),

  getPartnerships: () => api.get<FederationPartnership[]>('/v2/admin/federation/partnerships'),

  approvePartnership: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/federation/partnerships/${id}/approve`, {}),

  rejectPartnership: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/federation/partnerships/${id}/reject`, {}),

  terminatePartnership: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/federation/partnerships/${id}/terminate`, {}),

  reactivatePartnership: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/federation/partnerships/${id}/reactivate`, {}),

  getDirectory: (params?: { search?: string; region?: string; category?: string; topic?: string; exclude_partnered?: boolean }) =>
    api.get<Array<{ id: number; name: string; slug: string; domain: string; description?: string; region?: string }>>(`/v2/admin/federation/directory${buildQuery(params || {})}`),

  requestPartnership: (targetTenantId: number, notes?: string) =>
    api.post<{ success: boolean }>('/v2/admin/federation/partnerships/request', { target_tenant_id: targetTenantId, notes }),

  getProfile: () => api.get<{ id: number; name: string; description?: string; region?: string; category?: string; is_visible: boolean }>('/v2/admin/federation/directory/profile'),

  updateProfile: (data: Record<string, unknown>) =>
    api.put<{ success: boolean }>('/v2/admin/federation/directory/profile', data),

  getTopics: () =>
    api.get<Array<{ id: number; name: string; slug: string; icon: string; category: string; tenant_count: number }>>('/v2/admin/federation/topics'),

  getMyTopics: () =>
    api.get<Array<{ id: number; name: string; slug: string; icon: string; category: string; is_primary: boolean }>>('/v2/admin/federation/topics/mine'),

  updateMyTopics: (topicIds: number[], primaryIds: number[] = []) =>
    api.put<Array<{ id: number; name: string; slug: string; icon: string; category: string; is_primary: boolean }>>('/v2/admin/federation/topics/mine', { topic_ids: topicIds, primary_ids: primaryIds }),

  getAnalytics: () => api.get<{ total_partnerships: number; active_partnerships: number; cross_tenant_transactions: number; cross_tenant_messages: number }>('/v2/admin/federation/analytics'),

  getApiKeys: () => api.get<Array<{ id: number; name: string; key_prefix: string; scopes: string[]; created_at: string; last_used_at?: string }>>('/v2/admin/federation/api-keys'),

  createApiKey: (data: { name: string; scopes?: string[]; expires_at?: string }) =>
    api.post<{ id: number; key: string; name: string }>('/v2/admin/federation/api-keys', data),

  revokeApiKey: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/federation/api-keys/${id}/revoke`, {}),

  getDataManagement: () => api.get<{ export_formats: string[]; available_exports: Record<string, string>; import_supported: boolean; last_export_at: string | null; last_import_at: string | null }>('/v2/admin/federation/data'),

  getActivityFeed: (params?: {
    limit?: number;
    cursor?: string;
    event_type?: string;
    partner_tenant_id?: number;
    date_from?: string;
    date_to?: string;
    search?: string;
  }) => api.get<{
    items: Array<{
      id: number;
      type: string;
      category: string;
      level: string;
      description: string;
      detail: string | null;
      actor_name: string | null;
      actor_user_id: number | null;
      direction: 'inbound' | 'outbound';
      partner_tenant_id: number | null;
      partner_tenant_name: string | null;
      partner_tenant_slug: string | null;
      timestamp: string;
      data: Record<string, unknown>;
    }>;
    total: number;
    has_more: boolean;
    next_cursor: string | null;
  }>(`/v2/admin/federation/activity${buildQuery(params || {})}`),

  getPartnershipDetail: (id: number) =>
    api.get<Record<string, unknown>>(`/v2/admin/federation/partnerships/${id}`),

  counterProposePartnership: (id: number, data: { level: number; permissions: Record<string, boolean>; message?: string }) =>
    api.post<{ success: boolean }>(`/v2/admin/federation/partnerships/${id}/counter-propose`, data),

  updatePartnershipPermissions: (id: number, permissions: Record<string, boolean>) =>
    api.put<{ success: boolean }>(`/v2/admin/federation/partnerships/${id}/permissions`, { permissions }),

  getPartnershipAuditLog: (id: number) =>
    api.get<Array<Record<string, unknown>>>(`/v2/admin/federation/partnerships/${id}/audit-log`),

  getPartnershipStats: (id: number) =>
    api.get<{ messages_exchanged: number; transactions_completed: number; connections_made: number }>(`/v2/admin/federation/partnerships/${id}/stats`),

  getCreditAgreementTransactions: (id: number) =>
    api.get<{ transactions: Array<Record<string, unknown>>; month_usage: number; monthly_limit: number | null }>(`/v2/admin/federation/credit-agreements/${id}/transactions`),

  getCreditBalances: () =>
    api.get<{ balances: Array<{ agreement_id: number; partner_tenant_id: number; partner_name: string; credits_sent: number; credits_received: number; net_balance: number }>; net_total: number }>('/v2/admin/federation/credit-balances'),

  // Enhanced analytics overview (KPIs + chart data)
  getAnalyticsOverview: (range: '7d' | '30d' | '90d' = '30d') =>
    api.get<{
      range_days: number;
      kpis: {
        total_partnerships: number;
        active_partnerships: number;
        pending_partnerships: number;
        external_partners: number;
        federated_transactions: number;
        federated_messages: number;
        federated_listings: number;
        inbound_reviews: number;
      };
      daily_calls: Array<{ date: string; count: number }>;
      top_partners: Array<{ tenant_id: number; name: string; activity: number }>;
      recent_errors: Array<{ id: number; endpoint: string; method: string; response_code: number; ip_address: string; created_at: string }>;
    }>(`/v2/admin/federation/analytics/overview?range=${range}`),

  // Data management: bulk export (streamed JSON), import (multipart), purge
  exportFederationData: () =>
    api.download('/v2/admin/federation/data/export', {
      method: 'POST',
      filename: `federation_export_${new Date().toISOString().slice(0, 10)}.json`,
    }),

  importFederationData: (file: File, dryRun: boolean) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('dry_run', dryRun ? '1' : '0');
    return api.upload<{
      dry_run: boolean;
      partnerships: { new: number; skipped: number; invalid: number };
      external_partners: { new: number; skipped: number; invalid: number };
    }>('/v2/admin/federation/data/import', fd);
  },

  purgeFederationData: (days: number) =>
    api.post<{ deleted: number; cutoff: string; days: number }>('/v2/admin/federation/data/purge', { days }),

  // Cross-node aggregate consent (R1+R2 — Caring Community federation)
  getAggregateConsent: () =>
    api.get<{ enabled: boolean; has_secret: boolean; last_rotated_at: string | null }>(
      '/v2/admin/federation/aggregate-consent'
    ),

  updateAggregateConsent: (enabled: boolean) =>
    api.put<{ enabled: boolean; has_secret: boolean; last_rotated_at: string | null }>(
      '/v2/admin/federation/aggregate-consent',
      { enabled }
    ),

  rotateAggregateSecret: () =>
    api.post<{
      rotated: boolean;
      consent: { enabled: boolean; has_secret: boolean; last_rotated_at: string | null };
    }>('/v2/admin/federation/aggregate-consent/rotate-secret', {}),

  getAggregateAuditLog: () =>
    api.get<{
      entries: Array<{
        id: number;
        requester_origin: string | null;
        period_from: string;
        period_to: string;
        fields_returned: unknown;
        signature_snippet: string;
        created_at: string;
      }>;
    }>('/v2/admin/federation/aggregate-consent/audit-log'),

  getAggregatePreview: (params?: { period_from?: string; period_to?: string }) => {
    const qs = buildQuery(params || {});
    return api.get<{
      payload: Record<string, unknown>;
      algorithm: string;
    }>(`/v2/admin/federation/aggregate-consent/preview${qs}`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Pages (CMS)
// ─────────────────────────────────────────────────────────────────────────────

export const adminPages = {
  list: () => api.get<Array<{ id: number; title: string; slug: string; status: string; sort_order: number; show_in_menu: number; menu_location: string; menu_order: number; created_at: string }>>('/v2/admin/pages'),
  get: (id: number) => api.get<{ id: number; title: string; slug: string; content: string; content_format?: 'plaintext' | 'richtext' | 'html' | 'builder'; design_json?: string | null; status: string; meta_description?: string; show_in_menu: number; menu_location: string; menu_order: number; created_at: string }>(`/v2/admin/pages/${id}`),
  create: (data: { title: string; content?: string; content_format?: 'plaintext' | 'richtext' | 'html' | 'builder'; design_json?: string | null; meta_description?: string; status?: string; show_in_menu?: number; menu_location?: string; menu_order?: number }) =>
    api.post<{ id: number }>('/v2/admin/pages', data),
  update: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/v2/admin/pages/${id}`, data),
  delete: (id: number) => api.delete<{ success: boolean }>(`/v2/admin/pages/${id}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Menus
// ─────────────────────────────────────────────────────────────────────────────

export const adminMenus = {
  list: () => api.get<Array<{ id: number; name: string; slug: string; location: string; is_active: boolean; item_count: number }>>('/v2/admin/menus'),
  get: (id: number) => api.get<{ id: number; name: string; slug: string; location: string; description?: string; is_active: boolean; item_count: number }>(`/v2/admin/menus/${id}`),
  create: (data: { name: string; location: string; description?: string }) =>
    api.post<{ id: number }>('/v2/admin/menus', data),
  update: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/v2/admin/menus/${id}`, data),
  delete: (id: number) => api.delete<{ success: boolean }>(`/v2/admin/menus/${id}`),
  getItems: (menuId: number) => api.get<Array<{ id: number; label: string; url: string; sort_order: number; parent_id: number | null }>>(`/v2/admin/menus/${menuId}/items`),
  createItem: (menuId: number, data: Record<string, unknown>) =>
    api.post<{ id: number }>(`/v2/admin/menus/${menuId}/items`, data),
  updateItem: (itemId: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/v2/admin/menu-items/${itemId}`, data),
  deleteItem: (itemId: number) => api.delete<{ success: boolean }>(`/v2/admin/menu-items/${itemId}`),
  reorderItems: (menuId: number, items: Array<{ id: number; sort_order: number; parent_id?: number | null }>) =>
    api.post<{ success: boolean }>(`/v2/admin/menus/${menuId}/items/reorder`, { items }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Plans & Subscriptions
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanListItem {
  id: number;
  name: string;
  slug: string;
  description?: string;
  tier_level: number;
  max_users?: number | null;
  price_monthly: number;
  price_yearly: number;
  is_active: boolean;
  stripe_synced: boolean;
  stripe_product_id?: string | null;
  stripe_price_id_monthly?: string | null;
  stripe_price_id_yearly?: string | null;
  tenant_count: number;
}

export interface PlanDetail extends PlanListItem {
  max_menus?: number;
  max_menu_items?: number;
  features?: string[];
}

export const adminPlans = {
  list: () => api.get<PlanListItem[]>('/v2/admin/plans'),
  get: (id: number) => api.get<PlanDetail>(`/v2/admin/plans/${id}`),
  create: (data: { name: string; description?: string; price_monthly?: number; price_yearly?: number; tier_level?: number; max_users?: number | null; max_menus?: number; max_menu_items?: number; features?: string[]; is_active?: boolean }) =>
    api.post<{ id: number }>('/v2/admin/plans', data),
  update: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/v2/admin/plans/${id}`, data),
  delete: (id: number) => api.delete<{ success: boolean }>(`/v2/admin/plans/${id}`),
  syncStripe: (id: number) =>
    api.post<{ synced: boolean; stripe_product_id: string | null; stripe_price_id_monthly: string | null; stripe_price_id_yearly: string | null }>(`/v2/admin/plans/${id}/sync-stripe`, {}),
  getSubscriptions: () => api.get<Array<{ id: number; tenant_id: number; tenant_name: string; plan_id: number; plan_name: string; status: string; created_at: string }>>('/v2/admin/subscriptions'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Deliverability
// ─────────────────────────────────────────────────────────────────────────────

export const adminDeliverability = {
  // Consumer casts to local DashboardData type
  getDashboard: () => api.get('/v2/admin/deliverability/dashboard'),
  list: (params: { page?: number; status?: string; priority?: string } = {}) =>
    api.get<PaginatedResponse<{ id: number; title: string; description?: string; priority: string; status: string; due_date?: string; assigned_to?: number; created_at: string }>>(`/v2/admin/deliverability${buildQuery(params)}`),
  get: (id: number) => api.get<{ id: number; title: string; description?: string; priority: string; status: string; due_date?: string; assigned_to?: number; comments: Array<{ id: number; comment_text: string; comment_type?: string; created_at: string }>; created_at: string }>(`/v2/admin/deliverability/${id}`),
  create: (data: { title: string; description?: string; priority?: string; status?: string; due_date?: string; assigned_to?: number }) =>
    api.post<{ id: number }>('/v2/admin/deliverability', data),
  update: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/v2/admin/deliverability/${id}`, data),
  delete: (id: number) => api.delete<{ success: boolean }>(`/v2/admin/deliverability/${id}`),
  // Consumer casts to local AnalyticsData type
  getAnalytics: () => api.get('/v2/admin/deliverability/analytics'),
  addComment: (id: number, data: { comment_text: string; comment_type?: string }) =>
    api.post<{ id: number }>(`/v2/admin/deliverability/${id}/comments`, data),
};

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics (Matching & Nexus Score)
// ─────────────────────────────────────────────────────────────────────────────

export const adminDiagnostics = {
  diagnoseUser: (userId: number) =>
    api.get<Record<string, unknown>>(`/v2/admin/matching/stats${buildQuery({ user_id: userId })}`),
  diagnoseListing: (listingId: number) =>
    api.get<Record<string, unknown>>(`/v2/admin/matching/stats${buildQuery({ listing_id: listingId })}`),
  getMatchingStats: () => api.get<Record<string, unknown>>('/v2/admin/matching/stats'),
  getNexusScoreStats: () => api.get<GamificationStats>('/v2/admin/gamification/stats'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Admin Settings
// ─────────────────────────────────────────────────────────────────────────────

export const adminSettings = {
  get: () => api.get<import('./types').AdminSettingsResponse>('/v2/admin/settings'),
  update: (data: Record<string, unknown>) => api.put<{ success: boolean }>('/v2/admin/settings', data),
  uploadPartnerLogo: (file: File) => api.upload<{ url: string }>('/v2/admin/settings/partner-logo', file, 'logo'),
  uploadPoweredByImageLight: (file: File) => api.upload<{ url: string }>('/v2/admin/settings/powered-by-image-light', file, 'logo'),
  uploadPoweredByImageDark:  (file: File) => api.upload<{ url: string }>('/v2/admin/settings/powered-by-image-dark',  file, 'logo'),
  uploadHeaderLogo:      (file: File) => api.upload<{ url: string }>('/v2/admin/settings/header-logo',      file, 'logo'),
  uploadHeaderLogoDark:  (file: File) => api.upload<{ url: string }>('/v2/admin/settings/header-logo-dark', file, 'logo'),
  removeHeaderLogo:      () => api.delete<{ url: string | null }>('/v2/admin/settings/header-logo'),
  removeHeaderLogoDark:  () => api.delete<{ url: string | null }>('/v2/admin/settings/header-logo-dark'),
  // Accessible (GOV.UK alpha) header colours. Pass null / '' to clear an
  // override and revert to the stock GOV.UK black + blue.
  saveHeaderColors: (bgColor: string | null, accentColor: string | null) =>
    api.put<{ header_bg_color: string | null; header_accent_color: string | null }>(
      '/v2/admin/settings/header-colors',
      { bg_color: bgColor ?? '', accent_color: accentColor ?? '' },
    ),

  getAiConfig: () => api.get<Record<string, unknown>>('/v2/admin/config/ai'),
  updateAiConfig: (data: Record<string, unknown>) => api.put<{ success: boolean }>('/v2/admin/config/ai', data),

  getFeedAlgorithm: () => api.get<Record<string, unknown>>('/v2/admin/config/feed-algorithm'),
  updateFeedAlgorithm: (data: Record<string, unknown>) => api.put<{ success: boolean }>('/v2/admin/config/feed-algorithm', data),

  getAlgorithmConfig: () => api.get<Record<string, unknown>>('/v2/admin/config/algorithms'),
  updateAlgorithmConfig: (area: string, data: Record<string, unknown>) => api.put<{ success: boolean }>(`/v2/admin/config/algorithm/${area}`, data),
  getAlgorithmHealth: () => api.get<Record<string, unknown>>('/v2/admin/config/algorithm-health'),

  getImageSettings: () => api.get<Record<string, unknown>>('/v2/admin/config/images'),
  updateImageSettings: (data: Record<string, unknown>) => api.put<{ success: boolean }>('/v2/admin/config/images', data),

  getSeoSettings: () => api.get<Record<string, unknown>>('/v2/admin/config/seo'),
  updateSeoSettings: (data: Record<string, unknown>) => api.put<{ success: boolean }>('/v2/admin/config/seo', data),
  getSitemapStats: () => api.get<{ sitemap_url: string; total_urls: number; content_types: Record<string, number> }>('/v2/admin/config/sitemap-stats'),
  clearSitemapCache: () => api.post<{ cleared: number }>('/v2/admin/config/sitemap-clear-cache'),

  getNativeAppSettings: () => api.get<Record<string, unknown>>('/v2/admin/config/native-app'),
  updateNativeAppSettings: (data: Record<string, unknown>) => api.put<{ success: boolean }>('/v2/admin/config/native-app', data),
  getNativeAppBuildManifest: () => api.get<Record<string, unknown>>('/v2/admin/config/native-app/build-manifest'),

  getEmailConfig: () => api.get<Record<string, unknown>>('/v2/admin/email/config'),
  updateEmailConfig: (data: Record<string, unknown>) => api.put<{ success: boolean }>('/v2/admin/email/config', data),
  testEmailProvider: (data: { to: string }) => api.post<{ success: boolean; message: string }>('/v2/admin/email/test-provider', data),
};

// ─────────────────────────────────────────────────────────────────────────────
// Admin Tools (SEO, Health, WebP, Seeds, Backups)
// ─────────────────────────────────────────────────────────────────────────────

export const adminTools = {
  getRedirects: () => api.get<Array<{ id: number; source_url: string; destination_url: string; hits: number; created_at: string }>>('/v2/admin/tools/redirects'),
  createRedirect: (data: { source_url: string; destination_url: string }) =>
    api.post<{ id: number }>('/v2/admin/tools/redirects', data),
  deleteRedirect: (id: number) => api.delete<{ success: boolean }>(`/v2/admin/tools/redirects/${id}`),

  get404Errors: (page = 1, perPage = 50) =>
    api.get<{ items: Array<{ id: number; url: string; referrer: string; hits: number; first_seen: string; last_seen: string }>; total: number; page: number; per_page: number }>(
      `/v2/admin/tools/404-errors?page=${page}&per_page=${perPage}`
    ),
  delete404Error: (id: number) => api.delete<{ success: boolean }>(`/v2/admin/tools/404-errors/${id}`),

  runHealthCheck: () => api.post<{
    tests: Array<{ code: string; status: string; duration_ms: number; error?: string }>;
    summary: { total: number; passed: number; failed: number; overall: string };
  }>('/v2/admin/tools/health-check'),

  getWebpStats: () => api.get<{ total_images: number; webp_images: number; pending_conversion: number }>('/v2/admin/tools/webp-stats'),
  runWebpConversion: () => api.post<{ converted: number }>('/v2/admin/tools/webp-convert'),

  runSeedGenerator: (data: { types: string[]; counts: Record<string, number> }) =>
    api.post<{ success: boolean; created: Record<string, number> }>('/v2/admin/tools/seed', data),

  getBlogBackups: () => api.get<Array<{ id: number; filename: string; created_at: string; size: string }>>('/v2/admin/tools/blog-backups'),

  restoreBlogBackup: (backupId: number) =>
    api.post<{ restored_count: number }>(`/v2/admin/tools/blog-backups/${backupId}/restore`),

  runSeoAudit: () =>
    api.post<SeoAuditResult>('/v2/admin/tools/seo-audit'),

  getSeoAudit: () =>
    api.get<SeoAuditResult | null>('/v2/admin/tools/seo-audit'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Prerender Engine (SEO module)
// ─────────────────────────────────────────────────────────────────────────────

export interface PrerenderSummary {
  cache_readable: boolean;
  cache_writable: boolean;
  cache_path: string;
  inventory_truncated: boolean;
  inventory_hard_cap: number;
  total_snapshots: number;
  total_size_bytes: number;
  oldest_age_s: number | null;
  newest_age_s: number | null;
  stale_count: number;
  warn_count: number;
  missing_count: number;
  expected_count: number;
  expected_rendered_count: number;
  plan_error_count: number;
  unexpected_count: number;
  coverage_pct: number;
  last_run: Record<string, unknown> | null;
  recent_failures: number;
  active_jobs: number;
  queued_jobs: number;
  last_event_at: string | null;
  build_commit: string | null;
  expected_routes: string[];
  tenant_count: number;
  content_stale_count: number;
  asset_invalid_count: number;
  realtime_channel: string;
  realtime_event: string;
}

export interface PrerenderInventoryItem {
  host: string;
  route: string;
  tenant_id: number | null;
  tenant_slug: string | null;
  tenant_route: string;
  cache_path: string;
  size_bytes: number;
  mtime: number;
  age_s: number;
  staleness: 'fresh' | 'warn' | 'stale';
  age_staleness: 'fresh' | 'warn' | 'stale';
  asset_refs: string[];
  asset_issues: string[];
  content_stale: boolean;
  content_stale_reason: string | null;
  http_status: number;
}

export interface PrerenderCoverageRow {
  tenant_id: number;
  slug: string;
  host: string;
  expected: number;
  rendered: number;
  missing: number;
  missing_routes: string[];
  stale_routes: string[];
  asset_invalid_routes: string[];
  plan_error: string | null;
}

export interface PrerenderTenantSafety {
  tenant: {
    tenant_id: number;
    slug: string;
    host: string;
    prefix: string;
  };
  counts: {
    expected: number;
    static: number;
    sitemap: number;
    snapshots: number;
    missing: number;
    stale: number;
    asset_invalid: number;
    unexpected: number;
  };
  static_routes: string[];
  sitemap_routes: string[];
  expected_routes: string[];
  missing_routes: string[];
  stale_routes: string[];
  asset_invalid_routes: string[];
  unexpected_routes: string[];
  snapshots: Array<{
    route: string;
    cache_path: string;
    host_route: string;
    source: 'static' | 'sitemap' | 'unexpected';
    expected: boolean;
    reason: {
      key: 'sitemap' | 'unexpected' | 'always_public' | 'feature_enabled' | 'feature_disabled' | 'module_enabled' | 'module_disabled' | 'expected';
      value: string | null;
    };
    staleness: 'fresh' | 'warn' | 'stale';
    http_status: number;
    content_stale: boolean;
    asset_issues: string[];
  }>;
}

export interface PrerenderInspect {
  cache_path: string;
  size_bytes: number;
  mtime: number;
  age_s: number;
  http_status: number;
  integrity: {
    status: 'ok' | 'missing' | 'mismatch' | 'unreadable';
    expected: string | null;
    actual: string | null;
  };
  title: string;
  meta_description: string | null;
  canonical: string | null;
  og_tags: Record<string, string>;
  h1_texts: string[];
  json_ld: {
    blocks_count: number;
    all_valid: boolean;
    blocks: Array<{ valid: boolean; size: number; types: string[] }>;
  };
  asset_refs: string[];
  asset_issues: string[];
  flags: {
    parses: boolean;
    has_h1: boolean;
    multiple_h1: boolean;
    has_meta_desc: boolean;
    has_og: boolean;
    has_canonical: boolean;
    has_jsonld: boolean;
    jsonld_valid: boolean;
    has_noscript: boolean;
  };
  parse_warnings: string[];
  preview: string;
  seo: {
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    issues: string[];
    tips: string[];
  };
}

export interface PrerenderJob {
  id: number;
  status: 'pending_fence' | 'queued' | 'claimed' | 'running' | 'succeeded' | 'failed' | 'partial' | 'cancelled';
  tenant_id: number | null;
  tenant_slug: string | null;
  routes: string | null;
  force: boolean;
  dry_run: boolean;
  authoritative_reset?: boolean;
  priority: number;
  planned_count: number | null;
  rendered_count: number | null;
  invalid_count: number | null;
  duration_s: number | null;
  exit_code: number | null;
  log_excerpt: string | null;
  error_message: string | null;
  claimed_by: string | null;
  queued_at: string | null;
  fence_ready_at?: string | null;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  requested_by: { id: number; name: string; email: string | null } | null;
}

export interface PrerenderAnalytics {
  total_hits: number;
  verified_hits: number;
  spoofed_by_crawler: Record<string, number>;
  window_started_at: string;
  hits_by_status: Record<string, number>;
  hits_by_crawler: Record<string, number>;
  hits_by_host: Record<string, number>;
  top_uris: Array<{ url: string; hits: number }>;
  recent: Array<{
    ts: string | null;
    host: string;
    uri: string;
    status: number;
    crawler: string;
    ua: string;
    ip: string;
  }>;
  log_path: string;
  log_size_bytes: number;
}

// (PrerenderJob is now declared above with the priority field included.)

export interface PrerenderEvent {
  ts?: string;
  event?: string;
  pid?: number;
  host?: string;
  commit?: string;
  [k: string]: unknown;
}

export interface PrerenderFailure {
  cache_path: string;
  failed_at: number;
  age_s: number;
}

export const adminPrerender = {
  getSummary: () =>
    api.get<PrerenderSummary>('/v2/admin/prerender/summary'),

  getInventory: (tenant?: string) =>
    api.get<{ cache_readable: boolean; cache_path: string; items: PrerenderInventoryItem[]; truncated: boolean; hard_cap: number }>(
      `/v2/admin/prerender/inventory${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`,
    ),

  inspect: (cachePath: string) =>
    api.get<PrerenderInspect>(`/v2/admin/prerender/inspect?path=${encodeURIComponent(cachePath)}`),

  getCoverage: () =>
    api.get<{ expected_routes: string[]; rows: PrerenderCoverageRow[] }>('/v2/admin/prerender/coverage'),

  getTenantSafety: (tenant: string) =>
    api.get<PrerenderTenantSafety>(
      `/v2/admin/prerender/tenant-safety?tenant=${encodeURIComponent(tenant)}`,
    ),

  getEvents: (limit = 200) =>
    api.get<{ events: PrerenderEvent[] }>(`/v2/admin/prerender/events?limit=${limit}`),

  getFailures: () =>
    api.get<{ items: PrerenderFailure[] }>('/v2/admin/prerender/failures'),

  listJobs: (params: { status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return api.get<{ items: PrerenderJob[] }>(`/v2/admin/prerender/jobs${q ? `?${q}` : ''}`);
  },

  getJob: (id: number) =>
    api.get<PrerenderJob>(`/v2/admin/prerender/jobs/${id}`),

  enqueueJob: (payload: {
    tenant_slug?: string;
    routes?: string;
    force?: boolean;
    dry_run?: boolean;
    priority?: number;
  }) =>
    api.post<{ job_id: number; job: PrerenderJob }>('/v2/admin/prerender/jobs', payload),

  cancelJob: (id: number) =>
    api.post<{ cancelled: boolean; id: number }>(`/v2/admin/prerender/jobs/${id}/cancel`, {}),

  realtimeChannel: () =>
    api.get<{ channel: string; event: string }>('/v2/admin/prerender/realtime-channel'),

  purge: (payload: { pattern: string; tenant_slug?: string; dry_run?: boolean; recache?: boolean; confirm_all_tenants?: boolean; preview_token?: string }) =>
    api.post<{
      pattern: string;
      tenant_slug: string | null;
      dry_run: boolean;
      deleted_count: number;
      deleted: string[];
      recache_job_id: number | null;
      preview_token: string | null;
      preview_expires_in: number | null;
      authoritative_job_id?: number | null;
    }>('/v2/admin/prerender/purge', payload),

  invalidate: (payload: { tenant_id: number; routes: string[]; recache?: boolean }) =>
    api.post<{ invalidated: number; tenant_id: number; routes: string[]; job_id: number | null }>(
      '/v2/admin/prerender/invalidate',
      payload,
    ),

  getAnalytics: (params: { since?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.since) qs.set('since', params.since);
    if (params.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return api.get<PrerenderAnalytics>(`/v2/admin/prerender/analytics${q ? `?${q}` : ''}`);
  },

  triggerAutoRecache: (apply: boolean) =>
    api.post<{ exit_code: number; output: string; applied: boolean }>(
      '/v2/admin/prerender/auto-recache',
      { apply },
    ),

  triggerDetectDrift: (apply: boolean) =>
    api.post<{ exit_code: number; output: string; applied: boolean }>(
      '/v2/admin/prerender/detect-drift',
      { apply },
    ),

  purgeUnexpected: (apply: boolean, previewToken?: string) =>
    api.post<{
      deleted_total: number;
      by_tenant: Record<string, string[]>;
      dry_run: boolean;
      preview_token: string | null;
      preview_expires_in: number | null;
    }>('/v2/admin/prerender/purge-unexpected', { apply, preview_token: previewToken }),

  // Round 2: health / audit / breaker / reset queue.
  getHealth: () =>
    api.get<PrerenderHealth>('/v2/admin/prerender/health'),

  getAudit: (action?: string, limit = 100) => {
    const q = new URLSearchParams();
    if (action) q.set('action', action);
    q.set('limit', String(limit));
    return api.get<{ items: PrerenderAuditEntry[] }>(`/v2/admin/prerender/audit?${q.toString()}`);
  },

  resetBreaker: () =>
    api.post<{ ok: boolean; was_tripped_until: number | null }>(
      '/v2/admin/prerender/reset-breaker', {},
    ),

  resetQueue: () =>
    api.post<{ rows_reset: number; breaker_cleared: boolean }>(
      '/v2/admin/prerender/reset-queue', {},
    ),

  resetAll: (confirmation: string) =>
    api.post<{
      job_id: number;
      cancelled_jobs: number;
      cancelled_active_jobs: number;
      tenant_count: number;
      planned_routes: number;
    }>('/v2/admin/prerender/reset-all', { confirmation }),

  downloadMetrics: () =>
    api.download('/v2/admin/prerender/metrics', { filename: 'nexus-prerender-metrics.txt' }),

  exportCsv: (kind: 'audit' | 'inventory' | 'jobs', action?: string) => {
    const query = action ? `?action=${encodeURIComponent(action)}` : '';
    return api.download(`/v2/admin/prerender/export/${kind}.csv${query}`, {
      filename: `prerender-${kind}.csv`,
    });
  },

  ttlInspector: (route: string) =>
    api.get<PrerenderTtlInspect>(
      `/v2/admin/prerender/ttl-inspector?route=${encodeURIComponent(route)}`,
    ),

  retryJob: (id: number) =>
    api.post<{ job_id: number; retried_from_job_id: number; job: PrerenderJob }>(
      `/v2/admin/prerender/jobs/${id}/retry`, {},
    ),

  sitemapExplorer: (tenantSlug: string) =>
    api.get<{
      tenant_slug: string;
      tenant_id: number;
      static_routes: string[];
      dynamic_routes: string[];
      total_count: number;
      truncated: boolean;
    }>(`/v2/admin/prerender/sitemap-explorer?tenant=${encodeURIComponent(tenantSlug)}`),

  /** Returns Prometheus text-format metrics. URL only — not invoked by UI. */
  metricsUrl: '/api/v2/admin/prerender/metrics',
};

export interface PrerenderHealthCheck {
  name: string;
  status: 'green' | 'yellow' | 'red';
  detail: string;
  action?: string;
}
export interface PrerenderHealth {
  status: 'green' | 'yellow' | 'red';
  checked_at: string;
  breaker_until: number | null;
  checks: PrerenderHealthCheck[];
}
export interface PrerenderTtlInspect {
  route: string;
  ttl_seconds: number;
  matched_pattern: string | null;
  source: 'pattern' | 'default';
  all_matches: Array<{ pattern: string; ttl: number; specificity: number }>;
}
export interface PrerenderAuditEntry {
  id: number;
  actor_user_id: number | null;
  actor_first?: string | null;
  actor_last?: string | null;
  actor_email?: string | null;
  action: string;
  tenant_id: number | null;
  tenant_slug?: string | null;
  job_id: number | null;
  outcome: 'ok' | 'denied' | 'error';
  details: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin (Tenant CRUD, Cross-Tenant Users, Bulk, Audit, Federation Controls)
// ─────────────────────────────────────────────────────────────────────────────

export const adminSuper = {
  // Dashboard
  getDashboard: () =>
    api.get<SuperAdminDashboardStats>('/v2/admin/super/dashboard'),

  // Tenants
  listTenants: (params: { search?: string; is_active?: boolean; hub?: boolean } = {}) =>
    api.get<SuperAdminTenant[]>(`/v2/admin/super/tenants${buildQuery(params)}`),

  getTenant: (id: number) =>
    api.get<SuperAdminTenantDetail>(`/v2/admin/super/tenants/${id}`),

  getHierarchy: () =>
    api.get<TenantHierarchyNode[]>('/v2/admin/super/tenants/hierarchy'),

  createTenant: (data: CreateTenantPayload) =>
    api.post<{ tenant_id: number }>('/v2/admin/super/tenants', data),

  updateTenant: (id: number, data: UpdateTenantPayload) =>
    api.put<{ success: boolean }>(`/v2/admin/super/tenants/${id}`, data),

  // Deactivates a tenant (is_active = 0) — reversible. Permanent removal is the
  // separate god-only purgeTenant() call below.
  deleteTenant: (id: number) =>
    api.delete<{ deleted: boolean }>(`/v2/admin/super/tenants/${id}`),

  // God-only dry run: what a purge would delete (row counts + external systems).
  purgeTenantPreview: (id: number) =>
    api.get<TenantPurgePreview>(`/v2/admin/super/tenants/${id}/purge-preview`),

  // God-only, irreversible. Enqueues a full purge of the tenant and all its data.
  // The tenant must already be deactivated.
  purgeTenant: (id: number) =>
    api.post<{ purge_started: boolean; tenant_id: number }>(`/v2/admin/super/tenants/${id}/purge`, {}),

  reactivateTenant: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/super/tenants/${id}/reactivate`),

  toggleHub: (id: number, enable: boolean) =>
    api.post<{ success: boolean }>(`/v2/admin/super/tenants/${id}/toggle-hub`, { enable }),

  moveTenant: (id: number, newParentId: number) =>
    api.post<{ success: boolean }>(`/v2/admin/super/tenants/${id}/move`, { new_parent_id: newParentId }),

  // Users (Cross-Tenant)
  listUsers: (params: SuperUserListParams = {}) =>
    api.get<SuperAdminUser[]>(`/v2/admin/super/users${buildQuery(params)}`),

  getUser: (id: number) =>
    api.get<SuperAdminUserDetail>(`/v2/admin/super/users/${id}`),

  createUser: (data: CreateSuperUserPayload) =>
    api.post<{ user_id: number }>('/v2/admin/super/users', data),

  updateUser: (id: number, data: Record<string, unknown>) =>
    api.put<{ success: boolean }>(`/v2/admin/super/users/${id}`, data),

  grantSuperAdmin: (userId: number) =>
    api.post<{ success: boolean }>(`/v2/admin/super/users/${userId}/grant-super-admin`),

  revokeSuperAdmin: (userId: number) =>
    api.post<{ success: boolean }>(`/v2/admin/super/users/${userId}/revoke-super-admin`),

  grantGlobalSuperAdmin: (userId: number) =>
    api.post<{ success: boolean }>(`/v2/admin/super/users/${userId}/grant-global-super-admin`),

  revokeGlobalSuperAdmin: (userId: number) =>
    api.post<{ success: boolean }>(`/v2/admin/super/users/${userId}/revoke-global-super-admin`),

  moveUserTenant: (userId: number, newTenantId: number) =>
    api.post<{ success: boolean }>(`/v2/admin/super/users/${userId}/move-tenant`, { new_tenant_id: newTenantId }),

  moveAndPromote: (userId: number, targetTenantId: number) =>
    api.post<{ success: boolean }>(`/v2/admin/super/users/${userId}/move-and-promote`, { target_tenant_id: targetTenantId }),

  // Bulk Operations
  bulkMoveUsers: (data: BulkMoveUsersPayload) =>
    api.post<BulkOperationResult>('/v2/admin/super/bulk/move-users', data),

  bulkUpdateTenants: (data: BulkUpdateTenantsPayload) =>
    api.post<BulkOperationResult>('/v2/admin/super/bulk/update-tenants', data),

  // Audit
  getAudit: (params: SuperAuditParams = {}) =>
    api.get<SuperAuditEntry[]>(`/v2/admin/super/audit${buildQuery(params)}`),

  // Federation Controls
  getFederationStatus: () =>
    api.get<FederationStatusOverview>('/v2/admin/super/federation'),

  getSystemControls: () =>
    api.get<FederationSystemControls>('/v2/admin/super/federation/system-controls'),

  getFederationJwtStatus: () =>
    api.get<{ configured: boolean; issuer: string; key_bits: number; recommended_bits: number }>(
      '/v2/admin/super/federation/jwt-status',
    ),

  getFederationExternalStatus: () =>
    api.get<FederationExternalStatus>('/v2/admin/super/federation/external-status'),

  updateSystemControls: (data: Partial<FederationSystemControls> & { reason?: string }) =>
    api.put<{ success: boolean }>('/v2/admin/super/federation/system-controls', data),

  emergencyLockdown: (reason: string) =>
    api.post<{ success: boolean }>('/v2/admin/super/federation/emergency-lockdown', { reason }),

  liftLockdown: () =>
    api.post<{ success: boolean }>('/v2/admin/super/federation/lift-lockdown'),

  getWhitelist: () =>
    api.get<FederationWhitelistEntry[]>('/v2/admin/super/federation/whitelist'),

  addToWhitelist: (tenantId: number, notes?: string) =>
    api.post<{ success: boolean }>('/v2/admin/super/federation/whitelist', { tenant_id: tenantId, notes }),

  removeFromWhitelist: (tenantId: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/super/federation/whitelist/${tenantId}`),

  getFederationPartnerships: () =>
    api.get<FederationPartnership[]>('/v2/admin/super/federation/partnerships'),

  suspendPartnership: (id: number, reason: string) =>
    api.post<{ success: boolean }>(`/v2/admin/super/federation/partnerships/${id}/suspend`, { reason }),

  terminatePartnership: (id: number, reason: string) =>
    api.post<{ success: boolean }>(`/v2/admin/super/federation/partnerships/${id}/terminate`, { reason }),

  reactivatePartnership: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/super/federation/partnerships/${id}/reactivate`, {}),

  getTenantFederationFeatures: (tenantId: number) =>
    api.get<TenantFederationFeatures>(`/v2/admin/super/federation/tenant/${tenantId}/features`),

  updateTenantFederationFeature: (tenantId: number, feature: string, enabled: boolean) =>
    api.put<{ success: boolean }>(`/v2/admin/super/federation/tenant/${tenantId}/features`, { feature, enabled }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Community Analytics
// ─────────────────────────────────────────────────────────────────────────────

export const adminCommunityAnalytics = {
  getData: () => api.get<{ members: Record<string, unknown>; activity: Record<string, unknown>; engagement: Record<string, unknown> }>('/v2/admin/community-analytics'),
  exportCsv: () => api.get<{ data: unknown }>('/v2/admin/community-analytics/export'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Impact Reporting
// ─────────────────────────────────────────────────────────────────────────────

export const adminImpactReport = {
  getData: (months = 12) => api.get<{
    sroi: { total_hours: number; total_transactions: number; unique_givers: number; unique_receivers: number; hourly_value: number; monetary_value: number; social_multiplier: number; social_value: number; sroi_ratio: number; period_months: number };
    health: Record<string, number>;
    timeline: Array<{ month: string; hours_exchanged: number; transactions: number; new_users: number }>;
    config: { tenant_name: string; tenant_slug: string; logo_url: string | null; hourly_value: number; social_multiplier: number };
  }>(`/v2/admin/impact-report${buildQuery({ months })}`),
  updateConfig: (data: { hourly_value?: number; social_multiplier?: number }) =>
    api.put<{ success: boolean }>('/v2/admin/impact-report/config', data),
};

// ─────────────────────────────────────────────────────────────────────────────
// Vetting Records
// ─────────────────────────────────────────────────────────────────────────────

export const adminVetting = {
  list: (params: { status?: 'all' | 'confirmed' | 'revoked' | 'expired' | 'not_confirmed' | 'review_requested'; search?: string; page?: number; per_page?: number } = {}) =>
    api.get<VettingRecord[]>(
      `/v2/admin/vetting${buildQuery(params)}`
    ),

  stats: () =>
    api.get<VettingStats>('/v2/admin/vetting/stats'),

  policy: () =>
    api.get<VettingPolicyResponse>('/v2/admin/vetting/policy'),

  updatePolicy: (jurisdiction: string) =>
    api.put<{ policy: VettingPolicyResponse['policy']; message: string }>(
      '/v2/admin/vetting/policy',
      { jurisdiction },
    ),

  show: (id: number) =>
    api.get<VettingAttestation>(`/v2/admin/vetting/${id}`),

  getUserRecords: (userId: number) =>
    api.get<VettingAttestation[]>(`/v2/admin/vetting/user/${userId}`),

  confirm: (userId: number, details: {
    certification_codes: string[];
    scope_summary: string;
    private_notes?: string;
    review_due_at: string;
    authority_expires_at?: string;
  }, reviewRequestId?: number | null) =>
    api.post<VettingAttestation>(`/v2/admin/vetting/user/${userId}/confirm`, {
      acknowledgement: true,
      ...details,
      ...(reviewRequestId ? { review_request_id: reviewRequestId } : {}),
    }),

  revoke: (userId: number, reasonCode: string, reviewRequestId?: number | null) =>
    api.post<VettingAttestation>(`/v2/admin/vetting/user/${userId}/revoke`, {
      reason_code: reasonCode,
      ...(reviewRequestId ? { review_request_id: reviewRequestId } : {}),
    }),

  resolveReview: (reviewId: number, resolutionCode: VettingPolicyResponse['review_resolution_codes'][number]) =>
    api.post(`/v2/admin/vetting/reviews/${reviewId}/resolve`, {
      resolution_code: resolutionCode,
    }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Insurance Certificates
// ─────────────────────────────────────────────────────────────────────────────

export const adminInsurance = {
  list: (params: { status?: string; insurance_type?: string; search?: string; page?: number; expiring_soon?: boolean } = {}) =>
    api.get<PaginatedResponse<InsuranceCertificate>>(
      `/v2/admin/insurance${buildQuery(params)}`
    ),

  stats: () =>
    api.get<InsuranceStats>('/v2/admin/insurance/stats'),

  show: (id: number) =>
    api.get<InsuranceCertificate>(`/v2/admin/insurance/${id}`),

  create: (data: Partial<InsuranceCertificate>) =>
    api.post<{ id: number }>('/v2/admin/insurance', data),

  update: (id: number, data: Partial<InsuranceCertificate>) =>
    api.put<{ success: boolean }>(`/v2/admin/insurance/${id}`, data),

  verify: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/insurance/${id}/verify`),

  reject: (id: number, reason: string) =>
    api.post<{ success: boolean }>(`/v2/admin/insurance/${id}/reject`, { reason }),

  destroy: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/insurance/${id}`),

  getUserCertificates: (userId: number) =>
    api.get<InsuranceCertificate[]>(`/v2/admin/insurance/user/${userId}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Cron Job Monitoring
// ─────────────────────────────────────────────────────────────────────────────

export const adminCron = {
  // Logs
  getLogs: (params?: { jobId?: string; limit?: number; offset?: number; status?: string; startDate?: string; endDate?: string }) =>
    api.get<PaginatedResponse<CronLog>>(`/v2/admin/system/cron-jobs/logs${buildQuery(params || {})}`),

  getLogDetail: (logId: number) =>
    api.get<CronLog>(`/v2/admin/system/cron-jobs/logs/${logId}`),

  clearLogs: (beforeDate: string) =>
    api.delete<{ success: boolean }>(`/v2/admin/system/cron-jobs/logs?before=${beforeDate}`),

  // Settings
  getJobSettings: (jobId: string) =>
    api.get<CronJobSettings>(`/v2/admin/system/cron-jobs/${jobId}/settings`),

  updateJobSettings: (jobId: string, data: Partial<CronJobSettings>) =>
    api.put<{ success: boolean }>(`/v2/admin/system/cron-jobs/${jobId}/settings`, data),

  getGlobalSettings: () =>
    api.get<GlobalCronSettings>('/v2/admin/system/cron-jobs/settings'),

  updateGlobalSettings: (data: Partial<GlobalCronSettings>) =>
    api.put<{ success: boolean }>('/v2/admin/system/cron-jobs/settings', data),

  // Health
  getHealthMetrics: () =>
    api.get<CronHealthMetrics>('/v2/admin/system/cron-jobs/health'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Content Moderation
// ─────────────────────────────────────────────────────────────────────────────

export const adminModeration = {
  // Feed Posts
  getFeedPosts: (params?: { type?: string; status?: string; user_id?: number; tenant_id?: number; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<AdminFeedPost>>(`/v2/admin/feed/posts${buildQuery(params || {})}`),

  getFeedPost: (id: number) =>
    api.get<AdminFeedPost>(`/v2/admin/feed/posts/${id}`),

  hideFeedPost: (id: number, type = 'post') =>
    api.post<{ success: boolean }>(`/v2/admin/feed/posts/${id}/hide`, { type }),

  deleteFeedPost: (id: number, type = 'post') =>
    api.delete<{ success: boolean }>(`/v2/admin/feed/posts/${id}?type=${encodeURIComponent(type)}`),

  getFeedStats: () =>
    api.get<ModerationStats>('/v2/admin/feed/stats'),

  // Comments
  getComments: (params?: { content_type?: string; is_flagged?: boolean; tenant_id?: number; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<AdminComment>>(`/v2/admin/comments${buildQuery(params || {})}`),

  getComment: (id: number) =>
    api.get<AdminComment>(`/v2/admin/comments/${id}`),

  hideComment: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/comments/${id}/hide`),

  deleteComment: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/comments/${id}`),

  // Reviews
  getReviews: (params?: { rating?: number; is_flagged?: boolean; tenant_id?: number; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<AdminReview>>(`/v2/admin/reviews${buildQuery(params || {})}`),

  getReview: (id: number) =>
    api.get<AdminReview>(`/v2/admin/reviews/${id}`),

  flagReview: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/reviews/${id}/flag`),

  hideReview: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/reviews/${id}/hide`),

  deleteReview: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/reviews/${id}`),

  // Reports
  getReports: (params?: { type?: string; status?: string; tenant_id?: number; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<AdminReport>>(`/v2/admin/reports${buildQuery(params || {})}`),

  getReport: (id: number) =>
    api.get<AdminReport>(`/v2/admin/reports/${id}`),

  resolveReport: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/reports/${id}/resolve`),

  dismissReport: (id: number) =>
    api.post<{ success: boolean }>(`/v2/admin/reports/${id}/dismiss`),

  getReportStats: () =>
    api.get<ModerationStats>('/v2/admin/reports/stats'),
};

// ─────────────────────────────────────────────────────────────────────────────
// CRM (Member Notes, Coordinator Tasks, Tags, Funnel)
// ─────────────────────────────────────────────────────────────────────────────

export const adminSupportReports = {
  list: (params?: {
    status?: string;
    impact?: string;
    search?: string;
    tenant_id?: number | string;
    page?: number;
    limit?: number;
  }) =>
    api.get<AdminSupportReport[]>(
      `/v2/admin/support-reports${buildQuery(params || {})}`
    ),

  stats: () =>
    api.get<AdminSupportReportStats>('/v2/admin/support-reports/stats'),

  assignees: () =>
    api.get<{ assignees: AdminSupportReportUser[] }>('/v2/admin/support-reports/assignees'),

  get: (id: number) =>
    api.get<AdminSupportReport>(`/v2/admin/support-reports/${id}`),

  update: (id: number, payload: AdminSupportReportUpdatePayload) =>
    api.put<AdminSupportReport>(`/v2/admin/support-reports/${id}`, payload),
};

export const adminCrm = {
  // Dashboard
  getDashboard: () =>
    api.get<CrmDashboardStats>('/v2/admin/crm/dashboard'),

  // Onboarding Funnel
  getFunnel: () =>
    api.get<CrmFunnelData>('/v2/admin/crm/funnel'),

  // Admin list (for task assignment)
  getAdmins: () =>
    api.get<CrmAdmin[]>('/v2/admin/crm/admins'),

  // Member Notes
  getNotes: (params?: { user_id?: number; page?: number; limit?: number; category?: string; search?: string }) =>
    api.get<PaginatedResponse<MemberNote>>(`/v2/admin/crm/notes${buildQuery(params || {})}`),

  createNote: (payload: { user_id: number; content: string; category?: string; is_pinned?: boolean }) =>
    api.post<MemberNote>('/v2/admin/crm/notes', payload),

  updateNote: (id: number, payload: { content?: string; category?: string; is_pinned?: boolean }) =>
    api.put<MemberNote>(`/v2/admin/crm/notes/${id}`, payload),

  deleteNote: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/crm/notes/${id}`),

  // Coordinator Tasks
  getTasks: (params?: { page?: number; limit?: number; status?: string; priority?: string; assigned_to?: number; search?: string }) =>
    api.get<PaginatedResponse<CoordinatorTask>>(`/v2/admin/crm/tasks${buildQuery(params || {})}`),

  createTask: (payload: { title: string; description?: string; priority?: string; assigned_to?: number; user_id?: number; due_date?: string }) =>
    api.post<CoordinatorTask>('/v2/admin/crm/tasks', payload),

  updateTask: (id: number, payload: { title?: string; description?: string; priority?: string; status?: string; assigned_to?: number; user_id?: number; due_date?: string | null }) =>
    api.put<CoordinatorTask>(`/v2/admin/crm/tasks/${id}`, payload),

  deleteTask: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/crm/tasks/${id}`),

  // Member Tags
  getTags: (params?: { user_id?: number; tag?: string }) =>
    api.get<MemberTag[] | TagSummary[]>(`/v2/admin/crm/tags${buildQuery(params || {})}`),

  addTag: (payload: { user_id: number; tag: string }) =>
    api.post<MemberTag>('/v2/admin/crm/tags', payload),

  removeTag: (id: number) =>
    api.delete<{ success: boolean }>(`/v2/admin/crm/tags/${id}`),

  bulkRemoveTag: (tag: string) =>
    api.delete<{ success: boolean; deleted: number }>(`/v2/admin/crm/tags/bulk?tag=${encodeURIComponent(tag)}`),

  // Activity Timeline
  getTimeline: (params?: { user_id?: number; type?: string; days?: number; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<TimelineEntry>>(`/v2/admin/crm/timeline${buildQuery(params || {})}`),

  // CSV Exports (return blob URLs)
  exportNotesUrl: () => '/v2/admin/crm/export/notes',
  exportTasksUrl: () => '/v2/admin/crm/export/tasks',
  exportDashboardUrl: () => '/v2/admin/crm/export/dashboard',
};

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Base
// ─────────────────────────────────────────────────────────────────────────────

export const adminKb = {
  get: (id: number) =>
    api.get(`/v2/admin/resources/${id}`),

  create: (data: {
    title: string;
    slug?: string;
    content?: string;
    content_type?: 'html' | 'plain' | 'markdown';
    video_url?: string | null;
    category_id?: number | null;
    parent_article_id?: number | null;
    sort_order?: number;
    is_published?: boolean;
  }) =>
    api.post('/v2/kb', data),

  update: (id: number, data: {
    title?: string;
    slug?: string;
    content?: string;
    content_type?: 'html' | 'plain' | 'markdown';
    video_url?: string | null;
    category_id?: number | null;
    parent_article_id?: number | null;
    sort_order?: number;
    is_published?: boolean;
  }) =>
    api.put(`/v2/kb/${id}`, data),

  delete: (id: number) =>
    api.delete(`/v2/kb/${id}`),

  uploadAttachment: (articleId: number, file: File) =>
    api.upload(`/v2/kb/${articleId}/attachments`, file),

  deleteAttachment: (articleId: number, attachmentId: number) =>
    api.delete(`/v2/kb/${articleId}/attachments/${attachmentId}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Landing Page
// ─────────────────────────────────────────────────────────────────────────────

export const adminLandingPage = {
  get: () =>
    api.get<{ config: import('../../types/landing-page').LandingPageConfig | null }>(
      '/v2/admin/config/landing-page',
    ),

  update: (config: import('../../types/landing-page').LandingPageConfig | null) =>
    api.put<{ success: boolean }>('/v2/admin/config/landing-page', { config }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Help FAQs (member help centre content)
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminHelpFaq {
  id: number;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
  is_published: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface AdminHelpFaqPayload {
  category?: string;
  question?: string;
  answer?: string;
  sort_order?: number;
  is_published?: boolean;
}

export const adminHelpFaqs = {
  list: () =>
    api.get<AdminHelpFaq[]>('/v2/admin/help/faqs'),

  create: (data: AdminHelpFaqPayload) =>
    api.post<{ id: number; created: boolean }>('/v2/admin/help/faqs', data),

  update: (id: number, data: AdminHelpFaqPayload) =>
    api.put<{ id: number; updated: boolean }>(`/v2/admin/help/faqs/${id}`, data),

  delete: (id: number) =>
    api.delete<{ id: number; deleted: boolean }>(`/v2/admin/help/faqs/${id}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Search Analytics
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchAnalyticsSummary {
  total_searches: number;
  unique_queries: number;
  zero_result_rate: number;
  avg_results: number;
  searches_by_type: Array<{ type: string | null; count: number }>;
  daily_volume: Array<{ date: string; count: number }>;
}

export interface TrendingSearch {
  query: string;
  count: number;
}

export interface ZeroResultSearch {
  query: string;
  count: number;
  last_searched: string;
}

export const adminSearchAnalytics = {
  getSummary: (days = 30) =>
    api.get<SearchAnalyticsSummary>(`/v2/admin/search/analytics?days=${days}`),

  getTrending: (days = 7, limit = 20) =>
    api.get<TrendingSearch[]>(`/v2/admin/search/trending?days=${days}&limit=${limit}`),

  getZeroResults: (days = 30, limit = 20) =>
    api.get<ZeroResultSearch[]>(`/v2/admin/search/zero-results?days=${days}&limit=${limit}`),
};

// ─────────────────────────────────────────────────────────────────────────────
// Donations (volunteering donations + Stripe refunds)
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminDonation {
  id: number;
  user_id: number | null;
  opportunity_id: number | null;
  giving_day_id: number | null;
  amount: number | string;
  currency: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  payment_route?: 'platform_default' | 'tenant_connect' | string | null;
  stripe_account_id?: string | null;
  stripe_payment_intent_id?: string | null;
  message: string | null;
  is_anonymous: boolean | number;
  status: 'pending' | 'completed' | 'refunded' | 'failed' | string;
  created_at: string | null;
}

export interface DonationFinanceOverview {
  totals: {
    completed_cents: number;
    refunded_cents: number;
    pending_cents: number;
    failed_count: number;
  };
  routing: {
    platform_fallback_cents: number;
    tenant_connect_cents: number;
    platform_fallback_count: number;
    tenant_connect_count: number;
  };
  gift_aid: {
    ready_cents: number;
    ready_count: number;
  };
  recurring: {
    active_count: number;
    past_due_count: number;
    canceled_count: number;
  };
  disputes: {
    open_count: number;
  };
  receipts: {
    failed_email_count: number;
  };
}

export interface DonationDispute {
  id: number;
  stripe_dispute_id: string;
  payment_intent_id: string | null;
  amount: number;
  currency: string;
  status: string;
  reason: string | null;
  evidence_due_at: string | null;
  payment_route: string;
  stripe_account_id: string | null;
  created_at: string | null;
}

export const adminDonations = {
  /**
   * Lists all donations for the tenant (optionally filtered by created_at
   * range). The sibling /donations/export endpoint is a text/csv download —
   * never use it as a list API.
   */
  list: (params: { date_from?: string; date_to?: string } = {}) =>
    api.get<{ items: AdminDonation[] }>(
      `/v2/admin/volunteering/donations${buildQuery(params)}`
    ),

  /** Issues a full Stripe refund for a completed donation. */
  refund: (id: number) =>
    api.post<{ success: boolean; refund_id: string }>(`/v2/admin/donations/${id}/refund`),

  /**
   * Marks a pending offline donation (cash / bank transfer / PayPal) as
   * completed. Stripe donations complete via webhook and are rejected here.
   */
  complete: (id: number) =>
    api.post<{ id: number; status: string; already_completed: boolean }>(
      `/v2/admin/volunteering/donations/${id}/complete`
    ),

  financeOverview: () =>
    api.get<{ overview: DonationFinanceOverview }>('/v2/admin/member-premium/finance/overview'),

  disputes: (limit = 50) =>
    api.get<{ items: DonationDispute[] }>(`/v2/admin/member-premium/finance/disputes?limit=${limit}`),

  giftAidExport: () =>
    api.download('/v2/admin/member-premium/finance/gift-aid-export', {
      filename: 'gift-aid-donations.csv',
    }),

  annualReceiptsExport: (year: number) =>
    api.download(`/v2/admin/member-premium/finance/annual-receipts?year=${year}`, {
      filename: `donation-annual-receipts-${year}.csv`,
    }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Re-export for convenience
// ─────────────────────────────────────────────────────────────────────────────

export type { ApiResponse };
