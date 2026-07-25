// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * FilterChipGroup — one labelled section of single-select, tap-once filter chips.
 * Generalised from ListingFilterSheet's private `ChipGroup` so every filter sheet
 * shares the same anatomy, sizing and accent handling.
 *
 * Deliberately a <div>, not <section>: glass.css paints every <section> inside a
 * [role="dialog"] with an opaque solid background, which blows out the sheet's
 * surface. Never reintroduce <section> here.
 *
 * `label` is optional — omit it for an unlabelled chip row (that is how the Feed
 * sheet ships) and pass `ariaLabel` so the group still has an accessible name.
 */

import type { ReactNode } from 'react';
import type { Key } from '@heroui/react/rac';

import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { filterAccentClasses, type FilterAccent } from '@/components/ui/filterAccent';

export interface FilterChipOption {
  /** Value handed back to `onChange`. */
  key: string;
  label: string;
  /** Disables just this chip (e.g. an option the current data can't satisfy). */
  isDisabled?: boolean;
}

export interface FilterChipGroupProps {
  /** Visible section heading. Omit for an unlabelled row. */
  label?: string;
  /** Accessible name for the group; defaults to `label`. Required when there is no label. */
  ariaLabel?: string;
  /** Currently selected option key. */
  selected: string;
  options: FilterChipOption[];
  onChange: (key: string) => void;
  /** Per-page accent (Listings is `emerald`, Feed/default is `accent`). */
  accent?: FilterAccent;
  /** Rendered on the heading row, right-aligned (e.g. an `AlgorithmLabel`). */
  trailing?: ReactNode;
  /** Rendered after the chips, inside the same wrapping row (e.g. "Show all (42)"). */
  extra?: ReactNode;
  /** Greys out and disables the whole group — for dependent filters (e.g. a radius that only applies when "Near me" is on). */
  isDisabled?: boolean;
  /** Extra classes on the group wrapper. */
  className?: string;
}

const CHIP_CLASS =
  'min-h-11 shrink-0 rounded-full border border-theme-default bg-theme-elevated px-4 text-sm text-theme-muted transition-colors data-[selected=true]:border-transparent data-[selected=true]:font-medium data-[selected=true]:text-white data-[selected=true]:shadow-sm';

export function FilterChipGroup({
  label,
  ariaLabel,
  selected,
  options,
  onChange,
  accent = 'accent',
  trailing,
  extra,
  isDisabled,
  className,
}: FilterChipGroupProps) {
  const tone = filterAccentClasses(accent);
  const groupLabel = ariaLabel ?? label;

  return (
    <div className={className}>
      {(label || trailing) && (
        <div className="mb-2.5 flex min-h-6 items-center justify-between gap-2">
          {label && (
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-theme-subtle">{label}</h3>
          )}
          {trailing}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ToggleButtonGroup
          aria-label={groupLabel}
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          isDisabled={isDisabled}
          selectedKeys={new Set<Key>([selected])}
          onSelectionChange={(keys) => {
            const [key] = Array.from(keys);
            if (key != null) onChange(String(key));
          }}
          className="flex w-full flex-wrap items-center justify-start gap-2 p-0"
        >
          {options.map((opt) => (
            <ToggleButton
              key={opt.key}
              id={opt.key}
              variant="ghost"
              isDisabled={opt.isDisabled}
              className={`${CHIP_CLASS} ${tone.chip}`}
            >
              {opt.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {extra}
      </div>
    </div>
  );
}

export default FilterChipGroup;
