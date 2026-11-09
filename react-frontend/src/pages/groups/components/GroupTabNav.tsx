// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { Key, KeyboardEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@heroui/react/dropdown';
import { Label } from '@heroui/react/label';
import { useTranslation } from 'react-i18next';
import AlertCircle from 'lucide-react/icons/circle-alert';
import Calendar from 'lucide-react/icons/calendar';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import ChevronDown from 'lucide-react/icons/chevron-down';
import FileText from 'lucide-react/icons/file-text';
import Flag from 'lucide-react/icons/flag';
import FolderOpen from 'lucide-react/icons/folder-open';
import FolderTree from 'lucide-react/icons/folder-tree';
import Image from 'lucide-react/icons/image';
import Megaphone from 'lucide-react/icons/megaphone';
import MessageSquare from 'lucide-react/icons/message-square';
import Newspaper from 'lucide-react/icons/newspaper';
import Users from 'lucide-react/icons/users';
import Wrench from 'lucide-react/icons/wrench';
import { useTenant } from '@/contexts';
import { getAvailableGroupSections, type GroupSectionKey } from '../groupSections';

interface GroupTabNavProps {
  activeTab: GroupSectionKey;
  children: ReactNode;
  userIsAdmin: boolean;
  userIsMember: boolean;
  hasSubGroups: boolean;
  subGroupCount: number;
  onTabChange: (tab: GroupSectionKey) => void;
}

const PRIMARY_SECTION_KEYS = new Set<GroupSectionKey>([
  'feed',
  'subgroups',
  'discussion',
  'members',
  'events',
  'files',
]);

export function GroupTabNav({
  activeTab,
  children,
  userIsAdmin,
  userIsMember,
  hasSubGroups,
  subGroupCount,
  onTabChange,
}: GroupTabNavProps) {
  const { t } = useTranslation('groups');
  const { hasGroupTab, hasFeature } = useTenant();
  const keys = getAvailableGroupSections({
    hasGroupTab,
    hasSubgroups: hasSubGroups,
    userIsAdmin,
    userIsMember,
    hasEventsFeature: hasFeature('events'),
  });
  const labels: Record<GroupSectionKey, string> = {
    feed: t('detail.tab_feed'),
    subgroups: t('detail.tab_subgroups_count', { count: subGroupCount }),
    discussion: t('detail.tab_discussion'),
    members: t('detail.tab_members'),
    events: t('detail.tab_events'),
    files: t('detail.tab_files'),
    announcements: t('detail.tab_announcements'),
    qa: t('detail.tab_qa'),
    wiki: t('detail.tab_wiki'),
    media: t('detail.tab_media'),
    chatrooms: t('detail.tab_channels'),
    tasks: t('detail.tab_tasks'),
    challenges: t('detail.tab_challenges'),
    analytics: t('detail.tab_analytics'),
    automation: t('detail.tab_automation'),
  };
  const icons = {
    feed: Newspaper,
    subgroups: FolderTree,
    discussion: MessageSquare,
    members: Users,
    events: Calendar,
    files: FolderOpen,
    announcements: Megaphone,
    qa: AlertCircle,
    wiki: FileText,
    media: Image,
    chatrooms: MessageSquare,
    tasks: CheckCircle,
    challenges: Flag,
    analytics: Newspaper,
    automation: Wrench,
  } satisfies Record<GroupSectionKey, typeof Newspaper>;
  const sections = keys.map((key) => ({ key, label: labels[key], icon: icons[key] }));
  const activeSection = sections.find((section) => section.key === activeTab) ?? sections[0];

  if (!activeSection) return <>{children}</>;
  const ActiveIcon = activeSection.icon;
  const primarySections = sections.filter((section) => PRIMARY_SECTION_KEYS.has(section.key));
  const secondarySections = sections.filter((section) => !PRIMARY_SECTION_KEYS.has(section.key));
  const activeSecondarySection = secondarySections.find((section) => section.key === activeSection.key);
  const ActiveSecondaryIcon = activeSecondarySection?.icon;

  const selectSection = (key: Key) => {
    const next = String(key) as GroupSectionKey;
    if (keys.includes(next)) onTabChange(next);
  };

  const handlePrimaryKeyDown = (event: KeyboardEvent, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % primarySections.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + primarySections.length) % primarySections.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = primarySections.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextSection = primarySections[nextIndex];
    if (nextSection) selectSection(nextSection.key);
  };

  return (
    <>
      <div className="sticky top-[var(--app-header-mobile-offset,5rem)] z-20 -mx-1 rounded-xl border border-theme-default bg-surface/95 p-1 shadow-sm backdrop-blur sm:hidden">
        <Dropdown>
          <Dropdown.Trigger
            className="flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg px-3 text-theme-primary"
            aria-label={`${t('detail.tab_nav_aria')}: ${activeSection.label}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <ActiveIcon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span className="truncate font-medium">{activeSection.label}</span>
            </span>
            <ChevronDown className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu
              aria-label={t('detail.tab_nav_aria')}
              selectionMode="single"
              selectedKeys={new Set([activeSection.key])}
              onAction={selectSection}
            >
              {sections.map((section) => {
                const Icon = section.icon;
                return (
                  <Dropdown.Item key={section.key} id={section.key} textValue={section.label}>
                    <Dropdown.ItemIndicator />
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <Label>{section.label}</Label>
                  </Dropdown.Item>
                );
              })}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>

      <div
        className="sticky top-[calc(var(--app-header-desktop-offset,5.5rem)+0.75rem)] z-20 hidden items-center gap-1 rounded-xl border border-theme-default bg-surface/95 p-1 shadow-sm backdrop-blur sm:flex"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1" role="tablist" aria-label={t('detail.tab_nav_aria')}>
          {primarySections.map((section, index) => {
            const Icon = section.icon;
            const isSelected = section.key === activeSection.key;
            return (
              <Button
                as="button"
                key={section.key}
                id={`group-tab-${section.key}`}
                role="tab"
                aria-selected={isSelected}
                aria-controls="group-tab-panel"
                variant="ghost"
                size="sm"
                onPress={() => selectSection(section.key)}
                onKeyDown={(event) => handlePrimaryKeyDown(event, index)}
                className="h-9 min-w-0 shrink px-2.5 text-sm font-medium text-theme-muted hover:bg-theme-hover/60 hover:text-theme-primary data-[selected=true]:bg-[var(--surface-hover)]! data-[selected=true]:text-[var(--text-primary)]! data-[selected=true]:shadow-sm lg:px-3"
                data-selected={isSelected}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="max-w-28 truncate xl:max-w-36">{section.label}</span>
              </Button>
            );
          })}
        </div>

        {secondarySections.length > 0 && (
          <Dropdown>
            <Dropdown.Trigger
              aria-label={activeSecondarySection
                ? `${t('detail.tab_more_label')}: ${activeSecondarySection.label}`
                : t('detail.tab_more_label')}
              className="flex h-9 min-w-0 shrink items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-theme-muted hover:bg-theme-hover/60 hover:text-theme-primary data-[selected=true]:bg-[var(--surface-hover)]! data-[selected=true]:text-[var(--text-primary)]! data-[selected=true]:shadow-sm lg:px-3"
              data-selected={Boolean(activeSecondarySection)}
            >
              {activeSecondarySection && ActiveSecondaryIcon ? (
                <>
                  <ActiveSecondaryIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="max-w-28 truncate xl:max-w-36">{activeSecondarySection.label}</span>
                </>
              ) : (
                <span>{t('detail.tab_more_label')}</span>
              )}
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu
                aria-label={t('detail.tab_more_menu')}
                selectionMode="single"
                selectedKeys={activeSecondarySection ? new Set([activeSecondarySection.key]) : new Set()}
                onAction={selectSection}
              >
                {secondarySections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <Dropdown.Item key={section.key} id={section.key} textValue={section.label}>
                      <Dropdown.ItemIndicator />
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <Label>{section.label}</Label>
                    </Dropdown.Item>
                  );
                })}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        )}
      </div>

      <div
        id="group-tab-panel"
        role="tabpanel"
        aria-labelledby={activeSecondarySection ? undefined : `group-tab-${activeSection.key}`}
        aria-label={activeSecondarySection?.label}
        className="pt-4 outline-none sm:pt-5"
      >
        {children}
      </div>
    </>
  );
}
