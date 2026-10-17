// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import i18n from 'i18next';
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { ConfirmDialogProvider } from '@/components/ui';
import { createMockContexts } from '@/test/mock-contexts';

const { mockBlockModels, mockEditor, mockGrapesInit } = vi.hoisted(() => {
  const blockModels = new Map<string, { set: ReturnType<typeof vi.fn> }>();
  const editor = {
    BlockManager: {
      add: vi.fn((id: string) => {
        const block = { set: vi.fn() };
        blockModels.set(id, block);
        return block;
      }),
      get: vi.fn((id: string) => blockModels.get(id)),
      render: vi.fn(),
    },
    AssetManager: { add: vi.fn() },
    Css: { setRule: vi.fn() },
    I18n: { addMessages: vi.fn(), setLocale: vi.fn() },
    StyleManager: { render: vi.fn() },
    TraitManager: { render: vi.fn() },
    LayerManager: { render: vi.fn() },
    getWrapper: vi.fn((): object | undefined => ({})),
    addStyle: vi.fn(),
    addComponents: vi.fn(() => ({ id: 'image-component' })),
    select: vi.fn(),
    loadProjectData: vi.fn(),
    setComponents: vi.fn(),
    getHtml: vi.fn(() => '<section>Saved fallback</section>'),
    getCss: vi.fn(() => '.saved{color:red}'),
    getProjectData: vi.fn(() => ({ pages: [] })),
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
    getSelected: vi.fn(),
    getDevice: vi.fn(() => 'Desktop'),
    UndoManager: { hasUndo: vi.fn(() => false), hasRedo: vi.fn(() => false) },
  };

  return {
    mockBlockModels: blockModels,
    mockEditor: editor,
    mockGrapesInit: vi.fn(() => editor),
  };
});

const { mockAdminBuilderAssets } = vi.hoisted(() => ({
  mockAdminBuilderAssets: {
    uploadImage: vi.fn(),
    listImages: vi.fn(),
  },
}));

vi.mock('grapesjs', () => ({
  default: { init: mockGrapesInit },
}));

vi.mock('grapesjs-preset-webpage', () => ({ default: vi.fn() }));
vi.mock('grapesjs-blocks-basic', () => ({ default: vi.fn() }));
vi.mock('grapesjs-plugin-forms', () => ({ default: vi.fn() }));
vi.mock('grapesjs-tabs', () => ({ default: vi.fn() }));
vi.mock('grapesjs-tooltip', () => ({ default: vi.fn() }));
vi.mock('grapesjs-custom-code', () => ({ default: vi.fn() }));

vi.mock('../api/adminApi', () => ({
  adminBuilderAssets: mockAdminBuilderAssets,
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => ({
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    }),
  }),
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { DEFAULT_PAGE_CSS, PageDesignBuilder } from './PageDesignBuilder';

function renderBuilder(designJson: string | null, readOnly = false) {
  return render(
    <ConfirmDialogProvider>
      <PageDesignBuilder
        html="<style>.saved{color:red}</style><section>Saved fallback</section>"
        designJson={designJson}
        readOnly={readOnly}
        onChange={vi.fn()}
      />
    </ConfirmDialogProvider>,
  );
}

describe('PageDesignBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBlockModels.clear();
    mockEditor.loadProjectData.mockReset();
    mockEditor.setComponents.mockClear();
    mockEditor.addStyle.mockClear();
    mockEditor.BlockManager.add.mockClear();
    mockEditor.AssetManager.add.mockClear();
    mockEditor.addComponents.mockClear();
    mockEditor.select.mockClear();
    mockEditor.getSelected.mockReset();
    mockAdminBuilderAssets.uploadImage.mockReset();
    mockAdminBuilderAssets.listImages.mockReset();
    mockEditor.getWrapper.mockReset();
    mockEditor.getWrapper.mockReturnValue({});
    mockEditor.LayerManager.render.mockReset();
    mockEditor.TraitManager.render.mockReset();
  });

  // Real GrapesJS: the layer and trait panels read the root component, which
  // does not exist until the canvas has loaded. Rendering them earlier throws.
  function panelsThrowWithoutWrapper() {
    const noWrapperYet = () => {
      if (!mockEditor.getWrapper()) {
        throw new TypeError("Cannot read properties of undefined (reading 'get')");
      }
    };
    mockEditor.LayerManager.render.mockImplementation(noWrapperYet);
    mockEditor.TraitManager.render.mockImplementation(noWrapperYet);
  }

  it('does not fail initialisation when the layer and trait panels cannot render yet', async () => {
    mockEditor.getWrapper.mockReturnValue(undefined);
    panelsThrowWithoutWrapper();

    const { container } = renderBuilder(null);
    await waitFor(() => expect(mockGrapesInit).toHaveBeenCalled());

    expect(screen.queryByText('The page builder could not load. Please use HTML mode instead.')).not.toBeInTheDocument();
    expect(container.querySelector('.nb-root')).not.toBeNull();
    expect(mockEditor.LayerManager.render).not.toHaveBeenCalled();
    expect(mockEditor.TraitManager.render).not.toHaveBeenCalled();
  });

  it('re-renders the layer panel on a language change once the editor has a wrapper', async () => {
    mockEditor.getWrapper.mockReturnValue(undefined);
    panelsThrowWithoutWrapper();

    renderBuilder(null);
    await waitFor(() => expect(mockGrapesInit).toHaveBeenCalled());

    // Before the canvas has loaded, a language change must skip the panels.
    act(() => {
      i18n.emit('languageChanged', 'en');
    });
    expect(mockEditor.LayerManager.render).not.toHaveBeenCalled();

    mockEditor.getWrapper.mockReturnValue({});
    act(() => {
      i18n.emit('languageChanged', 'en');
    });
    expect(mockEditor.LayerManager.render).toHaveBeenCalledTimes(1);
    expect(mockEditor.TraitManager.render).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('The page builder could not load. Please use HTML mode instead.')).not.toBeInTheDocument();
  });

  it('uses the tenant-aware home path in generated starter blocks', async () => {
    renderBuilder(null);

    await waitFor(() => {
      expect(mockEditor.BlockManager.add).toHaveBeenCalledWith(
        'nexus-hero',
        expect.objectContaining({
          content: expect.stringContaining('href="/test/"'),
        }),
      );
    });
  });

  it('falls back to saved HTML and shows a notice when saved design_json is invalid', async () => {
    mockEditor.loadProjectData.mockImplementationOnce(() => {
      throw new Error('bad project');
    });

    renderBuilder('{"bad":');

    await waitFor(() => {
      expect(mockEditor.setComponents).toHaveBeenCalledWith('<section>Saved fallback</section>');
    });
    expect(mockEditor.addStyle).toHaveBeenCalledWith(expect.stringContaining('.saved{color:red}'));
    expect(await screen.findByText(i18n.t('page_builder.legacy_notice', { ns: 'admin_editor' }))).toBeInTheDocument();
  });

  it('uploads toolbar images as absolute asset URLs and inserts a GrapesJS image component', async () => {
    mockAdminBuilderAssets.uploadImage.mockResolvedValueOnce({
      success: true,
      data: { url: 'https://cdn.example.test/uploads/page.png', path: 'uploads/page.png' },
    });

    const { container } = renderBuilder(null);
    await waitFor(() => expect(mockGrapesInit).toHaveBeenCalled());

    const fileInput = container.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['img'], 'page.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(mockAdminBuilderAssets.uploadImage).toHaveBeenCalled());
    expect(mockEditor.AssetManager.add).toHaveBeenCalledWith('https://cdn.example.test/uploads/page.png');
    expect(mockEditor.addComponents).toHaveBeenCalledWith({
      type: 'image',
      attributes: {
        src: 'https://cdn.example.test/uploads/page.png',
        alt: '',
        class: 'nexus-page-uploaded-image',
      },
    });
    expect(mockEditor.select).toHaveBeenCalledWith({ id: 'image-component' });
  });

  it('replaces the selected image when uploading from the toolbar', async () => {
    const selected = {
      get: vi.fn((key: string) => {
        if (key === 'tagName') return 'img';
        if (key === 'attributes') return { class: 'existing-class' };
        return undefined;
      }),
      set: vi.fn(),
      addAttributes: vi.fn(),
    };
    mockEditor.getSelected.mockReturnValue(selected);
    mockAdminBuilderAssets.uploadImage.mockResolvedValueOnce({
      success: true,
      data: { url: 'https://cdn.example.test/uploads/replacement.webp', path: 'uploads/replacement.webp' },
    });

    const { container } = renderBuilder(null);
    await waitFor(() => expect(mockGrapesInit).toHaveBeenCalled());

    const fileInput = container.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['img'], 'replacement.webp', { type: 'image/webp' })] },
    });

    await waitFor(() => expect(selected.set).toHaveBeenCalledWith('src', 'https://cdn.example.test/uploads/replacement.webp'));
    expect(selected.addAttributes).toHaveBeenCalledWith({
      class: 'existing-class nexus-page-uploaded-image',
    });
    expect(mockEditor.addComponents).not.toHaveBeenCalled();
  });

  it('uses the GrapesJS asset manager upload callback for dropped image files', async () => {
    mockAdminBuilderAssets.uploadImage.mockResolvedValueOnce({
      success: true,
      data: { url: 'https://cdn.example.test/uploads/dropped.jpg', path: 'uploads/dropped.jpg' },
    });

    renderBuilder(null);
    await waitFor(() => expect(mockGrapesInit).toHaveBeenCalled());

    const config = mockGrapesInit.mock.calls.at(-1)?.[0] as { assetManager?: { uploadFile?: (ev: Event) => Promise<void> } };
    await config.assetManager?.uploadFile?.({
      dataTransfer: {
        files: [new File(['img'], 'dropped.jpg', { type: 'image/jpeg' })],
      },
    } as unknown as DragEvent);

    expect(mockAdminBuilderAssets.uploadImage).toHaveBeenCalled();
    expect(mockEditor.AssetManager.add).toHaveBeenCalledWith('https://cdn.example.test/uploads/dropped.jpg');
    expect(mockEditor.addComponents).toHaveBeenCalledWith({
      type: 'image',
      attributes: {
        src: 'https://cdn.example.test/uploads/dropped.jpg',
        alt: '',
        class: 'nexus-page-uploaded-image',
      },
    });
  });

  it('blocks direct canvas interaction while the builder is read-only', async () => {
    renderBuilder(null, true);

    expect(await screen.findByRole('status', { name: /saving/i })).toBeInTheDocument();
  });

  it('seeds NEXUS page blocks with light/dark theme tokens instead of fixed light colours', () => {
    expect(DEFAULT_PAGE_CSS).toContain('var(--background');
    expect(DEFAULT_PAGE_CSS).toContain('var(--foreground');
    expect(DEFAULT_PAGE_CSS).toContain('var(--surface-elevated');
    expect(DEFAULT_PAGE_CSS).toContain('var(--accent-color');
    expect(DEFAULT_PAGE_CSS).not.toContain('background:#ffffff');
    expect(DEFAULT_PAGE_CSS).not.toContain('color:#111827');
    expect(DEFAULT_PAGE_CSS).not.toContain('background:#f7faf8');
  });
});
