// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ComposeHub — Universal content creation modal with tabbed interface.
 *
 * Supports creating posts, polls, listings, events, and goals from a single
 * modal. Each tab is feature/module-gated by the tenant configuration.
 *
 * Mobile: Full-screen portal overlay with slide-up animation.
 * Desktop: HeroUI Modal with underlined tabs and glass background.
 */

import { lazy, Suspense, useState, useMemo, useEffect } from 'react';

import { Separator } from '@/components/ui/Separator';
import BarChart3 from 'lucide-react/icons/chart-column';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Calendar from 'lucide-react/icons/calendar';
import Target from 'lucide-react/icons/target';
import FileText from 'lucide-react/icons/file-text';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ComposeSubmitProvider } from './ComposeSubmitContext';
import { MobileComposeOverlay } from './MobileComposeOverlay';
import { GroupSelector } from './shared/GroupSelector';
import type { ComposeHubProps, ComposeTab, ComposeTabConfig } from './types';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, Tab } from '@/components/ui/Tabs';

const EventTab = lazy(() => import('./tabs/EventTab').then((module) => ({ default: module.EventTab })));
const GoalTab = lazy(() => import('./tabs/GoalTab').then((module) => ({ default: module.GoalTab })));
const ListingTab = lazy(() => import('./tabs/ListingTab').then((module) => ({ default: module.ListingTab })));
const PollTab = lazy(() => import('./tabs/PollTab').then((module) => ({ default: module.PollTab })));
const PostTab = lazy(() => import('./tabs/PostTab').then((module) => ({ default: module.PostTab })));

const ALL_TABS: ComposeTabConfig[] = [
  { key: 'listing', label: 'Listing', icon: ShoppingBag, gate: { type: 'module', key: 'listings' } },
  { key: 'post', label: 'Post', icon: FileText },
  { key: 'event', label: 'Event', icon: Calendar, gate: { type: 'feature', key: 'events' } },
  { key: 'goal', label: 'Goal', icon: Target, gate: { type: 'feature', key: 'goals' } },
  { key: 'poll', label: 'Poll', icon: BarChart3, gate: { type: 'feature', key: 'polls' } },
];

const TABS_WITH_GROUPS: ComposeTab[] = ['post', 'poll', 'event'];

export function ComposeHub({
  isOpen,
  onClose,
  defaultTab = 'post',
  onSuccess,
  groupId,
  editItem,
  onEditSuccess,
}: ComposeHubProps) {
  const { t } = useTranslation('feed');
  const { hasFeature, hasModule } = useTenant();
  const [activeTab, setActiveTab] = useState<ComposeTab>(defaultTab);
  const [sharedGroupId, setSharedGroupId] = useState<number | null>(groupId ?? null);
  // Sync activeTab when defaultTab prop changes (e.g. user clicks different quick-action)
  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  // Track whether any child tab has unsaved content (reported via callback)
  const [hasChildContent, setHasChildContent] = useState(false);

  // Warn user if they try to navigate away while compose is open with content
  useEffect(() => {
    if (!isOpen || !hasChildContent) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isOpen, hasChildContent]);

  const isMobile = useMediaQuery('(max-width: 639px)');

  const tabs = useMemo(() => {
    return ALL_TABS.filter((tab) => {
      if (!tab.gate) return true;
      if (tab.gate.type === 'feature') return hasFeature(tab.gate.key);
      return hasModule(tab.gate.key);
    });
  }, [hasFeature, hasModule]);

  // If the requested tab is feature/module-gated off for this tenant (e.g. a
  // caller defaults to 'listing' but the listings module is disabled), fall
  // back to the first available tab instead of rendering a hidden tab's form.
  useEffect(() => {
    const firstTab = tabs[0];
    if (firstTab && !tabs.some((tc) => tc.key === activeTab)) {
      setActiveTab(firstTab.key);
    }
  }, [tabs, activeTab]);

  const handleClose = () => {
    setActiveTab(defaultTab);
    setSharedGroupId(groupId ?? null);
    setHasChildContent(false);
    onClose();
  };

  const handleSuccess = (type: ComposeTab, id?: number) => {
    onSuccess?.(type, id);
  };

  const activeConfig = ALL_TABS.find((tc) => tc.key === activeTab);
  const ActiveIcon = activeConfig?.icon ?? ShoppingBag;

  const tabProps = {
    onSuccess: handleSuccess,
    onClose: handleClose,
    isOpen,
    groupId: sharedGroupId,
    onContentChange: setHasChildContent,
  };

  const tabFallback = (
    <div className="flex min-h-48 items-center justify-center">
      <Spinner size="sm" aria-label={t('loading_label')} />
    </div>
  );

  /** Body content — group selector + active tab */
  const bodyContent = (
    <>
      {TABS_WITH_GROUPS.includes(activeTab) && (
        <div className="mb-4">
          <GroupSelector
            value={sharedGroupId}
            onChange={setSharedGroupId}
          />
        </div>
      )}

      <Suspense fallback={tabFallback}>
        {activeTab === 'listing' && <ListingTab {...tabProps} />}
        {activeTab === 'post' && <PostTab {...tabProps} editItem={editItem} onEditSuccess={onEditSuccess} />}
        {activeTab === 'poll' && <PollTab {...tabProps} />}
        {activeTab === 'event' && <EventTab {...tabProps} />}
        {activeTab === 'goal' && <GoalTab {...tabProps} />}
      </Suspense>
    </>
  );

  /* ── Mobile: Full-screen portal overlay ── */
  if (isMobile) {
    return (
      <ComposeSubmitProvider>
        <MobileComposeOverlay
          isOpen={isOpen}
          onClose={handleClose}
          activeTab={activeTab}
          onTabChange={editItem ? () => {} : setActiveTab}
          tabs={editItem ? [] : tabs}
          headerTitle={editItem ? t('card.edit_post') : t('compose.create_title', { type: t(`compose.tab_${activeTab}`) })}
        >
          {bodyContent}
        </MobileComposeOverlay>
      </ComposeSubmitProvider>
    );
  }

  /* ── Desktop: HeroUI Modal with underlined tabs ── */
  return (
    <ComposeSubmitProvider>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        size="2xl"
        scrollBehavior="inside"
        classNames={{
          base: 'bg-[var(--surface-dropdown)] border border-[var(--border-default)] max-h-[85vh]',
          wrapper: 'items-center',
          backdrop: 'bg-black/60 backdrop-blur-sm',
          body: 'px-6',
          header: 'px-6',
        }}
      >
        <ModalContent>
          <ModalHeader className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 pb-2 text-[var(--text-primary)]">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-strong to-accent-strong-end flex items-center justify-center flex-shrink-0">
              <ActiveIcon className="w-4 h-4 text-white" aria-hidden="true" />
            </div>
            <ModalHeading className="font-semibold">
              {editItem ? t('card.edit_post') : t('compose.create_title', { type: t(`compose.tab_${activeTab}`) })}
            </ModalHeading>

            {/* Underlined tabs — hidden in edit mode (locked to Post tab) */}
            {!editItem && (
              <Tabs
                  className="col-span-3"
                  aria-label={t('compose.type_tabs_aria')}
                  selectedKey={activeTab}
                  onSelectionChange={(key) => setActiveTab(key as ComposeTab)}
                  variant="underlined"
                  size="sm"
                  classNames={{
                    tabList: 'gap-2 p-0 border-b border-[var(--border-default)]',
                    tab: 'min-h-[44px] px-3 text-[var(--text-muted)] data-[selected=true]:text-[var(--text-primary)]',
                    cursor: 'bg-gradient-to-r from-accent to-accent-gradient-end h-[2px] rounded-full',
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
            )}
          </ModalHeader>

          <Separator className="bg-[var(--border-default)]" />

          <ModalBody className="pt-4 pb-4">
            {bodyContent}
          </ModalBody>
        </ModalContent>
      </Modal>
    </ComposeSubmitProvider>
  );
}
