// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Input, Button, Spinner, Select, SelectItem, Switch } from '@/components/ui';
import { useState, useEffect, useRef } from 'react';

import FileText from 'lucide-react/icons/file-text';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import Menu from 'lucide-react/icons/menu';
import ExternalLink from 'lucide-react/icons/external-link';
import Eye from 'lucide-react/icons/eye';
import { useNavigate, useParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast, useAuth } from '@/contexts';
import { adminPages } from '../../api/adminApi';
import type { ApiResponse } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
import { BuilderPreviewModal } from '../../components/BuilderPreviewModal';
import { useUnsavedChangesGuard } from '../../components/useUnsavedChangesGuard';
import { PageContentEditor } from '../../components/PageContentEditor';
import type { PageContentEditorHandle } from '../../components/PageContentEditor';
import type { ContentFormat } from '../../components/contentFormat';
import { sanitizeCustomPageHtml } from '@/lib/sanitize';
/**
 * Page Builder
 * Create or edit a CMS page with real API integration.
 * Wired to adminPages.get/create/update.
 */


interface PageFormData {
  title: string;
  slug: string;
  content: string;
  content_format: ContentFormat;
  design_json: string | null;
  meta_description: string;
  status: string;
  show_in_menu: boolean;
  menu_location: string;
  menu_order: number;
}

// Accented letters are transliterated (Über -> uber) so every Latin-script
// language yields a readable address; scripts with no Latin form (e.g. Japanese)
// yield '' and the server generates a page-xxxxxx address on save.
const slugBase = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');

const toSlug = (text: string): string => slugBase(text).replace(/^-+|-+$/g, '');

// Used while typing: keeps a trailing hyphen so "my-" can become "my-page".
const toSlugInput = (text: string): string => slugBase(text).replace(/^-+/, '');

/**
 * Turn a failed save into the server's own explanation (and the field it is
 * about), falling back to the generic message when the server gave none.
 */
export function describeSaveFailure(
  res: ApiResponse<unknown> | undefined,
  fallback: string,
): { message: string; field?: string } {
  const first = res?.errors?.find((e) => e?.message);
  if (first?.message) return { message: first.message, field: first.field };
  // admin-i18n-ignore: localized server message — AdminContentController renders every
  // page-save refusal with __('api.…') in the caller's locale, so it is already translated
  if (res?.error) return { message: res.error };
  return { message: fallback };
}

/** Same, for an error the API client threw (it carries message and fieldErrors). */
function describeThrownSaveFailure(err: unknown, fallback: string): { message: string; field?: string } {
  const e = err as { message?: unknown; fieldErrors?: Record<string, string[]> } | null;
  const entry = e?.fieldErrors ? Object.entries(e.fieldErrors).find(([, msgs]) => msgs?.length) : undefined;
  if (entry) return { message: entry[1][0]!, field: entry[0] };
  if (e && typeof e.message === 'string' && e.message) return { message: e.message };
  return { message: fallback };
}

/** Escape plain text and wrap each paragraph in <p>, as the public page does. */
function plainTextToHtml(text: string): string {
  const escape = (v: string) => v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escape(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const EMPTY_FORM: PageFormData = {
  title: '',
  slug: '',
  content: '',
  content_format: 'richtext',
  design_json: null,
  meta_description: '',
  status: 'draft',
  show_in_menu: false,
  menu_location: 'about',
  menu_order: 0,
};

export function PageBuilder() {
  const { t } = useTranslation('admin_content');
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined && id !== 'new';
  const screenTitle = t(isEdit ? 'content.edit_page' : 'content.new_page');
  usePageTitle(screenTitle);
  const navigate = useNavigate();
  const { tenantPath, tenant, refreshTenant } = useTenant();
  const { user } = useAuth();
  const toast = useToast();
  const contentEditorRef = useRef<PageContentEditorHandle | null>(null);
  const loadedSlugRef = useRef('');
  // The page's SAVED state, not the form: "Open live page" must not appear
  // just because Published was picked in the dropdown and not yet saved.
  const [loadedStatus, setLoadedStatus] = useState('');

  const [formData, setFormData] = useState<PageFormData>(EMPTY_FORM);
  // The form as loaded (edit) or as it starts (create): leaving with anything
  // different from this asks first.
  const [baseline, setBaseline] = useState<PageFormData | null>(isEdit ? null : EMPTY_FORM);
  // Rich text and Design re-write the saved HTML once when they open it. That
  // first report is the editor reading the page back, not an admin edit.
  const editorEchoPendingRef = useRef(true);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  useEffect(() => {
    if (isEdit) {
      adminPages.get(Number(id))
        .then((res) => {
          if (res.success && res.data) {
            const page = res.data as Record<string, unknown>;
            loadedSlugRef.current = (page.slug as string) || '';
            setLoadedStatus((page.status as string) || 'draft');
            const loaded: PageFormData = {
              title: (page.title as string) || '',
              slug: (page.slug as string) || '',
              content: (page.content as string) || '',
              content_format: ((page.content_format as ContentFormat) || 'richtext'),
              design_json: (page.design_json as string) || null,
              meta_description: (page.meta_description as string) || '',
              status: (page.status as string) || 'draft',
              show_in_menu: !!(page.show_in_menu),
              menu_location: (page.menu_location as string) || 'about',
              menu_order: Number(page.menu_order) || 0,
            };
            editorEchoPendingRef.current = true;
            setFormData(loaded);
            setBaseline(loaded);
          }
        })
        .catch(() => toast.error(t('content.failed_to_load_pages')))
        .finally(() => setLoading(false));
    }
  }, [id, isEdit, t, toast])


  const handleChange = (field: keyof PageFormData, value: string | boolean | number | null) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const isDirty = baseline !== null && JSON.stringify(formData) !== JSON.stringify(baseline);
  const { confirmLeave } = useUnsavedChangesGuard(isDirty && !saving);

  const leaveToList = async () => {
    if (await confirmLeave()) navigate(tenantPath('/admin/pages'));
  };

  const handleEditorChange = (next: { content: string; content_format: ContentFormat; design_json?: string | null }) => {
    const echoes = baseline !== null
      && next.content_format === baseline.content_format
      && (baseline.content_format === 'builder' || (baseline.content_format === 'richtext' && baseline.content !== ''));
    if (editorEchoPendingRef.current && echoes) {
      setBaseline((prev) => prev && {
        ...prev,
        content: next.content,
        design_json: 'design_json' in next ? next.design_json ?? null : prev.design_json,
      });
    }
    editorEchoPendingRef.current = false;
    handleChange('content', next.content);
    handleChange('content_format', next.content_format);
    if ('design_json' in next) {
      handleChange('design_json', next.design_json ?? null);
    }
  };

  // Show what would be saved (the latest editor content, flushed the way saving does) without saving.
  const handlePreview = () => {
    const flushed = contentEditorRef.current?.flush();
    const content = flushed ? flushed.content : formData.content;
    const format = flushed ? flushed.content_format : formData.content_format;
    setPreviewHtml(
      format === 'plaintext'
        ? plainTextToHtml(content)
        : sanitizeCustomPageHtml(content),
    );
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      toast.warning(t('content.page_title_required'));
      return;
    }
    // An empty slug is allowed: the server then generates one (page-xxxxxx).
    if (formData.slug !== toSlug(formData.slug)) {
      toast.warning(t('content.slug_must_be_url_safe'));
      return;
    }
    setSaving(true);
    setSlugError(null);
    const showFailure = (failure: { message: string; field?: string }) => {
      if (failure.field === 'slug') setSlugError(failure.message);
      toast.error(failure.message);
    };
    try {
      const flushed = contentEditorRef.current?.flush();
      const dataToSave = flushed
        ? { ...formData, content: flushed.content, content_format: flushed.content_format, design_json: flushed.design_json ?? null }
        : formData;
      const payload = {
        ...dataToSave,
        // Editing: a cleared address keeps the page's current one rather than changing it.
        slug: isEdit && !dataToSave.slug.trim() ? loadedSlugRef.current : dataToSave.slug,
        design_json: dataToSave.content_format === 'builder' ? dataToSave.design_json : null,
        show_in_menu: dataToSave.show_in_menu ? 1 : 0,
      };
      const fallback = t('content.an_unexpected_error_occurred');
      const res = isEdit
        ? await adminPages.update(Number(id), payload as Record<string, unknown>)
        : await adminPages.create(payload);
      if (res?.success) {
        setLoadedStatus(dataToSave.status);
        if (typeof payload.slug === 'string' && payload.slug !== '') loadedSlugRef.current = payload.slug;
        const savedSlug = (res.data as { slug?: unknown } | undefined)?.slug;
        const typedSlug = formData.slug.trim();
        if (typeof savedSlug === 'string' && savedSlug !== '' && typedSlug !== '' && savedSlug !== formData.slug) {
          toast.success(t('content.saved_with_slug', { slug: savedSlug }));
        } else if (!isEdit && typeof savedSlug === 'string' && savedSlug !== '' && typedSlug === '') {
          toast.success(t('content.saved_with_generated_slug', { slug: savedSlug }));
        } else {
          toast.success(t(isEdit ? 'content.page_updated' : 'content.page_created'));
        }
        void refreshTenant({ silent: true });
        navigate(tenantPath('/admin/pages'));
      } else {
        showFailure(describeSaveFailure(res, fallback));
      }
    } catch (err) {
      showFailure(describeThrownSaveFailure(err, t('content.an_unexpected_error_occurred')));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader
          title={screenTitle}
          description={t('content.loading_pages')}
        />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-12"><Spinner size="lg" /></div>
      </div>
    );
  }

  return (
    <div>
      <BuilderPreviewModal
        isOpen={previewHtml !== null}
        onClose={() => setPreviewHtml(null)}
        html={previewHtml ?? ''}
        t={t}
        labels={{
          title: t('content.preview_title'),
          deviceLabel: t('content.preview_device_label'),
          desktop: t('content.preview_desktop'),
          mobile: t('content.preview_mobile'),
        }}
      />
      <PageHeader
        title={screenTitle}
        description={t('content.pages_admin_desc')}
        actions={
          <div className="flex gap-2">
            <Button
              variant="tertiary"
              startContent={<ArrowLeft size={16} />}
              isDisabled={saving}
              onPress={() => void leaveToList()}
            >
              {t('content.back')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<Eye size={16} />}
              isDisabled={saving}
              onPress={handlePreview}
            >
              {t('content.preview_draft')}
            </Button>
            {isEdit && loadedSlugRef.current && loadedStatus === 'published' && (
              <Button
                variant="tertiary"
                startContent={<ExternalLink size={16} />}
                isDisabled={saving}
                onPress={() => {
                  // Use tenant.slug (from TenantContext) or user.tenant_slug (from auth JWT)
                  // so the URL always includes the tenant prefix, even when the admin
                  // panel is accessed directly via /admin without a tenant slug in the URL.
                  const slug = tenant?.slug || user?.tenant_slug;
                  const liveUrl = slug
                    ? `/${slug}/page/${loadedSlugRef.current}`
                    : `/page/${loadedSlugRef.current}`;
                  window.open(liveUrl, '_blank');
                }}
              >
                {t('content.open_live_page')}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <Card >
          <CardHeader><h3 className="text-lg font-semibold flex items-center gap-2"><FileText size={20} /> {t('content.label_content')}</h3></CardHeader>
          <CardBody className="gap-4">
            <Input
              label={t('content.label_name')}
              placeholder={t('content.placeholder_page_name')}
              isRequired
              variant="secondary"
              value={formData.title}
              isDisabled={saving}
              onValueChange={(v) => {
                handleChange('title', v);
                if (!slugTouched) handleChange('slug', toSlug(v));
              }}
            />
            <Input
              label={t('content.label_url_slug')}
              placeholder={formData.title.trim() && !toSlug(formData.title) ? t('content.slug_set_on_save') : t('content.placeholder_slug')}
              variant="secondary"
              description={t('content.page_slug_description')}
              isInvalid={slugError !== null}
              errorMessage={slugError ?? undefined}
              value={formData.slug}
              isDisabled={saving}
              onValueChange={(v) => {
                setSlugTouched(true);
                setSlugError(null);
                handleChange('slug', toSlugInput(v));
              }}
            />
            <PageContentEditor
              ref={contentEditorRef}
              value={formData.content}
              format={formData.content_format}
              designJson={formData.design_json}
              isDisabled={saving}
              onChange={handleEditorChange}
            />
            <Input
              label={t('content.label_meta_description')}
              placeholder={t('content.placeholder_meta_description')}
              description={t('content.meta_description_menu_hint')}
              variant="secondary"
              value={formData.meta_description}
              isDisabled={saving}
              onValueChange={(v) => handleChange('meta_description', v)}
            />
            <Select
              label={t('content.label_status')}
              variant="secondary"
              selectedKeys={[formData.status]}
              isDisabled={saving}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string;
                if (selected) handleChange('status', selected);
              }}
            >
              <SelectItem key="draft" id="draft">{t('content.draft')}</SelectItem>
              <SelectItem key="published" id="published">{t('content.published')}</SelectItem>
            </Select>
          </CardBody>
        </Card>

        <Card >
          <CardHeader><h3 className="text-lg font-semibold flex items-center gap-2"><Menu size={20} /> {t('content.navigation_settings')}</h3></CardHeader>
          <CardBody className="gap-4">
            <Switch
              isSelected={formData.show_in_menu}
              isDisabled={saving}
              classNames={{ content: 'flex flex-row items-center gap-3' }}
              onValueChange={(v) => handleChange('show_in_menu', v)}
            >
              {t('content.show_in_menu')}
            </Switch>
            {formData.show_in_menu && (
              <>
                <Select
                  label={t('content.label_location')}
                  variant="secondary"
                  description={t('content.page_menu_location_desc')}
                  selectedKeys={[formData.menu_location]}
                  isDisabled={saving}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0] as string;
                    if (selected) handleChange('menu_location', selected);
                  }}
                >
                  <SelectItem key="about" id="about">{t('content.location_about')}</SelectItem>
                  <SelectItem key="header" id="header">{t('content.header_column')}</SelectItem>
                </Select>
                <Input
                  type="number"
                  label={t('content.menu_order')}
                  variant="secondary"
                  description={t('content.page_menu_order_desc')}
                  value={String(formData.menu_order)}
                  isDisabled={saving}
                  onValueChange={(v) => handleChange('menu_order', parseInt(v, 10) || 0)}
                />
              </>
            )}
          </CardBody>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="tertiary" isDisabled={saving} onPress={() => void leaveToList()}>{t('content.cancel')}</Button>
          <Button
            startContent={<Save size={16} />}
            onPress={handleSave}
            isLoading={saving}
          >
            {isEdit ? t('content.save_changes') : t('content.create_page')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default PageBuilder;
