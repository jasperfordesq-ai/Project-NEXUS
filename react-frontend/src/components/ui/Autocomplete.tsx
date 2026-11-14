// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Autocomplete as HeroAutocomplete } from '@heroui/react/autocomplete';
import { Description } from '@heroui/react/description';
import { FieldError } from '@heroui/react/field-error';
import { Label } from '@heroui/react/label';
import { ListBox as HeroListBox } from '@heroui/react/list-box';
import { SearchField } from '@heroui/react/search-field';
import { useFilter } from '@heroui/react/rac';
import { cn } from '@/lib/helpers';

type HeroAutocompleteProps = ComponentProps<typeof HeroAutocomplete>;
type HeroListBoxProps = ComponentProps<typeof HeroListBox>;
type V3Variant = 'primary' | 'secondary';
type LegacyVariant = 'flat' | 'bordered' | 'underlined' | 'faded';

export interface AutocompleteProps<T extends object = object>
  extends Omit<HeroAutocompleteProps, 'children' | 'className' | 'variant'> {
  children?: ReactNode | ((item: T) => ReactNode);
  className?: string;
  classNames?: {
    base?: string;
    trigger?: string;
    value?: string;
    popover?: string;
    listbox?: string;
    searchInput?: string;
  };
  description?: ReactNode;
  errorMessage?: ReactNode;
  /** Custom filter; defaults to a locale-aware case-insensitive "contains" match. */
  filter?: (textValue: string, inputValue: string) => boolean;
  items?: Iterable<T>;
  label?: ReactNode;
  /** Placeholder shown in the (closed) trigger. */
  placeholder?: string;
  /** Placeholder + aria-label for the search input inside the popover. */
  searchPlaceholder?: string;
  startContent?: ReactNode;
  variant?: V3Variant | LegacyVariant;
}

/**
 * A select with built-in type-to-filter search, built on HeroUI v3 Autocomplete.
 * Compose options with the shared `ListBoxItem` / `ListBoxSection` parts (exported
 * from the barrel as `AutocompleteItem` / `AutocompleteSection`).
 */
export function Autocomplete<T extends object = object>({
  children,
  className,
  classNames,
  description,
  errorMessage,
  filter,
  items,
  label,
  placeholder,
  searchPlaceholder,
  startContent,
  variant,
  ...props
}: AutocompleteProps<T>) {
  const { t } = useTranslation('common');
  const { contains } = useFilter({ sensitivity: 'base' });
  const filterFn = filter ?? contains;

  return (
    <HeroAutocomplete
      {...props}
      className={cn(classNames?.base, className)}
      placeholder={placeholder}
      variant={mapVariant(variant)}
    >
      {label != null && <Label>{label}</Label>}
      <HeroAutocomplete.Trigger className={classNames?.trigger}>
        {/* The trigger is an inline-flex row with no gap: without this holder a
            start icon sat against the first letter of the value (B1 walk 6.5). */}
        {startContent != null && startContent !== false && (
          <span data-slot="start-content" className="me-2 inline-flex shrink-0 items-center self-center">
            {startContent}
          </span>
        )}
        <HeroAutocomplete.Value className={classNames?.value} />
        <HeroAutocomplete.ClearButton />
        <HeroAutocomplete.Indicator />
      </HeroAutocomplete.Trigger>
      {description != null && <Description>{description}</Description>}
      <HeroAutocomplete.Popover className={classNames?.popover}>
        <HeroAutocomplete.Filter filter={filterFn}>
          <SearchField aria-label={searchPlaceholder ?? t('accessibility.search')}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input className={classNames?.searchInput} placeholder={searchPlaceholder} />
            </SearchField.Group>
          </SearchField>
          <HeroListBox className={classNames?.listbox} items={items as HeroListBoxProps['items']}>
            {children as HeroListBoxProps['children']}
          </HeroListBox>
        </HeroAutocomplete.Filter>
      </HeroAutocomplete.Popover>
      {errorMessage != null && <FieldError>{errorMessage}</FieldError>}
    </HeroAutocomplete>
  );
}

function mapVariant(variant?: V3Variant | LegacyVariant): V3Variant {
  return variant === 'bordered' || variant === 'underlined' || variant === 'faded' || variant === 'secondary'
    ? 'secondary'
    : 'primary';
}
