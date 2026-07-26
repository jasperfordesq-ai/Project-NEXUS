// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import userEvent from '@testing-library/user-event';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn(), upload: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: (url: string | null) => url ?? '',
    formatRelativeTime: () => '2 days ago',
  };
});

vi.mock('@/components/ui/ConfirmDialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/ConfirmDialog')>();
  return { ...actual, useConfirm: () => mockConfirm };
});

// ─── Context ─────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };
const mockConfirm = vi.fn(() => Promise.resolve(true));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Alice', role: 'member' },
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

vi.mock('@/contexts/ToastContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/ToastContext')>();
  return {
    ...actual,
    useToast: () => mockToast,
  };
});

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Stub heavy HeroUI components that misbehave in jsdom ─────────────────────
// GroupFilesTab imports its Modal parts from '@/components/ui/Modal', not from the barrel, so
// registering these stubs on the barrel alone left them dead and the real HeroUI Modal rendered.
// Hoisted so both the barrel factory and the direct-path factory share one definition. The stubs
// are prop-driven, so sharing them is safe.
const modalStub = vi.hoisted(() => ({
  Modal: ({ isOpen, children }: { isOpen?: boolean; children?: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label="Dialog">{children}</div> : null,
  ModalContent: ({ children }: { children?: ((onClose: () => void) => React.ReactNode) | React.ReactNode }) => (
    <div>{typeof children === 'function' ? children(() => {}) : children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => <div data-testid="modal-header">{children}</div>,
  ModalBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

// The Dropdown family is deliberately NOT stubbed. GroupFilesTab imports it from
// '@/components/ui/Dropdown', so the barrel override this file used to carry was dead and the real
// HeroUI Dropdown has always been what rendered — which is what the row-action assertions below
// were written against: they query role="menuitem", the real component's ARIA contract, a role a
// plain <button> stub does not expose. Activating a stub here would break four passing tests to no
// benefit, so the dead override was removed instead and the real Dropdown is used on purpose.
vi.mock('@/components/ui/Modal', () => modalStub);

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    useConfirm: () => mockConfirm,
    ...modalStub,
    SearchField: ({ placeholder, onValueChange, ...rest }: { placeholder?: string; onValueChange?: (v: string) => void; [key: string]: unknown }) => (
      <input
        placeholder={placeholder}
        onChange={(e) => onValueChange?.(e.target.value)}
        aria-label={rest['aria-label'] as string}
      />
    ),
    ToggleButtonGroup: ({ children }: { children?: React.ReactNode }) => <div data-testid="folder-filter">{children}</div>,
    ToggleButton: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <button data-testid={`toggle-btn-${id}`}>{children}</button>
    ),
  };
});

// ─── Stub EmptyState ──────────────────────────────────────────────────────────
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeFile = (overrides: Record<string, unknown> = {}) => {
  const uploadedBy = typeof overrides.uploaded_by === 'number' ? overrides.uploaded_by : 1;
  const uploaderName = typeof overrides.uploader_name === 'string' ? overrides.uploader_name : 'Alice';
  return ({
  id: 1,
  group_id: 10,
  file_name: 'meeting-notes.pdf',
  file_type: 'application/pdf',
  file_size: 102400, // 100 KB
  uploaded_by: uploadedBy,
  uploader_name: uploaderName,
  uploader_avatar: null,
  uploader: { id: uploadedBy, name: uploaderName, avatar_url: null },
  folder: null,
  description: null,
  download_count: 3,
  created_at: '2025-06-01T10:00:00Z',
  updated_at: '2025-06-01T10:00:00Z',
  capabilities: { can_download: true, can_delete: true },
  ...overrides,
  });
};

const makeFilesResponse = (items = [] as object[], extra = {}) => ({
  success: true,
  data: { items, cursor: null, has_more: false, ...extra },
});

const makeFoldersResponse = (folders = [] as object[]) => ({
  success: true,
  data: folders,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GroupFilesTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      return Promise.resolve(makeFilesResponse());
    });
    mockApi.delete.mockResolvedValue({ success: true, data: { message: 'deleted' } });
    mockApi.download.mockResolvedValue(undefined);
    mockApi.upload.mockResolvedValue({ success: true, data: { id: 33 } });
    mockConfirm.mockResolvedValue(true);
  });

  it('shows loading spinner on initial render', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} />);
    // Multiple role="status" exist (harness ToastProvider + component spinner)
    // Find the one with aria-busy="true" from the component
    const statusEls = screen.getAllByRole('status');
    const busyEl = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busyEl).toBeDefined();
  });

  it('shows empty state when no files are returned', async () => {
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('shows a retryable read error instead of a false empty state', async () => {
    let fileListCalls = 0;
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      fileListCalls += 1;
      if (fileListCalls === 1) return Promise.resolve({ success: false, code: 'HTTP_500' });
      return Promise.resolve(makeFilesResponse([makeFile({ file_name: 'recovered.pdf' })]));
    });

    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load files');
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText('recovered.pdf')).toBeInTheDocument();
  });

  it('surfaces and retries a failed folder-facet read', async () => {
    let folderCalls = 0;
    mockApi.get.mockImplementation((url: string) => {
      if (!url.includes('/folders')) return Promise.resolve(makeFilesResponse([makeFile()]));
      folderCalls += 1;
      return folderCalls === 1
        ? Promise.resolve({ success: false, code: 'HTTP_500' })
        : Promise.resolve(makeFoldersResponse([{ folder: 'Recovered', file_count: 1 }]));
    });
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load files');
    await userEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText('Recovered (1)')).toBeInTheDocument();
  });

  it('ignores a stale file page after the group changes', async () => {
    let resolveFirst: ((value: ReturnType<typeof makeFilesResponse>) => void) | undefined;
    const firstPage = new Promise<ReturnType<typeof makeFilesResponse>>((resolve) => {
      resolveFirst = resolve;
    });
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      if (url.includes('/groups/10/')) return firstPage;
      return Promise.resolve(makeFilesResponse([makeFile({ file_name: 'current-group.pdf' })]));
    });

    const { GroupFilesTab } = await import('./GroupFilesTab');
    const { rerender } = render(<GroupFilesTab groupId={10} isAdmin={false} />);
    rerender(<GroupFilesTab groupId={11} isAdmin={false} />);

    expect(await screen.findByText('current-group.pdf')).toBeInTheDocument();
    resolveFirst?.(makeFilesResponse([makeFile({ file_name: 'stale-group.pdf' })]));
    await waitFor(() => expect(screen.queryByText('stale-group.pdf')).not.toBeInTheDocument());
  });

  it('renders file name when files are returned', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      return Promise.resolve(makeFilesResponse([makeFile()]));
    });
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('meeting-notes.pdf')).toBeInTheDocument();
    });
  });

  it('renders uploader name alongside file', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      return Promise.resolve(makeFilesResponse([makeFile()]));
    });
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  it('shows upload button for members', async () => {
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} isMember={true} />);
    const button = await screen.findByRole('button', { name: 'Upload File' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const inputClick = vi.spyOn(input, 'click');
    await userEvent.click(button);
    expect(inputClick).toHaveBeenCalled();
  });

  it('hides upload button when isMember is false', async () => {
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} isMember={false} />);
    await waitFor(() => screen.getByTestId('empty-state'));
    const uploadBtns = screen.queryAllByRole('button').filter(
      (b) => b.textContent?.toLowerCase().includes('upload')
    );
    expect(uploadBtns).toHaveLength(0);
  });

  it('uploads the selected file with optional folder and description', async () => {
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} isMember={true} />);
    await screen.findByTestId('empty-state');

    const file = new File(['notes'], 'notes.pdf', { type: 'application/pdf' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Folder (optional)' }), 'Guides');
    await userEvent.type(screen.getByRole('textbox', { name: 'Description (optional)' }), 'Member guide');
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(mockApi.upload).toHaveBeenCalledWith(
      '/v2/groups/10/files',
      expect.any(FormData),
    ));
    const body = mockApi.upload.mock.calls[0]?.[1] as FormData;
    expect(body.get('file')).toBe(file);
    expect(body.get('folder')).toBe('Guides');
    expect(body.get('description')).toBe('Member guide');
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('supports removing a selected file and cancelling the upload modal', async () => {
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} isMember={true} />);
    await screen.findByTestId('empty-state');

    const file = new File(['notes'], 'notes.pdf', { type: 'application/pdf' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove file' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockApi.upload).not.toHaveBeenCalled();
  });

  it('rejects files over the client size limit before opening the modal', async () => {
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} isMember={true} />);
    await screen.findByTestId('empty-state');

    const file = new File(['large'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 25 * 1024 * 1024 + 1 });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockApi.upload).not.toHaveBeenCalled();
  });

  it('shows download button for each file', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      return Promise.resolve(makeFilesResponse([makeFile()]));
    });
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} />);
    await waitFor(() => {
      const downloadBtns = screen.getAllByRole('button').filter(
        (b) => b.getAttribute('aria-label')?.toLowerCase().includes('download')
      );
      expect(downloadBtns.length).toBeGreaterThan(0);
    });
  });

  it('calls download API when download button is clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      return Promise.resolve(makeFilesResponse([makeFile({ id: 5 })]));
    });
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} />);
    await waitFor(() => screen.getByText('meeting-notes.pdf'));

    const downloadBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('download')
    );
    if (downloadBtn) {
      await userEvent.click(downloadBtn);
      await waitFor(() => {
        expect(mockApi.download).toHaveBeenCalledWith(
          '/v2/groups/10/files/5/download',
          expect.objectContaining({ filename: 'meeting-notes.pdf' })
        );
      });
    }
  });

  it('shows delete option in dropdown for admin users', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      return Promise.resolve(makeFilesResponse([makeFile({ id: 7, uploaded_by: 99 })]));
    });
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={true} currentUserId={1} />);
    expect(await screen.findByRole('button', { name: 'File actions' })).toBeInTheDocument();
  });

  it('calls delete API when delete is confirmed', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      return Promise.resolve(makeFilesResponse([makeFile({ id: 8, uploaded_by: 1 })]));
    });
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} currentUserId={1} />);
    await waitFor(() => screen.getByText('meeting-notes.pdf'));

    await userEvent.click(screen.getByRole('button', { name: 'File actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringContaining('meeting-notes.pdf'),
      }));
      expect(mockApi.delete).toHaveBeenCalledWith('/v2/groups/10/files/8');
    });
  });

  it('does not delete when the destructive confirmation is cancelled', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      return Promise.resolve(makeFilesResponse([makeFile({ id: 8, uploaded_by: 1 })]));
    });
    mockConfirm.mockResolvedValue(false);
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} currentUserId={1} />);

    await userEvent.click(await screen.findByRole('button', { name: 'File actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockApi.delete).not.toHaveBeenCalled();
  });

  it('does not remove the file or toast success for a resolved delete failure', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      return Promise.resolve(makeFilesResponse([makeFile({ id: 8, uploaded_by: 1 })]));
    });
    mockApi.delete.mockResolvedValue({ success: false, code: 'HTTP_500' });
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} currentUserId={1} />);

    await userEvent.click(await screen.findByRole('button', { name: 'File actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(screen.getByText('meeting-notes.pdf')).toBeInTheDocument();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('shows error toast when download fails', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      return Promise.resolve(makeFilesResponse([makeFile({ id: 9 })]));
    });
    mockApi.download.mockRejectedValue(new Error('network'));
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} />);
    await waitFor(() => screen.getByText('meeting-notes.pdf'));

    const downloadBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('download')
    );
    if (downloadBtn) {
      await userEvent.click(downloadBtn);
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
    }
  });

  it('shows load more button when has_more is true', async () => {
    let page = 0;
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      page += 1;
      return Promise.resolve(page === 1
        ? makeFilesResponse([makeFile({ id: 1 })], { has_more: true, cursor: 'abc' })
        : makeFilesResponse([makeFile({ id: 2 })]));
    });
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} />);
    const loadMore = await screen.findByRole('button', { name: 'Load More' });
    await userEvent.click(loadMore);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(
      expect.stringContaining('cursor=abc'),
      { signal: expect.any(AbortSignal) },
    ));
  });

  it('renders folder filter chips when folders are returned', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) {
        return Promise.resolve(makeFoldersResponse([{ folder: 'Documents', file_count: 3 }]));
      }
      return Promise.resolve(makeFilesResponse([makeFile()]));
    });
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} />);
    expect(await screen.findByText('All Files')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Documents (3)'));
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(
      expect.stringContaining('folder=Documents'),
      { signal: expect.any(AbortSignal) },
    ));

    const callsBeforeAll = mockApi.get.mock.calls.length;
    await userEvent.click(screen.getByText('All Files'));
    await waitFor(() => expect(mockApi.get.mock.calls.length).toBeGreaterThan(callsBeforeAll));
    const latestFileCall = [...mockApi.get.mock.calls]
      .reverse()
      .find(([url]) => !(url as string).includes('/folders'));
    expect(latestFileCall?.[0]).not.toContain('folder=');
  });

  it('shows success toast after file deletion', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/folders')) return Promise.resolve(makeFoldersResponse());
      return Promise.resolve(makeFilesResponse([makeFile({ id: 20, uploaded_by: 1 })]));
    });
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={true} currentUserId={1} />);
    await waitFor(() => screen.getByText('meeting-notes.pdf'));

    await userEvent.click(screen.getByRole('button', { name: 'File actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('renders search field', async () => {
    const { GroupFilesTab } = await import('./GroupFilesTab');
    render(<GroupFilesTab groupId={10} isAdmin={false} />);
    // SearchField renders as an input with placeholder
    const searchBox = await screen.findByRole('searchbox', { name: 'Search files' });
    await userEvent.type(searchBox, 'safety guide');
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(
      expect.stringContaining('q=safety+guide'),
      { signal: expect.any(AbortSignal) },
    ));
  });
});
