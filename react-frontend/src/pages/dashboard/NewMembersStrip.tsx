// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Say hello to new members" — the dashboard's newest faces (AWID feedback,
 * Nov 2026: "warmth, and community").
 *
 * Privacy: it reads the member directory itself (`/v2/users`, newest first),
 * so it can only ever show people the Members page would show this viewer,
 * with the same surname rules, and it stays off when the community has the
 * directory (the `connections` feature) switched off. It adds nothing the
 * directory does not already show; it only puts the newest people first.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowRight from 'lucide-react/icons/arrow-right';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import MessageCircle from 'lucide-react/icons/message-circle';
import { Avatar } from '@/components/ui/Avatar';
import { GlassCard } from '@/components/ui/GlassCard';
import { useAuth, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { formatRelativeTime, resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';

interface DirectoryMember {
  id: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar?: string | null;
  avatar_url?: string | null;
  created_at?: string | null;
}

/** How recently someone must have joined to count as new. */
const NEW_WITHIN_DAYS = 30;
const MAX_SHOWN = 6;

/** `className` places the card in its parent grid; the strip renders nothing when there is nobody new. */
export function NewMembersStrip({ className = '' }: { className?: string }) {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const { tenant, tenantPath, hasFeature, hasModule } = useTenant();
  const directoryOn = hasFeature('connections');
  const canMessage = hasModule('messages');
  const viewerId = user?.id ?? null;
  const [members, setMembers] = useState<DirectoryMember[]>([]);

  useEffect(() => {
    if (!directoryOn) return undefined;
    let cancelled = false;
    // One more than shown, in case the newest member is the viewer.
    api.get<DirectoryMember[]>(`/v2/users?sort=joined&order=desc&limit=${MAX_SHOWN + 1}`)
      .then((response) => {
        if (cancelled || !response.success || !Array.isArray(response.data)) return;
        const since = Date.now() - NEW_WITHIN_DAYS * 86_400_000;
        setMembers(
          response.data
            .filter((member) => member.id !== viewerId)
            .filter((member) => {
              const joined = member.created_at ? Date.parse(member.created_at) : NaN;
              return Number.isFinite(joined) && joined >= since;
            })
            .slice(0, MAX_SHOWN),
        );
      })
      .catch(() => {
        // A greeting strip is optional: if the directory cannot be read, show nothing.
      });
    return () => {
      cancelled = true;
    };
  }, [directoryOn, viewerId]);

  if (!directoryOn || members.length === 0) return null;

  return (
    <GlassCard className={`h-full p-5 sm:p-6 ${className}`} data-testid="new-members-strip">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground" aria-hidden="true">
            <HeartHandshake className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-theme-primary sm:text-lg">{t('new_members.title')}</h2>
            <p className="text-sm text-theme-secondary">
              {t('new_members.description', { community: tenant?.name ?? '' })}
            </p>
          </div>
        </div>
        <Link
          to={tenantPath('/members?sort=joined')}
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-1 py-1 text-sm text-[var(--color-primary)] transition-opacity hover:opacity-80"
        >
          {t('new_members.see_all')} <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {members.map((member) => {
          const name = resolveUserDisplayName(member, member.first_name ?? '');
          return (
            <li
              key={member.id}
              data-testid="new-member"
              className="flex flex-col items-center gap-2 rounded-2xl bg-theme-elevated/60 px-2 py-3 text-center"
            >
              <Link
                to={tenantPath(`/profile/${member.id}`)}
                className="flex min-w-0 flex-col items-center gap-2 rounded-xl outline-offset-2 hover:opacity-90"
              >
                <span aria-hidden="true">
                  <Avatar
                    src={resolveAvatarUrl(member.avatar_url || member.avatar)}
                    name={name}
                    size="lg"
                    className="ring-2 ring-[var(--surface-solid)]"
                  />
                </span>
                <span className="max-w-full truncate text-sm font-medium text-theme-primary">{name}</span>
              </Link>
              <span className="text-xs text-theme-subtle">
                {t('new_members.joined', { when: formatRelativeTime(member.created_at) })}
              </span>
              {canMessage && (
                <Link
                  to={tenantPath(`/messages/new/${member.id}`)}
                  aria-label={t('new_members.say_hello_aria', { name })}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-soft-foreground transition-colors hover:bg-accent/20"
                >
                  <MessageCircle className="size-3.5" aria-hidden="true" />
                  {t('new_members.say_hello')}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}

export default NewMembersStrip;
