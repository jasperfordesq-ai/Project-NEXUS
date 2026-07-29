import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Input, Button, Chip, Select, SelectItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch, Tooltip } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';

import { Separator } from '@/components/ui';
import Save from 'lucide-react/icons/save';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Send from 'lucide-react/icons/send';
import TestTube from 'lucide-react/icons/test-tube';
import Users from 'lucide-react/icons/users';
import Calendar from 'lucide-react/icons/calendar';
import Repeat from 'lucide-react/icons/repeat';
import Target from 'lucide-react/icons/target';
import MapPin from 'lucide-react/icons/map-pin';
import UsersRound from 'lucide-react/icons/users-round';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { adminNewsletters } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Newsletter Create/Edit Form
 * Full parity with PHP Admin\NewsletterController::create() / edit()
 * Includes: send, test send, recipient preview, A/B testing, recurring, geo/group targeting
 */


import { NewsletterContentEditor } from '../../components/NewsletterContentEditor';
import { TemplateGalleryModal, type GalleryTemplate } from '../../components/TemplateGalleryModal';
import type { ContentFormat } from '../../components/contentFormat';
import LayoutTemplate from 'lucide-react/icons/layout-template';

interface SegmentOption {
  id: number;
  name: string;
  member_count?: number;
}

interface TemplateOption {
  id: number;
  name: string;
  description?: string;
  category?: string;
  subject?: string;
  preview_text?: string;
  content?: string;
  content_format?: string;
  thumbnail?: string | null;
}

interface GroupOption {
  id: number;
  name: string;
}

const personalizationTags = [
  { token: '{{first_name}}', labelKey: 'newsletter_form.tag_first_name' },
  { token: '{{last_name}}', labelKey: 'newsletter_form.tag_last_name' },
  { token: '{{name}}', labelKey: 'newsletter_form.tag_full_name' },
  { token: '{{email}}', labelKey: 'newsletter_form.tag_email' },
  { token: '{{tenant_name}}', labelKey: 'newsletter_form.tag_tenant_name' },
  { token: '{{unsubscribe_link}}', labelKey: 'newsletter_form.tag_unsubscribe_link' },
];

const listToCsv = (value: unknown): string => {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value !== 'string') return '';

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String).join(', ');
    }
  } catch {
    // Plain comma-separated input is already the editable form.
  }

  return value;
};

const csvToList = (value: string): string[] | null => {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : null;
};

export function NewsletterForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const { t } = useTranslation('admin_newsletters');
  usePageTitle(isEdit ? t('newsletter_form.page_title_edit') : t('newsletter_form.page_title_create'));
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();

  // Core fields
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [content, setContent] = useState('');
  // Legacy rows have no content_format → default 'richtext' (Lexical HTML),
  // preserving their existing editing behavior.
  const [contentFormat, setContentFormat] = useState<ContentFormat>('richtext');
  // GrapesJS project state for builder mode (null for other formats).
  const [designJson, setDesignJson] = useState<string | null>(null);
  const [status, setStatus] = useState('draft');

  // Targeting
  const [targetAudience, setTargetAudience] = useState('all_members');
  const [segmentId, setSegmentId] = useState('');

  // Geo/group targeting
  const [targetCounties, setTargetCounties] = useState('');
  const [targetTowns, setTargetTowns] = useState('');
  const [targetGroups, setTargetGroups] = useState<string[]>([]);

  // Scheduling
  const [scheduledAt, setScheduledAt] = useState('');

  // Recurring
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState('weekly');
  const [recurringDay, setRecurringDay] = useState('1'); // Mon
  const [recurringDayOfMonth, setRecurringDayOfMonth] = useState('1');
  const [recurringTime, setRecurringTime] = useState('09:00');
  const [recurringEndDate, setRecurringEndDate] = useState('');

  // A/B Testing
  const [abTestEnabled, setAbTestEnabled] = useState(false);
  const [subjectB, setSubjectB] = useState('');
  const [abSplitPercentage, setAbSplitPercentage] = useState(50);
  const [abWinnerMetric, setAbWinnerMetric] = useState('opens');
  const [abAutoSelectWinner, setAbAutoSelectWinner] = useState(false);
  const [abAutoSelectAfterHours, setAbAutoSelectAfterHours] = useState(24);

  // Template
  const [templateId, setTemplateId] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);

  // Options data
  const [segments, setSegments] = useState<SegmentOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);

  // UI state
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [sending, setSending] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [newsletterStatus, setNewsletterStatus] = useState('draft');

  // Load segments, templates, groups
  useEffect(() => {
    (async () => {
      try {
        const [segRes, tplRes] = await Promise.all([
          adminNewsletters.getSegments(),
          adminNewsletters.getTemplates(),
        ]);
        if (segRes.success && Array.isArray(segRes.data)) {
          setSegments(segRes.data as SegmentOption[]);
        }
        if (tplRes.success && Array.isArray(tplRes.data)) {
          setTemplates(tplRes.data as TemplateOption[]);
        }
      } catch { /* non-critical */ }

      // Load groups for targeting
      try {
        const api = await import('../../api/adminApi');
        if (api.adminGroups?.list) {
          const gRes = await api.adminGroups.list({ per_page: 200 });
          if (gRes.success) {
            const payload = gRes.data as unknown;
            if (payload && typeof payload === 'object' && 'data' in payload) {
              setGroups((payload as { data: GroupOption[] }).data || []);
            } else if (Array.isArray(payload)) {
              setGroups(payload as GroupOption[]);
            }
          }
        }
      } catch { /* non-critical */ }
    })();
  }, []);

  // Load newsletter data for edit
  useEffect(() => {
    if (isEdit && id) {
      (async () => {
        try {
          const res = await adminNewsletters.get(Number(id));
          if (res.success && res.data) {
            const d = res.data as Record<string, unknown>;
            setSubject((d.subject as string) || '');
            setPreviewText((d.preview_text as string) || '');
            setContent((d.content as string) || '');
            setContentFormat(((d.content_format as ContentFormat) || 'richtext'));
            setDesignJson((d.design_json as string) || null);
            setStatus((d.status as string) || 'draft');
            setNewsletterStatus((d.status as string) || 'draft');
            setTargetAudience((d.target_audience as string) || 'all_members');
            setSegmentId(d.segment_id ? String(d.segment_id) : '');
            setScheduledAt((d.scheduled_at as string) || '');
            setAbTestEnabled(!!d.ab_test_enabled);
            setSubjectB((d.subject_b as string) || '');
            setAbSplitPercentage((d.ab_split_percentage as number) || 50);
            setAbWinnerMetric((d.ab_winner_metric as string) || 'opens');
            setAbAutoSelectWinner(!!d.ab_auto_select_winner);
            setAbAutoSelectAfterHours((d.ab_auto_select_after_hours as number) || 24);
            setTemplateId(d.template_id ? String(d.template_id) : '');
            setTargetCounties(listToCsv(d.target_counties));
            setTargetTowns(listToCsv(d.target_towns));
            setIsRecurring(!!d.is_recurring);
            setRecurringFrequency((d.recurring_frequency as string) || 'weekly');
            setRecurringDay(d.recurring_day ? String(d.recurring_day) : '1');
            setRecurringDayOfMonth(d.recurring_day_of_month ? String(d.recurring_day_of_month) : '1');
            setRecurringTime((d.recurring_time as string) || '09:00');
            setRecurringEndDate((d.recurring_end_date as string) || '');

            if (d.target_groups) {
              try {
                const parsed = typeof d.target_groups === 'string'
                  ? JSON.parse(d.target_groups as string)
                  : d.target_groups;
                if (Array.isArray(parsed)) {
                  setTargetGroups(parsed.map(String));
                }
              } catch { /* ignore */ }
            }
          }
        } catch (err) {
          logError('NewsletterForm: failed to load newsletter data', err);
          toast.error(t('newsletter_form.failed_to_load'));
        }
        setLoading(false);
      })();
    }
  }, [id, isEdit, t, toast])


  // Fetch recipient count when targeting changes
  const fetchRecipientCount = useCallback(async () => {
    setRecipientLoading(true);
    try {
      const params: {
        target_audience: string;
        segment_id?: number;
        target_groups?: number[];
        target_counties?: string[];
        target_towns?: string[];
      } = {
        target_audience: targetAudience === 'segment' ? 'all_members' : targetAudience,
      };
      if (targetAudience === 'segment' && segmentId) {
        params.segment_id = Number(segmentId);
      }
      // Group/geo targeting narrows the send — include it so the previewed
      // count matches what the backend will actually queue.
      const groupIds = targetGroups.map(Number).filter((groupId) => groupId > 0);
      if (groupIds.length > 0) params.target_groups = groupIds;
      const counties = csvToList(targetCounties);
      if (counties && counties.length > 0) params.target_counties = counties;
      const towns = csvToList(targetTowns);
      if (towns && towns.length > 0) params.target_towns = towns;
      const res = await adminNewsletters.getRecipientCount(params);
      if (res.success && res.data) {
        setRecipientCount((res.data as { count: number }).count);
      }
    } catch {
      setRecipientCount(null);
    }
    setRecipientLoading(false);
  }, [targetAudience, segmentId, targetGroups, targetCounties, targetTowns]);

  useEffect(() => {
    fetchRecipientCount();
  }, [fetchRecipientCount]);

  // Apply a template picked from the gallery. Sets content + content_format
  // together so a starter's raw HTML lands in the right editor mode (never fed
  // to the Lexical rich-text editor). Subject/preview only fill when empty.
  const applyTemplate = (tpl: GalleryTemplate) => {
    if (tpl.content !== undefined) setContent(tpl.content);
    if (tpl.content_format) setContentFormat(tpl.content_format as ContentFormat);
    // Builder templates carry a GrapesJS project (design_json) for lossless
    // reopening; starters ship MJML in `content` (design_json null) and the
    // Design Studio seeds from that. Non-builder templates clear any design.
    const dj = (tpl as { design_json?: string | null }).design_json;
    setDesignJson(tpl.content_format === 'builder' ? (dj ?? null) : null);
    if (tpl.subject && !subject) setSubject(tpl.subject);
    if (tpl.preview_text && !previewText) setPreviewText(tpl.preview_text);
    setTemplateId(String(tpl.id));
  };

  // Open the full-screen Design Studio. It loads the newsletter by id, so we
  // must persist the current draft first (create → get an id, or update).
  const handleOpenDesigner = async () => {
    setSaving(true);
    let savedId: number | null = null;
    try {
      savedId = await saveNewsletter();
    } catch {
      toast.error(t('newsletters.an_unexpected_error_occurred'));
    }
    setSaving(false);
    if (savedId !== null) {
      navigate(tenantPath(`/admin/newsletters/edit/${savedId}/design`));
    }
  };

  const selectedTemplate = templates.find((tpl) => String(tpl.id) === templateId);

  const buildPayload = (): Record<string, unknown> => ({
    subject,
    name: subject, // PHP requires name; use subject as name
    preview_text: previewText,
    content,
    content_format: contentFormat,
    design_json: contentFormat === 'builder' ? designJson : null,
    status,
    target_audience: targetAudience,
    segment_id: segmentId ? Number(segmentId) : null,
    scheduled_at: status === 'scheduled' ? scheduledAt : null,
    ab_test_enabled: abTestEnabled,
    subject_b: abTestEnabled ? subjectB : null,
    ab_split_percentage: abTestEnabled ? abSplitPercentage : 50,
    ab_winner_metric: abTestEnabled ? abWinnerMetric : 'opens',
    ab_auto_select_winner: abTestEnabled ? abAutoSelectWinner : false,
    ab_auto_select_after_hours: abTestEnabled && abAutoSelectWinner ? abAutoSelectAfterHours : null,
    template_id: templateId ? Number(templateId) : null,
    target_counties: csvToList(targetCounties),
    target_towns: csvToList(targetTowns),
    target_groups: targetGroups.length > 0 ? targetGroups.map(Number).filter((groupId) => groupId > 0) : null,
    is_recurring: isRecurring,
    recurring_frequency: isRecurring ? recurringFrequency : null,
    recurring_day: isRecurring && recurringFrequency === 'weekly' ? Number(recurringDay) : null,
    recurring_day_of_week: isRecurring && recurringFrequency === 'weekly' ? Number(recurringDay) : null,
    recurring_day_of_month: isRecurring && recurringFrequency === 'monthly' ? Number(recurringDayOfMonth) : null,
    recurring_time: isRecurring ? recurringTime : null,
    recurring_end_date: isRecurring && recurringEndDate ? recurringEndDate : null,
  });

  const saveNewsletter = async (): Promise<number | null> => {
    if (!subject.trim()) {
      toast.error(t('newsletter_form.subject_required'));
      return null;
    }

    const payload = buildPayload();
    const res = isEdit && id
      ? await adminNewsletters.update(Number(id), payload)
      : await adminNewsletters.create(payload);

    if (res.success) {
      const newId = isEdit ? Number(id) : (res.data as { id: number }).id;
      return newId;
    } else {
      // admin-i18n-ignore: localized server message — AdminNewsletterController
      // refusals are __() keys, guarded by ApiErrorLocalisationTest.
      toast.error(res.error || t('newsletter_form.failed_to_save'));
      return null;
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const savedId = await saveNewsletter();
      if (savedId !== null) {
        toast.success(isEdit ? t('newsletter_form.newsletter_updated') : t('newsletter_form.newsletter_created'));
        navigate(tenantPath('/admin/newsletters'));
      }
    } catch {
      toast.error(t('newsletters.an_unexpected_error_occurred'));
    }
    setSaving(false);
  };

  const handleSendNow = async () => {
    if (!id) return;
    setSending(true);
    try {
      // Save first, then send
      const savedId = await saveNewsletter();
      if (savedId === null) {
        setSending(false);
        return;
      }

      const res = await adminNewsletters.sendNewsletter(savedId);
      if (res.success) {
        // admin-i18n-ignore: localized server message — the queued count comes
        // from api_controllers_1.admin_newsletter.newsletter_queued.
        toast.success(res.data?.message || t('newsletter_form.newsletter_queued'));
        setConfirmSendOpen(false);
        navigate(tenantPath(`/admin/newsletters/${id}/stats`));
      } else {
        // admin-i18n-ignore: localized server message — AdminNewsletterController
        // refusals are __() keys, guarded by ApiErrorLocalisationTest.
        toast.error(res.error || t('newsletters.failed_to_send_newsletter'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_send_newsletter'));
    }
    setSending(false);
  };

  const handleSendTest = async () => {
    if (!id) {
      toast.error(t('newsletter_form.save_before_test'));
      return;
    }
    setSendingTest(true);
    try {
      // Save first so the test email uses current content
      const savedId = await saveNewsletter();
      if (savedId === null) {
        setSendingTest(false);
        return;
      }

      const res = await adminNewsletters.sendTest(savedId);
      if (res.success) {
        // admin-i18n-ignore: localized server message — the test-send
        // confirmation is a translated key in the controller.
        toast.success(res.data?.message || t('newsletter_form.test_email_sent'));
      } else {
        // admin-i18n-ignore: localized server message — AdminNewsletterController
        // refusals are __() keys, guarded by ApiErrorLocalisationTest.
        toast.error(res.error || t('newsletter_form.failed_to_send_test'));
      }
    } catch {
      toast.error(t('newsletter_form.failed_to_send_test'));
    }
    setSendingTest(false);
  };

  if (loading) {
    return <div className="flex justify-center py-16"><span className="text-muted">{t('newsletter_form.loading')}</span></div>;
  }

  const isSent = newsletterStatus === 'sent' || newsletterStatus === 'sending';
  const dayNames = [
    t('newsletter_form.day_monday'), t('newsletter_form.day_tuesday'), t('newsletter_form.day_wednesday'),
    t('newsletter_form.day_thursday'), t('newsletter_form.day_friday'), t('newsletter_form.day_saturday'),
    t('newsletter_form.day_sunday'),
  ];
  const audienceLabel = (audience: string): string => {
    switch (audience) {
      case 'subscribers_only':
        return t('newsletter_form.audience_subscribers_only');
      case 'both':
        return t('newsletter_form.audience_members_subscribers');
      case 'segment':
        return t('newsletter_form.audience_specific_segment');
      case 'all_members':
      default:
        return t('newsletter_form.audience_all_members');
    }
  };
  const frequencyLabel = (frequency: string): string => {
    switch (frequency) {
      case 'daily':
        return t('newsletter_form.frequency_daily');
      case 'monthly':
        return t('newsletter_form.frequency_monthly');
      case 'weekly':
      default:
        return t('newsletter_form.frequency_weekly');
    }
  };

  return (
    <div>
      <PageHeader
        title={isEdit ? t('newsletter_form.title_edit') : t('newsletter_form.title_create')}
        description={isEdit ? t('newsletter_form.desc_edit') : t('newsletter_form.desc_create')}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" startContent={<ArrowLeft aria-hidden="true" size={16} />} onPress={() => navigate(tenantPath('/admin/newsletters'))}>
              {t('newsletter_form.back')}
            </Button>
            {isEdit && !isSent && (
              <Button
                variant="secondary"
                startContent={<TestTube aria-hidden="true" size={16} />}
                onPress={handleSendTest}
                isLoading={sendingTest}
              >
                {t('newsletter_form.send_test')}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Main Content ── */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><h3 className="text-lg font-semibold">{t('newsletter_form.section_details')}</h3></CardHeader>
            <CardBody className="gap-4">
              <Input
                label={t('newsletter_form.label_subject_line')}
                placeholder={t('newsletter_form.subject_placeholder')}
                value={subject}
                onValueChange={setSubject}
                isRequired
                variant="secondary"
                isDisabled={isSent}
              />
              <Input
                label={t('newsletter_form.label_preview_text')}
                placeholder={t('newsletter_form.preview_text_placeholder')}
                value={previewText}
                onValueChange={setPreviewText}
                variant="secondary"
                description={t('newsletter_form.preview_text_description')}
                isDisabled={isSent}
              />

              {/* A/B Testing */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium">{t('newsletter_form.ab_test_subject_lines')}</p>
                  <p className="text-xs text-muted">{t('newsletter_form.ab_test_subject_lines_desc')}</p>
                </div>
                <Switch isSelected={abTestEnabled} onValueChange={setAbTestEnabled} size="sm" isDisabled={isSent} />
              </div>
              {abTestEnabled && (
                <div className="space-y-3 pl-4 border-l-2 border-warning-200">
                  <Input
                    label={t('newsletter_form.label_subject_b')}
                    placeholder={t('newsletter_form.subject_b_placeholder')}
                    value={subjectB}
                    onValueChange={setSubjectB}
                    variant="secondary"
                    isDisabled={isSent}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      type="number"
                      label={t('newsletter_form.label_split_percent')}
                      value={String(abSplitPercentage)}
                      onValueChange={(v) => setAbSplitPercentage(Math.max(10, Math.min(90, Number(v) || 50)))}
                      variant="secondary"
                      size="sm"
                      description={t('newsletter_form.ab_split_description', {
                        variantA: formatNumber(abSplitPercentage / 100, { style: 'percent', maximumFractionDigits: 0 }),
                        variantB: formatNumber((100 - abSplitPercentage) / 100, { style: 'percent', maximumFractionDigits: 0 }),
                      })}
                      isDisabled={isSent}
                    />
                    <Select
                      label={t('newsletter_form.label_winning_metric')}
                      selectedKeys={[abWinnerMetric]}
                      onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setAbWinnerMetric(String(v)); }}
                      variant="secondary"
                      size="sm"
                      isDisabled={isSent}
                    >
                      <SelectItem key="opens" id="opens">{t('newsletter_form.metric_open_rate')}</SelectItem>
                      <SelectItem key="clicks" id="clicks">{t('newsletter_form.metric_click_rate')}</SelectItem>
                      <SelectItem key="conversions" id="conversions">{t('newsletter_form.metric_conversion_rate')}</SelectItem>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-surface">
                    <div>
                      <p className="text-xs font-medium">{t('newsletter_form.auto_select_winner')}</p>
                      <p className="text-xs text-muted">{t('newsletter_form.auto_select_winner_desc')}</p>
                    </div>
                    <Switch
                      isSelected={abAutoSelectWinner}
                      onValueChange={setAbAutoSelectWinner}
                      size="sm"
                      isDisabled={isSent}
                    />
                  </div>
                  {abAutoSelectWinner && (
                    <Input
                      type="number"
                      label={t('newsletter_form.label_auto_select_after')}
                      value={String(abAutoSelectAfterHours)}
                      onValueChange={(v) => setAbAutoSelectAfterHours(Math.max(1, Number(v) || 24))}
                      variant="secondary"
                      size="sm"
                      isDisabled={isSent}
                    />
                  )}
                </div>
              )}

              <Separator />
              <NewsletterContentEditor
                value={content}
                format={contentFormat}
                designJson={designJson}
                onChange={({ content: c, content_format: f, design_json: dj }) => {
                  setContent(c);
                  setContentFormat(f);
                  if (dj !== undefined) setDesignJson(dj);
                }}
                placeholder={t('newsletters.placeholder_write_your_newsletter_content')}
                isDisabled={saving || isSent}
                readOnly={isSent}
                subject={subject}
                previewText={previewText}
                onOpenDesigner={isSent ? undefined : handleOpenDesigner}
                hasDesign={contentFormat === 'builder' && Boolean(designJson)}
                onRequestPreview={async (req) => {
                  const res = await adminNewsletters.previewContent(req);
                  if (res.success && res.data) {
                    return (res.data as { html: string }).html;
                  }
                  throw new Error('preview failed');
                }}
              />
              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {t('newsletter_form.personalization_title')}
                  </span>
                  <span className="text-xs text-muted">
                    {t('newsletter_form.personalization_desc')}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {personalizationTags.map((tag) => (
                    <Chip key={tag.token} size="sm" variant="soft" className="font-mono">
                      {tag.token} <span className="font-sans text-muted">{t(tag.labelKey)}</span>
                    </Chip>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">
                  {t('newsletter_form.personalization_body_only')}
                </p>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-6">
          {/* Recipient Preview */}
          <Card  className="border-2 border-accent">
            <CardBody className="gap-3">
              <div className="flex items-center gap-2">
                <Users aria-hidden="true" size={18} className="text-accent" />
                <span className="text-sm font-semibold">{t('newsletter_form.estimated_recipients')}</span>
              </div>
              <div className="text-center">
                {recipientLoading ? (
                  <span className="text-sm text-muted">{t('newsletter_form.calculating')}</span>
                ) : recipientCount !== null ? (
                  <div>
                    <p className="text-3xl font-bold text-accent">{recipientCount.toLocaleString(getFormattingLocale())}</p>
                    <p className="text-xs text-muted">
                      {targetAudience === 'segment' ? t('newsletter_form.matching_segment_rules') : audienceLabel(targetAudience)}
                    </p>
                  </div>
                ) : (
                  <span className="text-sm text-muted">{t('newsletter_form.unable_to_calculate')}</span>
                )}
              </div>
              <Button size="sm" variant="secondary" onPress={fetchRecipientCount} isLoading={recipientLoading} isDisabled={recipientLoading}>
                {t('newsletter_form.refresh_count')}
              </Button>
            </CardBody>
          </Card>

          {/* Status & Scheduling */}
          <Card>
            <CardHeader><h3 className="text-sm font-semibold">{t('newsletter_form.section_status_scheduling')}</h3></CardHeader>
            <CardBody className="gap-4">
              <Select
                label={t('newsletter_form.label_status')}
                selectedKeys={[status]}
                onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setStatus(String(v)); }}
                variant="secondary"
                size="sm"
                isDisabled={isSent}
              >
                <SelectItem key="draft" id="draft">{t('newsletter_form.status_draft')}</SelectItem>
                <SelectItem key="scheduled" id="scheduled">{t('newsletter_form.status_scheduled')}</SelectItem>
              </Select>

              {status === 'scheduled' && (
                <Input
                  label={t('newsletter_form.label_scheduled_date')}
                  type="datetime-local"
                  value={scheduledAt}
                  onValueChange={setScheduledAt}
                  variant="secondary"
                  size="sm"
                  isDisabled={isSent}
                />
              )}
            </CardBody>
          </Card>

          {/* Recurring Schedule */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Repeat aria-hidden="true" size={16} />
                <h3 className="text-sm font-semibold">{t('newsletter_form.section_recurring_schedule')}</h3>
              </div>
            </CardHeader>
            <CardBody className="gap-4">
              <div className="flex items-center justify-between">
                <p className="text-sm">{t('newsletter_form.enable_recurring_sends')}</p>
                <Switch isSelected={isRecurring} onValueChange={setIsRecurring} size="sm" isDisabled={isSent} />
              </div>

              {isRecurring && (
                <div className="space-y-3">
                  <Select
                    label={t('newsletter_form.label_frequency')}
                    selectedKeys={[recurringFrequency]}
                    onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setRecurringFrequency(String(v)); }}
                    variant="secondary"
                    size="sm"
                    isDisabled={isSent}
                  >
                    <SelectItem key="daily" id="daily">{t('newsletter_form.frequency_daily')}</SelectItem>
                    <SelectItem key="weekly" id="weekly">{t('newsletter_form.frequency_weekly')}</SelectItem>
                    <SelectItem key="monthly" id="monthly">{t('newsletter_form.frequency_monthly')}</SelectItem>
                  </Select>

                  {recurringFrequency === 'weekly' && (
                    <Select
                      label={t('newsletter_form.label_day_of_week')}
                      selectedKeys={[recurringDay]}
                      onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setRecurringDay(String(v)); }}
                      variant="secondary"
                      size="sm"
                      isDisabled={isSent}
                    >
                      {dayNames.map((name, i) => (
                        <SelectItem key={String(i + 1)} id={String(i + 1)}>{name}</SelectItem>
                      ))}
                    </Select>
                  )}

                  {recurringFrequency === 'monthly' && (
                    <Select
                      label={t('newsletter_form.label_day_of_month')}
                      selectedKeys={[recurringDayOfMonth]}
                      onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setRecurringDayOfMonth(String(v)); }}
                      variant="secondary"
                      size="sm"
                      isDisabled={isSent}
                    >
                      {Array.from({ length: 28 }, (_, i) => (
                        <SelectItem key={String(i + 1)} id={String(i + 1)}>{String(i + 1)}</SelectItem>
                      ))}
                    </Select>
                  )}

                  <Input
                    label={t('newsletter_form.label_send_time')}
                    type="time"
                    value={recurringTime}
                    onValueChange={setRecurringTime}
                    variant="secondary"
                    size="sm"
                    isDisabled={isSent}
                  />

                  <Input
                    label={t('newsletter_form.label_end_date')}
                    type="date"
                    value={recurringEndDate}
                    onValueChange={setRecurringEndDate}
                    variant="secondary"
                    size="sm"
                    description={t('newsletter_form.end_date_description')}
                    isDisabled={isSent}
                  />
                </div>
              )}
            </CardBody>
          </Card>

          {/* Audience */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Target aria-hidden="true" size={16} />
                <h3 className="text-sm font-semibold">{t('newsletter_form.section_target_audience')}</h3>
              </div>
            </CardHeader>
            <CardBody className="gap-4">
              <Select
                label={t('newsletter_form.label_recipients')}
                selectedKeys={[targetAudience]}
                onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setTargetAudience(String(v)); }}
                variant="secondary"
                size="sm"
                isDisabled={isSent}
              >
                <SelectItem key="all_members" id="all_members">{t('newsletter_form.audience_all_members')}</SelectItem>
                <SelectItem key="subscribers_only" id="subscribers_only">{t('newsletter_form.audience_subscribers_only')}</SelectItem>
                <SelectItem key="both" id="both">{t('newsletter_form.audience_members_subscribers')}</SelectItem>
                <SelectItem key="segment" id="segment">{t('newsletter_form.audience_specific_segment')}</SelectItem>
              </Select>

              {targetAudience === 'segment' && segments.length > 0 && (
                <Select
                  label={t('newsletter_form.label_segment')}
                  selectedKeys={segmentId ? [segmentId] : []}
                  onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setSegmentId(String(v)); }}
                  variant="secondary"
                  size="sm"
                  isDisabled={isSent}
                >
                  {segments.map((s) => (
                    <SelectItem key={String(s.id)} id={String(s.id)} textValue={s.name}>
                      <div className="flex justify-between items-center">
                        <span>{s.name}</span>
                        {s.member_count !== undefined && (
                          <Chip size="sm" variant="soft">{s.member_count}</Chip>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </Select>
              )}

              <Separator />

              {/* Geo targeting */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <MapPin aria-hidden="true" size={14} className="text-muted" />
                  <p className="text-xs font-medium text-foreground">{t('newsletter_form.geo_targeting_optional')}</p>
                </div>
                <Input
                  label={t('newsletter_form.label_counties')}
                  placeholder={t('newsletter_form.counties_placeholder')}
                  value={targetCounties}
                  onValueChange={setTargetCounties}
                  variant="secondary"
                  size="sm"
                  description={t('newsletter_form.counties_description')}
                  isDisabled={isSent}
                />
                <Input
                  label={t('newsletter_form.label_towns_cities')}
                  placeholder={t('newsletter_form.towns_placeholder')}
                  value={targetTowns}
                  onValueChange={setTargetTowns}
                  variant="secondary"
                  size="sm"
                  description={t('newsletter_form.towns_description')}
                  isDisabled={isSent}
                />
              </div>

              {/* Group targeting */}
              {groups.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <UsersRound aria-hidden="true" size={14} className="text-muted" />
                    <p className="text-xs font-medium text-foreground">{t('newsletter_form.group_targeting_optional')}</p>
                  </div>
                  <Select
                    label={t('newsletter_form.label_target_groups')}
                    selectionMode="multiple"
                    selectedKeys={new Set(targetGroups)}
                    onSelectionChange={(keys) => setTargetGroups(Array.from(keys) as string[])}
                    variant="secondary"
                    size="sm"
                    isDisabled={isSent}
                    placeholder={t('newsletters.placeholder_select_groups')}
                  >
                    {groups.map((g) => (
                      <SelectItem key={String(g.id)} id={String(g.id)}>{g.name}</SelectItem>
                    ))}
                  </Select>
                  {targetGroups.length > 0 && (
                    <p className="text-xs text-muted">{t('newsletter_form.groups_selected')}</p>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Template */}
          {templates.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Calendar aria-hidden="true" size={16} />
                  <h3 className="text-sm font-semibold">{t('newsletter_form.section_template')}</h3>
                </div>
              </CardHeader>
              <CardBody className="gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => setGalleryOpen(true)}
                  isDisabled={isSent}
                  startContent={<LayoutTemplate aria-hidden="true" size={16} />}
                  className="w-full"
                >
                  {t('newsletter_content_editor.gallery_start_button')}
                </Button>
                {selectedTemplate && (
                  <p className="text-xs text-muted">
                    {t('newsletter_form.label_load_template')}: <span className="font-medium text-foreground">{selectedTemplate.name}</span>
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {!isSent && (
              <>
                <Button

                  startContent={<Save aria-hidden="true" size={16} />}
                  onPress={handleSubmit}
                  isLoading={saving}
                  className="w-full"
                >
                  {isEdit ? t('newsletter_form.btn_update') : t('newsletter_form.btn_create')}
                </Button>

                {isEdit && (
                  <Tooltip content={recipientCount === 0 ? t('newsletter_form.no_recipients_match') : t('newsletter_form.send_to_all_targeted')}>
                    <Button

                      startContent={<Send aria-hidden="true" size={16} />}
                      onPress={() => setConfirmSendOpen(true)}
                      isDisabled={recipientCount === 0}
                      className="w-full"
                    >
                      {t('newsletters.send_now')}{recipientCount !== null ? ` (${recipientCount.toLocaleString(getFormattingLocale())})` : ''}
                    </Button>
                  </Tooltip>
                )}
              </>
            )}

            {isSent && (
              <Card className="bg-success-50 dark:bg-success-50/10">
                <CardBody className="flex-row items-center gap-3">
                  <CheckCircle aria-hidden="true" size={20} className="text-success" />
                  <div>
                    <p className="text-sm font-medium text-success">{t('newsletter_form.newsletter_sent')}</p>
                    <p className="text-xs text-success-600 dark:text-success-400">{t('newsletter_form.newsletter_sent_desc')}</p>
                  </div>
                </CardBody>
              </Card>
            )}

            <Button variant="secondary" onPress={() => navigate(tenantPath('/admin/newsletters'))} className="w-full">
              {t('newsletter_form.cancel')}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Template gallery ── */}
      <TemplateGalleryModal
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        templates={templates as GalleryTemplate[]}
        onSelect={applyTemplate}
      />

      {/* ── Confirm Send Modal ── */}
      <Modal isOpen={confirmSendOpen} onClose={() => setConfirmSendOpen(false)} size="md">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <AlertCircle aria-hidden="true" size={20} className="text-warning" />
            {t('newsletter_form.confirm_send')}
          </ModalHeader>
          <ModalBody>
            <div className="space-y-3">
              <p className="text-sm">{t('newsletter_form.confirm_send_message')}</p>
              <Card className="bg-surface">
                <CardBody className="gap-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">{t('newsletter_form.label_subject_line')}</span>
                    <span className="font-medium">{subject}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">{t('newsletter_form.label_recipients')}</span>
                    <span className="font-medium text-accent">{recipientCount?.toLocaleString(getFormattingLocale()) || '--'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">{t('newsletter_form.section_target_audience')}</span>
                    <span className="font-medium">{audienceLabel(targetAudience)}</span>
                  </div>
                  {abTestEnabled && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">{t('newsletter_form.ab_test_label')}</span>
                      <Chip size="sm" color="warning" variant="soft">
                        {t('newsletter_form.ab_test_enabled', { a: abSplitPercentage, b: 100 - abSplitPercentage })}
                      </Chip>
                    </div>
                  )}
                  {isRecurring && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">{t('newsletter_form.recurring_label')}</span>
                      <Chip size="sm" color="default" variant="soft">{frequencyLabel(recurringFrequency)}</Chip>
                    </div>
                  )}
                </CardBody>
              </Card>
              <p className="text-xs text-warning-600 dark:text-warning-400">
                {t('newsletter_form.confirm_send_warning')}
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={() => setConfirmSendOpen(false)} isDisabled={sending}>
              {t('newsletter_form.cancel')}
            </Button>
            <Button

              startContent={<Send aria-hidden="true" size={16} />}
              onPress={handleSendNow}
              isLoading={sending}
            >
              {t('newsletter_form.confirm_and_send')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default NewsletterForm;
