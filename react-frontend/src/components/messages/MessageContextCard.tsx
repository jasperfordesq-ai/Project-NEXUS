// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Message Context Card (MS1)
 * Shows linked context (listing, event, job) at the top of a message thread.
 * Displays title, thumbnail, type badge, and a link to the original item.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import ListChecks from 'lucide-react/icons/list-checks';
import Calendar from 'lucide-react/icons/calendar';
import Briefcase from 'lucide-react/icons/briefcase';
import Heart from 'lucide-react/icons/heart';
import ExternalLink from 'lucide-react/icons/external-link';
import LinkIcon from 'lucide-react/icons/link';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveThumbnailUrl } from '@/lib/helpers';
import { Chip, Skeleton } from '@/components/ui';
import { feedTypeColour } from '@/components/feed/feedTypeColours';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ContextInfo {
  type: string;
  id: number;
  title: string;
  image_url?: string | null;
  status?: string;
}

interface MessageContextCardProps {
  contextType: string;
  contextId: number;
}

// `feedKind`: the tile takes the colour that kind of post has in the feed
// (feedTypeColours), so a message about an event looks like an event. Was a
// class built at runtime (`bg-${color}/10`), which Tailwind cannot find.
const CONTEXT_CONFIG: Record<string, { icon: typeof ListChecks; labelKey: string; color: 'accent' | 'success' | 'warning' | 'danger'; feedKind: string; apiPath: string; detailPath: string }> = {
  listing: { icon: ListChecks, labelKey: 'context_type_listing', color: 'accent', feedKind: 'listing', apiPath: '/listings', detailPath: '/listings' },
  event: { icon: Calendar, labelKey: 'context_type_event', color: 'success', feedKind: 'event', apiPath: '/events', detailPath: '/events' },
  job: { icon: Briefcase, labelKey: 'context_type_job', color: 'warning', feedKind: 'job', apiPath: '/jobs', detailPath: '/jobs' },
  volunteering: { icon: Heart, labelKey: 'context_type_volunteering', color: 'danger', feedKind: 'volunteer', apiPath: '/volunteering/opportunities', detailPath: '/volunteering/opportunities' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MessageContextCard({ contextType, contextId }: MessageContextCardProps) {
  const { t } = useTranslation('messages');
  const { tenantPath } = useTenant();
  const [context, setContext] = useState<ContextInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadContext() {
      setLoading(true);
      try {
        // Try to fetch context details from the appropriate API
        const config = CONTEXT_CONFIG[contextType];
        if (!config) {
          setLoading(false);
          return;
        }

        const res = await api.get(`/v2${config.apiPath}/${contextId}`);
        if (res.success && res.data) {
          const data = res.data as Record<string, unknown>;
          setContext({
            type: contextType,
            id: contextId,
            title: (data.title || data.name || data.summary || t('context_untitled')) as string,
            image_url: (data.image_url || data.cover_image || data.thumbnail) as string | null,
            status: data.status as string | undefined,
          });
        }
      } catch (err) {
        logError('MessageContextCard.loadContext', err);
        // Still show a basic context card even if details fail
        setContext({
          type: contextType,
          id: contextId,
          title: `${contextType.charAt(0).toUpperCase() + contextType.slice(1)} #${contextId}`,
        });
      }
      setLoading(false);
    }

    loadContext();
  }, [contextType, contextId, t]);

  const config = CONTEXT_CONFIG[contextType];
  if (!config) return null;

  const Icon = config.icon;
  const detailPath = `${config.detailPath}/${contextId}`;

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-theme-elevated border border-theme-default mb-3">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32 rounded mb-1" />
          <Skeleton className="h-3 w-20 rounded" />
        </div>
      </div>
    );
  }

  if (!context) return null;

  return (
    <Link to={tenantPath(detailPath)}>
      <div className="flex items-center gap-3 p-3 rounded-lg bg-theme-elevated border border-accent/20 mb-3 hover:bg-theme-hover transition-colors group">
        <div className="flex-shrink-0">
          {context.image_url ? (
            <img
              src={resolveThumbnailUrl(context.image_url, { width: 96, height: 96 })}
              alt={context.title}
              className="w-10 h-10 rounded-lg object-cover"
              loading="lazy"
            />
          ) : (
            <div data-testid="message-context-tile" className={`w-10 h-10 rounded-lg flex items-center justify-center ${feedTypeColour(config.feedKind).label}`}>
              <Icon className="w-5 h-5" aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <LinkIcon className="w-3 h-3 text-theme-subtle flex-shrink-0" />
            <span className="text-xs text-theme-subtle">{t('context_regarding')}</span>
            <Chip size="sm" variant="soft" color={config.color}>
              {t(config.labelKey)}
            </Chip>
          </div>
          <p className="font-medium text-sm text-theme-primary truncate group-hover:text-accent transition-colors">
            {context.title}
          </p>
        </div>

        <ExternalLink className="w-4 h-4 text-theme-subtle group-hover:text-accent transition-colors flex-shrink-0" />
      </div>
    </Link>
  );
}

export default MessageContextCard;
