// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * EventPreviewCard — how the event will look on the events page, as it is
 * typed (warmth phase 5, after the offer and group forms).
 *
 * It follows the look of the real card (EventCard in pages/events/EventsPage):
 * the date tile in the colour of the event's kind, the name, the kind's
 * label, two lines of description, the time and the place. It is a picture
 * of a card, not a card: nothing in it is a link or a button.
 *
 * The date and time are shown as typed (the organiser's own wall-clock), not
 * converted: this is a picture of the form, and the real card formats the
 * saved event in its own time zone.
 */

import { useTranslation } from 'react-i18next';
import Calendar from 'lucide-react/icons/calendar';
import Clock from 'lucide-react/icons/clock';
import Eye from 'lucide-react/icons/eye';
import ImagePlus from 'lucide-react/icons/image-plus';
import MapPin from 'lucide-react/icons/map-pin';
import { GlassCard } from '@/components/ui/GlassCard';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { useCategoryListColours } from '@/hooks/useCategoryListColours';
import { categoryColour, colourForSeed } from '@/lib/categoryColours';
import { formatDateValue, getFormattingLocale } from '@/lib/helpers';

export interface EventPreviewCardProps {
  title: string;
  description: string;
  /** The start as typed: year, month (1–12) and day; null until a date is chosen. */
  startDate: { year: number; month: number; day: number } | null;
  /** The start time as typed; null until chosen (or for an all-day event). */
  startTime: { hour: number; minute: number } | null;
  allDay: boolean;
  location: string;
  categoryId?: number | null;
  categoryName?: string | null;
  /** The cover picture chosen in the form (or the saved one), if any. */
  imageSrc: string | null;
}

export function EventPreviewCard({
  title, description, startDate, startTime, allDay, location, categoryId, categoryName, imageSrc,
}: EventPreviewCardProps) {
  const { t } = useTranslation('events');
  const palette = useSitePalette();
  const eventCategoryColour = useCategoryListColours('/v2/categories?type=event');
  const tileColour = eventCategoryColour(categoryId ?? undefined) ?? colourForSeed('event-preview', palette);
  const band = categoryColour(tileColour).band;

  const hasTitle = title.trim() !== '';
  const hasDescription = description.trim() !== '';
  const date = startDate ? new Date(startDate.year, startDate.month - 1, startDate.day, startTime?.hour ?? 0, startTime?.minute ?? 0) : null;
  const locale = getFormattingLocale();
  const timeLabel = !date
    ? t('form.preview_date_placeholder')
    : allDay
      ? t('calendar.all_day')
      : startTime
        ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
        : null;

  return (
    <section aria-labelledby="event-preview-heading" data-testid="event-preview">
      <h2 id="event-preview-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-theme-secondary">
        <Eye className="h-4 w-4 text-accent" aria-hidden="true" />
        {t('form.preview_heading')}
      </h2>
      <GlassCard className="overflow-hidden">
        {imageSrc && (
          // Decorative here: the same picture, with the organiser's own
          // description, is already in the form beside it.
          <img src={imageSrc} alt="" className="h-28 w-full object-cover" />
        )}
        <div className="flex gap-3 p-4">
          <div className="w-14 shrink-0 text-center">
            <div
              data-testid="event-preview-date-tile"
              data-colour={tileColour}
              className={`rounded-xl p-2 ring-1 ring-black/5 dark:ring-white/10 ${band}`}
            >
              {date ? (
                <>
                  <span className="block text-xs font-semibold uppercase">
                    {formatDateValue(date, { month: 'short' }).toLocaleUpperCase(locale)}
                  </span>
                  <span className="block text-xl font-bold text-theme-primary">{formatDateValue(date, { day: 'numeric' })}</span>
                  <span className="block text-xs text-theme-subtle">{formatDateValue(date, { weekday: 'short' })}</span>
                </>
              ) : (
                <Calendar className="mx-auto my-3 h-6 w-6" aria-hidden="true" />
              )}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p
              data-testid="event-preview-title"
              className={`text-base font-semibold leading-snug ${hasTitle ? 'text-theme-primary' : 'text-theme-subtle'}`}
            >
              {hasTitle ? title : t('form.preview_title_placeholder')}
            </p>
            {categoryName && (
              <span
                data-testid="event-preview-category"
                className={`mt-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${band}`}
              >
                {categoryName}
              </span>
            )}
            <p
              data-testid="event-preview-description"
              className={`mt-1 line-clamp-2 text-sm ${hasDescription ? 'text-theme-muted' : 'text-theme-subtle'}`}
            >
              {hasDescription ? description : t('form.preview_description_placeholder')}
            </p>
            <div className="mt-2 flex flex-col gap-1 text-xs text-theme-subtle">
              {timeLabel && (
                <span data-testid="event-preview-time" className="flex items-center gap-1">
                  <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {timeLabel}
                </span>
              )}
              {location.trim() !== '' && (
                <span className="flex min-w-0 items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{location}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </GlassCard>
      {!imageSrc && (
        <p data-testid="event-preview-cover-nudge" className="mt-3 flex items-start gap-2 text-xs leading-5 text-theme-muted">
          <ImagePlus className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          {t('form.preview_cover_nudge')}
        </p>
      )}
    </section>
  );
}

export default EventPreviewCard;
