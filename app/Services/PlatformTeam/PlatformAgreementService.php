<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Core\ApiErrorCodes;
use App\Core\ClientIp;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Agreements and renewals (Nov 2026, idea 30).
 *
 * The platform team keeps the agreements the platform has with communities
 * and others: what, with whom, when it started, renews and ends, and who to
 * talk to. The list is ordered by the next renewal, and an agreement renewing
 * within RENEWAL_WARNING_DAYS days (or whose renewal date has passed) is
 * marked. The home page card is the reminder: no email is sent.
 *
 * 🔴 PLATFORM-GLOBAL on purpose: `platform_agreements` has no `tenant_id`.
 * `community_id` is a pointer only (no foreign key); a community that has
 * since been removed comes back as `{id, name: null}`. Who may do what is
 * decided in PlatformAgreementsController: the platform team only.
 *
 * 🔴 Nothing is filled in that the platform team did not type. An empty field
 * is stored as NULL and sent as null; no date is ever worked out from another.
 *
 * 🔴 The contact's name and email are personal details of someone outside the
 * platform. They are stored as typed and sent to this page only. They are
 * never written to `activity_log` (that row holds the agreement id and the
 * action) and never logged.
 *
 * No delete: an agreement entered by mistake is ended. Ending keeps the row,
 * and in this version an ended agreement cannot be brought back.
 */
final class PlatformAgreementService
{
    public const RENEWAL_WARNING_DAYS = 60;

    public const MAX_NAME = 160;

    public const MAX_EMAIL = 255;

    public const MAX_NOTES = 5000;

    /** The fields a request may set. Anything else in a request is ignored, never saved. */
    private const FIELDS = [
        'community_id', 'title', 'with_whom', 'starts_on', 'renews_on', 'ends_on',
        'contact_name', 'contact_email', 'notes',
    ];

    private const DATES = ['starts_on', 'renews_on', 'ends_on'];

    /**
     * @return array{agreements: list<array<string, mixed>>, ended: list<array<string, mixed>>, communities: list<array{id: int, name: string}>, renewal_warning_days: int}
     */
    public function overview(): array
    {
        $names = $this->communityNames();
        $rows = DB::table('platform_agreements')->get();

        $open = [];
        $ended = [];
        foreach ($rows as $row) {
            if ((int) $row->is_ended === 1) {
                $ended[] = $row;
            } else {
                $open[] = $row;
            }
        }

        // Next renewal first; those with no renewal date last; then by title.
        usort($open, static function (object $a, object $b): int {
            $aDate = $a->renews_on !== null ? (string) $a->renews_on : null;
            $bDate = $b->renews_on !== null ? (string) $b->renews_on : null;
            if ($aDate !== $bDate) {
                if ($aDate === null) {
                    return 1;
                }
                if ($bDate === null) {
                    return -1;
                }

                return strcmp($aDate, $bDate);
            }

            return strcasecmp((string) $a->title, (string) $b->title) ?: ((int) $a->id <=> (int) $b->id);
        });
        // The most recently changed first.
        usort($ended, static fn (object $a, object $b): int => strcmp((string) $b->updated_at, (string) $a->updated_at) ?: ((int) $b->id <=> (int) $a->id));

        $communities = [];
        foreach ($names as $id => $name) {
            $communities[] = ['id' => $id, 'name' => $name];
        }
        usort($communities, static fn (array $a, array $b): int => strcasecmp($a['name'], $b['name']));

        return [
            'agreements' => array_map(fn (object $row): array => $this->shape($row, $names), $open),
            'ended' => array_map(fn (object $row): array => $this->shape($row, $names), $ended),
            'communities' => $communities,
            'renewal_warning_days' => self::RENEWAL_WARNING_DAYS,
        ];
    }

    /**
     * For the home page card: agreements not ended, and how many of them renew
     * within RENEWAL_WARNING_DAYS days or have a renewal date that has passed.
     * Throws when the table cannot be read (the card then says "unknown").
     *
     * @return array{entered: int, renewing_soon: int}
     */
    public function renewalStatus(): array
    {
        $entered = (int) DB::table('platform_agreements')->where('is_ended', 0)->count();
        $renewingSoon = (int) DB::table('platform_agreements')
            ->where('is_ended', 0)
            ->whereNotNull('renews_on')
            ->where('renews_on', '<=', self::today()->addDays(self::RENEWAL_WARNING_DAYS)->toDateString())
            ->count();

        return ['entered' => $entered, 'renewing_soon' => $renewingSoon];
    }

    /**
     * @param array<string, mixed> $data
     * @return array{agreement: array<string, mixed>}|array{errors: list<array{code: string, message: string, field: string}>}
     */
    public function create(int $userId, array $data): array
    {
        [$values, $errors] = $this->validate($data, null);
        if ($errors !== []) {
            return ['errors' => $errors];
        }

        $now = now();
        $row = ['is_ended' => 0, 'created_by' => $userId > 0 ? $userId : null, 'updated_by' => $userId > 0 ? $userId : null, 'created_at' => $now, 'updated_at' => $now];
        foreach (self::FIELDS as $field) {
            $row[$field] = $values[$field] ?? null;
        }
        $id = (int) DB::table('platform_agreements')->insertGetId($row);

        $this->record($userId, 'platform_agreement_created', $id);

        return ['agreement' => $this->one($id)];
    }

    /**
     * Change the fields that are present in $data; leave the rest alone.
     * 🔴 Never `is_ended`: an agreement is ended by end() and stays ended.
     *
     * @param array<string, mixed> $data
     * @return array{agreement: array<string, mixed>}|array{errors: list<array{code: string, message: string, field: string}>}|array{error: 'not_found'}
     */
    public function update(int $id, int $userId, array $data): array
    {
        $existing = DB::table('platform_agreements')->where('id', $id)->first();
        if ($existing === null) {
            return ['error' => 'not_found'];
        }

        [$values, $errors] = $this->validate($data, $existing);
        if ($errors !== []) {
            return ['errors' => $errors];
        }

        if ($values !== []) {
            $values['updated_by'] = $userId > 0 ? $userId : null;
            $values['updated_at'] = now();
            DB::table('platform_agreements')->where('id', $id)->update($values);
            $this->record($userId, 'platform_agreement_changed', $id);
        }

        return ['agreement' => $this->one($id)];
    }

    /**
     * Mark an agreement ended. The row is kept. Ending one that has already
     * ended changes nothing and writes no second record.
     *
     * @return array{agreement: array<string, mixed>}|array{error: 'not_found'}
     */
    public function end(int $id, int $userId): array
    {
        $existing = DB::table('platform_agreements')->where('id', $id)->first();
        if ($existing === null) {
            return ['error' => 'not_found'];
        }

        if ((int) $existing->is_ended !== 1) {
            DB::table('platform_agreements')->where('id', $id)->update([
                'is_ended' => 1,
                'updated_by' => $userId > 0 ? $userId : null,
                'updated_at' => now(),
            ]);
            $this->record($userId, 'platform_agreement_ended', $id);
        }

        return ['agreement' => $this->one($id)];
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /**
     * Only the fields in FIELDS that are present in $data are looked at. A
     * missing field is left alone on a change, and empty on a new agreement.
     * Dates are compared with what is already stored for the fields not sent.
     *
     * @param array<string, mixed> $data
     * @return array{0: array<string, mixed>, 1: list<array{code: string, message: string, field: string}>}
     */
    private function validate(array $data, ?object $existing): array
    {
        $values = [];
        $errors = [];
        $error = static function (string $field, string $code, string $key) use (&$errors): void {
            $errors[] = ['code' => $code, 'message' => __('api.' . $key), 'field' => $field];
        };

        foreach (['title' => 'platform_agreement_title_required', 'with_whom' => 'platform_agreement_with_whom_required'] as $field => $key) {
            if ($existing !== null && !array_key_exists($field, $data)) {
                continue;
            }
            $text = self::text($data[$field] ?? null);
            if ($text === false || $text === null || mb_strlen($text) > self::MAX_NAME) {
                $error($field, ApiErrorCodes::VALIDATION_REQUIRED_FIELD, $key);
                continue;
            }
            $values[$field] = $text;
        }

        foreach (self::DATES as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $date = self::date($data[$field]);
            if ($date === false) {
                $error($field, ApiErrorCodes::VALIDATION_INVALID_FORMAT, 'platform_agreement_date_invalid');
                continue;
            }
            $values[$field] = $date;
        }

        $dateErrors = array_column($errors, 'field');
        $merged = static function (string $field) use ($values, $existing): ?string {
            if (array_key_exists($field, $values)) {
                return $values[$field];
            }

            return $existing !== null && $existing->{$field} !== null ? substr((string) $existing->{$field}, 0, 10) : null;
        };
        $starts = in_array('starts_on', $dateErrors, true) ? null : $merged('starts_on');
        if ($starts !== null) {
            $ends = in_array('ends_on', $dateErrors, true) ? null : $merged('ends_on');
            if ($ends !== null && strcmp($ends, $starts) < 0) {
                $error('ends_on', ApiErrorCodes::VALIDATION_INVALID_VALUE, 'platform_agreement_ends_before_start');
                unset($values['ends_on']);
            }
            $renews = in_array('renews_on', $dateErrors, true) ? null : $merged('renews_on');
            if ($renews !== null && strcmp($renews, $starts) < 0) {
                $error('renews_on', ApiErrorCodes::VALIDATION_INVALID_VALUE, 'platform_agreement_renews_before_start');
                unset($values['renews_on']);
            }
        }

        if (array_key_exists('contact_name', $data)) {
            $text = self::text($data['contact_name']);
            if ($text === false || ($text !== null && mb_strlen($text) > self::MAX_NAME)) {
                $error('contact_name', ApiErrorCodes::VALIDATION_TOO_LONG, 'platform_agreement_contact_name_too_long');
            } else {
                $values['contact_name'] = $text;
            }
        }

        if (array_key_exists('contact_email', $data)) {
            $text = self::text($data['contact_email']);
            if ($text === false || ($text !== null && (mb_strlen($text) > self::MAX_EMAIL || filter_var($text, FILTER_VALIDATE_EMAIL) === false))) {
                $error('contact_email', ApiErrorCodes::VALIDATION_INVALID_FORMAT, 'platform_agreement_email_invalid');
            } else {
                $values['contact_email'] = $text;
            }
        }

        if (array_key_exists('notes', $data)) {
            $text = self::text($data['notes']);
            if ($text === false || ($text !== null && mb_strlen($text) > self::MAX_NOTES)) {
                $error('notes', ApiErrorCodes::VALIDATION_TOO_LONG, 'platform_agreement_notes_too_long');
            } else {
                $values['notes'] = $text;
            }
        }

        if (array_key_exists('community_id', $data)) {
            $raw = $data['community_id'];
            if ($raw === null || $raw === '') {
                $values['community_id'] = null;
            } elseif ((is_int($raw) || (is_string($raw) && ctype_digit($raw))) && (int) $raw > 0
                && DB::table('tenants')->where('id', (int) $raw)->exists()) {
                $values['community_id'] = (int) $raw;
            } else {
                $error('community_id', ApiErrorCodes::VALIDATION_INVALID_VALUE, 'platform_agreement_community_unknown');
            }
        }

        return [$values, $errors];
    }

    /** Trimmed text; null when empty; false when it is not text at all. */
    private static function text(mixed $value): string|null|false
    {
        if ($value === null) {
            return null;
        }
        if (!is_string($value)) {
            return false;
        }
        $value = trim($value);

        return $value === '' ? null : $value;
    }

    /** A real YYYY-MM-DD date; null when empty; false when it is not one. */
    private static function date(mixed $value): string|null|false
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (!is_string($value) || preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) !== 1) {
            return false;
        }

        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? $value : false;
    }

    private static function today(): Carbon
    {
        return Carbon::today((string) config('app.timezone', 'UTC'));
    }

    /** @return array<int, string> every community's name, by id */
    private function communityNames(): array
    {
        $names = [];
        foreach (DB::table('tenants')->get(['id', 'name']) as $tenant) {
            $names[(int) $tenant->id] = (string) $tenant->name;
        }

        return $names;
    }

    /** @return array<string, mixed> */
    private function one(int $id): array
    {
        $row = DB::table('platform_agreements')->where('id', $id)->first();
        if ($row === null) {
            // Only reachable if the row vanished between the write and the read.
            throw new \RuntimeException('platform_agreements row disappeared after it was written.');
        }

        $names = [];
        if ($row->community_id !== null) {
            $name = DB::table('tenants')->where('id', (int) $row->community_id)->value('name');
            if ($name !== null) {
                $names[(int) $row->community_id] = (string) $name;
            }
        }

        return $this->shape($row, $names);
    }

    /**
     * Exactly what the page shows.
     *
     * @param array<int, string> $names
     * @return array<string, mixed>
     */
    private function shape(object $row, array $names): array
    {
        $isEnded = (int) $row->is_ended === 1;
        $renewsOn = self::day($row->renews_on);
        $days = $renewsOn !== null
            ? (int) self::today()->diffInDays(Carbon::parse($renewsOn, (string) config('app.timezone', 'UTC'))->startOfDay(), false)
            : null;

        $community = null;
        if ($row->community_id !== null) {
            $id = (int) $row->community_id;
            // A community removed since keeps its id here; the page says it no longer exists.
            $community = ['id' => $id, 'name' => $names[$id] ?? null];
        }

        return [
            'id' => (int) $row->id,
            'community' => $community,
            'title' => (string) $row->title,
            'with_whom' => (string) $row->with_whom,
            'starts_on' => self::day($row->starts_on),
            'renews_on' => $renewsOn,
            'ends_on' => self::day($row->ends_on),
            'contact_name' => $row->contact_name !== null ? (string) $row->contact_name : null,
            'contact_email' => $row->contact_email !== null ? (string) $row->contact_email : null,
            'notes' => $row->notes !== null ? (string) $row->notes : null,
            'is_ended' => $isEnded,
            'days_to_renewal' => $days,
            'renews_soon' => !$isEnded && $days !== null && $days <= self::RENEWAL_WARNING_DAYS,
            'updated_at' => $row->updated_at !== null
                ? Carbon::parse((string) $row->updated_at, (string) config('app.timezone', 'UTC'))->toIso8601String()
                : null,
        ];
    }

    private static function day(mixed $value): ?string
    {
        return $value === null || $value === '' ? null : substr((string) $value, 0, 10);
    }

    /**
     * The second record of a write (the first is on the row). A failure to
     * write it must not undo the agreement, but it must be seen: logged at
     * error, with the agreement id only.
     */
    private function record(int $userId, string $action, int $agreementId): void
    {
        try {
            // Not ActivityLog::log(): that stamps the writer's community. An
            // agreement belongs to the platform, so tenant_id is NULL. The
            // details name the agreement, never who it is with or the contact.
            DB::table('activity_log')->insert([
                'tenant_id' => null,
                'user_id' => $userId > 0 ? $userId : null,
                'action' => $action,
                'details' => "Platform agreement #{$agreementId}",
                'is_public' => 0,
                'ip_address' => ClientIp::get(),
                'action_type' => 'admin',
                'entity_type' => 'platform_agreement',
                'entity_id' => $agreementId,
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::error('Platform agreement: the activity log entry could not be written', [
                'action' => $action,
                'agreement_id' => $agreementId,
                'user_id' => $userId,
                'exception' => $e::class,
            ]);
        }
    }
}
