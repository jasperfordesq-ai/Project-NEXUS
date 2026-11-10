// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * NewsletterContentEditor — the multi-mode authoring surface shared by the
 * newsletter compose form and the template form.
 *
 * Modes: Plain text · Rich text (existing Lexical) · HTML source · Design
 * (GrapesJS + MJML visual builder). Emits ONE atomic { content, content_format }
 * so the two can never desync (which format the send pipeline uses depends on
 * it). Destructive mode switches (e.g. HTML → Rich text, which mangles through
 * Lexical) are gated by a confirm dialog.
 */

import { lazy, Suspense, useState } from 'react';
import { Tabs, Tab, Spinner, Button } from '@/components/ui';
import { useConfirm } from '@/components/ui';
import Maximize from 'lucide-react/icons/maximize';
import { useTranslation } from 'react-i18next';
import Type from 'lucide-react/icons/type';
import FileText from 'lucide-react/icons/file-text';
import Code from 'lucide-react/icons/code';
import Paintbrush from 'lucide-react/icons/paintbrush';
import ChevronDown from 'lucide-react/icons/chevron-down';
import ChevronRight from 'lucide-react/icons/chevron-right';
import {
  type ContentFormat,
  EDITOR_MODES,
  isDestructiveSwitch,
  transformContent,
} from './contentFormat';
import { PlainTextEditor } from './PlainTextEditor';
import { NewsletterPreviewPane } from './NewsletterPreviewPane';

const RichTextEditor = lazy(() =>
  import('./RichTextEditor').then((m) => ({ default: m.RichTextEditor })),
);
const HtmlSourceEditor = lazy(() =>
  import('./HtmlSourceEditor').then((m) => ({ default: m.HtmlSourceEditor })),
);
const NewsletterBuilder = lazy(() =>
  import('./NewsletterBuilder').then((m) => ({ default: m.NewsletterBuilder })),
);

interface PreviewRequest {
  content: string;
  content_format: ContentFormat;
  subject?: string;
  preview_text?: string;
}

interface NewsletterContentEditorProps {
  value: string;
  format: ContentFormat;
  onChange: (next: { content: string; content_format: ContentFormat; design_json?: string | null }) => void;
  /** GrapesJS project state (builder mode) — passed through so a design reopens. */
  designJson?: string | null;
  label?: string;
  placeholder?: string;
  isDisabled?: boolean;
  /** True only for already-sent newsletters — freezes the visual builder canvas
   * (the builder stays interactive during background saves, unlike isDisabled). */
  readOnly?: boolean;
  /** Modes to expose. Defaults to all four. */
  modes?: ContentFormat[];
  /** Enables the live preview pane when provided. */
  onRequestPreview?: (req: PreviewRequest) => Promise<string>;
  /** Subject/preview text for a faithful preview. */
  subject?: string;
  previewText?: string;
  /** When provided, the Design tab opens the full-screen studio instead of an
   * inline (cramped) canvas. The host owns saving a draft + navigating there. */
  onOpenDesigner?: () => void;
  /** True once the current newsletter has a saved builder design to reopen. */
  hasDesign?: boolean;
}

const MODE_ICON: Record<ContentFormat, React.ReactNode> = {
  plaintext: <Type size={15} />,
  richtext: <FileText size={15} />,
  html: <Code size={15} />,
  builder: <Paintbrush size={15} />,
};

export function NewsletterContentEditor({
  value,
  format,
  onChange,
  designJson,
  placeholder,
  isDisabled,
  readOnly,
  modes = EDITOR_MODES,
  onRequestPreview,
  subject,
  previewText,
  onOpenDesigner,
  hasDesign,
}: NewsletterContentEditorProps) {
  const { t } = useTranslation('admin_newsletters');
  const confirm = useConfirm();
  const [showPreview, setShowPreview] = useState(true);

  const emit = (content: string, nextFormat: ContentFormat, nextDesignJson?: string | null) => {
    onChange(
      nextDesignJson === undefined
        ? { content, content_format: nextFormat }
        : { content, content_format: nextFormat, design_json: nextDesignJson },
    );
  };

  const requestModeChange = async (next: ContentFormat) => {
    if (next === format) return;

    if (isDestructiveSwitch(format, next, value)) {
      const ok = await confirm({
        title: t('newsletter_content_editor.switch_confirm_title'),
        body:
          next === 'plaintext'
            ? t('newsletter_content_editor.switch_to_plain_warning')
            : next === 'richtext'
              ? t('newsletter_content_editor.switch_to_richtext_warning')
              : t('newsletter_content_editor.switch_to_design_warning'),
        status: 'warning',
        confirmLabel: t('newsletter_content_editor.switch_confirm'),
      });
      if (!ok) return; // stay in current mode
    }

    emit(transformContent(value, format, next), next);
  };

  const modeLabel = (m: ContentFormat) =>
    ({
      plaintext: t('newsletter_content_editor.mode_plaintext'),
      richtext: t('newsletter_content_editor.mode_richtext'),
      html: t('newsletter_content_editor.mode_html'),
      builder: t('newsletter_content_editor.mode_design'),
    })[m];

  const modeHint = (m: ContentFormat) =>
    ({
      plaintext: t('newsletter_content_editor.hint_plaintext'),
      richtext: t('newsletter_content_editor.hint_richtext'),
      html: t('newsletter_content_editor.hint_html'),
      builder: t('newsletter_content_editor.hint_design'),
    })[m];

  const editorFallback = (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('newsletter_content_editor.loading')}
      className="flex items-center justify-center py-16"
    >
      <Spinner size="sm" />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Mode switcher + contextual hint */}
      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">
            {t('newsletter_content_editor.section_title')}
          </span>
          <Tabs
            selectedKey={format}
            onSelectionChange={(key) => requestModeChange(key as ContentFormat)}
            aria-label={t('newsletter_content_editor.mode_switcher')}
            size="sm"
          >
            {modes.map((m) => (
              <Tab
                key={m}
                id={m}
                title={
                  <span className="flex items-center gap-1.5">
                    {MODE_ICON[m]}
                    {modeLabel(m)}
                  </span>
                }
              />
            ))}
          </Tabs>
        </div>
        <p className="mt-1 text-xs text-muted">{modeHint(format)}</p>
      </div>

      {/* Active editor */}
      <div>
        {format === 'plaintext' && (
          <PlainTextEditor value={value} onChange={(text) => emit(text, 'plaintext')} isDisabled={isDisabled} />
        )}
        {format === 'richtext' && (
          <Suspense fallback={editorFallback}>
            <RichTextEditor
              label={t('newsletter_content_editor.label_richtext')}
              placeholder={placeholder}
              value={value}
              onChange={(htmlValue: string) => emit(htmlValue, 'richtext')}
              isDisabled={isDisabled}
            />
          </Suspense>
        )}
        {format === 'html' && (
          <Suspense fallback={editorFallback}>
            <HtmlSourceEditor
              value={value}
              onChange={(htmlValue) => emit(htmlValue, 'html')}
              isDisabled={isDisabled}
              labels={{
                label: t('newsletter_content_editor.label_html'),
                hint: t('newsletter_content_editor.html_hint'),
                insertImage: t('newsletter_content_editor.insert_image'),
                uploadFailed: t('newsletter_content_editor.image_upload_failed'),
              }}
            />
          </Suspense>
        )}
        {format === 'builder' && onOpenDesigner && (
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-surface px-6 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent-soft-foreground">
              <Maximize size={22} />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {t('newsletter_builder.launch_title')}
              </p>
              <p className="mt-1 max-w-md text-xs text-muted">
                {hasDesign
                  ? t('newsletter_builder.launch_reopen_desc')
                  : t('newsletter_builder.launch_desc')}
              </p>
            </div>
            <Button variant="primary" startContent={<Maximize size={16} />} onPress={onOpenDesigner}>
              {hasDesign ? t('newsletter_builder.launch_reopen_cta') : t('newsletter_builder.launch_cta')}
            </Button>
          </div>
        )}
        {format === 'builder' && !onOpenDesigner && (
          <Suspense fallback={editorFallback}>
            <NewsletterBuilder
              html={value}
              designJson={designJson}
              readOnly={readOnly}
              enableTemplates
              onChange={({ html: h, designJson: dj }) => emit(h, 'builder', dj)}
            />
          </Suspense>
        )}
      </div>

      {/* Collapsible live preview */}
      {onRequestPreview && (
        <div className="rounded-xl border border-border bg-surface">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-4 py-3 text-sm font-medium text-foreground"
            onClick={() => setShowPreview((s) => !s)}
            aria-expanded={showPreview}
          >
            {showPreview ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {t('newsletter_content_editor.preview_title')}
          </button>
          {showPreview && (
            <div className="px-4 pb-4">
              <NewsletterPreviewPane
                content={value}
                format={format}
                subject={subject}
                previewText={previewText}
                onRequestPreview={onRequestPreview}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NewsletterContentEditor;
