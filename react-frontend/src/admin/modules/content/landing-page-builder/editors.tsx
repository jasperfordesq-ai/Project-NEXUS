// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The per-block forms of the landing page editor.
 *
 * Two rules run through all of them:
 *  - every text box shows the standard wording twice — as the placeholder and
 *    as the field description ("Leave empty to keep: …") — so an admin never has
 *    to guess what a blank box means;
 *  - a list (cards, highlights, steps, values) starts as a read-only view of the
 *    standard items with one button, "Edit these items", that copies them into
 *    the form. The public page replaces the whole list the moment one custom
 *    item exists, so the old "Add" button that started from an empty list made
 *    the other items vanish without warning.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ChevronUp from 'lucide-react/icons/chevron-up';
import ChevronDown from 'lucide-react/icons/chevron-down';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import Undo2 from 'lucide-react/icons/undo-2';
import Pencil from 'lucide-react/icons/pencil';
import { Button, Input, Textarea, Separator, useConfirm } from '@/components/ui';
import { useTenant } from '@/contexts';
import { getIcon } from '@/components/landing';
import type {
  AudienceCard,
  AudienceCardsContent,
  CoreValue,
  CoreValuesContent,
  CtaContent,
  FeaturePillItem,
  FeaturePillsContent,
  HeroContent,
  HowItWorksContent,
  HowItWorksStep,
  LandingIconId,
} from '@/types/landing-page';
import { createDefaultAudienceCards } from '@/types/landing-page';
import { IconPicker } from './IconPicker';
import { genListKey, isValidLandingLink } from './configUtils';
import { DEFAULT_PILL_ICONS, DEFAULT_STEP_ICONS, LIST_LIMITS } from './sectionMeta';

// ─────────────────────────────────────────────────────────────────────────────
// Shared pieces
// ─────────────────────────────────────────────────────────────────────────────

/** A text box whose empty state is explained: the standard wording is the placeholder and the description. */
function TextWithDefault({
  label,
  value,
  onChange,
  standard,
  multiline = false,
  isInvalid = false,
  errorMessage,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** The wording the public page uses while this box is empty. */
  standard: string;
  multiline?: boolean;
  isInvalid?: boolean;
  errorMessage?: string;
}) {
  const { t } = useTranslation('admin_content');
  const description = t('content.landing_field_blank_keeps_default', { text: standard });
  if (multiline) {
    return (
      <Textarea
        label={label}
        placeholder={standard}
        description={description}
        value={value}
        onValueChange={onChange}
        variant="secondary"
        size="sm"
        minRows={2}
        isInvalid={isInvalid}
        errorMessage={errorMessage}
      />
    );
  }
  return (
    <Input
      label={label}
      placeholder={standard}
      description={description}
      value={value}
      onValueChange={onChange}
      variant="secondary"
      size="sm"
      isInvalid={isInvalid}
      errorMessage={errorMessage}
    />
  );
}

/** A link box with the format rule spelled out and checked as you type. */
function LinkField({
  label,
  value,
  onChange,
  standard,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** The link used while the box is empty (optional links only). */
  standard?: string;
  required?: boolean;
}) {
  const { t } = useTranslation('admin_content');
  const trimmed = value.trim();
  const invalid = required ? !isValidLandingLink(trimmed) : trimmed !== '' && !isValidLandingLink(trimmed);
  const description = standard
    ? `${t('content.landing_field_blank_keeps_default', { text: standard })} ${t('content.landing_link_hint')}`
    : t('content.landing_link_hint');
  return (
    <Input
      label={label}
      placeholder={standard ?? '/about'}
      description={description}
      value={value}
      onValueChange={onChange}
      variant="secondary"
      size="sm"
      isInvalid={invalid}
      errorMessage={invalid ? t('content.landing_link_invalid') : undefined}
    />
  );
}

interface ListEditorProps<T extends { _key?: string }> {
  items: T[];
  /** The items the public page shows while `items` is empty. */
  standardItems: T[];
  max: number;
  onChange: (items: T[]) => void;
  itemLabel: (number: number) => string;
  addLabel: string;
  /** Compact read-only line for a standard item. */
  renderStandard: (item: T, index: number) => ReactNode;
  /** The editable fields for a custom item. */
  renderFields: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
  /** A fresh, blank item for "Add". */
  blankItem: () => T;
}

/**
 * The list frame shared by cards, highlights, steps and values. Empty list =
 * the standard items, shown read-only. One custom item = the admin's list, with
 * reorder, remove and add. Removing the last custom item brings the standard
 * items back, which is said in the hint so it is not a surprise.
 */
function ListEditor<T extends { _key?: string }>({
  items,
  standardItems,
  max,
  onChange,
  itemLabel,
  addLabel,
  renderStandard,
  renderFields,
  blankItem,
}: ListEditorProps<T>) {
  const { t } = useTranslation('admin_content');
  const confirm = useConfirm();

  const startFromStandard = () => {
    onChange(standardItems.map((item) => ({ ...item, _key: genListKey() })));
  };

  const backToStandard = async () => {
    const ok = await confirm({
      title: t('content.landing_items_back_to_standard_confirm_title'),
      body: t('content.landing_items_back_to_standard_confirm_body'),
      confirmLabel: t('content.landing_items_back_to_standard'),
      status: 'warning',
    });
    if (ok) onChange([]);
  };

  const move = (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= items.length) return;
    const next = [...items];
    const current = next[index]!;
    next[index] = next[swapIndex]!;
    next[swapIndex] = current;
    onChange(next);
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-surface-secondary/40 p-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{t('content.landing_items_standard_title')}</p>
          <p className="mt-1 text-xs text-muted">{t('content.landing_items_standard_hint')}</p>
        </div>
        <ol className="flex flex-col gap-2">
          {standardItems.map((item, index) => (
            <li key={index} className="flex items-start gap-3 rounded-lg bg-surface px-3 py-2">
              <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                {index + 1}
              </span>
              <div className="min-w-0 text-sm">{renderStandard(item, index)}</div>
            </li>
          ))}
        </ol>
        <div>
          <Button size="sm" variant="secondary" startContent={<Pencil size={14} aria-hidden="true" />} onPress={startFromStandard}>
            {t('content.landing_items_edit_standard')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">{t('content.landing_items_custom_hint', { max })}</p>
      {items.map((item, index) => {
        const label = itemLabel(index + 1);
        const update = (patch: Partial<T>) => {
          const next = [...items];
          next[index] = { ...item, ...patch };
          onChange(next);
        };
        return (
          <div key={item._key ?? index} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">{label}</span>
              <div className="flex items-center gap-1">
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  isDisabled={index === 0}
                  onPress={() => move(index, 'up')}
                  aria-label={t('content.landing_move_item_up', { label })}
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  isDisabled={index === items.length - 1}
                  onPress={() => move(index, 'down')}
                  aria-label={t('content.landing_move_item_down', { label })}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </Button>
                <Button
                  size="sm"
                  variant="danger-soft"
                  startContent={<Trash2 size={14} aria-hidden="true" />}
                  onPress={() => onChange(items.filter((_, i) => i !== index))}
                  aria-label={t('content.landing_remove_item', { label })}
                >
                  {t('content.landing_remove')}
                </Button>
              </div>
            </div>
            {renderFields(item, update, index)}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        {items.length < max && (
          <Button size="sm" variant="secondary" startContent={<Plus size={14} aria-hidden="true" />} onPress={() => onChange([...items, blankItem()])}>
            {addLabel}
          </Button>
        )}
        <Button size="sm" variant="tertiary" startContent={<Undo2 size={14} aria-hidden="true" />} onPress={backToStandard}>
          {t('content.landing_items_back_to_standard')}
        </Button>
      </div>
    </div>
  );
}

/** Read-only line: optional icon, title, description. */
function StandardLine({ icon, title, description }: { icon?: LandingIconId; title: string; description?: string }) {
  const Icon = icon ? getIcon(icon) : null;
  return (
    <div className="flex items-start gap-2">
      {Icon && <Icon size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />}
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
    </div>
  );
}

/** A custom item counts as "started" once anything in it is filled in. */
function hasAnyValue(item: Record<string, unknown>): boolean {
  return Object.entries(item).some(([k, v]) => k !== '_key' && k !== 'icon' && v !== '' && v !== undefined && v !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Welcome banner
// ─────────────────────────────────────────────────────────────────────────────

export function HeroEditor({ content, onChange }: { content: HeroContent; onChange: (c: HeroContent) => void }) {
  const { t } = useTranslation('admin_content');
  const { t: tPublic } = useTranslation('public');
  const { branding } = useTenant();
  const set = (field: keyof HeroContent) => (value: string) => onChange({ ...content, [field]: value });

  return (
    <div className="flex flex-col gap-4">
      <TextWithDefault
        label={t('content.landing_label_badge_text')}
        value={content.badge_text ?? ''}
        onChange={set('badge_text')}
        standard={tPublic('home.badge')}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextWithDefault
          label={t('content.landing_label_headline_line_1')}
          value={content.headline_1 ?? ''}
          onChange={set('headline_1')}
          standard={tPublic('home.headline_1')}
        />
        <TextWithDefault
          label={t('content.landing_label_headline_line_2')}
          value={content.headline_2 ?? ''}
          onChange={set('headline_2')}
          standard={tPublic('home.headline_2')}
        />
      </div>
      <TextWithDefault
        label={t('content.landing_label_subheadline')}
        value={content.subheadline ?? ''}
        onChange={set('subheadline')}
        standard={tPublic('home.subheadline', { name: branding.name })}
        multiline
      />
      <Separator />
      <div>
        <p className="text-sm font-semibold text-foreground">{t('content.landing_primary_cta')}</p>
        <p className="text-xs text-muted">{t('content.landing_primary_cta_hint')}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextWithDefault
          label={t('content.landing_label_button_text')}
          value={content.cta_primary_text ?? ''}
          onChange={set('cta_primary_text')}
          standard={tPublic('home.cta_get_started')}
        />
        <LinkField
          label={t('content.landing_label_button_link')}
          value={content.cta_primary_link ?? ''}
          onChange={set('cta_primary_link')}
          standard="/register"
        />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{t('content.landing_secondary_cta')}</p>
        <p className="text-xs text-muted">{t('content.landing_secondary_cta_hint')}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextWithDefault
          label={t('content.landing_label_button_text')}
          value={content.cta_secondary_text ?? ''}
          onChange={set('cta_secondary_text')}
          standard={tPublic('home.cta_learn_more')}
        />
        <LinkField
          label={t('content.landing_label_button_link')}
          value={content.cta_secondary_link ?? ''}
          onChange={set('cta_secondary_link')}
          standard="/about"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Start-here cards
// ─────────────────────────────────────────────────────────────────────────────

export function AudienceCardsEditor({
  content,
  onChange,
}: {
  content: AudienceCardsContent;
  onChange: (c: AudienceCardsContent) => void;
}) {
  const { t } = useTranslation('admin_content');
  const { t: tPublic } = useTranslation('public');
  const standardCards = createDefaultAudienceCards((key) => tPublic(key));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextWithDefault
          label={t('content.landing_label_section_title')}
          value={content.title ?? ''}
          onChange={(v) => onChange({ ...content, title: v })}
          standard={tPublic('home.audience_cards.title')}
        />
        <Input
          label={t('content.landing_label_section_subtitle')}
          description={t('content.landing_subtitle_optional_hint')}
          value={content.subtitle ?? ''}
          onValueChange={(v) => onChange({ ...content, subtitle: v })}
          variant="secondary"
          size="sm"
        />
      </div>
      <Separator />
      <ListEditor<AudienceCard>
        items={content.cards ?? []}
        standardItems={standardCards}
        max={LIST_LIMITS.cards}
        onChange={(cards) => onChange({ ...content, cards })}
        itemLabel={(n) => t('content.landing_card_number', { number: n })}
        addLabel={t('content.landing_add_card')}
        blankItem={() => ({
          _key: genListKey(),
          title: '',
          description: '',
          cta_label: t('content.landing_default_cta_learn_more'),
          target_url: '/',
        })}
        renderStandard={(card) => (
          <StandardLine icon={card.icon} title={card.title} description={`${card.description} → ${card.cta_label} (${card.target_url})`} />
        )}
        renderFields={(card, update, index) => {
          const started = hasAnyValue(card as unknown as Record<string, unknown>);
          const titleMissing = started && card.title.trim() === '';
          return (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                <IconPicker value={card.icon} onChange={(icon) => update({ icon })} standardIconId={standardCards[index]?.icon} />
                <Input
                  label={t('content.landing_label_title')}
                  placeholder={t('content.landing_placeholder_card_title')}
                  value={card.title}
                  onValueChange={(v) => update({ title: v })}
                  variant="secondary"
                  size="sm"
                  isInvalid={titleMissing}
                  errorMessage={titleMissing ? t('content.landing_title_required') : undefined}
                />
              </div>
              <Textarea
                label={t('content.landing_label_description')}
                placeholder={t('content.landing_placeholder_card_description')}
                value={card.description}
                onValueChange={(v) => update({ description: v })}
                variant="secondary"
                size="sm"
                minRows={2}
              />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input
                  label={t('content.landing_label_button_label')}
                  placeholder={t('content.landing_default_cta_learn_more')}
                  value={card.cta_label}
                  onValueChange={(v) => update({ cta_label: v })}
                  variant="secondary"
                  size="sm"
                />
                <LinkField
                  label={t('content.landing_label_link')}
                  value={card.target_url}
                  onChange={(v) => update({ target_url: v })}
                  required
                />
              </div>
            </>
          );
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick highlights
// ─────────────────────────────────────────────────────────────────────────────

export function FeaturePillsEditor({
  content,
  onChange,
}: {
  content: FeaturePillsContent;
  onChange: (c: FeaturePillsContent) => void;
}) {
  const { t } = useTranslation('admin_content');
  const { t: tPublic } = useTranslation('public');
  const standardItems: FeaturePillItem[] = [0, 1, 2].map((i) => ({
    icon: DEFAULT_PILL_ICONS[i],
    title: tPublic(`home.features.${i}.title`),
    description: tPublic(`home.features.${i}.description`),
  }));

  return (
    <ListEditor<FeaturePillItem>
      items={content.items ?? []}
      standardItems={standardItems}
      max={LIST_LIMITS.items}
      onChange={(items) => onChange({ ...content, items })}
      itemLabel={(n) => t('content.landing_highlight_number', { number: n })}
      addLabel={t('content.landing_add_highlight')}
      blankItem={() => ({ _key: genListKey(), title: '', description: '' })}
      renderStandard={(item) => <StandardLine icon={item.icon} title={item.title} description={item.description} />}
      renderFields={(item, update, index) => {
        const titleMissing = hasAnyValue(item as unknown as Record<string, unknown>) && item.title.trim() === '';
        return (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,1fr)]">
            <IconPicker value={item.icon} onChange={(icon) => update({ icon })} standardIconId={DEFAULT_PILL_ICONS[index % DEFAULT_PILL_ICONS.length]} />
            <Input
              label={t('content.landing_label_title')}
              value={item.title}
              onValueChange={(v) => update({ title: v })}
              variant="secondary"
              size="sm"
              isInvalid={titleMissing}
              errorMessage={titleMissing ? t('content.landing_title_required') : undefined}
            />
            <Input
              label={t('content.landing_label_description')}
              value={item.description}
              onValueChange={(v) => update({ description: v })}
              variant="secondary"
              size="sm"
            />
          </div>
        );
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live numbers
// ─────────────────────────────────────────────────────────────────────────────

export function StatsEditor() {
  const { t } = useTranslation('admin_content');
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-secondary/40 p-4">
      <p className="text-sm text-foreground">{t('content.landing_stats_nothing_to_edit')}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// How it works
// ─────────────────────────────────────────────────────────────────────────────

export function HowItWorksEditor({
  content,
  onChange,
}: {
  content: HowItWorksContent;
  onChange: (c: HowItWorksContent) => void;
}) {
  const { t } = useTranslation('admin_content');
  const { t: tPublic } = useTranslation('public');
  const standardSteps: HowItWorksStep[] = [0, 1, 2, 3].map((i) => ({
    icon: DEFAULT_STEP_ICONS[i],
    title: tPublic(`home.how_it_works.steps.${i}.title`),
    description: tPublic(`home.how_it_works.steps.${i}.description`),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextWithDefault
          label={t('content.landing_label_section_title')}
          value={content.title ?? ''}
          onChange={(v) => onChange({ ...content, title: v })}
          standard={tPublic('home.how_it_works.title')}
        />
        <TextWithDefault
          label={t('content.landing_label_section_subtitle')}
          value={content.subtitle ?? ''}
          onChange={(v) => onChange({ ...content, subtitle: v })}
          standard={tPublic('home.how_it_works.subtitle')}
        />
      </div>
      <Separator />
      <ListEditor<HowItWorksStep>
        items={content.steps ?? []}
        standardItems={standardSteps}
        max={LIST_LIMITS.steps}
        onChange={(steps) => onChange({ ...content, steps })}
        itemLabel={(n) => t('content.landing_step_number', { number: n })}
        addLabel={t('content.landing_add_step')}
        blankItem={() => ({ _key: genListKey(), title: '', description: '' })}
        renderStandard={(step) => <StandardLine icon={step.icon} title={step.title} description={step.description} />}
        renderFields={(step, update, index) => {
          const titleMissing = hasAnyValue(step as unknown as Record<string, unknown>) && step.title.trim() === '';
          return (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                <IconPicker value={step.icon} onChange={(icon) => update({ icon })} standardIconId={DEFAULT_STEP_ICONS[index] ?? DEFAULT_STEP_ICONS[0]} />
                <Input
                  label={t('content.landing_label_title')}
                  value={step.title}
                  onValueChange={(v) => update({ title: v })}
                  variant="secondary"
                  size="sm"
                  isInvalid={titleMissing}
                  errorMessage={titleMissing ? t('content.landing_title_required') : undefined}
                />
              </div>
              <Textarea
                label={t('content.landing_label_description')}
                value={step.description}
                onValueChange={(v) => update({ description: v })}
                variant="secondary"
                size="sm"
                minRows={2}
              />
            </>
          );
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Our values
// ─────────────────────────────────────────────────────────────────────────────

export function CoreValuesEditor({
  content,
  onChange,
}: {
  content: CoreValuesContent;
  onChange: (c: CoreValuesContent) => void;
}) {
  const { t } = useTranslation('admin_content');
  const { t: tPublic } = useTranslation('public');
  const standardValues: CoreValue[] = [0, 1, 2].map((i) => ({
    title: tPublic(`home.why_timebanking.values.${i}.title`),
    description: tPublic(`home.why_timebanking.values.${i}.description`),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextWithDefault
          label={t('content.landing_label_section_title')}
          value={content.title ?? ''}
          onChange={(v) => onChange({ ...content, title: v })}
          standard={tPublic('home.why_timebanking.title')}
        />
        <TextWithDefault
          label={t('content.landing_label_section_subtitle')}
          value={content.subtitle ?? ''}
          onChange={(v) => onChange({ ...content, subtitle: v })}
          standard={tPublic('home.why_timebanking.subtitle')}
        />
      </div>
      <Separator />
      <ListEditor<CoreValue>
        items={content.values ?? []}
        standardItems={standardValues}
        max={LIST_LIMITS.values}
        onChange={(values) => onChange({ ...content, values })}
        itemLabel={(n) => t('content.landing_value_number', { number: n })}
        addLabel={t('content.landing_add_value')}
        blankItem={() => ({ _key: genListKey(), title: '', description: '' })}
        renderStandard={(value) => <StandardLine title={value.title} description={value.description} />}
        renderFields={(value, update) => {
          const titleMissing = hasAnyValue(value as unknown as Record<string, unknown>) && value.title.trim() === '';
          return (
            <>
              <Input
                label={t('content.landing_label_title')}
                value={value.title}
                onValueChange={(v) => update({ title: v })}
                variant="secondary"
                size="sm"
                isInvalid={titleMissing}
                errorMessage={titleMissing ? t('content.landing_title_required') : undefined}
              />
              <Textarea
                label={t('content.landing_label_description')}
                value={value.description}
                onValueChange={(v) => update({ description: v })}
                variant="secondary"
                size="sm"
                minRows={2}
              />
            </>
          );
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Final invitation
// ─────────────────────────────────────────────────────────────────────────────

export function CtaEditor({ content, onChange }: { content: CtaContent; onChange: (c: CtaContent) => void }) {
  const { t } = useTranslation('admin_content');
  const { t: tPublic } = useTranslation('public');
  const set = (field: keyof CtaContent) => (value: string) => onChange({ ...content, [field]: value });

  return (
    <div className="flex flex-col gap-4">
      <TextWithDefault
        label={t('content.landing_label_title')}
        value={content.title ?? ''}
        onChange={set('title')}
        standard={tPublic('home.cta_section.title')}
      />
      <TextWithDefault
        label={t('content.landing_label_description')}
        value={content.description ?? ''}
        onChange={set('description')}
        standard={tPublic('home.cta_section.description')}
        multiline
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextWithDefault
          label={t('content.landing_label_button_text')}
          value={content.button_text ?? ''}
          onChange={set('button_text')}
          standard={tPublic('home.cta_section.button')}
        />
        <LinkField
          label={t('content.landing_label_button_link')}
          value={content.button_link ?? ''}
          onChange={set('button_link')}
          standard="/register"
        />
      </div>
    </div>
  );
}
