// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Helper utilities for the NEXUS React frontend
 */

import type { User } from '@/types/api';
import { logError } from './logger';
import i18n from '../i18n';
import { getRegion } from './regionStore';
import { safeLocalStorageGetJSON, safeLocalStorageSetJSON, safeLocalStorageRemove } from './safeStorage';

type DateValue = Date | number | string;

/**
 * Return the locale used for every user-facing Intl call: the language selected
 * inside NEXUS, combined with the community's region.
 *
 * Do not rely on an omitted locale: that silently follows the browser/OS
 * language even when the user has selected a different application language.
 *
 * The region matters as much as the language. A bare language tag carries no
 * region, so Intl falls back to the language's default one — for English that is
 * the United States, which rendered 17 August 2026 as `8/17/2026` across a
 * platform whose communities are in Ireland and the UK. Appending the region
 * from `regionStore` (tenant setting, else the platform default) fixes every
 * call site that funnels through this function.
 *
 * A language tag that already carries a region (`pt-BR`) is returned unchanged —
 * the member's explicit choice wins over the community default.
 */
export function getFormattingLocale(): string {
  const language = i18n.language || 'en';
  if (language.includes('-')) {
    return language;
  }
  return `${language}-${getRegion()}`;
}

/**
 * API Base URL for resolving relative image/asset URLs
 * This is the PHP backend URL where uploads are stored
 */
const API_BASE_ENV = import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || '';
const API_ROUTE_BASE = API_BASE_ENV || (import.meta.env.DEV ? '/api' : 'https://api.project-nexus.ie/api');
const API_ASSET_BASE = API_BASE_ENV.replace(/\/api$/, '') || (import.meta.env.DEV ? '' : 'https://api.project-nexus.ie');
const MEDIA_THUMBNAILS_ENABLED = import.meta.env.VITE_ENABLE_MEDIA_THUMBNAILS === 'true';

export interface ThumbnailOptions {
  width: number;
  height: number;
  fit?: 'cover' | 'contain';
  fallback?: string;
  format?: 'avif' | 'webp' | 'jpg';
}

export interface ResponsiveThumbnailOptions extends ThumbnailOptions {
  widths?: number[];
  sizes?: string;
}

/**
 * Resolve a branding/logo image without forcing it through the media thumbnail
 * pipeline. Header and footer logos need their original transparency and exact
 * light/dark variants; thumbnails are only for uploaded content media.
 */
export function resolveBrandingImageUrl(url: string | null | undefined, fallback?: string): string {
  const candidate = url || fallback;
  if (!candidate) {
    return '';
  }

  if (candidate.startsWith('http://') || candidate.startsWith('https://') || candidate.startsWith('//')) {
    return resolveAssetUrl(candidate);
  }

  const cleanUrl = candidate.startsWith('/') ? candidate : '/' + candidate;
  if (cleanUrl.startsWith('/uploads/') || cleanUrl.startsWith('/storage/')) {
    return resolveAssetUrl(cleanUrl);
  }

  return cleanUrl;
}

/**
 * Resolve a relative URL to an absolute URL pointing to the API server.
 * Used for images, avatars, and other assets served from the PHP backend.
 *
 * @param url - The URL to resolve (can be relative like '/uploads/...' or already absolute)
 * @param fallback - Optional fallback if url is null/empty
 * @returns Absolute URL or fallback
 */
export function resolveAssetUrl(url: string | null | undefined, fallback?: string): string {
  if (!url) {
    return fallback || '';
  }

  // Already absolute
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // Re-root upload paths through the API server ONLY if the URL is from a known
    // local domain (stale DB rows). External partner URLs must be left as-is so
    // avatars from federation partners load from the correct server.
    try {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith('/uploads/') || parsed.pathname.startsWith('/storage/')) {
        const apiHost = API_ASSET_BASE ? new URL(API_ASSET_BASE).host : '';
        const knownLocalHostnames = ['localhost', '127.0.0.1', 'hour-timebank.ie', 'app.project-nexus.ie'];
        if (parsed.host === apiHost || knownLocalHostnames.includes(parsed.hostname)) {
          return API_ASSET_BASE + parsed.pathname;
        }
      }
    } catch {
      // Not a valid URL — fall through and return as-is
    }
    return url;
  }

  // Protocol-relative
  if (url.startsWith('//')) {
    return 'https:' + url;
  }

  // Relative path - prepend API base
  const cleanUrl = url.startsWith('/') ? url : '/' + url;
  return API_ASSET_BASE + cleanUrl;
}

/**
 * Resolve an avatar URL with a default fallback
 */
export function resolveAvatarUrl(url: string | null | undefined): string {
  return resolveThumbnailUrl(url, {
    width: 96,
    height: 96,
    fallback: `${API_ASSET_BASE}/assets/img/defaults/default_avatar.png`,
  });
}

/**
 * Resolve local uploaded media through the API thumbnail cache.
 * External/federated media stays untouched so partner URLs keep working.
 */
export function resolveThumbnailUrl(url: string | null | undefined, options: ThumbnailOptions): string {
  const resolved = resolveAssetUrl(url, options.fallback);
  if (!resolved) {
    return options.fallback || '';
  }

  if (!MEDIA_THUMBNAILS_ENABLED) {
    return resolved;
  }

  try {
    const asset = new URL(resolved, window.location.origin);
    const assetBase = API_ASSET_BASE ? new URL(API_ASSET_BASE, window.location.origin) : new URL(window.location.origin);
    const isLocalAsset = asset.host === assetBase.host || (!API_ASSET_BASE && asset.origin === window.location.origin);
    const isSupportedPath = asset.pathname.startsWith('/uploads/') || asset.pathname.startsWith('/storage/');

    if (!isLocalAsset || !isSupportedPath) {
      return resolved;
    }

    const routeBase = new URL(API_ROUTE_BASE, window.location.origin);
    const params = new URLSearchParams({
      src: asset.pathname,
      w: String(options.width),
      h: String(options.height),
      fit: options.fit ?? 'cover',
    });
    if (options.format) {
      params.set('format', options.format);
    }

    return `${routeBase.origin}${routeBase.pathname.replace(/\/$/, '')}/v2/media/thumbnail?${params.toString()}`;
  } catch {
    return resolved;
  }
}

/**
 * Build a responsive srcset for local uploaded media using the thumbnail cache.
 * External/federated media returns an empty string so callers keep the original
 * URL instead of proxying partner assets through our server.
 */
export function resolveThumbnailSrcSet(url: string | null | undefined, options: ResponsiveThumbnailOptions): string {
  const widths = Array.from(new Set(options.widths ?? [320, 640, options.width]))
    .filter((width) => width > 0 && width <= options.width)
    .sort((a, b) => a - b);

  const parts = widths
    .map((width) => {
      const height = Math.max(1, Math.round(width * (options.height / options.width)));
      const resolved = resolveThumbnailUrl(url, { ...options, width, height });
      return resolved ? `${resolved} ${width}w` : '';
    })
    .filter(Boolean);

  if (parts.length <= 1) {
    return '';
  }

  const srcsetUrl = (part: string): string => {
    const descriptorSeparator = part.lastIndexOf(' ');
    return descriptorSeparator === -1 ? part : part.slice(0, descriptorSeparator);
  };
  const firstUrl = parts[0] ? srcsetUrl(parts[0]) : '';
  const allSame = parts.every((part) => srcsetUrl(part) === firstUrl);

  return allSame ? '' : parts.join(', ');
}

/**
 * Convenience props for <img> elements that should use uploaded-media
 * derivatives without losing their normal fallback behaviour.
 */
export function responsiveThumbnailProps(
  url: string | null | undefined,
  options: ResponsiveThumbnailOptions,
): { src: string; srcSet?: string; sizes?: string } {
  const src = resolveThumbnailUrl(url, options);
  const srcSet = resolveThumbnailSrcSet(url, options);

  return {
    src,
    ...(srcSet ? { srcSet } : {}),
    ...(options.sizes ? { sizes: options.sizes } : {}),
  };
}

/**
 * The `users.profile_type` value that marks an ORGANISATION account.
 *
 * Note the two spellings, both deliberate and neither safe to "tidy":
 * the VALUE is British (`organisation`) while the COLUMN is American
 * (`organization_name`). Comparing against `'organization'` silently never
 * matches anything.
 */
export const ORGANISATION_PROFILE_TYPE = 'organisation';

/** The loose shape every display-name helper here accepts. */
export interface DisplayNameFields {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  profile_type?: string | null;
  organization_name?: string | null;
}

/** True when this record is an organisation account with a usable trading name. */
export function isOrganisationAccount(user: DisplayNameFields | null | undefined): boolean {
  return (
    user?.profile_type === ORGANISATION_PROFILE_TYPE &&
    (user?.organization_name ?? '').trim() !== ''
  );
}

/**
 * The single place the frontend decides what a user account is CALLED.
 *
 * An account created through the general sign-up -- or switched later in
 * profile settings -- can be an organisation, in which case `first_name` and
 * `last_name` hold the CONTACT PERSON. Showing that person is wrong: the
 * account's identity is its organisation name. This mirrors the API-side
 * App/Support/UserDisplayName helper, and the two must agree.
 *
 * Precedence, and why:
 *  1. `organization_name` when this is an organisation -- authoritative, and
 *     it beats a stale precomputed `name` from an older payload;
 *  2. the API's own `name`, which is already resolved for most endpoints and
 *     is often the ONLY name field present (surname-withholding endpoints drop
 *     `last_name` entirely, so concatenating would lose half the name);
 *  3. first + last name;
 *  4. the caller's fallback.
 */
export function resolveUserDisplayName(
  user: DisplayNameFields | null | undefined,
  fallback = '',
): string {
  if (!user) return fallback;

  if (isOrganisationAccount(user)) {
    return (user.organization_name ?? '').trim();
  }

  const explicit = (user.name ?? '').trim();
  if (explicit) return explicit;

  const person = [user.first_name, user.last_name]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');

  return person || fallback;
}

/**
 * Resolve a display name from PREFIXED fields on a joined payload.
 *
 * Joins alias a user's columns to tell the two ends of a relationship apart --
 * `verifier_first_name`, `author_organization_name`. Mirrors the API-side
 * UserDisplayName::resolvePrefixed().
 */
export function resolveUserDisplayNameFromPrefix(
  row: Record<string, unknown> | null | undefined,
  prefix: string,
  fallback = '',
): string {
  if (!row) return fallback;
  const pick = (key: string): string | null => {
    const value = row[prefix + key];
    return typeof value === 'string' ? value : null;
  };
  return resolveUserDisplayName(
    {
      name: pick('name'),
      first_name: pick('first_name'),
      last_name: pick('last_name'),
      profile_type: pick('profile_type'),
      organization_name: pick('organization_name'),
    },
    fallback,
  );
}

/**
 * The value to STORE as a user's name, as opposed to the value to DISPLAY.
 *
 * The difference matters: resolveUserDisplayName() prefers an existing `name`
 * over the name parts, which is right for rendering but wrong for a save --
 * editing your first name would post the name you had before the edit. This
 * mirrors the API-side UserDisplayName::forStorage(), which deliberately
 * ignores any stored value.
 */
export function buildStoredUserName(user: DisplayNameFields): string {
  if (isOrganisationAccount(user)) {
    return (user.organization_name ?? '').trim();
  }

  return [user.first_name, user.last_name]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Get a user's display name. Organisation-aware -- see resolveUserDisplayName().
 */
export function getUserDisplayName(user: DisplayNameFields): string {
  return resolveUserDisplayName(user);
}

/**
 * RFC 8187-encode a header value that may contain non-ASCII text.
 *
 * HTTP header values are BYTES. `fetch()` throws "Cannot convert argument to a
 * ByteString" for any code point above 255, so a header carrying TRANSLATED
 * copy never leaves the browser at all — the request is never made, and the
 * failure surfaces as a generic refusal rather than as an encoding error.
 *
 * The supporter message-view purpose is exactly that: its reasons come from the
 * catalogue (English alone has a curly apostrophe in "Checking they're okay",
 * and it is also carried in Irish, Arabic, Japanese and Polish) and the reason
 * is joined to the supporter's free-text detail with an em dash.
 *
 * Laravel accepts both the encoded and the plain form
 * (SubAccountController::decodeHeaderValue), so encode unconditionally rather
 * than only when non-ASCII is present — a conditional would leave the ASCII
 * path as the only one ever exercised, which is how this survived.
 */
export function encodeHeaderValue(value: string): string {
  return `UTF-8''${encodeURIComponent(value ?? '')}`;
}

/**
 * Display name for a wallet transfer/donation recipient.
 *
 * The wallet search endpoint withholds surnames from non-admin viewers —
 * surnames are private platform-wide — so `last_name` is routinely absent
 * here in a way it is not on a full User record. Joining with a template
 * literal would render the literal text "undefined" beside the first name.
 * The API's precomputed `name` is preferred when present (it is the
 * organisation name for organisation accounts).
 */
export function getRecipientDisplayName(user: DisplayNameFields): string {
  return resolveUserDisplayName(user);
}

/**
 * Get a user's initials for an avatar fallback.
 *
 * An organisation gets the initials of its OWN name, not its contact person's.
 */
export function getUserInitials(user: DisplayNameFields): string {
  const words = resolveUserDisplayName(user).split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

/**
 * Format a date string to a relative time string
 */
export function formatRelativeTime(dateString: string | null | undefined): string {
  const date = toDateValue(dateString);
  if (isNaN(date.getTime())) return '—';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);

  const rtf = new Intl.RelativeTimeFormat(getFormattingLocale(), { numeric: 'auto', style: 'narrow' });

  if (diffSecs < 60) return rtf.format(-diffSecs, 'second');
  if (diffMins < 60) return rtf.format(-diffMins, 'minute');
  if (diffHours < 24) return rtf.format(-diffHours, 'hour');
  if (diffDays < 7) return rtf.format(-diffDays, 'day');
  if (diffDays < 30) return rtf.format(-diffWeeks, 'week');

  return formatDateValue(date);
}

/**
 * Normalize date-like values before formatting.
 */
function toDateValue(value: DateValue | null | undefined): Date {
  if (value instanceof Date) return value;
  if (value === null || value === undefined || value === '') return new Date(NaN);
  if (typeof value === 'string' && value.includes(' ') && !value.includes('T')) {
    return new Date(value.replace(' ', 'T'));
  }
  return new Date(value as string | number);
}

/**
 * Format a date-like value for display.
 */
export function formatDateValue(value: DateValue | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  const date = toDateValue(value);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(getFormattingLocale(), options ?? {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Backwards-compatible date helper for existing call sites.
 */
export function formatDate(dateString: string, options?: Intl.DateTimeFormatOptions): string {
  return formatDateValue(dateString, options);
}

/**
 * Format a date-time value for display.
 */
export function formatDateTime(value: DateValue, options?: Intl.DateTimeFormatOptions): string {
  return toDateValue(value).toLocaleString(getFormattingLocale(), options);
}

/**
 * Format a time for display.
 */
export function formatTime(dateString: string): string {
  return toDateValue(dateString).toLocaleTimeString(getFormattingLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a locale-aware number string.
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getFormattingLocale(), options).format(value);
}

/**
 * Format a ratio (where 1 is 100%) using the active interface locale.
 */
export function formatPercentRatio(
  ratio: number,
  options?: Omit<Intl.NumberFormatOptions, 'style'>
): string {
  return new Intl.NumberFormat(getFormattingLocale(), {
    style: 'percent',
    maximumFractionDigits: 1,
    ...options,
  }).format(ratio);
}

/**
 * Format a percentage value (where 100 is 100%) using the active interface locale.
 */
export function formatPercentValue(
  percentage: number,
  options?: Omit<Intl.NumberFormatOptions, 'style'>
): string {
  return formatPercentRatio(percentage / 100, options);
}

/**
 * Format a measurement with a locale-aware unit label.
 */
export function formatUnit(
  value: number,
  unit: string,
  options?: Omit<Intl.NumberFormatOptions, 'style' | 'unit'>
): string {
  return new Intl.NumberFormat(getFormattingLocale(), {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    ...options,
  }).format(value);
}

/**
 * Format a locale-aware currency string.
 */
export function formatCurrency(
  value: number,
  currency: string,
  options?: Omit<Intl.NumberFormatOptions, 'style' | 'currency'>
): string {
  return new Intl.NumberFormat(getFormattingLocale(), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    ...options,
  }).format(value);
}

/**
 * Format a short month label for date badges and compact cards.
 */
export function formatMonthShort(value: DateValue, uppercase = false): string {
  const formatted = new Intl.DateTimeFormat(getFormattingLocale(), { month: 'short' }).format(toDateValue(value));
  return uppercase ? formatted.toUpperCase() : formatted;
}

/**
 * Format the day-of-month portion of a date-like value.
 */
export function formatDayOfMonth(value: DateValue): string {
  return String(toDateValue(value).getDate());
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/**
 * Format hours for display
 */
export function formatHours(hours: number): string {
  return i18n.t('common:hours_display', { count: hours });
}

/**
 * Debounce function for search inputs
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (this: unknown, ...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * Class name utility (simple cn replacement)
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Storage helpers with error handling.
 *
 * Delegates to lib/safeStorage so writes are eviction-aware: a full localStorage
 * triggers two-stage cache eviction and retries, rather than silently failing or
 * crashing the caller. JSON-serializes values.
 */
export const storage = {
  get<T>(key: string, fallbackValue: T): T {
    return safeLocalStorageGetJSON(key, fallbackValue);
  },

  set<T>(key: string, value: T): void {
    if (!safeLocalStorageSetJSON(key, value)) {
      logError(`Failed to save ${key} to localStorage`);
    }
  },

  remove(key: string): void {
    safeLocalStorageRemove(key);
  },
};
