import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { OverlayActionButton } from '@/components/ui/OverlayActionButton';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ConnectionSuggestionsWidget — "People You May Know" widget for feed sidebar and inline mobile.
 *
 * Desktop: vertical sidebar card. Mobile: horizontal scrollable strip.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';

import UserPlus from 'lucide-react/icons/user-plus';
import Users from 'lucide-react/icons/users';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { useFeature, useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { resolveAvatarUrl } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { safeLocalStorageGetJSON, safeLocalStorageSetJSON } from '@/lib/safeStorage';

/* ─── Types ────────────────────────────────────────────────── */

interface Suggestion {
  id: number;
  name: string;
  avatar_url?: string | null;
  bio?: string | null;
  mutual_connections_count: number;
  shared_skills: string[];
  connection_status: string;
}

interface ConnectionSuggestionsWidgetProps {
  /** "sidebar" for vertical card, "inline" for horizontal strip between posts */
  layout?: 'sidebar' | 'inline';
}

/* ─── Dismissed storage ────────────────────────────────────── */

function getDismissed(key: string): number[] {
  return safeLocalStorageGetJSON<number[]>(key, []);
}

function addDismissed(key: string, userId: number): void {
  const list = getDismissed(key);
  if (!list.includes(userId)) {
    list.push(userId);
    safeLocalStorageSetJSON(key, list.slice(-100));
  }
}

/* ─── Component ────────────────────────────────────────────── */

export function ConnectionSuggestionsWidget({ layout = 'sidebar' }: ConnectionSuggestionsWidgetProps) {
  const { t } = useTranslation('feed');
  const { tenantPath, tenantSlug } = useTenant();
  const hasConnections = useFeature('connections');
  const toast = useToast();

  // Namespace the dismissed-suggestions key per tenant so dismissals don't leak across tenants
  const dismissedKey = `nexus_dismissed_suggestions_${tenantSlug ?? 'default'}`;

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectingIds, setConnectingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!hasConnections) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const load = async () => {
      try {
        setIsLoading(true);
        const response = await api.get<{ suggestions: Suggestion[] }>('/v2/connections/suggestions?limit=8');
        if (response.success && response.data?.suggestions) {
          const dismissed = getDismissed(dismissedKey);
          setSuggestions(
            response.data.suggestions.filter((s) => !dismissed.includes(s.id))
          );
        }
      } catch (err) {
        logError('Failed to load connection suggestions', err);
        toast.error(t('suggestions.load_failed'));
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [dismissedKey, hasConnections, t, toast]);

  const handleConnect = useCallback(async (suggestion: Suggestion) => {
    setConnectingIds((prev) => new Set(prev).add(suggestion.id));
    const previousStatus = suggestion.connection_status;
    // Optimistic update — reverted on failure
    setSuggestions((prev) =>
      prev.map((s) => s.id === suggestion.id ? { ...s, connection_status: 'pending' } : s)
    );
    try {
      const res = await api.post('/v2/connections/request', { user_id: suggestion.id });
      if (res.success) {
        toast.success(t('suggestions.connect_sent'));
      } else {
        // api.post resolves { success:false } on a 4xx (already requested, blocked,
        // rate-limited, cannot connect) WITHOUT throwing, so the catch never fired —
        // without this branch the optimistic 'pending' stuck on the card AND a fake
        // "request sent" toast showed while the backend rejected the request.
        setSuggestions((prev) =>
          prev.map((s) => s.id === suggestion.id ? { ...s, connection_status: previousStatus } : s)
        );
        toast.error((res as { error?: string }).error || t('suggestions.connect_failed'));
      }
    } catch (err) {
      logError('Failed to send connection request', err);
      // Revert the optimistic update
      setSuggestions((prev) =>
        prev.map((s) => s.id === suggestion.id ? { ...s, connection_status: previousStatus } : s)
      );
      toast.error(t('suggestions.connect_failed'));
    } finally {
      setConnectingIds((prev) => {
        const next = new Set(prev);
        next.delete(suggestion.id);
        return next;
      });
    }
  }, [toast, t]);

  const handleDismiss = useCallback((id: number) => {
    addDismissed(dismissedKey, id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }, [dismissedKey]);

  // Don't show if no suggestions
  if (!hasConnections || (!isLoading && suggestions.length === 0)) return null;

  /* ─── Loading skeleton ─── */
  if (isLoading) {
    if (layout === 'inline') {
      return (
        <div className="flex gap-3 overflow-x-auto py-2 px-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex-shrink-0 w-40 p-3 rounded-xl bg-[var(--surface-elevated)] space-y-2">
              <Skeleton className="w-10 h-10 rounded-full mx-auto" />
              <Skeleton className="h-3 w-20 mx-auto rounded" />
              <Skeleton className="h-3 w-16 mx-auto rounded" />
            </div>
          ))}
        </div>
      );
    }
    return (
      <GlassCard className="p-4 space-y-3">
        <Skeleton className="h-4 w-32 rounded" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="w-9 h-9 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-24 rounded" />
              <Skeleton className="h-2.5 w-16 rounded" />
            </div>
          </div>
        ))}
      </GlassCard>
    );
  }

  /* ─── Inline layout (mobile, between posts) ─── */
  if (layout === 'inline') {
    return (
      <GlassCard className="p-3">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-accent" aria-hidden="true" />
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">
            {t('suggestions.title')}
          </h3>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {suggestions.slice(0, 6).map((suggestion) => (
            <Card
              key={suggestion.id}
              className="flex-shrink-0 w-36 bg-[var(--surface-elevated)] border border-[var(--border-default)]"
            >
              <CardBody className="p-3 text-center space-y-2">
                <OverlayActionButton
                  revealOnFinePointer={false}
                  variant="ghost"
                  className="absolute -top-1 -right-1 rounded-full text-[var(--text-subtle)]"
                  onPress={() => handleDismiss(suggestion.id)}
                  aria-label={t('suggestions.dismiss')}
                >
                  <X className="size-4" aria-hidden="true" />
                </OverlayActionButton>
                <Link to={tenantPath(`/profile/${suggestion.id}`)}>
                  <Avatar
                    name={suggestion.name}
                    src={resolveAvatarUrl(suggestion.avatar_url)}
                    size="md"
                    className="mx-auto"
                  />
                </Link>
                <Link
                  to={tenantPath(`/profile/${suggestion.id}`)}
                  className="text-xs font-medium text-[var(--text-primary)] truncate block"
                >
                  {suggestion.name}
                </Link>
                {suggestion.mutual_connections_count > 0 && (
                  <p className="text-[10px] text-[var(--text-muted)]">
                    {t('suggestions.mutual', { count: suggestion.mutual_connections_count })}
                  </p>
                )}
                {suggestion.connection_status === 'pending' ? (
                  <Button
                    size="sm"
                    variant="flat"
                    className="w-full text-[10px] bg-amber-500/10 text-amber-600"
                    isDisabled
                  >
                    {t('suggestions.pending')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="flat"
                    className="w-full text-[10px] bg-accent/10 text-accent-soft-foreground hover:bg-accent/20"
                    startContent={<UserPlus className="w-3 h-3" />}
                    onPress={() => handleConnect(suggestion)}
                    isLoading={connectingIds.has(suggestion.id)}
                  >
                    {t('suggestions.connect')}
                  </Button>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      </GlassCard>
    );
  }

  /* ─── Sidebar layout (desktop) ─── */
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-accent" aria-hidden="true" />
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">
            {t('suggestions.title')}
          </h3>
        </div>
        <Link
          to={tenantPath('/members')}
          className="text-xs text-accent hover:text-accent transition-colors"
        >
          {t('suggestions.see_all')}
        </Link>
      </div>

      <div className="space-y-2">
        {suggestions.slice(0, 5).map((suggestion) => (
          <div
            key={suggestion.id}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--surface-elevated)] transition-colors duration-200 relative group"
          >
            <OverlayActionButton
              variant="ghost"
              className="absolute -top-1 -right-1 rounded-full text-[var(--text-subtle)] transition-opacity duration-150"
              onPress={() => handleDismiss(suggestion.id)}
              aria-label={t('suggestions.dismiss')}
            >
              <X className="size-4" aria-hidden="true" />
            </OverlayActionButton>

            <Link to={tenantPath(`/profile/${suggestion.id}`)} className="flex-shrink-0">
              <Avatar
                name={suggestion.name}
                src={resolveAvatarUrl(suggestion.avatar_url)}
                size="sm"
              />
            </Link>

            <div className="flex-1 min-w-0">
              <Link
                to={tenantPath(`/profile/${suggestion.id}`)}
                className="text-sm font-medium text-[var(--text-primary)] truncate block"
              >
                {suggestion.name}
              </Link>
              {suggestion.mutual_connections_count > 0 && (
                <p className="text-[10px] text-[var(--text-muted)]">
                  {t('suggestions.mutual', { count: suggestion.mutual_connections_count })}
                </p>
              )}
              {suggestion.shared_skills.length > 0 && (
                <div className="flex flex-wrap gap-0.5 mt-0.5">
                  {suggestion.shared_skills.slice(0, 2).map((skill) => (
                    <Chip
                      key={skill}
                      size="sm"
                      variant="flat"
                      className="text-[9px] h-4 bg-[var(--surface-elevated)] text-[var(--text-subtle)]"
                    >
                      {skill}
                    </Chip>
                  ))}
                </div>
              )}
            </div>

            {suggestion.connection_status === 'pending' ? (
              <Button
                size="sm"
                variant="flat"
                className="text-[10px] bg-amber-500/10 text-amber-600 flex-shrink-0"
                isDisabled
              >
                {t('suggestions.pending')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="flat"
                className="text-[10px] bg-accent/10 text-accent-soft-foreground hover:bg-accent/20 flex-shrink-0"
                startContent={<UserPlus className="w-3 h-3" />}
                onPress={() => handleConnect(suggestion)}
                isLoading={connectingIds.has(suggestion.id)}
              >
                {t('suggestions.connect')}
              </Button>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

export default ConnectionSuggestionsWidget;
