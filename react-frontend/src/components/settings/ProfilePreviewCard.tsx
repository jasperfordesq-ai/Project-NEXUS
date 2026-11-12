// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ProfilePreviewCard — how other members see you, as you edit your profile
 * (warmth phase 5, after the offer, group, event, volunteering and
 * marketplace forms).
 *
 * It shows what a neighbour sees on a member card: the photo (or coloured
 * initials), the FIRST name only — other members never see a surname, and
 * the card says so — the tagline, a few lines of the bio and the place. An
 * organisation profile shows the organisation's name instead.
 *
 * It sits above the profile form rather than beside it: the settings page is
 * already a tabbed, narrower layout. It is a picture of a card, not a card:
 * nothing in it is a link or a button.
 */

import { useTranslation } from 'react-i18next';
import Eye from 'lucide-react/icons/eye';
import ImagePlus from 'lucide-react/icons/image-plus';
import MapPin from 'lucide-react/icons/map-pin';
import { Avatar } from '@/components/ui/Avatar';
import { MemberPlainText, memberPlainText } from '@/components/ui/MemberPlainText';
import { resolveAvatarUrl } from '@/lib/helpers';

export interface ProfilePreviewCardProps {
  firstName: string;
  /** Used only for an organisation profile. */
  organisationName: string;
  profileType: 'individual' | 'organisation';
  tagline: string;
  bio: string;
  location: string;
  avatar: string | null;
}

export function ProfilePreviewCard({
  firstName, organisationName, profileType, tagline, bio, location, avatar,
}: ProfilePreviewCardProps) {
  const { t } = useTranslation('settings');
  const isOrganisation = profileType === 'organisation';
  const name = (isOrganisation ? organisationName : firstName).trim();
  const hasBio = Boolean(memberPlainText(bio));

  return (
    <section aria-labelledby="profile-preview-heading" data-testid="profile-preview">
      <h2 id="profile-preview-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-theme-secondary">
        <Eye className="h-4 w-4 text-accent" aria-hidden="true" />
        {t('profile.preview_heading')}
      </h2>
      <div className="flex items-start gap-4 rounded-2xl border border-theme-default bg-theme-elevated p-4">
        {/* Decorative here: the same photo, with its description, is in the form below. */}
        <span aria-hidden="true" className="shrink-0">
          <Avatar
            key={avatar || 'no-avatar'}
            src={resolveAvatarUrl(avatar)}
            name={name || undefined}
            className="h-14 w-14"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p
            data-testid="profile-preview-name"
            className={`truncate text-lg font-semibold ${name ? 'text-theme-primary' : 'text-theme-subtle'}`}
          >
            {name || t('profile.preview_name_placeholder')}
          </p>
          {tagline.trim() !== '' && (
            <p data-testid="profile-preview-tagline" className="truncate text-sm text-theme-secondary">{tagline}</p>
          )}
          {hasBio ? (
            <MemberPlainText content={bio} as="p" className="mt-1 line-clamp-3 text-sm text-theme-muted" />
          ) : (
            <p data-testid="profile-preview-bio-placeholder" className="mt-1 text-sm text-theme-subtle">
              {t('profile.preview_bio_placeholder')}
            </p>
          )}
          {location.trim() !== '' && (
            <span className="mt-2 flex min-w-0 items-center gap-1 text-xs text-theme-subtle">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{location}</span>
            </span>
          )}
        </div>
      </div>
      {!isOrganisation && (
        <p data-testid="profile-preview-first-name-note" className="mt-2 text-xs leading-5 text-theme-muted">
          {t('profile.preview_first_name_note')}
        </p>
      )}
      {!avatar && (
        <p data-testid="profile-preview-photo-nudge" className="mt-1 flex items-start gap-2 text-xs leading-5 text-theme-muted">
          <ImagePlus className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          {t('profile.preview_photo_nudge')}
        </p>
      )}
    </section>
  );
}

export default ProfilePreviewCard;
