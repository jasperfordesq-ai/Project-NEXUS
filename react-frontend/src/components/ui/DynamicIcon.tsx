// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { LucideIcon } from 'lucide-react';
import Home from 'lucide-react/icons/house';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import ListTodo from 'lucide-react/icons/list-todo';
import MessageSquare from 'lucide-react/icons/message-square';
import Wallet from 'lucide-react/icons/wallet';
import Users from 'lucide-react/icons/users';
import Calendar from 'lucide-react/icons/calendar';
import Bell from 'lucide-react/icons/bell';
import Settings from 'lucide-react/icons/settings';
import Search from 'lucide-react/icons/search';
import Plus from 'lucide-react/icons/plus';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import Trophy from 'lucide-react/icons/trophy';
import Target from 'lucide-react/icons/target';
import HelpCircle from 'lucide-react/icons/circle-help';
import Newspaper from 'lucide-react/icons/newspaper';
import BookOpen from 'lucide-react/icons/book-open';
import FolderOpen from 'lucide-react/icons/folder-open';
import Podcast from 'lucide-react/icons/podcast';
import Heart from 'lucide-react/icons/heart';
import Building2 from 'lucide-react/icons/building-2';
import Globe from 'lucide-react/icons/globe';
import Info from 'lucide-react/icons/info';
import FileText from 'lucide-react/icons/file-text';
import Handshake from 'lucide-react/icons/handshake';
import Stethoscope from 'lucide-react/icons/stethoscope';
import TrendingUp from 'lucide-react/icons/trending-up';
import BarChart3 from 'lucide-react/icons/chart-column';
import Compass from 'lucide-react/icons/compass';
import Medal from 'lucide-react/icons/medal';
import Shield from 'lucide-react/icons/shield';
import Cookie from 'lucide-react/icons/cookie';
import ChevronDown from 'lucide-react/icons/chevron-down';
import UserCircle from 'lucide-react/icons/circle-user';
import LogOut from 'lucide-react/icons/log-out';
import Moon from 'lucide-react/icons/moon';
import Sun from 'lucide-react/icons/sun';
import Star from 'lucide-react/icons/star';
import MapPin from 'lucide-react/icons/map-pin';
import Clock from 'lucide-react/icons/clock';
import Tag from 'lucide-react/icons/tag';
import Hash from 'lucide-react/icons/hash';
import Link from 'lucide-react/icons/link';
import ExternalLink from 'lucide-react/icons/external-link';
import Mail from 'lucide-react/icons/mail';
import Phone from 'lucide-react/icons/phone';
import Image from 'lucide-react/icons/image';
import Video from 'lucide-react/icons/video';
import Music from 'lucide-react/icons/music';
import Mic from 'lucide-react/icons/mic';
import Camera from 'lucide-react/icons/camera';
import Zap from 'lucide-react/icons/zap';
import Sparkles from 'lucide-react/icons/sparkles';
import Flag from 'lucide-react/icons/flag';
import Bookmark from 'lucide-react/icons/bookmark';
import Archive from 'lucide-react/icons/archive';
import Grid from 'lucide-react/icons/grid-3x3';
import List from 'lucide-react/icons/list';
import BarChart from 'lucide-react/icons/chart-no-axes-column-increasing';
import PieChart from 'lucide-react/icons/chart-pie';
import Activity from 'lucide-react/icons/activity';
import Coffee from 'lucide-react/icons/coffee';
import Gift from 'lucide-react/icons/gift';
import Smile from 'lucide-react/icons/smile';
import ThumbsUp from 'lucide-react/icons/thumbs-up';
import Megaphone from 'lucide-react/icons/megaphone';
import Lightbulb from 'lucide-react/icons/lightbulb';
import Wrench from 'lucide-react/icons/wrench';
import Puzzle from 'lucide-react/icons/puzzle';
import Layers from 'lucide-react/icons/layers';
import Package from 'lucide-react/icons/package';
// Marketplace category icons (database/seeders/MarketplaceCategorySeeder.php).
// Every seeded `icon` value must resolve here, or the category page and the
// admin category editor fall back to a generic tag.
import Smartphone from 'lucide-react/icons/smartphone';
import Armchair from 'lucide-react/icons/armchair';
import Shirt from 'lucide-react/icons/shirt';
import Car from 'lucide-react/icons/car';
import Bike from 'lucide-react/icons/bike';
import Gamepad2 from 'lucide-react/icons/gamepad-2';
import Baby from 'lucide-react/icons/baby';
import Dog from 'lucide-react/icons/dog';
import Briefcase from 'lucide-react/icons/briefcase';
import Palette from 'lucide-react/icons/palette';
import UtensilsCrossed from 'lucide-react/icons/utensils-crossed';
import Hammer from 'lucide-react/icons/hammer';

/**
 * Curated map of Lucide icons available for dynamic rendering.
 * Used by the menu system (admin icon picker + frontend nav rendering).
 * Only includes icons relevant to navigation — not the full 1400+ set.
 */
export const ICON_MAP: Record<string, LucideIcon> = {
  Home,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Wallet,
  Users,
  Calendar,
  Bell,
  Settings,
  Search,
  Plus,
  ArrowRightLeft,
  Trophy,
  Target,
  HelpCircle,
  Newspaper,
  BookOpen,
  FolderOpen,
  Podcast,
  Heart,
  Building2,
  Globe,
  Info,
  FileText,
  Handshake,
  Stethoscope,
  TrendingUp,
  BarChart3,
  Compass,
  Medal,
  Shield,
  Cookie,
  ChevronDown,
  UserCircle,
  LogOut,
  Moon,
  Sun,
  Star,
  MapPin,
  Clock,
  Tag,
  Hash,
  Link,
  ExternalLink,
  Mail,
  Phone,
  Image,
  Video,
  Music,
  Mic,
  Camera,
  Zap,
  Sparkles,
  Flag,
  Bookmark,
  Archive,
  Grid,
  List,
  BarChart,
  PieChart,
  Activity,
  Coffee,
  Gift,
  Smile,
  ThumbsUp,
  Megaphone,
  Lightbulb,
  Wrench,
  Puzzle,
  Layers,
  Package,
  // Marketplace categories
  Smartphone,
  Armchair,
  Shirt,
  Car,
  Bike,
  Gamepad2,
  Baby,
  Dog,
  Briefcase,
  Palette,
  UtensilsCrossed,
  Hammer,
};

/** All available icon names for the icon picker */
export const ICON_NAMES = Object.keys(ICON_MAP);

interface DynamicIconProps {
  name: string | null | undefined;
  className?: string;
  size?: number;
}

/**
 * Renders a Lucide icon by name string.
 * Returns null for unknown/null names (graceful degradation).
 */
export function DynamicIcon({ name, className, size }: DynamicIconProps) {
  if (!name) return null;
  const Icon = ICON_MAP[name];
  if (!Icon) return null;
  return <Icon className={className} size={size} aria-hidden="true" />;
}
