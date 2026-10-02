// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Fragment, isValidElement, type ComponentProps, type Key, type ReactNode } from 'react';
import { Description } from '@heroui/react/description';
import { FieldError } from '@heroui/react/field-error';
import { Header } from '@heroui/react/header';
import { Label } from '@heroui/react/label';
import { ListBox, type ListBox as HeroListBoxTypes } from '@heroui/react/list-box';
import { Select as HeroSelect, type Select as HeroSelectTypes } from '@heroui/react/select';
import { Separator } from '@heroui/react/separator';
import { Spinner } from '@heroui/react/spinner';
import { cn } from '@/lib/helpers';

type HeroSelectProps = HeroSelectTypes['Props'];
type HeroSelectPopoverProps = HeroSelectTypes['PopoverProps'];
type HeroListBoxProps = HeroListBoxTypes['Props'];
type HeroListBoxItemProps = ComponentProps<typeof ListBox.Item>;
type HeroListBoxSectionProps = ComponentProps<typeof ListBox.Section>;
type SelectKey = string | number;
type SelectionLike = 'all' | Iterable<SelectKey>;

interface LegacySelectClassNames {
  base?: string;
  description?: string;
  errorMessage?: string;
  label?: string;
  listbox?: string;
  listboxWrapper?: string;
  mainWrapper?: string;
  popoverContent?: string;
  selectorIcon?: string;
  trigger?: string;
  value?: string;
}

interface LegacySelectItemClassNames {
  base?: string;
  description?: string;
  title?: string;
}

export interface SelectProps<T extends object = object>
  extends Omit<
    HeroSelectProps,
    | 'children'
    | 'className'
    | 'defaultValue'
    | 'onChange'
    | 'onSelectionChange'
    | 'selectionMode'
    | 'size'
    | 'value'
    | 'validate'
    | 'variant'
  > {
  children?: ReactNode | ((item: T) => ReactNode);
  className?: string;
  classNames?: LegacySelectClassNames;
  color?: string;
  defaultSelectedKeys?: SelectionLike;
  defaultValue?: HeroSelectProps['defaultValue'];
  description?: ReactNode;
  disallowEmptySelection?: boolean;
  endContent?: ReactNode;
  errorMessage?: ReactNode;
  isClearable?: boolean;
  isLoading?: boolean;
  items?: Iterable<T>;
  label?: ReactNode;
  labelPlacement?: string;
  listboxProps?: Partial<HeroListBoxProps> & Record<string, unknown>;
  onChange?: (event: { target: { value: string }; currentTarget: { value: string } }) => void;
  onSelectionChange?: (keys: 'all' | Set<Key>) => void;
  onValueChange?: (value: string) => void;
  popoverProps?: Partial<HeroSelectPopoverProps> & Record<string, unknown>;
  renderValue?: (items: Array<{ key: SelectKey | null; textValue?: string }>) => ReactNode;
  scrollShadowProps?: unknown;
  selectedKeys?: SelectionLike;
  selectorIcon?: ReactNode;
  selectionMode?: 'single' | 'multiple';
  size?: 'sm' | 'md' | 'lg';
  startContent?: ReactNode;
  value?: HeroSelectProps['value'];
  variant?: HeroSelectProps['variant'] | 'flat' | 'faded' | 'bordered' | 'underlined';
}

export function Select<T extends object = object>({
  children,
  className,
  classNames,
  color: _color,
  defaultSelectedKeys,
  defaultValue,
  description,
  disallowEmptySelection: _disallowEmptySelection,
  endContent,
  errorMessage,
  isClearable: _isClearable,
  isLoading = false,
  items,
  label,
  labelPlacement: _labelPlacement,
  listboxProps,
  onChange,
  onSelectionChange,
  onValueChange,
  popoverProps,
  renderValue,
  scrollShadowProps: _scrollShadowProps,
  selectedKeys,
  selectorIcon,
  size = 'md',
  startContent,
  value,
  variant,
  ...props
}: SelectProps<T>) {
  const selectionMode = props.selectionMode;
  const resolvedValue = value ?? selectionToValue(selectedKeys, selectionMode);
  const resolvedDefaultValue = defaultValue ?? selectionToValue(defaultSelectedKeys, selectionMode);

  return (
    <HeroSelect
      {...props}
      className={cn(classNames?.base, classNames?.mainWrapper, className)}
      data-loading={isLoading || undefined}
      data-size={size}
      defaultValue={resolvedDefaultValue}
      isDisabled={Boolean(props.isDisabled || isLoading)}
      items={items}
      onChange={(nextValue: SelectKey | readonly SelectKey[] | null) => {
        const values = valueToArray(nextValue);
        const firstValue = values[0] == null ? '' : String(values[0]);

        onSelectionChange?.(new Set<Key>(values));
        onValueChange?.(firstValue);
        onChange?.({ target: { value: firstValue }, currentTarget: { value: firstValue } });
      }}
      value={resolvedValue}
      variant={variant === 'underlined' ? 'secondary' : mapVariant(variant)}
    >
      {label && <Label className={classNames?.label}>{label}</Label>}
      <HeroSelect.Trigger
        className={cn(
          SELECT_TRIGGER_SIZE_CLASSES[size],
          isLoading ? SELECT_TRIGGER_END_PADDING[size] : SELECT_TRIGGER_INDICATOR_PADDING,
          classNames?.trigger,
        )}
      >
        {startContent}
        <HeroSelect.Value className={classNames?.value}>
          {renderValue
            ? ({ selectedText, state }) => {
                const selectedItems = state.selectedItems?.map((item) => ({
                  key: item?.key ?? null,
                  textValue: item?.textValue,
                })) ?? [];

                return renderValue(selectedItems.length ? selectedItems : [{ key: null, textValue: selectedText }]);
              }
            : undefined}
        </HeroSelect.Value>
        {endContent}
        {isLoading ? (
          <Spinner aria-hidden="true" className="shrink-0" size="sm" />
        ) : (
          <HeroSelect.Indicator className={classNames?.selectorIcon}>{selectorIcon}</HeroSelect.Indicator>
        )}
      </HeroSelect.Trigger>
      {description && <Description className={classNames?.description}>{description}</Description>}
      <HeroSelect.Popover
        {...popoverProps}
        className={cn(
          'nexus-responsive-select-popover bg-[var(--surface-dropdown)] border border-[var(--border-default)] shadow-lg',
          classNames?.popoverContent,
          popoverProps?.className as string | undefined,
        )}
      >
        <ListBox
          {...listboxProps}
          className={cn(classNames?.listboxWrapper, classNames?.listbox, listboxProps?.className)}
          items={items}
          selectionMode={selectionMode}
        >
          {children as HeroListBoxProps['children']}
        </ListBox>
      </HeroSelect.Popover>
      {errorMessage && <FieldError className={classNames?.errorMessage}>{errorMessage}</FieldError>}
    </HeroSelect>
  );
}

// Start padding only. HeroUI positions the chevron absolutely at the trigger's
// end edge and reserves room for it with `pe-7`; a symmetric `px-*` here is a
// utility, so it beat that component rule and the selected text ran under the
// chevron. End padding is set separately below.
const SELECT_TRIGGER_SIZE_CLASSES: Record<NonNullable<SelectProps['size']>, string> = {
  sm: 'min-h-8 ps-2 py-1 text-sm',
  md: 'min-h-9 ps-3 py-2 text-sm',
  lg: 'min-h-12 ps-4 py-3 text-base',
};

// Chevron sits at `end-2` and is `size-4`, so `pe-7` keeps text clear of it.
const SELECT_TRIGGER_INDICATOR_PADDING = 'pe-7';

// While loading, an in-flow spinner replaces the chevron, so plain end padding
// matching the start side is enough.
const SELECT_TRIGGER_END_PADDING: Record<NonNullable<SelectProps['size']>, string> = {
  sm: 'pe-2',
  md: 'pe-3',
  lg: 'pe-4',
};

export interface SelectItemProps
  extends Omit<HeroListBoxItemProps, 'children' | 'id' | 'textValue' | 'variant'> {
  children?: ReactNode;
  classNames?: LegacySelectItemClassNames;
  color?: string;
  description?: ReactNode;
  endContent?: ReactNode;
  id?: HeroListBoxItemProps['id'];
  startContent?: ReactNode;
  textValue?: string;
  variant?: HeroListBoxItemProps['variant'] | 'flat' | 'faded' | 'bordered' | 'light' | 'shadow';
}

export function SelectItem({
  children,
  className,
  classNames,
  color,
  description,
  endContent,
  id,
  startContent,
  textValue,
  variant,
  ...props
}: SelectItemProps) {
  const danger = color === 'danger' || variant === 'danger';

  return (
    <ListBox.Item
      {...props}
      className={cn(classNames?.base, className as string | undefined)}
      id={id}
      textValue={textValue ?? inferTextValue(children)}
      variant={danger ? 'danger' : 'default'}
    >
      {startContent}
      {description ? (
        <div className="flex flex-col">
          {renderLabel(children, classNames?.title)}
          <Description className={classNames?.description}>{description}</Description>
        </div>
      ) : (
        renderLabel(children, classNames?.title)
      )}
      {endContent}
      <ListBox.ItemIndicator />
    </ListBox.Item>
  );
}

export interface SelectSectionProps extends Omit<HeroListBoxSectionProps, 'children'> {
  children?: ReactNode;
  showDivider?: boolean;
  title?: ReactNode;
}

export function SelectSection({ children, showDivider, title, ...props }: SelectSectionProps) {
  return (
    <Fragment>
      <ListBox.Section {...props}>
        {title && <Header>{title}</Header>}
        {children}
      </ListBox.Section>
      {showDivider && <Separator />}
    </Fragment>
  );
}

function mapVariant(variant: SelectProps['variant']): HeroSelectProps['variant'] {
  if (variant === 'secondary') {
    return 'secondary';
  }

  return 'primary';
}

function selectionToValue(selection: SelectionLike | undefined, selectionMode: SelectProps['selectionMode']) {
  if (!selection || selection === 'all') {
    return undefined;
  }

  const values = Array.from(selection);

  if (selectionMode === 'multiple') {
    return values;
  }

  return values[0] ?? null;
}

function valueToArray(value: SelectKey | readonly SelectKey[] | null) {
  if (Array.isArray(value)) {
    return value;
  }

  return value == null ? [] : [value];
}

function renderLabel(children: ReactNode, className?: string) {
  if (typeof children === 'string' || typeof children === 'number') {
    return <Label className={className}>{children}</Label>;
  }

  if (className) {
    return <span className={className}>{children}</span>;
  }

  return children;
}

function inferTextValue(node: ReactNode): string | undefined {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    const text = node.map(inferTextValue).filter(Boolean).join(' ').trim();

    return text || undefined;
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return inferTextValue(node.props.children);
  }

  return undefined;
}
