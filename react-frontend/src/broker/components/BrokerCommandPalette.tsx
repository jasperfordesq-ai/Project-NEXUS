// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BrokerCommandPalette — ⌘K / Ctrl+K jump-to-anywhere for the broker panel.
 *
 * A lightweight, dependency-free palette: type to filter the broker
 * destinations, arrow keys to move, Enter to go. Destinations mirror the
 * sidebar (including the exchange_workflow gate) so the two can't drift
 * apart — both consume BROKER_DESTINATIONS.
 *
 * Accessibility: combobox pattern with aria-activedescendant; focus stays
 * in the input; Escape closes and returns focus to the trigger (Modal's
 * focus restore handles that).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import Users from 'lucide-react/icons/users';
import UserPlus from 'lucide-react/icons/user-plus';
import UserCheck from 'lucide-react/icons/user-check';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import HandHeart from 'lucide-react/icons/hand-heart';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import MessageSquareWarning from 'lucide-react/icons/message-square-warning';
import ShieldPlus from 'lucide-react/icons/shield-plus';
import MessageSquare from 'lucide-react/icons/message-square';
import MessageCircle from 'lucide-react/icons/message-circle';
import Star from 'lucide-react/icons/star';
import Flag from 'lucide-react/icons/flag';
import Eye from 'lucide-react/icons/eye';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import FileText from 'lucide-react/icons/file-text';
import Archive from 'lucide-react/icons/archive';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import HelpCircle from 'lucide-react/icons/circle-help';
import SearchIcon from 'lucide-react/icons/search';
import CornerDownLeft from 'lucide-react/icons/corner-down-left';
import { Modal, ModalContent, Kbd } from '@/components/ui';
import { useTenant } from '@/contexts';

export interface BrokerDestination {
  key: string;
  /** broker.json key for the label (nav.* reused). */
  labelKey: string;
  icon: LucideIcon;
  path: string;
  /** Tenant feature that must be enabled for this destination. */
  feature?: 'exchange_workflow' | 'reviews' | 'volunteering';
  /** Tenant module that must be enabled for this destination. */
  module?: 'feed';
}

export const BROKER_DESTINATIONS: BrokerDestination[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, path: '/broker' },
  { key: 'members', labelKey: 'nav.members', icon: Users, path: '/broker/members' },
  { key: 'onboarding', labelKey: 'nav.onboarding', icon: UserPlus, path: '/broker/onboarding' },
  { key: 'exchanges', labelKey: 'nav.exchanges', icon: ArrowLeftRight, path: '/broker/exchanges', feature: 'exchange_workflow' },
  { key: 'match-approvals', labelKey: 'nav.match_approvals', icon: UserCheck, path: '/broker/match-approvals', feature: 'exchange_workflow' },
  { key: 'messages', labelKey: 'nav.messages', icon: MessageSquareWarning, path: '/broker/messages' },
  { key: 'moderation-queue', labelKey: 'nav.moderation_queue', icon: ShieldPlus, path: '/broker/moderation/queue' },
  { key: 'moderation-feed', labelKey: 'nav.moderation_feed', icon: MessageSquare, path: '/broker/moderation/feed', module: 'feed' },
  { key: 'moderation-comments', labelKey: 'nav.moderation_comments', icon: MessageCircle, path: '/broker/moderation/comments' },
  { key: 'moderation-reviews', labelKey: 'nav.moderation_reviews', icon: Star, path: '/broker/moderation/reviews', feature: 'reviews' },
  { key: 'moderation-reports', labelKey: 'nav.moderation_reports', icon: Flag, path: '/broker/moderation/reports' },
  { key: 'safeguarding-support-needs', labelKey: 'nav.safeguarding_support_needs', icon: HeartHandshake, path: '/broker/safeguarding/support-needs' },
  { key: 'safeguarding-guardians', labelKey: 'nav.safeguarding_guardians', icon: Users, path: '/broker/safeguarding/guardians' },
  { key: 'safeguarding-support-actions', labelKey: 'nav.safeguarding_support_actions', icon: ClipboardCheck, path: '/broker/safeguarding/support-actions' },
  { key: 'safeguarding-volunteering', labelKey: 'nav.safeguarding_volunteering', icon: HandHeart, path: '/broker/safeguarding/volunteering', feature: 'volunteering' },
  { key: 'safeguarding-options', labelKey: 'nav.safeguarding_options', icon: SlidersHorizontal, path: '/broker/safeguarding-options' },
  { key: 'vetting', labelKey: 'nav.vetting', icon: ShieldCheck, path: '/broker/vetting' },
  { key: 'monitoring', labelKey: 'nav.monitoring', icon: Eye, path: '/broker/monitoring' },
  { key: 'risk-tags', labelKey: 'nav.risk_tags', icon: AlertTriangle, path: '/broker/risk-tags' },
  { key: 'insurance', labelKey: 'nav.insurance', icon: FileText, path: '/broker/insurance' },
  { key: 'archives', labelKey: 'nav.archives', icon: Archive, path: '/broker/archives' },
  { key: 'configuration', labelKey: 'nav.configuration', icon: SlidersHorizontal, path: '/broker/configuration' },
  { key: 'help', labelKey: 'nav.help', icon: HelpCircle, path: '/broker/help' },
];

interface BrokerCommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BrokerCommandPalette({ isOpen, onClose }: BrokerCommandPaletteProps) {
  const { t } = useTranslation('broker');
  const { tenantPath, hasFeature, hasModule } = useTenant();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const destinations = useMemo(
    () => BROKER_DESTINATIONS.filter(
      (d) => (!d.feature || hasFeature(d.feature)) && (!d.module || hasModule(d.module))
    ),
    [hasFeature, hasModule]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return destinations;
    return destinations.filter((d) => t(d.labelKey).toLowerCase().includes(q));
  }, [query, destinations, t]);

  // Reset state each time the palette opens.
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      // Modal focuses itself first; steal focus to the input on the next tick.
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Keep the active row valid as the filter narrows.
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  const go = (path: string) => {
    onClose();
    navigate(tenantPath(path));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[activeIndex];
      if (target) go(target.path);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" placement="top">
      <ModalContent
        aria-label={t('palette.aria_label')}
        className="overflow-hidden p-0"
      >
        <div className="flex items-center gap-3 border-b border-divider px-4 py-3">
          <SearchIcon size={18} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={filtered.length > 0}
            aria-controls="broker-palette-list"
            aria-activedescendant={filtered[activeIndex] ? `broker-palette-${filtered[activeIndex].key}` : undefined}
            aria-label={t('palette.aria_label')}
            className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted"
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <Kbd className="hidden shrink-0 sm:inline-flex">{t('palette.close_key')}</Kbd>
        </div>
        <ul id="broker-palette-list" role="listbox" aria-label={t('palette.results_label')} className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-muted" role="presentation">
              {t('palette.no_results', { query })}
            </li>
          ) : (
            filtered.map((d, idx) => {
              const Icon = d.icon;
              const active = idx === activeIndex;
              return (
                <li
                  key={d.key}
                  id={`broker-palette-${d.key}`}
                  role="option"
                  aria-selected={active}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => go(d.path)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors motion-reduce:transition-none ${
                      active ? 'bg-accent/10 text-accent' : 'text-foreground hover:bg-surface-secondary'
                    }`}
                  >
                    <Icon size={18} className={active ? 'text-accent' : 'text-muted'} aria-hidden="true" />
                    <span className="flex-1 truncate">{t(d.labelKey)}</span>
                    {active && <CornerDownLeft size={14} className="shrink-0 text-muted" aria-hidden="true" />}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </ModalContent>
    </Modal>
  );
}

export default BrokerCommandPalette;
