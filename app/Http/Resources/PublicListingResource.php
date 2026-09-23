<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Resources;

final class PublicListingResource
{
    /**
     * Add the Next public-frontend contract without changing existing SPA keys.
     *
     * @param array<string, mixed> $listing
     * @return array<string, mixed>
     */
    public static function augment(array $listing): array
    {
        if (!self::shouldIncludePublicContract()) {
            return $listing;
        }

        $listing['public_contract'] = self::fromArray($listing);

        return $listing;
    }

    /**
     * @param array<string, mixed> $listing
     * @return array<string, mixed>
     */
    public static function fromArray(array $listing): array
    {
        $id = self::nullableInt($listing['id'] ?? null) ?? 0;
        $title = self::stringValue($listing['title'] ?? '');
        $description = self::stringValue($listing['description'] ?? '');

        return [
            'id' => $id,
            'slug' => self::stringValue($listing['slug'] ?? $id),
            'title' => $title,
            'description' => $description,
            'excerpt' => self::excerpt($description),
            'primary_image' => self::primaryImage($listing, $title),
            'gallery' => self::gallery($listing, $title),
            'category' => self::category($listing),
            // F-082: the public contract is for anonymous public pages, so the
            // coordinates are always rounded to ~1 km, exactly as
            // PublicMarketplaceListingResource does.
            'location' => [
                'label' => self::nullableString($listing['location'] ?? null),
                'latitude' => ($latitude = self::nullableFloat($listing['latitude'] ?? null)) !== null
                    ? round($latitude, 2)
                    : null,
                'longitude' => ($longitude = self::nullableFloat($listing['longitude'] ?? null)) !== null
                    ? round($longitude, 2)
                    : null,
            ],
            'time_credit_value' => [
                'hours' => self::nullableFloat($listing['hours_estimate'] ?? $listing['price'] ?? null),
                'unit' => 'hour',
            ],
            'provider' => self::provider($listing),
            'created_at' => self::nullableString($listing['created_at'] ?? null),
            'updated_at' => self::nullableString($listing['updated_at'] ?? null),
            'status' => self::nullableString($listing['status'] ?? null) ?? 'active',
            'type' => self::nullableString($listing['type'] ?? null),
        ];
    }

    /**
     * @param array<string, mixed> $listing
     * @return array{url: string, alt_text: string}|null
     */
    private static function primaryImage(array $listing, string $title): ?array
    {
        $url = self::nullableString($listing['image_url'] ?? null);

        if ($url === null) {
            $firstGalleryImage = self::gallery($listing, $title)[0] ?? null;

            return $firstGalleryImage
                ? ['url' => $firstGalleryImage['url'], 'alt_text' => $firstGalleryImage['alt_text']]
                : null;
        }

        return [
            'url' => $url,
            'alt_text' => self::nullableString($listing['image_alt'] ?? null) ?? $title,
        ];
    }

    /**
     * @param array<string, mixed> $listing
     * @return array<int, array{url: string, alt_text: string, sort_order: int}>
     */
    private static function gallery(array $listing, string $title): array
    {
        $gallery = [];
        $images = $listing['images'] ?? [];

        if (!is_array($images)) {
            return $gallery;
        }

        foreach ($images as $index => $image) {
            if (!is_array($image)) {
                continue;
            }

            $url = self::nullableString($image['url'] ?? $image['image_url'] ?? null);
            if ($url === null) {
                continue;
            }

            $gallery[] = [
                'url' => $url,
                'alt_text' => self::nullableString($image['alt_text'] ?? null) ?? $title,
                'sort_order' => self::nullableInt($image['sort_order'] ?? null) ?? $index,
            ];
        }

        if ($gallery === [] && ($fallbackUrl = self::nullableString($listing['image_url'] ?? null)) !== null) {
            $gallery[] = [
                'url' => $fallbackUrl,
                'alt_text' => self::nullableString($listing['image_alt'] ?? null) ?? $title,
                'sort_order' => 0,
            ];
        }

        return $gallery;
    }

    /**
     * @param array<string, mixed> $listing
     * @return array{id: int|null, name: string|null, slug: string|null}|null
     */
    private static function category(array $listing): ?array
    {
        $category = is_array($listing['category'] ?? null) ? $listing['category'] : [];
        $id = self::nullableInt($listing['category_id'] ?? $category['id'] ?? null);
        $name = self::nullableString($listing['category_name'] ?? $category['name'] ?? null);
        $slug = self::nullableString($listing['category_slug'] ?? $category['slug'] ?? null);

        if ($id === null && $name === null && $slug === null) {
            return null;
        }

        return [
            'id' => $id,
            'name' => $name,
            'slug' => $slug,
        ];
    }

    /**
     * @param array<string, mixed> $listing
     * @return array{id: int|null, display_name: string|null}
     */
    private static function provider(array $listing): array
    {
        $user = is_array($listing['user'] ?? null) ? $listing['user'] : [];

        return [
            'id' => self::nullableInt($user['id'] ?? $listing['user_id'] ?? null),
            'display_name' => self::nullableString(
                $user['name'] ?? $listing['author_name'] ?? $listing['provider_display_name'] ?? null
            ),
        ];
    }

    private static function excerpt(string $description): string
    {
        $plain = trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags($description))) ?? '');

        if (mb_strlen($plain) <= 180) {
            return $plain;
        }

        return rtrim(mb_substr($plain, 0, 177)) . '...';
    }

    private static function stringValue(mixed $value): string
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format(\DateTimeInterface::ATOM);
        }

        return trim((string) $value);
    }

    private static function nullableString(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return self::stringValue($value);
    }

    private static function nullableInt(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric($value) ? (int) $value : null;
    }

    private static function nullableFloat(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric($value) ? (float) $value : null;
    }

    private static function shouldIncludePublicContract(): bool
    {
        $header = request()->headers->get('X-Public-Contract');
        if ($header !== null && in_array(strtolower($header), ['1', 'true', 'yes'], true)) {
            return true;
        }

        $include = request()->query('include');
        if ($include === null) {
            return false;
        }

        $values = is_array($include) ? $include : explode(',', (string) $include);

        return in_array('public_contract', array_map(static fn ($value): string => trim((string) $value), $values), true);
    }
}
