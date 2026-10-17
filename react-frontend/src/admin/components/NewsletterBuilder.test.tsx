// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import i18n from 'i18next';
import { act, render, screen } from '@/test/test-utils';

// GrapesJS is imperative and needs a real canvas/iframe — mock it so the
// component's lifecycle (init on mount, destroy on unmount, config, seed/restore)
// can be asserted in jsdom. vi.hoisted keeps the mocks available inside the
// hoisted vi.mock factory.
const { editorMock, initMock } = vi.hoisted(() => {
  const editorMock = {
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
    loadProjectData: vi.fn(),
    setComponents: vi.fn(),
    getProjectData: vi.fn(() => ({ pages: [] })),
    // grapesjs-mjml compiles to table-based HTML; the restore-validity probe
    // (exportIsValid) checks for that, so the mock must look like real output.
    runCommand: vi.fn(() => ({ html: '<body><table><tr><td>built</td></tr></table></body>' })),
    stopCommand: vi.fn(),
    setDevice: vi.fn(),
    getDevice: vi.fn(() => 'Desktop'),
    getSelected: vi.fn(() => null),
    AssetManager: { add: vi.fn() },
    BlockManager: { getAll: vi.fn(() => []), render: vi.fn() },
    I18n: { addMessages: vi.fn(), setLocale: vi.fn() },
    StyleManager: { render: vi.fn() },
    TraitManager: { render: vi.fn() },
    LayerManager: { render: vi.fn() },
    getWrapper: vi.fn((): object | undefined => ({})),
    UndoManager: { undo: vi.fn(), redo: vi.fn(), hasUndo: vi.fn(() => false), hasRedo: vi.fn(() => false) },
  };
  return { editorMock, initMock: vi.fn(() => editorMock) };
});

vi.mock('grapesjs', () => ({ default: { init: initMock } }));
vi.mock('grapesjs-mjml', () => ({ default: vi.fn() }));
vi.mock('@/contexts', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('../api/adminApi', () => ({ adminNewsletters: { uploadImage: vi.fn() } }));

// The chrome is dumb presentation and tested separately (BuilderToolbar.test).
// Here we mock the three sub-components so the orchestrator's init/lifecycle can
// be asserted in isolation — the palette/inspector mocks still attach the refs
// GrapesJS needs as appendTo targets so init runs exactly as in production.
vi.mock('./BuilderToolbar', () => ({
  BuilderToolbar: (props: { ready: boolean; readOnly?: boolean }) => (
    <div data-testid="toolbar" data-ready={String(props.ready)} data-readonly={String(Boolean(props.readOnly))} />
  ),
}));
vi.mock('./BuilderBlockPalette', () => ({
  BuilderBlockPalette: ({ blocksRef, title }: { blocksRef: React.Ref<HTMLDivElement>; title: string }) => (
    <div className="nb-palette" ref={blocksRef} data-title={title} />
  ),
}));
vi.mock('./BuilderInspector', () => ({
  BuilderInspector: ({
    stylesRef,
    traitsRef,
    layersRef,
  }: {
    stylesRef: React.Ref<HTMLDivElement>;
    traitsRef: React.Ref<HTMLDivElement>;
    layersRef: React.Ref<HTMLDivElement>;
  }) => (
    <div data-testid="inspector">
      <div ref={stylesRef} />
      <div ref={traitsRef} />
      <div ref={layersRef} />
    </div>
  ),
}));

// The orchestrator pulls Modal/Button/useConfirm from the ui barrel; stub them
// so the focused lifecycle test doesn't drag in the whole HeroUI tree.
vi.mock('@/components/ui', () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalContent: ({ children }: { children: React.ReactNode }) => (
    <div>{typeof children === 'function' ? null : children}</div>
  ),
  ModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalHeading: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  useConfirm: () => () => Promise.resolve(true),
}));

import { NewsletterBuilder } from './NewsletterBuilder';

describe('NewsletterBuilder', () => {
  beforeEach(() => {
    initMock.mockClear();
    editorMock.on.mockClear();
    editorMock.off.mockClear();
    editorMock.destroy.mockClear();
    editorMock.loadProjectData.mockClear();
    editorMock.setComponents.mockClear();
    editorMock.getWrapper.mockReset();
    editorMock.getWrapper.mockReturnValue({});
    editorMock.LayerManager.render.mockReset();
    editorMock.TraitManager.render.mockReset();
  });

  // Real GrapesJS: the layer and trait panels read the root component, which
  // does not exist until the canvas has loaded. Rendering them earlier throws.
  function panelsThrowWithoutWrapper() {
    const noWrapperYet = () => {
      if (!editorMock.getWrapper()) {
        throw new TypeError("Cannot read properties of undefined (reading 'get')");
      }
    };
    editorMock.LayerManager.render.mockImplementation(noWrapperYet);
    editorMock.TraitManager.render.mockImplementation(noWrapperYet);
  }

  it('does not fail initialisation when the layer and trait panels cannot render yet', () => {
    editorMock.getWrapper.mockReturnValue(undefined);
    panelsThrowWithoutWrapper();

    const { container } = render(<NewsletterBuilder html="" onChange={vi.fn()} />);

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText('The visual builder could not load. Please use the HTML mode instead.'),
    ).not.toBeInTheDocument();
    expect(container.querySelector('.nb-root')).not.toBeNull();
    expect(editorMock.LayerManager.render).not.toHaveBeenCalled();
    expect(editorMock.TraitManager.render).not.toHaveBeenCalled();
  });

  it('re-renders the layer panel on a language change once the editor has a wrapper', () => {
    editorMock.getWrapper.mockReturnValue(undefined);
    panelsThrowWithoutWrapper();

    render(<NewsletterBuilder html="" onChange={vi.fn()} />);

    // Before the canvas has loaded, a language change must skip the panels.
    act(() => {
      i18n.emit('languageChanged', 'en');
    });
    expect(editorMock.LayerManager.render).not.toHaveBeenCalled();

    editorMock.getWrapper.mockReturnValue({});
    act(() => {
      i18n.emit('languageChanged', 'en');
    });
    expect(editorMock.LayerManager.render).toHaveBeenCalledTimes(1);
    expect(editorMock.TraitManager.render).toHaveBeenCalledTimes(1);
  });

  it('initializes GrapesJS on mount and subscribes to update', () => {
    render(<NewsletterBuilder html="" onChange={vi.fn()} />);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(editorMock.on).toHaveBeenCalledWith('update', expect.any(Function));
  });

  it('suppresses the default panels and pins each manager into our own nodes', () => {
    // This is the core of the fix: no icon-less default chrome; a real block
    // palette + inspector pinned into DOM nodes we control.
    render(<NewsletterBuilder html="" onChange={vi.fn()} />);
    const cfg = initMock.mock.calls[0][0] as Record<string, { appendTo?: unknown }> & {
      panels?: { defaults?: unknown[] };
    };
    expect(cfg.panels).toEqual({ defaults: [] });
    expect(cfg.blockManager?.appendTo).toBeInstanceOf(HTMLElement);
    expect(cfg.styleManager?.appendTo).toBeInstanceOf(HTMLElement);
    expect(cfg.traitManager?.appendTo).toBeInstanceOf(HTMLElement);
    expect(cfg.layerManager?.appendTo).toBeInstanceOf(HTMLElement);
  });

  it('renders the always-visible block palette', () => {
    const { container } = render(<NewsletterBuilder html="" onChange={vi.fn()} />);
    expect(container.querySelector('.nb-palette')).not.toBeNull();
  });

  it('seeds a blank MJML document when there is no saved design', () => {
    render(<NewsletterBuilder html="" onChange={vi.fn()} />);
    expect(editorMock.setComponents).toHaveBeenCalledWith(expect.stringContaining('<mj-body>'));
    expect(editorMock.loadProjectData).not.toHaveBeenCalled();
  });

  it('restores a saved design from design_json (and does not re-seed)', () => {
    render(<NewsletterBuilder html="" designJson='{"pages":[1]}' onChange={vi.fn()} />);
    expect(editorMock.loadProjectData).toHaveBeenCalledWith({ pages: [1] });
    expect(editorMock.setComponents).not.toHaveBeenCalled();
  });

  it('shows a read-only overlay only when readOnly (sent)', () => {
    const { container, rerender } = render(<NewsletterBuilder html="" onChange={vi.fn()} />);
    expect(container.querySelector('.cursor-not-allowed')).toBeNull();
    rerender(<NewsletterBuilder html="" readOnly onChange={vi.fn()} />);
    expect(container.querySelector('.cursor-not-allowed')).not.toBeNull();
  });

  it('destroys the editor on unmount', () => {
    const { unmount } = render(<NewsletterBuilder html="" onChange={vi.fn()} />);
    unmount();
    expect(editorMock.destroy).toHaveBeenCalled();
  });

  it('renders an error fallback when init throws', () => {
    initMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    render(<NewsletterBuilder html="" onChange={vi.fn()} />);
    expect(
      screen.getByText('The visual builder could not load. Please use the HTML mode instead.'),
    ).toBeInTheDocument();
  });
});
