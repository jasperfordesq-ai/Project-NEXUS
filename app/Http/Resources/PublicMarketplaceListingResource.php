<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Resources;

use App\Core\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

final class PublicMarketplaceListingResource
{
    /**
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
     * Add the opt-in public contract to a listing collection without issuing
     * one detail query per item. Browse payloads intentionally omit several
     * detail fields, so hydrate every missing record in one tenant-scoped read.
     *
     * @param array<int, mixed> $listings
     * @return array<int, mixed>
     */
    public static function augmentCollection(array $listings): array
    {
        if (!self::shouldIncludePublicContract()) {
            return $listings;
        }

        $ids = [];
        foreach ($listings as $listing) {
            if (!is_array($listing) || self::hasIndexDetailFields($listing)) {
                continue;
            }

            $id = self::nullableInt($listing['id'] ?? null);
            if ($id !== null) {
                $ids[] = $id;
            }
        }

        $details = $ids === []
            ? collect()
            : DB::table('marketplace_listings')
                ->where('tenant_id', TenantContext::getId())
                ->whereIn('id', array_values(array_unique($ids)))
                ->get([
                    'id',
                    'description',
                    'quantity',
                    'latitude',
                    'longitude',
                    'shipping_available',
                    'local_pickup',
                    'expires_at',
                    'updated_at',
                ])
                ->keyBy('id');

        return array_map(static function (mixed $listing) use ($details): mixed {
            if (!is_array($listing)) {
                return $listing;
            }

            $id = self::nullableInt($listing['id'] ?? null);
            $detail = $id === null ? null : $details->get($id);
            if ($detail !== null) {
                foreach ((array) $detail as $key => $value) {
                    if (!array_key_exists($key, $listing) || $listing[$key] === null) {
                        $listing[$key] = $value;
                    }
                }
            }

            $listing['public_contract'] = self::fromArray($listing);

            return $listing;
        }, $listings);
    }

    /**
     * @param array<string, mixed> $listing
     * @return array<string, mixed>
     */
    public static function fromArray(array $listing): array
    {
        $listing = self::hydratePublicContractFields($listing);
        $id = self::nullableInt($listing['id'] ?? null) ?? 0;
        $title = self::stringValue($listing['title'] ?? '');
        $description = self::stringValue($listing['description'] ?? '');
        $excerptSource = self::nullableString($listing['tagline'] ?? null) ?? $description;
        $gallery = self::gallery($listing, $title);

        return [
            'id' => $id,
            'slug' => self::stringValue($listing['slug'] ?? $id),
            'title' => $title,
            'description' => $description,
            'excerpt' => self::excerpt($excerptSource),
            'primary_image' => self::primaryImage($listing, $title, $gallery),
            'gallery' => $gallery,
            'category' => self::category($listing),
            'location' => [
                'label' => self::nullableString($listing['location'] ?? null),
                'latitude' => ($latitude = self::nullableFloat($listing['latitude'] ?? null)) !== null
                    ? round($latitude, 2)
                    : null,
                'longitude' => ($longitude = self::nullableFloat($listing['longitude'] ?? null)) !== null
                    ? round($longitude, 2)
                    : null,
            ],
            'price' => [
                'amount' => self::nullableFloat($listing['price'] ?? null),
                'currency' => self::nullableString($listing['price_currency'] ?? null)
                    ?? strtoupper(TenantContext::getCurrency()),
                'price_type' => self::nullableString($listing['price_type'] ?? null) ?? 'fixed',
                'time_credits' => self::nullableFloat($listing['time_credit_price'] ?? null),
            ],
            'seller' => self::seller($listing),
            'delivery' => [
                'method' => self::nullableString($listing['delivery_method'] ?? null),
                'shipping_available' => self::nullableBool($listing['shipping_available'] ?? null),
                'local_pickup' => self::nullableBool($listing['local_pickup'] ?? null),
            ],
            'condition' => self::nullableString($listing['condition'] ?? null),
            'quantity' => self::nullableInt($listing['quantity'] ?? null),
            'expires_at' => self::dateString($listing['expires_at'] ?? null),
            'created_at' => self::dateString($listing['created_at'] ?? null),
            'updated_at' => self::dateString($listing['updated_at'] ?? null),
            'status' => self::nullableString($listing['status'] ?? null) ?? 'active',
        ];
    }

    /**
     * The live marketplace index payload intentionally stays compact. Opt-in
     * Next contracts hydrate missing public fields without changing that shape.
     *
     * @param array<string, mixed> $listing
     * @return array<string, mixed>
     */
    private static function hydratePublicContractFields(array $listing): array
    {
        $id = self::nullableInt($listing['id'] ?? null);

        if ($id === null || self::hasIndexDetailFields($listing)) {
            return $listing;
        }

        $row = DB::table('marketplace_listings')
            ->where('tenant_id', TenantContext::getId())
            ->where('id', $id)
            ->first([
                'description',
                'quantity',
                'latitude',
                'longitude',
                'shipping_available',
                'local_pickup',
                'expires_at',
                'updated_at',
            ]);

        if ($row === null) {
            return $listing;
        }

        foreach ((array) $row as $key => $value) {
            if (!array_key_exists($key, $listing) || $listing[$key] === null) {
                $listing[$key] = $value;
            }
        }

        return $listing;
    }

    /**
     * @param array<string, mixed> $listing
     */
    private static function hasIndexDetailFields(array $listing): bool
    {
        return array_key_exists('description', $listing)
            && array_key_exists('quantity', $listing)
            && array_key_exists('shipping_available', $listing)
            && array_key_exists('local_pickup', $listing)
            && array_key_exists('updated_at', $listing);
    }

    /**
     * @param array<string, mixed> $listing
     * @param array<int, array{url: string, alt_text: string, sort_order: int}> $gallery
     * @return array{url: string, alt_text: string}|null
     */
    private static function primaryImage(array $listing, string $title, array $gallery): ?array
    {
        $image = is_array($listing['image'] ?? null) ? $listing['image'] : null;
        $url = self::nullableString($image['url'] ?? null);

        if ($url === null) {
            foreach (self::arrayValue($listing['images'] ?? null) as $candidate) {
                if (!is_array($candidate)) {
                    continue;
                }

                $candidateUrl = self::nullableString($candidate['url'] ?? $candidate['image_url'] ?? null);
                if ($candidateUrl === null) {
                    continue;
                }

                if (self::boolValue($candidate['is_primary'] ?? false)) {
                    $url = $candidateUrl;
                    $image = $candidate;
                    break;
                }
            }
        }

        if ($url === null && isset($gallery[0])) {
            return [
                'url' => $gallery[0]['url'],
                'alt_text' => $gallery[0]['alt_text'],
            ];
        }

        if ($url === null) {
            return null;
        }

        return [
            'url' => $url,
            'alt_text' => self::nullableString(\App\Support\Media\ImageAltText::fromStored($image['alt_text'] ?? null)) ?? $title,
        ];
    }

    /**
     * @param array<string, mixed> $listing
     * @return array<int, array{url: string, alt_text: string, sort_order: int}>
     */
    private static function gallery(array $listing, string $title): array
    {
        $gallery = [];
        $images = self::arrayValue($listing['images'] ?? null);

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
                'alt_text' => self::nullableString(\App\Support\Media\ImageAltText::fromStored($image['alt_text'] ?? null)) ?? $title,
                'sort_order' => self::nullableInt($image['sort_order'] ?? null) ?? $index,
            ];
        }

        $image = is_array($listing['image'] ?? null) ? $listing['image'] : null;
        $fallbackUrl = self::nullableString($image['url'] ?? null);
        if ($gallery === [] && $fallbackUrl !== null) {
            $gallery[] = [
                'url' => $fallbackUrl,
                'alt_text' => self::nullableString(\App\Support\Media\ImageAltText::fromStored($image['alt_text'] ?? null)) ?? $title,
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
        $id = self::nullableInt($category['id'] ?? $listing['category_id'] ?? null);
        $name = self::nullableString($category['name'] ?? $listing['category_name'] ?? null);
        $slug = self::nullableString($category['slug'] ?? $listing['category_slug'] ?? null);

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
     * @return array{id: int|null, display_name: string|null, avatar_url: string|null, is_verified: bool, seller_type: string|null}
     */
    private static function seller(array $listing): array
    {
        $user = is_array($listing['user'] ?? null) ? $listing['user'] : [];

        return [
            'id' => self::nullableInt($user['id'] ?? $listing['user_id'] ?? null),
            'display_name' => self::nullableString($user['name'] ?? null),
            'avatar_url' => self::nullableString($user['avatar_url'] ?? null),
            'is_verified' => self::boolValue($user['is_verified'] ?? false),
            'seller_type' => self::nullableString($listing['seller_type'] ?? null),
        ];
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

    private static function excerpt(string $value): string
    {
        $plain = trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags($value))) ?? '');

        if (mb_strlen($plain) <= 180) {
            return $plain;
        }

        return rtrim(mb_substr($plain, 0, 177)) . '...';
    }

    /**
     * @return array<int, mixed>
     */
    private static function arrayValue(mixed $value): array
    {
        return is_array($value) ? array_values($value) : [];
    }

    private static function dateString(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if ($value instanceof \DateTimeInterface) {
            return $value->format(\DateTimeInterface::ATOM);
        }

        return Carbon::parse((string) $value, 'UTC')->toIso8601String();
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

    private static function nullableBool(mixed $value): ?bool
    {
        if ($value === null || $value === '') {
            return null;
        }

        return self::boolValue($value);
    }

    private static function boolValue(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_numeric($value)) {
            return (int) $value === 1;
        }

        if (is_string($value)) {
            return in_array(strtolower($value), ['1', 'true', 'yes'], true);
        }

        return false;
    }
}
