// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * RichTextEditor — Lexical-based rich text editor for admin content editing.
 * Outputs HTML. Supports initial HTML content for editing existing posts.
 * Uses HeroUI Button components for the toolbar and Tailwind CSS for styling.
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { ListItemNode, ListNode } from '@lexical/list';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import {
  $getSelection, $isRangeSelection, $createParagraphNode, $isElementNode, $isDecoratorNode, $isTextNode, FORMAT_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND, type EditorState, type ElementNode, type LexicalEditor, $getRoot, } from 'lexical';
import {
  INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND, } from '@lexical/list';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode, $createQuoteNode, $isHeadingNode } from '@lexical/rich-text';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import { $isLinkNode } from '@lexical/link';
import { $getNearestNodeOfType } from '@lexical/utils';
import { $isListNode, ListNode as ListNodeClass } from '@lexical/list';

import { Separator } from '@/components/ui';
import Bold from 'lucide-react/icons/bold';
import Italic from 'lucide-react/icons/italic';
import Underline from 'lucide-react/icons/underline';
import Strikethrough from 'lucide-react/icons/strikethrough';
import Heading2 from 'lucide-react/icons/heading-2';
import Heading3 from 'lucide-react/icons/heading-3';
import List from 'lucide-react/icons/list';
import ListOrdered from 'lucide-react/icons/list-ordered';
import Link2 from 'lucide-react/icons/link-2';
import Quote from 'lucide-react/icons/quote';
import Undo2 from 'lucide-react/icons/undo-2';
import Redo2 from 'lucide-react/icons/redo-2';
import Code from 'lucide-react/icons/code';
import CodeXml from 'lucide-react/icons/code-xml';
import FileDown from 'lucide-react/icons/file-down';
import { marked } from 'marked';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Spinner, Tooltip } from '@/components/ui';
import { logError } from '@/lib/logger';
import { needsHtmlView, tidyHtmlForSource } from './richTextHtml';

// CodeMirror only ships when someone opens the HTML view.
const HtmlSourceEditor = lazy(() =>
  import('./HtmlSourceEditor').then((m) => ({ default: m.HtmlSourceEditor })),
);

/* ───────────────────────── Types ───────────────────────── */

interface RichTextEditorProps {
  /** Current HTML content */
  value: string;
  /** Callback when content changes (receives HTML string) */
  onChange: (html: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Disable the editor */
  isDisabled?: boolean;
  /** Label shown above the editor */
  label?: string;
  /** Show "Import Markdown" button in toolbar */
  showMarkdownImport?: boolean;
  /**
   * Show an "HTML" button that swaps the visual editor for the content's HTML,
   * so prepared HTML can be pasted in and the markup can be edited by hand.
   */
  showHtmlSource?: boolean;
}

/* ───────────────────────── HTML → editor ───────────────────────── */

/**
 * Replace the editor's content with this HTML. Call inside editor.update().
 *
 * Only block nodes may sit directly under the root, and hand-written HTML has
 * line breaks and sometimes loose text between its blocks. Appending those
 * straight to the root throws, which Lexical turns into a discarded update:
 * the editor would stay empty with no message. So loose inline nodes are
 * gathered into a paragraph, and white space between blocks is skipped.
 */
function $setEditorHtml(editor: LexicalEditor, html: string): void {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const nodes = $generateNodesFromDOM(editor, dom);
  const root = $getRoot();
  root.clear();

  let looseInline: ElementNode | null = null;
  for (const node of nodes) {
    if ($isElementNode(node) || $isDecoratorNode(node)) {
      root.append(node);
      looseInline = null;
      continue;
    }
    if (looseInline === null) {
      if ($isTextNode(node) && node.getTextContent().trim() === '') continue;
      looseInline = $createParagraphNode();
      root.append(looseInline);
    }
    looseInline.append(node);
  }

  // An empty root cannot take the cursor.
  if (root.getChildrenSize() === 0) {
    root.append($createParagraphNode());
  }
}

/* ───────────────────────── Theme ───────────────────────── */

const editorTheme = {
  paragraph: 'mb-2 leading-relaxed',
  heading: {
    h2: 'text-2xl font-bold mt-6 mb-3',
    h3: 'text-xl font-semibold mt-4 mb-2',
  },
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    code: 'bg-surface-secondary dark:bg-surface px-1.5 py-0.5 rounded text-sm font-mono',
  },
  list: {
    ul: 'list-disc pl-6 mb-3',
    ol: 'list-decimal pl-6 mb-3',
    listitem: 'mb-1',
    nested: {
      listitem: 'list-none',
    },
  },
  link: 'text-accent underline cursor-pointer hover:text-accent',
  quote: 'border-l-4 border-accent pl-4 italic text-muted my-4',
  code: 'bg-surface-secondary dark:bg-surface px-1.5 py-0.5 rounded text-sm font-mono',
};

/* ───────────────────────── Toolbar ───────────────────────── */

interface ToolbarPluginProps {
  isDisabled?: boolean;
  showMarkdownImport?: boolean;
  showHtmlSource?: boolean;
  isHtmlView?: boolean;
  onToggleHtmlView?: (editor: LexicalEditor) => void;
}

function ToolbarPlugin({
  isDisabled: isEditorDisabled,
  showMarkdownImport,
  showHtmlSource,
  isHtmlView = false,
  onToggleHtmlView,
}: ToolbarPluginProps) {
  const [editor] = useLexicalComposerContext();
  const { t } = useTranslation('admin_editor');
  // The formatting buttons act on the visual editor, which is hidden while the
  // HTML view is open, so they switch off with it.
  const isDisabled = isEditorDisabled || isHtmlView;
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isCode, setIsCode] = useState(false);
  const [isLink, setIsLink] = useState(false);
  const [blockType, setBlockType] = useState<string>('paragraph');

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      setIsBold(selection.hasFormat('bold'));
      setIsItalic(selection.hasFormat('italic'));
      setIsUnderline(selection.hasFormat('underline'));
      setIsStrikethrough(selection.hasFormat('strikethrough'));
      setIsCode(selection.hasFormat('code'));

      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === 'root'
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();

      if ($isHeadingNode(element)) {
        setBlockType(element.getTag());
      } else if ($isListNode(element)) {
        const parentList = $getNearestNodeOfType(anchorNode, ListNodeClass);
        setBlockType(parentList ? parentList.getListType() : 'paragraph');
      } else {
        setBlockType(element.getType());
      }

      // Check for link
      const parent = anchorNode.getParent();
      setIsLink($isLinkNode(parent) || $isLinkNode(anchorNode));
    }
  }, []);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        updateToolbar();
      });
    });
  }, [editor, updateToolbar]);

  const formatHeading = (headingSize: 'h2' | 'h3') => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        if (blockType === headingSize) {
          $setBlocksType(selection, () => $createParagraphNode());
        } else {
          $setBlocksType(selection, () => $createHeadingNode(headingSize));
        }
      }
    });
  };

  const formatQuote = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        if (blockType === 'quote') {
          $setBlocksType(selection, () => $createParagraphNode());
        } else {
          $setBlocksType(selection, () => $createQuoteNode());
        }
      }
    });
  };

  const formatList = (type: 'bullet' | 'number') => {
    if (blockType === type) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(
        type === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
        undefined,
      );
    }
  };

  const insertLink = () => {
    if (isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    } else {
      const url = prompt(t('rte.enter_url'));
      if (url) {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
      }
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border dark:border-border px-2 py-1.5 bg-surface dark:bg-surface-secondary rounded-t-lg">
      {/* Undo / Redo */}
      <Tooltip content={t('rte.undo')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant="tertiary"
          isDisabled={isDisabled}
          onPress={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
          aria-label={t('rte.undo')}
          className="min-w-8 w-8 h-8"
        >
          <Undo2 size={15} />
        </Button>
      </Tooltip>
      <Tooltip content={t('rte.redo')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant="tertiary"
          isDisabled={isDisabled}
          onPress={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
          aria-label={t('rte.redo')}
          className="min-w-8 w-8 h-8"
        >
          <Redo2 size={15} />
        </Button>
      </Tooltip>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Headings */}
      <Tooltip content={t('rte.heading_2')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant={blockType === 'h2' ? 'flat' : 'light'}
          color={blockType === 'h2' ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => formatHeading('h2')}
          aria-label={t('rte.heading_2')}
          className="min-w-8 w-8 h-8"
        >
          <Heading2 size={15} />
        </Button>
      </Tooltip>
      <Tooltip content={t('rte.heading_3')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant={blockType === 'h3' ? 'flat' : 'light'}
          color={blockType === 'h3' ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => formatHeading('h3')}
          aria-label={t('rte.heading_3')}
          className="min-w-8 w-8 h-8"
        >
          <Heading3 size={15} />
        </Button>
      </Tooltip>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Inline formatting */}
      <Tooltip content={t('rte.bold')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant={isBold ? 'flat' : 'light'}
          color={isBold ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
          aria-label={t('rte.bold')}
          className="min-w-8 w-8 h-8"
        >
          <Bold size={15} />
        </Button>
      </Tooltip>
      <Tooltip content={t('rte.italic')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant={isItalic ? 'flat' : 'light'}
          color={isItalic ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
          aria-label={t('rte.italic')}
          className="min-w-8 w-8 h-8"
        >
          <Italic size={15} />
        </Button>
      </Tooltip>
      <Tooltip content={t('rte.underline')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant={isUnderline ? 'flat' : 'light'}
          color={isUnderline ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
          aria-label={t('rte.underline')}
          className="min-w-8 w-8 h-8"
        >
          <Underline size={15} />
        </Button>
      </Tooltip>
      <Tooltip content={t('rte.strikethrough')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant={isStrikethrough ? 'flat' : 'light'}
          color={isStrikethrough ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')}
          aria-label={t('rte.strikethrough')}
          className="min-w-8 w-8 h-8"
        >
          <Strikethrough size={15} />
        </Button>
      </Tooltip>
      <Tooltip content={t('rte.inline_code')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant={isCode ? 'flat' : 'light'}
          color={isCode ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')}
          aria-label={t('rte.inline_code')}
          className="min-w-8 w-8 h-8"
        >
          <Code size={15} />
        </Button>
      </Tooltip>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Block formatting */}
      <Tooltip content={t('rte.bullet_list')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant={blockType === 'bullet' ? 'flat' : 'light'}
          color={blockType === 'bullet' ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => formatList('bullet')}
          aria-label={t('rte.bullet_list')}
          className="min-w-8 w-8 h-8"
        >
          <List size={15} />
        </Button>
      </Tooltip>
      <Tooltip content={t('rte.numbered_list')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant={blockType === 'number' ? 'flat' : 'light'}
          color={blockType === 'number' ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => formatList('number')}
          aria-label={t('rte.numbered_list')}
          className="min-w-8 w-8 h-8"
        >
          <ListOrdered size={15} />
        </Button>
      </Tooltip>
      <Tooltip content={t('rte.block_quote')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant={blockType === 'quote' ? 'flat' : 'light'}
          color={blockType === 'quote' ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={formatQuote}
          aria-label={t('rte.block_quote')}
          className="min-w-8 w-8 h-8"
        >
          <Quote size={15} />
        </Button>
      </Tooltip>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Link */}
      <Tooltip content={isLink ? t('rte.remove_link') : t('rte.insert_link')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant={isLink ? 'flat' : 'light'}
          color={isLink ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={insertLink}
          aria-label={isLink ? t('rte.remove_link') : t('rte.insert_link')}
          className="min-w-8 w-8 h-8"
        >
          <Link2 size={15} />
        </Button>
      </Tooltip>

      {/* Import Markdown */}
      {showMarkdownImport && (
        <>
          <Separator orientation="vertical" className="h-5 mx-1" />
          <Tooltip content={t('rte.import_markdown')} size="sm" delay={500}>
            <Button
              size="sm"
              variant="tertiary"
              isDisabled={isDisabled}
              onPress={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.md,.txt';
                input.onchange = async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  const html = await marked.parse(text);
                  editor.update(() => {
                    const parser = new DOMParser();
                    const dom = parser.parseFromString(html, 'text/html');
                    const nodes = $generateNodesFromDOM(editor, dom);
                    const root = $getRoot();
                    root.clear();
                    nodes.forEach((node) => root.append(node));
                  });
                };
                input.click();
              }}
              aria-label={t('rte.import_markdown')}
              className="h-8 gap-1 text-xs px-2"
              startContent={<FileDown size={14} />}
            >
              {t('rte.import_md')}
            </Button>
          </Tooltip>
        </>
      )}

      {/* HTML view */}
      {showHtmlSource && (
        <div className="ml-auto flex items-center">
          <Tooltip content={isHtmlView ? t('rte.html_view_off') : t('rte.html_view_tip')} size="sm" delay={500}>
            <Button
              size="sm"
              variant={isHtmlView ? 'flat' : 'light'}
              color={isHtmlView ? 'primary' : 'default'}
              isDisabled={isEditorDisabled}
              onPress={() => onToggleHtmlView?.(editor)}
              aria-pressed={isHtmlView}
              className="h-8 gap-1 text-xs px-2"
              startContent={<CodeXml size={14} />}
            >
              {isHtmlView ? t('rte.html_view_off') : t('rte.html_view')}
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── HTML Import Plugin ───────────────────────── */

/**
 * Plugin that loads initial HTML content into the editor.
 * Only runs once when the component mounts with initial content.
 */
function HtmlImportPlugin({ html }: { html: string }) {
  const [editor] = useLexicalComposerContext();
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current || !html) return;

    editor.update(() => {
      $setEditorHtml(editor, html);
    });

    hasLoadedRef.current = true;
  }, [editor, html]);

  return null;
}

/* ───────────────────────── Disabled Overlay Plugin ───────────────────────── */

function DisabledPlugin({ isDisabled }: { isDisabled?: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(!isDisabled);
  }, [editor, isDisabled]);

  return null;
}


/* ───────────────────────── Leaving the HTML view ───────────────────────── */

/**
 * Shown instead of switching straight back when the HTML holds something the
 * visual editor would remove. Lives inside the composer so "go back" can load
 * the HTML into the editor it belongs to.
 */
function LeaveHtmlViewPrompt({ onStay, onLeave }: { onStay: () => void; onLeave: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  const { t } = useTranslation('admin_editor');

  return (
    <Alert
      role="alert"
      color="warning"
      className="m-2"
      title={t('rte.html_leave_title')}
      description={
        <>
          {t('rte.html_leave_body')}
          <span className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onPress={onStay}>
              {t('rte.html_leave_stay')}
            </Button>
            <Button size="sm" variant="tertiary" onPress={() => onLeave(editor)}>
              {t('rte.html_leave_confirm')}
            </Button>
          </span>
        </>
      }
    />
  );
}

/* ───────────────────────── Main Component ───────────────────────── */

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  isDisabled = false,
  label,
  showMarkdownImport = false,
  showHtmlSource = false,
}: RichTextEditorProps) {
  const { t } = useTranslation('admin_editor');
  const editorPlaceholder = placeholder ?? t('rte.start_writing');

  // Content the visual editor cannot hold (an image, a table) opens as HTML,
  // so opening and saving a post never strips it without anyone choosing that.
  const [openedAsHtml] = useState(() => showHtmlSource && needsHtmlView(value));
  const [isHtmlView, setIsHtmlView] = useState(openedAsHtml);
  const [sourceHtml, setSourceHtml] = useState(() => (openedAsHtml ? tidyHtmlForSource(value) : ''));
  const [askBeforeLeaving, setAskBeforeLeaving] = useState(false);
  // Read by the Lexical change handler, which must not report the visual
  // editor's (stale or simplified) HTML while the HTML view owns the content.
  const isHtmlViewRef = useRef(openedAsHtml);

  const openHtmlView = () => {
    setSourceHtml(tidyHtmlForSource(value));
    isHtmlViewRef.current = true;
    setIsHtmlView(true);
  };

  const closeHtmlView = (editor: LexicalEditor) => {
    setAskBeforeLeaving(false);
    isHtmlViewRef.current = false;
    setIsHtmlView(false);
    // The change handler then reports what the visual editor kept.
    editor.update(() => {
      $setEditorHtml(editor, sourceHtml);
    });
  };

  const toggleHtmlView = (editor: LexicalEditor) => {
    if (!isHtmlView) {
      openHtmlView();
    } else if (needsHtmlView(sourceHtml)) {
      setAskBeforeLeaving(true);
    } else {
      closeHtmlView(editor);
    }
  };

  const handleSourceChange = (html: string) => {
    setSourceHtml(html);
    setAskBeforeLeaving(false);
    onChange(html);
  };

  const initialConfig = {
    namespace: 'NexusBlogEditor',
    theme: editorTheme,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode],
    onError: (error: Error) => {
      logError('Lexical editor error', error);
    },
    editable: !isDisabled,
  };

  const handleChange = useCallback(
    (_editorState: EditorState, editor: LexicalEditor) => {
      if (isHtmlViewRef.current) return;
      editor.read(() => {
        const html = $generateHtmlFromNodes(editor);
        // Lexical outputs <p><br></p> for empty content, normalize to empty string
        if (html === '<p><br></p>' || html === '<p></p>') {
          onChange('');
        } else {
          onChange(html);
        }
      });
    },
    [onChange],
  );

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <div
        className={`
          rounded-lg border-2 transition-colors
          border-border dark:border-border
          focus-within:border-accent
          ${isDisabled ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        <LexicalComposer initialConfig={initialConfig}>
          <ToolbarPlugin
            isDisabled={isDisabled}
            showMarkdownImport={showMarkdownImport}
            showHtmlSource={showHtmlSource}
            isHtmlView={isHtmlView}
            onToggleHtmlView={toggleHtmlView}
          />
          {isHtmlView && (
            <div>
              {askBeforeLeaving ? (
                <LeaveHtmlViewPrompt
                  onStay={() => setAskBeforeLeaving(false)}
                  onLeave={closeHtmlView}
                />
              ) : (
                openedAsHtml && (
                  <p className="border-b border-border px-3 py-2 text-xs text-muted">
                    {t('rte.html_opened_notice')}
                  </p>
                )
              )}
              <Suspense
                fallback={
                  <div role="status" aria-busy="true" aria-label={t('rte.html_label')} className="flex justify-center py-16">
                    <Spinner size="sm" />
                  </div>
                }
              >
                <HtmlSourceEditor
                  embedded
                  value={sourceHtml}
                  onChange={handleSourceChange}
                  isDisabled={isDisabled}
                  labels={{
                    label: label ? `${label} (${t('rte.html_label')})` : t('rte.html_label'),
                    hint: t('rte.html_hint'),
                    insertImage: t('rte.html_insert_image'),
                    uploadFailed: t('rte.html_image_upload_failed'),
                  }}
                />
              </Suspense>
            </div>
          )}
          <div className={isHtmlView ? 'hidden' : 'relative'}>
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="min-h-[400px] px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-foreground"
                  aria-label={label || undefined}
                />
              }
              placeholder={
                <div className="pointer-events-none absolute top-3 left-4 text-muted">
                  {editorPlaceholder}
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          </div>
          <HistoryPlugin />
          <ListPlugin />
          <LinkPlugin />
          <OnChangePlugin onChange={handleChange} />
          <HtmlImportPlugin html={value} />
          <DisabledPlugin isDisabled={isDisabled} />
        </LexicalComposer>
      </div>
    </div>
  );
}

export default RichTextEditor;
