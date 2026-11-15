// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

// ─── Stub Lexical internals ───────────────────────────────────────────────────
// Lexical relies on a real DOM environment and extensive plugin setup that
// does not work reliably under jsdom. We stub the react adapter layer so the
// component can mount and we can test the public surface (label, editable
// region, toolbar buttons, onChange).

const { mockOnChange, mockDispatchCommand, mockUpdate, mockRegisterUpdateListener } =
  vi.hoisted(() => ({
    mockOnChange: vi.fn(),
    mockDispatchCommand: vi.fn(),
    mockUpdate: vi.fn((cb: () => void) => cb()),
    mockRegisterUpdateListener: vi.fn(() => () => {}),
  }));

const mockEditor = {
  dispatchCommand: mockDispatchCommand,
  update: mockUpdate,
  registerUpdateListener: mockRegisterUpdateListener,
  setEditable: vi.fn(),
  read: vi.fn((cb: () => void) => cb()),
};

vi.mock('@lexical/react/LexicalComposer', () => ({
  LexicalComposer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@lexical/react/LexicalRichTextPlugin', () => ({
  RichTextPlugin: ({
    contentEditable,
    placeholder,
  }: {
    contentEditable: React.ReactNode;
    placeholder: React.ReactNode;
    ErrorBoundary: unknown;
  }) => (
    <div data-testid="rich-text-plugin">
      {contentEditable}
      {placeholder}
    </div>
  ),
}));

vi.mock('@lexical/react/LexicalContentEditable', () => ({
  ContentEditable: ({
    className,
    'aria-label': ariaLabel,
  }: {
    className?: string;
    'aria-label'?: string;
  }) => (
    <div
      data-testid="content-editable"
      contentEditable="true"
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      className={className}
    />
  ),
}));

vi.mock('@lexical/react/LexicalHistoryPlugin', () => ({ HistoryPlugin: () => null }));
vi.mock('@lexical/react/LexicalListPlugin', () => ({ ListPlugin: () => null }));
vi.mock('@lexical/react/LexicalLinkPlugin', () => ({ LinkPlugin: () => null }));
vi.mock('@lexical/react/LexicalOnChangePlugin', () => ({
  OnChangePlugin: ({ onChange }: { onChange: (...args: unknown[]) => void }) => {
    // expose the onChange callback for testing
    return (
      <div
        data-testid="on-change-plugin"
        data-has-onchange={typeof onChange === 'function' ? 'true' : 'false'}
        onClick={() => onChange({}, mockEditor)}
      />
    );
  },
}));
vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mockEditor],
}));
vi.mock('@lexical/react/LexicalErrorBoundary', () => ({
  LexicalErrorBoundary: () => null,
}));
vi.mock('@lexical/html', () => ({
  $generateHtmlFromNodes: vi.fn(() => '<p>Hello</p>'),
  $generateNodesFromDOM: vi.fn(() => []),
}));
vi.mock('@lexical/list', () => ({
  ListItemNode: class {},
  ListNode: class {},
  $isListNode: vi.fn(() => false),
  INSERT_ORDERED_LIST_COMMAND: 'INSERT_ORDERED_LIST',
  INSERT_UNORDERED_LIST_COMMAND: 'INSERT_UNORDERED_LIST',
  REMOVE_LIST_COMMAND: 'REMOVE_LIST',
}));
vi.mock('@lexical/link', () => ({
  AutoLinkNode: class {},
  LinkNode: class {},
  TOGGLE_LINK_COMMAND: 'TOGGLE_LINK',
  $isLinkNode: vi.fn(() => false),
}));
vi.mock('@lexical/rich-text', () => ({
  HeadingNode: class {},
  QuoteNode: class {},
  $createHeadingNode: vi.fn(() => ({})),
  $createQuoteNode: vi.fn(() => ({})),
  $isHeadingNode: vi.fn(() => false),
}));
vi.mock('@lexical/selection', () => ({
  $setBlocksType: vi.fn(),
}));
vi.mock('@lexical/utils', () => ({
  $getNearestNodeOfType: vi.fn(() => null),
}));
vi.mock('lexical', () => ({
  $getSelection: vi.fn(() => null),
  $isRangeSelection: vi.fn(() => false),
  $createParagraphNode: vi.fn(() => ({})),
  $getRoot: vi.fn(() => ({ clear: vi.fn(), append: vi.fn(), getChildrenSize: vi.fn(() => 1) })),
  $isElementNode: vi.fn(() => true),
  $isDecoratorNode: vi.fn(() => false),
  $isTextNode: vi.fn(() => false),
  FORMAT_TEXT_COMMAND: 'FORMAT_TEXT',
  UNDO_COMMAND: 'UNDO',
  REDO_COMMAND: 'REDO',
}));
// The HTML view's editor is CodeMirror, which jsdom cannot lay out. A textarea
// stands in for it and shows which props the editor handed over.
vi.mock('./HtmlSourceEditor', () => ({
  HtmlSourceEditor: ({
    value,
    onChange,
    embedded,
    labels,
  }: {
    value: string;
    onChange: (html: string) => void;
    embedded?: boolean;
    labels: { label: string };
  }) => (
    <textarea
      data-testid="html-source"
      data-embedded={embedded ? 'true' : 'false'}
      aria-label={labels.label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock('marked', () => ({
  marked: { parse: vi.fn(async (text: string) => `<p>${text}</p>`) },
}));

// ─── i18n mock ────────────────────────────────────────────────────────────────
// useTranslation is already mocked by the test-utils setup; no additional mock needed

// ─────────────────────────────────────────────────────────────────────────────
describe('RichTextEditor', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} />);
    expect(screen.getByTestId('rich-text-plugin')).toBeInTheDocument();
  });

  it('renders a contenteditable region', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} />);
    const editable = screen.getByTestId('content-editable');
    expect(editable).toBeInTheDocument();
    expect(editable.getAttribute('contenteditable')).toBe('true');
  });

  it('renders toolbar buttons (bold, italic, etc.)', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} />);

    const buttons = screen.getAllByRole('button');
    // Should have at least undo/redo + bold/italic/underline/strikethrough + list buttons
    expect(buttons.length).toBeGreaterThan(5);
  });

  it('renders with a label when provided', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} label="Article Content" />);
    expect(screen.getByText('Article Content')).toBeInTheDocument();
  });

  it('renders placeholder text', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} placeholder="Start writing here..." />);
    expect(screen.getByText('Start writing here...')).toBeInTheDocument();
  });

  it('has an aria-label on the editable region when label is provided', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} label="My Editor" />);
    const editable = screen.getByTestId('content-editable');
    // ContentEditable passes aria-label={label}
    expect(editable.getAttribute('aria-label')).toBe('My Editor');
  });

  it('renders Undo and Redo toolbar buttons', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} />);

    const buttons = screen.getAllByRole('button');
    const undoBtn = buttons.find((b) => b.getAttribute('aria-label')?.toLowerCase().includes('undo'));
    const redoBtn = buttons.find((b) => b.getAttribute('aria-label')?.toLowerCase().includes('redo'));
    expect(undoBtn).toBeDefined();
    expect(redoBtn).toBeDefined();
  });

  it('renders bold toolbar button', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} />);

    const boldBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('bold'),
    );
    expect(boldBtn).toBeDefined();
  });

  it('renders italic toolbar button', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} />);

    const italicBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('italic'),
    );
    expect(italicBtn).toBeDefined();
  });

  it('dispatches FORMAT_TEXT_COMMAND when bold button is pressed', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} />);

    const boldBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('bold'),
    );
    if (boldBtn) {
      fireEvent.click(boldBtn);
      expect(mockDispatchCommand).toHaveBeenCalledWith('FORMAT_TEXT', 'bold');
    }
  });

  it('dispatches UNDO_COMMAND when Undo button is pressed', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} />);

    const undoBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('undo'),
    );
    if (undoBtn) {
      fireEvent.click(undoBtn);
      expect(mockDispatchCommand).toHaveBeenCalledWith('UNDO', undefined);
    }
  });

  it('dispatches REDO_COMMAND when Redo button is pressed', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} />);

    const redoBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('redo'),
    );
    if (redoBtn) {
      fireEvent.click(redoBtn);
      expect(mockDispatchCommand).toHaveBeenCalledWith('REDO', undefined);
    }
  });

  it('wires up OnChangePlugin with an onChange handler', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} onChange={mockOnChange} />);

    const onChangePlug = screen.getByTestId('on-change-plugin');
    expect(onChangePlug.getAttribute('data-has-onchange')).toBe('true');
  });

  it('applies disabled styling and calls setEditable(false) when isDisabled=true', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} isDisabled={true} />);

    // DisabledPlugin calls editor.setEditable(!isDisabled)
    expect(mockEditor.setEditable).toHaveBeenCalledWith(false);
  });

  it('does not show Import Markdown button when showMarkdownImport is false', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} showMarkdownImport={false} />);

    const mdBtn = screen.getAllByRole('button').find(
      (b) =>
        b.getAttribute('aria-label')?.toLowerCase().includes('markdown') ||
        b.textContent?.toLowerCase().includes('md'),
    );
    expect(mdBtn).toBeUndefined();
  });

  it('shows Import Markdown button when showMarkdownImport is true', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} showMarkdownImport={true} />);

    const mdBtn = screen.getAllByRole('button').find(
      (b) =>
        b.getAttribute('aria-label')?.toLowerCase().includes('markdown') ||
        b.textContent?.toLowerCase().includes('md'),
    );
    expect(mdBtn).toBeDefined();
  });

  it('renders heading 2 and heading 3 toolbar buttons', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor {...defaultProps} />);

    const h2Btn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.includes('2'),
    );
    const h3Btn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.includes('3'),
    );
    expect(h2Btn).toBeDefined();
    expect(h3Btn).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RichTextEditor HTML view', () => {
  const htmlToggle = () =>
    screen.getAllByRole('button').find((b) => b.hasAttribute('aria-pressed')) as HTMLElement | undefined;
  const boldButton = () =>
    screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.toLowerCase().includes('bold')) as HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has no HTML button unless a form asks for one', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor value="" onChange={vi.fn()} />);

    expect(htmlToggle()).toBeUndefined();
    expect(screen.queryByTestId('html-source')).not.toBeInTheDocument();
  });

  it('opens the content as HTML, one block per line, and switches the formatting buttons off', async () => {
    const user = userEvent.setup();
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor value="<h2>Title</h2><p>Body</p>" onChange={vi.fn()} showHtmlSource />);

    const toggle = htmlToggle();
    expect(toggle).toBeDefined();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(boldButton()).not.toBeDisabled();

    await user.click(toggle as HTMLElement);

    const source = await screen.findByTestId('html-source');
    expect(source).toHaveValue('<h2>Title</h2>\n<p>Body</p>');
    expect(source).toHaveAttribute('data-embedded', 'true');
    expect(htmlToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(boldButton()).toBeDisabled();
    // The visual editor stays mounted (it keeps its undo history), only hidden.
    expect(screen.getByTestId('rich-text-plugin').parentElement).toHaveClass('hidden');
  });

  it('reports pasted HTML exactly as typed, and ignores the hidden visual editor', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor value="" onChange={onChange} showHtmlSource />);

    await user.click(htmlToggle() as HTMLElement);
    const source = await screen.findByTestId('html-source');
    fireEvent.change(source, { target: { value: '<h2>Pasted</h2>\n\n<p>Kept as written</p>' } });

    expect(onChange).toHaveBeenLastCalledWith('<h2>Pasted</h2>\n\n<p>Kept as written</p>');

    // Lexical firing a change while the HTML view is open must not overwrite it.
    onChange.mockClear();
    fireEvent.click(screen.getByTestId('on-change-plugin'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('goes straight back to the editor when nothing would be lost, and loads the HTML into it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor value="" onChange={onChange} showHtmlSource />);

    await user.click(htmlToggle() as HTMLElement);
    fireEvent.change(await screen.findByTestId('html-source'), { target: { value: '<p>Plain</p>' } });
    mockUpdate.mockClear();

    await user.click(htmlToggle() as HTMLElement);

    expect(screen.queryByTestId('html-source')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(htmlToggle()).toHaveAttribute('aria-pressed', 'false');
    expect(boldButton()).not.toBeDisabled();

    // Back in the visual editor, its changes are reported again.
    onChange.mockClear();
    fireEvent.click(screen.getByTestId('on-change-plugin'));
    expect(onChange).toHaveBeenCalledWith('<p>Hello</p>');
  });

  it('asks before going back when the HTML has an image the editor would remove', async () => {
    const user = userEvent.setup();
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor value="" onChange={vi.fn()} showHtmlSource />);

    await user.click(htmlToggle() as HTMLElement);
    fireEvent.change(await screen.findByTestId('html-source'), {
      target: { value: '<p>Hello</p><img src="/uploads/a.png" alt="A">' },
    });
    mockUpdate.mockClear();

    await user.click(htmlToggle() as HTMLElement);

    // Still in the HTML view, nothing loaded into the editor, and a warning shown.
    expect(screen.getByTestId('html-source')).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
    const warning = screen.getByRole('alert');
    const [stay, leave] = Array.from(warning.querySelectorAll('button'));
    expect(stay).toBeDefined();
    expect(leave).toBeDefined();

    // "Stay" keeps the HTML view and the image.
    await user.click(stay as HTMLElement);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('html-source')).toHaveValue('<p>Hello</p><img src="/uploads/a.png" alt="A">');
    expect(mockUpdate).not.toHaveBeenCalled();

    // Asking again and choosing to go back loads the HTML into the editor.
    await user.click(htmlToggle() as HTMLElement);
    const again = screen.getByRole('alert');
    await user.click(Array.from(again.querySelectorAll('button'))[1] as HTMLElement);
    expect(screen.queryByTestId('html-source')).not.toBeInTheDocument();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('opens a post that already holds a table as HTML, so saving it cannot strip the table', async () => {
    const onChange = vi.fn();
    const stored = '<p>Intro</p><table><tbody><tr><td>1</td></tr></tbody></table>';
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor value={stored} onChange={onChange} showHtmlSource />);

    const source = await screen.findByTestId('html-source');
    expect((source as HTMLTextAreaElement).value.replace(/\n/g, '')).toBe(stored);
    expect(htmlToggle()).toHaveAttribute('aria-pressed', 'true');

    // Loading the post into the hidden visual editor reports nothing.
    fireEvent.click(screen.getByTestId('on-change-plugin'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('leaves a post with an image in the visual editor when the form has no HTML view', async () => {
    const { RichTextEditor } = await import('./RichTextEditor');
    render(<RichTextEditor value={'<p>Hi</p><img src="/uploads/a.png" alt="">'} onChange={vi.fn()} />);

    expect(screen.queryByTestId('html-source')).not.toBeInTheDocument();
    expect(screen.getByTestId('rich-text-plugin').parentElement).not.toHaveClass('hidden');
  });
});
