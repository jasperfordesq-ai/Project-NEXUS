<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Resources;

use Illuminate\Support\Carbon;

final class PublicEventResource
{
    /**
     * @param array<string, mixed> $event
     * @return array<string, mixed>
     */
    public static function augment(array $event): array
    {
        if (!self::shouldIncludePublicContract()) {
            return $event;
        }

        $event['public_contract'] = self::fromArray($event);

        return $event;
    }

    /**
     * @param array<string, mixed> $event
     * @return array<string, mixed>
     */
    public static function fromArray(array $event): array
    {
        $id = self::nullableInt($event['id'] ?? null) ?? 0;
        $title = self::stringValue($event['title'] ?? '');
        $description = self::stringValue($event['description'] ?? '');

        return [
            'id' => $id,
            'slug' => self::stringValue($event['slug'] ?? $id),
            'title' => $title,
            'description' => $description,
            'excerpt' => self::excerpt($description),
            'primary_image' => self::primaryImage($event, $title),
            'category' => self::category($event),
            'location' => [
                'label' => self::nullableString($event['location'] ?? null),
                'latitude' => self::nullableFloat($event['latitude'] ?? null),
                'longitude' => self::nullableFloat($event['longitude'] ?? null),
            ],
            'organiser' => self::organiser($event),
            'start_at' => self::dateString($event['start_time'] ?? $event['start_date'] ?? null),
            'end_at' => self::dateString($event['end_time'] ?? $event['end_date'] ?? null),
            'created_at' => self::dateString($event['created_at'] ?? null),
            'updated_at' => self::dateString($event['updated_at'] ?? null),
            'status' => self::nullableString($event['status'] ?? null) ?? 'active',
        ];
    }

    /**
     * @param array<string, mixed> $event
     * @return array{url: string, alt_text: string}|null
     */
    private static function primaryImage(array $event, string $title): ?array
    {
        $url = self::nullableString($event['image_url'] ?? $event['cover_image'] ?? null);

        if ($url === null) {
            return null;
        }

        return [
            'url' => $url,
            'alt_text' => self::nullableString($event['image_alt'] ?? null) ?? $title,
        ];
    }

    /**
     * @param array<string, mixed> $event
     * @return array{id: int|null, name: string|null, slug: string|null}|null
     */
    private static function category(array $event): ?array
    {
        $category = is_array($event['category'] ?? null) ? $event['category'] : [];
        $id = self::nullableInt($event['category_id'] ?? $category['id'] ?? null);
        $name = \App\Services\Translation\TaxonomyNameLocalizer::nameFor('categories', $id, self::nullableString($event['category_name'] ?? $category['name'] ?? null));
        $slug = self::nullableString($event['category_slug'] ?? $category['slug'] ?? null);

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
     * @param array<string, mixed> $event
     * @return array{id: int|null, display_name: string|null}
     */
    private static function organiser(array $event): array
    {
        $user = is_array($event['user'] ?? null) ? $event['user'] : [];
        $name = self::nullableString($user['name'] ?? null);

        if ($name === null) {
            $organisationName = self::nullableString($user['organization_name'] ?? null);
            $profileType = self::nullableString($user['profile_type'] ?? null);
            $firstName = self::nullableString($user['first_name'] ?? null);
            $lastName = self::nullableString($user['last_name'] ?? null);
            $name = $profileType === 'organisation' && $organisationName
                ? $organisationName
                : trim((string) $firstName . ' ' . (string) $lastName);
        }

        return [
            'id' => self::nullableInt($user['id'] ?? $event['user_id'] ?? null),
            'display_name' => $name !== '' ? $name : null,
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

    private static function excerpt(string $description): string
    {
        $plain = trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags($description))) ?? '');

        if (mb_strlen($plain) <= 180) {
            return $plain;
        }

        return rtrim(mb_substr($plain, 0, 177)) . '...';
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
}
