// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── stable mock refs (vi.hoisted so they're available in vi.mock factories) ───
const { mockToast, mockAdminSettings } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockAdminSettings: {
    getNativeAppSettings: vi.fn(),
    updateNativeAppSettings: vi.fn(),
    getNativeAppBuildManifest: vi.fn(),
    // The page now embeds NativeAppInstallStats, which fetches on mount.
    // Its own behaviour is covered in NativeAppInstallStats.test.tsx.
    getNativeAppInstallStats: vi.fn(),
  },
}));

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

vi.mock('../../api/adminApi', () => ({
  adminSettings: mockAdminSettings,
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('../../components', () => ({
  PageHeader: ({ title }: { title: string }) => <div data-testid="page-header">{title}</div>,
}));

import { NativeApp } from './NativeApp';

const basePayload = {
  native_app: {
    native_app_name: 'My App',
    native_app_short_name: 'MA',
    native_app_bundle_id: 'com.test.app',
    native_app_package_name: 'com.test.app',
    native_app_version: '1.0.0',
    native_app_push_enabled: true,
    native_app_fcm_server_key: '',
    native_app_apns_key_id: '',
    native_app_apns_team_id: '',
    native_app_service_worker: true,
    native_app_install_prompt: true,
    native_app_theme_color: '#1976D2',
    native_app_background_color: '#ffffff',
    native_app_display: 'standalone',
    native_app_orientation: 'portrait',
    native_app_store_mode: 'shared',
    native_app_build_profile: 'preview',
    native_app_ios_app_store_id: '',
    native_app_android_play_store_id: '',
    native_app_marketing_url: '',
    native_app_privacy_url: '',
    native_app_support_url: '',
    native_app_push_sender_id: '',
    native_app_tenant_channel_prefix: '',
  },
  deployment_readiness: {
    has_ios_identity: true,
    has_android_identity: false,
    has_store_metadata: true,
    push_routing_configured: false,
    tenant_branded_ready: false,
    missing_requirements: [],
  },
};

describe('NativeApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminSettings.getNativeAppInstallStats.mockResolvedValue({ success: true, data: null });
  });

  it('shows a loading spinner while fetching settings', () => {
    mockAdminSettings.getNativeAppSettings.mockReturnValue(new Promise(() => {}));
    render(<NativeApp />);

    const statusEls = screen.queryAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders form with app name after settings load', async () => {
    mockAdminSettings.getNativeAppSettings.mockResolvedValue({
      data: basePayload,
      success: true,
    });

    render(<NativeApp />);

    await waitFor(() => {
      const statusEls = screen.queryAllByRole('status');
      const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });

    // App name input should be populated
    const nameInput = screen.getByDisplayValue('My App');
    expect(nameInput).toBeInTheDocument();
  });

  it('shows error toast when load fails', async () => {
    mockAdminSettings.getNativeAppSettings.mockRejectedValue(new Error('net fail'));

    render(<NativeApp />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('saves settings and shows success toast on success', async () => {
    mockAdminSettings.getNativeAppSettings.mockResolvedValue({
      data: basePayload,
      success: true,
    });
    mockAdminSettings.updateNativeAppSettings.mockResolvedValue({ success: true });

    render(<NativeApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('My App')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    const saveBtn = screen.getByRole('button', { name: /save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminSettings.updateNativeAppSettings).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when save fails', async () => {
    mockAdminSettings.getNativeAppSettings.mockResolvedValue({
      data: basePayload,
      success: true,
    });
    mockAdminSettings.updateNativeAppSettings.mockResolvedValue({
      success: false,
      error: 'Validation error',
    });

    render(<NativeApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('My App')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    const saveBtn = screen.getByRole('button', { name: /save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows deployment readiness chips', async () => {
    mockAdminSettings.getNativeAppSettings.mockResolvedValue({
      data: basePayload,
      success: true,
    });

    render(<NativeApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('My App')).toBeInTheDocument();
    });

    // Readiness section has 5 indicators — two "ready" and three "missing"
    // The exact translation keys depend on i18n; just verify multiple chips present
    const chips = screen.getAllByRole('img', { hidden: true });
    // chips might not be role=img; just check text
    // The component renders "ready" or "missing" via t() which in test env returns the key
    expect(screen.getByText('2 / 5')).toBeInTheDocument();
  });

  it('shows missing_requirements list when present', async () => {
    const payloadWithMissing = {
      ...basePayload,
      deployment_readiness: {
        ...basePayload.deployment_readiness,
        missing_requirements: ['bundle_id', 'push_key'],
      },
    };
    mockAdminSettings.getNativeAppSettings.mockResolvedValue({
      data: payloadWithMissing,
      success: true,
    });

    render(<NativeApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('My App')).toBeInTheDocument();
    });

    // The missing requirements section renders as a list
    // We check that 2 items were rendered by querying list items
    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBeGreaterThanOrEqual(2);
  });

  it('triggers export manifest download on Export button click', async () => {
    mockAdminSettings.getNativeAppSettings.mockResolvedValue({
      data: basePayload,
      success: true,
    });
    mockAdminSettings.getNativeAppBuildManifest.mockResolvedValue({
      data: { version: '1.0.0' },
      success: true,
    });

    // Stub URL methods used for download
    const createObjectURLSpy = vi.fn(() => 'blob:test-url');
    const revokeObjectURLSpy = vi.fn();
    global.URL.createObjectURL = createObjectURLSpy;
    global.URL.revokeObjectURL = revokeObjectURLSpy;

    // Stub link click
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const a = origCreate('a');
        a.click = clickSpy;
        return a;
      }
      return origCreate(tag);
    });

    render(<NativeApp />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('My App')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    const exportBtn = screen.getByRole('button', { name: /export/i });
    await user.click(exportBtn);

    await waitFor(() => {
      expect(mockAdminSettings.getNativeAppBuildManifest).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
    });

    vi.restoreAllMocks();
  });
});
