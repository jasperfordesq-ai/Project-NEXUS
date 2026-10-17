// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * What the editor says about each block: its plain-English name, a one-line
 * description of where it appears and what it does, and the icon in the outline.
 * The keys live in admin_content under `content.landing_block_*`.
 */

import Sparkles from 'lucide-react/icons/sparkles';
import LayoutGrid from 'lucide-react/icons/layout-grid';
import ListChecks from 'lucide-react/icons/list-checks';
import BarChart3 from 'lucide-react/icons/bar-chart-3';
import Footprints from 'lucide-react/icons/footprints';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import Megaphone from 'lucide-react/icons/megaphone';
import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import Zap from 'lucide-react/icons/zap';
import UserPlus from 'lucide-react/icons/user-plus';
import Search from 'lucide-react/icons/search';
import Handshake from 'lucide-react/icons/handshake';
import Coins from 'lucide-react/icons/coins';
import Heart from 'lucide-react/icons/heart';
import Shield from 'lucide-react/icons/shield';
import Star from 'lucide-react/icons/star';
import Globe from 'lucide-react/icons/globe';
import BookOpen from 'lucide-react/icons/book-open';
import MessageCircle from 'lucide-react/icons/message-circle';
import Award from 'lucide-react/icons/award';
import Target from 'lucide-react/icons/target';
import ThumbsUp from 'lucide-react/icons/thumbs-up';
import type { LucideIcon } from 'lucide-react';
import type { LandingIconId, LandingSectionType } from '@/types/landing-page';

export interface SectionMeta {
  /** `content.landing_block_<type>_name` */
  nameKey: string;
  /** `content.landing_block_<type>_desc` */
  descKey: string;
  icon: LucideIcon;
}

export const SECTION_META: Record<LandingSectionType, SectionMeta> = {
  hero: { nameKey: 'content.landing_block_hero_name', descKey: 'content.landing_block_hero_desc', icon: Sparkles },
  audience_cards: {
    nameKey: 'content.landing_block_audience_cards_name',
    descKey: 'content.landing_block_audience_cards_desc',
    icon: LayoutGrid,
  },
  feature_pills: {
    nameKey: 'content.landing_block_feature_pills_name',
    descKey: 'content.landing_block_feature_pills_desc',
    icon: ListChecks,
  },
  stats: { nameKey: 'content.landing_block_stats_name', descKey: 'content.landing_block_stats_desc', icon: BarChart3 },
  how_it_works: {
    nameKey: 'content.landing_block_how_it_works_name',
    descKey: 'content.landing_block_how_it_works_desc',
    icon: Footprints,
  },
  core_values: {
    nameKey: 'content.landing_block_core_values_name',
    descKey: 'content.landing_block_core_values_desc',
    icon: HeartHandshake,
  },
  cta: { nameKey: 'content.landing_block_cta_name', descKey: 'content.landing_block_cta_desc', icon: Megaphone },
};

/** Icons an admin can pick for a card, highlight or step, with a readable name key. */
export const ICON_CHOICES: Array<{ id: LandingIconId; icon: LucideIcon; nameKey: string }> = [
  { id: 'clock', icon: Clock, nameKey: 'content.landing_icon_clock' },
  { id: 'users', icon: Users, nameKey: 'content.landing_icon_users' },
  { id: 'zap', icon: Zap, nameKey: 'content.landing_icon_zap' },
  { id: 'user-plus', icon: UserPlus, nameKey: 'content.landing_icon_user_plus' },
  { id: 'search', icon: Search, nameKey: 'content.landing_icon_search' },
  { id: 'handshake', icon: Handshake, nameKey: 'content.landing_icon_handshake' },
  { id: 'coins', icon: Coins, nameKey: 'content.landing_icon_coins' },
  { id: 'heart', icon: Heart, nameKey: 'content.landing_icon_heart' },
  { id: 'shield', icon: Shield, nameKey: 'content.landing_icon_shield' },
  { id: 'star', icon: Star, nameKey: 'content.landing_icon_star' },
  { id: 'globe', icon: Globe, nameKey: 'content.landing_icon_globe' },
  { id: 'book-open', icon: BookOpen, nameKey: 'content.landing_icon_book_open' },
  { id: 'message-circle', icon: MessageCircle, nameKey: 'content.landing_icon_message_circle' },
  { id: 'award', icon: Award, nameKey: 'content.landing_icon_award' },
  { id: 'target', icon: Target, nameKey: 'content.landing_icon_target' },
  { id: 'thumbs-up', icon: ThumbsUp, nameKey: 'content.landing_icon_thumbs_up' },
];

/** The icons the public page uses when a list is left on its standard items. */
export const DEFAULT_PILL_ICONS: LandingIconId[] = ['clock', 'users', 'zap'];
export const DEFAULT_STEP_ICONS: LandingIconId[] = ['user-plus', 'search', 'handshake', 'coins'];

/** How many items each list may hold. Cards are capped by the server; the rest keep the page readable. */
export const LIST_LIMITS = { cards: 4, items: 6, steps: 6, values: 6 } as const;
