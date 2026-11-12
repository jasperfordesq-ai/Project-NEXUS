<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\ApiErrorCodes;
use App\Support\SiteAnnouncementStyle;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Community announcement banner (Nov 2026).
 *
 * A community admin posts one-line notices (news, seasonal messages); the
 * member website shows the current one as a coloured banner across the top.
 * Rows live in `site_announcements`; the current one is published in the
 * tenant bootstrap as `announcement` (TenantBootstrapController).
 *
 * Every query here is scoped by tenant_id, so an id that belongs to another
 * community behaves exactly like an id that does not exist.
 *
 * Nothing in this class catches a database error: a wrong column or a missing
 * table must surface as a failure, never as "no announcement".
 */
class SiteAnnouncementService
{
    public const MAX_MESSAGE_LENGTH = 280;
    public const MAX_LINK_URL_LENGTH = 500;
    public const MAX_LINK_LABEL_LENGTH = 60;

    /** Same key TenantBootstrapController caches its payload under. */
    private const BOOTSTRAP_CACHE_KEY = 'tenant_bootstrap';

    public function __construct(
        private readonly RedisCache $redisCache,
    ) {
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    /**
     * Every announcement of one community, newest first.
     *
     * @return list<array<string, mixed>>
     */
    public function listForTenant(int $tenantId): array
    {
        $rows = DB::table('site_announcements')
            ->where('tenant_id', $tenantId)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();

        $items = [];
        foreach ($rows as $row) {
            $items[] = self::adminShape($row);
        }

        return $items;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{announcement: array<string, mixed>}|array{errors: list<array{code: string, message: string, field: string}>}
     */
    public function create(int $tenantId, int $userId, array $data): array
    {
        [$values, $errors] = self::validate($data, null);
        if ($errors !== []) {
            return ['errors' => $errors];
        }

        $now = now();
        $id = (int) DB::table('site_announcements')->insertGetId([
            'tenant_id' => $tenantId,
            'message' => $values['message'],
            'style' => $values['style'] ?? SiteAnnouncementStyle::DEFAULT,
            'link_url' => $values['link_url'] ?? null,
            'link_label' => $values['link_label'] ?? null,
            'starts_at' => $values['starts_at'] ?? null,
            'ends_at' => $values['ends_at'] ?? null,
            'is_dismissible' => $values['is_dismissible'] ?? 1,
            'is_active' => $values['is_active'] ?? 1,
            'created_by' => $userId > 0 ? $userId : null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $this->clearBootstrapCache($tenantId);

        return ['announcement' => self::adminShape($this->findRow($tenantId, $id))];
    }

    /**
     * Change the fields that are present in $data; leave the rest alone.
     *
     * @param  array<string, mixed>  $data
     * @return array{announcement: array<string, mixed>}|array{errors: list<array{code: string, message: string, field: string}>}|array{error: 'not_found'}
     */
    public function update(int $tenantId, int $id, array $data): array
    {
        $existing = $this->findRow($tenantId, $id);
        if ($existing === null) {
            return ['error' => 'not_found'];
        }

        [$values, $errors] = self::validate($data, $existing);
        if ($errors !== []) {
            return ['errors' => $errors];
        }

        if ($values !== []) {
            $values['updated_at'] = now();
            DB::table('site_announcements')
                ->where('tenant_id', $tenantId)
                ->where('id', $id)
                ->update($values);
        }

        $this->clearBootstrapCache($tenantId);

        return ['announcement' => self::adminShape($this->findRow($tenantId, $id))];
    }

    /** False when this community has no announcement with that id. */
    public function delete(int $tenantId, int $id): bool
    {
        $deleted = DB::table('site_announcements')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->delete();

        if ($deleted === 0) {
            return false;
        }

        $this->clearBootstrapCache($tenantId);

        return true;
    }

    // ------------------------------------------------------------------
    // Member website
    // ------------------------------------------------------------------

    /**
     * The one announcement this community's member website should show now, or
     * null. Switched on, started (or no start set) and not yet ended (or no end
     * set); when several qualify, the one that started most recently wins.
     *
     * Public payload: no author, no staff details.
     *
     * @return array{id: int, message: string, style: string, link_url: ?string, link_label: ?string, is_dismissible: bool, starts_at: ?string, ends_at: ?string, updated_at: ?string}|null
     */
    public function currentForTenant(int $tenantId): ?array
    {
        $now = now()->format('Y-m-d H:i:s');

        $row = DB::table('site_announcements')
            ->where('tenant_id', $tenantId)
            ->where('is_active', 1)
            ->where(function ($query) use ($now) {
                $query->whereNull('starts_at')->orWhere('starts_at', '<=', $now);
            })
            ->where(function ($query) use ($now) {
                $query->whereNull('ends_at')->orWhere('ends_at', '>', $now);
            })
            ->orderByRaw('COALESCE(starts_at, created_at) DESC')
            ->orderByDesc('id')
            ->first();

        if ($row === null) {
            return null;
        }

        // Checked again on the way out, so a row written some other way (an
        // import, a hand edit) still cannot put an unknown style or an unsafe
        // link on the page.
        $linkUrl = self::safeLink($row->link_url);

        return [
            'id' => (int) $row->id,
            'message' => (string) $row->message,
            'style' => SiteAnnouncementStyle::normalise($row->style) ?? SiteAnnouncementStyle::DEFAULT,
            'link_url' => $linkUrl,
            'link_label' => $linkUrl !== null && $row->link_label !== null && $row->link_label !== ''
                ? (string) $row->link_label
                : null,
            'is_dismissible' => (bool) $row->is_dismissible,
            'starts_at' => self::iso($row->starts_at),
            'ends_at' => self::iso($row->ends_at),
            'updated_at' => self::iso($row->updated_at),
        ];
    }

    /**
     * A link the banner may carry: an internal path that starts with a single
     * "/", or an https:// URL. Anything else — javascript:, data:, //host,
     * http://, a backslash, a control character or a space anywhere — is null.
     */
    public static function safeLink(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }

        $url = trim($value, ' ');
        if ($url === '' || !mb_check_encoding($url, 'UTF-8') || mb_strlen($url) > self::MAX_LINK_URL_LENGTH) {
            return null;
        }

        // Control and invisible characters, any kind of space, and backslashes
        // (browsers read "/\host" as "//host"). `!== 0` also refuses the value
        // if the pattern itself cannot run.
        if (preg_match('/[\p{C}\p{Z}\s\\\\]/u', $url) !== 0) {
            return null;
        }

        if ($url[0] === '/') {
            return str_starts_with($url, '//') ? null : $url;
        }

        if (!str_starts_with(strtolower($url), 'https://')) {
            return null;
        }

        $parts = parse_url($url);
        if (
            $parts === false
            || !isset($parts['host'])
            || $parts['host'] === ''
            // "https://trusted.example@evil.example/" shows one site and opens another.
            || isset($parts['user'])
            || isset($parts['pass'])
        ) {
            return null;
        }

        return $url;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private function findRow(int $tenantId, int $id): ?object
    {
        return DB::table('site_announcements')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();
    }

    /**
     * The bootstrap payload carries the current announcement, so every change
     * must drop that community's cached copy (same call AdminConfigController
     * makes after a settings change).
     */
    private function clearBootstrapCache(int $tenantId): void
    {
        $this->redisCache->delete(self::BOOTSTRAP_CACHE_KEY, $tenantId);
    }

    /**
     * Clean and check what an admin sent.
     *
     * With no $existing row this is a create: the message is required and
     * everything else falls back to its default. With one it is an update: only
     * the keys present in $data are checked and returned.
     *
     * @param  array<string, mixed>  $data
     * @return array{0: array<string, mixed>, 1: list<array{code: string, message: string, field: string}>}
     */
    private static function validate(array $data, ?object $existing): array
    {
        $values = [];
        $errors = [];
        $isCreate = $existing === null;

        // Message — plain text, one line, 1 to 280 characters.
        if ($isCreate || array_key_exists('message', $data)) {
            $message = self::plainText($data['message'] ?? null);
            if ($message === null || $message === '') {
                $errors[] = self::error(ApiErrorCodes::VALIDATION_REQUIRED_FIELD, 'message', __('api.site_announcement_message_required'));
            } elseif (mb_strlen($message) > self::MAX_MESSAGE_LENGTH) {
                $errors[] = self::error(
                    ApiErrorCodes::VALIDATION_TOO_LONG,
                    'message',
                    __('api.site_announcement_message_too_long', ['max' => self::MAX_MESSAGE_LENGTH])
                );
            } else {
                $values['message'] = $message;
            }
        }

        // Style — one of the allow-list. Null means "not sent".
        if (array_key_exists('style', $data) && $data['style'] !== null) {
            $style = SiteAnnouncementStyle::normalise($data['style']);
            if ($style === null) {
                $errors[] = self::error(ApiErrorCodes::VALIDATION_INVALID_VALUE, 'style', __('api.site_announcement_style_invalid'));
            } else {
                $values['style'] = $style;
            }
        }

        // Link — optional. Null or an empty string removes it.
        if (array_key_exists('link_url', $data)) {
            $raw = $data['link_url'];
            if ($raw === null || $raw === '') {
                $values['link_url'] = null;
            } else {
                $link = self::safeLink($raw);
                if ($link === null) {
                    $errors[] = self::error(ApiErrorCodes::VALIDATION_INVALID_FORMAT, 'link_url', __('api.site_announcement_link_url_invalid'));
                } else {
                    $values['link_url'] = $link;
                }
            }
        }

        // Link label — optional plain text.
        if (array_key_exists('link_label', $data)) {
            $label = self::plainText($data['link_label']);
            if ($label === null || mb_strlen($label) > self::MAX_LINK_LABEL_LENGTH) {
                $errors[] = self::error(
                    ApiErrorCodes::VALIDATION_INVALID_VALUE,
                    'link_label',
                    __('api.site_announcement_link_label_invalid', ['max' => self::MAX_LINK_LABEL_LENGTH])
                );
            } else {
                $values['link_label'] = $label === '' ? null : $label;
            }
        }

        // A label with no link has nothing to label.
        $finalLink = array_key_exists('link_url', $values) ? $values['link_url'] : ($existing->link_url ?? null);
        if ($finalLink === null && ($isCreate || array_key_exists('link_url', $values) || array_key_exists('link_label', $values))) {
            $values['link_label'] = null;
        }

        // Dates — optional. Null or an empty string removes one.
        $dateErrors = false;
        foreach (['starts_at', 'ends_at'] as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $raw = $data[$field];
            if ($raw === null || $raw === '') {
                $values[$field] = null;
                continue;
            }
            $parsed = self::parseDate($raw);
            if ($parsed === null) {
                $dateErrors = true;
                $errors[] = self::error(ApiErrorCodes::VALIDATION_INVALID_FORMAT, $field, __('api.site_announcement_date_invalid'));
            } else {
                $values[$field] = $parsed;
            }
        }

        // The end must come after the start — checked against the saved value
        // too, so an update that sends only one of the two cannot cross them.
        if (!$dateErrors && (array_key_exists('starts_at', $values) || array_key_exists('ends_at', $values))) {
            $startsAt = array_key_exists('starts_at', $values) ? $values['starts_at'] : ($existing->starts_at ?? null);
            $endsAt = array_key_exists('ends_at', $values) ? $values['ends_at'] : ($existing->ends_at ?? null);
            if ($startsAt !== null && $endsAt !== null && strcmp((string) $endsAt, (string) $startsAt) <= 0) {
                $errors[] = self::error(ApiErrorCodes::VALIDATION_INVALID_VALUE, 'ends_at', __('api.site_announcement_ends_before_starts'));
            }
        }

        // Switches. Null means "not sent".
        foreach (['is_dismissible', 'is_active'] as $field) {
            if (!array_key_exists($field, $data) || $data[$field] === null) {
                continue;
            }
            $flag = self::toBool($data[$field]);
            if ($flag === null) {
                $errors[] = self::error(ApiErrorCodes::VALIDATION_INVALID_VALUE, $field, __('api.site_announcement_flag_invalid'));
            } else {
                $values[$field] = $flag ? 1 : 0;
            }
        }

        return [$values, $errors];
    }

    /**
     * One line of plain text: tags removed (script and style blocks go with
     * their contents), every run of whitespace or control characters collapsed
     * to a single space, trimmed. Null when the value is not text at all.
     */
    private static function plainText(mixed $value): ?string
    {
        if ($value === null) {
            return '';
        }
        if (is_int($value) || is_float($value)) {
            $value = (string) $value;
        }
        if (!is_string($value) || !mb_check_encoding($value, 'UTF-8')) {
            return null;
        }

        $text = preg_replace('#<(script|style)\b[^>]*>.*?</\1\s*>#is', ' ', $value) ?? $value;
        $text = strip_tags($text);
        // \p{Cc} only: the wider \p{C} would also remove the joiners that emoji
        // and Arabic script rely on.
        $text = preg_replace('/[\p{Cc}\s]+/u', ' ', $text) ?? '';

        return trim($text);
    }

    /**
     * "2026-12-24", "2026-12-24T18:00", "2026-12-24 18:00:00", with an optional
     * Z or +01:00 offset. Returned as a 'Y-m-d H:i:s' string in the application
     * timezone (UTC); a value without an offset is read as that timezone.
     */
    private static function parseDate(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $value = trim($value);

        $pattern = '/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?)?(Z|[+-]\d{2}:?\d{2})?$/';
        if (preg_match($pattern, $value, $m) !== 1) {
            return null;
        }

        $year = (int) $m[1];
        if ($year < 1970 || !checkdate((int) $m[2], (int) $m[3], $year)) {
            return null;
        }
        if ((int) ($m[4] ?? 0) > 23 || (int) ($m[5] ?? 0) > 59 || (int) ($m[6] ?? 0) > 59) {
            return null;
        }

        $timezone = (string) config('app.timezone', 'UTC');

        return Carbon::parse($value, $timezone)->setTimezone($timezone)->format('Y-m-d H:i:s');
    }

    private static function toBool(mixed $value): ?bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return match ($value) {
                1 => true,
                0 => false,
                default => null,
            };
        }
        if (is_string($value) && $value !== '') {
            return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        }

        return null;
    }

    private static function iso(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return Carbon::parse((string) $value, (string) config('app.timezone', 'UTC'))->toIso8601String();
    }

    /** @return array{code: string, message: string, field: string} */
    private static function error(string $code, string $field, string $message): array
    {
        return ['code' => $code, 'message' => $message, 'field' => $field];
    }

    /**
     * What the admin screen gets: the row as saved.
     *
     * @return array<string, mixed>
     */
    private static function adminShape(?object $row): array
    {
        if ($row === null) {
            // Only reachable if the row vanished between the write and the read.
            throw new \RuntimeException('site_announcements row disappeared after it was written.');
        }

        return [
            'id' => (int) $row->id,
            'message' => (string) $row->message,
            'style' => (string) $row->style,
            'link_url' => $row->link_url !== null ? (string) $row->link_url : null,
            'link_label' => $row->link_label !== null ? (string) $row->link_label : null,
            'starts_at' => self::iso($row->starts_at),
            'ends_at' => self::iso($row->ends_at),
            'is_dismissible' => (bool) $row->is_dismissible,
            'is_active' => (bool) $row->is_active,
            'created_by' => $row->created_by !== null ? (int) $row->created_by : null,
            'created_at' => self::iso($row->created_at),
            'updated_at' => self::iso($row->updated_at),
        ];
    }
}
