// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { motion } from '@/lib/motion';
import { useTenant } from '@/contexts';
import { Avatar } from '@/components/ui/Avatar';
import { Tooltip } from '@/components/ui/Tooltip';
import { resolveBrandingImageUrl } from '@/lib/helpers';
import { getAccessibleForegroundColor } from '@/lib/colorContrast';

/** Extract 1–2 initials from a tenant name. */
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  const firstWord = words[0] ?? '';
  const lastWord = words[words.length - 1] ?? '';
  if (words.length === 1) return firstWord.substring(0, 2).toUpperCase();
  return ((firstWord[0] ?? '') + (lastWord[0] ?? '')).toUpperCase();
}

/* ─── size maps ──────────────────────────────────────────────── */

const avatarSizeMap = { sm: 'sm', md: 'sm', lg: 'md' } as const;

// Smart, aspect-ratio-aware sizing: the logo's height grows as it gets narrower,
// so a wide wordmark, a landscape lockup and a square/stacked mark (e.g. a crest
// over two lines of text) all carry similar visual weight. Width is capped per
// size; height per (size × shape). Heights stay within the navbar row
// (h-14 = 56px mobile / h-16 = 64px desktop) so the header itself never grows.
type LogoShape = 'wide' | 'landscape' | 'square';

const logoMaxWidth = {
  sm: 'max-w-[180px] sm:max-w-[220px]',
  md: 'max-w-[200px] sm:max-w-[260px]',
  lg: 'max-w-[200px] sm:max-w-[260px]',
} as const;

// Square/stacked logos get notably more height; the navbar row grows to fit them
// (see Navbar min-h + Layout --logo-extra). Wide/landscape stay compact.
const logoHeight: Record<'sm' | 'md' | 'lg', Record<LogoShape, string>> = {
  sm: { wide: 'h-9 sm:h-10',  landscape: 'h-10 sm:h-12', square: 'h-14 sm:h-16' },
  md: { wide: 'h-9 sm:h-11',  landscape: 'h-10 sm:h-12', square: 'h-16 sm:h-20' },
  lg: { wide: 'h-10 sm:h-12', landscape: 'h-11 sm:h-14', square: 'h-16 sm:h-20' },
};

/** Bucket a logo by aspect ratio (width / height). Narrower → taller box. */
function logoShape(aspect: number | null): LogoShape {
  if (aspect === null) return 'landscape'; // sensible default before the image loads
  if (aspect >= 2.8) return 'wide';        // long wordmark — already reads big by width
  if (aspect >= 1.9) return 'landscape';   // horizontal lockup
  return 'square';                         // square / stacked / crest-over-text — needs height
}

// Explicit intrinsic dimensions to let the browser reserve layout space
// before the logo loads (reduces Cumulative Layout Shift). CSS still
// controls the rendered size via the imgClassMap classes; these values
// are the upper bounds so we never under-reserve.
const imgDimMap = {
  sm: { width: 220, height: 64 },
  md: { width: 240, height: 48 },
  lg: { width: 240, height: 48 },
} as const;

const nameClassMap = {
  sm: 'text-lg',
  md: 'text-lg sm:text-xl',
  lg: 'text-xl',
} as const;

/* ─── component ──────────────────────────────────────────────── */

export interface TenantLogoProps {
  /** Visual size preset: sm (Footer), md (Navbar), lg (MobileDrawer). */
  size?: 'sm' | 'md' | 'lg';
  /** Show the tenant name alongside the icon / image. */
  showName?: boolean;
  /** Show the tagline below the name (lg+ viewports only). */
  showTagline?: boolean;
  /** Compact mode — shrinks logo and hides name. Used when header is scrolled. */
  compact?: boolean;
  /**
   * On mobile (< sm) show the compact brand-mark icon (the initials avatar
   * fallback) instead of the custom logo, so a large uploaded logo can't bleed
   * past the header row. The full custom logo still renders at sm+. Navbar only.
   */
  collapseLogoOnMobile?: boolean;
  /** Extra classes on the outer <Link>. */
  className?: string;
}

export function TenantLogo({
  size = 'md',
  showName = true,
  showTagline = false,
  compact = false,
  collapseLogoOnMobile = false,
  className = '',
}: TenantLogoProps) {
  const { branding, tenantPath } = useTenant();

  const primaryColor = branding.primaryColor || '#6366f1';
  const primaryForeground = getAccessibleForegroundColor(primaryColor);
  const needsTooltip = branding.name.length > 20;

  // A custom uploaded logo (light variant, dark variant, or both) takes
  // precedence over the initials avatar. When present it must NOT shrink on
  // scroll, and the tenant-name text is hidden — the logo already carries the
  // brand name (still exposed to screen readers via the <img> alt).
  const hasLogo = Boolean(branding.logo || branding.logoDark);

  // Compact (scrolled) shrinks the initials avatar, but a real logo keeps its size.
  const effectiveSize = (compact && !hasLogo) ? 'sm' : size;

  // Smart sizing: prefer the server-provided shape (synchronous, no layout shift,
  // and shared with the navbar/offset). Fall back to measuring the image on load.
  const [logoAspect, setLogoAspect] = useState<number | null>(null);
  const shape: LogoShape = branding.logoShape ?? logoShape(logoAspect);
  const heightClass = logoHeight[effectiveSize][shape];

  /* ── icon / image ────────────────────────────────────────── */
  const renderLogoImg = (src: string) => (
    <img
      src={src}
      alt={branding.name}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setLogoAspect(img.naturalWidth / img.naturalHeight);
        }
      }}
      className={`${heightClass} w-auto object-contain ${logoMaxWidth[effectiveSize]} transition-all duration-200`.trim()}
      loading={size === 'sm' ? 'lazy' : 'eager'}
      width={imgDimMap[effectiveSize].width}
      height={imgDimMap[effectiveSize].height}
    />
  );

  // Theme-scoped variants: show the light-slot logo in light mode and the
  // dark-slot logo in dark mode (each falling back to the other). The logo is
  // rendered directly on the bar with no backdrop — a logo that only suits a dark
  // background should be supplied via the dark slot (or the tenant sets a header
  // colour); we don't paint a contrast chip behind it.
  const lightSrc = resolveBrandingImageUrl(branding.logo || branding.logoDark);
  const darkSrc = resolveBrandingImageUrl(branding.logoDark || branding.logo);

  // Theme-swapped custom logo: one visible at a time via the dark: variants.
  const logoImages = (
    <>
      <span className="inline-flex items-center dark:hidden">
        {renderLogoImg(lightSrc)}
      </span>
      <span className="hidden items-center dark:inline-flex">
        {renderLogoImg(darkSrc)}
      </span>
    </>
  );

  // Initials brand-mark — the fallback when no logo is set, and (when
  // collapseLogoOnMobile is on) the compact stand-in for the logo on mobile.
  const avatarElement = (
    <Avatar
      name={branding.name}
      getInitials={() => getInitials(branding.name)}
      size={avatarSizeMap[effectiveSize]}
      classNames={{
        base: 'ring-2 ring-offset-1 ring-offset-transparent ring-border dark:ring-border shrink-0 transition-all duration-200',
        fallback: primaryForeground === '#000000' ? '!text-black' : '!text-white',
      }}
      style={{
        backgroundColor: primaryColor,
        color: primaryForeground,
      }}
      aria-hidden="true"
    />
  );

  const iconElement = hasLogo ? (
    collapseLogoOnMobile ? (
      <>
        {/* Mobile: compact brand-mark icon instead of the (bleed-prone) logo */}
        <span className="inline-flex sm:hidden">{avatarElement}</span>
        {/* sm+ : full custom logo (inner spans do their own light/dark swap) */}
        <span className="hidden sm:inline-flex items-center">{logoImages}</span>
      </>
    ) : (
      logoImages
    )
  ) : (
    avatarElement
  );

  /* ── name text ───────────────────────────────────────────── */
  const nameSpan = (
    <span
      className={`font-bold ${nameClassMap[size]} text-gradient truncate max-w-[120px] sm:max-w-[160px] md:max-w-[200px] lg:max-w-[240px]`}
    >
      {branding.name}
    </span>
  );

  const nameElement = needsTooltip ? (
    <Tooltip content={branding.name} placement="bottom" delay={400} closeDelay={0}>
      {nameSpan}
    </Tooltip>
  ) : (
    nameSpan
  );

  /* ── tagline ─────────────────────────────────────────────── */
  const taglineElement =
    showTagline && branding.tagline ? (
      <span className="hidden lg:inline text-xs text-theme-subtle truncate max-w-[200px]">
        {branding.tagline}
      </span>
    ) : null;

  /* ── render ──────────────────────────────────────────────── */
  return (
    <Link
      to={tenantPath('/')}
      aria-label={branding.name}
      className={`flex min-w-0 items-center gap-2 ${className}`.trim()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="flex min-w-0 items-center shrink-0"
      >
        {iconElement}
      </motion.div>

      {showName && !compact && !hasLogo && (
        <div className="hidden min-[480px]:flex flex-col min-w-0 transition-all duration-200">
          {nameElement}
          {taglineElement}
        </div>
      )}
    </Link>
  );
}
