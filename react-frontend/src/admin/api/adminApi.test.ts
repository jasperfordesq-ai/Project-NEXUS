// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
  },
  API_BASE: 'https://api.example.com',
}));

// Import everything after the mock is set up
import {
  adminDashboard,
  adminUsers,
  adminConfig,
  adminListings,
  adminCategories,
  adminAttributes,
  adminGamification,
  adminMatching,
  adminTimebanking,
  adminBlog,
  adminMarketplace,
  adminBroker,
  adminGroups,
  adminResidency,
  adminSystem,
  adminEnterprise,
  adminLegalDocs,
  adminNewsletters,
  adminVolunteering,
  adminFederation,
  adminPages,
  adminMenus,
  adminPlans,
  adminDeliverability,
  adminDiagnostics,
  adminSettings,
  adminTools,
  adminPrerender,
  adminSuper,
  adminCommunityAnalytics,
  adminImpactReport,
  adminVetting,
  adminInsurance,
  adminCron,
  adminModeration,
  adminSupportReports,
  adminCrm,
  adminKb,
  adminLandingPage,
  adminHelpFaqs,
  adminSearchAnalytics,
  adminDonations,
} from './adminApi';

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);
const mockPut = vi.mocked(api.put);
const mockDelete = vi.mocked(api.delete);
const mockUpload = vi.mocked(api.upload);
const mockDownload = vi.mocked(api.download);

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
  mockUpload.mockReset();
  mockDownload.mockReset();
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

describe('adminDashboard', () => {
  it('getStats calls correct endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { total_users: 10 } });
    await adminDashboard.getStats();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/dashboard/stats');
  });

  it('getTrends uses default 6 months', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminDashboard.getTrends();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/dashboard/trends?months=6');
  });

  it('getTrends accepts custom months', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminDashboard.getTrends(12);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/dashboard/trends?months=12');
  });

  it('getActivity defaults page=1 limit=20', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminDashboard.getActivity();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/dashboard/activity?page=1&limit=20');
  });

  it('getActivity passes custom page/limit', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminDashboard.getActivity(3, 50);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/dashboard/activity?page=3&limit=50');
  });
});

// ─── Users ────────────────────────────────────────────────────────────────────

describe('adminUsers', () => {
  it('list with no params produces no query string', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminUsers.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/users');
  });

  it('list forwards search and role params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminUsers.list({ search: 'alice', page: 2 });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/users?search=alice&page=2');
  });

  it('get calls correct user endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { id: 5 } });
    await adminUsers.get(5);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/users/5');
  });

  it('create posts payload', async () => {
    const payload = { first_name: 'Jane', email: 'jane@example.com' };
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 99 } });
    await adminUsers.create(payload as Parameters<typeof adminUsers.create>[0]);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users', payload);
  });

  it('update puts payload to user endpoint', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.update(7, { first_name: 'Updated' });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/users/7', { first_name: 'Updated' });
  });

  it('delete calls DELETE on user endpoint', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: { success: true } });
    await adminUsers.delete(3);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/users/3');
  });

  it('approve posts to /approve', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { success: true } });
    await adminUsers.approve(10);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/10/approve');
  });

  it('suspend posts with reason', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.suspend(10, 'Spam');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/10/suspend', { reason: 'Spam' });
  });

  it('ban posts with reason', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.ban(11, 'abuse');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/11/ban', { reason: 'abuse' });
  });

  it('reactivate posts to /reactivate', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.reactivate(12);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/12/reactivate');
  });

  it('reset2fa posts reason', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.reset2fa(13, 'lost device');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/13/reset-2fa', { reason: 'lost device' });
  });

  it('addBadge posts badge_slug', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.addBadge(5, 'helper');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/5/badges', { badge_slug: 'helper' });
  });

  it('removeBadge deletes specific badge', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.removeBadge(5, 42);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/users/5/badges/42');
  });

  it('recheckAllBadges posts to /badges/recheck-all', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.recheckAllBadges();
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/badges/recheck-all');
  });

  it('impersonate posts to /impersonate', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { token: 'abc' } });
    await adminUsers.impersonate(20);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/20/impersonate');
  });

  it('setSuperAdmin puts grant flag', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.setSuperAdmin(20, true);
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/users/20/super-admin', { grant: true });
  });

  it('setGlobalSuperAdmin puts grant flag', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.setGlobalSuperAdmin(20, false);
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/users/20/global-super-admin', { grant: false });
  });

  it('recheckUserBadges posts to /badges/recheck', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { rechecked: true, user_id: 5, badges: [] } });
    await adminUsers.recheckUserBadges(5);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/5/badges/recheck');
  });

  it('getConsents calls correct endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminUsers.getConsents(5);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/users/5/consents');
  });

  it('setPassword posts password', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.setPassword(5, 'newpass');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/5/password', { password: 'newpass' });
  });

  it('sendPasswordReset posts to endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.sendPasswordReset(5);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/5/send-password-reset');
  });

  it('sendWelcomeEmail posts to endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.sendWelcomeEmail(5);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/5/send-welcome-email');
  });

  it('sendVerificationEmail posts to endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.sendVerificationEmail(5);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/5/send-verification-email');
  });

  it('bulkApprove posts user_ids', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.bulkApprove([1, 2, 3]);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/bulk-approve', { user_ids: [1, 2, 3] });
  });

  it('bulkSuspend posts user_ids and reason', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminUsers.bulkSuspend([4, 5], 'violation');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/users/bulk-suspend', { user_ids: [4, 5], reason: 'violation' });
  });

  it('importUsers calls upload with FormData', async () => {
    mockUpload.mockResolvedValueOnce({ success: true, data: { imported: 5, skipped: 0, errors: [], total_rows: 5 } });
    const file = new File(['a,b'], 'users.csv', { type: 'text/csv' });
    await adminUsers.importUsers(file, { default_role: 'member' });
    expect(mockUpload).toHaveBeenCalledOnce();
    const [url, formData] = mockUpload.mock.calls[0];
    expect(url).toBe('/v2/admin/users/import');
    expect(formData).toBeInstanceOf(FormData);
    expect((formData as FormData).get('csv_file')).toBe(file);
    expect((formData as FormData).get('default_role')).toBe('member');
  });
});

// ─── Config ───────────────────────────────────────────────────────────────────

describe('adminConfig', () => {
  it('get calls /v2/admin/config', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.get();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/config');
  });

  it('updateFeature puts feature + enabled', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.updateFeature('events', true);
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/config/features', { feature: 'events', enabled: true });
  });

  it('updateFeature sends explicit confirmation for passkey disable', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.updateFeature('biometric_login', false, { confirmDisable: true });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/config/features', {
      feature: 'biometric_login',
      enabled: false,
      confirm_disable: true,
    });
  });

  it('updateModule puts module + enabled', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.updateModule('wallet', false);
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/config/modules', { module: 'wallet', enabled: false });
  });

  it('getCacheStats calls correct endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.getCacheStats();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/cache/stats');
  });

  it('clearCache posts with default tenant type', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.clearCache();
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/cache/clear', { type: 'tenant' });
  });

  it('clearCache posts with all type', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.clearCache('all');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/cache/clear', { type: 'all' });
  });

  it('getJobs calls background-jobs endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminConfig.getJobs();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/background-jobs');
  });

  it('runJob posts to job run endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.runJob('cleanup');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/background-jobs/cleanup/run');
  });

  it('getLanguageConfig calls languages endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.getLanguageConfig();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/config/languages');
  });

  it('updateLanguageConfig puts config', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.updateLanguageConfig({ default_language: 'ga' });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/config/languages', { default_language: 'ga' });
  });

  it('getGroupConfig calls groups config endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.getGroupConfig();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/config/groups');
  });

  it('updateGroupConfig puts key+value', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.updateGroupConfig('max_members', 100);
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/config/groups', { key: 'max_members', value: 100 });
  });

  it('updateGroupConfigBulk puts settings', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.updateGroupConfigBulk({ max_members: 50, allow_join: true });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/config/groups/bulk', { settings: { max_members: 50, allow_join: true } });
  });

  it('getAuthenticationConfig calls authentication config endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.getAuthenticationConfig();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/config/authentication');
  });

  it('updateAuthenticationConfigBulk puts typed authentication settings', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    const settings = {
      'two_factor.allow_trusted_devices': false,
      'two_factor.trusted_device_days': 14,
      'two_factor.backup_code_count': 12,
      'passkeys.conditional_autofill': false,
    };

    await adminConfig.updateAuthenticationConfigBulk(settings);
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/config/authentication/bulk', { settings });
  });

  it('getGlossary without language omits param', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.getGlossary();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/translation/glossary');
  });

  it('getGlossary with language appends param', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.getGlossary('ga');
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/translation/glossary?language=ga');
  });

  it('createGlossaryEntry posts terms', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 1 } });
    await adminConfig.createGlossaryEntry('hello', 'dia dhuit', 'ga');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/translation/glossary', {
      source_term: 'hello',
      target_term: 'dia dhuit',
      target_language: 'ga',
    });
  });

  it('deleteGlossaryEntry deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminConfig.deleteGlossaryEntry(5);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/translation/glossary/5');
  });
});

// ─── Listings ─────────────────────────────────────────────────────────────────

describe('adminListings', () => {
  it('list with no params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminListings.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/listings');
  });

  it('list with params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminListings.list({ status: 'pending', page: 2 });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/listings?status=pending&page=2');
  });

  it('approve posts to /approve', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminListings.approve(7);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/listings/7/approve');
  });

  it('reject posts reason', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminListings.reject(7, 'inappropriate');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/listings/7/reject', { reason: 'inappropriate' });
  });

  it('reject with no reason passes empty object', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminListings.reject(7);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/listings/7/reject', {});
  });

  it('feature posts to /feature', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminListings.feature(7);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/listings/7/feature');
  });

  it('unfeature deletes /feature', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminListings.unfeature(7);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/listings/7/feature');
  });

  it('delete calls DELETE on listing', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminListings.delete(7);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/listings/7');
  });

  it('getFeatured returns featured listings', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminListings.getFeatured();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/listings/featured');
  });
});

// ─── Categories ───────────────────────────────────────────────────────────────

describe('adminCategories', () => {
  it('list with type param', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminCategories.list({ type: 'skill' });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/categories?type=skill');
  });

  it('list without params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminCategories.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/categories');
  });

  it('create posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminCategories.create({ name: 'Tech', color: '#f00' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/categories', { name: 'Tech', color: '#f00' });
  });

  it('update puts data', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminCategories.update(3, { name: 'Updated' });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/categories/3', { name: 'Updated' });
  });

  it('delete calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminCategories.delete(3);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/categories/3');
  });
});

// ─── Attributes ───────────────────────────────────────────────────────────────

describe('adminAttributes', () => {
  it('list calls correct endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminAttributes.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/attributes');
  });

  it('create posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminAttributes.create({ name: 'Skill Level', type: 'select' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/attributes', { name: 'Skill Level', type: 'select' });
  });

  it('update puts data', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminAttributes.update(2, { is_active: false });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/attributes/2', { is_active: false });
  });

  it('delete calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminAttributes.delete(2);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/attributes/2');
  });
});

// ─── Gamification ─────────────────────────────────────────────────────────────

describe('adminGamification', () => {
  it('getStats calls stats endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminGamification.getStats();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/gamification/stats');
  });

  it('recheckAll posts to recheck-all', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminGamification.recheckAll();
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/gamification/recheck-all');
  });

  it('bulkAward posts badge_slug and user_ids', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminGamification.bulkAward('helper', [1, 2, 3]);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/gamification/bulk-award', {
      badge_slug: 'helper',
      user_ids: [1, 2, 3],
    });
  });

  it('listCampaigns calls campaigns endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminGamification.listCampaigns();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/gamification/campaigns');
  });

  it('createCampaign posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminGamification.createCampaign({ name: 'Summer' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/gamification/campaigns', { name: 'Summer' });
  });

  it('updateCampaign puts data', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminGamification.updateCampaign(5, { name: 'Updated' });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/gamification/campaigns/5', { name: 'Updated' });
  });

  it('deleteCampaign calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminGamification.deleteCampaign(5);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/gamification/campaigns/5');
  });

  it('listBadges calls badges endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminGamification.listBadges();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/gamification/badges');
  });

  it('createBadge posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminGamification.createBadge({ name: 'Star', description: 'A star' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/gamification/badges', { name: 'Star', description: 'A star' });
  });

  it('deleteBadge calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminGamification.deleteBadge(3);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/gamification/badges/3');
  });

  it('getBadgeConfig calls config endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminGamification.getBadgeConfig();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/gamification/badge-config');
  });

  it('updateBadgeConfig puts data to badge key endpoint', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminGamification.updateBadgeConfig('first_exchange', { threshold: 1 });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/gamification/badge-config/first_exchange', { threshold: 1 });
  });

  it('resetBadgeConfig posts to reset endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminGamification.resetBadgeConfig('first_exchange');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/gamification/badge-config/first_exchange/reset');
  });
});

// ─── Matching ─────────────────────────────────────────────────────────────────

describe('adminMatching', () => {
  it('getConfig calls config endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminMatching.getConfig();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/matching/config');
  });

  it('updateConfig puts data', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminMatching.updateConfig({ min_score: 0.7 });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/matching/config', { min_score: 0.7 });
  });

  it('getApprovals with no params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminMatching.getApprovals();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/matching/approvals');
  });

  it('getApprovals with status param', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminMatching.getApprovals({ status: 'pending' });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/matching/approvals?status=pending');
  });

  it('getApproval fetches single', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminMatching.getApproval(5);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/matching/approvals/5');
  });

  it('getApprovalStats defaults to 30 days', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminMatching.getApprovalStats();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/matching/approvals/stats?days=30');
  });

  it('approveMatch posts notes', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminMatching.approveMatch(5, 'looks good');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/matching/approvals/5/approve', { notes: 'looks good' });
  });

  it('rejectMatch posts reason', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminMatching.rejectMatch(5, 'no match');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/matching/approvals/5/reject', { reason: 'no match' });
  });

  it('clearCache posts to cache clear', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminMatching.clearCache();
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/matching/cache/clear');
  });
});

// ─── Timebanking ──────────────────────────────────────────────────────────────

describe('adminTimebanking', () => {
  it('getStats calls stats endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminTimebanking.getStats();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/timebanking/stats');
  });

  it('getAlerts with no params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminTimebanking.getAlerts();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/timebanking/alerts');
  });

  it('updateAlertStatus puts status', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminTimebanking.updateAlertStatus(3, 'reviewed');
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/timebanking/alerts/3', { status: 'reviewed' });
  });

  it('adjustBalance posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminTimebanking.adjustBalance(10, 5, 'correction');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/timebanking/adjust-balance', {
      user_id: 10,
      amount: 5,
      reason: 'correction',
    });
  });

  it('getCommunityFund calls community-fund endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminTimebanking.getCommunityFund();
    expect(mockGet).toHaveBeenCalledWith('/v2/wallet/community-fund');
  });

  it('depositCommunityFund posts amount and description', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminTimebanking.depositCommunityFund(10, 'donation');
    expect(mockPost).toHaveBeenCalledWith('/v2/wallet/community-fund/deposit', {
      amount: 10,
      description: 'donation',
    });
  });

  it('withdrawCommunityFund posts recipient, amount, description', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminTimebanking.withdrawCommunityFund(5, 3, 'grant');
    expect(mockPost).toHaveBeenCalledWith('/v2/wallet/community-fund/withdraw', {
      recipient_id: 5,
      amount: 3,
      description: 'grant',
    });
  });

  it('grantCredits posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminTimebanking.grantCredits({ user_id: 5, amount: 10, reason: 'onboarding' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/wallet/grant', {
      user_id: 5,
      amount: 10,
      reason: 'onboarding',
    });
  });

  it('downloadStatementCsv calls download with correct args', async () => {
    mockDownload.mockResolvedValueOnce(undefined);
    await adminTimebanking.downloadStatementCsv(7, '2025-01-01', '2025-12-31');
    expect(mockDownload).toHaveBeenCalledOnce();
    const [url, opts] = mockDownload.mock.calls[0];
    expect(url).toContain('/v2/admin/timebanking/user-statement');
    expect(url).toContain('user_id=7');
    expect(url).toContain('format=csv');
    expect(url).toContain('start_date=2025-01-01');
    expect((opts as { filename: string }).filename).toMatch(/^statement_7_/);
  });
});

// ─── Blog ─────────────────────────────────────────────────────────────────────

describe('adminBlog', () => {
  it('list with no params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminBlog.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/blog');
  });

  it('list with params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminBlog.list({ status: 'published', page: 1 });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/blog?status=published&page=1');
  });

  it('get calls individual post endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminBlog.get(8);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/blog/8');
  });

  it('create posts payload', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminBlog.create({ title: 'Hello', content: 'World' } as Parameters<typeof adminBlog.create>[0]);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/blog', { title: 'Hello', content: 'World' });
  });

  it('update puts payload', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminBlog.update(8, { title: 'Updated' });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/blog/8', { title: 'Updated' });
  });

  it('delete calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminBlog.delete(8);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/blog/8');
  });

  it('toggleStatus posts to toggle endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminBlog.toggleStatus(8);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/blog/8/toggle-status');
  });

  it('bulkDelete posts post_ids', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminBlog.bulkDelete([1, 2, 3]);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/blog/bulk-delete', { post_ids: [1, 2, 3] });
  });

  it('bulkPublish posts post_ids', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminBlog.bulkPublish([4, 5]);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/blog/bulk-publish', { post_ids: [4, 5] });
  });

  it('uploadFeaturedImage sends blog-scoped multipart upload', async () => {
    mockUpload.mockResolvedValueOnce({ success: true, data: { url: 'https://api.example.test/storage/blog.webp' } });
    const file = new File(['image'], 'blog.webp', { type: 'image/webp' });
    const onUploadProgress = vi.fn();

    await adminBlog.uploadFeaturedImage(file, onUploadProgress);

    expect(mockUpload).toHaveBeenCalledWith(
      '/v2/upload',
      expect.any(FormData),
      'file',
      { onUploadProgress },
    );
    const formData = mockUpload.mock.calls[0][1] as FormData;
    expect(formData.get('file')).toBe(file);
    expect(formData.get('type')).toBe('blog');
  });
});

// ─── Marketplace ──────────────────────────────────────────────────────────────

describe('adminMarketplace', () => {
  it('bulkReject posts listing_ids and reason', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminMarketplace.bulkReject([1, 2], 'policy violation');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/marketplace/bulk-reject', {
      listing_ids: [1, 2],
      reason: 'policy violation',
    });
  });
});

// ─── Broker ───────────────────────────────────────────────────────────────────

describe('adminBroker', () => {
  it('getDashboard calls dashboard endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminBroker.getDashboard();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/broker/dashboard');
  });

  it('getExchanges with no params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminBroker.getExchanges();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/broker/exchanges');
  });

  it('approveExchange posts notes', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminBroker.approveExchange(5, 'all good');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/broker/exchanges/5/approve', { notes: 'all good' });
  });

  it('rejectExchange posts reason', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminBroker.rejectExchange(5, 'policy breach');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/broker/exchanges/5/reject', { reason: 'policy breach' });
  });

  it('getRiskTags with no params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminBroker.getRiskTags();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/broker/risk-tags');
  });

  it('getMessages with filter param', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminBroker.getMessages({ filter: 'flagged', page: 1 });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/broker/messages?filter=flagged&page=1');
  });

  it('getUnreviewedCount calls unreviewed-count endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { count: 3 } });
    await adminBroker.getUnreviewedCount();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/broker/messages/unreviewed-count');
  });

  it('flagMessage posts reason and severity', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminBroker.flagMessage(7, 'suspicious', 'warning');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/broker/messages/7/flag', {
      reason: 'suspicious',
      severity: 'warning',
    });
  });

  it('setMonitoring posts monitoring data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminBroker.setMonitoring(10, { under_monitoring: true, reason: 'risk' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/broker/monitoring/10', {
      under_monitoring: true,
      reason: 'risk',
    });
  });

  it('saveRiskTag posts risk data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminBroker.saveRiskTag(15, { risk_level: 'high', risk_category: 'safety' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/broker/risk-tags/15', {
      risk_level: 'high',
      risk_category: 'safety',
    });
  });

  it('removeRiskTag deletes tag', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminBroker.removeRiskTag(15);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/broker/risk-tags/15');
  });

  it('showExchange fetches exchange detail', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminBroker.showExchange(5);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/broker/exchanges/5');
  });

  it('getArchives with params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminBroker.getArchives({ decision: 'approved', page: 1 });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/broker/archives?decision=approved&page=1');
  });
});

// ─── Groups ───────────────────────────────────────────────────────────────────

describe('adminGroups', () => {
  it('list with search param', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminGroups.list({ search: 'tech', page: 1 });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/groups?search=tech&page=1');
  });

  it('getAnalytics calls analytics endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminGroups.getAnalytics();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/groups/analytics');
  });

  it('getApprovals calls approvals endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminGroups.getApprovals();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/groups/approvals');
  });

  it('approveMember posts to approve', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminGroups.approveMember(3);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/groups/approvals/3/approve');
  });

  it('rejectMember posts to reject', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminGroups.rejectMember(3);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/groups/approvals/3/reject');
  });

  it('updateStatus puts status', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminGroups.updateStatus(5, 'active');
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/groups/5/status', { status: 'active' });
  });

  it('delete calls DELETE on group', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminGroups.delete(5);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/groups/5');
  });

  it('promoteMember posts empty body', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminGroups.promoteMember(5, 10);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/groups/5/members/10/promote', {});
  });

  it('kickMember deletes member', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminGroups.kickMember(5, 10);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/groups/5/members/10');
  });

  it('getTags with query', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminGroups.getTags({ q: 'sport', limit: 10 });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/group-tags?q=sport&limit=10');
  });

  it('createTag posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminGroups.createTag({ name: 'sport', color: '#f00' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/group-tags', { name: 'sport', color: '#f00' });
  });

  it('deleteTag calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminGroups.deleteTag(9);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/group-tags/9');
  });

  it('getCollections calls endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminGroups.getCollections();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/group-collections');
  });

  it('createCollection posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminGroups.createCollection({ name: 'Featured', sort_order: 1 });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/group-collections', { name: 'Featured', sort_order: 1 });
  });

  it('setCollectionGroups puts group_ids', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminGroups.setCollectionGroups(2, [1, 2, 3]);
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/group-collections/2/groups', { group_ids: [1, 2, 3] });
  });

  it('createAutoAssignRule posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminGroups.createAutoAssignRule({ group_id: 5, rule_type: 'location' as Parameters<typeof adminGroups.createAutoAssignRule>[0]['rule_type'], rule_value: 'Dublin' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/group-auto-assign-rules', {
      group_id: 5,
      rule_type: 'location',
      rule_value: 'Dublin',
    });
  });

  it('updateAutoAssignRule updates the tenant-scoped rule state', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: { id: 17 } });
    await adminGroups.updateAutoAssignRule(17, { is_active: false });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/group-auto-assign-rules/17', {
      is_active: false,
    });
  });
});

// ─── Residency ────────────────────────────────────────────────────────────────

describe('adminResidency', () => {
  it('list defaults to pending status', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminResidency.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/residency-verifications?status=pending');
  });

  it('list with all status', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminResidency.list('all');
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/residency-verifications?status=all');
  });

  it('attest with decision only', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminResidency.attest(3, 'approved');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/residency-verifications/3/attest', { decision: 'approved' });
  });

  it('attest with reason includes it', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminResidency.attest(3, 'rejected', 'not eligible');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/residency-verifications/3/attest', {
      decision: 'rejected',
      reason: 'not eligible',
    });
  });
});

// ─── System ───────────────────────────────────────────────────────────────────

describe('adminSystem', () => {
  it('getCronJobs calls cron-jobs endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminSystem.getCronJobs();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/system/cron-jobs');
  });

  it('runCronJob posts to /run', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminSystem.runCronJob(2);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/system/cron-jobs/2/run');
  });

  it('getActivityLog with params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminSystem.getActivityLog({ page: 2, limit: 50 });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/system/activity-log?page=2&limit=50');
  });
});

// ─── Enterprise ───────────────────────────────────────────────────────────────

describe('adminEnterprise', () => {
  it('getDashboard calls enterprise dashboard', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminEnterprise.getDashboard();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/enterprise/dashboard');
  });

  it('getRoles calls roles endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminEnterprise.getRoles();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/enterprise/roles');
  });

  it('createRole posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminEnterprise.createRole({ name: 'Moderator', description: 'Mods', permissions: ['edit'] });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/enterprise/roles', {
      name: 'Moderator',
      description: 'Mods',
      permissions: ['edit'],
    });
  });

  it('deleteRole calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminEnterprise.deleteRole(3);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/enterprise/roles/3');
  });

  it('getGdprRequests with status param', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminEnterprise.getGdprRequests({ status: 'pending' });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/enterprise/gdpr/requests?status=pending');
  });

  it('createBreach posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminEnterprise.createBreach({ title: 'Data leak', severity: 'high' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/enterprise/gdpr/breaches', {
      title: 'Data leak',
      severity: 'high',
    });
  });

  it('getGdprAuditExportUrl builds URL with params', () => {
    const url = adminEnterprise.getGdprAuditExportUrl({ action: 'export', date_from: '2025-01-01' });
    expect(url).toContain('/v2/admin/enterprise/gdpr/audit/export');
    expect(url).toContain('action=export');
    expect(url).toContain('date_from=2025-01-01');
  });

  it('notifyDpa posts to notify-dpa endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminEnterprise.notifyDpa(5);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/enterprise/gdpr/breaches/5/notify-dpa');
  });

  it('getLogFile with params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminEnterprise.getLogFile('laravel.log', { lines: 100, level: 'error' });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/enterprise/monitoring/log-files/laravel.log?lines=100&level=error');
  });

  it('clearLogFile deletes file', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminEnterprise.clearLogFile('laravel.log');
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/enterprise/monitoring/log-files/laravel.log');
  });

  it('exportConsentTypeUsers returns URL string (no api call)', () => {
    const url = adminEnterprise.exportConsentTypeUsers('gdpr-terms');
    expect(url).toBe('/v2/admin/enterprise/gdpr/consent-types/gdpr-terms/export');
  });
});

// ─── Legal Docs ───────────────────────────────────────────────────────────────

describe('adminLegalDocs', () => {
  it('list calls legal-documents endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminLegalDocs.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/legal-documents');
  });

  it('create posts document data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminLegalDocs.create({ title: 'Terms', content: 'content', type: 'terms' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/legal-documents', {
      title: 'Terms',
      content: 'content',
      type: 'terms',
    });
  });

  it('compareVersions builds correct URL', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminLegalDocs.compareVersions(3, 1, 2);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/legal-documents/3/versions/compare?v1=1&v2=2');
  });

  it('publishVersion posts to publish endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminLegalDocs.publishVersion(5);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/legal-documents/versions/5/publish', {});
  });

  it('getComplianceStats without doc_id', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminLegalDocs.getComplianceStats();
    // undefined doc_id is filtered out by buildQuery
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/legal-documents/compliance');
  });

  it('notifyUsers posts notify payload', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminLegalDocs.notifyUsers(3, 7, { target: 'non_accepted' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/legal-documents/3/versions/7/notify', {
      target: 'non_accepted',
    });
  });
});

// ─── Newsletters ──────────────────────────────────────────────────────────────

describe('adminNewsletters', () => {
  it('list with status param', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminNewsletters.list({ status: 'draft' });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/newsletters?status=draft');
  });

  it('create posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminNewsletters.create({ subject: 'Hello', content: 'body' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/newsletters', { subject: 'Hello', content: 'body' });
  });

  it('sendNewsletter posts to /send with a raised timeout', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminNewsletters.sendNewsletter(4);
    // The send resolves recipients and delivers a first batch inline, so it needs
    // longer than the 30s default — that default is what reported 'Request Timed
    // Out' for sends that had actually gone out.
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/newsletters/4/send', {}, { timeout: 60000 });
  });

  it('sendTest posts to /send-test', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminNewsletters.sendTest(4);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/newsletters/4/send-test', {});
  });

  it('unsuppress posts to unsuppress endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminNewsletters.unsuppress('test@example.com');
    expect(mockPost).toHaveBeenCalledWith(
      `/v2/admin/newsletters/suppression-list/${encodeURIComponent('test@example.com')}/unsuppress`,
      {}
    );
  });

  it('suppress posts to suppress endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminNewsletters.suppress('test@example.com');
    expect(mockPost).toHaveBeenCalledWith(
      `/v2/admin/newsletters/suppression-list/${encodeURIComponent('test@example.com')}/suppress`,
      {}
    );
  });

  it('importSubscribers posts rows', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminNewsletters.importSubscribers([{ email: 'a@b.com' }]);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/newsletters/subscribers/import', {
      rows: [{ email: 'a@b.com' }],
    });
  });

  it('selectAbWinner posts winner', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminNewsletters.selectAbWinner(4, 'a');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/newsletters/4/ab-winner', { winner: 'a' });
  });

  it('getRecipientCount posts params', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { count: 200 } });
    await adminNewsletters.getRecipientCount({ target_audience: 'all' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/newsletters/recipient-count', { target_audience: 'all' });
  });

  it('duplicateNewsletter posts to /duplicate', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminNewsletters.duplicateNewsletter(4);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/newsletters/4/duplicate', {});
  });

  it('previewSegment posts rules', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { matching_count: 50 } });
    await adminNewsletters.previewSegment({ match: 'all' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/newsletters/segments/preview', { match: 'all' });
  });
});

// ─── Volunteering ─────────────────────────────────────────────────────────────

describe('adminVolunteering', () => {
  it('getOverview calls volunteering endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminVolunteering.getOverview();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/volunteering');
  });

  it('approveApplication posts to approve', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminVolunteering.approveApplication(3);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/volunteering/approvals/3/approve', {});
  });

  it('declineApplication posts to decline', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminVolunteering.declineApplication(3);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/volunteering/approvals/3/decline', {});
  });

  it('verifyHours posts action', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminVolunteering.verifyHours(10, 'approve');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/volunteering/hours/10/verify', { action: 'approve' });
  });

  it('getTrends with default period', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminVolunteering.getTrends();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/volunteering/trends?period=week');
  });

  it('getActivityFeed with defaults', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminVolunteering.getActivityFeed();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/volunteering/activity-feed?limit=20&days=30');
  });

  it('listHours with no params calls base endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminVolunteering.listHours();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/volunteering/hours');
  });

  it('listHours with status builds query string', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminVolunteering.listHours({ status: 'pending' });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/volunteering/hours?status=pending');
  });

  it('exportExpenses calls download', async () => {
    mockDownload.mockResolvedValueOnce(undefined);
    await adminVolunteering.exportExpenses('expenses.csv');
    expect(mockDownload).toHaveBeenCalledWith('/v2/admin/volunteering/expenses/export', { filename: 'expenses.csv' });
  });

  it('reorderCustomFields posts field_ids', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminVolunteering.reorderCustomFields([3, 1, 2]);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/volunteering/custom-fields/reorder', { field_ids: [3, 1, 2] });
  });

  it('getGivingDayDonors with cursor', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminVolunteering.getGivingDayDonors(5, 'cursor123');
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/volunteering/giving-days/5/donors?per_page=20&cursor=cursor123');
  });
});

// ─── Federation ───────────────────────────────────────────────────────────────

describe('adminFederation', () => {
  it('getSettings calls federation settings', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminFederation.getSettings();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/federation/settings');
  });

  it('updateSettings puts data', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminFederation.updateSettings({ enabled: true });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/federation/settings', { enabled: true });
  });

  it('approvePartnership posts to approve', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminFederation.approvePartnership(3);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/federation/partnerships/3/approve', {});
  });

  it('requestPartnership posts target and notes', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminFederation.requestPartnership(5, 'hello');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/federation/partnerships/request', {
      target_tenant_id: 5,
      notes: 'hello',
    });
  });

  it('updateMyTopics puts topic and primary ids', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: [] });
    await adminFederation.updateMyTopics([1, 2], [1]);
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/federation/topics/mine', {
      topic_ids: [1, 2],
      primary_ids: [1],
    });
  });

  it('createApiKey posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminFederation.createApiKey({ name: 'MyKey', scopes: ['read'] });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/federation/api-keys', { name: 'MyKey', scopes: ['read'] });
  });

  it('revokeApiKey posts to revoke', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminFederation.revokeApiKey(7);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/federation/api-keys/7/revoke', {});
  });

  it('getAnalyticsOverview uses default 30d range', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminFederation.getAnalyticsOverview();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/federation/analytics/overview?range=30d');
  });

  it('purgeFederationData posts days', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminFederation.purgeFederationData(90);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/federation/data/purge', { days: 90 });
  });

  it('rotateAggregateSecret posts to rotate-secret', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminFederation.rotateAggregateSecret();
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/federation/aggregate-consent/rotate-secret', {});
  });
});

// ─── Pages ────────────────────────────────────────────────────────────────────

describe('adminPages', () => {
  it('list calls pages endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminPages.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/pages');
  });

  it('create posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminPages.create({ title: 'About', status: 'published' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/pages', { title: 'About', status: 'published' });
  });

  it('delete calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminPages.delete(3);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/pages/3');
  });
});

// ─── Menus ────────────────────────────────────────────────────────────────────

describe('adminMenus', () => {
  it('list calls menus endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminMenus.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/menus');
  });

  it('createItem posts to menu items endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminMenus.createItem(2, { label: 'Home', url: '/' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/menus/2/items', { label: 'Home', url: '/' });
  });

  it('updateItem puts to menu-items endpoint', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminMenus.updateItem(5, { label: 'About' });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/menu-items/5', { label: 'About' });
  });

  it('deleteItem calls DELETE on menu-items', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminMenus.deleteItem(5);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/menu-items/5');
  });

  it('reorderItems posts items array', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminMenus.reorderItems(2, [{ id: 1, sort_order: 0 }, { id: 2, sort_order: 1 }]);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/menus/2/items/reorder', {
      items: [{ id: 1, sort_order: 0 }, { id: 2, sort_order: 1 }],
    });
  });
});

// ─── Plans ────────────────────────────────────────────────────────────────────

describe('adminPlans', () => {
  it('list calls plans endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminPlans.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/plans');
  });

  it('syncStripe posts to sync-stripe', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminPlans.syncStripe(3);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/plans/3/sync-stripe', {});
  });

  it('getSubscriptions calls subscriptions endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminPlans.getSubscriptions();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/subscriptions');
  });
});

// ─── Deliverability ───────────────────────────────────────────────────────────

describe('adminDeliverability', () => {
  it('getDashboard calls dashboard endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminDeliverability.getDashboard();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/deliverability/dashboard');
  });

  it('list with params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminDeliverability.list({ status: 'open', page: 1 });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/deliverability?status=open&page=1');
  });

  it('addComment posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminDeliverability.addComment(3, { comment_text: 'noted' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/deliverability/3/comments', { comment_text: 'noted' });
  });
});

// ─── Diagnostics ──────────────────────────────────────────────────────────────

describe('adminDiagnostics', () => {
  it('diagnoseUser builds user_id query', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminDiagnostics.diagnoseUser(5);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/matching/stats?user_id=5');
  });

  it('diagnoseListing builds listing_id query', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminDiagnostics.diagnoseListing(10);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/matching/stats?listing_id=10');
  });

  it('getMatchingStats calls stats endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminDiagnostics.getMatchingStats();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/matching/stats');
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

describe('adminSettings', () => {
  it('get calls settings endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminSettings.get();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/settings');
  });

  it('update puts data', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminSettings.update({ community_name: 'NEXUS' });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/settings', { community_name: 'NEXUS' });
  });

  it('uploadPartnerLogo calls upload with logo field', async () => {
    mockUpload.mockResolvedValueOnce({ success: true, data: { url: '/logo.png' } });
    const file = new File(['img'], 'logo.png', { type: 'image/png' });
    await adminSettings.uploadPartnerLogo(file);
    expect(mockUpload).toHaveBeenCalledWith('/v2/admin/settings/partner-logo', file, 'logo');
  });

  it('removeHeaderLogo calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminSettings.removeHeaderLogo();
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/settings/header-logo');
  });

  it('saveHeaderColors puts color data', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminSettings.saveHeaderColors('#000', '#005ea2');
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/settings/header-colors', {
      bg_color: '#000',
      accent_color: '#005ea2',
    });
  });

  it('saveHeaderColors with nulls sends empty strings', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminSettings.saveHeaderColors(null, null);
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/settings/header-colors', {
      bg_color: '',
      accent_color: '',
    });
  });

  it('testEmailProvider posts to email/test-provider', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminSettings.testEmailProvider({ to: 'test@example.com' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/email/test-provider', { to: 'test@example.com' });
  });

  it('getSitemapStats calls sitemap-stats endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminSettings.getSitemapStats();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/config/sitemap-stats');
  });

  it('clearSitemapCache posts to sitemap-clear-cache', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { cleared: 10 } });
    await adminSettings.clearSitemapCache();
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/config/sitemap-clear-cache');
  });
});

// ─── Tools ────────────────────────────────────────────────────────────────────

describe('adminTools', () => {
  it('getRedirects calls redirects endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminTools.getRedirects();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/tools/redirects');
  });

  it('createRedirect posts source and destination', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminTools.createRedirect({ source_url: '/old', destination_url: '/new' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/tools/redirects', {
      source_url: '/old',
      destination_url: '/new',
    });
  });

  it('deleteRedirect calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminTools.deleteRedirect(5);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/tools/redirects/5');
  });

  it('get404Errors with default params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminTools.get404Errors();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/tools/404-errors?page=1&per_page=50');
  });

  it('runHealthCheck posts to health-check', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: [] });
    await adminTools.runHealthCheck();
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/tools/health-check');
  });

  it('runWebpConversion posts to webp-convert', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminTools.runWebpConversion();
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/tools/webp-convert');
  });

  it('runSeedGenerator posts types and counts', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminTools.runSeedGenerator({ types: ['users'], counts: { users: 10 } });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/tools/seed', {
      types: ['users'],
      counts: { users: 10 },
    });
  });

  it('runSeoAudit posts to seo-audit', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: [] });
    await adminTools.runSeoAudit();
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/tools/seo-audit');
  });

  it('getSeoAudit gets the latest code-based audit result', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: null });
    await adminTools.getSeoAudit();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/tools/seo-audit');
  });

  it('restoreBlogBackup posts to restore', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminTools.restoreBlogBackup(2);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/tools/blog-backups/2/restore');
  });
});

// ─── Prerender ────────────────────────────────────────────────────────────────

describe('adminPrerender', () => {
  it('getSummary calls summary endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.getSummary();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/prerender/summary');
  });

  it('getInventory without tenant', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.getInventory();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/prerender/inventory');
  });

  it('getInventory with tenant encodes it', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.getInventory('hour-timebank');
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/prerender/inventory?tenant=hour-timebank');
  });

  it('inspect encodes cache path', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.inspect('/cache/path/here');
    expect(mockGet).toHaveBeenCalledWith(
      `/v2/admin/prerender/inspect?path=${encodeURIComponent('/cache/path/here')}`
    );
  });

  it('getEvents with default limit', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.getEvents();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/prerender/events?limit=200');
  });

  it('enqueueJob posts payload', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.enqueueJob({ tenant_slug: 'hour-timebank', force: true });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/prerender/jobs', {
      tenant_slug: 'hour-timebank',
      force: true,
    });
  });

  it('cancelJob posts to /cancel', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.cancelJob(5);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/prerender/jobs/5/cancel', {});
  });

  it('purge posts payload', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.purge({ pattern: '/**', dry_run: true });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/prerender/purge', { pattern: '/**', dry_run: true });
  });

  it('invalidate posts routes payload', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.invalidate({ tenant_id: 2, routes: ['/about', '/blog'] });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/prerender/invalidate', {
      tenant_id: 2,
      routes: ['/about', '/blog'],
    });
  });

  it('triggerAutoRecache posts apply flag', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.triggerAutoRecache(false);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/prerender/auto-recache', { apply: false });
  });

  it('resetBreaker posts to reset-breaker', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.resetBreaker();
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/prerender/reset-breaker', {});
  });

  it('resetQueue posts to reset-queue', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.resetQueue();
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/prerender/reset-queue', {});
  });

  it('resetAll posts the typed confirmation phrase', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.resetAll('RESET ALL SNAPSHOTS');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/prerender/reset-all', {
      confirmation: 'RESET ALL SNAPSHOTS',
    });
  });

  it('downloadMetrics uses an authenticated API download', async () => {
    mockDownload.mockResolvedValueOnce(undefined);
    await adminPrerender.downloadMetrics();
    expect(mockDownload).toHaveBeenCalledWith('/v2/admin/prerender/metrics', {
      filename: 'nexus-prerender-metrics.txt',
    });
  });

  it('exportCsv uses an authenticated API download with encoded filters', async () => {
    mockDownload.mockResolvedValueOnce(undefined);
    await adminPrerender.exportCsv('audit', 'reset all');
    expect(mockDownload).toHaveBeenCalledWith(
      '/v2/admin/prerender/export/audit.csv?action=reset%20all',
      { filename: 'prerender-audit.csv' },
    );
  });

  it('ttlInspector encodes route', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.ttlInspector('/about');
    expect(mockGet).toHaveBeenCalledWith(`/v2/admin/prerender/ttl-inspector?route=${encodeURIComponent('/about')}`);
  });

  it('sitemapExplorer encodes tenant slug', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.sitemapExplorer('hour-timebank');
    expect(mockGet).toHaveBeenCalledWith(`/v2/admin/prerender/sitemap-explorer?tenant=hour-timebank`);
  });

  it('metricsUrl is the correct string constant', () => {
    expect(adminPrerender.metricsUrl).toBe('/api/v2/admin/prerender/metrics');
  });

  it('listJobs with status and limit', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminPrerender.listJobs({ status: 'queued', limit: 50 });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/prerender/jobs?status=queued&limit=50');
  });
});

// ─── Super Admin ──────────────────────────────────────────────────────────────

describe('adminSuper', () => {
  it('getDashboard calls super dashboard', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.getDashboard();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/super/dashboard');
  });

  it('listTenants with search param', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminSuper.listTenants({ search: 'hour' });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/super/tenants?search=hour');
  });

  it('createTenant posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.createTenant({ name: 'New Tenant', slug: 'new-tenant' } as Parameters<typeof adminSuper.createTenant>[0]);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/super/tenants', { name: 'New Tenant', slug: 'new-tenant' });
  });

  it('deleteTenant deactivates (no query string)', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.deleteTenant(5);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/super/tenants/5');
  });

  it('purgeTenant posts to the purge endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.purgeTenant(5);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/super/tenants/5/purge', {});
  });

  it('purgeTenantPreview gets the dry-run report', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.purgeTenantPreview(5);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/super/tenants/5/purge-preview');
  });

  it('toggleHub posts enable flag', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.toggleHub(3, true);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/super/tenants/3/toggle-hub', { enable: true });
  });

  it('moveTenant posts new_parent_id', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.moveTenant(3, 10);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/super/tenants/3/move', { new_parent_id: 10 });
  });

  it('grantSuperAdmin posts to grant endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.grantSuperAdmin(7);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/super/users/7/grant-super-admin');
  });

  it('emergencyLockdown posts reason', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.emergencyLockdown('security breach');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/super/federation/emergency-lockdown', { reason: 'security breach' });
  });

  it('addToWhitelist posts tenant_id', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.addToWhitelist(5, 'trusted');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/super/federation/whitelist', {
      tenant_id: 5,
      notes: 'trusted',
    });
  });

  it('removeFromWhitelist deletes tenant', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.removeFromWhitelist(5);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/super/federation/whitelist/5');
  });

  it('updateTenantFederationFeature puts feature + enabled', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.updateTenantFederationFeature(2, 'cross_listings', true);
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/super/federation/tenant/2/features', {
      feature: 'cross_listings',
      enabled: true,
    });
  });

  it('bulkMoveUsers posts payload', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminSuper.bulkMoveUsers({ user_ids: [1, 2], target_tenant_id: 3 } as Parameters<typeof adminSuper.bulkMoveUsers>[0]);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/super/bulk/move-users', {
      user_ids: [1, 2],
      target_tenant_id: 3,
    });
  });
});

// ─── Community Analytics & Impact ─────────────────────────────────────────────

describe('adminCommunityAnalytics', () => {
  it('getData calls community-analytics endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminCommunityAnalytics.getData();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/community-analytics');
  });

  it('exportCsv calls export endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminCommunityAnalytics.exportCsv();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/community-analytics/export');
  });
});

describe('adminImpactReport', () => {
  it('getData with default months', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminImpactReport.getData();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/impact-report?months=12');
  });

  it('getData with custom months', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminImpactReport.getData(6);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/impact-report?months=6');
  });

  it('updateConfig puts config', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminImpactReport.updateConfig({ hourly_value: 16 });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/impact-report/config', { hourly_value: 16 });
  });
});

// ─── Vetting ──────────────────────────────────────────────────────────────────

describe('adminVetting', () => {
  it('list with no params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminVetting.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/vetting');
  });

  it('stats calls stats endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminVetting.stats();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/vetting/stats');
  });

  it('loads the controlled safeguarding policy', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminVetting.policy();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/vetting/policy');
  });

  it('updates only the jurisdiction', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminVetting.updatePolicy('england_wales');
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/vetting/policy', { jurisdiction: 'england_wales' });
  });

  it('confirms with controlled certification details and an optional review request', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminVetting.confirm(5, {
      certification_codes: ['dbs_enhanced', 'pvg_scotland'],
      scope_summary: 'Adult and child workforce activities.',
      private_notes: 'Scope checked with safeguarding lead.',
      review_due_at: '2027-07-14',
      authority_expires_at: '2031-07-14',
    }, 12);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/vetting/user/5/confirm', {
      acknowledgement: true,
      certification_codes: ['dbs_enhanced', 'pvg_scotland'],
      scope_summary: 'Adult and child workforce activities.',
      private_notes: 'Scope checked with safeguarding lead.',
      review_due_at: '2027-07-14',
      authority_expires_at: '2031-07-14',
      review_request_id: 12,
    });
  });

  it('revokes with a controlled reason code', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminVetting.revoke(5, 'recorded_in_error');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/vetting/user/5/revoke', {
      reason_code: 'recorded_in_error',
    });
  });

  it('resolves a review with a controlled outcome', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminVetting.resolveReview(7, 'member_contacted');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/vetting/reviews/7/resolve', {
      resolution_code: 'member_contacted',
    });
  });

  it('getUserRecords fetches by user', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminVetting.getUserRecords(10);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/vetting/user/10');
  });

});

// ─── Insurance ────────────────────────────────────────────────────────────────

describe('adminInsurance', () => {
  it('list with expiring_soon param', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminInsurance.list({ expiring_soon: true });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/insurance?expiring_soon=true');
  });

  it('verify posts to verify endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminInsurance.verify(3);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/insurance/3/verify');
  });

  it('reject posts reason', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminInsurance.reject(3, 'expired');
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/insurance/3/reject', { reason: 'expired' });
  });

  it('destroy calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminInsurance.destroy(3);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/insurance/3');
  });

  it('getUserCertificates fetches by user', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminInsurance.getUserCertificates(7);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/insurance/user/7');
  });
});

// ─── Cron ─────────────────────────────────────────────────────────────────────

describe('adminCron', () => {
  it('getLogs with no params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminCron.getLogs();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/system/cron-jobs/logs');
  });

  it('clearLogs deletes with before param', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminCron.clearLogs('2025-01-01');
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/system/cron-jobs/logs?before=2025-01-01');
  });

  it('getJobSettings calls settings endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminCron.getJobSettings('daily-cleanup');
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/system/cron-jobs/daily-cleanup/settings');
  });

  it('updateJobSettings puts data', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminCron.updateJobSettings('daily-cleanup', { is_enabled: true });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/system/cron-jobs/daily-cleanup/settings', { is_enabled: true });
  });

  it('getGlobalSettings calls settings endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminCron.getGlobalSettings();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/system/cron-jobs/settings');
  });

  it('getHealthMetrics calls health endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminCron.getHealthMetrics();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/system/cron-jobs/health');
  });
});

// ─── Moderation ───────────────────────────────────────────────────────────────

describe('adminModeration', () => {
  it('getFeedPosts with params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminModeration.getFeedPosts({ status: 'flagged', page: 1 });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/feed/posts?status=flagged&page=1');
  });

  it('hideFeedPost posts type', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminModeration.hideFeedPost(3);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/feed/posts/3/hide', { type: 'post' });
  });

  it('deleteFeedPost calls DELETE with type param', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminModeration.deleteFeedPost(3, 'comment');
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/feed/posts/3?type=comment');
  });

  it('hideComment posts to hide', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminModeration.hideComment(5);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/comments/5/hide');
  });

  it('deleteComment calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminModeration.deleteComment(5);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/comments/5');
  });

  it('flagReview posts to flag', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminModeration.flagReview(7);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/reviews/7/flag');
  });

  it('resolveReport posts to resolve', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminModeration.resolveReport(8);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/reports/8/resolve');
  });

  it('getReportStats calls stats endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminModeration.getReportStats();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/reports/stats');
  });
});

// ─── Support Reports ──────────────────────────────────────────────────────────

describe('adminSupportReports', () => {
  it('list with params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminSupportReports.list({ status: 'open', page: 1 });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/support-reports?status=open&page=1');
  });

  it('stats calls stats endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminSupportReports.stats();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/support-reports/stats');
  });

  it('get fetches single report', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminSupportReports.get(5);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/support-reports/5');
  });

  it('update puts payload', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminSupportReports.update(5, { status: 'resolved' } as Parameters<typeof adminSupportReports.update>[1]);
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/support-reports/5', { status: 'resolved' });
  });
});

// ─── CRM ──────────────────────────────────────────────────────────────────────

describe('adminCrm', () => {
  it('getDashboard calls crm dashboard', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminCrm.getDashboard();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/crm/dashboard');
  });

  it('createNote posts payload', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminCrm.createNote({ user_id: 5, content: 'Good member', is_pinned: true });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/crm/notes', {
      user_id: 5,
      content: 'Good member',
      is_pinned: true,
    });
  });

  it('deleteNote calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminCrm.deleteNote(3);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/crm/notes/3');
  });

  it('createTask posts payload', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminCrm.createTask({ title: 'Follow up', priority: 'high' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/crm/tasks', { title: 'Follow up', priority: 'high' });
  });

  it('addTag posts payload', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminCrm.addTag({ user_id: 5, tag: 'active' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/crm/tags', { user_id: 5, tag: 'active' });
  });

  it('removeTag deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminCrm.removeTag(9);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/crm/tags/9');
  });

  it('bulkRemoveTag uses encoded tag in URL', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminCrm.bulkRemoveTag('active member');
    expect(mockDelete).toHaveBeenCalledWith(
      `/v2/admin/crm/tags/bulk?tag=${encodeURIComponent('active member')}`
    );
  });

  it('exportNotesUrl returns URL string without api call', () => {
    expect(adminCrm.exportNotesUrl()).toBe('/v2/admin/crm/export/notes');
  });

  it('exportTasksUrl returns URL string without api call', () => {
    expect(adminCrm.exportTasksUrl()).toBe('/v2/admin/crm/export/tasks');
  });
});

// ─── Knowledge Base ───────────────────────────────────────────────────────────

describe('adminKb', () => {
  it('get calls admin resources endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminKb.get(5);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/resources/5');
  });

  it('create posts to /v2/kb', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminKb.create({ title: 'FAQ', content: 'body' });
    expect(mockPost).toHaveBeenCalledWith('/v2/kb', { title: 'FAQ', content: 'body' });
  });

  it('update puts to /v2/kb/:id', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminKb.update(5, { title: 'Updated FAQ' });
    expect(mockPut).toHaveBeenCalledWith('/v2/kb/5', { title: 'Updated FAQ' });
  });

  it('delete calls DELETE on /v2/kb/:id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminKb.delete(5);
    expect(mockDelete).toHaveBeenCalledWith('/v2/kb/5');
  });

  it('deleteAttachment calls DELETE on attachment endpoint', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminKb.deleteAttachment(5, 10);
    expect(mockDelete).toHaveBeenCalledWith('/v2/kb/5/attachments/10');
  });
});

// ─── Landing Page ─────────────────────────────────────────────────────────────

describe('adminLandingPage', () => {
  it('get calls landing-page config endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminLandingPage.get();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/config/landing-page');
  });

  it('update puts config', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminLandingPage.update(null);
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/config/landing-page', { config: null });
  });
});

// ─── Help FAQs ────────────────────────────────────────────────────────────────

describe('adminHelpFaqs', () => {
  it('list calls faqs endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminHelpFaqs.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/help/faqs');
  });

  it('create posts data', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminHelpFaqs.create({ question: 'How do I?', answer: 'Like this' });
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/help/faqs', {
      question: 'How do I?',
      answer: 'Like this',
    });
  });

  it('update puts data', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: {} });
    await adminHelpFaqs.update(3, { is_published: true });
    expect(mockPut).toHaveBeenCalledWith('/v2/admin/help/faqs/3', { is_published: true });
  });

  it('delete calls DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true, data: {} });
    await adminHelpFaqs.delete(3);
    expect(mockDelete).toHaveBeenCalledWith('/v2/admin/help/faqs/3');
  });
});

// ─── Search Analytics ─────────────────────────────────────────────────────────

describe('adminSearchAnalytics', () => {
  it('getSummary with default days', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminSearchAnalytics.getSummary();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/search/analytics?days=30');
  });

  it('getTrending with defaults', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminSearchAnalytics.getTrending();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/search/trending?days=7&limit=20');
  });

  it('getZeroResults with custom params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    await adminSearchAnalytics.getZeroResults(14, 10);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/search/zero-results?days=14&limit=10');
  });
});

// ─── Donations ────────────────────────────────────────────────────────────────

describe('adminDonations', () => {
  it('list with no params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminDonations.list();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/volunteering/donations');
  });

  it('list with date range', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminDonations.list({ date_from: '2025-01-01', date_to: '2025-12-31' });
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/volunteering/donations?date_from=2025-01-01&date_to=2025-12-31');
  });

  it('refund posts to /refund', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminDonations.refund(5);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/donations/5/refund');
  });

  it('complete posts to volunteering donations complete endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: {} });
    await adminDonations.complete(5);
    expect(mockPost).toHaveBeenCalledWith('/v2/admin/volunteering/donations/5/complete');
  });

  it('financeOverview calls member support finance overview endpoint', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminDonations.financeOverview();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/member-premium/finance/overview');
  });

  it('disputes calls member support disputes endpoint with limit', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: {} });
    await adminDonations.disputes(25);
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/member-premium/finance/disputes?limit=25');
  });

  it('giftAidExport downloads the Gift Aid CSV', async () => {
    await adminDonations.giftAidExport();
    expect(mockDownload).toHaveBeenCalledWith('/v2/admin/member-premium/finance/gift-aid-export', {
      filename: 'gift-aid-donations.csv',
    });
  });

  it('annualReceiptsExport downloads the annual donor receipt CSV for a year', async () => {
    await adminDonations.annualReceiptsExport(2026);
    expect(mockDownload).toHaveBeenCalledWith('/v2/admin/member-premium/finance/annual-receipts?year=2026', {
      filename: 'donation-annual-receipts-2026.csv',
    });
  });
});
