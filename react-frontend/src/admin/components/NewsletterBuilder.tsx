// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * NewsletterBuilder — the enterprise drag-and-drop email builder (GrapesJS +
 * MJML). This is the engine behind the full-screen Design Studio
 * (NewsletterDesignStudio) and the "Design" mode of NewsletterContentEditor.
 *
 * - Blocks are MJML components (grapesjs-mjml), so the exported HTML is
 *   inbox-safe/table-based by construction.
 * - The editable project is serialized to `design_json` (so a design reopens
 *   losslessly); the compiled, ready-to-send HTML is stored in `content`
 *   (content_format='builder', which the backend renders like html).
 * - Image uploads go through our own domain (POST /v2/upload) and are applied
 *   to the target block (or inserted at the selection) — never left stranded.
 * - Starter/saved templates load straight into the canvas via the Templates
 *   picker (MJML markup → setComponents, or a saved GrapesJS project → load).
 *
 * WHY THIS OWNS ITS OWN CHROME (learned the hard way): GrapesJS's DEFAULT panel
 * layout is driven by toolbar buttons whose glyphs come from Font Awesome. This
 * app has no Font Awesome (it uses lucide-react), so those buttons render as
 * blank squares and the block palette gets stranded behind an invisible toggle.
 * So we suppress GrapesJS's default panels (`panels: { defaults: [] }`) and pin
 * each manager into our OWN React layout: a permanent block palette
 * (BuilderBlockPalette), a labelled lucide toolbar (BuilderToolbar), and a
 * tabbed Style/Settings/Layers inspector (BuilderInspector).
 *
 * INTEGRATION CONSTRAINTS:
 *  - grapesjs-mjml@1.0.8 supports grapesjs ^0.21.x ONLY. Keep grapesjs pinned.
 *  - The canvas MUST be seeded with an <mjml><mj-body> document or there is no
 *    valid mj-body to drop blocks into.
 *  - GrapesJS UI CSS is imported in this lazy builder chunk so the public app
 *    shell does not download editor chrome.
 *
 * GrapesJS is imperative; it's mounted once in a useEffect, guarded against
 * React StrictMode's mount→cleanup→remount by gating on the editor INSTANCE ref.
 */

import 'grapesjs/dist/css/grapes.min.css';
import '@/styles/newsletter-builder.css';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import grapesjs, { type Editor } from 'grapesjs';
import mjmlPlugin from 'grapesjs-mjml';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, useConfirm } from '@/components/ui';
import Copy from 'lucide-react/icons/copy';
import Info from 'lucide-react/icons/info';
import X from 'lucide-react/icons/x';
import LayoutTemplate from 'lucide-react/icons/layout-template';
import { logError } from '@/lib/logger';
import { adminNewsletters } from '../api/adminApi';
import { BuilderToolbar, type BuilderDevice } from './BuilderToolbar';
import { BuilderBlockPalette } from './BuilderBlockPalette';
import { BuilderInspector, type InspectorTab } from './BuilderInspector';
import { TemplateGalleryModal, type GalleryTemplate } from './TemplateGalleryModal';
import { BuilderPreviewModal } from './BuilderPreviewModal';
import {
  resolveUploadedUrl,
  insertImageComponent,
  isEphemeralSrc,
  imageActionFor,
  type GjsComp,
  type EditorLike,
} from './builderImage';
import { attachBackgroundTraits } from './builderTraits';
import {
  escapeBuilderText,
  getGrapesJsCoreMessages,
  getMjmlMessages,
  mergeGrapesJsMessages,
  normalizeGrapesJsLocale,
  type GrapesJsMessages,
} from './grapesJsLocale';

const AssetLibraryModal = lazy(() =>
  import('./AssetLibraryModal').then((module) => ({ default: module.AssetLibraryModal })),
);

interface NewsletterBuilderProps {
  /** Current compiled HTML (unused for restore — design_json drives restore). */
  html: string;
  /** Serialized GrapesJS project (JSON string) or null for a blank canvas. */
  designJson?: string | null;
  /** MJML markup to seed the canvas when there is no design_json (e.g. an MJML
   * starter template). Ignored once a design_json exists. */
  initialMjml?: string | null;
  /** True only for already-sent newsletters — freezes the canvas. NOT set while saving. */
  readOnly?: boolean;
  /** Fill the parent container (full-screen studio) instead of a fixed height. */
  fill?: boolean;
  /** Show the in-builder Templates picker (off when editing a template itself). */
  enableTemplates?: boolean;
  onChange: (payload: { html: string; designJson: string }) => void;
}

const AUTOSAVE_DEBOUNCE_MS = 1000;

/** Blank starting canvas — establishes the mjml > mj-body wrapper blocks drop into. */
type BuilderTranslate = (key: string) => string;

const MJML_IMAGE_PLACEHOLDER = 'https://via.placeholder.com/350x250/78c5d6/fff';
const MJML_HERO_PLACEHOLDER =
  'https://cloud.githubusercontent.com/assets/1830348/15354890/1442159a-1cf0-11e6-92b1-b861dadf1750.jpg';

function defaultNewsletterMjml(t: BuilderTranslate): string {
  const prompt = escapeBuilderText(t('newsletter_builder.grapesjs.content.blank_canvas'));
  return `<mjml><mj-body><mj-section><mj-column><mj-text>${prompt}</mj-text></mj-column></mj-section></mj-body></mjml>`;
}

function newsletterBlockOverrides(id: string, t: BuilderTranslate): Record<string, unknown> {
  const text = (key: string) => escapeBuilderText(t(`newsletter_builder.grapesjs.content.${key}`));

  switch (id) {
    case 'mj-1-column':
      return { content: `<mj-section><mj-column><mj-text>${text('column_one')}</mj-text></mj-column></mj-section>` };
    case 'mj-2-columns':
      return {
        content: `<mj-section><mj-column><mj-text>${text('column_one')}</mj-text></mj-column><mj-column><mj-text>${text('column_two')}</mj-text></mj-column></mj-section>`,
      };
    case 'mj-3-columns':
      return {
        content: `<mj-section><mj-column><mj-text>${text('column_one')}</mj-text></mj-column><mj-column><mj-text>${text('column_two')}</mj-text></mj-column><mj-column><mj-text>${text('column_three')}</mj-text></mj-column></mj-section>`,
      };
    case 'mj-text':
      return { content: `<mj-text>${text('text')}</mj-text>` };
    case 'mj-button':
      return { content: `<mj-button>${text('button')}</mj-button>` };
    case 'mj-navbar':
      return {
        content: `<mj-navbar><mj-navbar-link>${text('nav_getting_started')}</mj-navbar-link><mj-navbar-link>${text('nav_try_live')}</mj-navbar-link><mj-navbar-link>${text('nav_templates')}</mj-navbar-link><mj-navbar-link>${text('nav_components')}</mj-navbar-link></mj-navbar>`,
      };
    case 'mj-navbar-link':
      return { content: `<mj-navbar-link>${text('link')}</mj-navbar-link>` };
    case 'mj-hero':
      return {
        content: `<mj-hero mode="fixed-height" height="469px" background-width="600px" background-height="469px" background-url="${MJML_HERO_PLACEHOLDER}" background-color="#2a3448" padding="100px 0px"><mj-text padding="20px" color="#ffffff" font-family="Helvetica" align="center" font-size="45px" line-height="45px" font-weight="900">${text('hero_heading')}</mj-text><mj-button href="https://mjml.io/" align="center">${text('hero_button')}</mj-button></mj-hero>`,
      };
    case 'mj-wrapper':
      return {
        content: `<mj-wrapper border="1px solid #000000" padding="50px 30px"><mj-section border-top="1px solid #aaaaaa" border-left="1px solid #aaaaaa" border-right="1px solid #aaaaaa" padding="20px"><mj-column><mj-image padding="0" src="${MJML_IMAGE_PLACEHOLDER}" /></mj-column></mj-section><mj-section border-left="1px solid #aaaaaa" border-right="1px solid #aaaaaa" padding="20px" border-bottom="1px solid #aaaaaa"><mj-column border="1px solid #dddddd"><mj-text padding="20px">${text('wrapper_first_line')}</mj-text><mj-divider border-width="1px" border-style="dashed" border-color="lightgrey" padding="0 20px" /><mj-text padding="20px">${text('wrapper_second_line')}</mj-text></mj-column></mj-section></mj-wrapper>`,
      };
    case 'mj-raw': {
      const images = [141, 142, 143, 144, 145, 146]
        .map((height) => `<img class="item" src="https://source.unsplash.com/random/200x${height}" alt="${text('example_image')}">`)
        .join('');
      return { content: `<mj-raw><div class="container">${images}</div></mj-raw>` };
    }
    default:
      return {};
  }
}

function newsletterEditorMessages(
  t: BuilderTranslate,
  coreT: BuilderTranslate,
  language?: string,
): GrapesJsMessages {
  const value = (key: string) => t(`newsletter_builder.grapesjs.${key}`);

  return mergeGrapesJsMessages(
    getGrapesJsCoreMessages(language, coreT),
    getMjmlMessages(language, t),
    {
      styleManager: {
        properties: {
          'icon-size': value('styles.icon_size'),
          'vertical-align': value('styles.vertical_align'),
          align: value('styles.align'),
          'text-decoration': value('styles.text_decoration'),
          'font-style': value('styles.font_style'),
          'container-background-color': value('styles.container_background_color'),
          'background-url': value('styles.background_image'),
          'border-detached': value('styles.border'),
        },
        options: {
          'vertical-align': {
            top: value('options.top'),
            middle: value('options.middle'),
            bottom: value('options.bottom'),
          },
          'text-align': {
            left: value('options.left'),
            center: value('options.center'),
            right: value('options.right'),
            justify: value('options.justify'),
          },
          align: {
            left: value('options.left'),
            center: value('options.center'),
            right: value('options.right'),
            justify: value('options.justify'),
          },
          'text-decoration': {
            none: value('options.none'),
            underline: value('options.underline'),
            'line-through': value('options.line_through'),
          },
          'font-style': {
            normal: value('options.normal'),
            italic: value('options.italic'),
          },
          'border-style': {
            none: value('options.none'),
            solid: value('options.solid'),
            dotted: value('options.dotted'),
            dashed: value('options.dashed'),
            double: value('options.double'),
            groove: value('options.groove'),
            ridge: value('options.ridge'),
            inset: value('options.inset'),
            outset: value('options.outset'),
          },
        },
      },
      traitManager: {
        traits: {
          labels: {
            'full-width': value('traits.full_width'),
            hamburger: value('traits.hamburger'),
            name: value('traits.icon'),
            src: value('traits.source'),
            rel: value('traits.relationship'),
            mode: value('traits.mode'),
            owa: value('traits.owa'),
            lang: value('traits.language'),
            dir: value('traits.direction'),
          },
          attributes: {
            owa: { placeholder: value('placeholders.owa') },
            lang: { placeholder: value('placeholders.language') },
            dir: { placeholder: value('placeholders.direction') },
          },
          options: {
            hamburger: {
              hamburger: value('options.on'),
              OFF: value('options.off'),
              false: value('options.off'),
            },
            mode: {
              horizontal: value('options.horizontal'),
              vertical: value('options.vertical'),
            },
          },
        },
      },
    },
  );
}

/** Resolve the plugin whether Vite hands us `fn` or `{ default: fn }`. */
type MjmlPluginFn = (editor: Editor, opts: Record<string, unknown>) => void;
function resolveMjmlPlugin(): MjmlPluginFn | null {
  const mod = mjmlPlugin as unknown;
  if (typeof mod === 'function') return mod as MjmlPluginFn;
  if (mod && typeof (mod as { default?: unknown }).default === 'function') {
    return (mod as { default: MjmlPluginFn }).default;
  }
  return null;
}

/** Minimal structural view of grapesjs' UndoManager (avoids depending on its types here). */
type UndoLike = { hasUndo?: () => boolean; hasRedo?: () => boolean; undo?: () => void; redo?: () => void };

/** Compile the current canvas to HTML; used both to export and to probe validity. */
function exportHtml(ed: Editor): string {
  const result = ed.runCommand('mjml-code-to-html') as { html?: string } | undefined;
  return result?.html ?? '';
}

/** A restored design is valid only if it still compiles to real MJML/table HTML. */
function exportIsValid(ed: Editor): boolean {
  try {
    const html = exportHtml(ed).trim();
    return html.length > 0 && /<table|<mj-|<body/i.test(html);
  } catch {
    return false;
  }
}

export function NewsletterBuilder({ designJson, initialMjml, readOnly, fill, enableTemplates, onChange }: NewsletterBuilderProps) {
  const { t, i18n } = useTranslation(['admin_newsletters', 'admin_editor']);
  const toast = useToast();
  const confirm = useConfirm();

  // One ref per GrapesJS appendTo target — all must be mounted before init runs.
  const canvasRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<HTMLDivElement>(null);
  const stylesRef = useRef<HTMLDivElement>(null);
  const traitsRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const editorRef = useRef<Editor | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Seed only at mount time — later prop changes shouldn't reset the canvas.
  const seedRef = useRef(designJson);
  const initialMjmlRef = useRef(initialMjml);
  // Lets non-init handlers (image insert, template apply) trigger an export.
  const scheduleEmitRef = useRef<() => void>(() => {});
  // Most-recent uploaded absolute url — sweeps any stray blob/data image src.
  const lastUploadRef = useRef<string | null>(null);
  // Applies an uploaded image to the canvas. Reassigned every render so the
  // (init-time) asset-manager uploadFile handler always calls the latest closure.
  const applyImageRef = useRef<(url: string, target?: GjsComp) => void>(() => {});
  // Gated so seeding the blank canvas doesn't instantly dismiss the first-run card.
  const firstRunArmedRef = useRef(false);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [failed, setFailed] = useState(false);
  const [device, setDevice] = useState<BuilderDevice>('Desktop');
  const [showBorders, setShowBorders] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTab>('style');
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeHtml, setCodeHtml] = useState('');
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [insertingImage, setInsertingImage] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templates, setTemplates] = useState<GalleryTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  // Set when a restored design_json was built by an older editor and dropped.
  const [legacyNotice, setLegacyNotice] = useState(false);
  // First-run helper card over a blank canvas (offers starter templates).
  const [showFirstRun, setShowFirstRun] = useState(false);
  // Device-framed preview of the compiled email.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  // Asset library (browse + reuse past uploads).
  const [libraryOpen, setLibraryOpen] = useState(false);

  // Reads the editor's undo/redo availability into React state. Reads refs +
  // stable setters only, so it's safe to call from the init effect too.
  const syncUndoState = () => {
    const um = editorRef.current?.UndoManager as unknown as UndoLike | undefined;
    setCanUndo(Boolean(um?.hasUndo?.()));
    setCanRedo(Boolean(um?.hasRedo?.()));
  };

  useEffect(() => {
    if (editorRef.current) return undefined;
    if (!canvasRef.current || !blocksRef.current || !stylesRef.current || !traitsRef.current || !layersRef.current) {
      return undefined;
    }

    const mjmlFn = resolveMjmlPlugin();
    if (!mjmlFn) {
      logError('NewsletterBuilder: grapesjs-mjml plugin did not resolve to a function', mjmlPlugin);
      setFailed(true);
      return undefined;
    }

    let ed: Editor;
    try {
      const editorLocale = normalizeGrapesJsLocale(i18n.resolvedLanguage ?? i18n.language);
      const coreT = i18n.getFixedT(editorLocale, 'admin_editor') as BuilderTranslate;
      const editorMessages = newsletterEditorMessages(t, coreT, editorLocale);
      const englishT = i18n.getFixedT('en', 'admin_newsletters') as BuilderTranslate;
      const englishCoreT = i18n.getFixedT('en', 'admin_editor') as BuilderTranslate;
      ed = grapesjs.init({
        container: canvasRef.current,
        height: '100%',
        width: '100%',
        fromElement: false,
        storageManager: { type: 'none' },
        undoManager: { trackSelection: false },
        i18n: {
          locale: editorLocale,
          localeFallback: 'en',
          detectLocale: false,
          messages: {
            en: newsletterEditorMessages(englishT, englishCoreT, 'en'),
            [editorLocale]: editorMessages,
          },
        },
        // Suppress GrapesJS's default (icon-less) panels; we own the chrome.
        panels: { defaults: [] },
        // Pin each manager into our own React layout.
        blockManager: { appendTo: blocksRef.current },
        styleManager: { appendTo: stylesRef.current },
        traitManager: { appendTo: traitsRef.current },
        layerManager: { appendTo: layersRef.current },
        plugins: [
          (plug: Editor) =>
            mjmlFn(plug, {
              resetBlocks: true,
              resetStyleManager: true,
              resetDevices: true,
              hideSelector: true,
              block: (id: string) => newsletterBlockOverrides(id, t),
              i18n: { [editorLocale]: getMjmlMessages(editorLocale, t) },
            }),
        ],
        assetManager: {
          // Overriding uploadFile REPLACES GrapesJS's default (which would drop a
          // base64/blob preview into the model — dead in a delivered email). We
          // upload to our own domain (/v2/upload → absolute url) and hand the
          // ABSOLUTE url to applyServerImage, which points the open image at it or
          // inserts a fresh one. No blob/relative src is ever left behind.
          uploadFile: async (ev: Event) => {
            const target = ev.target as HTMLInputElement | null;
            const dropped = (ev as DragEvent).dataTransfer?.files;
            const file = (dropped && dropped[0]) || target?.files?.[0];
            if (!file) return;
            try {
              const url = resolveUploadedUrl(await adminNewsletters.uploadImage(file));
              if (!url) {
                toast.error(t('newsletter_content_editor.image_upload_failed'));
                return;
              }
              applyImageRef.current(url);
            } catch (err) {
              logError('NewsletterBuilder: asset upload failed', err);
              toast.error(t('newsletter_content_editor.image_upload_failed'));
            }
          },
        },
      });
    } catch (err) {
      logError('NewsletterBuilder: GrapesJS init failed', err);
      setFailed(true);
      return undefined;
    }

    editorRef.current = ed;

    // 'init' runs before the canvas exists: GrapesJS renders its panels itself
    // once loaded, and the layer/trait panels throw if redrawn before the root
    // component exists. Only a later language change redraws them.
    const syncEditorLocale = (language: string, phase: 'init' | 'change') => {
      const locale = normalizeGrapesJsLocale(language);
      const fixedT = i18n.getFixedT(language, 'admin_newsletters') as BuilderTranslate;
      const fixedCoreT = i18n.getFixedT(language, 'admin_editor') as BuilderTranslate;
      ed.I18n.addMessages({ [locale]: newsletterEditorMessages(fixedT, fixedCoreT, locale) });
      ed.I18n.setLocale(locale);
      if (phase === 'init') return;
      const redraw = (panel: string, render: () => void) => {
        try {
          render();
        } catch (err) {
          logError(`NewsletterBuilder: ${panel} redraw after language change failed`, err);
        }
      };
      redraw('blocks', () => ed.BlockManager.render());
      redraw('styles', () => ed.StyleManager.render());
      if (ed.getWrapper()) {
        redraw('traits', () => ed.TraitManager.render());
        redraw('layers', () => ed.LayerManager.render());
      }
    };
    syncEditorLocale(i18n.resolvedLanguage ?? i18n.language, 'init');
    const onLanguageChanged = (lang: string) => syncEditorLocale(lang, 'change');
    i18n.on('languageChanged', onLanguageChanged);

    // Surface the missing mj-hero / mj-section background traits so the hero
    // image (and section backgrounds) become editable from the Settings tab.
    const disposeTraits = attachBackgroundTraits(
      ed as unknown as Parameters<typeof attachBackgroundTraits>[0],
      t,
    );

    // Restore a previously-saved design, otherwise seed a blank MJML document.
    // A restore only "counts" if it still compiles to valid MJML — older designs
    // (pre-MJML builder) load as non-MJML junk that exports broken email, so we
    // drop them and surface a notice rather than rendering garbage.
    let restored = false;
    if (seedRef.current) {
      try {
        const parsed = JSON.parse(seedRef.current) as Record<string, unknown>;
        (ed.loadProjectData as (d: unknown) => void)(parsed);
        if (exportIsValid(ed)) {
          restored = true;
        } else {
          logError('NewsletterBuilder: restored design_json is not valid MJML — dropping it');
          setLegacyNotice(true);
        }
      } catch (err) {
        logError('NewsletterBuilder: could not restore design_json', err);
        setLegacyNotice(true);
      }
    }
    let seededBlank = false;
    if (!restored) {
      const mjml = initialMjmlRef.current;
      const hasStarterMjml = Boolean(mjml && mjml.trim().startsWith('<mjml'));
      ed.setComponents(hasStarterMjml ? mjml! : defaultNewsletterMjml(t));
      seededBlank = !hasStarterMjml;
    }
    // Offer starter templates over a genuinely blank canvas. Arm the dismiss
    // slightly later so the seed's own component:add events don't hide it.
    if (seededBlank && enableTemplates) {
      setShowFirstRun(true);
      setTimeout(() => {
        firstRunArmedRef.current = true;
      }, 400);
    }

    const scheduleEmit = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const current = editorRef.current;
        if (!current) return;
        try {
          const projectData = current.getProjectData();
          onChangeRef.current({ html: exportHtml(current), designJson: JSON.stringify(projectData) });
        } catch (err) {
          logError('NewsletterBuilder: export failed', err);
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    };
    scheduleEmitRef.current = scheduleEmit;

    const handleUpdate = () => {
      syncUndoState();
      scheduleEmit();
    };
    const syncSelection = () => setHasSelection(Boolean(editorRef.current?.getSelected()));
    const syncDevice = () => setDevice((editorRef.current?.getDevice() as BuilderDevice) ?? 'Desktop');

    // Defensive: if any path adds an image with a client-only blob:/data: src,
    // swap in the last uploaded absolute url so it survives into the email. The
    // backend send-path net strips anything that still slips through.
    const handleComponentAdd = (comp: unknown) => {
      const c = comp as GjsComp | undefined;
      const tag = c ? ((c.get?.('tagName') as string) || (c.get?.('type') as string)) : '';
      if ((tag === 'mj-image' || tag === 'image') && c?.get && c.set) {
        const attrs = c.get('attributes') as { src?: string } | undefined;
        const src = (c.get('src') as string | undefined) ?? attrs?.src;
        if (isEphemeralSrc(src) && lastUploadRef.current) {
          c.set('src', lastUploadRef.current);
        }
      }
      if (firstRunArmedRef.current) setShowFirstRun(false);
    };

    ed.on('update', handleUpdate);
    ed.on('component:selected component:deselected', syncSelection);
    ed.on('change:device', syncDevice);
    ed.on('component:add', handleComponentAdd);

    setEditor(ed);
    syncUndoState();

    return () => {
      ed.off('update', handleUpdate);
      ed.off('component:selected component:deselected', syncSelection);
      ed.off('change:device', syncDevice);
      ed.off('component:add', handleComponentAdd);
      i18n.off('languageChanged', onLanguageChanged);
      disposeTraits();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      try {
        ed.destroy();
      } catch {
        /* already torn down */
      }
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once; seed is a mount-time snapshot
  }, []);

  const handleUndo = () => {
    (editorRef.current?.UndoManager as unknown as UndoLike | undefined)?.undo?.();
    syncUndoState();
  };
  const handleRedo = () => {
    (editorRef.current?.UndoManager as unknown as UndoLike | undefined)?.redo?.();
    syncUndoState();
  };
  const handleSetDevice = (next: BuilderDevice) => {
    editorRef.current?.setDevice(next);
    setDevice(next);
  };
  const handleToggleBorders = () => {
    const ed = editorRef.current;
    if (!ed) return;
    if (showBorders) ed.stopCommand('sw-visibility');
    else ed.runCommand('sw-visibility');
    setShowBorders((v) => !v);
  };
  const handleViewCode = () => {
    const ed = editorRef.current;
    if (!ed) return;
    try {
      setCodeHtml(exportHtml(ed));
      setCodeOpen(true);
    } catch (err) {
      logError('NewsletterBuilder: view code failed', err);
    }
  };
  const handleClear = async () => {
    const ok = await confirm({
      title: t('newsletter_content_editor.builder_reset'),
      body: t('newsletter_content_editor.builder_reset_confirm'),
      status: 'warning',
      confirmLabel: t('newsletter_content_editor.builder_reset'),
    });
    if (!ok) return;
    editorRef.current?.setComponents(defaultNewsletterMjml(t));
    setLegacyNotice(false);
  };
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(codeHtml);
      toast.success(t('newsletter_content_editor.code_copied'));
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  // Apply an uploaded ABSOLUTE image url to the canvas: repoint the open/selected
  // image, else insert a fresh mj-image (and reveal its Settings so alt/link are
  // editable). Shared by the toolbar button and the asset-manager uploadFile.
  const applyServerImage = (url: string, target?: GjsComp) => {
    const ed = editorRef.current;
    if (!ed) return;
    lastUploadRef.current = url;
    const am = ed.AssetManager;
    try {
      am?.add?.(url);
    } catch {
      /* asset-library add is best-effort */
    }
    const amTarget = (am as unknown as { getTarget?: () => GjsComp | undefined }).getTarget?.();
    const tgt = target ?? amTarget ?? (ed.getSelected() as unknown as GjsComp | undefined);
    const action = imageActionFor(tgt);
    if (action === 'hero-background' && tgt?.addAttributes) {
      // A hero IS a background image — set it, and reveal Settings so the other
      // hero controls (height/overlay/etc.) are to hand.
      tgt.addAttributes({ 'background-url': url });
      setActiveTab('settings');
    } else if (action === 'set-src' && tgt?.set) {
      tgt.set('src', url);
    } else {
      const added = insertImageComponent(ed as unknown as EditorLike, url);
      if (added) {
        try {
          (ed as unknown as { select?: (c: unknown) => void }).select?.(added);
        } catch {
          /* selection is best-effort */
        }
        setActiveTab('settings');
      }
    }
    try {
      (ed.Modal as unknown as { close?: () => void })?.close?.();
    } catch {
      /* modal may not be open */
    }
    scheduleEmitRef.current();
  };
  applyImageRef.current = applyServerImage;

  const handlePreview = () => {
    const ed = editorRef.current;
    if (!ed) return;
    try {
      setPreviewHtml(exportHtml(ed));
      setPreviewOpen(true);
    } catch (err) {
      logError('NewsletterBuilder: preview failed', err);
    }
  };

  // Picking from the asset library applies to the current target (hero bg / image
  // src / a fresh mj-image) via the same pipeline as an upload.
  const handleLibrarySelect = (url: string) => applyServerImage(url);

  // Discoverable "Insert image" — upload through our domain, apply an absolute
  // url at the selection. Same pipeline the asset manager uses, surfaced.
  const handleInsertImageClick = () => fileRef.current?.click();
  const handleImageFile = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = ''; // allow re-picking the same file
    if (!file || !editorRef.current) return;
    setInsertingImage(true);
    try {
      const url = resolveUploadedUrl(await adminNewsletters.uploadImage(file));
      if (!url) {
        toast.error(t('newsletter_content_editor.image_upload_failed'));
        return;
      }
      applyServerImage(url);
    } catch (err) {
      logError('NewsletterBuilder: insert image failed', err);
      toast.error(t('newsletter_content_editor.image_upload_failed'));
    } finally {
      setInsertingImage(false);
    }
  };

  const handleOpenTemplates = async () => {
    if (!templatesLoaded) {
      try {
        const res = await adminNewsletters.getTemplates();
        const rows = res.success && Array.isArray(res.data) ? (res.data as GalleryTemplate[]) : [];
        // Only builder-format templates load losslessly into the canvas.
        setTemplates(rows.filter((r) => (r.content_format ?? 'builder') === 'builder'));
        setTemplatesLoaded(true);
      } catch (err) {
        logError('NewsletterBuilder: could not load templates', err);
      }
    }
    setTemplatesOpen(true);
  };

  const applyTemplate = async (tpl: GalleryTemplate) => {
    const ed = editorRef.current;
    if (!ed) return;
    const ok = await confirm({
      title: t('newsletter_builder.apply_template_title'),
      body: t('newsletter_builder.apply_template_confirm'),
      status: 'warning',
      confirmLabel: t('newsletter_builder.apply_template_confirm_cta'),
    });
    if (!ok) return;
    try {
      const dj = (tpl as { design_json?: string | null }).design_json;
      if (dj) {
        (ed.loadProjectData as (d: unknown) => void)(JSON.parse(dj));
        if (!exportIsValid(ed) && tpl.content) ed.setComponents(tpl.content);
      } else if (tpl.content) {
        ed.setComponents(tpl.content); // MJML markup → parsed into mj-* components
      }
      setLegacyNotice(false);
      setShowFirstRun(false);
      scheduleEmitRef.current();
    } catch (err) {
      logError('NewsletterBuilder: apply template failed', err);
      toast.error(t('newsletter_builder.apply_template_failed'));
    }
  };

  if (failed) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border p-8 text-center text-sm text-muted">
        {t('newsletter_content_editor.builder_error')}
      </div>
    );
  }

  const frame = (
    <div
      className={
        fill
          ? 'nb-root relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface'
          : 'nb-root relative flex h-[720px] flex-col overflow-hidden rounded-lg border-2 border-border bg-surface'
      }
    >
      <BuilderToolbar
        ready={Boolean(editor)}
        readOnly={readOnly}
        device={device}
        showBorders={showBorders}
        canUndo={canUndo}
        canRedo={canRedo}
        insertingImage={insertingImage}
        showTemplates={Boolean(enableTemplates)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSetDevice={handleSetDevice}
        onToggleBorders={handleToggleBorders}
        onInsertImage={handleInsertImageClick}
        onOpenLibrary={() => setLibraryOpen(true)}
        onOpenTemplates={handleOpenTemplates}
        onPreview={handlePreview}
        onViewCode={handleViewCode}
        onClear={handleClear}
        t={t}
      />

      {legacyNotice && (
        <div className="flex items-start gap-2 border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          <Info size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <span className="flex-1">{t('newsletter_builder.legacy_notice')}</span>
          <button
            type="button"
            onClick={() => setLegacyNotice(false)}
            aria-label={t('newsletter_builder.dismiss')}
            className="shrink-0 text-muted hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <BuilderBlockPalette
          blocksRef={blocksRef}
          title={t('newsletter_content_editor.palette_title')}
          collapsed={paletteCollapsed}
          onToggleCollapse={() => setPaletteCollapsed((v) => !v)}
          expandLabel={t('newsletter_builder.show_blocks')}
          collapseLabel={t('newsletter_builder.hide_blocks')}
        />
        <main className="nb-canvas relative min-w-0 flex-1 overflow-hidden">
          <div ref={canvasRef} className="h-full w-full" />
          {showFirstRun && !readOnly && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-sm rounded-xl border border-border bg-surface p-6 text-center shadow-lg">
                <LayoutTemplate size={28} className="mx-auto mb-3 text-primary" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">{t('newsletter_builder.empty_title')}</h3>
                <p className="mt-1 text-xs text-muted">{t('newsletter_builder.empty_desc')}</p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    startContent={<LayoutTemplate size={15} />}
                    onPress={() => {
                      setShowFirstRun(false);
                      void handleOpenTemplates();
                    }}
                  >
                    {t('newsletter_builder.empty_start_template')}
                  </Button>
                  <Button size="sm" variant="tertiary" onPress={() => setShowFirstRun(false)}>
                    {t('newsletter_builder.empty_start_blank')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </main>
        <BuilderInspector
          stylesRef={stylesRef}
          traitsRef={traitsRef}
          layersRef={layersRef}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          hasSelection={hasSelection}
          collapsed={inspectorCollapsed}
          onToggleCollapse={() => setInspectorCollapsed((v) => !v)}
          expandLabel={t('newsletter_builder.show_inspector')}
          collapseLabel={t('newsletter_builder.hide_inspector')}
          labels={{
            ariaLabel: t('newsletter_content_editor.inspector_label'),
            style: t('newsletter_content_editor.inspector_style'),
            settings: t('newsletter_content_editor.inspector_settings'),
            layers: t('newsletter_content_editor.inspector_layers'),
            empty: t('newsletter_content_editor.empty_inspector'),
          }}
        />
      </div>

      {readOnly && (
        <div className="absolute inset-0 z-10 cursor-not-allowed bg-white/40" aria-hidden="true" />
      )}
    </div>
  );

  const overlays = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFile}
        aria-hidden="true"
        tabIndex={-1}
      />

      {enableTemplates && (
        <TemplateGalleryModal
          isOpen={templatesOpen}
          onClose={() => setTemplatesOpen(false)}
          templates={templates}
          onSelect={applyTemplate}
        />
      )}

      <BuilderPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        html={previewHtml}
        t={t}
      />

      {libraryOpen && (
        <Suspense fallback={null}>
          <AssetLibraryModal
            isOpen={libraryOpen}
            onClose={() => setLibraryOpen(false)}
            onSelect={handleLibrarySelect}
            labels={{
              title: t('newsletter_builder.library_title'),
              upload: t('newsletter_builder.library_upload'),
              empty: t('newsletter_builder.library_empty'),
              loadFailed: t('newsletter_builder.library_failed'),
              uploadFailed: t('newsletter_content_editor.image_upload_failed'),
            }}
          />
        </Suspense>
      )}

      <Modal isOpen={codeOpen} onOpenChange={setCodeOpen} size="3xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>{t('newsletter_content_editor.code_modal_title')}</ModalHeader>
          <ModalBody>
            <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-surface p-3 text-xs text-foreground">
              <code>{codeHtml}</code>
            </pre>
          </ModalBody>
          <ModalFooter>
            <Button variant="primary" size="sm" startContent={<Copy size={14} />} onPress={copyCode}>
              {t('newsletter_content_editor.code_copy')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );

  if (fill) {
    return (
      <>
        {frame}
        {overlays}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">
        {t('newsletter_content_editor.mode_design')}
      </label>
      {frame}
      {overlays}
    </div>
  );
}

export default NewsletterBuilder;
