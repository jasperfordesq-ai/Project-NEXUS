// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type ComponentProps, type ReactNode } from 'react';
import { ComboBox as HeroComboBox } from '@heroui/react/combo-box';
import { Description } from '@heroui/react/description';
import { FieldError } from '@heroui/react/field-error';
import { Input } from '@heroui/react/input';
import { Label } from '@heroui/react/label';
import { ListBox as HeroListBox } from '@heroui/react/list-box';
import { useFilter } from '@heroui/react/rac';
import { cn } from '@/lib/helpers';

type HeroComboBoxProps = ComponentProps<typeof HeroComboBox>;
type HeroListBoxProps = ComponentProps<typeof HeroListBox>;

export interface ComboBoxProps<T extends object = object>
  extends Omit<HeroComboBoxProps, 'children' | 'className'> {
  children?: ReactNode | ((item: T) => ReactNode);
  className?: string;
  classNames?: {
    base?: string;
    inputGroup?: string;
    input?: string;
    popover?: string;
    listbox?: string;
  };
  description?: ReactNode;
  errorMessage?: ReactNode;
  items?: Iterable<T>;
  label?: ReactNode;
  placeholder?: string;
  /** Rendered inside the listbox when the (possibly filtered) collection is empty. */
  renderEmptyState?: () => ReactNode;
  startContent?: ReactNode;
  /**
   * Apply default client-side "contains" filtering. Leave off (default) for
   * server-side / async filtering driven by controlled `inputValue`/`onInputChange`,
   * where the backend already returns the filtered set.
   */
  useDefaultFilter?: boolean;
}

/**
 * An editable text input paired with a filterable listbox, built on HeroUI v3 ComboBox.
 * Supports custom values (`allowsCustomValue`) and async loading (controlled
 * `inputValue`/`onInputChange` + `allowsEmptyCollection`). Compose options with the
 * shared `ListBoxItem` / `ListBoxSection` parts (exported as `ComboBoxItem` / `ComboBoxSection`).
 */
export function ComboBox<T extends object = object>({
  children,
  className,
  classNames,
  defaultFilter,
  description,
  errorMessage,
  items,
  label,
  placeholder,
  renderEmptyState,
  startContent,
  useDefaultFilter,
  ...props
}: ComboBoxProps<T>) {
  const { contains } = useFilter({ sensitivity: 'base' });
  const resolvedFilter = defaultFilter ?? (useDefaultFilter ? contains : undefined);

  return (
    <HeroComboBox
      {...props}
      className={cn(classNames?.base, className)}
      defaultFilter={resolvedFilter}
    >
      {label != null && <Label>{label}</Label>}
      <HeroComboBox.InputGroup className={classNames?.inputGroup}>
        {/* HeroUI's ComboBox input group is a plain positioned flex row: the Input
            carries the border and the Trigger floats over its end. A start icon
            dropped in as a sibling therefore sat OUTSIDE the field's border. Float
            it over the start the same way the trigger floats over the end, and
            make room for it inside the input. */}
        {startContent != null && (
          <span
            aria-hidden="true"
            data-slot="combo-box-start-content"
            className="pointer-events-none absolute inset-y-0 start-0 z-10 flex items-center ps-3 text-muted"
          >
            {startContent}
          </span>
        )}
        <Input
          className={cn(startContent != null && 'ps-9', classNames?.input)}
          placeholder={placeholder}
        />
        <HeroComboBox.Trigger />
      </HeroComboBox.InputGroup>
      {description != null && <Description>{description}</Description>}
      <HeroComboBox.Popover className={classNames?.popover}>
        <HeroListBox
          className={classNames?.listbox}
          items={items as HeroListBoxProps['items']}
          renderEmptyState={renderEmptyState as HeroListBoxProps['renderEmptyState']}
        >
          {children as HeroListBoxProps['children']}
        </HeroListBox>
      </HeroComboBox.Popover>
      {errorMessage != null && <FieldError>{errorMessage}</FieldError>}
    </HeroComboBox>
  );
}
