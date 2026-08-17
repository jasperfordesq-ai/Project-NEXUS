// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Quick Create Menu
 * Modal overlay triggered by the MobileTabBar Create button
 * Feature/module-gated options for creating new content
 */

import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import ListTodo from 'lucide-react/icons/list-todo';
import Calendar from 'lucide-react/icons/calendar';
import Users from 'lucide-react/icons/users';
import Target from 'lucide-react/icons/target';
import Heart from 'lucide-react/icons/heart';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { useTenant, useAuth } from '@/contexts';
import { canCreateEvents } from '@/lib/access';
import type { TenantFeatures, TenantModules } from '@/types/api';
import { Button } from '@/components/ui/Button';
import { Modal, ModalContent, ModalBody } from '@/components/ui/Modal';

interface QuickCreateMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface CreateOptionDef {
  labelKey: string;
  descKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  feature?: keyof TenantFeatures;
  module?: keyof TenantModules;
}

const createOptionDefs: CreateOptionDef[] = [
  {
    labelKey: 'quick_create.new_listing',
    descKey: 'quick_create.new_listing_desc',
    href: '/listings/create',
    icon: ListTodo,
    color: 'from-emerald-500 to-teal-600',
    module: 'listings',
  },
  {
    labelKey: 'quick_create.offer_time',
    descKey: 'quick_create.offer_time_desc',
    href: '/caring-community',
    icon: Heart,
    color: 'from-teal-500 to-emerald-600',
    feature: 'caring_community',
  },
  {
    labelKey: 'quick_create.new_event',
    descKey: 'quick_create.new_event_desc',
    href: '/events/create',
    icon: Calendar,
    color: 'from-amber-500 to-orange-600',
    feature: 'events',
  },
  {
    labelKey: 'quick_create.new_group',
    descKey: 'quick_create.new_group_desc',
    href: '/groups/create',
    icon: Users,
    color: 'from-accent to-pink-600',
    feature: 'groups',
  },
  {
    labelKey: 'quick_create.new_goal',
    descKey: 'quick_create.new_goal_desc',
    href: '/goals',
    icon: Target,
    color: 'from-blue-500 to-cyan-600',
    feature: 'goals',
  },
];

/**
 * @param canCreateEvent Server-resolved: a community may restrict Event creation
 *   to brokers/admins even while the `events` feature is on. Defaults to true so
 *   existing callers and tests are unaffected.
 */
export function getVisibleCreateOptions(
  hasFeature: (feature: keyof TenantFeatures) => boolean,
  hasModule: (module: keyof TenantModules) => boolean,
  canCreateEvent = true,
): CreateOptionDef[] {
  return createOptionDefs.filter((option) => {
    if (option.feature && !hasFeature(option.feature)) return false;
    if (option.module && !hasModule(option.module)) return false;
    if (option.href === '/events/create' && !canCreateEvent) return false;
    return true;
  });
}

export function QuickCreateMenu({ isOpen, onClose }: QuickCreateMenuProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const { hasFeature, hasModule, tenantPath } = useTenant();
  const { user } = useAuth();

  const visibleOptions = getVisibleCreateOptions(hasFeature, hasModule, canCreateEvents(user));

  const handleSelect = (href: string) => {
    onClose();
    navigate(tenantPath(href));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      placement="bottom"
      size="sm"
      hideCloseButton
      scrollBehavior="inside"
      classNames={{
        backdrop: 'bg-black/60 backdrop-blur-sm',
        base: 'bg-[var(--surface-dropdown)] border border-[var(--border-default)] shadow-2xl mx-0 sm:mx-4 overflow-hidden',
        body: 'min-h-0 overflow-y-auto overscroll-contain p-0',
      }}
    >
      <ModalContent aria-label={t('quick_create.title')}>
        <ModalBody>
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="min-h-0"
              >
                {/* Header */}
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-theme-default bg-[var(--surface-dropdown)] px-4 pb-3 pt-2 sm:px-5 sm:pt-4">
                  <h2 className="text-lg font-semibold text-theme-primary">
                    {t('quick_create.title')}
                  </h2>
                  <Button
                    isIconOnly
                    variant="light"
                    size="sm"
                    onPress={onClose}
                    aria-label={t('quick_create.close_aria')}
                    className="min-h-[44px] min-w-[44px] text-theme-muted hover:text-theme-primary"
                  >
                    <X className="w-5 h-5" aria-hidden="true" />
                  </Button>
                </div>

                {/* Options Grid */}
                <div
                  className="grid grid-cols-2 gap-3 px-4 pb-5 pt-4 sm:px-5"
                  data-testid="quick-create-options"
                >
                  {visibleOptions.map((option, index) => {
                    const Icon = option.icon;
                    return (
                      <motion.div
                        key={option.href}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05, duration: 0.15 }}
                        className="flex min-w-0"
                      >
                        <Button
                          onPress={() => handleSelect(option.href)}
                          className="group h-auto min-h-[116px] w-full min-w-0 flex-1 flex-col items-center justify-start gap-2 overflow-visible whitespace-normal rounded-2xl border border-theme-default bg-theme-elevated px-3 py-4 text-center transition-all hover:bg-theme-hover"
                          variant="light"
                        >
                          <span
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${option.color} shadow-lg transition-transform group-hover:scale-110`}
                          >
                            <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                          </span>
                          <span className="block min-w-0 text-center">
                            <span className="block text-sm font-semibold leading-tight text-theme-primary">
                              {t(option.labelKey)}
                            </span>
                            <span className="mt-1 block text-sm leading-snug text-theme-muted">
                              {t(option.descKey)}
                            </span>
                          </span>
                        </Button>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export default QuickCreateMenu;
