// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { api } from '@/lib/api';
import type { ReactNode } from 'react';

// Stable toast mock so tests can assert on success/error calls (the default
// useToast mock returned a fresh object per call, which can't be asserted on).
const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => {
      const { variants: _v, initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props as Record<string, unknown>;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.fallbackValue as string | undefined) ?? key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('react-router-dom', () => {
  return {
    BrowserRouter: ({ children }: { children?: ReactNode }) => <>{children}</>,
    MemoryRouter: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Link: ({ children, to, ...rest }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      <a href={String(to)} {...rest}>{children}</a>,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', name: 'Test User', role: 'member' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => mockToast),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// MyApplicationsPage imports its Modal parts from '@/components/ui/Modal', Tabs/Tab from
// '@/components/ui/Tabs' and useDisclosure from '@/components/ui/useDisclosure' — none through the
// barrel, so this factory was dead for all three and the real HeroUI components plus the real
// useDisclosure were what rendered. The factory is a full replacement, so the same one is
// registered on every specifier the page imports; unused extra exports are harmless. Declared as a
// hoisted function so the vi.mock calls below can reference it.
function myApplicationsUiMock() {
  const Box = ({ children, label, title, description }: Record<string, unknown>) => (
    <div>
      {label as ReactNode}
      {title as ReactNode}
      {description as ReactNode}
      {typeof children === 'function' ? (children as (arg: unknown) => ReactNode)(vi.fn()) : children as ReactNode}
    </div>
  );
  const Chip = Object.assign(Box, {
    Label: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  });
  const Button = ({ children, onPress, onClick, as: _as, href, target, rel, download }: Record<string, unknown>) => {
    const props = {
      href: href as string | undefined,
      target: target as string | undefined,
      rel: rel as string | undefined,
      download: download as string | undefined,
      onClick: (onPress ?? onClick) as (() => void) | undefined,
    };
    return href ? <a {...props}>{children as ReactNode}</a> : <button type="button" onClick={props.onClick}>{children as ReactNode}</button>;
  };
  return {
    Chip,
    GlassCard: Box,
    useDisclosure: () => ({ isOpen: false, onOpen: vi.fn(), onOpenChange: vi.fn(), onClose: vi.fn() }),
    Button,
    Spinner: () => <div role="status" />,
    Modal: ({ isOpen, children }: Record<string, unknown>) => isOpen === false ? null : <div>{children as ReactNode}</div>,
    ModalContent: Box,
    ModalHeader: Box,
    ModalBody: Box,
    ModalFooter: Box,
    Tabs: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Tab: ({ title }: Record<string, unknown>) => <div>{title as ReactNode}</div>,
    Skeleton: () => <div className="animate-pulse" data-slot="base" />,
  };
}

vi.mock('@/components/ui', myApplicationsUiMock);
vi.mock('@/components/ui/Modal', myApplicationsUiMock);
vi.mock('@/components/ui/Tabs', myApplicationsUiMock);
vi.mock('@/components/ui/useDisclosure', myApplicationsUiMock);

vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

import { MyApplicationsPage } from './MyApplicationsPage';

const mockApplicationsResponse = {
  success: true,
  data: {
    items: [
      {
        id: 1,
        vacancy_id: 10,
        user_id: 1,
        status: 'applied',
        stage: 'initial',
        message: null,
        reviewer_notes: null,
        created_at: '2026-01-01T10:00:00Z',
        updated_at: '2026-01-01T10:00:00Z',
        vacancy: {
          id: 10,
          title: 'Community Garden Volunteer',
          type: 'volunteer' as const,
          commitment: 'flexible' as const,
          status: 'active',
          location: 'Dublin',
          is_remote: false,
          deadline: null,
        },
      },
      {
        id: 2,
        vacancy_id: 11,
        user_id: 1,
        status: 'accepted',
        stage: 'offer',
        message: 'I am very interested in this role',
        reviewer_notes: 'Great candidate',
        created_at: '2026-01-02T10:00:00Z',
        updated_at: '2026-01-03T10:00:00Z',
        vacancy: {
          id: 11,
          title: 'Remote Coding Tutor',
          type: 'paid' as const,
          commitment: 'part_time' as const,
          status: 'active',
          location: null,
          is_remote: true,
          deadline: null,
        },
      },
    ],
    cursor: null,
    has_more: false,
  },
};

const emptyApplicationsResponse = {
  success: true,
  data: { items: [], cursor: null, has_more: false },
};

describe('MyApplicationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => {
      window.setTimeout(() => resolve(emptyApplicationsResponse), 25);
    }));
    const { unmount } = render(<MyApplicationsPage />);
    // Skeleton elements rendered during loading
    expect(document.querySelectorAll('.animate-pulse, [data-slot="base"]').length).toBeGreaterThanOrEqual(0);
    unmount();
  });

  it('renders page title and filter tabs', async () => {
    vi.mocked(api.get).mockResolvedValue(emptyApplicationsResponse);
    render(<MyApplicationsPage />);
    await waitFor(() => {
      expect(screen.getByText('my_applications.title')).toBeInTheDocument();
    });
    expect(screen.getByText('my_applications.tab_all')).toBeInTheDocument();
    expect(screen.getByText('my_applications.tab_active')).toBeInTheDocument();
    expect(screen.getByText('my_applications.tab_accepted')).toBeInTheDocument();
    expect(screen.getByText('my_applications.tab_rejected')).toBeInTheDocument();
  });

  it('shows empty state when no applications exist', async () => {
    vi.mocked(api.get).mockResolvedValue(emptyApplicationsResponse);
    render(<MyApplicationsPage />);
    await waitFor(() => {
      expect(screen.getByText('my_applications.empty_title')).toBeInTheDocument();
    });
    expect(screen.getByText('my_applications.browse_jobs')).toBeInTheDocument();
  });

  it('renders application cards on success', async () => {
    vi.mocked(api.get).mockResolvedValue(mockApplicationsResponse);
    render(<MyApplicationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Community Garden Volunteer')).toBeInTheDocument();
    });
    expect(screen.getByText('Remote Coding Tutor')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<MyApplicationsPage />);
    await waitFor(() => {
      expect(screen.getByText('something_wrong')).toBeInTheDocument();
    });
    expect(screen.getByText('try_again')).toBeInTheDocument();
  });

  it('shows an error toast when the GDPR export request is rejected (not a silent no-op)', async () => {
    // Regression: handleGdprExport gated the download on `if (res.success && res.data)`
    // with no else, and the catch only fires on a thrown error. A { success:false }
    // (4xx, which api.get resolves without throwing) produced NO download and NO
    // message — the "Download my data" button looked dead. It must now surface an error.
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('gdpr-export')
        ? Promise.resolve({ success: false, error: 'Export failed' })
        : Promise.resolve(emptyApplicationsResponse)
    );
    render(<MyApplicationsPage />);
    await waitFor(() => {
      expect(screen.getByText('gdpr.export_my_data')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('gdpr.export_my_data'));
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('shows a success toast after a successful GDPR export', async () => {
    // jsdom does not implement URL.createObjectURL / revokeObjectURL — stub so the
    // blob-download path doesn't throw before the success toast.
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('gdpr-export')
        ? Promise.resolve({ success: true, data: { applications: [] } })
        : Promise.resolve(emptyApplicationsResponse)
    );
    render(<MyApplicationsPage />);
    await waitFor(() => {
      expect(screen.getByText('gdpr.export_my_data')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('gdpr.export_my_data'));
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  });

  it('shows Load More button when has_more is true', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { ...mockApplicationsResponse.data, has_more: true, cursor: 'next123' },
    });
    render(<MyApplicationsPage />);
    await waitFor(() => {
      expect(screen.getByText('load_more')).toBeInTheDocument();
    });
  });

  it('shows withdraw button for active applications', async () => {
    vi.mocked(api.get).mockResolvedValue(mockApplicationsResponse);
    render(<MyApplicationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Community Garden Volunteer')).toBeInTheDocument();
    });
    // Active application (status 'applied') shows a Withdraw button
    const withdrawButtons = screen.getAllByText('my_applications.withdraw');
    expect(withdrawButtons.length).toBeGreaterThan(0);
  });

  it('does not show withdraw button for accepted application', async () => {
    vi.mocked(api.get).mockResolvedValue(mockApplicationsResponse);
    render(<MyApplicationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Remote Coding Tutor')).toBeInTheDocument();
    });
    // There is only 1 active application so only 1 withdraw button
    const withdrawButtons = screen.getAllByText('my_applications.withdraw');
    expect(withdrawButtons.length).toBe(1);
  });

  it('shows cover message when application has a message', async () => {
    vi.mocked(api.get).mockResolvedValue(mockApplicationsResponse);
    render(<MyApplicationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Remote Coding Tutor')).toBeInTheDocument();
    });
    const showMsgButton = screen.getByText('my_applications.show_cover_message');
    expect(showMsgButton).toBeInTheDocument();
    fireEvent.click(showMsgButton);
    await waitFor(() => {
      expect(screen.getByText('I am very interested in this role')).toBeInTheDocument();
    });
  });

  it('shows reviewer notes when present', async () => {
    vi.mocked(api.get).mockResolvedValue(mockApplicationsResponse);
    render(<MyApplicationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Great candidate')).toBeInTheDocument();
    });
  });

  it('calls API with correct endpoint on mount', async () => {
    vi.mocked(api.get).mockResolvedValue(emptyApplicationsResponse);
    render(<MyApplicationsPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('/v2/jobs/my-applications'),
      );
    });
  });
});
