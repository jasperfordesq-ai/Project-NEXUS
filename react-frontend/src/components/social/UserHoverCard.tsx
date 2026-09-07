// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * UserHoverCard — Shows a popup card with quick info and actions
 * when hovering over a username or avatar.
 *
 * On touch devices, hover cards are disabled and the default
 * tap-to-navigate behavior is preserved.
 */

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { Link } from 'react-router-dom';
import { Popover, PopoverTrigger, PopoverContent, PopoverHeading } from '@/components/ui';
import UserPlus from 'lucide-react/icons/user-plus';
import UserCheck from 'lucide-react/icons/user-check';
import Check from 'lucide-react/icons/check';
import MessageCircle from 'lucide-react/icons/message-circle';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { resolveAvatarUrl } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { PresenceIndicator } from './PresenceIndicator';
import { Button, Chip, Avatar, Skeleton } from '@/components/ui';

/* ─── Types ────────────────────────────────────────────────── */

interface UserHoverCardProps {
  userId: number;
  children: React.ReactNode;
  openOnMount?: boolean;
}

interface HoverCardData {
  id: number;
  name?: string;
  first_name?: string;
  avatar?: string | null;
  avatar_url?: string | null;
  bio?: string;
  tagline?: string;
  is_verified?: boolean;
  skills?: string[];
  interests?: string[];
  stats?: {
    total_hours_given?: number;
    connections_count?: number;
    listings_count?: number;
  };
  connection_status?: 'none' | 'pending' | 'connected';
}

/* ─── Cache ────────────────────────────────────────────────── */

const userCache = new Map<number, HoverCardData>();

/* ─── Touch device detection ───────────────────────────────── */

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return true;
  return 'ontouchstart' in window || !window.matchMedia('(hover: hover)').matches;
}

/* ─── Component ────────────────────────────────────────────── */

export const UserHoverCard = memo(function UserHoverCard({
  userId,
  children,
  openOnMount = false,
}: UserHoverCardProps) {
  const { t } = useTranslation('social');
  const { tenantPath, hasFeature, hasModule } = useTenant();
  const hasConnections = hasFeature('connections');
  const canMessage = hasModule('messages') && hasFeature('direct_messaging');
  const { isAuthenticated } = useAuth();
  // Don't render hover card on touch devices
  const isTouch = useRef(isTouchDevice());

  const [isOpen, setIsOpen] = useState(() => openOnMount && !isTouch.current);
  const [userData, setUserData] = useState<HoverCardData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchUserData = useCallback(async () => {
    if (!isAuthenticated) return;
    // Return cached data
    if (userCache.has(userId)) {
      setUserData(userCache.get(userId)!);
      return;
    }

    setIsLoading(true);
    try {
      const response = await api.get<HoverCardData>(`/v2/users/${userId}`);
      if (response.success && response.data) {
        userCache.set(userId, response.data);
        setUserData(response.data);
      }
    } catch (err) {
      logError('Failed to fetch user data for hover card', err);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, userId]);

  useEffect(() => {
    if (!isAuthenticated || !openOnMount || isTouch.current) return;
    setIsOpen(true);
    fetchUserData();
  }, [fetchUserData, isAuthenticated, openOnMount]);

  const clearTimers = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = undefined;
    }
  }, []);

  // Open after a short hover delay. Hover intent is the SOLE opener — the
  // controlled Popover never opens itself (see handleOpenChange).
  const scheduleOpen = useCallback(() => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = undefined;
    }
    if (hoverTimeoutRef.current) return; // open already scheduled
    hoverTimeoutRef.current = setTimeout(() => {
      hoverTimeoutRef.current = undefined;
      setIsOpen(true);
      fetchUserData();
    }, 300);
  }, [fetchUserData]);

  // Close after a short grace period so the pointer can travel across the
  // gap between the trigger and the popover content without dismissing it.
  const scheduleClose = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }
    if (leaveTimeoutRef.current) return; // close already scheduled
    leaveTimeoutRef.current = setTimeout(() => {
      leaveTimeoutRef.current = undefined;
      setIsOpen(false);
    }, 200);
  }, []);

  const handleMouseEnter = scheduleOpen;
  const handleMouseLeave = scheduleClose;
  const handlePopoverMouseEnter = useCallback(() => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = undefined;
    }
  }, []);
  const handlePopoverMouseLeave = scheduleClose;

  // React Aria drives this as a CONTROLLED popover. It must apply the
  // requested state synchronously, or react-aria's internal trigger state
  // diverges from `isOpen` and the overlay oscillates open/closed (flicker).
  // We honor close requests immediately (Esc / interact-outside) and ignore
  // open requests — opening is hover-driven only, so a click on the wrapped
  // profile link navigates instead of flashing the card.
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      clearTimers();
      setIsOpen(false);
    }
  }, [clearTimers]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
    };
  }, []);

  const handleConnect = useCallback(async () => {
    if (!isAuthenticated || !userData || isConnecting) return;
    setIsConnecting(true);
    try {
      const res = await api.post('/v2/connections/request', { user_id: userId });
      // Only flip to 'pending' on a CONFIRMED request. api.post resolves
      // { success:false } on a 4xx (already requested / blocked / rate-limited /
      // cannot connect) WITHOUT throwing, so the unchecked await used to set — and
      // CACHE — a fake 'pending' state on a rejected request (persisting it to every
      // later hover). On failure the card stays "Connect" so the user can retry.
      if (res.success) {
        const updated = { ...userData, connection_status: 'pending' as const };
        setUserData(updated);
        userCache.set(userId, updated);
      }
    } catch (err) {
      logError('Failed to send connection request from hover card', err);
    } finally {
      setIsConnecting(false);
    }
  }, [isAuthenticated, userData, userId, isConnecting]);

  // Anonymous and touch users get the original link/avatar only. Member data
  // must never be fetched or restored from the in-memory hover-card cache.
  if (!isAuthenticated || isTouch.current) {
    return <>{children}</>;
  }

  const displayName = userData?.name || userData?.first_name || '';
  const avatarSrc = resolveAvatarUrl(userData?.avatar_url || userData?.avatar);
  const skills = userData?.skills?.slice(0, 4) || [];
  const hoursGiven = userData?.stats?.total_hours_given ?? 0;
  const connectionsCount = userData?.stats?.connections_count ?? 0;
  const listingsCount = userData?.stats?.listings_count ?? 0;
  const portalContainer = typeof document !== 'undefined' ? document.body : undefined;
  const panelClassName = [
    'box-border w-[min(21rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]',
    'overflow-hidden rounded-xl border border-[var(--border-default)]',
    'bg-[var(--surface-solid)] text-[var(--text-primary)] shadow-2xl',
    'backdrop-blur-none',
  ].join(' ');

  return (
    <Popover
      placement="bottom-start"
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      shouldBlockScroll={false}
      backdrop="transparent"
      offset={8}
      showArrow
      portalContainer={portalContainer}
      containerPadding={16}
      classNames={{
        base: 'z-[9999] overflow-visible',
        content: panelClassName,
        arrow: 'bg-[var(--surface-solid)] border border-[var(--border-default)]',
      }}
    >
      <PopoverTrigger>
        <span
          onPointerEnter={handleMouseEnter}
          onPointerLeave={handleMouseLeave}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="inline-flex"
        >
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        onMouseEnter={handlePopoverMouseEnter}
        onMouseLeave={handlePopoverMouseLeave}
      >
        <PopoverHeading className="sr-only">{displayName}</PopoverHeading>
        {isLoading && !userData ? (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-12 h-12 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-24 rounded" />
                <Skeleton className="h-3 w-16 rounded" />
              </div>
            </div>
            <Skeleton className="h-3 w-full rounded" />
            <Skeleton className="h-3 w-3/4 rounded" />
          </div>
        ) : userData ? (
          <div className="box-border w-full min-w-0 p-4 space-y-3">
            {/* User info */}
            <div className="flex items-center gap-3 min-w-0">
              <Link to={tenantPath(`/profile/${userData.id}`)} className="relative flex-shrink-0">
                <Avatar
                  name={displayName}
                  src={avatarSrc}
                  size="lg"
                  className="ring-2 ring-[var(--border-default)]"
                />
                <PresenceIndicator userId={userData.id} size="md" />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  to={tenantPath(`/profile/${userData.id}`)}
                  className="font-semibold text-sm text-[var(--text-primary)] hover:text-[var(--color-primary)] transition-colors truncate block"
                >
                  {displayName}
                  {userData.is_verified && (
                    <span className="ml-1 text-[var(--color-primary)]" title={t('verified')}>
                      <Check className="inline h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  )}
                </Link>
                {userData.tagline && (
                  <p className="text-xs text-[var(--text-muted)] truncate">{userData.tagline}</p>
                )}
              </div>
            </div>

            {/* Bio */}
            {userData.bio && (
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed break-words line-clamp-3">
                {userData.bio}
              </p>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] text-center text-[11px] text-[var(--text-muted)]">
              <span className="min-w-0 truncate px-2 py-2">{t('hover_card.hours_given', { count: hoursGiven })}</span>
              <span className="min-w-0 truncate border-x border-[var(--border-default)] px-2 py-2">{t('hover_card.connections', { count: connectionsCount })}</span>
              <span className="min-w-0 truncate px-2 py-2">{t('hover_card.listings', { count: listingsCount })}</span>
            </div>

            {/* Skills */}
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {skills.map((skill) => (
                  <Chip
                    key={skill}
                    size="sm"
                    variant="flat"
                    className="max-w-full text-[10px] h-5 bg-[var(--surface-elevated)] text-[var(--text-muted)]"
                    classNames={{ content: 'truncate' }}
                  >
                    {skill}
                  </Chip>
                ))}
              </div>
            )}

            {/* Actions */}
            {(hasConnections || canMessage) && <div className="grid grid-cols-2 gap-2 pt-1">
              {hasConnections && (userData.connection_status === 'connected' ? (
                <Button
                  size="sm"
                  variant="flat"
                  className="h-8 min-w-0 w-full px-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  startContent={<UserCheck className="w-3.5 h-3.5 shrink-0" />}
                  isDisabled
                >
                  <span className="min-w-0 truncate text-xs">{t('hover_card.connected')}</span>
                </Button>
              ) : userData.connection_status === 'pending' ? (
                <Button
                  size="sm"
                  variant="flat"
                  className="h-8 min-w-0 w-full px-2 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  isDisabled
                >
                  <span className="min-w-0 truncate text-xs">{t('hover_card.pending')}</span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="flat"
                  className="h-8 min-w-0 w-full px-2 bg-accent/10 text-accent dark:text-accent hover:bg-accent/20"
                  startContent={<UserPlus className="w-3.5 h-3.5 shrink-0" />}
                  onPress={handleConnect}
                  isLoading={isConnecting}
                >
                  <span className="min-w-0 truncate text-xs">{t('hover_card.connect')}</span>
                </Button>
              ))}
              {canMessage && <Button
                as={Link}
                to={tenantPath(`/messages?to=${userData.id}`)}
                size="sm"
                variant="flat"
                className="h-8 min-w-0 w-full px-2 bg-[var(--surface-elevated)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                startContent={<MessageCircle className="w-3.5 h-3.5 shrink-0" />}
              >
                <span className="min-w-0 truncate text-xs">{t('hover_card.message')}</span>
              </Button>}
            </div>}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
});

export default UserHoverCard;
