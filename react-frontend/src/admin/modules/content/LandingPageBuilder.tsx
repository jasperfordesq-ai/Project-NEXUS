// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Landing page editor (/admin/landing-page).
 *
 * Edits the public front page a visitor sees before signing in. The page is
 * seven blocks stacked top to bottom; each can be shown or hidden, moved, and
 * given its own wording. An empty box keeps the standard wording.
 *
 * Layout: a "Page order" outline on the left (drag, arrows, Shown switch), the
 * selected block on the right with a live preview of the real public section
 * above its form, and a sticky save bar. Nothing reaches visitors until Save.
 * Redesigned 2026-10-17; see .local-docs-archive/landing-page-builder-redesign/.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ChevronUp from 'lucide-react/icons/chevron-up';
import ChevronDown from 'lucide-react/icons/chevron-down';
import GripVertical from 'lucide-react/icons/grip-vertical';
import ExternalLink from 'lucide-react/icons/external-link';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Undo2 from 'lucide-react/icons/undo-2';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import Info from 'lucide-react/icons/info';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import { Alert, Button, Card, CardBody, Chip, Spinner, Switch, useConfirm } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import type {
  AudienceCardsContent,
  CoreValuesContent,
  CtaContent,
  FeaturePillsContent,
  HeroContent,
  HowItWorksContent,
  LandingPageConfig,
  LandingSection,
} from '@/types/landing-page';
import { adminLandingPage } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { AdminSaveBar } from '../../components/AdminSaveBar';
import { useUnsavedChangesGuard } from '../../components/useUnsavedChangesGuard';
import {
  cleanConfig,
  cloneConfig,
  configSignature,
  defaultConfig,
  findConfigProblems,
  isDefaultConfig,
  moveSectionBy,
  moveSectionTo,
  normaliseLoadedConfig,
  sectionHasCustomContent,
  sortedSections,
  withListKeys,
  type ConfigProblem,
} from './landing-page-builder/configUtils';
import { SECTION_META } from './landing-page-builder/sectionMeta';
import { SectionPreview, WholePagePreview } from './landing-page-builder/SectionPreview';
import {
  AudienceCardsEditor,
  CoreValuesEditor,
  CtaEditor,
  FeaturePillsEditor,
  HeroEditor,
  HowItWorksEditor,
  StatsEditor,
} from './landing-page-builder/editors';

// ─────────────────────────────────────────────────────────────────────────────
// Outline row
// ─────────────────────────────────────────────────────────────────────────────

function OutlineRow({
  section,
  position,
  total,
  isSelected,
  onSelect,
  onToggleEnabled,
  onMove,
}: {
  section: LandingSection;
  position: number;
  total: number;
  isSelected: boolean;
  onSelect: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onMove: (direction: 'up' | 'down') => void;
}) {
  const { t } = useTranslation('admin_content');
  const meta = SECTION_META[section.type];
  const name = t(meta.nameKey);
  const Icon = meta.icon;
  const customised = sectionHasCustomContent(section);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <li ref={setNodeRef} style={style} aria-current={isSelected ? 'true' : undefined}>
      {/* The row's onClick only widens the pointer hit area: the block name below
          is a real button that selects on keyboard, so no role/tabIndex here (the
          nested-interactive check exists to stop a focusable wrapper around
          focusable controls). */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        onClick={onSelect}
        className={`flex cursor-pointer items-start gap-1.5 rounded-xl border p-2 transition-colors ${
          isSelected ? 'border-accent bg-accent/5' : 'border-border bg-surface hover:border-border-secondary'
        }`}
      >
      <Button
        isIconOnly
        variant="tertiary"
        size="sm"
        className="min-h-8 min-w-8 shrink-0 cursor-grab self-center p-0.5 text-muted hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label={t('content.landing_drag_to_reorder', { block: name })}
      >
        <GripVertical size={16} aria-hidden="true" />
      </Button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Name row: icon, name, Shown switch. The switch stops the row's select. */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent ${section.enabled ? '' : 'opacity-60'}`}
          >
            <Icon size={14} aria-hidden="true" />
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className={`min-w-0 flex-1 truncate text-left text-sm font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${section.enabled ? '' : 'opacity-60'}`}
          >
            {name}
          </button>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <Switch
              size="sm"
              isSelected={section.enabled}
              onValueChange={onToggleEnabled}
              aria-label={t('content.landing_show_block', { block: name })}
            />
          </span>
        </div>
        <p className={`line-clamp-2 text-xs text-muted ${section.enabled ? '' : 'opacity-60'}`}>{t(meta.descKey)}</p>
        {/* Status row: position, chips, move arrows. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <span className="text-[11px] text-muted">{t('content.landing_position', { position, total })}</span>
          {!section.enabled && (
            <Chip size="sm" variant="soft" color="default" startContent={<EyeOff size={11} aria-hidden="true" />}>
              {t('content.landing_hidden')}
            </Chip>
          )}
          {customised && (
            <Chip size="sm" variant="soft" color="accent">
              {t('content.landing_status_customised')}
            </Chip>
          )}
          <span className="ml-auto flex items-center">
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              className="min-h-7 min-w-7"
              isDisabled={position === 1}
              onPress={() => onMove('up')}
              aria-label={t('content.landing_move_up', { section: name })}
            >
              <ChevronUp size={14} aria-hidden="true" />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              className="min-h-7 min-w-7"
              isDisabled={position === total}
              onPress={() => onMove('down')}
              aria-label={t('content.landing_move_down', { section: name })}
            >
              <ChevronDown size={14} aria-hidden="true" />
            </Button>
          </span>
        </div>
      </div>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Block editor pane
// ─────────────────────────────────────────────────────────────────────────────

function BlockEditor({
  section,
  allSections,
  onToggleEnabled,
  onContentChange,
  onClearContent,
}: {
  section: LandingSection;
  allSections: LandingSection[];
  onToggleEnabled: (enabled: boolean) => void;
  onContentChange: (content: LandingSection['content']) => void;
  onClearContent: () => void;
}) {
  const { t } = useTranslation('admin_content');
  const [previewMode, setPreviewMode] = useState<'block' | 'page'>('block');
  const meta = SECTION_META[section.type];
  const name = t(meta.nameKey);
  const Icon = meta.icon;
  const customised = sectionHasCustomContent(section);
  const anyShown = allSections.some((s) => s.enabled);

  const form = (() => {
    switch (section.type) {
      case 'hero':
        return <HeroEditor content={(section.content as HeroContent) ?? {}} onChange={onContentChange} />;
      case 'audience_cards':
        return <AudienceCardsEditor content={(section.content as AudienceCardsContent) ?? {}} onChange={onContentChange} />;
      case 'feature_pills':
        return <FeaturePillsEditor content={(section.content as FeaturePillsContent) ?? {}} onChange={onContentChange} />;
      case 'stats':
        return <StatsEditor />;
      case 'how_it_works':
        return <HowItWorksEditor content={(section.content as HowItWorksContent) ?? {}} onChange={onContentChange} />;
      case 'core_values':
        return <CoreValuesEditor content={(section.content as CoreValuesContent) ?? {}} onChange={onContentChange} />;
      case 'cta':
        return <CtaEditor content={(section.content as CtaContent) ?? {}} onChange={onContentChange} />;
      default:
        return null;
    }
  })();

  return (
    <Card className="border border-border bg-surface">
      <CardBody className="flex flex-col gap-5 p-4 sm:p-5">
        {/* Block header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Icon size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground">{name}</h2>
              <p className="text-sm text-muted">{t(meta.descKey)}</p>
            </div>
          </div>
          <Switch size="sm" isSelected={section.enabled} onValueChange={onToggleEnabled}>
            {t('content.landing_shown_on_page')}
          </Switch>
        </div>

        {/* Preview */}
        <section aria-labelledby="landing-preview-heading" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 id="landing-preview-heading" className="text-sm font-semibold text-foreground">
                {t('content.landing_preview_title')}
              </h3>
              <p className="text-xs text-muted">{t('content.landing_preview_hint')}</p>
            </div>
            <div className="flex items-center gap-1" role="group" aria-label={t('content.landing_preview_title')}>
              <Button
                size="sm"
                variant={previewMode === 'block' ? 'secondary' : 'tertiary'}
                aria-pressed={previewMode === 'block'}
                onPress={() => setPreviewMode('block')}
              >
                {t('content.landing_preview_this_block')}
              </Button>
              <Button
                size="sm"
                variant={previewMode === 'page' ? 'secondary' : 'tertiary'}
                aria-pressed={previewMode === 'page'}
                onPress={() => setPreviewMode('page')}
              >
                {t('content.landing_preview_whole_page')}
              </Button>
            </div>
          </div>
          {previewMode === 'block' ? (
            <>
              {!section.enabled && (
                <p className="flex items-center gap-2 rounded-lg bg-surface-secondary px-3 py-2 text-xs text-muted">
                  <EyeOff size={14} aria-hidden="true" />
                  {t('content.landing_preview_hidden_note')}
                </p>
              )}
              <SectionPreview section={section} label={t('content.landing_preview_aria_block', { block: name })} />
            </>
          ) : anyShown ? (
            <WholePagePreview sections={allSections} label={t('content.landing_preview_aria_page')} />
          ) : (
            <p className="rounded-lg bg-surface-secondary px-3 py-2 text-xs text-muted">
              {t('content.landing_preview_whole_page_empty')}
            </p>
          )}
        </section>

        {/* Form */}
        <section aria-label={t('content.landing_wording_heading', { block: name })} className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-foreground">{t('content.landing_wording_heading', { block: name })}</h3>
          {form}
          {customised && section.type !== 'stats' && (
            <div>
              <Button size="sm" variant="tertiary" startContent={<Undo2 size={14} aria-hidden="true" />} onPress={onClearContent}>
                {t('content.landing_clear_block_changes')}
              </Button>
            </div>
          )}
        </section>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export function LandingPageBuilder() {
  const { t } = useTranslation('admin_content');
  usePageTitle(t('content.landing_page_title'));
  const toast = useToast();
  const confirm = useConfirm();
  const { tenantPath } = useTenant();

  const [config, setConfig] = useState<LandingPageConfig>(defaultConfig);
  const [savedConfig, setSavedConfig] = useState<LandingPageConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('hero');
  const editorRef = useRef<HTMLDivElement>(null);

  // ─── Load ───────────────────────────────────────────────────────────────
  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminLandingPage.get();
      if (res.success && res.data) {
        const result = res.data as unknown as { config: LandingPageConfig | null };
        const loaded = result.config ? normaliseLoadedConfig(result.config) : defaultConfig();
        setConfig(loaded);
        setSavedConfig(cloneConfig(loaded));
        setSelectedId(sortedSections(loaded.sections)[0]?.id ?? 'hero');
      } else {
        toast.error(t('content.landing_failed_to_load'));
      }
    } catch {
      toast.error(t('content.landing_failed_to_load'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  // ─── Derived ────────────────────────────────────────────────────────────
  const sections = useMemo(() => sortedSections(config.sections), [config.sections]);
  const isDirty = useMemo(() => configSignature(config) !== configSignature(savedConfig), [config, savedConfig]);
  const problems = useMemo(() => findConfigProblems(config), [config]);
  const shownCount = sections.filter((s) => s.enabled).length;
  const selected = sections.find((s) => s.id === selectedId) ?? sections[0];

  useUnsavedChangesGuard(isDirty && !saving);

  const problemText = useCallback(
    (problem: ConfigProblem): string => {
      const block = t(SECTION_META[problem.sectionType].nameKey);
      switch (problem.kind) {
        case 'card_title':
          return t('content.landing_problem_card_title', { number: problem.number, block });
        case 'card_link':
          return t('content.landing_problem_card_link', { number: problem.number, block });
        case 'item_title':
          return t('content.landing_problem_item_title', { number: problem.number, block });
        case 'button_link':
          return t('content.landing_problem_button_link', { block });
        default:
          return '';
      }
    },
    [t],
  );

  // ─── Section operations ────────────────────────────────────────────────
  const updateSection = (id: string, updater: (s: LandingSection) => LandingSection) => {
    setConfig((prev) => ({ ...prev, sections: prev.sections.map((s) => (s.id === id ? updater(s) : s)) }));
  };
  const toggleEnabled = (id: string, enabled: boolean) => updateSection(id, (s) => ({ ...s, enabled }));
  const updateContent = (id: string, content: LandingSection['content']) => updateSection(id, (s) => ({ ...s, content }));
  const clearContent = (id: string) =>
    updateSection(id, (s) => {
      const { content: _dropped, ...rest } = s;
      return rest;
    });
  const move = (id: string, direction: 'up' | 'down') =>
    setConfig((prev) => ({ ...prev, sections: moveSectionBy(prev.sections, id, direction) }));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setConfig((prev) => ({ ...prev, sections: moveSectionTo(prev.sections, String(active.id), String(over.id)) }));
  };

  const select = (id: string) => {
    setSelectedId(id);
    // Below the two-column breakpoint (xl) the editor sits under the outline.
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1279px)').matches) {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // ─── Save / discard / start again ──────────────────────────────────────
  const handleSave = async () => {
    if (problems.length > 0) return;
    setSaving(true);
    try {
      const payload = isDefaultConfig(config) ? null : cleanConfig(config);
      const res = await adminLandingPage.update(payload);
      if (res.success) {
        setSavedConfig(cloneConfig(config));
        toast.success(t('content.landing_saved_live'));
      } else {
        toast.error(t('content.landing_failed_to_save'));
      }
    } catch {
      toast.error(t('content.landing_failed_to_save'));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setConfig(withListKeys(cloneConfig(savedConfig)));
    toast.info(t('content.landing_discarded'));
  };

  const handleStartAgain = async () => {
    const ok = await confirm({
      title: t('content.landing_start_again_confirm_title'),
      body: t('content.landing_start_again_confirm_body'),
      confirmLabel: t('content.landing_start_again_confirm'),
      status: 'warning',
    });
    if (!ok) return;
    setConfig(defaultConfig());
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div role="status" aria-busy="true" aria-label={t('content.landing_loading_aria')} className="flex justify-center py-4">
          <Spinner size="lg" label={t('content.landing_loading')} />
        </div>
      </div>
    );
  }

  const livePath = tenantPath('/');
  const liveUrl = typeof window !== 'undefined' ? new URL(livePath, window.location.origin).toString() : livePath;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('content.landing_builder_title')}
        description={t('content.landing_builder_description')}
        actions={
          <Button
            as="a"
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
            variant="secondary"
            endContent={<ExternalLink size={14} aria-hidden="true" />}
          >
            {t('content.landing_open_live_page')}
          </Button>
        }
      />

      {/* How this page works */}
      <Card className="mb-4 border border-border bg-surface">
        <CardBody className="flex flex-row items-start gap-3 p-4">
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
            <Info size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-foreground">{t('content.landing_intro_title')}</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-muted">
              <li>{t('content.landing_intro_blocks')}</li>
              <li>{t('content.landing_intro_blank')}</li>
              <li>{t('content.landing_intro_save')}</li>
              <li>{t('content.landing_intro_live_link')}</li>
            </ul>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] xl:items-start">
        {/* Page order */}
        <Card className="border border-border bg-surface xl:sticky xl:top-4">
          <CardBody className="flex flex-col gap-3 p-3 sm:p-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t('content.landing_outline_title')}</h2>
              <p className="text-xs text-muted">{t('content.landing_outline_hint')}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                <Eye size={12} aria-hidden="true" />
                {t('content.landing_blocks_shown_count', { shown: shownCount, total: sections.length })}
              </p>
            </div>
            {shownCount === 0 && (
              <Alert color="warning" title={t('content.landing_all_hidden_warning')} icon={<AlertTriangle size={16} />} />
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <ol className="flex flex-col gap-2" aria-label={t('content.landing_outline_title')}>
                  {sections.map((section, index) => (
                    <OutlineRow
                      key={section.id}
                      section={section}
                      position={index + 1}
                      total={sections.length}
                      isSelected={selected?.id === section.id}
                      onSelect={() => select(section.id)}
                      onToggleEnabled={(enabled) => toggleEnabled(section.id, enabled)}
                      onMove={(direction) => move(section.id, direction)}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          </CardBody>
        </Card>

        {/* Selected block */}
        <div ref={editorRef} className="min-w-0 scroll-mt-4">
          {selected && (
            <BlockEditor
              key={selected.id}
              section={selected}
              allSections={sections}
              onToggleEnabled={(enabled) => toggleEnabled(selected.id, enabled)}
              onContentChange={(content) => updateContent(selected.id, content)}
              onClearContent={() => clearContent(selected.id)}
            />
          )}
        </div>
      </div>

      {problems.length > 0 && (
        <Alert
          color="danger"
          className="mt-4"
          icon={<AlertTriangle size={16} />}
          title={t('content.landing_problems_title')}
          description={
            <ul className="list-disc pl-4">
              {problems.map((problem, index) => (
                <li key={index}>{problemText(problem)}</li>
              ))}
            </ul>
          }
        />
      )}

      <AdminSaveBar
        dirty={isDirty}
        saving={saving}
        blockedReason={problems.length > 0 ? problemText(problems[0]!) : null}
        onSave={handleSave}
        onDiscard={handleDiscard}
        saveLabel={t('content.landing_save_changes')}
        secondaryActions={
          <Button
            size="sm"
            variant="tertiary"
            startContent={<RotateCcw size={14} aria-hidden="true" />}
            onPress={handleStartAgain}
            isDisabled={saving}
          >
            {t('content.landing_start_again')}
          </Button>
        }
      />
    </div>
  );
}

export default LandingPageBuilder;
