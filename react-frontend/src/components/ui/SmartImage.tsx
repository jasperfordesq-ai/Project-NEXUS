// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useLayoutEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { categoryColour, colourForSeed } from '@/lib/categoryColours';
import { useSitePalette } from '@/contexts/SiteAccentContext';

export interface SmartImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'className' | 'onLoad'> {
  /** Required: describe the photo, or pass "" when it is decorative. */
  alt: string;
  /**
   * The item's colour name (its theme's colour, from `categoryColours`). The
   * frame is painted in it while the photo loads, so a card is never a grey
   * hole. Leave out to pick one from the community palette by `seed`.
   */
  colour?: string | null;
  /** The item's id, so the colour picked from the palette is stable. */
  seed?: string | number;
  /**
   * Size and shape of the frame: an aspect ratio (`aspect-video`) or a fixed
   * height, plus rounding. The photo fills it, so nothing below moves when it
   * arrives.
   */
  frameClassName?: string;
  /** Extra classes for the photo itself (e.g. a hover zoom). */
  imgClassName?: string;
  /** Shown instead of the photo when it fails to load. Default: the colour alone. */
  fallback?: ReactNode;
  'data-testid'?: string;
}

/**
 * A photo that fades in from its item's own colour (warmth plan Phase 4 C1).
 *
 * Photos used to pop in on a grey box. Here the frame is drawn first in the
 * item's cover colour at a fixed size, and the photo fades in over it once it
 * has loaded. With reduced motion the photo simply appears. A photo the
 * browser already has (cache) shows at once with no fade.
 */
export function SmartImage({
  colour,
  seed = 'image',
  frameClassName = '',
  imgClassName = '',
  fallback,
  onError,
  src,
  alt,
  'data-testid': testId,
  ...imgProps
}: SmartImageProps) {
  const palette = useSitePalette();
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const cover = categoryColour(colour || colourForSeed(seed, palette)).cover;
  // The frame is a block unless the caller sets its own display (e.g.
  // `hidden sm:block`): two unprefixed display classes would fight.
  const display = /(^|\s)(hidden|block|flex|inline-block|grid)(\s|$)/.test(frameClassName) ? '' : 'block';

  // A new photo starts again; one already in the browser's cache is shown
  // straight away rather than faded.
  useLayoutEffect(() => {
    setFailed(false);
    const img = imgRef.current;
    setLoaded(Boolean(img && img.complete && img.naturalWidth > 0));
  }, [src]);

  return (
    <span
      data-testid={testId ?? 'smart-image'}
      data-loaded={loaded ? 'true' : 'false'}
      className={`relative ${display} overflow-hidden ${cover} ${frameClassName}`}
    >
      {failed ? (
        fallback ?? null
      ) : (
        <img
          {...imgProps}
          ref={imgRef}
          src={src}
          alt={alt}
          onLoad={() => setLoaded(true)}
          onError={(event) => {
            setFailed(true);
            onError?.(event);
          }}
          className={`absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none ${
            loaded ? 'opacity-100' : 'opacity-0'
          } ${imgClassName}`}
        />
      )}
    </span>
  );
}

export default SmartImage;
