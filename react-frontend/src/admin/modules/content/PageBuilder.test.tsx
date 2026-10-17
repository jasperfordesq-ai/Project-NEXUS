// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import { ConfirmDialogProvider } from '@/components/ui';

// ── admin api mock ────────────────────────────────────────────────────────
const { mockAdminPages } = vi.hoisted(() => ({
  mockAdminPages: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
}));

const { mockContentEditorState } = vi.hoisted(() => ({
  mockContentEditorState: {
    flushPayload: null as null | { content: string; content_format: 'plaintext' | 'richtext' | 'html' | 'builder'; design_json?: string | null },
  },
}));

const { mockRouterState } = vi.hoisted(() => ({
  mockRouterState: {
    params: { id: undefined as string | undefined },
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminPages: mockAdminPages,
}));

// ── RichTextEditor (lazy) – stub so Suspense resolves immediately ──────────
vi.mock('../../components/RichTextEditor', () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="rich-text-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Content"
    />
  ),
}));

vi.mock('../../components/PageContentEditor', async () => {
  const React = await import('react');
  return {
    PageContentEditor: React.forwardRef(function MockPageContentEditor(
      {
        value,
        format,
        designJson,
        onChange,
      }: {
        value: string;
        format: 'plaintext' | 'richtext' | 'html' | 'builder';
        designJson?: string | null;
        onChange: (next: { content: string; content_format: 'plaintext' | 'richtext' | 'html' | 'builder'; design_json?: string | null }) => void;
      },
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({
        flush: () => mockContentEditorState.flushPayload ?? { content: value, content_format: format },
      }), [format, value]);
      return (
        <textarea
          data-testid="rich-text-editor"
          data-format={format}
          data-design-json={designJson ?? ''}
          value={value}
          onChange={(e) => onChange({ content: e.target.value, content_format: format })}
          aria-label="Content"
        />
      );
    }),
  };
});

// ── contexts ──────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();
const mockRefreshTenant = vi.fn();
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
      refreshTenant: mockRefreshTenant,
    }),
    useAuth: () => ({
      user: { tenant_slug: 'test' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  }),
);

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: () => mockRouterState.params,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── component ─────────────────────────────────────────────────────────────
import { PageBuilder } from './PageBuilder';

const renderPageBuilder = () => render(
  <ConfirmDialogProvider>
    <PageBuilder />
  </ConfirmDialogProvider>,
);

describe('PageBuilder — create mode (id=undefined)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContentEditorState.flushPayload = null;
    mockRouterState.params = { id: undefined };
  });

  it('renders create form with title and slug inputs', async () => {
    renderPageBuilder();
    // Wait for Suspense to resolve lazy RichTextEditor
    await screen.findByTestId('rich-text-editor');
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0);
  });

  it('auto-slugifies title as user types', async () => {
    const user = userEvent.setup();
    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    // Find the title input (first required textbox)
    const inputs = screen.getAllByRole('textbox');
    const titleInput = inputs.find(
      (el) =>
        el.getAttribute('placeholder')?.toLowerCase().includes('name') ||
        el.closest('label')?.textContent?.toLowerCase().includes('title') ||
        el.id?.toLowerCase().includes('title'),
    ) ?? inputs[0];

    await user.type(titleInput!, 'My Test Page');

    // The slug field should now contain something derived from the title
    const allInputs = screen.getAllByRole('textbox');
    const hasSlugValue = allInputs.some((el) =>
      (el as HTMLInputElement).value.includes('my-test-page') ||
      (el as HTMLInputElement).value.includes('my'),
    );
    expect(hasSlugValue).toBe(true);
  });

  it('transliterates accented titles into the slug', async () => {
    const user = userEvent.setup();
    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    const inputs = screen.getAllByRole('textbox');
    await user.type(inputs[0]!, 'Über uns café');

    expect((screen.getAllByRole('textbox')[1] as HTMLInputElement).value).toBe('uber-uns-cafe');
  });

  it('accepts about as a slug now that pages live under /page/', async () => {
    const user = userEvent.setup();
    mockAdminPages.create.mockResolvedValueOnce({ success: true, data: { id: 11, slug: 'about' } });
    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    const inputs = screen.getAllByRole('textbox');
    await user.type(inputs[0]!, 'Our Charity');
    await user.clear(inputs[1]!);
    await user.type(inputs[1]!, 'about');
    expect(screen.getAllByRole('textbox')[1]).not.toHaveAttribute('aria-invalid', 'true');

    await user.click(screen.getByRole('button', { name: /create|save/i }));

    await waitFor(() => expect(mockAdminPages.create).toHaveBeenCalled());
    expect(mockAdminPages.create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'about' }));
    expect(mockToast.warning).not.toHaveBeenCalled();
  });

  it('lets a title with no latin letters save and leaves the slug for the server', async () => {
    const user = userEvent.setup();
    mockAdminPages.create.mockResolvedValueOnce({ success: true, data: { id: 12, slug: 'page-a1b2c3' } });
    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    await user.type(screen.getAllByRole('textbox')[0]!, '日本語ページ');
    expect((screen.getAllByRole('textbox')[1] as HTMLInputElement).value).toBe('');

    await user.click(screen.getByRole('button', { name: /create|save/i }));

    await waitFor(() => expect(mockAdminPages.create).toHaveBeenCalled());
    expect(mockAdminPages.create).toHaveBeenCalledWith(expect.objectContaining({ slug: '' }));
    expect(mockToast.warning).not.toHaveBeenCalled();
  });

  it('shows warning toast when saving with empty title', async () => {
    const user = userEvent.setup();
    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    // Attempt to save without a title
    const saveBtn = screen.getByRole('button', { name: /create|save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.warning).toHaveBeenCalled();
    });
    expect(mockAdminPages.create).not.toHaveBeenCalled();
  });

  it('calls adminPages.create and navigates on success', async () => {
    const user = userEvent.setup();
    mockAdminPages.create.mockResolvedValueOnce({ success: true, data: { id: 5 } });

    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    const inputs = screen.getAllByRole('textbox');
    // type title into first textbox
    await user.type(inputs[0]!, 'About Us');

    const saveBtn = screen.getByRole('button', { name: /create|save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminPages.create).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
    expect(mockNavigate).toHaveBeenCalled();
    expect(mockRefreshTenant).toHaveBeenCalledWith({ silent: true });
  });

  it('sends the manually edited slug when creating a page', async () => {
    const user = userEvent.setup();
    mockAdminPages.create.mockResolvedValueOnce({ success: true, data: { id: 8 } });

    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    const inputs = screen.getAllByRole('textbox');
    await user.type(inputs[0]!, 'Beautiful Public Page');
    await user.clear(inputs[1]!);
    await user.type(inputs[1]!, 'tenant-two-style');

    await user.click(screen.getByRole('button', { name: /create|save/i }));

    await waitFor(() => expect(mockAdminPages.create).toHaveBeenCalled());
    expect(mockAdminPages.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Beautiful Public Page',
      slug: 'tenant-two-style',
    }));
  });

  it('shows error toast when create fails', async () => {
    const user = userEvent.setup();
    mockAdminPages.create.mockResolvedValueOnce({
      success: false,
      error: 'Duplicate slug',
    });

    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    const inputs = screen.getAllByRole('textbox');
    await user.type(inputs[0]!, 'About Us');

    const saveBtn = screen.getByRole('button', { name: /create|save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the server message and marks the slug field when the slug is taken', async () => {
    const user = userEvent.setup();
    mockAdminPages.create.mockResolvedValueOnce({
      success: false,
      errors: [{ code: 'VALIDATION_ERROR', message: 'Slug already in use', field: 'slug' }],
    });

    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    const inputs = screen.getAllByRole('textbox');
    await user.type(inputs[0]!, 'About Us');
    await user.click(screen.getByRole('button', { name: /create|save/i }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Slug already in use'));
    expect(screen.getAllByRole('textbox')[1]).toHaveAttribute('aria-invalid', 'true');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('tells the admin when the saved slug differs from the typed one', async () => {
    const user = userEvent.setup();
    mockAdminPages.create.mockResolvedValueOnce({ success: true, data: { id: 9, slug: 'our-story-1' } });

    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    const inputs = screen.getAllByRole('textbox');
    await user.type(inputs[0]!, 'Our Story');
    await user.click(screen.getByRole('button', { name: /create|save/i }));

    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    expect(mockToast.success.mock.calls[0]![0]).toContain('/page/our-story-1');
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('offers About and Header column as menu locations', async () => {
    const user = userEvent.setup();
    mockAdminPages.create.mockResolvedValueOnce({ success: true, data: { id: 9 } });
    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    await user.type(screen.getAllByRole('textbox')[0]!, 'Our Work');
    await user.click(screen.getByRole('switch'));
    await user.click(await screen.findByRole('button', { name: /location/i }));

    expect(await screen.findByRole('option', { name: 'About Section' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Footer' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.click(screen.getByRole('option', { name: /^Header column/ }));

    await user.click(screen.getByRole('button', { name: /create|save/i }));
    await waitFor(() => expect(mockAdminPages.create).toHaveBeenCalled());
    expect(mockAdminPages.create).toHaveBeenCalledWith(expect.objectContaining({
      show_in_menu: 1,
      menu_location: 'header',
    }));
  });

  it('submits the latest flushed builder HTML and design_json when saving immediately', async () => {
    const user = userEvent.setup();
    mockContentEditorState.flushPayload = {
      content: '<style>.hero{color:red}</style><section class="hero">Latest</section>',
      content_format: 'builder',
      design_json: '{"pages":[{"frames":[]}]}',
    };
    mockAdminPages.create.mockResolvedValueOnce({ success: true, data: { id: 6 } });

    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    await user.type(screen.getAllByRole('textbox')[0]!, 'Builder Page');
    await user.click(screen.getByRole('button', { name: /create|save/i }));

    await waitFor(() => expect(mockAdminPages.create).toHaveBeenCalled());
    expect(mockAdminPages.create).toHaveBeenCalledWith(expect.objectContaining({
      content: '<style>.hero{color:red}</style><section class="hero">Latest</section>',
      content_format: 'builder',
      design_json: '{"pages":[{"frames":[]}]}',
    }));
  });

  it('clears design_json in the payload when the flushed content is no longer builder mode', async () => {
    const user = userEvent.setup();
    mockContentEditorState.flushPayload = {
      content: '<p>Plain saved content</p>',
      content_format: 'html',
      design_json: '{"pages":[{"frames":[]}]}',
    };
    mockAdminPages.create.mockResolvedValueOnce({ success: true, data: { id: 7 } });

    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    await user.type(screen.getAllByRole('textbox')[0]!, 'HTML Page');
    await user.click(screen.getByRole('button', { name: /create|save/i }));

    await waitFor(() => expect(mockAdminPages.create).toHaveBeenCalled());
    expect(mockAdminPages.create).toHaveBeenCalledWith(expect.objectContaining({
      content_format: 'html',
      design_json: null,
    }));
  });
});

describe('PageBuilder — edit mode (id=3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContentEditorState.flushPayload = null;
    mockRouterState.params = { id: '3' };
  });

  it('loads existing builder content and design_json into the editor', async () => {
    mockAdminPages.get.mockResolvedValueOnce({
      success: true,
      data: {
        title: 'Existing Builder Page',
        slug: 'existing-builder-page',
        content: '<section>Saved builder HTML</section>',
        content_format: 'builder',
        design_json: '{"pages":[{"frames":[{"component":{"type":"wrapper"}}]}]}',
        meta_description: 'Existing meta',
        status: 'published',
        show_in_menu: true,
        menu_location: 'header',
        menu_order: 2,
      },
    });

    renderPageBuilder();

    const editor = await screen.findByTestId('rich-text-editor');
    expect(mockAdminPages.get).toHaveBeenCalledWith(3);
    expect(editor).toHaveValue('<section>Saved builder HTML</section>');
    expect(editor).toHaveAttribute('data-format', 'builder');
    expect(editor).toHaveAttribute('data-design-json', '{"pages":[{"frames":[{"component":{"type":"wrapper"}}]}]}');
  });

  it('saves the latest flushed builder HTML and design_json in edit mode', async () => {
    const user = userEvent.setup();
    mockAdminPages.get.mockResolvedValueOnce({
      success: true,
      data: {
        title: 'Existing Builder Page',
        slug: 'existing-builder-page',
        content: '<section>Old</section>',
        content_format: 'builder',
        design_json: '{"pages":[{"frames":[]}]}',
        status: 'draft',
      },
    });
    mockContentEditorState.flushPayload = {
      content: '<style>.hero{color:red}</style><section class="hero">Latest edit</section>',
      content_format: 'builder',
      design_json: '{"pages":[{"frames":[{"component":{"tagName":"section"}}]}]}',
    };
    mockAdminPages.update.mockResolvedValueOnce({ success: true, data: { id: 3 } });

    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockAdminPages.update).toHaveBeenCalled());
    expect(mockAdminPages.update).toHaveBeenCalledWith(3, expect.objectContaining({
      content: '<style>.hero{color:red}</style><section class="hero">Latest edit</section>',
      content_format: 'builder',
      design_json: '{"pages":[{"frames":[{"component":{"tagName":"section"}}]}]}',
    }));
  });

  it('clears design_json when edit mode saves a non-builder format', async () => {
    const user = userEvent.setup();
    mockAdminPages.get.mockResolvedValueOnce({
      success: true,
      data: {
        title: 'Existing Builder Page',
        slug: 'existing-builder-page',
        content: '<section>Old</section>',
        content_format: 'builder',
        design_json: '{"pages":[{"frames":[]}]}',
        status: 'draft',
      },
    });
    mockContentEditorState.flushPayload = {
      content: '<p>HTML now</p>',
      content_format: 'html',
      design_json: '{"pages":[{"frames":[]}]}',
    };
    mockAdminPages.update.mockResolvedValueOnce({ success: true, data: { id: 3 } });

    renderPageBuilder();
    await screen.findByTestId('rich-text-editor');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockAdminPages.update).toHaveBeenCalled());
    expect(mockAdminPages.update).toHaveBeenCalledWith(3, expect.objectContaining({
      content: '<p>HTML now</p>',
      content_format: 'html',
      design_json: null,
    }));
  });
});
