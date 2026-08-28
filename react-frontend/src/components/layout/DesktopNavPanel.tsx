// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared desktop navigation popover panel.
 * Used by grouped header menus so Community and More share one row anatomy.
 */

import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from 'react';
import { useLocation } from 'react-router-dom';
import ChevronDown from 'lucide-react/icons/chevron-down';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Popover, PopoverContent, PopoverHeading, PopoverTrigger } from '@/components/ui/Popover';
import { ScrollShadow } from '@/components/ui/ScrollShadow';

export interface DesktopNavPanelItem {
  label: string;
  desc?: string;
  href: string;
  icon: LucideIcon;
}

export interface DesktopNavPanelSection {
  key: string;
  title: string;
  items: DesktopNavPanelItem[];
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

interface DesktopNavPanelProps {
  ariaLabel: string;
  isActive: boolean;
  isOpen: boolean;
  leftSections: DesktopNavPanelSection[];
  onNavigate: (path: string) => void;
  onOpenChange: (open: boolean) => void;
  rightSections?: DesktopNavPanelSection[];
  triggerIcon: LucideIcon;
  triggerLabel: string;
}

function countVisibleItems(sections: DesktopNavPanelSection[], expandedSections: Set<string>) {
  return sections.reduce((total, section) => {
    if (section.collapsible && !expandedSections.has(section.key)) {
      return total;
    }

    return total + section.items.length;
  }, 0);
}

function visibleSections(sections: DesktopNavPanelSection[]) {
  return sections.filter(section => section.items.length > 0);
}

export function DesktopNavPanel({
  ariaLabel,
  isActive,
  isOpen,
  leftSections,
  onNavigate,
  onOpenChange,
  rightSections = [],
  triggerIcon: TriggerIcon,
  triggerLabel,
}: DesktopNavPanelProps) {
  const location = useLocation();
  const menuRef = useRef<HTMLElement>(null);
  const allSections = useMemo(() => [...leftSections, ...rightSections], [leftSections, rightSections]);
  const hasRightColumn = visibleSections(rightSections).length > 0;

  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    allSections.forEach(section => {
      if (section.collapsible && section.defaultExpanded) {
        initial.add(section.key);
      }
    });

    return initial;
  });

  useEffect(() => {
    setExpandedSections(prev => {
      const next = new Set<string>();
      const currentKeys = new Set(allSections.map(section => section.key));
      allSections.forEach(section => {
        if (section.collapsible && (section.defaultExpanded || prev.has(section.key))) {
          next.add(section.key);
        }
      });

      prev.forEach(key => {
        if (currentKeys.has(key)) {
          next.add(key);
        }
      });

      return next;
    });
  }, [allSections]);

  const leftItemCount = useMemo(
    () => countVisibleItems(leftSections, expandedSections),
    [leftSections, expandedSections],
  );

  useEffect(() => {
    if (!isOpen) return;

    requestAnimationFrame(() => {
      const firstButton = menuRef.current?.querySelector<HTMLButtonElement>('button[data-mega-item]');
      firstButton?.focus();
    });
  }, [isOpen]);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!menuRef.current) return;

    const buttons = Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('button[data-mega-item]'));
    if (buttons.length === 0) return;

    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusedIndex = currentIndex >= 0 ? currentIndex : 0;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      buttons[(focusedIndex + 1) % buttons.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      buttons[(focusedIndex - 1 + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (hasRightColumn && focusedIndex < leftItemCount && leftItemCount < buttons.length) {
        buttons[leftItemCount]?.focus();
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (hasRightColumn && focusedIndex >= leftItemCount) {
        buttons[0]?.focus();
      }
    } else if (event.key === 'Home') {
      event.preventDefault();
      buttons[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      buttons[buttons.length - 1]?.focus();
    } else if (event.key === 'Escape') {
      onOpenChange(false);
    }
  }, [hasRightColumn, leftItemCount, onOpenChange]);

  const renderItem = (item: DesktopNavPanelItem) => {
    const active = location.pathname.startsWith(item.href);
    const Icon = item.icon;

    return (
      <Button
        key={item.href}
        data-desktop-nav-item
        data-mega-item
        onPress={() => onNavigate(item.href)}
        variant="light"
        className={`desktop-nav-panel-item group w-full flex !h-auto min-h-[3.5rem] items-start gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-start transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 justify-start ${
          active
            ? 'bg-theme-active text-theme-primary'
            : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
        }`}
      >
        <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] transition-colors ${
          active ? 'text-theme-primary' : 'text-theme-subtle group-hover:text-theme-primary'
        }`}>
          <Icon className="w-4 h-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 overflow-hidden">
          <span className="block truncate text-sm font-medium leading-tight">{item.label}</span>
          {item.desc ? (
            <span className="mt-0.5 block truncate text-xs leading-tight text-theme-subtle">
              {item.desc}
            </span>
          ) : null}
        </span>
      </Button>
    );
  };

  const renderSection = (section: DesktopNavPanelSection, isFirst: boolean) => {
    if (section.items.length === 0) return null;

    const isExpanded = !section.collapsible || expandedSections.has(section.key);

    return (
      <div key={section.key} className={isFirst ? '' : 'mt-2'}>
        {!isFirst ? (
          <div className="mx-3 mb-1.5 border-t border-[var(--border-default)] opacity-40" />
        ) : null}
        {section.collapsible ? (
          <Button
            variant="light"
            onPress={() => toggleSection(section.key)}
            aria-expanded={isExpanded}
            className="w-full flex min-h-9 items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-theme-subtle transition-colors motion-reduce:transition-none hover:bg-theme-hover hover:text-theme-primary"
          >
            <span>{section.title}</span>
            <ChevronDown
              className={`w-3 h-3 transition-transform duration-200 motion-reduce:transition-none ${isExpanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </Button>
        ) : (
          <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-theme-subtle">
            {section.title}
          </p>
        )}
        {isExpanded ? (
          <div className="mt-0.5 space-y-0.5">
            {section.items.map(item => renderItem(item))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderColumn = (sections: DesktopNavPanelSection[], showBorder: boolean) => {
    const nonEmptySections = visibleSections(sections);
    if (nonEmptySections.length === 0) return null;

    return (
      <div className={`desktop-nav-panel-column min-w-0 p-2 ${showBorder ? 'border-l border-[var(--border-default)]' : ''}`}>
        {nonEmptySections.map((section, index) => renderSection(section, index === 0))}
      </div>
    );
  };

  return (
    <Popover
      placement="bottom-start"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      shouldBlockScroll={false}
      offset={8}
    >
      <PopoverTrigger aria-haspopup="menu">
        <Button
          variant="light"
          size="sm"
          className={`flex items-center gap-1 px-3 py-2 text-sm font-medium transition-all ${
            isActive
              ? 'bg-theme-active text-theme-primary'
              : 'text-theme-muted hover:text-theme-primary hover:bg-theme-hover'
          }`}
          endContent={<ChevronDown className="w-3 h-3" aria-hidden="true" />}
        >
          <TriggerIcon className="w-4 h-4" aria-hidden="true" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 bg-[var(--surface-dropdown)] border border-[var(--border-default)] shadow-2xl rounded-xl max-h-[75vh] max-w-[calc(100vw-2rem)] overflow-hidden">
        <PopoverHeading className="sr-only">{ariaLabel}</PopoverHeading>
        <ScrollShadow className="max-h-[75vh]" size={56}>
          {/* The keydown handler here is delegated keyboard navigation for the
              links inside (arrow keys / Home / End across the panel), which is
              the standard way to implement a roving-focus menu. The rule reads
              <nav> as non-interactive and objects; the listener adds keyboard
              support rather than removing it. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <nav
            ref={menuRef}
            className={`desktop-nav-panel grid grid-cols-1 gap-0 p-2 w-full min-w-0 ${hasRightColumn ? 'sm:grid-cols-2 sm:min-w-[540px]' : 'sm:min-w-[300px]'}`}
            aria-label={ariaLabel}
            onKeyDown={handleKeyDown}
          >
            {renderColumn(leftSections, false)}
            {renderColumn(rightSections, hasRightColumn)}
          </nav>
        </ScrollShadow>
      </PopoverContent>
    </Popover>
  );
}

export default DesktopNavPanel;
