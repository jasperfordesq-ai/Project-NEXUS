import { Card, CardBody, CardHeader, Input, Textarea, Button, Chip, Spinner, Select, SelectItem, Switch } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Separator } from '@/components/ui';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import Copy from 'lucide-react/icons/copy';
import Lightbulb from 'lucide-react/icons/lightbulb';
import BarChart3 from 'lucide-react/icons/chart-column';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminNewsletters } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * TemplateForm — Create / Edit newsletter template.
 * Detects edit mode via URL param `:id`.
 * Two-column layout: form (2/3) + sidebar (1/3).
 * Parity: PHP Admin newsletter template form.
 */


import { NewsletterContentEditor } from '../../components/NewsletterContentEditor';
import type { ContentFormat } from '../../components/contentFormat';

const MERGE_VARIABLES = [
  '{{first_name}}',
  '{{last_name}}',
  '{{email}}',
  '{{tenant_name}}',
  '{{unsubscribe_link}}',
  '{{view_in_browser}}',
];


interface TemplateData {
  id: number;
  name: string;
  description: string;
  category: string;
  is_active: number | boolean;
  subject: string;
  preview_text: string;
  content: string;
  usage_count?: number;
  created_at?: string;
  updated_at?: string;
}

export function TemplateForm() {
  const { t } = useTranslation('admin_newsletters');
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const { tenantPath } = useTenant();

  const CATEGORIES = [
    { key: 'custom', label: t('newsletters.category_custom') },
    { key: 'saved', label: t('newsletters.category_saved') },
    { key: 'starter', label: t('newsletters.category_starter') },
  ];
  const toast = useToast();
  const navigate = useNavigate();

  // Loading states
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Original template data (for edit mode)
  const [template, setTemplate] = useState<TemplateData | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('custom');
  const [isActive, setIsActive] = useState(true);
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [content, setContent] = useState('');
  const [contentFormat, setContentFormat] = useState<ContentFormat>('richtext');
  const [designJson, setDesignJson] = useState<string | null>(null);

  // Validation
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Dynamic page title
  usePageTitle(
    isEdit && template
      ? t('newsletters.edit_template_name_title', { name: template.name })
      : t('newsletters.create_template'),
  );

  // Load template for edit mode
  const loadTemplate = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setLoadError(null);

    try {
      const res = await adminNewsletters.getTemplate(Number(id));

      if (res.success && res.data) {
        const data = res.data as TemplateData;
        setTemplate(data);

        // Populate form fields
        setName(data.name || '');
        setDescription(data.description || '');
        setCategory(data.category || 'custom');
        setIsActive(!!data.is_active);
        setSubject(data.subject || '');
        setPreviewText(data.preview_text || '');
        setContent(data.content || '');
        setContentFormat(((data as { content_format?: ContentFormat }).content_format) || 'richtext');
        setDesignJson(((data as { design_json?: string }).design_json) || null);
      } else {
        setLoadError(t('newsletters.failed_to_load_template'));
      }
    } catch {
      setLoadError(t('newsletters.unexpected_error_loading'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);


  useEffect(() => {
    if (isEdit) {
      loadTemplate();
    }
  }, [isEdit, loadTemplate]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = t('newsletters.name_required');
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
        name: name.trim(),
        description: description.trim(),
        category,
        is_active: isActive,
        subject: subject.trim(),
        preview_text: previewText.trim(),
        content,
        content_format: contentFormat,
        design_json: contentFormat === 'builder' ? designJson : null,
      };

      const res = isEdit
        ? await adminNewsletters.updateTemplate(Number(id), payload)
        : await adminNewsletters.createTemplate(payload);

      if (res.success) {
        toast.success(
          isEdit ? t('newsletters.template_updated') : t('newsletters.template_created'),
        );
        navigate(tenantPath('/admin/newsletters/templates'));
      } else {
        toast.error(t('newsletters.failed_to_save_template'));
      }
    } catch {
      toast.error(t('newsletters.an_unexpected_error_occurred'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDuplicate() {
    if (!id) return;
    try {
      const res = await adminNewsletters.duplicateTemplate(Number(id));
      if (res.success) {
        toast.success(t('newsletters.template_duplicated'));
        navigate(tenantPath('/admin/newsletters/templates'));
      } else {
        toast.error(t('newsletters.failed_to_duplicate_template'));
      }
    } catch {
      toast.error(t('newsletters.an_unexpected_error_occurred'));
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(t('newsletters.copied_to_clipboard'));
    }).catch(() => {
      toast.error(t('newsletters.failed_to_copy_to_clipboard'));
    });
  }

  // Loading state (edit mode)
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" label={t('newsletters.loading_template')} /></div>
      </div>
    );
  }

  // Error state (edit mode)
  if (isEdit && (loadError || !template)) {
    return (
      <div>
        <PageHeader
          title={t('newsletters.edit_template')}
          actions={
            <Button
              variant="tertiary"
              startContent={<ArrowLeft size={16} />}
              onPress={() => navigate(tenantPath('/admin/newsletters/templates'))}
            >
              {t('newsletters.back_to_templates')}
            </Button>
          }
        />
        <Card className="max-w-2xl">
          <CardBody className="p-6">
            <p className="text-center text-danger">
              {loadError || t('newsletters.template_not_found')}
            </p>
            <div className="mt-4 flex justify-center">
              <Button
                variant="tertiary"
                onPress={() => navigate(tenantPath('/admin/newsletters/templates'))}
              >
                {t('newsletters.return_to_templates')}
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
        title={isEdit ? t('newsletters.edit_template_name_title', { name: template?.name ?? name }) : t('newsletters.create_template')}
        actions={
          <Button
            variant="tertiary"
            startContent={<ArrowLeft size={16} />}
            onPress={() => navigate(tenantPath('/admin/newsletters/templates'))}
          >
            {t('newsletters.back_to_templates')}
          </Button>
        }
      />

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* ── Left column: Form fields (2/3 width) ── */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            {/* Template Details */}
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">{t('newsletters.template_details')}</h3>
              </CardHeader>
              <CardBody className="gap-4">
                <Input
                  label={t('newsletters.col_name')}
                  placeholder={t('template_form.name_example')}
                  value={name}
                  onValueChange={setName}
                  isRequired
                  isInvalid={!!errors.name}
                  errorMessage={errors.name}
                  isDisabled={submitting}
                />
                <Textarea
                  label={t('newsletters.label_description')}
                  placeholder={t('newsletters.placeholder_description')}
                  value={description}
                  onValueChange={setDescription}
                  minRows={2}
                  maxRows={4}
                  isDisabled={submitting}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Select
                    label={t('newsletters.col_category')}
                    placeholder={t('newsletters.placeholder_category')}
                    selectedKeys={category ? [category] : []}
                    onSelectionChange={(keys) => {
                      const selected = Array.from(keys)[0] as string;
                      if (selected) setCategory(selected);
                    }}
                    isDisabled={submitting}
                  >
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat.key} id={cat.key}>{cat.label}</SelectItem>
                    ))}
                  </Select>
                  <div className="flex items-center gap-3 pt-2">
                    <Switch
                      isSelected={isActive}
                      onValueChange={setIsActive}
                      isDisabled={submitting}
                    />
                    <span className="text-sm">
                      {isActive ? t('newsletters.status_active') : t('newsletters.status_inactive')}
                    </span>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Email Settings */}
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">{t('newsletters.email_settings')}</h3>
              </CardHeader>
              <CardBody className="gap-4">
                <Input
                  label={t('newsletters.default_subject_line')}
                  placeholder={t('template_form.subject_example')}
                  value={subject}
                  onValueChange={setSubject}
                  isDisabled={submitting}
                />
                <Input
                  label={t('newsletters.preview_text')}
                  placeholder={t('newsletters.placeholder_preview_text')}
                  value={previewText}
                  onValueChange={setPreviewText}
                  isDisabled={submitting}
                  description={t('newsletters.desc_preview_text')}
                />
              </CardBody>
            </Card>

            {/* Content Editor */}
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">{t('newsletters.label_content')}</h3>
              </CardHeader>
              <CardBody className="gap-4">
                <NewsletterContentEditor
                  value={content}
                  format={contentFormat}
                  designJson={designJson}
                  onChange={({ content: c, content_format: f, design_json: dj }) => {
                    setContent(c);
                    setContentFormat(f);
                    if (dj !== undefined) setDesignJson(dj);
                  }}
                  placeholder={t('newsletters.placeholder_design_your_email_template_content')}
                  isDisabled={submitting}
                  subject={subject}
                  previewText={previewText}
                  onRequestPreview={async (req) => {
                    const res = await adminNewsletters.previewContent(req);
                    if (res.success && res.data) {
                      return (res.data as { html: string }).html;
                    }
                    throw new Error('preview failed');
                  }}
                />

                <Separator />

                {/* Merge variables */}
                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">
                    {t('newsletters.available_merge_variables')}
                  </p>
                  <p className="mb-3 text-xs text-muted">
                    {t('newsletters.merge_variables_desc')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {MERGE_VARIABLES.map((variable) => (
                      <Chip
                        key={variable}
                        variant="soft"
                        size="sm"
                        className="cursor-pointer"
                        onClick={() => copyToClipboard(variable)}
                      >
                        {variable}
                      </Chip>
                    ))}
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* ── Right column: Sidebar (1/3 width, sticky) ── */}
          <div className="flex flex-col gap-6 lg:sticky lg:top-4 lg:self-start">
            {/* Action buttons */}
            <Card>
              <CardBody className="gap-3">
                <Button
                  type="submit"
                  className="w-full"
                  startContent={<Save size={16} />}
                  isLoading={submitting}
                >
                  {isEdit ? t('newsletters.update_template') : t('newsletters.save_template')}
                </Button>

                {isEdit && (
                  <Button
                    variant="tertiary"
                    className="w-full"
                    startContent={<Copy size={16} />}
                    onPress={handleDuplicate}
                    isDisabled={submitting}
                  >
                    {t('newsletters.duplicate_template')}
                  </Button>
                )}

                <Button
                  variant="tertiary"
                  className="w-full"
                  onPress={() => navigate(tenantPath('/admin/newsletters/templates'))}
                  isDisabled={submitting}
                >
                  {t('newsletters.cancel')}
                </Button>
              </CardBody>
            </Card>

            {/* Tips card */}
            <Card className="bg-success/10">
              <CardBody className="gap-2">
                <div className="flex items-center gap-2">
                  <Lightbulb size={16} className="text-success-soft-foreground" />
                  <span className="text-sm font-semibold text-success-soft-foreground">
                    {t('newsletters.email_template_tips')}
                  </span>
                </div>
                <ul className="list-inside list-disc space-y-1 text-xs text-success-soft-foreground">
                  <li>{t('newsletters.tip_inline_css')}</li>
                  <li>{t('newsletters.tip_content_width')}</li>
                  <li>{t('newsletters.tip_test_clients')}</li>
                  <li>{t('newsletters.tip_unsubscribe')}</li>
                  <li>{t('newsletters.tip_web_safe_fonts')}</li>
                </ul>
              </CardBody>
            </Card>

            {/* Usage stats (edit mode only) */}
            {isEdit && template && (
              <Card>
                <CardBody className="gap-2">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={16} className="text-muted" />
                    <span className="text-sm font-semibold">{t('newsletters.usage_stats')}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold">
                      {template.usage_count ?? 0}
                    </span>
                    <span className="text-sm text-muted">
                      {(template.usage_count ?? 0) !== 1
                        ? t('newsletters.usage_stats_sent_plural')
                        : t('newsletters.usage_stats_sent')}
                    </span>
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

export default TemplateForm;
