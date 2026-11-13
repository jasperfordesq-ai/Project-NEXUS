// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { normalizeGroupApiError } from '../api/core';

const {
  mockCreatePage,
  mockDeletePage,
  mockGetPage,
  mockListPages,
  mockListRevisions,
  mockUpdatePage,
} = vi.hoisted(() => ({
  mockCreatePage: vi.fn(),
  mockDeletePage: vi.fn(),
  mockGetPage: vi.fn(),
  mockListPages: vi.fn(),
  mockListRevisions: vi.fn(),
  mockUpdatePage: vi.fn(),
}));

vi.mock('../api/wiki', () => ({
  createGroupWikiPage: mockCreatePage,
  deleteGroupWikiPage: mockDeletePage,
  getGroupWikiPage: mockGetPage,
  listGroupWikiPages: mockListPages,
  listGroupWikiRevisions: mockListRevisions,
  updateGroupWikiPage: mockUpdatePage,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return { ...actual, formatRelativeTime: (date: string) => `relative:${date}` };
});

vi.mock('@/components/ui/Select', () => ({
  Select: ({
    children,
    label,
    onSelectionChange,
    selectedKeys,
  }: {
    children?: React.ReactNode;
    label?: React.ReactNode;
    onSelectionChange?: (keys: Set<string>) => void;
    selectedKeys?: Set<string>;
  }) => (
    <label>
      {label}
      <select
        aria-label={typeof label === 'string' ? label : undefined}
        value={selectedKeys ? Array.from(selectedKeys)[0] : ''}
        onChange={(event) => onSelectionChange?.(new Set([event.target.value]))}
      >
        {children}
      </select>
    </label>
  ),
  SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
    <option value={id}>{children}</option>
  ),
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({
    action,
    description,
    title,
  }: {
    action?: React.ReactNode;
    description?: string;
    title: string;
  }) => (
    <div data-testid="empty-state">
      <p>{title}</p>
      {description && <p>{description}</p>}
      {action}
    </div>
  ),
}));

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

const makePage = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Getting Started',
  slug: 'getting-started',
  parent_id: null,
  sort_order: 0,
  is_published: true,
  author: { id: 10, name: 'Alice' },
  updated_at: '2024-06-01T00:00:00Z',
  ...overrides,
});

const makePageDetail = (overrides: Record<string, unknown> = {}) => ({
  ...makePage(),
  content: 'This is the page content.',
  ...overrides,
});

const makeRevision = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  change_summary: 'Initial version',
  editor: { id: 10, name: 'Alice' },
  created_at: '2024-06-01T00:00:00Z',
  ...overrides,
});

async function openPage(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Getting Started' }));
  await screen.findByText('This is the page content.');
}

describe('GroupWikiTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockListPages.mockResolvedValue([]);
    mockGetPage.mockResolvedValue(makePageDetail());
    mockCreatePage.mockResolvedValue(makePageDetail());
    mockUpdatePage.mockResolvedValue(makePageDetail({ content: 'Updated content' }));
    mockDeletePage.mockResolvedValue(undefined);
    mockListRevisions.mockResolvedValue([]);
  });

  it('shows loading then the truthful empty state', async () => {
    let resolvePages!: (pages: unknown[]) => void;
    mockListPages.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePages = resolve;
    }));
    const { GroupWikiTab } = await import('./GroupWikiTab');
    render(<GroupWikiTab groupId={5} isAdmin={false} isMember={true} />);

    expect(screen.getByRole('status', { name: 'Loading wiki' })).toBeInTheDocument();
    resolvePages([]);
    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
  });

  it('renders and retries a page-list error instead of offering a false empty state', async () => {
    mockListPages
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce([makePage()]);
    const { GroupWikiTab } = await import('./GroupWikiTab');
    render(<GroupWikiTab groupId={5} isAdmin={false} isMember={true} />);

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load the wiki pages.");
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /Getting Started/ })).toBeInTheDocument();
  });

  it('renders hierarchical navigation, draft state, and member-only create controls', async () => {
    mockListPages.mockResolvedValue([
      makePage({ is_published: false }),
      makePage({ id: 2, title: 'Child Page', slug: 'child', parent_id: 1, sort_order: 1 }),
    ]);
    const { GroupWikiTab } = await import('./GroupWikiTab');
    const { rerender } = render(
      <GroupWikiTab groupId={5} isAdmin={false} isMember={true} />,
    );

    expect(await screen.findByRole('button', { name: /Getting Started/ })).toBeInTheDocument();
    const childPageButton = screen.getByRole('button', { name: 'Child Page' });
    expect(childPageButton).toHaveClass('text-start');
    expect(childPageButton).toHaveStyle({ paddingInlineStart: '28px' });
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "New page" })).toBeInTheDocument();

    rerender(<GroupWikiTab groupId={5} isAdmin={false} isMember={false} />);
    expect(screen.queryByRole('button', { name: "New page" })).not.toBeInTheDocument();
  });

  it('navigates parent pages through the breadcrumb control', async () => {
    const child = makePage({ id: 2, title: 'Child Page', slug: 'child', parent_id: 1 });
    mockListPages.mockResolvedValue([makePage(), child]);
    mockGetPage.mockImplementation((_: number, slug: string) => Promise.resolve(
      slug === 'child'
        ? makePageDetail({ ...child, content: 'Child content' })
        : makePageDetail(),
    ));
    const { GroupWikiTab } = await import('./GroupWikiTab');
    render(<GroupWikiTab groupId={5} isAdmin={false} isMember={true} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Child Page' }));
    await screen.findByText('Child content');
    const breadcrumbs = screen.getByRole('navigation', { name: 'Wiki page breadcrumb' });
    fireEvent.click(within(breadcrumbs).getByRole('button', { name: 'Getting Started' }));

    await waitFor(() => expect(mockGetPage).toHaveBeenLastCalledWith(
      5,
      'getting-started',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(await screen.findByText('This is the page content.')).toBeInTheDocument();
  });

  it('renders malicious wiki markup as inert plain React text', async () => {
    const malicious = '<img src=x onerror="window.__wikiXss=1"><script>window.__wikiXss=2</script><a href="javascript:alert(1)">Wiki text</a>';
    mockListPages.mockResolvedValue([makePage()]);
    mockGetPage.mockResolvedValue(makePageDetail({ content: malicious }));
    const { GroupWikiTab } = await import('./GroupWikiTab');
    const { container } = render(<GroupWikiTab groupId={5} isAdmin={false} isMember={true} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Getting Started' }));
    expect(await screen.findByText(malicious, { exact: true })).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect((window as typeof window & { __wikiXss?: number }).__wikiXss).toBeUndefined();
  });

  it('creates a child page through every create-form control', async () => {
    mockListPages.mockResolvedValue([makePage()]);
    mockCreatePage.mockResolvedValue(makePageDetail({
      id: 2,
      title: 'Child Page',
      slug: 'child-page',
      parent_id: 1,
      content: 'Child content',
    }));
    const { GroupWikiTab } = await import('./GroupWikiTab');
    render(<GroupWikiTab groupId={5} isAdmin={false} isMember={true} />);
    await screen.findByRole('button', { name: 'Getting Started' });

    fireEvent.click(screen.getByRole('button', { name: "New page" }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: "New page" }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: "Page title" }), {
      target: { value: 'Child Page' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Parent Page (optional)' }), {
      target: { value: '1' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Content' }), {
      target: { value: 'Child content' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: "Create page" }));

    await waitFor(() => expect(mockCreatePage).toHaveBeenCalledWith(5, {
      title: 'Child Page',
      content: 'Child content',
      parent_id: 1,
    }));
    expect(mockToast.success).toHaveBeenCalledWith('Page created');
    await waitFor(() => expect(mockGetPage).toHaveBeenCalledWith(
      5,
      'child-page',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
  });

  it('keeps the create modal open and suppresses success on adapter failure', async () => {
    mockCreatePage.mockRejectedValue(normalizeGroupApiError({
      success: false,
      code: 'HTTP_403',
      status: 403,
    }));
    const { GroupWikiTab } = await import('./GroupWikiTab');
    render(<GroupWikiTab groupId={5} isAdmin={false} isMember={true} />);
    await screen.findByTestId('empty-state');

    fireEvent.click(screen.getByRole('button', { name: "New page" }));
    fireEvent.change(await screen.findByRole('textbox', { name: "Page title" }), {
      target: { value: 'Page' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Content' }), {
      target: { value: 'Content' },
    });
    fireEvent.click(screen.getByRole('button', { name: "Create page" }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("We couldn't create the page. Please try again."));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('loads, edits, cancels, and saves page content', async () => {
    mockListPages.mockResolvedValue([makePage()]);
    const { GroupWikiTab } = await import('./GroupWikiTab');
    const { rerender } = render(
      <GroupWikiTab groupId={5} isAdmin={false} isMember={true} />,
    );
    await openPage();
    expect(screen.queryByRole('button', { name: 'Delete page' })).not.toBeInTheDocument();
    rerender(<GroupWikiTab groupId={5} isAdmin={false} isMember={false} />);
    expect(screen.queryByRole('button', { name: 'Edit page' })).not.toBeInTheDocument();
    rerender(<GroupWikiTab groupId={5} isAdmin={false} isMember={true} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit page' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit page content' }), {
      target: { value: 'Discarded edit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('This is the page content.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit page' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit page content' }), {
      target: { value: 'Updated content' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Change summary (optional)' }), {
      target: { value: 'Clarified' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdatePage).toHaveBeenCalledWith(5, 1, {
      content: 'Updated content',
      change_summary: 'Clarified',
    }));
    expect(await screen.findByText('Updated content')).toBeInTheDocument();
    expect(mockToast.success).toHaveBeenCalledWith('Page saved');
  });

  it('renders and retries page and revision read errors', async () => {
    mockListPages.mockResolvedValue([makePage()]);
    mockGetPage
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(makePageDetail());
    mockListRevisions
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce([makeRevision()]);
    const { GroupWikiTab } = await import('./GroupWikiTab');
    render(<GroupWikiTab groupId={5} isAdmin={false} isMember={true} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Getting Started' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load that page.");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('This is the page content.');

    const historyButton = screen.getByRole('button', { name: 'View revision history' });
    expect(historyButton).toHaveAttribute('aria-expanded', 'false');
    expect(historyButton).toHaveAttribute('aria-controls', 'wiki-revisions-1');
    fireEvent.click(historyButton);
    expect(screen.getByRole('region', { name: "Revision history" })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load the page's history.");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Initial version')).toBeInTheDocument();
    expect(screen.getByText('Initial version').closest('li')?.querySelector('time')).toHaveAttribute(
      'dateTime',
      makeRevision().created_at,
    );
    fireEvent.click(screen.getByRole('button', { name: "Close history" }));
    expect(screen.queryByText('Initial version')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View revision history' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('preserves delete confirmation and only removes after confirmed success', async () => {
    mockListPages.mockResolvedValue([makePage()]);
    const { GroupWikiTab } = await import('./GroupWikiTab');
    render(<GroupWikiTab groupId={5} isAdmin={true} isMember={true} />);
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete page' }));
    let dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Are you sure you want to delete');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mockDeletePage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete page' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockDeletePage).toHaveBeenCalledWith(5, 1));
    expect(mockToast.success).toHaveBeenCalledWith('Page deleted');
    expect(screen.queryByText('This is the page content.')).not.toBeInTheDocument();
  });

  it('does not close delete confirmation or show success when deletion fails', async () => {
    mockListPages.mockResolvedValue([makePage()]);
    mockDeletePage.mockRejectedValue(normalizeGroupApiError({
      success: false,
      code: 'HTTP_403',
      status: 403,
    }));
    const { GroupWikiTab } = await import('./GroupWikiTab');
    render(<GroupWikiTab groupId={5} isAdmin={true} isMember={true} />);
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete page' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("We couldn't delete the page. Please try again."));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('aborts stale page reads and keeps the latest selection', async () => {
    const secondPage = makePage({ id: 2, title: 'Second', slug: 'second' });
    mockListPages.mockResolvedValue([makePage(), secondPage]);
    let firstSignal: AbortSignal | undefined;
    mockGetPage.mockImplementation((_: number, slug: string, options: { signal: AbortSignal }) => {
      if (slug === 'getting-started') {
        firstSignal = options.signal;
        return new Promise(() => {});
      }
      return Promise.resolve(makePageDetail({
        ...secondPage,
        content: 'Second page content',
      }));
    });
    const { GroupWikiTab } = await import('./GroupWikiTab');
    render(<GroupWikiTab groupId={5} isAdmin={false} isMember={true} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Getting Started' }));
    fireEvent.click(screen.getByRole('button', { name: 'Second' }));
    expect(await screen.findByText('Second page content')).toBeInTheDocument();
    expect(firstSignal?.aborted).toBe(true);
  });

  it('aborts list, page, and revision reads on unmount', async () => {
    mockListPages.mockResolvedValue([makePage()]);
    mockListRevisions.mockImplementationOnce(() => new Promise(() => {}));
    const { GroupWikiTab } = await import('./GroupWikiTab');
    const { unmount } = render(
      <GroupWikiTab groupId={5} isAdmin={false} isMember={true} />,
    );
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: 'View revision history' }));
    await waitFor(() => expect(mockListRevisions).toHaveBeenCalled());

    const listSignal = mockListPages.mock.calls[0]?.[1]?.signal as AbortSignal;
    const pageSignal = mockGetPage.mock.calls[0]?.[2]?.signal as AbortSignal;
    const revisionSignal = mockListRevisions.mock.calls[0]?.[2]?.signal as AbortSignal;
    unmount();

    expect(listSignal.aborted).toBe(true);
    expect(pageSignal.aborted).toBe(true);
    expect(revisionSignal.aborted).toBe(true);
  });
});
