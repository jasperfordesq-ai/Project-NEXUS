// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MobileComposeOverlay — Full-screen compose overlay for mobile.
 *
 * Rendered via createPortal to document.body at z-[400] so it sits above
 * the Navbar (z-300) and MobileTabBar (z-300). Uses the local @/lib/motion
 * shim (CSS-transition-backed) for the slide-up animation.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FocusScope } from '@react-aria/focus';
import { motion, AnimatePresence } from '@/lib/motion';
import { ScrollShadow } from '@/components/ui';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { useComposeSubmit } from './ComposeSubmitContext';
import type { ComposeTab, ComposeTabConfig } from './types';
import { Button, Tabs, Tab } from '@/components/ui';

interface MobileComposeOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: ComposeTab;
  onTabChange: (tab: ComposeTab) => void;
  tabs: ComposeTabConfig[];
  headerTitle: string;
  children: React.ReactNode;
}

export function MobileComposeOverlay({
  isOpen,
  onClose,
  activeTab,
  onTabChange,
  tabs,
  headerTitle,
  children,
}: MobileComposeOverlayProps) {
  const { t } = useTranslation('feed');
  const { registration } = useComposeSubmit();

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <FocusScope contain restoreFocus autoFocus>
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t('compose.compose_post')}
          className="fixed inset-0 z-[400] flex flex-col bg-[var(--surface-base)] pt-[env(safe-area-inset-top,0px)]"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        >
          {/* ── Sticky Header ── */}
          <div className="flex items-center gap-2 h-14 px-3 border-b border-[var(--border-default)] shrink-0">
            {/* Close */}
            <Button
              isIconOnly
              variant="tertiary"
              size="sm"
              onPress={onClose}
              aria-label={t('compose.close_compose')}
              className="size-11 min-h-11"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </Button>

            {/* Title */}
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <span className="font-semibold text-[var(--text-primary)] truncate">
                {headerTitle}
              </span>
            </div>

            {/* Submit */}
            {registration && (
              <Button
                size="sm"
                onPress={registration.onSubmit}
                isLoading={registration.isSubmitting}
                isDisabled={!registration.canSubmit}
                className={`bg-gradient-to-r ${registration.gradientClass} text-white shadow-lg min-w-[72px]`}
              >
                {registration.buttonLabel}
              </Button>
            )}
          </div>

          {/* ── Tab Chips Row ── */}
          <div className="px-3 py-2 border-b border-[var(--border-default)] shrink-0 overflow-x-auto scrollbar-hide">
            <Tabs
              aria-label={t('compose.type_tabs_aria')}
              selectedKey={activeTab}
              onSelectionChange={(key) => onTabChange(key as ComposeTab)}
              variant="primary"
              size="sm"
              classNames={{
                tabList: 'gap-1 p-0',
                tab: 'min-h-[40px] px-3 data-[selected=true]:bg-gradient-to-r data-[selected=true]:from-accent-strong data-[selected=true]:to-accent-strong-end data-[selected=true]:text-white rounded-full',
                cursor: 'hidden',
              }}
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <Tab
                    key={tab.key}
                    title={
                      <div className="flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t(`compose.tab_${tab.key}`)}</span>
                      </div>
                    }
                  />
                );
              })}
            </Tabs>
          </div>

          {/* ── Scrollable Body ── */}
          <ScrollShadow
            className="flex-1 overflow-y-auto px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
          >
            {children}
          </ScrollShadow>
        </motion.div>
        </FocusScope>
      )}
    </AnimatePresence>,
    document.body,
  );
}
