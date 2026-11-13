// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoist mock data ───────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
  },
}));

// ── Mock api ──────────────────────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
    formatRelativeTime: () => '2 days ago',
    responsiveThumbnailProps: (url: string) => ({ src: url }),
    resolveThumbnailUrl: (url: string | null | undefined) => url ?? '',
  };
});

// ── Contexts ──────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockConfirm = vi.fn();

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('@/components/ui/ConfirmDialog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/ConfirmDialog')>()),
  useConfirm: () => mockConfirm,
}));

vi.mock('@/components/ui/useDisclosure', () => ({
  useDisclosure: () => {
    const [isOpen, setIsOpen] = React.useState(false);
    return {
      isOpen,
      onOpen: () => setIsOpen(true),
      onClose: () => setIsOpen(false),
    };
  },
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    className,
    isDisabled,
    isLoading,
    isPending,
    onPress,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode | ((state: { isPending: boolean }) => React.ReactNode);
    className?: string;
    isDisabled?: boolean;
    isLoading?: boolean;
    isPending?: boolean;
    onPress?: () => void;
    'aria-label'?: string;
  }) => (
    <button
      type="button"
      className={className}
      disabled={isDisabled}
      aria-label={ariaLabel}
      onClick={onPress}
    >
      {typeof children === 'function'
        ? children({ isPending: Boolean(isLoading || isPending) })
        : children}
    </button>
  ),
}));

vi.mock('@/components/ui/GlassCard', () => ({
  GlassCard: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <div data-testid="glass-card" onClick={onClick}>{children}</div>
  ),
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: { children?: React.ReactNode; isOpen?: boolean }) =>
    isOpen ? <div role="dialog" aria-label="Dialog">{children}</div> : null,
  ModalContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  ModalHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ModalBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/Spinner', () => ({
  Spinner: ({ size }: { size?: string }) => (
    <div role="status" aria-busy="true" aria-label="loading" data-size={size} />
  ),
}));

vi.mock('@/components/ui/ToggleButtonGroup', () => ({
  ToggleButtonGroup: ({ children, onSelectionChange, selectedKeys }: {
    children?: React.ReactNode;
    onSelectionChange?: (keys: Set<string>) => void;
    selectedKeys?: Set<string>;
  }) => (
    <div data-testid="toggle-group" data-selected={[...(selectedKeys ?? [])].join(',')}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement<{ id?: string }>(child)) return child;
        return React.cloneElement(child, {
          onClick: () => onSelectionChange?.(new Set([child.props.id ?? ''])),
        } as { onClick: () => void });
      })}
    </div>
  ),
  ToggleButton: ({ children, id, onClick }: {
    children?: React.ReactNode;
    id?: string;
    onClick?: () => void;
  }) => <button data-testid={`filter-${id}`} onClick={onClick}>{children}</button>,
}));

// ── Stub HeroUI heavy components ──────────────────────────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    // useDisclosure stub
    useDisclosure: () => ({
      isOpen: false,
      onOpen: vi.fn(),
      onClose: vi.fn(),
    }),
    // useConfirm stub — returns the mock function
    useConfirm: () => mockConfirm,
    // Modal stub — always closed unless tested directly
    Modal: ({ children, isOpen }: { children?: React.ReactNode; isOpen?: boolean }) =>
      isOpen ? <div role="dialog" aria-label="Dialog">{children as React.ReactNode}</div> : null,
    ModalContent: ({ children }: { children?: React.ReactNode }) => <>{children as React.ReactNode}</>,
    ModalHeader: ({ children }: { children?: React.ReactNode }) => <div>{children as React.ReactNode}</div>,
    ModalBody: ({ children }: { children?: React.ReactNode }) => <div>{children as React.ReactNode}</div>,
    ModalFooter: ({ children }: { children?: React.ReactNode }) => <div>{children as React.ReactNode}</div>,
    // ToggleButtonGroup stub
    ToggleButtonGroup: ({ children, onSelectionChange, selectedKeys }: {
      children?: React.ReactNode;
      onSelectionChange?: (keys: Set<string>) => void;
      selectedKeys?: Set<string>;
    }) => (
      <div data-testid="toggle-group" data-selected={[...(selectedKeys ?? [])].join(',')}>
        {React.Children.map(children as React.ReactNode, (child) => {
          if (React.isValidElement(child)) {
            return React.cloneElement(child as React.ReactElement<{
              onClick?: () => void;
              id?: string;
            }>, {
              onClick: () => onSelectionChange?.(new Set([(child.props as { id?: string }).id ?? ''])),
            });
          }
          return child;
        })}
      </div>
    ),
    ToggleButton: ({ children, id, onClick }: {
      children?: React.ReactNode;
      id?: string;
      onClick?: () => void;
    }) => (
      <button data-testid={`filter-${id}`} onClick={onClick}>{children as React.ReactNode}</button>
    ),
    GlassCard: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <div data-testid="glass-card" onClick={onClick}>{children as React.ReactNode}</div>
    ),
    Spinner: ({ size }: { size?: string }) => <div role="status" aria-busy="true" aria-label="loading" data-size={size} />,
    Button: ({ children, onPress, isDisabled, 'aria-label': label, ...rest }: {
      children?: React.ReactNode;
      onPress?: () => void;
      isDisabled?: boolean;
      'aria-label'?: string;
      [key: string]: unknown;
    }) => (
      <button
        onClick={onPress}
        disabled={!!isDisabled}
        aria-label={label}
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children as React.ReactNode}
      </button>
    ),
  };
});

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <p>{title}</p>
      {description && <p>{description}</p>}
    </div>
  ),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const makeMediaItem = (overrides: Record<string, unknown> = {}) => {
  const uploadedBy = typeof overrides.uploaded_by === 'number' ? overrides.uploaded_by : 99;
  const uploaderName = typeof overrides.uploader_name === 'string' ? overrides.uploader_name : 'Alice';
  return ({
  id: 1,
  group_id: 42,
  type: 'image' as const,
  original_name: 'photo.jpg',
  mime_type: 'image/jpeg',
  url: 'https://cdn.example.com/photo.jpg',
  thumbnail_url: 'https://cdn.example.com/thumb.jpg',
  caption: 'A test photo',
  file_size: 1024,
  width: 640,
  height: 480,
  uploaded_by: uploadedBy,
  uploader_name: uploaderName,
  uploader_avatar: null,
  uploader: { id: uploadedBy, name: uploaderName, avatar_url: null },
  created_at: '2025-06-01T10:00:00Z',
  updated_at: '2025-06-01T10:00:00Z',
  capabilities: { can_view: true, can_delete: true },
  ...overrides,
  });
};

const makeMediaResponse = (items = [] as ReturnType<typeof makeMediaItem>[], extras = {}) => ({
  success: true,
  data: {
    items,
    cursor: null,
    has_more: false,
    ...extras,
  },
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('GroupMediaTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockApi.get.mockResolvedValue(makeMediaResponse());
    mockApi.upload.mockResolvedValue({ success: true, data: { id: 22 } });
    mockApi.delete.mockResolvedValue({ success: true, data: { message: 'deleted' } });
    mockApi.download.mockResolvedValue(new Blob(['media']));
  });

  it('shows loading spinner while media fetches', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders empty state when no media items', async () => {
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders media cards when items are returned', async () => {
    mockApi.get.mockResolvedValue(makeMediaResponse([makeMediaItem()]));
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('glass-card')).toBeInTheDocument();
    });
  });

  it('renders multiple media cards', async () => {
    mockApi.get.mockResolvedValue(
      makeMediaResponse([
        makeMediaItem({ id: 1 }),
        makeMediaItem({ id: 2 }),
        makeMediaItem({ id: 3 }),
      ])
    );
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('glass-card')).toHaveLength(3);
    });
  });

  it('renders upload button for members', async () => {
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={false} isMember={true} />);

    const uploadButton = await screen.findByRole('button', { name: 'Upload photo or video' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const inputClick = vi.spyOn(input, 'click');
    fireEvent.click(uploadButton);
    expect(inputClick).toHaveBeenCalled();
  });

  it('does not render upload button for non-members', async () => {
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={false} isMember={false} />);

    await waitFor(() => {
      expect(screen.queryByTestId('empty-state')).toBeInTheDocument();
    });

    const uploadBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('upload')
    );
    expect(uploadBtn).toBeUndefined();
  });

  it('uploads a valid selected image and only then shows success', async () => {
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={false} isMember={true} />);
    await screen.findByTestId('empty-state');

    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(mockApi.upload).toHaveBeenCalledWith(
      '/v2/groups/42/media',
      expect.any(FormData),
    ));
    expect((mockApi.upload.mock.calls[0]?.[1] as FormData).get('file')).toBe(file);
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('rejects unsupported upload types before calling the API', async () => {
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={false} isMember={true} />);
    await screen.findByTestId('empty-state');

    const file = new File(['text'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockApi.upload).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('rejects media over its type-specific size limit before uploading', async () => {
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={false} isMember={true} />);
    await screen.findByTestId('empty-state');

    const file = new File(['video'], 'video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 + 1 });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockApi.upload).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('renders filter toggle buttons', async () => {
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('filter-all')).toBeInTheDocument();
      expect(screen.getByTestId('filter-image')).toBeInTheDocument();
      expect(screen.getByTestId('filter-video')).toBeInTheDocument();
    });
  });

  it('shows load more button when has_more is true', async () => {
    mockApi.get
      .mockResolvedValueOnce(makeMediaResponse(
        [makeMediaItem({ id: 1 })],
        { has_more: true, cursor: 'abc' },
      ))
      .mockResolvedValueOnce(makeMediaResponse([makeMediaItem({ id: 2 })]));
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    fireEvent.click(await screen.findByRole('button', { name: "Load more" }));
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(
      expect.stringContaining('cursor=abc'),
      { signal: expect.any(AbortSignal) },
    ));
  });

  it('renders delete button for admin', async () => {
    mockApi.get.mockResolvedValue(makeMediaResponse([makeMediaItem()]));
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    await waitFor(() => {
      const deleteBtn = screen.queryAllByRole('button').find(
        (b) => b.getAttribute('aria-label')?.toLowerCase().includes('delete')
      );
      expect(deleteBtn).toBeDefined();
      expect(deleteBtn).toHaveClass('size-11', 'min-h-11', 'min-w-11');
      expect(deleteBtn).toHaveClass(
        'pointer-coarse:opacity-100',
        'pointer-fine:opacity-0',
        'pointer-fine:group-hover:opacity-100',
        'group-focus-within:opacity-100',
        'focus-visible:opacity-100',
      );
    });
  });

  it('shows a retryable read error instead of a false empty gallery', async () => {
    mockApi.get
      .mockResolvedValueOnce({ success: false, code: 'HTTP_500' })
      .mockResolvedValueOnce(makeMediaResponse([makeMediaItem({ caption: 'Recovered photo' })]));
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Try again" }));
    expect(await screen.findByAltText('Recovered photo')).toBeInTheDocument();
  });

  it('ignores a stale media page after the group changes', async () => {
    let resolveFirst: ((value: ReturnType<typeof makeMediaResponse>) => void) | undefined;
    const firstPage = new Promise<ReturnType<typeof makeMediaResponse>>((resolve) => {
      resolveFirst = resolve;
    });
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/groups/42/')) return firstPage;
      return Promise.resolve(makeMediaResponse([makeMediaItem({ caption: 'Current group photo' })]));
    });

    const { GroupMediaTab } = await import('./GroupMediaTab');
    const { rerender } = render(<GroupMediaTab groupId={42} isAdmin={true} />);
    rerender(<GroupMediaTab groupId={43} isAdmin={true} />);

    expect(await screen.findByAltText('Current group photo')).toBeInTheDocument();
    resolveFirst?.(makeMediaResponse([makeMediaItem({ caption: 'Stale group photo' })]));
    await waitFor(() => expect(screen.queryByAltText('Stale group photo')).not.toBeInTheDocument());
  });

  it('calls DELETE api after confirm on delete click', async () => {
    mockApi.get.mockResolvedValue(makeMediaResponse([makeMediaItem({ id: 5 })]));
    mockApi.delete.mockResolvedValue({ success: true, data: { message: 'deleted' } });
    mockConfirm.mockResolvedValue(true);

    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    await waitFor(() => expect(screen.getByTestId('glass-card')).toBeInTheDocument());

    const deleteBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('delete')
    );
    if (deleteBtn) {
      fireEvent.click(deleteBtn);
      await waitFor(() => {
        expect(mockApi.delete).toHaveBeenCalledWith('/v2/groups/42/media/5');
      });
    }
  });

  it('shows success toast after delete', async () => {
    mockApi.get.mockResolvedValue(makeMediaResponse([makeMediaItem({ id: 5 })]));
    mockApi.delete.mockResolvedValue({ success: true, data: { message: 'deleted' } });
    mockConfirm.mockResolvedValue(true);

    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    await waitFor(() => expect(screen.getByTestId('glass-card')).toBeInTheDocument());

    const deleteBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('delete')
    );
    if (deleteBtn) {
      fireEvent.click(deleteBtn);
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });

  it('does not delete if confirm is cancelled', async () => {
    mockApi.get.mockResolvedValue(makeMediaResponse([makeMediaItem({ id: 5 })]));
    mockConfirm.mockResolvedValue(false);

    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    await waitFor(() => expect(screen.getByTestId('glass-card')).toBeInTheDocument());

    const deleteBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('delete')
    );
    if (deleteBtn) {
      fireEvent.click(deleteBtn);
      await waitFor(() => {
        expect(mockApi.delete).not.toHaveBeenCalled();
      });
    }
  });

  it('keeps media visible and avoids success for a resolved delete failure', async () => {
    mockApi.get.mockResolvedValue(makeMediaResponse([makeMediaItem({ id: 5 })]));
    mockApi.delete.mockResolvedValue({ success: false, code: 'HTTP_500' });
    mockConfirm.mockResolvedValue(true);
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    const deleteBtn = (await screen.findAllByRole('button')).find(
      (button) => button.getAttribute('aria-label')?.toLowerCase().includes('delete'),
    );
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn as HTMLButtonElement);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(screen.getByTestId('glass-card')).toBeInTheDocument();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('opens the lightbox and exercises next, previous, and close controls', async () => {
    mockApi.get.mockResolvedValue(makeMediaResponse([
      makeMediaItem({ id: 1, caption: 'First photo' }),
      makeMediaItem({ id: 2, caption: 'Second photo' }),
    ]));
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={false} isMember={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'First photo' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByAltText('First photo')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByAltText('Second photo')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getAllByAltText('First photo')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('changes between photo, video, and all filters', async () => {
    const { GroupMediaTab } = await import('./GroupMediaTab');
    render(<GroupMediaTab groupId={42} isAdmin={true} />);

    await waitFor(() => screen.getByTestId('filter-image'));

    fireEvent.click(screen.getByTestId('filter-image'));

    await waitFor(() => {
      // API should be called with type=image
      const calls = mockApi.get.mock.calls;
      const imageCall = calls.find(([url]: [string]) => url.includes('type=image'));
      expect(imageCall).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('filter-video'));
    await waitFor(() => expect(mockApi.get.mock.calls.some(
      ([url]: [string]) => url.includes('type=video'),
    )).toBe(true));

    const callCount = mockApi.get.mock.calls.length;
    fireEvent.click(screen.getByTestId('filter-all'));
    await waitFor(() => expect(mockApi.get.mock.calls.length).toBeGreaterThan(callCount));
    const latestUrl = mockApi.get.mock.calls.at(-1)?.[0] as string;
    expect(latestUrl).not.toContain('type=');
  });
});
