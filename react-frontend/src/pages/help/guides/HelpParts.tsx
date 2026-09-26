// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Small building blocks shared by the Help Centre pages. */

import type { ComponentType, SVGProps } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Accessibility from 'lucide-react/icons/accessibility';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Bell from 'lucide-react/icons/bell';
import BookOpen from 'lucide-react/icons/book-open';
import Bot from 'lucide-react/icons/bot';
import Briefcase from 'lucide-react/icons/briefcase';
import Building2 from 'lucide-react/icons/building-2';
import Calendar from 'lucide-react/icons/calendar';
import ChartColumn from 'lucide-react/icons/chart-column';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import Eye from 'lucide-react/icons/eye';
import FileText from 'lucide-react/icons/file-text';
import Flag from 'lucide-react/icons/flag';
import Globe from 'lucide-react/icons/globe';
import GraduationCap from 'lucide-react/icons/graduation-cap';
import Handshake from 'lucide-react/icons/handshake';
import Heart from 'lucide-react/icons/heart';
import KeyRound from 'lucide-react/icons/key-round';
import Layers from 'lucide-react/icons/layers';
import LifeBuoy from 'lucide-react/icons/life-buoy';
import List from 'lucide-react/icons/list';
import Lock from 'lucide-react/icons/lock';
import Mail from 'lucide-react/icons/mail';
import MessageSquare from 'lucide-react/icons/message-square';
import Newspaper from 'lucide-react/icons/newspaper';
import Rocket from 'lucide-react/icons/rocket';
import Scale from 'lucide-react/icons/scale';
import Search from 'lucide-react/icons/search';
import Settings from 'lucide-react/icons/settings';
import Shield from 'lucide-react/icons/shield';
import Smartphone from 'lucide-react/icons/smartphone';
import Sparkles from 'lucide-react/icons/sparkles';
import Store from 'lucide-react/icons/store';
import Trophy from 'lucide-react/icons/trophy';
import User from 'lucide-react/icons/user';
import Users from 'lucide-react/icons/users';
import Wallet from 'lucide-react/icons/wallet';
import Wrench from 'lucide-react/icons/wrench';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTenant } from '@/contexts';
import type { HelpAudience, HelpIconName } from './types';

const ICONS: Record<HelpIconName, ComponentType<SVGProps<SVGSVGElement>>> = {
  rocket: Rocket, user: User, shield: Shield, list: List, message: MessageSquare,
  handshake: Handshake, wallet: Wallet, users: Users, calendar: Calendar,
  newspaper: Newspaper, heart: Heart, building: Building2, briefcase: Briefcase,
  store: Store, graduation: GraduationCap, trophy: Trophy, globe: Globe, bell: Bell,
  bot: Bot, wrench: Wrench, clipboard: ClipboardCheck, scale: Scale, settings: Settings,
  lifebuoy: LifeBuoy, book: BookOpen, eye: Eye, file: FileText, sparkles: Sparkles,
  flag: Flag, key: KeyRound, smartphone: Smartphone, accessibility: Accessibility,
  chart: ChartColumn, mail: Mail, lock: Lock, search: Search, layers: Layers,
};

export function HelpIcon({ name, className }: { name: HelpIconName; className?: string }) {
  const Icon = ICONS[name] ?? BookOpen;
  return <Icon className={className} aria-hidden="true" />;
}

export const AUDIENCE_ICON: Record<HelpAudience, HelpIconName> = {
  members: 'users',
  brokers: 'handshake',
  admins: 'settings',
};

/** A card linking to a section or article. */
export function HelpCardLink({
  to,
  icon,
  title,
  description,
  meta,
}: {
  to: string;
  icon?: HelpIconName;
  title: string;
  description?: string;
  meta?: string;
}) {
  const { tenantPath } = useTenant();
  return (
    <Link
      to={tenantPath(to)}
      className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <GlassCard className="h-full p-5 transition-colors group-hover:border-accent/40 group-hover:bg-theme-hover/30">
        <span className="flex items-start gap-4">
        {icon && (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
            <HelpIcon name={icon} className="h-5 w-5" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-theme-primary group-hover:text-accent">{title}</span>
          {description && <span className="mt-1 block text-sm leading-6 text-theme-muted">{description}</span>}
          {meta && <span className="mt-2 block text-xs font-medium text-theme-subtle">{meta}</span>}
        </span>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-theme-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent rtl:rotate-180" aria-hidden="true" />
        </span>
      </GlassCard>
    </Link>
  );
}

/** "Still need help?" panel shown at the foot of every Help Centre page. */
export function HelpContactPanel() {
  const { t } = useTranslation('help_centre');
  const { tenantPath } = useTenant();
  return (
    <GlassCard className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
          <LifeBuoy className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-theme-primary">{t('contact_heading')}</h2>
          <p className="mt-1 text-sm leading-6 text-theme-muted">{t('contact_body')}</p>
        </div>
      </div>
      <Button
        as={Link}
        to={tenantPath('/contact')}
        color="primary"
        startContent={<MessageSquare className="h-4 w-4" aria-hidden="true" />}
      >
        {t('contact_button')}
      </Button>
    </GlassCard>
  );
}
