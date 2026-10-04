import { Card, CardBody, CardHeader, Input, Button, Textarea, Spinner, Select, SelectItem, Switch, Chip } from '@/components/ui';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Separator } from '@/components/ui';
import ChevronUp from 'lucide-react/icons/chevron-up';
import ChevronDown from 'lucide-react/icons/chevron-down';
import Save from 'lucide-react/icons/save';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Layers from 'lucide-react/icons/layers';
import Sparkles from 'lucide-react/icons/sparkles';
import LayoutGrid from 'lucide-react/icons/layout-grid';
import ListChecks from 'lucide-react/icons/list-checks';
import BarChart3 from 'lucide-react/icons/bar-chart-3';
import Footprints from 'lucide-react/icons/footprints';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import Megaphone from 'lucide-react/icons/megaphone';
import type { LucideIcon } from 'lucide-react';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminLandingPage } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type {
  LandingPageConfig,
  LandingSection,
  LandingSectionType,
  LandingIconId,
  HeroContent,
  AudienceCardsContent,
  AudienceCard,
  FeaturePillsContent,
  FeaturePillItem,
  StatsContent,
  HowItWorksContent,
  HowItWorksStep,
  CoreValuesContent,
  CoreValue,
  CtaContent,
} from '@/types/landing-page';
import { DEFAULT_LANDING_PAGE_CONFIG, createDefaultAudienceCards } from '@/types/landing-page';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Landing Page Builder
 * Admin UI for customizing the tenant's public landing page sections.
 * Supports enable/disable, reorder, and content editing per section.
 */


// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_LABEL_KEYS: Record<LandingSectionType, string> = {
  hero: 'content.landing_section_hero',
  audience_cards: 'content.landing_section_audience_cards',
  feature_pills: 'content.landing_section_feature_pills',
  stats: 'content.landing_section_stats',
  how_it_works: 'content.landing_section_how_it_works',
  core_values: 'content.landing_section_core_values',
  cta: 'content.landing_section_cta',
};

const SECTION_ICONS: Record<LandingSectionType, LucideIcon> = {
  hero: Sparkles,
  audience_cards: LayoutGrid,
  feature_pills: ListChecks,
  stats: BarChart3,
  how_it_works: Footprints,
  core_values: HeartHandshake,
  cta: Megaphone,
};

const ICON_OPTIONS: LandingIconId[] = [
  'clock',
  'users',
  'zap',
  'user-plus',
  'search',
  'handshake',
  'coins',
  'heart',
  'shield',
  'star',
  'globe',
  'book-open',
  'message-circle',
  'award',
  'target',
  'thumbs-up',
];

const HELPER_TEXT_KEY = 'content.landing_helper_text';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Deep-clone a config to avoid mutation */
function cloneConfig(config: LandingPageConfig): LandingPageConfig {
  return JSON.parse(JSON.stringify(config));
}

/** Monotonic client-only id source for stable list keys (never persisted). */
let _listKeySeq = 0;
function genListKey(): string {
  _listKeySeq += 1;
  return `lpk-${_listKeySeq}`;
}

/**
 * Inject a stable client-only `_key` into every content-array item that lacks one,
 * so React keys survive reorder/delete — index keys misassociate input focus/state
 * when items move. cleanConfig() strips `_key` again before save, so the persisted
 * config (and the public landing page) never sees it.
 */
function withListKeys(config: LandingPageConfig): LandingPageConfig {
  const next = cloneConfig(config);
  for (const section of next.sections) {
    if (!section.content) continue;
    const content = section.content as Record<string, unknown>;
    for (const key of Object.keys(content)) {
      const val = content[key];
      if (!Array.isArray(val)) continue;
      for (const item of val) {
        if (item && typeof item === 'object' && !(item as Record<string, unknown>)._key) {
          (item as Record<string, unknown>)._key = genListKey();
        }
      }
    }
  }
  return next;
}

/** Sort sections by order */
function sortedSections(sections: LandingSection[]): LandingSection[] {
  return [...sections].sort((a, b) => a.order - b.order);
}

/**
 * Strip empty content fields so the backend only gets explicitly set values.
 * If all fields in a section's content are empty, remove the content key entirely.
 */
function cleanConfig(config: LandingPageConfig): LandingPageConfig {
  const cleaned = cloneConfig(config);
  for (const section of cleaned.sections) {
    if (!section.content) continue;
    const content = section.content as Record<string, unknown>;
    // Remove empty string values at the top level
    for (const key of Object.keys(content)) {
      const val = content[key];
      if (val === '' || val === undefined || val === null) {
        delete content[key];
      }
      // Clean arrays: strip the client-only `_key`, then remove all-empty items.
      if (Array.isArray(val)) {
        const filtered = val
          .map((item: Record<string, unknown>) => {
            const rest = { ...item };
            delete rest._key;
            return rest;
          })
          .filter((item: Record<string, unknown>) =>
            Object.values(item).some(
              (v) => v !== '' && v !== undefined && v !== null,
            ),
          );
        if (filtered.length === 0) {
          delete content[key];
        } else {
          content[key] = filtered;
        }
      }
    }
    // If content is now empty, remove it
    if (Object.keys(content).length === 0) {
      delete section.content;
    }
  }
  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon Select Component
// ─────────────────────────────────────────────────────────────────────────────

function IconSelect({
  value,
  onChange,
  label,
  placeholder,
}: {
  value?: LandingIconId;
  onChange: (val: LandingIconId | undefined) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <Select
      label={label}
      placeholder={placeholder}
      selectedKeys={value ? [value] : []}
      onSelectionChange={(keys) => {
        const selected = Array.from(keys)[0] as string | undefined;
        onChange(selected as LandingIconId | undefined);
      }}
      variant="secondary"
      size="sm"
    >
      {ICON_OPTIONS.map((icon) => (
        <SelectItem key={icon} id={icon}>{icon}</SelectItem>
      ))}
    </Select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section Content Editors
// ─────────────────────────────────────────────────────────────────────────────

function HeroEditor({
  content,
  onChange,
}: {
  content: HeroContent;
  onChange: (c: HeroContent) => void;
}) {
  const { t } = useTranslation('admin_content');
  const update = (field: keyof HeroContent, value: string) => {
    onChange({ ...content, [field]: value });
  };
  return (
    <div className="flex flex-col gap-4">
      <Input
        label={t('content.landing_label_badge_text')}
        placeholder={t('content.landing_placeholder_badge_text')}
        value={content.badge_text || ''}
        onValueChange={(v) => update('badge_text', v)}
        variant="secondary"
        size="sm"
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          label={t('content.landing_label_headline_line_1')}
          placeholder={t('content.landing_placeholder_headline_1')}
          value={content.headline_1 || ''}
          onValueChange={(v) => update('headline_1', v)}
          variant="secondary"
          size="sm"
        />
        <Input
          label={t('content.landing_label_headline_line_2')}
          placeholder={t('content.landing_placeholder_headline_2')}
          value={content.headline_2 || ''}
          onValueChange={(v) => update('headline_2', v)}
          variant="secondary"
          size="sm"
        />
      </div>
      <Textarea
        label={t('content.landing_label_subheadline')}
        placeholder={t('content.landing_placeholder_subheadline')}
        value={content.subheadline || ''}
        onValueChange={(v) => update('subheadline', v)}
        variant="secondary"
        size="sm"
        minRows={2}
      />
      <Separator />
      <p className="text-sm font-medium text-muted">{t('content.landing_primary_cta')}</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          label={t('content.landing_label_button_text')}
          placeholder={t('content.landing_placeholder_button_text_get_started')}
          value={content.cta_primary_text || ''}
          onValueChange={(v) => update('cta_primary_text', v)}
          variant="secondary"
          size="sm"
        />
        <Input
          label={t('content.landing_label_button_link')}
          placeholder={t('content.landing_placeholder_button_link_register')}
          value={content.cta_primary_link || ''}
          onValueChange={(v) => update('cta_primary_link', v)}
          variant="secondary"
          size="sm"
        />
      </div>
      <p className="text-sm font-medium text-muted">{t('content.landing_secondary_cta')}</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          label={t('content.landing_label_button_text')}
          placeholder={t('content.landing_placeholder_button_text_learn_more')}
          value={content.cta_secondary_text || ''}
          onValueChange={(v) => update('cta_secondary_text', v)}
          variant="secondary"
          size="sm"
        />
        <Input
          label={t('content.landing_label_button_link')}
          placeholder={t('content.landing_placeholder_button_link_about')}
          value={content.cta_secondary_link || ''}
          onValueChange={(v) => update('cta_secondary_link', v)}
          variant="secondary"
          size="sm"
        />
      </div>
      <p className="text-xs text-muted">{t(HELPER_TEXT_KEY)}</p>
    </div>
  );
}

function AudienceCardsEditor({
  content,
  onChange,
}: {
  content: AudienceCardsContent;
  onChange: (c: AudienceCardsContent) => void;
}) {
  const { t } = useTranslation('admin_content');
  const { t: tPublic } = useTranslation('public');
  const cards = content.cards || [];

  const updateCard = (index: number, field: keyof AudienceCard, value: string) => {
    const updated: AudienceCard[] = [...cards];
    updated[index] = { ...updated[index], [field]: value } as AudienceCard;
    onChange({ ...content, cards: updated });
  };

  const updateCardIcon = (index: number, value: LandingIconId | undefined) => {
    const updated: AudienceCard[] = [...cards];
    updated[index] = { ...updated[index], icon: value } as AudienceCard;
    onChange({ ...content, cards: updated });
  };

  const moveCard = (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= cards.length) return;
    const updated: AudienceCard[] = [...cards];
    const current = updated[index];
    const swap = updated[swapIndex];
    if (!current || !swap) return;
    updated[index] = swap;
    updated[swapIndex] = current;
    onChange({ ...content, cards: updated });
  };

  const addCard = () => {
    if (cards.length >= 4) return;
    onChange({
      ...content,
      cards: [
        ...cards,
        { _key: genListKey(), title: '', description: '', cta_label: t('content.landing_default_cta_learn_more'), target_url: '/' },
      ],
    });
  };

  const removeCard = (index: number) => {
    onChange({ ...content, cards: cards.filter((_, i) => i !== index) });
  };

  const resetToDefaults = () => {
    onChange({ ...content, cards: createDefaultAudienceCards((key) => tPublic(key)) });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          label={t('content.landing_label_section_title_optional')}
          placeholder={t('content.landing_placeholder_audience_title')}
          value={content.title || ''}
          onValueChange={(v) => onChange({ ...content, title: v })}
          variant="secondary"
          size="sm"
        />
        <Input
          label={t('content.landing_label_section_subtitle_optional')}
          placeholder={t('content.landing_placeholder_audience_subtitle')}
          value={content.subtitle || ''}
          onValueChange={(v) => onChange({ ...content, subtitle: v })}
          variant="secondary"
          size="sm"
        />
      </div>
      <Separator />
      <p className="text-xs text-muted">
        {t('content.landing_audience_cards_hint')}
      </p>
      {cards.map((card, i) => (
        <Card key={card._key ?? i} variant="transparent" className="border border-border bg-surface">
          <CardBody className="flex flex-col gap-3 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {t('content.landing_card_number', { number: i + 1 })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  isDisabled={i === 0}
                  onPress={() => moveCard(i, 'up')}
                  aria-label={t('content.landing_move_card_up', { number: i + 1 })}
                >
                  <ChevronUp size={14} />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  isDisabled={i === cards.length - 1}
                  onPress={() => moveCard(i, 'down')}
                  aria-label={t('content.landing_move_card_down', { number: i + 1 })}
                >
                  <ChevronDown size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="danger-soft"
                  startContent={<Trash2 size={14} />}
                  onPress={() => removeCard(i)}
                >
                  {t('content.landing_remove')}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <IconSelect
                value={card.icon}
                onChange={(val) => updateCardIcon(i, val)}
                label={t('content.landing_label_icon')}
                placeholder={t('content.landing_placeholder_select_icon')}
              />
              <Input
                label={t('content.landing_label_title')}
                placeholder={t('content.landing_placeholder_card_title')}
                value={card.title}
                onValueChange={(v) => updateCard(i, 'title', v)}
                variant="secondary"
                size="sm"
              />
            </div>
            <Textarea
              label={t('content.landing_label_description')}
              placeholder={t('content.landing_placeholder_card_description')}
              value={card.description}
              onValueChange={(v) => updateCard(i, 'description', v)}
              variant="secondary"
              size="sm"
              minRows={2}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input
                label={t('content.landing_label_button_label')}
                placeholder={t('content.landing_placeholder_button_text_get_started')}
                value={card.cta_label}
                onValueChange={(v) => updateCard(i, 'cta_label', v)}
                variant="secondary"
                size="sm"
              />
              <Input
                label={t('content.landing_label_link')}
                placeholder={t('content.landing_placeholder_button_link_about')}
                value={card.target_url}
                onValueChange={(v) => updateCard(i, 'target_url', v)}
                variant="secondary"
                size="sm"
              />
            </div>
          </CardBody>
        </Card>
      ))}
      <div className="flex flex-wrap gap-2">
        {cards.length < 4 && (
          <Button
            size="sm"
            variant="secondary"
            startContent={<Plus size={14} />}
            onPress={addCard}
          >
            {t('content.landing_add_card')}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          startContent={<RotateCcw size={14} />}
          onPress={resetToDefaults}
        >
          {t('content.landing_reset_cards_to_defaults')}
        </Button>
      </div>
      <p className="text-xs text-muted">{t(HELPER_TEXT_KEY)}</p>
    </div>
  );
}

function FeaturePillsEditor({
  content,
  onChange,
}: {
  content: FeaturePillsContent;
  onChange: (c: FeaturePillsContent) => void;
}) {
  const { t } = useTranslation('admin_content');
  const items = content.items || [];

  const updateItem = (index: number, field: keyof FeaturePillItem, value: string) => {
    const updated: FeaturePillItem[] = [...items];
    updated[index] = { ...updated[index], [field]: value } as FeaturePillItem;
    onChange({ ...content, items: updated });
  };

  const updateItemIcon = (index: number, value: LandingIconId | undefined) => {
    const updated: FeaturePillItem[] = [...items];
    updated[index] = { ...updated[index], icon: value } as FeaturePillItem;
    onChange({ ...content, items: updated });
  };

  const addItem = () => {
    if (items.length >= 6) return;
    onChange({
      ...content,
      items: [...items, { _key: genListKey(), title: '', description: '' }],
    });
  };

  const removeItem = (index: number) => {
    const updated = items.filter((_, i) => i !== index);
    onChange({ ...content, items: updated });
  };

  return (
    <div className="flex flex-col gap-4">
      {items.map((item, i) => (
        <Card key={item._key ?? i} variant="transparent" className="border border-border bg-surface">
          <CardBody className="flex flex-col gap-3 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {t('content.landing_item_number', { number: i + 1 })}
              </span>
              <Button
                size="sm"
                variant="danger-soft"
                startContent={<Trash2 size={14} />}
                onPress={() => removeItem(i)}
              >
                {t('content.landing_remove')}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <IconSelect
                value={item.icon}
                onChange={(val) => updateItemIcon(i, val)}
                label={t('content.landing_label_icon')}
                placeholder={t('content.landing_placeholder_select_icon')}
              />
              <Input
                label={t('content.landing_label_title')}
                value={item.title}
                onValueChange={(v) => updateItem(i, 'title', v)}
                variant="secondary"
                size="sm"
              />
              <Input
                label={t('content.landing_label_description')}
                value={item.description}
                onValueChange={(v) => updateItem(i, 'description', v)}
                variant="secondary"
                size="sm"
              />
            </div>
          </CardBody>
        </Card>
      ))}
      {items.length < 6 && (
        <Button
          size="sm"
          variant="secondary"
          startContent={<Plus size={14} />}
          onPress={addItem}
          className="self-start"
        >
          {t('content.landing_add_item')}
        </Button>
      )}
      <p className="text-xs text-muted">{t(HELPER_TEXT_KEY)}</p>
    </div>
  );
}

function StatsEditor({
  content,
  onChange,
}: {
  content: StatsContent;
  onChange: (c: StatsContent) => void;
}) {
  const { t } = useTranslation('admin_content');
  return (
    <div className="flex flex-col gap-4">
      <Switch
        isSelected={content.show_live_stats !== false}
        onValueChange={(val) => onChange({ ...content, show_live_stats: val })}
        size="sm"
      >
        {t('content.landing_show_live_stats')}
      </Switch>
      <p className="text-xs text-muted">
        {t('content.landing_show_live_stats_desc')}
      </p>
    </div>
  );
}

function HowItWorksEditor({
  content,
  onChange,
}: {
  content: HowItWorksContent;
  onChange: (c: HowItWorksContent) => void;
}) {
  const { t } = useTranslation('admin_content');
  const steps = content.steps || [];

  const updateStep = (index: number, field: keyof HowItWorksStep, value: string) => {
    const updated: HowItWorksStep[] = [...steps];
    updated[index] = { ...updated[index], [field]: value } as HowItWorksStep;
    onChange({ ...content, steps: updated });
  };

  const updateStepIcon = (index: number, value: LandingIconId | undefined) => {
    const updated: HowItWorksStep[] = [...steps];
    updated[index] = { ...updated[index], icon: value } as HowItWorksStep;
    onChange({ ...content, steps: updated });
  };

  const addStep = () => {
    onChange({
      ...content,
      steps: [...steps, { _key: genListKey(), title: '', description: '' }],
    });
  };

  const removeStep = (index: number) => {
    onChange({ ...content, steps: steps.filter((_, i) => i !== index) });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          label={t('content.landing_label_section_title')}
          placeholder={t('content.landing_placeholder_section_title_how_it_works')}
          value={content.title || ''}
          onValueChange={(v) => onChange({ ...content, title: v })}
          variant="secondary"
          size="sm"
        />
        <Input
          label={t('content.landing_label_section_subtitle')}
          placeholder={t('content.landing_placeholder_section_subtitle_how_it_works')}
          value={content.subtitle || ''}
          onValueChange={(v) => onChange({ ...content, subtitle: v })}
          variant="secondary"
          size="sm"
        />
      </div>
      <Separator />
      {steps.map((step, i) => (
        <Card key={step._key ?? i} variant="transparent" className="border border-border bg-surface">
          <CardBody className="flex flex-col gap-3 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {t('content.landing_step_number', { number: i + 1 })}
              </span>
              <Button
                size="sm"
                variant="danger-soft"
                startContent={<Trash2 size={14} />}
                onPress={() => removeStep(i)}
              >
                {t('content.landing_remove')}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <IconSelect
                value={step.icon}
                onChange={(val) => updateStepIcon(i, val)}
                label={t('content.landing_label_icon')}
                placeholder={t('content.landing_placeholder_select_icon')}
              />
              <Input
                label={t('content.landing_label_title')}
                value={step.title}
                onValueChange={(v) => updateStep(i, 'title', v)}
                variant="secondary"
                size="sm"
              />
              <Input
                label={t('content.landing_label_description')}
                value={step.description}
                onValueChange={(v) => updateStep(i, 'description', v)}
                variant="secondary"
                size="sm"
              />
            </div>
          </CardBody>
        </Card>
      ))}
      <Button
        size="sm"
        variant="secondary"
        startContent={<Plus size={14} />}
        onPress={addStep}
        className="self-start"
      >
        {t('content.landing_add_step')}
      </Button>
      <p className="text-xs text-muted">{t(HELPER_TEXT_KEY)}</p>
    </div>
  );
}

function CoreValuesEditor({
  content,
  onChange,
}: {
  content: CoreValuesContent;
  onChange: (c: CoreValuesContent) => void;
}) {
  const { t } = useTranslation('admin_content');
  const values = content.values || [];

  const updateValue = (index: number, field: keyof CoreValue, value: string) => {
    const updated: CoreValue[] = [...values];
    updated[index] = { ...updated[index], [field]: value } as CoreValue;
    onChange({ ...content, values: updated });
  };

  const addValue = () => {
    onChange({
      ...content,
      values: [...values, { _key: genListKey(), title: '', description: '' }],
    });
  };

  const removeValue = (index: number) => {
    onChange({ ...content, values: values.filter((_, i) => i !== index) });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          label={t('content.landing_label_section_title')}
          placeholder={t('content.landing_placeholder_section_title_core_values')}
          value={content.title || ''}
          onValueChange={(v) => onChange({ ...content, title: v })}
          variant="secondary"
          size="sm"
        />
        <Input
          label={t('content.landing_label_section_subtitle')}
          placeholder={t('content.landing_placeholder_section_subtitle_core_values')}
          value={content.subtitle || ''}
          onValueChange={(v) => onChange({ ...content, subtitle: v })}
          variant="secondary"
          size="sm"
        />
      </div>
      <Separator />
      {values.map((val, i) => (
        <Card key={val._key ?? i} variant="transparent" className="border border-border bg-surface">
          <CardBody className="flex flex-col gap-3 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {t('content.landing_value_number', { number: i + 1 })}
              </span>
              <Button
                size="sm"
                variant="danger-soft"
                startContent={<Trash2 size={14} />}
                onPress={() => removeValue(i)}
              >
                {t('content.landing_remove')}
              </Button>
            </div>
            <Input
              label={t('content.landing_label_title')}
              value={val.title}
              onValueChange={(v) => updateValue(i, 'title', v)}
              variant="secondary"
              size="sm"
            />
            <Textarea
              label={t('content.landing_label_description')}
              value={val.description}
              onValueChange={(v) => updateValue(i, 'description', v)}
              variant="secondary"
              size="sm"
              minRows={2}
            />
          </CardBody>
        </Card>
      ))}
      <Button
        size="sm"
        variant="secondary"
        startContent={<Plus size={14} />}
        onPress={addValue}
        className="self-start"
      >
        {t('content.landing_add_value')}
      </Button>
      <p className="text-xs text-muted">{t(HELPER_TEXT_KEY)}</p>
    </div>
  );
}

function CtaEditor({
  content,
  onChange,
}: {
  content: CtaContent;
  onChange: (c: CtaContent) => void;
}) {
  const { t } = useTranslation('admin_content');
  const update = (field: keyof CtaContent, value: string) => {
    onChange({ ...content, [field]: value });
  };
  return (
    <div className="flex flex-col gap-4">
      <Input
        label={t('content.landing_label_title')}
        placeholder={t('content.landing_placeholder_cta_title')}
        value={content.title || ''}
        onValueChange={(v) => update('title', v)}
        variant="secondary"
        size="sm"
      />
      <Textarea
        label={t('content.landing_label_description')}
        placeholder={t('content.landing_placeholder_cta_description')}
        value={content.description || ''}
        onValueChange={(v) => update('description', v)}
        variant="secondary"
        size="sm"
        minRows={2}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          label={t('content.landing_label_button_text')}
          placeholder={t('content.landing_placeholder_button_text_join_now')}
          value={content.button_text || ''}
          onValueChange={(v) => update('button_text', v)}
          variant="secondary"
          size="sm"
        />
        <Input
          label={t('content.landing_label_button_link')}
          placeholder={t('content.landing_placeholder_button_link_register')}
          value={content.button_link || ''}
          onValueChange={(v) => update('button_link', v)}
          variant="secondary"
          size="sm"
        />
      </div>
      <p className="text-xs text-muted">{t(HELPER_TEXT_KEY)}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section Card Component
// ─────────────────────────────────────────────────────────────────────────────

function SectionCard({
  section,
  isFirst,
  isLast,
  isExpanded,
  onToggleExpand,
  onToggleEnabled,
  onMoveUp,
  onMoveDown,
  onContentChange,
}: {
  section: LandingSection;
  isFirst: boolean;
  isLast: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onContentChange: (content: LandingSection['content']) => void;
}) {
  const { t } = useTranslation('admin_content');
  const sectionType = section.type as LandingSectionType;
  const labelKey = SECTION_LABEL_KEYS[sectionType];
  const label = labelKey ? t(labelKey) : sectionType;
  const SectionIcon = SECTION_ICONS[sectionType] ?? Layers;

  const renderEditor = () => {
    switch (sectionType) {
      case 'hero':
        return (
          <HeroEditor
            content={(section.content as HeroContent) || {}}
            onChange={(c) => onContentChange(c)}
          />
        );
      case 'audience_cards':
        return (
          <AudienceCardsEditor
            content={(section.content as AudienceCardsContent) || {}}
            onChange={(c) => onContentChange(c)}
          />
        );
      case 'feature_pills':
        return (
          <FeaturePillsEditor
            content={(section.content as FeaturePillsContent) || {}}
            onChange={(c) => onContentChange(c)}
          />
        );
      case 'stats':
        return (
          <StatsEditor
            content={(section.content as StatsContent) || {}}
            onChange={(c) => onContentChange(c)}
          />
        );
      case 'how_it_works':
        return (
          <HowItWorksEditor
            content={(section.content as HowItWorksContent) || {}}
            onChange={(c) => onContentChange(c)}
          />
        );
      case 'core_values':
        return (
          <CoreValuesEditor
            content={(section.content as CoreValuesContent) || {}}
            onChange={(c) => onContentChange(c)}
          />
        );
      case 'cta':
        return (
          <CtaEditor
            content={(section.content as CtaContent) || {}}
            onChange={(c) => onContentChange(c)}
          />
        );
      default:
        return <p className="text-sm text-muted">{t('content.landing_no_editor_available')}</p>;
    }
  };

  return (
    <Card className={`border border-border bg-surface transition-all hover:border-primary-300 ${!section.enabled ? 'opacity-60' : ''}`}>
      <CardHeader
        className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 hover:bg-surface-secondary/50 transition-colors"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronRight
            size={16}
            className={`text-muted transition-transform shrink-0 ${
              isExpanded ? 'rotate-90' : ''
            }`}
          />
          <span className="inline-flex items-center justify-center size-8 rounded-md bg-accent/10 text-accent shrink-0">
            <SectionIcon size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{label}</p>
            <Chip
              size="sm"
              variant="flat"
              color={section.enabled ? 'success' : 'default'}
              className="mt-0.5"
            >
              {section.enabled ? t('content.landing_visible') : t('content.landing_hidden')}
            </Chip>
          </div>
        </div>
        <div role="presentation" className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Switch
            size="sm"
            isSelected={section.enabled}
            onValueChange={onToggleEnabled}
            aria-label={t('content.landing_toggle_section', { section: label })}
          />
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            isDisabled={isFirst}
            onPress={onMoveUp}
            aria-label={t('content.landing_move_up', { section: label })}
          >
            <ChevronUp size={16} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            isDisabled={isLast}
            onPress={onMoveDown}
            aria-label={t('content.landing_move_down', { section: label })}
          >
            <ChevronDown size={16} />
          </Button>
        </div>
      </CardHeader>
      {isExpanded && (
        <CardBody className="px-4 pb-4 pt-0">
          <Separator className="mb-4" />
          {renderEditor()}
        </CardBody>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function LandingPageBuilder() {
  const { t } = useTranslation('admin_content');
  usePageTitle(t('content.landing_page_title'));
  const toast = useToast();

  // State
  const [config, setConfig] = useState<LandingPageConfig>(() =>
    cloneConfig(DEFAULT_LANDING_PAGE_CONFIG),
  );
  const [savedConfig, setSavedConfig] = useState<LandingPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [isDirty, setIsDirty] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const initialLoadDone = useRef(false);

  // ─── Fetch config on mount ──────────────────────────────────────────────
  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminLandingPage.get();
      if (res.success && res.data) {
        const result = res.data as unknown as { config: LandingPageConfig | null };
        if (result.config) {
          setConfig(withListKeys(result.config));
          setSavedConfig(cloneConfig(result.config));
        } else {
          // No custom config — use defaults
          const defaults = withListKeys(cloneConfig(DEFAULT_LANDING_PAGE_CONFIG));
          setConfig(defaults);
          setSavedConfig(null);
        }
      }
    } catch {
      toast.error(t('content.landing_failed_to_load'));
    } finally {
      setLoading(false);
      initialLoadDone.current = true;
    }
  }, [t, toast]);


  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // ─── Track dirty state ──────────────────────────────────────────────────
  useEffect(() => {
    if (!initialLoadDone.current) return;
    const currentJson = JSON.stringify(cleanConfig(config));
    const savedJson = savedConfig
      ? JSON.stringify(cleanConfig(savedConfig))
      : JSON.stringify(cleanConfig(cloneConfig(DEFAULT_LANDING_PAGE_CONFIG)));
    setIsDirty(currentJson !== savedJson);
  }, [config, savedConfig]);

  // ─── Warn on navigation with unsaved changes ───────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // ─── Save ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const cleaned = cleanConfig(config);
      const res = await adminLandingPage.update(cleaned);
      if (res.success) {
        toast.success(t('content.landing_saved'));
        setSavedConfig(cloneConfig(config));
        setIsDirty(false);
      } else {
        toast.error(t('content.landing_failed_to_save'));
      }
    } catch {
      toast.error(t('content.landing_failed_to_save'));
    } finally {
      setSaving(false);
    }
  };

  // ─── Reset to defaults ─────────────────────────────────────────────────
  const handleReset = async () => {
    setSaving(true);
    try {
      const res = await adminLandingPage.update(null);
      if (res.success) {
        const defaults = withListKeys(cloneConfig(DEFAULT_LANDING_PAGE_CONFIG));
        setConfig(defaults);
        setSavedConfig(null);
        setIsDirty(false);
        setExpandedSections(new Set());
        toast.success(t('content.landing_reset_success'));
      } else {
        toast.error(t('content.landing_failed_to_reset'));
      }
    } catch {
      toast.error(t('content.landing_failed_to_reset'));
    } finally {
      setSaving(false);
      setConfirmReset(false);
    }
  };

  // ─── Section operations ─────────────────────────────────────────────────
  const sections = sortedSections(config.sections);

  const updateSection = (id: string, updater: (s: LandingSection) => LandingSection) => {
    setConfig((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === id ? updater(s) : s)),
    }));
  };

  const toggleEnabled = (id: string, enabled: boolean) => {
    updateSection(id, (s) => ({ ...s, enabled }));
  };

  const moveSection = (id: string, direction: 'up' | 'down') => {
    setConfig((prev) => {
      const sorted = sortedSections(prev.sections);
      const index = sorted.findIndex((s) => s.id === id);
      if (
        (direction === 'up' && index <= 0) ||
        (direction === 'down' && index >= sorted.length - 1)
      ) {
        return prev;
      }
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      const updated: LandingSection[] = [...sorted];
      const current = updated[index];
      const swap = updated[swapIndex];
      if (!current || !swap) return prev;
      // Swap order values
      const tempOrder = current.order;
      updated[index] = { ...current, order: swap.order };
      updated[swapIndex] = { ...swap, order: tempOrder };
      return { ...prev, sections: updated };
    });
  };

  const updateContent = (id: string, content: LandingSection['content']) => {
    updateSection(id, (s) => ({ ...s, content }));
  };

  const toggleExpanded = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div role="status" aria-busy="true" aria-label={t('content.landing_loading_aria')} className="flex justify-center py-4"><Spinner size="lg" label={t('content.landing_loading')} /></div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t('content.landing_builder_title')}
        description={t('content.landing_builder_description')}
        actions={
          <div className="flex items-center gap-2">
            {confirmReset ? (
              <>
                <span className="text-sm text-danger">{t('content.landing_reset_confirm_prompt')}</span>
                <Button
                  size="sm"
                  variant="danger-soft"
                  onPress={handleReset}
                  isLoading={saving}
                >
                  {t('content.landing_confirm_reset')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => setConfirmReset(false)}
                  isDisabled={saving}
                >
                  {t('content.landing_cancel')}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                startContent={<RotateCcw size={14} />}
                onPress={() => setConfirmReset(true)}
                isDisabled={saving}
              >
                {t('content.landing_reset_to_defaults')}
              </Button>
            )}
            <Button
              size="sm"
              startContent={<Save size={14} />}
              onPress={handleSave}
              isDisabled={!isDirty || saving}
              isLoading={saving}
            >
              {t('content.landing_save_changes')}
            </Button>
          </div>
        }
      />

      {/* Section ordering info */}
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-4 py-3">
        <Layers size={16} className="text-muted" />
        <p className="text-sm text-muted">
          {t('content.landing_ordering_info')}
        </p>
      </div>

      {/* Section list */}
      <div className="flex flex-col gap-3">
        {sections.map((section, index) => (
          <SectionCard
            key={section.id}
            section={section}
            isFirst={index === 0}
            isLast={index === sections.length - 1}
            isExpanded={expandedSections.has(section.id)}
            onToggleExpand={() => toggleExpanded(section.id)}
            onToggleEnabled={(enabled) => toggleEnabled(section.id, enabled)}
            onMoveUp={() => moveSection(section.id, 'up')}
            onMoveDown={() => moveSection(section.id, 'down')}
            onContentChange={(content) => updateContent(section.id, content)}
          />
        ))}
      </div>

      {/* Dirty state indicator */}
      {isDirty && (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
          <p className="text-sm text-warning-soft-foreground">
            {t('content.landing_unsaved_changes')}
          </p>
        </div>
      )}
    </div>
  );
}

export default LandingPageBuilder;
