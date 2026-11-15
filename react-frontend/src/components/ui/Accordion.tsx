// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { createContext, isValidElement, useContext, type ComponentProps, type ReactNode } from 'react';
import { Accordion as HeroAccordion, type Accordion as HeroAccordionTypes } from '@heroui/react/accordion';
import ChevronDown from 'lucide-react/icons/chevron-down';
import { cn } from '@/lib/helpers';

type HeroAccordionProps = HeroAccordionTypes['Props'];
type HeroAccordionItemProps = HeroAccordionTypes['ItemProps'];
type HeroAccordionBodyProps = ComponentProps<typeof HeroAccordion.Body>;

type LegacyAccordionVariant = 'light' | 'shadow' | 'bordered' | 'splitted' | 'default' | 'surface';

interface LegacyAccordionItemClasses {
  base?: string;
  content?: string;
  heading?: string;
  indicator?: string;
  subtitle?: string;
  title?: string;
  trigger?: string;
}

const AccordionItemClassesContext = createContext<LegacyAccordionItemClasses | undefined>(undefined);

export interface AccordionProps
  extends Omit<
    HeroAccordionProps,
    | 'allowsMultipleExpanded'
    | 'defaultExpandedKeys'
    | 'expandedKeys'
    | 'hideSeparator'
    | 'onExpandedChange'
    | 'variant'
  > {
  allowsMultipleExpanded?: boolean;
  defaultExpandedKeys?: HeroAccordionProps['defaultExpandedKeys'];
  defaultSelectedKeys?: HeroAccordionProps['defaultExpandedKeys'];
  disableAnimation?: boolean;
  disallowEmptySelection?: boolean;
  dividerProps?: unknown;
  expandedKeys?: HeroAccordionProps['expandedKeys'];
  hideSeparator?: boolean;
  isCompact?: boolean;
  itemClasses?: LegacyAccordionItemClasses;
  keepContentMounted?: boolean;
  motionProps?: unknown;
  onExpandedChange?: HeroAccordionProps['onExpandedChange'];
  onSelectionChange?: HeroAccordionProps['onExpandedChange'];
  selectedKeys?: HeroAccordionProps['expandedKeys'];
  selectionBehavior?: string;
  selectionMode?: 'single' | 'multiple';
  showDivider?: boolean;
  variant?: LegacyAccordionVariant;
}

export function Accordion({
  className,
  defaultExpandedKeys,
  defaultSelectedKeys,
  disableAnimation: _disableAnimation,
  disallowEmptySelection: _disallowEmptySelection,
  dividerProps: _dividerProps,
  expandedKeys,
  itemClasses,
  isCompact: _isCompact,
  keepContentMounted: _keepContentMounted,
  motionProps: _motionProps,
  onExpandedChange,
  onSelectionChange,
  selectedKeys,
  selectionBehavior: _selectionBehavior,
  selectionMode,
  showDivider,
  variant,
  ...props
}: AccordionProps) {
  const resolvedItemClasses = variant === 'splitted'
    ? mergeItemClasses(SPLITTED_ITEM_CLASSES, itemClasses)
    : itemClasses;

  return (
    <AccordionItemClassesContext.Provider value={resolvedItemClasses}>
      <HeroAccordion
        {...props}
        allowsMultipleExpanded={selectionMode === 'multiple' || props.allowsMultipleExpanded}
        className={cn(variant === 'splitted' && 'space-y-2', className as string | undefined)}
        defaultExpandedKeys={defaultExpandedKeys ?? defaultSelectedKeys}
        expandedKeys={expandedKeys ?? selectedKeys}
        hideSeparator={variant === 'splitted' || showDivider === false ? true : props.hideSeparator}
        onExpandedChange={onExpandedChange ?? onSelectionChange}
        variant={mapVariant(variant)}
      />
    </AccordionItemClassesContext.Provider>
  );
}

const SPLITTED_ITEM_CLASSES: LegacyAccordionItemClasses = {
  base: 'overflow-hidden rounded-2xl bg-surface shadow-surface',
};

export interface AccordionItemProps
  extends Omit<HeroAccordionItemProps, 'children' | 'id'> {
  children?: ReactNode;
  classNames?: LegacyAccordionItemClasses;
  /**
   * The level of the heading the row's button sits in (HeroUI's default is 3).
   * Set it where the rows are not third-level headings in the page's outline,
   * e.g. rows nested inside another accordion's panel.
   */
  headingLevel?: number;
  hideIndicator?: boolean;
  id?: HeroAccordionItemProps['id'];
  indicator?: ReactNode | ((props: { isOpen?: boolean; isDisabled?: boolean }) => ReactNode);
  startContent?: ReactNode;
  subtitle?: ReactNode;
  title?: ReactNode;
}

export function AccordionItem({
  children,
  className,
  classNames,
  headingLevel,
  hideIndicator,
  id,
  indicator,
  startContent,
  subtitle,
  title,
  ...props
}: AccordionItemProps) {
  const inheritedClassNames = useContext(AccordionItemClassesContext);
  const resolvedClassNames = mergeItemClasses(inheritedClassNames, classNames);

  return (
    <HeroAccordion.Item {...props} id={id} className={cn(resolvedClassNames.base, className as string | undefined)}>
      <HeroAccordion.Heading className={resolvedClassNames.heading} level={headingLevel}>
        <HeroAccordion.Trigger className={cn('gap-3', resolvedClassNames.trigger)}>
          {startContent}
          <span className="flex min-w-0 flex-1 flex-col text-left">
            <span className={resolvedClassNames.title}>{renderTitle(title)}</span>
            {subtitle && <span className={cn('text-sm text-theme-subtle', resolvedClassNames.subtitle)}>{subtitle}</span>}
          </span>
          {!hideIndicator && (
            <HeroAccordion.Indicator className={resolvedClassNames.indicator}>
              {renderIndicator(indicator)}
            </HeroAccordion.Indicator>
          )}
        </HeroAccordion.Trigger>
      </HeroAccordion.Heading>
      <HeroAccordion.Panel>
        <HeroAccordion.Body className={resolvedClassNames.content as HeroAccordionBodyProps['className']}>
          {children}
        </HeroAccordion.Body>
      </HeroAccordion.Panel>
    </HeroAccordion.Item>
  );
}

function mergeItemClasses(
  inherited: LegacyAccordionItemClasses | undefined,
  local: LegacyAccordionItemClasses | undefined,
): LegacyAccordionItemClasses {
  return {
    base: cn(inherited?.base, local?.base),
    content: cn(inherited?.content, local?.content),
    heading: cn(inherited?.heading, local?.heading),
    indicator: cn(inherited?.indicator, local?.indicator),
    subtitle: cn(inherited?.subtitle, local?.subtitle),
    title: cn(inherited?.title, local?.title),
    trigger: cn(inherited?.trigger, local?.trigger),
  };
}

function mapVariant(variant: LegacyAccordionVariant | undefined): HeroAccordionProps['variant'] {
  if (variant === 'shadow' || variant === 'surface') {
    return 'surface';
  }

  return 'default';
}

function renderTitle(title: ReactNode) {
  if (title === undefined || title === null) {
    return null;
  }

  if (typeof title === 'string' || typeof title === 'number' || isValidElement(title)) {
    return title;
  }

  return <span>{title}</span>;
}

function renderIndicator(indicator: AccordionItemProps['indicator']) {
  if (typeof indicator === 'function') {
    return indicator({});
  }

  return indicator ?? <ChevronDown className="size-4" aria-hidden="true" />;
}
