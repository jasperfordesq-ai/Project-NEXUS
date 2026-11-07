<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Media;

/**
 * A stored image description, as it may be handed to a screen reader.
 *
 * Marketplace photo uploads saved the uploaded FILE NAME as the description
 * until 7 Nov 2026, so a screen reader announced "IMG_2034.jpg" (AWID
 * accessibility report, point 6). A member-written description never ends
 * in an image file extension, so such a value is treated as no description
 * at all and the page's own fallback ("Photo of …") is used instead.
 */
final class ImageAltText
{
    private const FILE_NAME = '/\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i';

    public static function fromStored(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $value = trim($value);
        if ($value === '' || preg_match(self::FILE_NAME, $value) === 1) {
            return null;
        }

        return $value;
    }
}
