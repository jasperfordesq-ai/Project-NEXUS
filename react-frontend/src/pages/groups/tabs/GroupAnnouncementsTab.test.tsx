// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const {
  mockCreateAnnouncement,
  mockDeleteAnnouncement,
  mockListAnnouncements,
  mockNotifyAnnouncementsChanged,
  mockUpdateAnnouncement,
} = vi.hoisted(() => ({
  mockCreateAnnouncement: vi.fn(),
  mockDeleteAnnouncement: vi.fn(),
  mockListAnnouncements: vi.fn(),
  mockNotifyAnnouncementsChanged: vi.fn(),
  mockUpdateAnnouncement: vi.fn(),
}));

vi.mock('../api/announcements', () => ({
  createGroupAnnouncement: mockCreateAnnouncement,
  deleteGroupAnnouncement: mockDeleteAnnouncement,
  listGroupAnnouncements: mockListAnnouncements,
  notifyGroupAnnouncementsChanged: mockNotifyAnnouncementsChanged,
  updateGroupAnnouncement: mockUpdateAnnouncement,
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return { ...actual, formatRelativeTime: (d: string) => d };
});

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Tester' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub feedback EmptyState ─────────────────────────────────────────────────
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title?: string; description?: string; icon?: React.ReactNode }) => (
    <div data-testid="empty-state">
      {title && <p>{title}</p>}
      {description && <p>{description}</p>}
    </div>
  ),
}));

// ─── Stub HeroUI Modal (render-prop pattern) and other UI components ──────────
// GroupAnnouncementsTab imports its Modal parts from '@/components/ui/Modal' and its Dropdown parts
// from '@/components/ui/Dropdown', not through the barrel, so registering them here alone left them
// dead and the real HeroUI components rendered. Hoisted so the barrel factory and the direct-path
// factories share one definition; the stubs are prop-driven, so sharing is safe. The Dropdown stubs
// render role="menu"/role="menuitem", matching the real component's ARIA contract, which is what
// the row-action assertions below query — so activating them is safe here.
const modalStub = vi.hoisted(() => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children?: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label="Dialog" aria-modal="true">{children}</div> : null,
  ModalContent: ({ children }: { children: React.ReactNode | ((close: () => void) => React.ReactNode) }) =>
    <div>{typeof children === 'function' ? children(() => {}) : children}</div>,
  ModalHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="modal-header">{children}</div>,
  ModalBody: ({ children }: { children: React.ReactNode }) => <div data-testid="modal-body">{children}</div>,
  ModalFooter: ({ children }: { children: React.ReactNode }) => <div data-testid="modal-footer">{children}</div>,
}));

const dropdownStub = vi.hoisted(() => ({
  Dropdown: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdown">{children}</div>,
  DropdownTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenu: ({ children, 'aria-label': ariaLabel }: { children: React.ReactNode; 'aria-label'?: string }) => (
    <div role="menu" aria-label={ariaLabel}>{children}</div>
  ),
  DropdownItem: ({ children, onPress, className }: { children: React.ReactNode; onPress?: () => void; className?: string; key?: string; id?: string; startContent?: React.ReactNode; color?: string }) => (
    <div role="menuitem" onClick={onPress} className={className}>{children}</div>
  ),
}));

vi.mock('@/components/ui/Modal', () => modalStub);
vi.mock('@/components/ui/Dropdown', () => dropdownStub);

vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    ...modalStub,
    Button: ({ children, onPress, isLoading, isDisabled, startContent }: {
      children?: React.ReactNode; onPress?: () => void; isLoading?: boolean; isDisabled?: boolean;
      startContent?: React.ReactNode; isIconOnly?: boolean; variant?: string; color?: string; size?: string; [key: string]: unknown
    }) => (
      <button onClick={onPress} disabled={isDisabled || isLoading}>
        {startContent}{isLoading ? 'Loading...' : children}
      </button>
    ),
    Input: ({ label, value, onChange, placeholder }: { label?: string; value?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string }) => (
      <div>
        {label && <label>{label}</label>}
        <input value={value} onChange={onChange} placeholder={placeholder} />
      </div>
    ),
    Textarea: ({ label, value, onChange, placeholder }: { label?: string; value?: string; onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void; placeholder?: string }) => (
      <div>
        {label && <label>{label}</label>}
        <textarea value={value} onChange={onChange} placeholder={placeholder} />
      </div>
    ),
    Chip: ({ children, color, size }: { children: React.ReactNode; color?: string; size?: string }) => (
      <span data-color={color} data-size={size}>{children}</span>
    ),
    Spinner: ({ size }: { size?: string }) => <div role="status" aria-busy="true" data-size={size} />,
    GlassCard: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    ...dropdownStub,
    // useDisclosure is deliberately NOT overridden. The component imports it from
    // '@/components/ui/useDisclosure', so the always-closed stub that used to sit here was dead and
    // the real hook has always been what ran. Re-registering it on the direct path would make
    // onOpen a no-op and wedge the edit/delete dialogs shut — live but wrong, worse than dead.
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeAnnouncement = (overrides = {}) => ({
  id: 1,
  title: 'Team Meeting',
  content: 'See you in the hall.',
  is_pinned: false,
  author: { id: 10, name: 'Alice Admin' },
  created_at: '2025-06-01T10:00:00Z',
  updated_at: '2025-06-01T10:00:00Z',
  ...overrides,
});


// ─────────────────────────────────────────────────────────────────────────────
describe('GroupAnnouncementsTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockListAnnouncements.mockResolvedValue([]);
  });

  it('shows loading spinner while fetching announcements', async () => {
    mockListAnnouncements.mockImplementationOnce(() => new Promise(() => {}));
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={false} />);
    const spinners = screen.queryAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows empty state when no announcements returned', async () => {
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders announcement titles after data loads', async () => {
    mockListAnnouncements.mockResolvedValue([makeAnnouncement()]);
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('Team Meeting')).toBeInTheDocument();
    });
  });

  it('renders announcement author name', async () => {
    mockListAnnouncements.mockResolvedValue([makeAnnouncement()]);
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    });
    expect(screen.getByText('2025-06-01T10:00:00Z')).toHaveAttribute('dateTime', '2025-06-01T10:00:00Z');
  });

  it('sanitizes scripts, event handlers, and javascript URLs in announcement content', async () => {
    mockListAnnouncements.mockResolvedValue([makeAnnouncement({
      content: '<script>window.__announcementXss=1</script><img src=x onerror="window.__announcementXss=2"><a href="javascript:alert(1)" onclick="alert(2)">Safe announcement</a>',
    })]);
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    const { container } = render(<GroupAnnouncementsTab groupId={3} isAdmin={false} />);

    expect(await screen.findByText('Safe announcement', { exact: true })).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror], [onclick]')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    expect((window as typeof window & { __announcementXss?: number }).__announcementXss).toBeUndefined();
  });

  it('fetches announcements from the correct API endpoint', async () => {
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={7} isAdmin={false} />);
    await waitFor(() => {
      expect(mockListAnnouncements).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('shows New Announcement button for admin users', async () => {
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={true} />);
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const newBtn = buttons.find((b) => b.textContent?.toLowerCase().includes('new') || b.textContent?.toLowerCase().includes('announ'));
      expect(newBtn).toBeDefined();
    });
  });

  it('posts a new announcement from the admin form', async () => {
    mockCreateAnnouncement.mockResolvedValue(makeAnnouncement({ id: 12 }));
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={true} />);

    await userEvent.click((await screen.findAllByRole('button', { name: 'New Announcement' }))[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Schedule update');
    await userEvent.type(screen.getByRole('textbox', { name: 'Content' }), 'The meeting starts at seven.');
    await userEvent.click(screen.getByRole('button', { name: 'Post Announcement' }));

    await waitFor(() => {
      expect(mockCreateAnnouncement).toHaveBeenCalledWith(3, {
        title: 'Schedule update',
        content: 'The meeting starts at seven.',
        is_pinned: false,
      });
    });
    expect(mockNotifyAnnouncementsChanged).toHaveBeenCalledWith(3);
  });

  it('exposes the composer pin toggle with aria-pressed state', async () => {
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={true} />);

    await userEvent.click((await screen.findAllByRole('button', { name: 'New Announcement' }))[0]);
    const pin = screen.getByRole('button', { name: 'Pin this announcement' });
    expect(pin).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(pin);
    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('edits an existing announcement through the admin action menu', async () => {
    mockListAnnouncements.mockResolvedValue([makeAnnouncement({ id: 22 })]);
    mockUpdateAnnouncement.mockResolvedValue(makeAnnouncement({
      id: 22,
      title: 'Updated meeting',
      content: 'The room changed.',
      is_pinned: true,
    }));
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={true} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    expect(await screen.findByText('Edit announcement')).toBeInTheDocument();
    const titleInput = screen.getByRole('textbox', { name: 'Title' });
    const contentInput = screen.getByRole('textbox', { name: 'Content' });
    expect(titleInput).toHaveValue('Team Meeting');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Updated meeting');
    await userEvent.clear(contentInput);
    await userEvent.type(contentInput, 'The room changed.');
    await userEvent.click(screen.getByRole('button', { name: 'Pin this announcement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdateAnnouncement).toHaveBeenCalledWith(3, 22, {
      title: 'Updated meeting',
      content: 'The room changed.',
      is_pinned: true,
    }));
    expect(mockNotifyAnnouncementsChanged).toHaveBeenCalledWith(3);
    expect(mockToast.success).toHaveBeenCalledWith('Announcement updated');
  });

  it('does NOT show New Announcement button for non-admins', async () => {
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={false} />);
    await waitFor(() => {
      const buttons = screen.queryAllByRole('button');
      const newBtn = buttons.find((b) =>
        (b.textContent?.toLowerCase().includes('new') && b.textContent?.toLowerCase().includes('announ')) ||
        (b.textContent?.toLowerCase() === 'new announcement')
      );
      expect(newBtn).toBeUndefined();
    });
  });

  it('shows pinned badge for pinned announcements', async () => {
    mockListAnnouncements.mockResolvedValue([makeAnnouncement({ is_pinned: true, title: 'Pinned Post' })]);
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('Pinned Post')).toBeInTheDocument();
    });
  });

  it('shows admin action menu for admins on announcement cards', async () => {
    mockListAnnouncements.mockResolvedValue([makeAnnouncement()]);
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={true} />);
    expect(await screen.findByRole('button', { name: 'Actions' })).toHaveClass('min-h-11', 'min-w-11');
  });

  it('calls PUT endpoint when pin is toggled', async () => {
    mockListAnnouncements.mockResolvedValue([makeAnnouncement({ id: 99 })]);
    mockUpdateAnnouncement.mockResolvedValue(makeAnnouncement({ id: 99, is_pinned: true }));
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={true} />);

    await waitFor(() => screen.getByText('Team Meeting'));

    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Pin$/i }));

    await waitFor(() => {
      expect(mockUpdateAnnouncement).toHaveBeenCalledWith(3, 99, { is_pinned: true });
    });
  });

  it('shows error toast when loading fails', async () => {
    mockListAnnouncements.mockRejectedValue(new Error('network'));
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={false} />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders multiple announcements', async () => {
    mockListAnnouncements.mockResolvedValue([
      makeAnnouncement({ id: 1, title: 'First Announcement' }),
      makeAnnouncement({ id: 2, title: 'Second Announcement' }),
    ]);
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('First Announcement')).toBeInTheDocument();
      expect(screen.getByText('Second Announcement')).toBeInTheDocument();
    });
  });

  it('aborts the announcement read when the tab unmounts', async () => {
    mockListAnnouncements.mockImplementationOnce(() => new Promise(() => {}));
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    const { unmount } = render(<GroupAnnouncementsTab groupId={6} isAdmin={false} />);

    await waitFor(() => expect(mockListAnnouncements).toHaveBeenCalled());
    const options = mockListAnnouncements.mock.calls[0]?.[1] as { signal: AbortSignal };
    expect(options.signal.aborted).toBe(false);

    unmount();
    expect(options.signal.aborted).toBe(true);
  });

  it('surfaces adapter rejection from a resolved API failure', async () => {
    const { normalizeGroupApiError } = await import('../api/core');
    mockListAnnouncements.mockRejectedValue(normalizeGroupApiError({
      success: false,
      code: 'HTTP_403',
      status: 403,
    }));
    const { GroupAnnouncementsTab } = await import('./GroupAnnouncementsTab');
    render(<GroupAnnouncementsTab groupId={3} isAdmin={false} />);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Failed to load announcements'));
  });
});
