// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * How each kind of notification looks: its icon and its tile colour.
 *
 * One map for the notifications page AND the bell drop-down, so a message
 * notice is the message colour in both (warmth plan W1/B2). Community activity
 * uses `kindColour()` — the same colour that kind has everywhere on the site.
 * Safeguarding and review notices keep their own warning colours; they are not
 * a kind of community activity.
 */

import type { ComponentType, SVGProps } from 'react';
import Bell from 'lucide-react/icons/bell';
import MessageSquare from 'lucide-react/icons/message-square';
import ListTodo from 'lucide-react/icons/list-todo';
import Wallet from 'lucide-react/icons/wallet';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import User from 'lucide-react/icons/user';
import Calendar from 'lucide-react/icons/calendar';
import Users from 'lucide-react/icons/users';
import Award from 'lucide-react/icons/award';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Shield from 'lucide-react/icons/shield';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import Eye from 'lucide-react/icons/eye';
import Info from 'lucide-react/icons/info';
import { kindColour } from '@/components/feed/feedTypeColours';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export interface NotificationKindLook {
  Icon: Icon;
  /** Tile classes: a pale tint with deep text, light on a dark tint in dark mode. */
  tile: string;
}

const WARNING_RED = 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300';

export const NOTIFICATION_KINDS: Record<string, NotificationKindLook> = {
  message: { Icon: MessageSquare, tile: kindColour('message').label },
  listing: { Icon: ListTodo, tile: kindColour('listing').label },
  transaction: { Icon: Wallet, tile: kindColour('hours').label },
  connection: { Icon: User, tile: kindColour('member').label },
  event: { Icon: Calendar, tile: kindColour('event').label },
  group: { Icon: Users, tile: kindColour('group').label },
  achievement: { Icon: Award, tile: kindColour('achievement').label },
  group_exchange: { Icon: ArrowLeftRight, tile: kindColour('exchange').label },
  safeguarding_flag: { Icon: ShieldAlert, tile: WARNING_RED },
  safeguarding_assignment: { Icon: Shield, tile: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' },
  // A volunteer asked for someone to get in touch, or the nightly check raised
  // a high-risk wellbeing alert: a safeguarding matter, not a system notice.
  volunteer_wellbeing: { Icon: HeartPulse, tile: WARNING_RED },
  broker_review: { Icon: Eye, tile: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  system: { Icon: Info, tile: 'bg-theme-elevated text-theme-muted' },
};

const DEFAULT_LOOK: NotificationKindLook = { Icon: Bell, tile: 'bg-theme-elevated text-theme-muted' };

export function notificationKind(type: string | null | undefined): NotificationKindLook {
  return (type && NOTIFICATION_KINDS[type]) || DEFAULT_LOOK;
}
