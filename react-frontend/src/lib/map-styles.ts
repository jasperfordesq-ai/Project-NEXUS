// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { LucideIcon } from 'lucide-react';
import Gift from 'lucide-react/icons/gift';
import HandHelping from 'lucide-react/icons/hand-helping';
import CalendarDays from 'lucide-react/icons/calendar-days';
import Users from 'lucide-react/icons/users';
import User from 'lucide-react/icons/user';
import MapPin from 'lucide-react/icons/map-pin';

/**
 * Map pins in the site's own colours (warmth plan Phase 4 C3).
 *
 * Each kind of thing on a map wears the same colour it has everywhere else
 * (the feed, search, the bell — `kindColour()`), with a small picture of what
 * it is inside the pin. The -600 shades are used so a pin stands out from
 * pale map tiles (3:1 or better against white, as WCAG asks of a graphic).
 * Anything without a kind takes the community's own button colour.
 */
export interface PinStyle {
  /** A CSS colour; may be a `var(--…)` token, resolved where needed. */
  colour: string;
  icon: LucideIcon;
}

const KIND_PINS: Record<string, PinStyle> = {
  offer: { colour: '#059669', icon: Gift },
  request: { colour: '#d97706', icon: HandHelping },
  event: { colour: '#059669', icon: CalendarDays },
  group: { colour: '#ea580c', icon: Users },
  member: { colour: '#e11d48', icon: User },
};

/** The community's own colour, for pins and clusters with no kind. */
export const COMMUNITY_PIN_COLOUR = 'var(--accent-strong)';

export function pinStyleFor(kind?: string | null): PinStyle {
  return (kind && KIND_PINS[kind]) || { colour: COMMUNITY_PIN_COLOUR, icon: MapPin };
}

/**
 * Turns a `var(--token)` into the colour it stands for right now, for map
 * libraries that take a plain colour string (Google's Pin). Plain colours are
 * returned unchanged.
 */
export function resolveCssColour(value: string, fallback = '#4f46e5'): string {
  const match = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!match) return value;
  if (typeof window === 'undefined') return fallback;
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(match[1]!).trim();
  return resolved || fallback;
}

/**
 * Dark mode styles for Google Maps.
 * Matches the project's dark theme palette.
 */
export const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8b8ba7' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#b4b4cf' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#6b6b8a' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#1a2e1a' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#4a7c4a' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#2a2a3e' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#1a1a2e' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#3a3a5e' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#1a1a2e' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#2a2a3e' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#0e1a2e' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#3a5a7e' }],
  },
];
