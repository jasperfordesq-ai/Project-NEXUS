// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GroupPreviewCard — how the group will look on the groups page, as it is
 * typed (warmth phase 5, after the offer form's preview).
 *
 * It follows the look of the real card (GroupCard in pages/groups/GroupsPage)
 * — the same cover, lock or globe mark, name, two lines of description and
 * member count — but it is a picture of a card, not a card: nothing in it is
 * a link or a button. With no cover picture it shows the coloured cover the
 * group would get, and a line inviting one.
 */

import { useTranslation } from 'react-i18next';
import Eye from 'lucide-react/icons/eye';
import Globe from 'lucide-react/icons/globe';
import ImagePlus from 'lucide-react/icons/image-plus';
import Lock from 'lucide-react/icons/lock';
import Users from 'lucide-react/icons/users';
import { GlassCard } from '@/components/ui/GlassCard';
import { ThemedCover } from '@/components/ui/ThemedCover';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { colourForSeed } from '@/lib/categoryColours';

export interface GroupPreviewCardProps {
  name: string;
  description: string;
  visibility: string;
  /** The cover picture chosen in the form (or the saved one), if any. */
  coverSrc: string | null;
  /**
   * The group's own picture. With no cover, the groups list shows it as the
   * cover, so the preview does too.
   */
  pictureSrc?: string | null;
  /** The real count when editing; a new group has its creator, 1. */
  memberCount?: number;
  /**
   * The group's id when editing. With no picture, the real card colours its
   * cover by the id, so the preview does too; a new group has none yet.
   */
  id?: number | string | null;
}

export function GroupPreviewCard({ name, description, visibility, coverSrc, pictureSrc = null, memberCount = 1, id = null }: GroupPreviewCardProps) {
  const shownSrc = coverSrc || pictureSrc || null;
  const { t } = useTranslation('groups');
  const palette = useSitePalette();
  // The real card's seeds (GroupCard): its colour by the id, its cover's
  // texture by `group-<id>`. A new group keeps a fixed seed of its own.
  const coverColour = colourForSeed(id ?? 'group-preview', palette);
  const coverSeed = id != null ? `group-${id}` : 'group-preview';
  const isPrivate = visibility === 'private' || visibility === 'secret';
  const VisibilityIcon = isPrivate ? Lock : Globe;
  const hasName = name.trim() !== '';
  const hasDescription = description.trim() !== '';
  const badgeClass = shownSrc
    ? 'bg-black/45 text-white'
    : 'bg-white/85 text-stone-700 shadow-sm ring-1 ring-black/5 dark:bg-black/40 dark:text-white dark:ring-white/10';

  return (
    <section aria-labelledby="group-preview-heading" data-testid="group-preview">
      <h2 id="group-preview-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-theme-secondary">
        <Eye className="h-4 w-4 text-accent" aria-hidden="true" />
        {t('form.preview_heading')}
      </h2>
      <GlassCard className="flex flex-col overflow-hidden">
        <div className="relative h-24 bg-theme-elevated">
          {shownSrc ? (
            // Decorative here: the same picture, with the member's own
            // description, is already in the form beside it.
            <img src={shownSrc} alt="" className="h-full w-full object-cover" />
          ) : (
            <ThemedCover
              data-testid="group-preview-cover"
              colour={coverColour}
              icon={Users}
              size="sm"
              seed={coverSeed}
            />
          )}
          {shownSrc && <div className="absolute inset-0 bg-linear-to-t from-black/35 to-transparent" aria-hidden="true" />}
          <span aria-hidden="true" className={`absolute end-3 top-3 shrink-0 rounded-full p-1.5 backdrop-blur-sm ${badgeClass}`}>
            <VisibilityIcon className="h-4 w-4" />
          </span>
        </div>
        <div className="flex min-w-0 flex-col p-4 sm:p-5">
          <p
            data-testid="group-preview-name"
            className={`mb-3 line-clamp-2 text-lg font-semibold ${hasName ? 'text-theme-primary' : 'text-theme-subtle'}`}
          >
            {hasName ? name : t('form.preview_name_placeholder')}
          </p>
          <p
            data-testid="group-preview-description"
            className={`mb-3 line-clamp-2 text-sm ${hasDescription ? 'text-theme-muted' : 'text-theme-subtle'}`}
          >
            {hasDescription ? description : t('form.preview_description_placeholder')}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-theme-default pt-3 text-xs text-theme-subtle">
            {/* As the real card: the number beside the people icon. */}
            <span data-testid="group-preview-members" className="flex items-center gap-1">
              <Users className="h-3 w-3" aria-hidden="true" />
              <span aria-hidden="true">{memberCount}</span>
              <span className="sr-only">{t('members_count_label', { count: memberCount })}</span>
            </span>
            <span data-testid="group-preview-visibility" className="flex items-center gap-1">
              <VisibilityIcon className="h-3 w-3" aria-hidden="true" />
              {isPrivate ? t('private_title') : t('public_title')}
            </span>
          </div>
        </div>
      </GlassCard>
      {!shownSrc && (
        <p data-testid="group-preview-cover-nudge" className="mt-3 flex items-start gap-2 text-xs leading-5 text-theme-muted">
          <ImagePlus className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          {t('form.preview_cover_nudge')}
        </p>
      )}
    </section>
  );
}

export default GroupPreviewCard;
