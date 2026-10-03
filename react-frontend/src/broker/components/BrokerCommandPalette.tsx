// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BrokerCommandPalette — ⌘K / Ctrl+K jump-to-anywhere for the broker panel.
 *
 * A lightweight, dependency-free palette in five sections:
 *   Recent        — the last pages this browser visited (useBrokerRecentPages)
 *   Pages         — every broker destination, mirroring the sidebar
 *   Members       — a live member search once two characters are typed
 *                   (debounced; a slow earlier answer is discarded)
 *   Help articles — broker guides from the Help Centre index
 *   Actions       — "Next unreviewed message", "Pending members", "Switch theme"
 *
 * Destinations mirror the sidebar (including the feature gates) so the two
 * can't drift apart — both consume BROKER_DESTINATIONS.
 *
 * Accessibility: one combobox + one listbox with aria-activedescendant; the
 * arrow keys walk the rows across sections as one list; focus stays in the
 * input; Escape closes and returns focus to the trigger (Modal's focus
 * restore handles that).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import Users from 'lucide-react/icons/users';
import UserRound from 'lucide-react/icons/user-round';
import UserRoundCheck from 'lucide-react/icons/user-round-check';
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
import Settings2 from 'lucide-react/icons/settings-2';
import HelpCircle from 'lucide-react/icons/circle-help';
import History from 'lucide-react/icons/history';
import BookOpen from 'lucide-react/icons/book-open';
import Moon from 'lucide-react/icons/moon';
import Sun from 'lucide-react/icons/sun';
import SearchIcon from 'lucide-react/icons/search';
import CornerDownLeft from 'lucide-react/icons/corner-down-left';
import { Modal, ModalContent, Kbd, Spinner } from '@/components/ui';
import { useTenant, useTheme, useToast } from '@/contexts';
import { adminBroker, adminUsers } from '@/admin/api/adminApi';
import type { AdminUser, BrokerMessage } from '@/admin/api/types';
import { useHelpGuides } from '@/pages/help/guides/useHelpGuides';
import { normaliseBrokerPath, useBrokerRecentPages } from '../useBrokerRecentPages';

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
  { key: 'safeguarding-guardians', labelKey: 'nav.safeguarding_guardians', icon: UserRoundCheck, path: '/broker/safeguarding/guardians' },
  { key: 'safeguarding-support-actions', labelKey: 'nav.safeguarding_support_actions', icon: ClipboardCheck, path: '/broker/safeguarding/support-actions' },
  { key: 'safeguarding-volunteering', labelKey: 'nav.safeguarding_volunteering', icon: HandHeart, path: '/broker/safeguarding/volunteering', feature: 'volunteering' },
  { key: 'safeguarding-options', labelKey: 'nav.safeguarding_options', icon: SlidersHorizontal, path: '/broker/safeguarding-options' },
  { key: 'vetting', labelKey: 'nav.vetting', icon: ShieldCheck, path: '/broker/vetting' },
  { key: 'monitoring', labelKey: 'nav.monitoring', icon: Eye, path: '/broker/monitoring' },
  { key: 'risk-tags', labelKey: 'nav.risk_tags', icon: AlertTriangle, path: '/broker/risk-tags' },
  { key: 'insurance', labelKey: 'nav.insurance', icon: FileText, path: '/broker/insurance' },
  { key: 'archives', labelKey: 'nav.archives', icon: Archive, path: '/broker/archives' },
  { key: 'configuration', labelKey: 'nav.configuration', icon: Settings2, path: '/broker/configuration' },
  { key: 'help', labelKey: 'nav.help', icon: HelpCircle, path: '/broker/help' },
];

type SectionKey = 'recent' | 'pages' | 'members' | 'help' | 'actions';

const SECTION_ORDER: SectionKey[] = ['recent', 'pages', 'members', 'help', 'actions'];

const SECTION_LABEL_KEY: Record<SectionKey, string> = {
  recent: 'palette.section_recent',
  pages: 'palette.section_pages',
  members: 'palette.section_members',
  help: 'palette.section_help',
  actions: 'palette.section_actions',
};

interface PaletteRow {
  id: string;
  section: SectionKey;
  label: string;
  /** Secondary text shown after the label (a record id, a guide's section). */
  hint?: string;
  icon: LucideIcon;
  onSelect: () => void;
}

/** Members search waits this long after the last keystroke. */
const MEMBER_SEARCH_DEBOUNCE_MS = 250;
const MEMBER_SEARCH_MIN_CHARS = 2;
const MEMBER_RESULTS = 5;
const HELP_RESULTS = 5;

/** Pull the list out of either response shape the API has used (bare array or {data}). */
function listFrom<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: T[] }).data;
  }
  return [];
}

interface BrokerCommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BrokerCommandPalette({ isOpen, onClose }: BrokerCommandPaletteProps) {
  const { t } = useTranslation('broker');
  const { tenantPath, tenant, hasFeature, hasModule } = useTenant();
  const { resolvedTheme, toggleTheme } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { search: searchHelp } = useHelpGuides();
  const recentPaths = useBrokerRecentPages();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [memberResults, setMemberResults] = useState<{ query: string; items: AdminUser[] }>({ query: '', items: [] });
  const [membersLoading, setMembersLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const memberRequestRef = useRef(0);

  const q = query.trim().toLowerCase();

  const go = useCallback((path: string) => {
    onClose();
    navigate(tenantPath(path));
  }, [onClose, navigate, tenantPath]);

  const destinations = useMemo(
    () => BROKER_DESTINATIONS.filter(
      (d) => (!d.feature || hasFeature(d.feature)) && (!d.module || hasModule(d.module))
    ),
    [hasFeature, hasModule]
  );

  // ── Pages ────────────────────────────────────────────────────────────────
  const pageRows = useMemo<PaletteRow[]>(() => {
    const matching = q ? destinations.filter((d) => t(d.labelKey).toLowerCase().includes(q)) : destinations;
    return matching.map((d) => ({
      id: `broker-palette-${d.key}`,
      section: 'pages',
      label: t(d.labelKey),
      icon: d.icon,
      onSelect: () => go(d.path),
    }));
  }, [q, destinations, t, go]);

  // ── Recent ───────────────────────────────────────────────────────────────
  const recentRows = useMemo<PaletteRow[]>(() => {
    const current = normaliseBrokerPath(pathname, tenant?.slug);
    const rows: PaletteRow[] = [];
    for (const path of recentPaths) {
      if (path === current) continue;
      // The destination the path belongs to: exact, or the longest parent.
      const destination = destinations
        .filter((d) => path === d.path || path.startsWith(`${d.path}/`))
        .sort((a, b) => b.path.length - a.path.length)[0];
      if (!destination || destination.path === '/broker') continue;
      const tail = path.slice(destination.path.length + 1);
      const hint = tail ? (/^\d+$/.test(tail) ? `#${tail}` : tail) : undefined;
      const label = t(destination.labelKey);
      if (q && !label.toLowerCase().includes(q) && !(hint ?? '').toLowerCase().includes(q)) continue;
      rows.push({
        id: `broker-palette-recent-${path.replace(/[^a-z0-9]+/gi, '-')}`,
        section: 'recent',
        label,
        hint,
        icon: History,
        onSelect: () => go(path),
      });
    }
    return rows;
  }, [recentPaths, pathname, tenant?.slug, destinations, q, t, go]);

  // ── Members (debounced, stale answers discarded) ─────────────────────────
  useEffect(() => {
    if (!isOpen || q.length < MEMBER_SEARCH_MIN_CHARS) {
      memberRequestRef.current++;
      setMembersLoading(false);
      return;
    }
    const requestId = ++memberRequestRef.current;
    setMembersLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await adminUsers.list({ search: q, limit: MEMBER_RESULTS });
        if (requestId !== memberRequestRef.current) return;
        setMemberResults({ query: q, items: res.success ? listFrom<AdminUser>(res.data).slice(0, MEMBER_RESULTS) : [] });
      } catch {
        if (requestId === memberRequestRef.current) setMemberResults({ query: q, items: [] });
      } finally {
        if (requestId === memberRequestRef.current) setMembersLoading(false);
      }
    }, MEMBER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, isOpen]);

  const memberRows = useMemo<PaletteRow[]>(() => {
    if (q.length < MEMBER_SEARCH_MIN_CHARS || memberResults.query !== q) return [];
    return memberResults.items.map((member) => ({
      id: `broker-palette-member-${member.id}`,
      section: 'members',
      label: member.name || [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email,
      hint: t('palette.member_hint'),
      icon: UserRound,
      onSelect: () => go(`/broker/members?search=${encodeURIComponent(member.name || member.email)}`),
    }));
  }, [q, memberResults, t, go]);

  // ── Help articles ────────────────────────────────────────────────────────
  const helpRows = useMemo<PaletteRow[]>(() => {
    if (!q) return [];
    return searchHelp(q)
      .filter((result) => result.audience === 'brokers')
      .slice(0, HELP_RESULTS)
      .map((result) => ({
        id: `broker-palette-help-${result.sectionId}-${result.articleId}`,
        section: 'help',
        label: result.title,
        hint: result.sectionTitle,
        icon: BookOpen,
        onSelect: () => go(`/broker/help/${result.sectionId}/${result.articleId}`),
      }));
  }, [q, searchHelp, go]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const openNextUnreviewed = useCallback(async () => {
    try {
      const res = await adminBroker.getMessages({ filter: 'unreviewed' });
      const first = res.success ? listFrom<BrokerMessage>(res.data)[0] : undefined;
      if (first) {
        go(`/broker/messages/${first.id}?queue=unreviewed`);
        return;
      }
    } catch {
      // Treated as nothing waiting: the queue page is one click away either way.
    }
    onClose();
    toast.info(t('palette.nothing_waiting'));
  }, [go, onClose, toast, t]);

  const actionRows = useMemo<PaletteRow[]>(() => {
    const all: PaletteRow[] = [
      {
        id: 'broker-palette-action-next-unreviewed',
        section: 'actions',
        label: t('palette.action_next_unreviewed'),
        icon: MessageSquareWarning,
        onSelect: () => void openNextUnreviewed(),
      },
      {
        id: 'broker-palette-action-pending-members',
        section: 'actions',
        label: t('palette.action_pending_members'),
        icon: UserCheck,
        onSelect: () => go('/broker/members?status=pending'),
      },
      {
        id: 'broker-palette-action-switch-theme',
        section: 'actions',
        label: t('palette.action_switch_theme'),
        icon: resolvedTheme === 'dark' ? Sun : Moon,
        onSelect: () => {
          void toggleTheme();
          onClose();
        },
      },
    ];
    return q ? all.filter((row) => row.label.toLowerCase().includes(q)) : all;
  }, [q, t, openNextUnreviewed, go, resolvedTheme, toggleTheme, onClose]);

  // One flat list in section order, so the arrow keys walk across sections.
  const sections = useMemo(() => {
    const bySection: Record<SectionKey, PaletteRow[]> = {
      recent: recentRows,
      pages: pageRows,
      members: memberRows,
      help: helpRows,
      actions: actionRows,
    };
    return SECTION_ORDER.map((key) => ({ key, rows: bySection[key] })).filter((s) => s.rows.length > 0);
  }, [recentRows, pageRows, memberRows, helpRows, actionRows]);

  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const showMembersLoading = membersLoading && q.length >= MEMBER_SEARCH_MIN_CHARS && memberRows.length === 0;

  // Reset state each time the palette opens.
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      setMemberResults({ query: '', items: [] });
      // Modal focuses itself first; steal focus to the input on the next tick.
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Keep the active row valid as the list changes.
  useEffect(() => {
    if (activeIndex >= rows.length) setActiveIndex(0);
  }, [rows.length, activeIndex]);

  const activeRow = rows[activeIndex];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(Math.max(rows.length - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activeRow?.onSelect();
    }
  };

  let runningIndex = 0;

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
            aria-expanded={rows.length > 0}
            aria-controls="broker-palette-list"
            aria-activedescendant={activeRow?.id}
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
        <ul id="broker-palette-list" role="listbox" aria-label={t('palette.results_label')} className="max-h-96 overflow-y-auto p-2">
          {rows.length === 0 && !showMembersLoading ? (
            <li className="px-3 py-8 text-center text-sm text-muted" role="presentation">
              {t('palette.no_results', { query })}
            </li>
          ) : (
            sections.map((section, sectionIdx) => (
              <li key={section.key} role="presentation" className={sectionIdx > 0 ? 'mt-2' : ''}>
                <p className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wider text-muted" role="presentation">
                  {t(SECTION_LABEL_KEY[section.key])}
                </p>
                <ul role="presentation" className="flex flex-col">
                  {section.rows.map((row) => {
                    const idx = runningIndex++;
                    const Icon = row.icon;
                    const active = idx === activeIndex;
                    return (
                      // The option itself takes the click: the combobox input keeps
                      // focus and handles the keyboard, so no nested button is needed.
                      <li
                        key={row.id}
                        id={row.id}
                        role="option"
                        aria-selected={active}
                        onClick={() => row.onSelect()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            row.onSelect();
                          }
                        }}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors motion-reduce:transition-none ${
                          active ? 'bg-accent/10 text-accent' : 'text-foreground hover:bg-surface-secondary'
                        }`}
                      >
                        <Icon size={18} className={active ? 'text-accent' : 'text-muted'} aria-hidden="true" />
                        <span className="flex-1 truncate">{row.label}</span>
                        {row.hint && <span className="shrink-0 truncate text-xs text-muted">{row.hint}</span>}
                        {active && <CornerDownLeft size={14} className="shrink-0 text-muted" aria-hidden="true" />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
          {showMembersLoading && (
            <li role="presentation" className="mt-2">
              <p className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wider text-muted">
                {t('palette.section_members')}
              </p>
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted" aria-live="polite">
                <Spinner size="sm" aria-hidden="true" />
                <span>{t('palette.members_loading')}</span>
              </div>
            </li>
          )}
        </ul>
      </ModalContent>
    </Modal>
  );
}

export default BrokerCommandPalette;
