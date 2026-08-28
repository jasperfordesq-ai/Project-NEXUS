// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Blog Post Form (Create / Edit)
 * Shared form for creating and editing blog posts.
 * Detects edit mode via URL param `:id`.
 * Parity: PHP Admin\BlogController::create() / edit()
 */

import { useState, useEffect, useCallback, lazy, Suspense, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { CardBody, Card, Select, SelectItem, Button, Spinner, Input, Textarea, Switch, Progress } from '@/components/ui';
import { Separator } from '@/components/ui';
const RichTextEditor = lazy(() =>
  import('../../components/RichTextEditor').then((m) => ({ default: m.RichTextEditor })),
);
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ImagePlus from 'lucide-react/icons/image-plus';
import Save from 'lucide-react/icons/save';
import Search from 'lucide-react/icons/search';
import UploadCloud from 'lucide-react/icons/upload-cloud';
import X from 'lucide-react/icons/x';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminBlog, adminCategories } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { AdminBlogPost, AdminCategory } from '../../api/types';
import { useTranslation } from 'react-i18next';
import { resolveUploadedUrl } from '../../components/builderImage';
import { resolveAssetUrl, responsiveThumbnailProps } from '@/lib/helpers';
import { logError } from '@/lib/logger';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ACCEPTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const ACCEPTED_IMAGE_INPUT = [
  ...ACCEPTED_IMAGE_TYPES,
  ...ACCEPTED_IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
].join(',');
const MAX_FEATURED_IMAGE_BYTES = 10 * 1024 * 1024;

type FeaturedImageUploadResult = Awaited<ReturnType<typeof adminBlog.uploadFeaturedImage>>;

function isAcceptedImageFile(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type) {
    return ACCEPTED_IMAGE_TYPES.includes(type);
  }

  const extension = file.name.split('.').pop()?.toLowerCase();
  return !!extension && ACCEPTED_IMAGE_EXTENSIONS.includes(extension);
}

function resolveBlogFeaturedImageValue(res: FeaturedImageUploadResult): string | null {
  if (res.success && res.data?.path) {
    return `/storage/${res.data.path.replace(/^\/+/, '')}`;
  }

  const uploadedUrl = resolveUploadedUrl(res);
  if (!uploadedUrl) {
    return null;
  }

  try {
    const parsed = new URL(uploadedUrl);
    if (parsed.pathname.startsWith('/storage/')) {
      return parsed.pathname;
    }
  } catch {
    return uploadedUrl;
  }

  return uploadedUrl;
}

export function BlogPostForm() {
  const { t } = useTranslation('admin_blog');
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Loading states
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [imagePreviewError, setImagePreviewError] = useState(false);

  // Original post data (for edit mode page title)
  const [post, setPost] = useState<AdminBlogPost | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [content, setContent] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [status, setStatus] = useState('draft');
  const [categoryId, setCategoryId] = useState('');
  const [featuredImage, setFeaturedImage] = useState('');

  // SEO fields
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [noindex, setNoindex] = useState(false);

  // Categories for the dropdown
  const [categories, setCategories] = useState<AdminCategory[]>([]);

  // Validation
  const [errors, setErrors] = useState<Record<string, string>>({});
  const featuredImagePreview = featuredImage.trim() && !imagePreviewError
    ? resolveAssetUrl(featuredImage.trim())
    : '';
  const featuredImagePreviewProps = featuredImagePreview
    ? responsiveThumbnailProps(featuredImage.trim(), {
        width: 960,
        height: 520,
        sizes: '(min-width: 1024px) 640px, 92vw',
      })
    : null;

  // Dynamic page title
  usePageTitle(isEdit && post
    ? t('blog.page_title_edit_with_title', { title: post.title })
    : t('blog.page_title_create'));

  // Load categories
  useEffect(() => {
    async function loadCategories() {
      try {
        const res = await adminCategories.list({ type: 'blog' });
        if (res.success && res.data) {
          const data = res.data;
          if (Array.isArray(data)) {
            setCategories(data);
          }
        }
      } catch {
        // Categories are optional, don't block the form
      }
    }
    loadCategories();
  }, []);

  // Load post for edit mode
  const loadPost = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setLoadError(null);

    try {
      const res = await adminBlog.get(Number(id));

      if (res.success && res.data) {
        const postData = res.data as AdminBlogPost;
        setPost(postData);

        // Populate form fields
        setTitle(postData.title || '');
        setSlug(postData.slug || '');
        setContent(postData.content || '');
        setExcerpt(postData.excerpt || '');
        setStatus(postData.status || 'draft');
        setCategoryId(postData.category_id ? String(postData.category_id) : '');
        setFeaturedImage(postData.featured_image || '');
        setMetaTitle(postData.meta_title || '');
        setMetaDescription(postData.meta_description || '');
        setNoindex(postData.noindex || false);
      } else {
        // Surface the server's own reason (already translated) rather than a
        // generic message, so an admin is told WHY the post would not load —
        // "Not found", "Forbidden", a validation reason — instead of a blanket
        // failure they cannot act on. Matches the many other admin call sites
        // that use `res.error || t(fallback)`.
        setLoadError(res.error || t('blog.failed_to_load_blog_posts'));
      }
    } catch {
      setLoadError(t('blog.an_unexpected_error_occurred'));
    } finally {
      setLoading(false);
    }
  }, [id, t])


  useEffect(() => {
    if (isEdit) {
      loadPost();
    }
  }, [isEdit, loadPost]);

  // Auto-generate slug from title (only in create mode)
  useEffect(() => {
    if (!isEdit && title) {
      const generated = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '');
      setSlug(generated);
    }
  }, [title, isEdit]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!title.trim()) {
      newErrors.title = t('blog.title_required');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!validate()) return;

    setSubmitting(true);

    try {
      const payload = {
        title: title.trim(),
        slug: slug.trim() || undefined,
        content,
        excerpt: excerpt.trim(),
        status: status as 'draft' | 'published',
        featured_image: featuredImage.trim() || null,
        category_id: categoryId ? Number(categoryId) : undefined,
        meta_title: metaTitle.trim() || undefined,
        meta_description: metaDescription.trim() || undefined,
        noindex: noindex || undefined,
      };

      const res = isEdit
        ? await adminBlog.update(Number(id), payload)
        : await adminBlog.create(payload);

      if (res.success) {
        toast.success(isEdit ? t('blog.post_updated') : t('blog.post_created'));
        navigate(tenantPath('/admin/blog'));
      } else {
        toast.error(t('blog.an_unexpected_error_occurred'));
      }
    } catch {
      toast.error(t('blog.an_unexpected_error_occurred'));
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadFeaturedImageFile(file: File) {
    if (!file) return;

    if (!isAcceptedImageFile(file)) {
      toast.error(t('blog.featured_image_type_error'));
      return;
    }

    if (file.size > MAX_FEATURED_IMAGE_BYTES) {
      toast.error(t('blog.featured_image_size_error'));
      return;
    }

    setUploadingImage(true);
    setUploadProgress(0);
    try {
      const url = resolveBlogFeaturedImageValue(await adminBlog.uploadFeaturedImage(file, setUploadProgress));
      if (!url) {
        toast.error(t('blog.featured_image_upload_failed'));
        return;
      }
      setFeaturedImage(url);
      setImagePreviewError(false);
      toast.success(t('blog.featured_image_uploaded'));
    } catch (error) {
      logError('BlogPostForm: featured image upload failed', error);
      toast.error(t('blog.featured_image_upload_failed'));
    } finally {
      setUploadingImage(false);
      setUploadProgress(null);
      setIsDraggingImage(false);
    }
  }

  function handleFeaturedImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      void uploadFeaturedImageFile(file);
    }
  }

  function handleFeaturedImageDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDraggingImage(false);
    if (submitting || uploadingImage) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void uploadFeaturedImageFile(file);
    }
  }

  // Loading state (edit mode)
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" label={t('blog.loading_post')} /></div>
      </div>
    );
  }

  // Error state (edit mode)
  if (isEdit && (loadError || !post)) {
    return (
      <div>
        <PageHeader
          title={t('blog.page_title_edit')}
          actions={
            <Button
              variant="tertiary"
              startContent={<ArrowLeft size={16} />}
              onPress={() => navigate(tenantPath('/admin/blog'))}
            >
              {t('blog.back')}
            </Button>
          }
        />
        <Card className="max-w-2xl">
          <CardBody className="p-6">
            <p className="text-center text-danger">
              {loadError || t('blog.failed_to_load_blog_posts')}
            </p>
            <div className="mt-4 flex justify-center">
              <Button variant="tertiary" onPress={() => navigate(tenantPath('/admin/blog'))}>
                {t('blog.back')}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={isEdit && post?.title ? t('blog.page_title_edit_with_title', { title: post.title }) : t('blog.page_title_create')}
        actions={
          <Button
            variant="tertiary"
            startContent={<ArrowLeft size={16} />}
            onPress={() => navigate(tenantPath('/admin/blog'))}
          >
            {t('blog.back')}
          </Button>
        }
      />

      <form onSubmit={handleSubmit}>
        <Card className="max-w-3xl">
          <CardBody className="gap-5 p-6">
            {/* Title */}
            <Input
              label={t('blog.label_title')}
              placeholder={t('blog.placeholder_title')}
              value={title}
              onValueChange={setTitle}
              isRequired
              isInvalid={!!errors.title}
              errorMessage={errors.title}
              isDisabled={submitting}
            />

            {/* Slug */}
            <Input
              label={t('blog.label_slug')}
              placeholder={t('blog.placeholder_slug')}
              value={slug}
              onValueChange={setSlug}
              isDisabled={submitting}
              description={isEdit ? t('blog.slug_desc_edit') : t('blog.slug_desc_create')}
            />

            {/* Content */}
            <Suspense fallback={<div role="status" aria-busy="true" aria-label={t('common.loading')}><Spinner size="sm" className="m-4" /></div>}>
              <RichTextEditor
                label={t('blog.label_content')}
                placeholder={t('blog.placeholder_content')}
                value={content}
                onChange={setContent}
                isDisabled={submitting}
              />
            </Suspense>

            {/* Excerpt */}
            <Textarea
              label={t('blog.excerpt')}
              placeholder={t('blog.placeholder_excerpt')}
              value={excerpt}
              onValueChange={setExcerpt}
              minRows={2}
              maxRows={4}
              isDisabled={submitting}
            />

            {/* Status and Category row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Status */}
              <Select
                label={t('blog.label_status')}
                placeholder={t('blog.placeholder_status')}
                selectedKeys={status ? [status] : []}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0] as string;
                  if (selected) setStatus(selected);
                }}
                isDisabled={submitting}
              >
                <SelectItem key="draft" id="draft">{t('content.draft')}</SelectItem>
                <SelectItem key="published" id="published">{t('content.published')}</SelectItem>
              </Select>

              {/* Category */}
              <Select
                label={t('blog.label_categories')}
                placeholder={t('blog.placeholder_category')}
                selectedKeys={categoryId ? [categoryId] : []}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0] as string;
                  setCategoryId(selected || '');
                }}
                isDisabled={submitting}
              >
                {categories.map((cat) => (
                  <SelectItem key={String(cat.id)} id={String(cat.id)}>
                    {cat.name}
                  </SelectItem>
                ))}
              </Select>
            </div>

            {/* Featured Image */}
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Input
                  label={t('blog.featured_image')}
                  placeholder={t('blog.placeholder_featured_image')}
                  value={featuredImage}
                  onValueChange={(value) => {
                    setFeaturedImage(value);
                    setImagePreviewError(false);
                  }}
                  isDisabled={submitting || uploadingImage}
                  description={t('blog.featured_image_desc')}
                  className="flex-1"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    startContent={!uploadingImage ? <ImagePlus size={16} /> : undefined}
                    isLoading={uploadingImage}
                    isDisabled={submitting || uploadingImage}
                    onPress={() => fileInputRef.current?.click()}
                  >
                    {t('blog.featured_image_upload')}
                  </Button>
                  {featuredImage && (
                    <Button
                      type="button"
                      variant="tertiary"
                      isIconOnly
                      aria-label={t('blog.featured_image_remove')}
                      isDisabled={submitting || uploadingImage}
                      onPress={() => {
                        setFeaturedImage('');
                        setImagePreviewError(false);
                      }}
                    >
                      <X size={16} />
                    </Button>
                  )}
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_INPUT}
                className="hidden"
                onChange={handleFeaturedImageUpload}
                aria-hidden="true"
                tabIndex={-1}
              />
              <div
                className={`overflow-hidden rounded-lg border bg-default-50 transition-colors ${
                  isDraggingImage
                    ? 'border-accent bg-accent/10'
                    : 'border-default-200'
                }`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  if (!submitting && !uploadingImage) setIsDraggingImage(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!submitting && !uploadingImage) setIsDraggingImage(true);
                }}
                onDragLeave={(e) => {
                  const nextTarget = e.relatedTarget;
                  if (!(nextTarget instanceof Node) || !e.currentTarget.contains(nextTarget)) {
                    setIsDraggingImage(false);
                  }
                }}
                onDrop={handleFeaturedImageDrop}
              >
                {featuredImagePreviewProps ? (
                  <div className="relative">
                    <img
                      {...featuredImagePreviewProps}
                      alt={t('blog.featured_image_preview_alt')}
                      className="h-52 w-full object-cover"
                      loading="lazy"
                      decoding="async"
                      onError={() => setImagePreviewError(true)}
                    />
                    {uploadingImage && (
                      <div className="absolute inset-x-0 bottom-0 bg-background/90 p-3 backdrop-blur">
                        <Progress
                          aria-label={t('blog.featured_image_uploading')}
                          value={uploadProgress ?? 0}
                          size="sm"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-52 flex-col items-center justify-center gap-3 px-4 text-center">
                    {uploadingImage ? (
                      <>
                        <Spinner size="sm" />
                        <div className="w-full max-w-xs">
                          <Progress
                            aria-label={t('blog.featured_image_uploading')}
                            value={uploadProgress ?? 0}
                            size="sm"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <UploadCloud size={28} className="text-muted" aria-hidden="true" />
                        <div>
                          <p className="text-sm font-medium">
                            {featuredImage.trim()
                              ? t('blog.featured_image_preview_unavailable')
                              : t('blog.featured_image_preview_empty')}
                          </p>
                          <p className="mt-1 text-xs text-muted">
                            {t('blog.featured_image_format_hint')}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* SEO Override (Optional) */}
            <Separator />
            <div className="flex items-center gap-2 text-muted">
              <Search size={16} />
              <span className="text-sm font-semibold">{t('blog.seo_override')}</span>
            </div>
            <Input
              label={t('blog.meta_title')}
              placeholder={t('blog.placeholder_meta_title')}
              value={metaTitle}
              onValueChange={setMetaTitle}
              isDisabled={submitting}
              description={t('blog.meta_title_desc')}
            />
            <Textarea
              label={t('blog.meta_description')}
              placeholder={t('blog.placeholder_meta_desc')}
              value={metaDescription}
              onValueChange={setMetaDescription}
              minRows={2}
              maxRows={3}
              isDisabled={submitting}
              description={t('blog.meta_desc_desc')}
            />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t('blog.noindex')}</p>
                <p className="text-xs text-muted">{t('blog.noindex_desc')}</p>
              </div>
              <Switch
                isSelected={noindex}
                onValueChange={setNoindex}
                isDisabled={submitting}
                size="sm"
              />
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="tertiary"
                onPress={() => navigate(tenantPath('/admin/blog'))}
                isDisabled={submitting}
              >
                {t('blog.cancel')}
              </Button>
              <Button
                type="submit"
                startContent={!submitting ? <Save size={16} /> : undefined}
                isLoading={submitting}
                isDisabled={submitting}
              >
                {isEdit ? t('blog.save_changes') : t('blog.page_title_create')}
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}

export default BlogPostForm;
