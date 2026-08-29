// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Stable mock refs (hoisted so they're available inside vi.mock factories) ──
const { mockToast, mockNavigate, mockUseParams, mockAdminBlog, mockAdminCategories } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockNavigate: vi.fn(),
  // By default, no :id param → create mode. Tests that need edit mode set this.
  mockUseParams: vi.fn(() => ({ id: undefined as string | undefined })),
  mockAdminBlog: { get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), list: vi.fn(), uploadFeaturedImage: vi.fn() },
  mockAdminCategories: { list: vi.fn() },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

// ── Mock react-router-dom preserving actual exports ───────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockUseParams(),
  };
});

// ── adminApi mock ─────────────────────────────────────────────────────────────
vi.mock('@/admin/api/adminApi', () => ({
  adminBlog: mockAdminBlog,
  adminCategories: mockAdminCategories,
}));

// ── Lazy RichTextEditor mock ──────────────────────────────────────────────────
vi.mock('../../components/RichTextEditor', () => ({
  RichTextEditor: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <textarea
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { BlogPostForm } from './BlogPostForm';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderCreate() {
  mockUseParams.mockReturnValue({ id: undefined });
  mockAdminCategories.list.mockResolvedValue({ success: true, data: [] });
  return render(<BlogPostForm />);
}

function renderEdit(id = '42') {
  mockUseParams.mockReturnValue({ id });
  mockAdminCategories.list.mockResolvedValue({ success: true, data: [] });
  return render(<BlogPostForm />);
}

// The title input has label "Title" (exact) and the meta_title input has "Meta title".
// Use exact-word match to avoid the "Meta title" input.
function getTitleInput() {
  // getAllByRole returns all matching — pick the first whose label text is exactly "Title"
  const textboxes = screen.getAllByRole('textbox');
  // Find the one whose accessible name is exactly "Title" or starts with "Title" (not "Meta")
  return (
    textboxes.find((el) => {
      const label = el.getAttribute('aria-label') ?? '';
      const name = label || el.getAttribute('placeholder') || '';
      return /^label_title$|^Title$/i.test(name) || /^label_title$|^Title$/i.test(el.getAttribute('id') ?? '');
    }) ??
    // Fallback: the first textbox is the title input (appears first in DOM)
    textboxes[0]
  );
}

const EXISTING_POST = {
  id: 42,
  title: 'My Existing Post',
  slug: 'my-existing-post',
  content: '<p>Hello world</p>',
  excerpt: 'A great post',
  status: 'published',
  category_id: null,
  featured_image: '',
  meta_title: '',
  meta_description: '',
  noindex: false,
};

const EXISTING_POST_WITH_IMAGE = {
  ...EXISTING_POST,
  featured_image: 'https://api.example.test/storage/tenant_2/uploads/blog/current.webp',
};

describe('BlogPostForm — create mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title input in create mode', async () => {
    renderCreate();
    await waitFor(() => {
      const input = getTitleInput();
      expect(input).toBeInTheDocument();
    });
  });

  it('auto-generates slug from title in create mode', async () => {
    renderCreate();
    await waitFor(() => getTitleInput());

    const titleInput = getTitleInput();
    fireEvent.change(titleInput, { target: { value: 'Hello World Post' } });

    await waitFor(() => {
      const slugInput = screen.getByRole('textbox', { name: /label_slug|Slug/i });
      expect((slugInput as HTMLInputElement).value).toBe('hello-world-post');
    });
  });

  it('shows inline validation error and does not call create when title is empty', async () => {
    renderCreate();
    await waitFor(() => getTitleInput());

    // Submit with empty title — validates inline (sets errors.title, no toast)
    const form = document.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      // validate() sets errors.title → the Input renders errorMessage
      // t('blog.title_required') resolves to an English string; check it's in DOM
      expect(screen.getByText(/title_required|required|Title is required/i)).toBeInTheDocument();
      expect(mockAdminBlog.create).not.toHaveBeenCalled();
    });
  });

  it('calls adminBlog.create with correct payload and navigates on success', async () => {
    mockAdminBlog.create.mockResolvedValueOnce({ success: true });
    renderCreate();
    await waitFor(() => getTitleInput());

    fireEvent.change(getTitleInput(), { target: { value: 'New Post Title' } });

    const form = document.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockAdminBlog.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New Post Title' }),
      );
      expect(mockToast.success).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalled();
    });
  });

  it('uploads a featured image and shows a preview', async () => {
    mockAdminBlog.create.mockResolvedValueOnce({ success: true });
    mockAdminBlog.uploadFeaturedImage.mockResolvedValueOnce({
      success: true,
      data: { url: 'https://api.example.test/storage/tenant_2/uploads/blog/hero.webp', path: 'tenant_2/uploads/blog/hero.webp' },
    });
    renderCreate();
    await waitFor(() => getTitleInput());

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hero'], 'hero.webp', { type: 'image/webp' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockAdminBlog.uploadFeaturedImage).toHaveBeenCalledWith(file, expect.any(Function));
      // The origin is environment configuration, not component behaviour:
      // resolveThumbnailUrl() prefixes VITE_API_BASE, which this machine's .env
      // sets to http://127.0.0.1:8090 and CI does not set at all. Asserting the
      // full URL passed locally and failed every CI shard. Assert the path the
      // upload response actually produced.
      expect(screen.getByRole('img', { name: /featured_image_preview_alt|featured image preview/i })).toHaveAttribute(
        'src',
        expect.stringContaining('/storage/tenant_2/uploads/blog/hero.webp'),
      );
      expect(mockToast.success).toHaveBeenCalled();
    });

    fireEvent.change(getTitleInput(), { target: { value: 'Uploaded Hero Post' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(mockAdminBlog.create).toHaveBeenCalledWith(
        expect.objectContaining({ featured_image: '/storage/tenant_2/uploads/blog/hero.webp' }),
      );
    });
  });

  it('accepts image uploads by extension when the browser omits the MIME type', async () => {
    mockAdminBlog.uploadFeaturedImage.mockResolvedValueOnce({
      success: true,
      data: { url: 'https://api.example.test/storage/tenant_2/uploads/blog/hero.jpg', path: 'tenant_2/uploads/blog/hero.jpg' },
    });
    renderCreate();
    await waitFor(() => getTitleInput());

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hero'], 'hero.jpg', { type: '' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockAdminBlog.uploadFeaturedImage).toHaveBeenCalledWith(file, expect.any(Function));
      // The origin is environment configuration, not component behaviour:
      // resolveThumbnailUrl() prefixes VITE_API_BASE, which this machine's .env
      // sets to http://127.0.0.1:8090 and CI does not set at all. Asserting the
      // full URL passed locally and failed every CI shard. Assert the path the
      // upload response actually produced.
      expect(screen.getByRole('img', { name: /featured_image_preview_alt|featured image preview/i })).toHaveAttribute(
        'src',
        expect.stringContaining('/storage/tenant_2/uploads/blog/hero.jpg'),
      );
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('rejects non-image featured image uploads before calling the API', async () => {
    renderCreate();
    await waitFor(() => getTitleInput());

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(mockAdminBlog.uploadFeaturedImage).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalled();
  });

  it('shows error toast when create API returns failure', async () => {
    mockAdminBlog.create.mockResolvedValueOnce({ success: false, error: 'Server error' });
    renderCreate();
    await waitFor(() => getTitleInput());

    fireEvent.change(getTitleInput(), { target: { value: 'New Post Title' } });

    const form = document.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});

describe('BlogPostForm — edit mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while post is fetching', () => {
    mockUseParams.mockReturnValue({ id: '42' });
    mockAdminCategories.list.mockResolvedValue({ success: true, data: [] });
    mockAdminBlog.get.mockReturnValue(new Promise(() => {}));
    render(<BlogPostForm />);
    const statuses = screen.getAllByRole('status');
    const spinner = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeDefined();
  });

  // The old assertion allowed either the server reason OR the literal string
  // 'failed_to_load_blog_posts'. That second half was the raw i18n KEY, which no
  // test can ever see — the setup loads the real English resources, so the
  // fallback renders as "Failed to load blog posts". The two cases are now pinned
  // separately, which is what makes the first one meaningful.
  it('shows the server reason when the post load is refused', async () => {
    mockAdminBlog.get.mockResolvedValueOnce({ success: false, error: 'Not found' });
    renderEdit();
    await waitFor(() => {
      expect(screen.getByText('Not found')).toBeInTheDocument();
    });
  });

  it('falls back to the generic load error when the server gives no reason', async () => {
    mockAdminBlog.get.mockResolvedValueOnce({ success: false });
    renderEdit();
    await waitFor(() => {
      expect(screen.getByText(/failed to load blog posts/i)).toBeInTheDocument();
    });
  });

  it('populates form fields with existing post data', async () => {
    mockAdminBlog.get.mockResolvedValueOnce({ success: true, data: EXISTING_POST });
    renderEdit();
    await waitFor(() => {
      const titleInput = getTitleInput();
      expect((titleInput as HTMLInputElement).value).toBe('My Existing Post');
    });
  });

  it('calls adminBlog.update (not create) in edit mode', async () => {
    mockAdminBlog.get.mockResolvedValueOnce({ success: true, data: EXISTING_POST });
    mockAdminBlog.update.mockResolvedValueOnce({ success: true });
    renderEdit();

    await waitFor(() => getTitleInput());

    const form = document.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockAdminBlog.update).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ title: 'My Existing Post' }),
      );
      expect(mockAdminBlog.create).not.toHaveBeenCalled();
    });
  });

  it('sends null when an existing featured image is removed in edit mode', async () => {
    mockAdminBlog.get.mockResolvedValueOnce({ success: true, data: EXISTING_POST_WITH_IMAGE });
    mockAdminBlog.update.mockResolvedValueOnce({ success: true });
    renderEdit();

    await waitFor(() => {
      expect(screen.getByRole('img', { name: /featured_image_preview_alt|featured image preview/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /featured_image_remove|remove featured image/i }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(mockAdminBlog.update).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ featured_image: null }),
      );
    });
  });

  it('renders categories from API in the Select', async () => {
    mockAdminBlog.get.mockResolvedValueOnce({ success: true, data: EXISTING_POST });
    mockAdminCategories.list.mockResolvedValueOnce({
      success: true,
      data: [{ id: 5, name: 'Technology', type: 'blog' }],
    });
    mockUseParams.mockReturnValue({ id: '42' });
    render(<BlogPostForm />);
    await waitFor(() => {
      expect(screen.getByText('Technology')).toBeInTheDocument();
    });
  });
});
