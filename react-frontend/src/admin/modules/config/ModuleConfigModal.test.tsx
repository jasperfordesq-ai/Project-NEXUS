// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import i18n from '@/i18n';
import type { ModuleDefinition } from './moduleRegistry';

// ─── Mock adminApi ─────────────────────────────────────────────────────────────
const { mockAdminBroker, mockAdminConfig } = vi.hoisted(() => ({
  mockAdminBroker: {
    getConfiguration: vi.fn(),
    saveConfiguration: vi.fn(),
  },
  mockAdminConfig: {
    getGroupConfig: vi.fn(),
    updateGroupConfigBulk: vi.fn(),
    getListingConfig: vi.fn(),
    updateListingConfigBulk: vi.fn(),
    getVolunteeringConfig: vi.fn(),
    updateVolunteeringConfigBulk: vi.fn(),
    getJobConfig: vi.fn(),
    updateJobConfigBulk: vi.fn(),
    getPodcastConfig: vi.fn(),
    updatePodcastConfigBulk: vi.fn(),
    getIdentityConfig: vi.fn(),
    updateIdentityConfigBulk: vi.fn(),
    getAuthenticationConfig: vi.fn(),
    updateAuthenticationConfigBulk: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminBroker: mockAdminBroker,
  adminConfig: mockAdminConfig,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

const mockRefreshTenant = vi.fn();

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
      refreshTenant: mockRefreshTenant,
    }),
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Stub getOptionCategories ─────────────────────────────────────────────────
vi.mock('./moduleRegistry', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./moduleRegistry')>();
  return {
    ...orig,
    getOptionCategories: (mod: ModuleDefinition) => {
      const cats = [...new Set(mod.configOptions.map((o) => o.category))];
      return cats;
    },
  };
});

// ─── Stub HeroUI Select & Switch to avoid jsdom loops ─────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Switch: ({ isSelected, onValueChange, 'aria-label': label, isDisabled }: {
      isSelected: boolean;
      onValueChange?: (v: boolean) => void;
      'aria-label'?: string;
      isDisabled?: boolean;
    }) => (
      <input
        type="checkbox"
        aria-label={label}
        checked={isSelected}
        disabled={isDisabled}
        onChange={(e) => onValueChange?.(e.target.checked)}
        data-testid="config-switch"
      />
    ),
    Select: ({ children, 'aria-label': label, onSelectionChange, isDisabled }: {
      children?: React.ReactNode;
      'aria-label'?: string;
      onSelectionChange?: (keys: Set<string>) => void;
      selectedKeys?: string[];
      isDisabled?: boolean;
      size?: string;
      variant?: string;
      className?: string;
    }) => (
      <select
        aria-label={label ?? 'select'}
        disabled={isDisabled}
        onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
      >
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children: React.ReactNode; id: string }) => (
      <option value={id}>{children}</option>
    ),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────
import ListChecks from 'lucide-react/icons/list-checks';
import Users from 'lucide-react/icons/users';

// 🔴 These fixtures must use REAL registry option keys and REAL category slugs.
//
// ModuleConfigModal resolves every label itself, from admin_config.json:
// t(`config.option_${optionToken(option.key)}_label`) for the control and
// t(`config.option_category_${category}`) for the group. ConfigOption carries no
// `label`/`description` fields at all any more (nor ModuleDefinition a `name`),
// so the invented copy these fixtures used to declare — 'Auto-complete (days)',
// 'Require Review', category 'Workflow' — was simply discarded, and no
// translation exists for keys the registry has never contained. The modal
// therefore rendered raw missing-key strings, and every assertion that waited on
// a label matched nothing and read as a modal that had not loaded.
const makeBrokerModule = (): ModuleDefinition => ({
  id: 'exchange_workflow',
  icon: ListChecks,
  type: 'feature',
  configSource: 'broker_config',
  configOptions: [
    {
      key: 'broker_copy_threshold_hours',
      type: 'number',
      defaultValue: 5,
      category: 'messaging',
      min: 1,
      max: 100,
    },
    {
      key: 'broker_messaging_enabled',
      type: 'boolean',
      defaultValue: true,
      category: 'messaging',
    },
  ],
});

const makeGroupModule = (): ModuleDefinition => ({
  id: 'groups',
  icon: Users,
  type: 'feature',
  configSource: 'group_config',
  detailPageUrl: '/admin/groups',
  configOptions: [
    {
      // Real key: 'allow_private_groups' (not 'groups.allow_private'), which is
      // what option_allow_private_groups_label = "Allow Private Groups" keys off.
      key: 'allow_private_groups',
      type: 'boolean',
      defaultValue: true,
      category: 'creation_membership',
    },
  ],
});

const makeAuthenticationModule = (): ModuleDefinition => ({
  id: 'two_factor_authentication',
  name: 'two_factor_authentication',
  description: 'two_factor_authentication',
  icon: ListChecks,
  type: 'feature',
  configSource: 'authentication_config',
  configOptions: [
    {
      key: 'two_factor.allow_trusted_devices',
      label: 'two_factor.allow_trusted_devices',
      description: 'two_factor.allow_trusted_devices',
      type: 'boolean',
      defaultValue: true,
      category: 'access',
    },
  ],
});

const makeComingSoonModule = (): ModuleDefinition => ({
  id: 'wallet',
  name: 'Wallet',
  description: 'Time credits',
  icon: ListChecks,
  type: 'core',
  configSource: 'tenant_modules',
  configOptions: [
    {
      key: 'wallet.min_transfer',
      label: 'Min Transfer',
      description: 'Minimum time credits',
      type: 'number',
      defaultValue: 0.25,
      category: 'Limits',
      comingSoon: true,
    },
  ],
});

const makeOnboardingModule = (): ModuleDefinition => ({
  id: 'onboarding',
  name: 'Onboarding',
  description: 'User onboarding flow',
  icon: ListChecks,
  type: 'feature',
  configSource: 'onboarding_config',
  configOptions: [],
  detailPageUrl: '/admin/onboarding',
});

const makeBrokerConfig = () => ({
  broker_copy_threshold_hours: 5,
  broker_messaging_enabled: true,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ModuleConfigModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminBroker.getConfiguration.mockResolvedValue({
      success: true,
      data: makeBrokerConfig(),
    });
    mockAdminBroker.saveConfiguration.mockResolvedValue({ success: true });
    mockAdminConfig.getGroupConfig.mockResolvedValue({
      success: true,
      data: { config: { allow_private_groups: true } },
    });
    mockAdminConfig.updateGroupConfigBulk.mockResolvedValue({ success: true });
    mockAdminConfig.getAuthenticationConfig.mockResolvedValue({
      success: true,
      data: {
        config: {
          'two_factor.allow_trusted_devices': true,
          'two_factor.trusted_device_days': 30,
          'two_factor.backup_code_count': 10,
          'passkeys.conditional_autofill': true,
        },
      },
    });
    mockAdminConfig.updateAuthenticationConfigBulk.mockResolvedValue({ success: true });
  });

  it('renders nothing visible when module prop is null', async () => {
    const translationSpy = vi.spyOn(i18n, 't');
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal module={null} isOpen={true} onClose={vi.fn()} />
    );
    // Component returns null — no dialog or modal heading should appear
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.queryByText('Exchange Workflow')).not.toBeInTheDocument();
    expect(translationSpy.mock.calls.some(([key]) => key === '')).toBe(false);
    translationSpy.mockRestore();
  });

  it('renders modal header with module name when isOpen=true', async () => {
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeBrokerModule()}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Exchange Workflow')).toBeInTheDocument();
    });
  });

  it('shows loading spinner while broker config loads', async () => {
    mockAdminBroker.getConfiguration.mockImplementationOnce(() => new Promise(() => {}));
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeBrokerModule()}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders broker config options after load', async () => {
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeBrokerModule()}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Copy Threshold (Hours)')).toBeInTheDocument();
      expect(screen.getByText('Broker Messaging')).toBeInTheDocument();
    });
  });

  it('shows Save Changes button when config is editable', async () => {
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeBrokerModule()}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => screen.getByText('Exchange Workflow'));

    // Save button is present (but initially disabled — no changes yet)
    const saveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save')
    );
    expect(saveBtn).toBeDefined();
  });

  it('enables Save button after changing a boolean config', async () => {
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeBrokerModule()}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => screen.getByText('Broker Messaging'));

    const switchEl = screen.getByRole('checkbox', { name: /broker messaging/i });
    fireEvent.click(switchEl);

    await waitFor(() => {
      const saveBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('save')
      );
      expect(saveBtn).not.toBeDisabled();
    });
  });

  it('calls saveConfiguration and shows success toast', async () => {
    const onClose = vi.fn();
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeBrokerModule()}
        isOpen={true}
        onClose={onClose}
      />
    );

    await waitFor(() => screen.getByText('Broker Messaging'));

    // Toggle to enable change
    const switchEl = screen.getByRole('checkbox', { name: /broker messaging/i });
    fireEvent.click(switchEl);

    await waitFor(() => {
      const saveBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('save') && !b.hasAttribute('disabled') && b.getAttribute('data-disabled') !== 'true'
      );
      expect(saveBtn).toBeDefined();
    });

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminBroker.saveConfiguration).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('renders group config options after load', async () => {
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeGroupModule()}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Allow Private Groups')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /open groups administration/i })).toBeInTheDocument();
  });

  it('calls updateGroupConfigBulk when saving group config', async () => {
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeGroupModule()}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => screen.getByText('Allow Private Groups'));

    // Toggle the switch to mark as changed
    const switchEl = screen.getByRole('checkbox', { name: /allow private groups/i });
    fireEvent.click(switchEl);

    const saveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminConfig.updateGroupConfigBulk).toHaveBeenCalled();
    });
  });

  it('loads and saves tenant authentication configuration', async () => {
    const onClose = vi.fn();
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeAuthenticationModule()}
        isOpen={true}
        onClose={onClose}
      />
    );

    const switchEl = await screen.findByRole('checkbox', { name: /allow trusted devices/i });
    fireEvent.click(switchEl);

    const saveBtn = screen.getAllByRole('button').find((button) =>
      button.textContent?.toLowerCase().includes('save')
    );
    expect(saveBtn).toBeDefined();
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminConfig.getAuthenticationConfig).toHaveBeenCalledTimes(1);
      expect(mockAdminConfig.updateAuthenticationConfigBulk).toHaveBeenCalledWith({
        'two_factor.allow_trusted_devices': false,
        'two_factor.trusted_device_days': 30,
        'two_factor.backup_code_count': 10,
        'passkeys.conditional_autofill': true,
      });
      expect(mockRefreshTenant).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows coming-soon chip on options marked comingSoon', async () => {
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeComingSoonModule()}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      // Coming soon notice card or chip should be visible
      const text = screen.getAllByText((content) =>
        content.toLowerCase().includes('coming') || content.toLowerCase().includes('soon')
      );
      expect(text.length).toBeGreaterThan(0);
    });
  });

  it('renders onboarding link-out view instead of config options', async () => {
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeOnboardingModule()}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      // The modal body shows onboarding description / Go to Onboarding button
      const btns = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('onboarding')
      );
      expect(btns).toBeDefined();
    });
  });

  it('calls onClose when Cancel / Close button clicked', async () => {
    const onClose = vi.fn();
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeBrokerModule()}
        isOpen={true}
        onClose={onClose}
      />
    );

    await waitFor(() => screen.getByText('Exchange Workflow'));

    const closeBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('close') || b.textContent?.toLowerCase().includes('cancel')
    );
    expect(closeBtn).toBeDefined();
    if (closeBtn) fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it('shows error toast when broker config load fails', async () => {
    mockAdminBroker.getConfiguration.mockRejectedValue(new Error('Network error'));
    const { default: ModuleConfigModal } = await import('./ModuleConfigModal');
    render(
      <ModuleConfigModal
        module={makeBrokerModule()}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
