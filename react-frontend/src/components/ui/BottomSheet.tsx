// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BottomSheet — Reusable component that renders as a bottom sheet on mobile
 * and preserves the same native sheet interaction on larger touch screens.
 *
 * Uses the HeroUI v3 Drawer primitive for focus management, scroll locking,
 * safe-area layout, and built-in drag-to-dismiss behaviour.
 */

import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerHeading,
} from '@/components/ui/Drawer';


export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Visible title and accessible dialog name. */
  title: string;
  children: React.ReactNode;
  /** Pinned action bar below the scrollable body (e.g. an apply button). */
  footer?: React.ReactNode;
  snapPoints?: ('full' | 'half' | 'auto')[];
  className?: string;
}

export function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  footer,
  snapPoints,
  className = '',
}: BottomSheetProps) {
  const { t } = useTranslation('common');
  // Determine max height class from first snap point
  const maxHeightClass = snapPoints?.[0] === 'full'
    ? 'max-h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom))]'
    : snapPoints?.[0] === 'half'
      ? 'max-h-[50dvh]'
      : 'max-h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom)-1rem)]';

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      placement="bottom"
      backdrop="blur"
      hideCloseButton
      classNames={{
        base: `w-full max-w-none bg-[var(--surface-dropdown)] border border-[var(--border-default)] rounded-t-3xl ${maxHeightClass} overflow-hidden ${className}`,
        backdrop: 'bg-black/60 backdrop-blur-sm',
        wrapper: 'items-end',
        header: 'p-0',
        body: 'p-0',
      }}
    >
      <DrawerContent aria-label={title} className="flex min-h-0 flex-col">
        <DrawerHandle className="shrink-0" />
        <DrawerHeader className="flex shrink-0 items-center justify-between border-b border-theme-default px-5 py-3">
          <DrawerHeading className="text-base font-semibold text-theme-primary">
            {title}
          </DrawerHeading>
          <Button
            isIconOnly
            variant="light"
            onPress={onClose}
            aria-label={t('accessibility.close')}
            className="min-h-[44px] min-w-[44px] text-theme-muted hover:text-theme-primary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </DrawerHeader>
        <DrawerBody className={`min-h-0 overflow-y-auto overscroll-contain px-5 pt-4 ${footer ? 'pb-4' : 'pb-[calc(var(--safe-area-bottom)+1.25rem)]'}`}>
          {children}
        </DrawerBody>
        {footer && (
          <div className="shrink-0 border-t border-theme-default bg-[var(--surface-dropdown)] px-5 pb-[calc(var(--safe-area-bottom)+0.75rem)] pt-3">
            {footer}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

export default BottomSheet;
