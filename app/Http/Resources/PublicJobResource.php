<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Resources;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Support\Carbon;
use App\Support\UserDisplayName;

final class PublicJobResource
{
    /**
     * @param array<string, mixed> $job
     * @return array<string, mixed>
     */
    public static function augment(array $job): array
    {
        if (!self::shouldIncludePublicContract()) {
            return $job;
        }

        $job['public_contract'] = self::fromArray($job);

        return $job;
    }

    /**
     * @param array<string, mixed> $job
     * @return array<string, mixed>
     */
    public static function fromArray(array $job): array
    {
        $id = self::nullableInt($job['id'] ?? null) ?? 0;
        $title = self::stringValue($job['title'] ?? '');
        $description = self::stringValue($job['description'] ?? '');
        $employer = self::employer($job);
        $gallery = self::gallery($job, $title);

        return [
            'id' => $id,
            'slug' => self::stringValue($job['slug'] ?? $id),
            'title' => $title,
            'description' => $description,
            'excerpt' => self::excerpt(self::nullableString($job['tagline'] ?? null) ?? $description),
            'primary_image' => self::primaryImage($job, $title, $employer, $gallery),
            'gallery' => $gallery,
            'category' => self::category($job),
            'location' => [
                'label' => self::nullableString($job['location'] ?? null),
                'latitude' => self::nullableFloat($job['latitude'] ?? null),
                'longitude' => self::nullableFloat($job['longitude'] ?? null),
                'is_remote' => self::boolValue($job['is_remote'] ?? false),
            ],
            'employer' => $employer,
            'job_type' => self::nullableString($job['type'] ?? null),
            'commitment' => self::nullableString($job['commitment'] ?? null),
            'skills' => self::skills($job['skills'] ?? $job['skills_required'] ?? null),
            'compensation' => [
                'salary_min' => self::nullableFloat($job['salary_min'] ?? null),
                'salary_max' => self::nullableFloat($job['salary_max'] ?? null),
                'salary_currency' => self::nullableString($job['salary_currency'] ?? null),
                'salary_type' => self::nullableString($job['salary_type'] ?? null),
                'salary_negotiable' => self::boolValue($job['salary_negotiable'] ?? false),
                'time_credits' => self::nullableFloat($job['time_credits'] ?? null),
                'hours_per_week' => self::nullableFloat($job['hours_per_week'] ?? null),
            ],
            'deadline_at' => self::dateString($job['deadline'] ?? null),
            'created_at' => self::dateString($job['created_at'] ?? null),
            'updated_at' => self::dateString($job['updated_at'] ?? null),
            'status' => self::nullableString($job['status'] ?? null) ?? 'open',
        ];
    }

    /**
     * @param array<string, mixed> $job
     * @return array{id: int|null, display_name: string|null, logo_url: string|null}
     */
    private static function employer(array $job): array
    {
        $organization = is_array($job['organization'] ?? null) ? $job['organization'] : [];
        $creator = is_array($job['creator'] ?? null) ? $job['creator'] : [];
        $organizationName = self::nullableString($organization['name'] ?? $job['organization_name'] ?? null);
        $creatorName = self::nullableString($creator['name'] ?? null);

        if ($creatorName === null && self::nullableInt($job['user_id'] ?? null) !== null) {
            $user = User::where('tenant_id', TenantContext::getId())
                ->where('id', (int) $job['user_id'])
                ->first(['id', 'first_name', 'last_name', 'organization_name', 'profile_type', 'avatar_url']);

            if ($user) {
                $profileType = self::nullableString($user->profile_type ?? null);
                $organizationProfileName = self::nullableString($user->organization_name ?? null);
                $creatorName = $profileType === 'organisation' && $organizationProfileName
                    ? $organizationProfileName
                    : UserDisplayName::resolve($user);
                $creator['avatar_url'] = $user->avatar_url;
            }
        }

        return [
            'id' => self::nullableInt($organization['id'] ?? $job['organization_id'] ?? $creator['id'] ?? $job['user_id'] ?? null),
            'display_name' => $organizationName ?? $creatorName,
            'logo_url' => self::nullableString($organization['logo_url'] ?? $job['organization_logo'] ?? $creator['avatar_url'] ?? null),
        ];
    }

    /**
     * @param array<string, mixed> $job
     * @param array{id: int|null, display_name: string|null, logo_url: string|null} $employer
     * @param array<int, array{url: string, alt_text: string, sort_order: int}> $gallery
     * @return array{url: string, alt_text: string}|null
     */
    private static function primaryImage(array $job, string $title, array $employer, array $gallery): ?array
    {
        $url = self::nullableString($employer['logo_url'] ?? null);

        if ($url === null && isset($gallery[0])) {
            $url = $gallery[0]['url'];
        }

        if ($url === null) {
            return null;
        }

        return [
            'url' => $url,
            'alt_text' => self::nullableString($employer['display_name'] ?? null) ?? $title,
        ];
    }

    /**
     * @param array<string, mixed> $job
     * @return array<int, array{url: string, alt_text: string, sort_order: int}>
     */
    private static function gallery(array $job, string $title): array
    {
        $photos = self::arrayValue($job['culture_photos'] ?? null);
        $gallery = [];

        foreach ($photos as $index => $photo) {
            $url = is_array($photo) ? self::nullableString($photo['url'] ?? null) : self::nullableString($photo);
            if ($url === null) {
                continue;
            }

            $gallery[] = [
                'url' => $url,
                'alt_text' => is_array($photo)
                    ? (self::nullableString($photo['alt_text'] ?? $photo['altText'] ?? null) ?? $title)
                    : $title,
                'sort_order' => $index,
            ];
        }

        return $gallery;
    }

    /**
     * @param array<string, mixed> $job
     * @return array{name: string|null, slug: string|null}|null
     */
    private static function category(array $job): ?array
    {
        $name = self::nullableString($job['category'] ?? null);

        if ($name === null) {
            return null;
        }

        return [
            'name' => $name,
            'slug' => self::slug($name),
        ];
    }

    /**
     * @return array<int, string>
     */
    private static function skills(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_filter(array_map(
                static fn ($skill): string => trim((string) $skill),
                $value
            )));
        }

        if ($value === null || $value === '') {
            return [];
        }

        return array_values(array_filter(array_map('trim', explode(',', (string) $value))));
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
        if (is_array($value)) {
            return array_values($value);
        }

        if (is_string($value) && $value !== '') {
            $decoded = json_decode($value, true);

            return is_array($decoded) ? array_values($decoded) : [];
        }

        return [];
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

    private static function slug(string $value): string
    {
        $slug = strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', $value) ?? '', '-'));

        return $slug !== '' ? $slug : $value;
    }
}
