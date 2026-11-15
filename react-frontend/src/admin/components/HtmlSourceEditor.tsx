// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * HtmlSourceEditor - verbatim raw-HTML editor (CodeMirror 6).
 *
 * This mode lets admins paste or author designed HTML without round-tripping
 * through Lexical. CodeMirror holds the document as a plain string, so tables,
 * inline styles, custom sections, and pasted page fragments stay intact.
 * Lazy-loaded so the editor chunk only ships when HTML mode is opened.
 */

import { useRef, useSyncExternalStore } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { html as htmlLang } from '@codemirror/lang-html';
import { EditorView } from '@codemirror/view';
import { InsertImageButton } from './InsertImageButton';

interface HtmlSourceEditorProps {
  value: string;
  onChange: (html: string) => void;
  isDisabled?: boolean;
  labels: {
    label: string;
    hint: string;
    insertImage: string;
    uploadFailed: string;
  };
  /**
   * Drawn inside another editor's frame (RichTextEditor's HTML view): no label
   * and no border of its own, because the host already has both.
   */
  embedded?: boolean;
}

// Theme mapped to the project's CSS tokens so it respects light/dark mode
// without leaking global CSS.
const nexusTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
    backgroundColor: 'var(--color-surface, #fff)',
    color: 'var(--color-foreground, #111)',
    borderRadius: '0 0 0.5rem 0.5rem',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface-secondary, #f5f5f5)',
    color: 'var(--color-muted, #888)',
    border: 'none',
  },
  '.cm-content': { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  '&.cm-focused': { outline: 'none' },
});

/**
 * Is the site showing its dark theme? Read from the <html> element, where
 * ThemeContext puts it, so the editor follows a theme change while it is open
 * and needs no provider around it.
 */
function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  return () => observer.disconnect();
}

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function HtmlSourceEditor({ value, onChange, isDisabled, labels, embedded = false }: HtmlSourceEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  // CodeMirror's own light theme paints a white page whatever the site theme
  // is, which left the site's pale dark-mode text on white. Its dark theme
  // brings a dark page and code colours that can be read on it.
  const isDark = useSyncExternalStore(subscribeToTheme, isDarkTheme, () => false);

  const insertAtCursor = (snippet: string) => {
    const view = cmRef.current?.view;
    if (!view) {
      // Fallback: append if the editor view isn't ready.
      onChange(value + snippet);
      return;
    }
    view.dispatch(view.state.replaceSelection(snippet));
    view.focus();
  };

  return (
    <div className={embedded ? undefined : 'flex flex-col gap-1.5'}>
      {!embedded && (
        <label className="text-sm font-medium text-foreground">
          {labels.label}
        </label>
      )}
      <div
        className={
          embedded
            ? 'overflow-hidden rounded-b-lg'
            : 'rounded-lg border-2 border-border focus-within:border-accent transition-colors overflow-hidden'
        }
      >
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
          <InsertImageButton
            onInsert={insertAtCursor}
            isDisabled={isDisabled}
            labels={{
              insertImage: labels.insertImage,
              uploadFailed: labels.uploadFailed,
            }}
          />
          <span className="ml-auto text-xs text-muted">
            {labels.hint}
          </span>
        </div>
        <CodeMirror
          ref={cmRef}
          value={value}
          onChange={onChange}
          editable={!isDisabled}
          readOnly={isDisabled}
          height="400px"
          theme={isDark ? 'dark' : 'light'}
          extensions={[htmlLang(), EditorView.lineWrapping, nexusTheme]}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: !isDisabled,
            autocompletion: true,
          }}
          aria-label={labels.label}
        />
      </div>
    </div>
  );
}

export default HtmlSourceEditor;
