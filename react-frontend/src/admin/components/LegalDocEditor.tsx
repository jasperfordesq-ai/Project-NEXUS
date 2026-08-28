// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * LegalDocEditor — WYSIWYG editor for legal documents.
 *
 * Split-pane layout: left = Lexical rich text editor, right = live preview rendered
 * via <CustomLegalDocument>, which is exactly what members see. The preview updates
 * reactively on every editor change.
 *
 * Extends the existing RichTextEditor pattern with:
 * - LegalNoticeNode for <div class="legal-notice"> amber callout roundtrip
 * - "Notice Box" toolbar button (Megaphone icon, amber when cursor is inside a notice)
 * - Toggle between split view (editor + live preview) and editor-only view
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  $getSelection, $isRangeSelection, $createParagraphNode, $createTextNode, FORMAT_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND, COMMAND_PRIORITY_NORMAL, SELECTION_CHANGE_COMMAND, BLUR_COMMAND, type EditorState, type LexicalEditor, $getRoot, } from 'lexical';
import {
  INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND, } from '@lexical/list';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode, $createQuoteNode, $isHeadingNode } from '@lexical/rich-text';
import { TOGGLE_LINK_COMMAND, $isLinkNode } from '@lexical/link';
import {
  $getNearestNodeOfType, $findMatchingParent, $insertNodeToNearestRoot, } from '@lexical/utils';
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
import Megaphone from 'lucide-react/icons/megaphone';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import { useTranslation } from 'react-i18next';
import { CustomLegalDocument } from '@/components/legal/CustomLegalDocument';
import type { LegalDocument } from '@/hooks/useLegalDocument';
import {
  LegalNoticeNode,
  INSERT_LEGAL_NOTICE_COMMAND,
  $createLegalNoticeNode,
  $isLegalNoticeNode,
} from './LegalNoticeNode';
import { Button, Tooltip } from '@/components/ui';
import { logError } from '@/lib/logger';

/* ───────────────────────── Theme ───────────────────────── */

const editorTheme = {
  paragraph: 'mb-2 leading-relaxed',
  heading: {
    h2: 'text-2xl font-bold mt-6 mb-3',
    h3: 'text-xl font-semibold mt-4 mb-2',
    h4: 'text-lg font-semibold mt-3 mb-2',
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

function LegalDocToolbarPlugin({ isDisabled }: { isDisabled?: boolean }) {
  const [editor] = useLexicalComposerContext();
  const { t } = useTranslation('admin_legal_editor');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isCode, setIsCode] = useState(false);
  const [isLink, setIsLink] = useState(false);
  const [blockType, setBlockType] = useState<string>('paragraph');
  const [isInsideLegalNotice, setIsInsideLegalNotice] = useState(false);

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

      const parent = anchorNode.getParent();
      setIsLink($isLinkNode(parent) || $isLinkNode(anchorNode));

      // Check if cursor is inside a LegalNoticeNode (at any nesting depth)
      const legalNoticeParent = $findMatchingParent(anchorNode, $isLegalNoticeNode);
      setIsInsideLegalNotice(!!legalNoticeParent);
    } else {
      // No range selection (focus lost, or non-range selection type) — reset all
      // state so the toolbar doesn't show stale formatting after blur.
      setIsBold(false);
      setIsItalic(false);
      setIsUnderline(false);
      setIsStrikethrough(false);
      setIsCode(false);
      setIsLink(false);
      setBlockType('paragraph');
      setIsInsideLegalNotice(false);
    }
  }, []);

  useEffect(() => {
    // registerUpdateListener fires on content changes. SELECTION_CHANGE_COMMAND
    // fires on cursor moves and focus/blur so the toolbar doesn't show stale state
    // (e.g. Bold still lit after moving focus to a different field).
    const unregisterUpdate = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => updateToolbar());
    });
    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        updateToolbar();
        return false;
      },
      COMMAND_PRIORITY_NORMAL,
    );
    // BLUR_COMMAND fires when the editor loses focus. SELECTION_CHANGE_COMMAND may
    // not fire on blur if Lexical preserves the selection internally for focus return.
    // Belt-and-suspenders: explicitly reset toolbar state on blur so the admin
    // doesn't see stale formatting highlights after clicking to another form field.
    const unregisterBlur = editor.registerCommand(
      BLUR_COMMAND,
      () => {
        setIsBold(false);
        setIsItalic(false);
        setIsUnderline(false);
        setIsStrikethrough(false);
        setIsCode(false);
        setIsLink(false);
        setBlockType('paragraph');
        setIsInsideLegalNotice(false);
        return false;
      },
      COMMAND_PRIORITY_NORMAL,
    );
    return () => {
      unregisterUpdate();
      unregisterSelection();
      unregisterBlur();
    };
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
      <Tooltip
        content={isLink ? t('rte.remove_link') : t('rte.insert_link')}
        size="sm"
        delay={500}
      >
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

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Notice Box — amber when cursor is inside a legal-notice block */}
      <Tooltip content={t('rte.notice_box')} size="sm" delay={500}>
        <Button
          isIconOnly
          size="sm"
          variant={isInsideLegalNotice ? 'flat' : 'light'}
          isDisabled={isDisabled}
          onPress={() => editor.dispatchCommand(INSERT_LEGAL_NOTICE_COMMAND, undefined)}
          aria-label={t('rte.notice_box')}
          className={`min-w-8 w-8 h-8 ${isInsideLegalNotice ? 'text-amber-500 bg-amber-500/10' : ''}`}
        >
          <Megaphone size={15} />
        </Button>
      </Tooltip>
    </div>
  );
}

/* ───────────────────────── Legal Notice Plugin ───────────────────────── */

/**
 * Registers the INSERT_LEGAL_NOTICE_COMMAND handler.
 * Creates a LegalNoticeNode with a placeholder h4 heading and paragraph,
 * and inserts it at the nearest root-level position relative to the current selection.
 */
function LegalNoticePlugin() {
  const [editor] = useLexicalComposerContext();
  const { t } = useTranslation('admin_legal_editor');

  useEffect(() => {
    return editor.registerCommand(
      INSERT_LEGAL_NOTICE_COMMAND,
      () => {
        const noticeNode = $createLegalNoticeNode();
        const heading = $createHeadingNode('h4');
        heading.append(
          $createTextNode(t('rte.notice_title_placeholder')),
        );
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createTextNode(t('rte.notice_body_placeholder')),
        );
        noticeNode.append(heading, paragraph);

        // If the cursor is already inside a LegalNoticeNode, $insertNodeToNearestRoot
        // would split it at the cursor position (destructive — cuts content in two).
        // Instead, insert the new notice as a sibling directly after the existing one.
        // If there's no selection at all (toolbar clicked before focusing editor),
        // fall back to appending at the document root.
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const anchorNode = selection.anchor.getNode();
          const existingNotice = $findMatchingParent(anchorNode, $isLegalNoticeNode);
          if (existingNotice) {
            existingNotice.insertAfter(noticeNode);
          } else {
            $insertNodeToNearestRoot(noticeNode);
          }
        } else {
          $getRoot().append(noticeNode);
        }
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    );
  }, [editor, t]);


  return null;
}

/* ───────────────────────── HTML Import Plugin ───────────────────────── */

function HtmlImportPlugin({ html }: { html: string }) {
  const [editor] = useLexicalComposerContext();
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current || !html) return;

    editor.update(() => {
      const parser = new DOMParser();
      const dom = parser.parseFromString(html, 'text/html');
      const nodes = $generateNodesFromDOM(editor, dom);
      const root = $getRoot();
      root.clear();
      nodes.forEach((node) => root.append(node));
    });

    hasLoadedRef.current = true;
  }, [editor, html]);

  return null;
}

/* ───────────────────────── Disabled Plugin ───────────────────────── */

function DisabledPlugin({ isDisabled }: { isDisabled?: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(!isDisabled);
  }, [editor, isDisabled]);

  return null;
}

/* ───────────────────────── Main Component ───────────────────────── */

interface LegalDocEditorProps {
  /** Current HTML content */
  value: string;
  /** Callback when content changes (receives HTML string) */
  onChange: (html: string) => void;
  /** Disable editing (e.g. while the form is submitting) */
  disabled?: boolean;
  /** Validation error message shown below the editor */
  errorMessage?: string;
}

export function LegalDocEditor({ value, onChange, disabled = false, errorMessage }: LegalDocEditorProps) {
  const { t } = useTranslation('admin_legal_editor');
  const [showPreview, setShowPreview] = useState(false);

  // Internal mirror of the current HTML — updated on every editor change so the
  // live preview stays in sync without needing to re-import into Lexical.
  const [currentHtml, setCurrentHtml] = useState(value);

  // Sync the preview when the parent updates `value` from outside (e.g. edit mode
  // loading: LegalDocVersionForm's useEffect fires after mount and sets content from
  // editVersion, so the initial useState(value) would be stale empty string).
  // When the user types, onChange → parent → new value → setCurrentHtml(same string) →
  // React bails out (no-op), so there is no loop.
  useEffect(() => {
    setCurrentHtml(value);
  }, [value]);

  // LexicalComposer only reads initialConfig once — memoised to make that explicit
  // and avoid any reference-equality surprises with the nodes array.
  const initialConfig = useMemo(() => ({
    namespace: 'NexusLegalDocEditor',
    theme: editorTheme,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, LegalNoticeNode],
    onError: (error: Error) => {
      logError('LegalDocEditor error', error);
    },
    editable: !disabled,
  // disabled intentionally not in deps: initial editability only; DisabledPlugin handles changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const handleChange = useCallback(
    (editorState: EditorState, editor: LexicalEditor) => {
      // Read from the specific snapshot that triggered the update, not from
      // whatever the editor's current state happens to be at call time —
      // the two can diverge under concurrent Lexical updates.
      // Pass { editor } so node registrations (including LegalNoticeNode) are
      // available to $generateHtmlFromNodes during the read.
      editorState.read(() => {
        const html = $generateHtmlFromNodes(editor);
        const normalised = html === '<p><br></p>' || html === '<p></p>' ? '' : html;
        setCurrentHtml(normalised);
        onChange(normalised);
      }, { editor });
    },
    [onChange],
  );

  // Mock LegalDocument object that feeds the live preview.
  // Content is updated reactively via currentHtml on every editor change.
  const previewDoc: LegalDocument = useMemo(
    () => ({
      id: 0,
      document_id: 0,
      type: 'terms',
      title: t('rte.preview_title_placeholder'),
      content: currentHtml,
      version_number: '–',
      effective_date: '',
      summary_of_changes: null,
      has_previous_versions: false,
    }),
    [currentHtml, t],
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Label row with preview toggle */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">
          {t('rte.content_html')}
          <span className="text-danger ml-0.5">*</span>
        </label>
        <Tooltip
          content={showPreview
            ? t('rte.editor_only')
            : t('rte.split_view')}
          size="sm"
          delay={300}
        >
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => setShowPreview((v) => !v)}
            aria-label={showPreview
              ? t('rte.editor_only')
              : t('rte.split_view')}
            className="min-w-8 w-8 h-8"
          >
            {showPreview ? <EyeOff size={15} /> : <Eye size={15} />}
          </Button>
        </Tooltip>
      </div>

      {/* Editor + optional preview */}
      <div className={`flex gap-4 items-start ${showPreview ? 'flex-col lg:flex-row' : 'flex-col'}`}>
        {/* Lexical editor */}
        <div className={showPreview ? 'w-full lg:w-1/2' : 'w-full'}>
          <div
            className={`
              rounded-lg border-2 transition-colors
              ${errorMessage
                ? 'border-danger'
                : 'border-border dark:border-border focus-within:border-accent'}
              ${disabled ? 'opacity-50 pointer-events-none' : ''}
            `}
          >
            <LexicalComposer initialConfig={initialConfig}>
              <LegalDocToolbarPlugin isDisabled={disabled} />
              <div className="relative">
                <RichTextPlugin
                  contentEditable={
                    <ContentEditable
                      className="min-h-[320px] sm:min-h-[400px] px-4 py-3 outline-none text-foreground rounded focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
                      aria-label={t('rte.content_html')}
                    />
                  }
                  placeholder={
                    <div className="pointer-events-none absolute top-3 left-4 text-muted">
                      {t('rte.content_placeholder')}
                    </div>
                  }
                  ErrorBoundary={LexicalErrorBoundary}
                />
              </div>
              <HistoryPlugin />
              <ListPlugin />
              <LinkPlugin />
              {/* ignoreSelectionChange: skip serialisation on cursor-only moves.
                  $generateHtmlFromNodes on a 46KB document on every arrow key
                  is expensive; content hasn't changed so there's nothing to emit. */}
              <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
              <HtmlImportPlugin html={value} />
              <DisabledPlugin isDisabled={disabled} />
              <LegalNoticePlugin />
            </LexicalComposer>
          </div>
        </div>

        {/* Live preview — pointer-events-none prevents accidental navigation via
            the Contact Us / version-history links that CustomLegalDocument renders */}
        {showPreview && (
          <div className="w-full lg:w-1/2 overflow-y-auto max-h-[600px] rounded-lg border border-border dark:border-border bg-[var(--color-surface)] px-4 pt-3 pb-6">
            <p className="text-[0.7rem] font-semibold text-muted uppercase tracking-wider mb-4 sticky top-0 bg-[var(--color-surface)] py-1">
              {t('rte.preview')}
            </p>
            {currentHtml ? (
              <div className="pointer-events-none">
                <CustomLegalDocument document={previewDoc} accentColor="blue" />
              </div>
            ) : (
              <p className="text-sm text-muted italic">
                {t('rte.content_placeholder')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Validation error */}
      {errorMessage && (
        <p className="text-sm text-danger">{errorMessage}</p>
      )}

      {/* Helper description */}
      <p className="text-xs text-muted">
        {t('rte.content_helper')}
      </p>
    </div>
  );
}

export default LegalDocEditor;
