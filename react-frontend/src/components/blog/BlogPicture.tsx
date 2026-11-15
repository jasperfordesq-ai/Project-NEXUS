// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A blog post's picture, shown whole.
 *
 * The blog used to put pictures in fixed-height boxes that cropped to fill
 * (`h-48 object-cover`). The box's shape therefore changed with the screen,
 * from about 1.28:1 (the latest-post card on a tablet) to 3:1 (a large phone),
 * and the same picture lost its sides on one and its top and bottom on the
 * other. A picture with words on it had them cut in half.
 *
 * Here the picture is never cropped. Where its shape does not match the box, a
 * blurred copy of the same picture fills the gap, so there are no blank bars.
 * The copy uses the same address, so it costs no second download.
 */

interface BlogPictureProps {
  /** From `responsiveThumbnailProps()`. */
  image: { src: string; srcSet?: string; sizes?: string };
  alt: string;
  /**
   * `card`: one fixed shape (1200 × 630, the standard share-picture shape) at
   * every screen width, so cards in a grid line up.
   * `natural`: the picture's own shape at full width, up to a height limit —
   * for the top of a post.
   */
  shape: 'card' | 'natural';
  /** Extra classes for the box (width, rounding). Never a fixed height. */
  className?: string;
  /** Extra classes for the picture itself, such as a hover zoom. */
  imageClassName?: string;
  /** The page's main picture: loaded straight away, ahead of everything else. */
  priority?: boolean;
  /** Reserve this much room before the picture has loaded. */
  width?: number;
  height?: number;
}

const BOX = 'relative isolate overflow-hidden bg-theme-elevated';
const SHAPE_BOX = { card: 'aspect-[1200/630]', natural: '' } as const;
const SHAPE_PICTURE = {
  card: 'absolute inset-0 h-full w-full object-contain',
  natural: 'relative block h-auto max-h-128 w-full object-contain',
} as const;

export function BlogPicture({
  image,
  alt,
  shape,
  className = '',
  imageClassName = '',
  priority = false,
  width,
  height,
}: BlogPictureProps) {
  return (
    <div data-testid="blog-picture" className={`${BOX} ${SHAPE_BOX[shape]} ${className}`}>
      {/* Decoration only: fills whatever the whole picture leaves uncovered. */}
      <img
        src={image.src}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl"
        loading="lazy"
        decoding="async"
      />
      <img
        {...image}
        alt={alt}
        width={width}
        height={height}
        className={`${SHAPE_PICTURE[shape]} ${imageClassName}`}
        loading={priority ? 'eager' : 'lazy'}
        {...(priority ? { fetchPriority: 'high' as const } : { decoding: 'async' as const })}
      />
    </div>
  );
}

export default BlogPicture;
