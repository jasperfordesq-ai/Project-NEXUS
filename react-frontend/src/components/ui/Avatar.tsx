// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  Children,
  isValidElement,
  type ComponentPropsWithoutRef,
  type ElementType,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { Avatar as HeroUIAvatar } from '@heroui/react/avatar';
import { resolveThumbnailUrl } from '@/lib/helpers';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { categoryColour, colourForSeed } from '@/lib/categoryColours';

/**
 * The picture the API hands out for a member with no photo of their own
 * (`resolveAvatarUrl(null)`): a grey silhouette. It is treated as "no photo",
 * so the member gets their initials in a colour instead.
 */
const STOCK_AVATAR_PATH = '/assets/img/defaults/default_avatar';

export function isStockAvatar(src: string | null | undefined): boolean {
  return typeof src === 'string' && src.includes(STOCK_AVATAR_PATH);
}

type HeroUIAvatarProps = ComponentPropsWithoutRef<typeof HeroUIAvatar>;
type AvatarSize = 'sm' | 'md' | 'lg' | string;
type AvatarColor = 'default' | 'accent' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
type AvatarRadius = 'none' | 'sm' | 'md' | 'lg' | 'full';

export type AvatarProps = Omit<HTMLAttributes<HTMLDivElement>, 'color' | 'children'> & {
  alt?: string;
  as?: ElementType;
  children?: ReactNode;
  classNames?: {
    base?: string;
    icon?: string;
    img?: string;
    fallback?: string;
  };
  color?: AvatarColor;
  fallback?: ReactNode;
  getInitials?: (name: string) => string;
  icon?: ReactNode;
  imgProps?: ImgHTMLAttributes<HTMLImageElement>;
  isBordered?: boolean;
  isDisabled?: boolean;
  isFocusable?: boolean;
  name?: string | null;
  radius?: AvatarRadius;
  showFallback?: boolean;
  size?: AvatarSize;
  src?: string | null;
};

export type AvatarGroupProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
  isBordered?: boolean;
  max?: number;
  size?: AvatarSize;
};

function combineClasses(...classes: Array<string | false | undefined>): string | undefined {
  const className = classes.filter(Boolean).join(' ');

  return className || undefined;
}

function initialsFromName(name?: string | null) {
  if (!name) {
    return '?';
  }

  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

function mapColor(color?: AvatarColor) {
  if (color === 'primary') {
    return 'accent';
  }

  if (color === 'secondary') {
    return 'default';
  }

  return color;
}

function mapSize(size?: AvatarSize) {
  return size === 'sm' || size === 'md' || size === 'lg' ? size : undefined;
}

function sizeClass(size?: AvatarSize) {
  switch (size) {
    case 'xs':
      return 'size-6 text-xs';
    case 'xl':
      return 'size-16 text-lg';
    case '2xl':
      return 'size-20 text-xl';
    default:
      return undefined;
  }
}

function radiusClass(radius?: AvatarRadius) {
  switch (radius) {
    case 'none':
      return 'rounded-none';
    case 'sm':
      return 'rounded-sm';
    case 'md':
      return 'rounded-md';
    case 'lg':
      return 'rounded-lg';
    case 'full':
      return 'rounded-full';
    default:
      return undefined;
  }
}

export function Avatar({
  alt,
  as: _as,
  children,
  className,
  classNames,
  color,
  fallback,
  getInitials,
  icon,
  imgProps,
  isBordered,
  isDisabled,
  isFocusable: _isFocusable,
  name,
  radius,
  showFallback: _showFallback,
  size,
  src,
  ref,
  ...props
}: AvatarProps & { ref?: Ref<HTMLDivElement> }) {
  const fallbackContent = fallback ?? icon ?? (getInitials && name ? getInitials(name) : initialsFromName(name));
  // A member with no photo of their own gets initials, not the stock picture.
  const photo = src && !isStockAvatar(src) ? src : null;
  const imageSrc = photo ? resolveThumbnailUrl(photo, { width: 96, height: 96 }) : null;
  // Initials (also shown while a photo loads, or if it fails) sit on a soft
  // colour from the site palette, picked by name so each person keeps theirs
  // everywhere and neighbours differ. Light and dark variants come with it.
  // A colour the caller asked for (HeroUI `color`) or styled itself wins.
  const palette = useSitePalette();
  const initialsColour = !color && !classNames?.fallback
    ? categoryColour(colourForSeed((name ?? alt ?? '').trim().toLowerCase(), palette)).band
    : undefined;

  return (
    <HeroUIAvatar
      ref={ref}
      className={combineClasses(
        classNames?.base,
        sizeClass(size),
        radiusClass(radius),
        isBordered && 'ring-2 ring-background',
        isDisabled && 'pointer-events-none opacity-50',
        className,
      )}
      color={mapColor(color)}
      size={mapSize(size)}
      {...(props as HeroUIAvatarProps)}
    >
      {photo ? (
        <HeroUIAvatar.Image
          alt={imgProps?.alt ?? alt ?? name ?? ''}
          className={combineClasses(classNames?.img, radiusClass(radius), imgProps?.className)}
          loading="lazy"
          decoding="async"
          src={imageSrc ?? undefined}
          {...imgProps}
        />
      ) : null}
      <HeroUIAvatar.Fallback className={combineClasses(initialsColour, 'font-semibold', classNames?.fallback, classNames?.icon, radiusClass(radius))}>
        {fallbackContent}
      </HeroUIAvatar.Fallback>
      {children}
    </HeroUIAvatar>
  );
}

Avatar.displayName = 'Avatar';

export function AvatarGroup({
  children,
  className,
  isBordered,
  max,
  size,
  ...props
}: AvatarGroupProps) {
  const items = Children.toArray(children);
  const visible = typeof max === 'number' && max > 0 ? items.slice(0, max) : items;
  const hiddenCount = typeof max === 'number' && max > 0 ? Math.max(items.length - max, 0) : 0;

  return (
    <div className={combineClasses('flex -space-x-2', className)} {...props}>
      {visible.map((child, index) => {
        if (!isValidElement(child)) {
          return child;
        }

        const childProps = child.props as AvatarProps;

        return (
          <Avatar
            key={child.key ?? index}
            {...childProps}
            className={combineClasses(isBordered && 'ring-2 ring-background', childProps.className)}
            size={childProps.size ?? size}
          />
        );
      })}
      {hiddenCount > 0 ? (
        <Avatar
          className={combineClasses(isBordered && 'ring-2 ring-background')}
          name={`+${hiddenCount}`}
          size={size}
        />
      ) : null}
    </div>
  );
}
