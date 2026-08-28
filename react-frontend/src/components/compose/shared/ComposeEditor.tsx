// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ComposeEditor — Compact Lexical rich text editor for social post composition.
 * Lighter version of the admin RichTextEditor with a minimal toolbar:
 * Bold, Italic, Underline, Bullet list, Numbered list, Link insert/remove.
 * Outputs sanitized HTML and optionally reports plain text for character counting.
 *
 * Exposes an `editorRef` so parent components can programmatically insert text
 * (used by EmojiPicker and VoiceInput).
 */

import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { ListItemNode, ListNode } from '@lexical/list';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  $getRoot,
  type EditorState,
  type LexicalEditor,
} from 'lexical';
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { TOGGLE_LINK_COMMAND, $isLinkNode } from '@lexical/link';
import { $getNearestNodeOfType } from '@lexical/utils';
import { $isListNode, ListNode as ListNodeClass } from '@lexical/list';import Bold from 'lucide-react/icons/bold';
import Italic from 'lucide-react/icons/italic';
import Underline from 'lucide-react/icons/underline';
import List from 'lucide-react/icons/list';
import ListOrdered from 'lucide-react/icons/list-ordered';
import Link2 from 'lucide-react/icons/link-2';
import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@/components/ui';
import { logError } from '@/lib/logger';

/* ───────────────────────── Types ───────────────────────── */

export interface ComposeEditorHandle {
  /** Insert text at the current cursor position (or end of document) */
  insertText: (text: string) => void;
}

export interface ComposeEditorProps {
  /** Current HTML content */
  value: string;
  /** Callback when content changes (receives HTML string) */
  onChange: (html: string) => void;
  /** Callback with plain text content for character counting */
  onPlainTextChange?: (plainText: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Optional character limit (on plain text, not HTML) */
  maxLength?: number;
  /** Disable the editor */
  isDisabled?: boolean;
}

/* ───────────────────────── Theme ───────────────────────── */

const composeEditorTheme = {
  paragraph: 'mb-1 leading-relaxed text-[var(--text-primary)]',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
  },
  list: {
    ul: 'list-disc pl-5 mb-2',
    ol: 'list-decimal pl-5 mb-2',
    listitem: 'mb-0.5',
    nested: {
      listitem: 'list-none',
    },
  },
  link: 'text-[var(--color-primary)] underline cursor-pointer',
};

/** Lexical node types used by this editor */
const EDITOR_NODES = [ListNode, ListItemNode, LinkNode, AutoLinkNode];

/* ───────────────────────── Toolbar ───────────────────────── */

function ComposeToolbar({ isDisabled }: { isDisabled?: boolean }) {
  const [editor] = useLexicalComposerContext();
  const { t } = useTranslation('common');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isLink, setIsLink] = useState(false);
  const [blockType, setBlockType] = useState<string>('paragraph');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      setIsBold(selection.hasFormat('bold'));
      setIsItalic(selection.hasFormat('italic'));
      setIsUnderline(selection.hasFormat('underline'));

      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === 'root'
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();

      if ($isListNode(element)) {
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
      setLinkUrl('https://');
      setShowLinkInput(true);
      // Focus the input after it renders
      requestAnimationFrame(() => {
        linkInputRef.current?.focus();
        linkInputRef.current?.select();
      });
    }
  };

  const confirmLink = () => {
    const trimmed = linkUrl.trim();
    if (trimmed && trimmed !== 'https://') {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, trimmed);
    }
    setShowLinkInput(false);
    setLinkUrl('');
  };

  const cancelLink = () => {
    setShowLinkInput(false);
    setLinkUrl('');
  };

  const handleLinkKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmLink();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelLink();
    }
  };

  return (
    <div className="bg-[var(--surface-elevated)] border-b border-[var(--border-default)] rounded-t-lg">
      <div className="flex items-center gap-0.5 px-2 py-1">
        {/* Bold */}
        <Button
          isIconOnly
          size="sm"
          variant={isBold ? 'flat' : 'light'}
          color={isBold ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
          aria-label={t('aria.bold')}
          aria-pressed={isBold}
          className="min-w-9 w-9 h-9"
        >
          <Bold size={16} />
        </Button>

        {/* Italic */}
        <Button
          isIconOnly
          size="sm"
          variant={isItalic ? 'flat' : 'light'}
          color={isItalic ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
          aria-label={t('aria.italic')}
          aria-pressed={isItalic}
          className="min-w-9 w-9 h-9"
        >
          <Italic size={16} />
        </Button>

        {/* Underline */}
        <Button
          isIconOnly
          size="sm"
          variant={isUnderline ? 'flat' : 'light'}
          color={isUnderline ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
          aria-label={t('aria.underline')}
          aria-pressed={isUnderline}
          className="min-w-9 w-9 h-9"
        >
          <Underline size={16} />
        </Button>

        {/* Bullet list */}
        <Button
          isIconOnly
          size="sm"
          variant={blockType === 'bullet' ? 'flat' : 'light'}
          color={blockType === 'bullet' ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => formatList('bullet')}
          aria-label={t('aria.bullet_list')}
          aria-pressed={blockType === 'bullet'}
          className="min-w-9 w-9 h-9"
        >
          <List size={16} />
        </Button>

        {/* Numbered list */}
        <Button
          isIconOnly
          size="sm"
          variant={blockType === 'number' ? 'flat' : 'light'}
          color={blockType === 'number' ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={() => formatList('number')}
          aria-label={t('aria.numbered_list')}
          aria-pressed={blockType === 'number'}
          className="min-w-9 w-9 h-9"
        >
          <ListOrdered size={16} />
        </Button>

        {/* Link */}
        <Button
          isIconOnly
          size="sm"
          variant={isLink ? 'flat' : 'light'}
          color={isLink ? 'primary' : 'default'}
          isDisabled={isDisabled}
          onPress={insertLink}
          aria-label={isLink ? t('compose.aria_remove_link') : t('compose.aria_insert_link')}
          aria-pressed={isLink}
          className="min-w-9 w-9 h-9"
        >
          <Link2 size={16} />
        </Button>
      </div>

      {/* Inline link URL input */}
      {showLinkInput && (
        <div className="flex items-center gap-1 px-2 pb-1.5">
          <Input
            ref={linkInputRef}
            size="sm"
            placeholder={t('compose.placeholder_url')}
            value={linkUrl}
            onValueChange={setLinkUrl}
            onKeyDown={handleLinkKeyDown}
            aria-label={t('aria.link_url')}
            classNames={{
              input: 'bg-transparent text-[var(--text-primary)] text-xs',
              inputWrapper: 'bg-[var(--surface-default)] border-[var(--border-default)] h-8',
            }}
          />
          <Button
            isIconOnly
            size="sm"
            variant="secondary"
            onPress={confirmLink}
            aria-label={t('aria.confirm_link')}
            className="size-8 min-h-8 text-success"
          >
            <Check size={14} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="danger-soft"
            onPress={cancelLink}
            aria-label={t('aria.cancel_link')}
            className="size-8 min-h-8"
          >
            <X size={14} />
          </Button>
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

/* ───────────────────────── Insert Text Plugin ───────────────────────── */

/**
 * Plugin that exposes the Lexical editor for programmatic text insertion.
 * Used by parent components (via ref) to insert emoji or voice transcripts
 * at the current cursor position.
 */
function InsertTextPlugin({
  onEditorReady,
}: {
  onEditorReady: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    onEditorReady(editor);
  }, [editor, onEditorReady]);

  return null;
}

/* ───────────────────────── Error Boundary ───────────────────────── */

function ComposeEditorErrorBoundary({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/* ───────────────────────── Main Component ───────────────────────── */

export function ComposeEditor(
  {
    value,
    onChange,
    onPlainTextChange,
    placeholder = 'What would you like to share?',
    maxLength,
    isDisabled = false,
    ref,
  }: ComposeEditorProps & { ref?: Ref<ComposeEditorHandle> },
) {
    const { t } = useTranslation('common');
    const editorRef = useRef<LexicalEditor | null>(null);

    const initialConfig = useMemo(
      () => ({
        namespace: 'NexusComposeEditor',
        theme: composeEditorTheme,
        nodes: EDITOR_NODES,
        onError: (error: Error) => {
          logError('ComposeEditor error', error);
        },
        editable: !isDisabled,
      }),
      [isDisabled],
    );

    const handleEditorReady = useCallback((editor: LexicalEditor) => {
      editorRef.current = editor;
    }, []);

    // Expose insertText via ref for parent components (emoji, voice)
    useImperativeHandle(
      ref,
      () => ({
        insertText: (text: string) => {
          const editor = editorRef.current;
          if (!editor) return;

          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              // Insert at current cursor position
              selection.insertText(text);
            } else {
              // No active selection — move focus to end and insert
              const root = $getRoot();
              root.selectEnd();
              const newSelection = $getSelection();
              if ($isRangeSelection(newSelection)) {
                newSelection.insertText(text);
              }
            }
          });
        },
      }),
      [],
    );

    const handleChange = useCallback(
      (_editorState: EditorState, editor: LexicalEditor) => {
        editor.read(() => {
          const html = $generateHtmlFromNodes(editor);
          const root = $getRoot();
          const plainText = root.getTextContent();

          // Lexical outputs <p><br></p> for empty content, normalize to empty string
          if (html === '<p><br></p>' || html === '<p></p>') {
            onChange('');
            onPlainTextChange?.('');
          } else {
            onChange(html);
            onPlainTextChange?.(plainText);
          }
        });
      },
      [onChange, onPlainTextChange],
    );

    return (
      <div
        className={`
          border border-[var(--border-default)] rounded-lg
          focus-within:border-[var(--color-primary)] transition-colors
          ${isDisabled ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        <LexicalComposer initialConfig={initialConfig}>
          <ComposeToolbar isDisabled={isDisabled} />
          <div className="relative">
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="min-h-[120px] max-h-[300px] overflow-y-auto px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-sm text-[var(--text-primary)]"
                  aria-label={t('aria.post_content_editor')}
                />
              }
              placeholder={
                <div className="pointer-events-none absolute top-2 left-3 text-sm text-[var(--text-subtle)]">
                  {placeholder}
                </div>
              }
              ErrorBoundary={ComposeEditorErrorBoundary}
            />
          </div>
          <HistoryPlugin />
          <ListPlugin />
          <LinkPlugin />
          <OnChangePlugin onChange={handleChange} />
          <HtmlImportPlugin html={value} />
          <DisabledPlugin isDisabled={isDisabled} />
          <InsertTextPlugin onEditorReady={handleEditorReady} />
        </LexicalComposer>

        {/* Character count indicator */}
        {maxLength !== undefined && (
          <MaxLengthIndicator maxLength={maxLength} />
        )}
      </div>
    );
}

/* ───────────────────────── Max Length Indicator ───────────────────────── */

/**
 * Visual indicator for character limit. Reads plain text length from the editor.
 * Rendered outside the LexicalComposer, so it receives maxLength as a prop
 * and the parent is responsible for tracking plain text length externally.
 *
 * Note: This is a placeholder rendered in the border area.
 * The parent component should use onPlainTextChange to track length
 * and conditionally show warnings.
 */
function MaxLengthIndicator({ maxLength }: { maxLength: number }) {
  const { t } = useTranslation('common');
  return (
    <div className="px-3 py-1 text-right">
      <span className="text-xs text-[var(--text-subtle)]">
        {t('max_characters', { count: maxLength })}
      </span>
    </div>
  );
}

export default ComposeEditor;
