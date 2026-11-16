<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Core\ApiErrorCodes;
use App\Core\ClientIp;
use App\Services\SiteAnnouncementService;
use App\Support\Names\NameReason;
use App\Support\UserDisplayName;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform-wide notices (Nov 2026).
 *
 * The platform team writes a short notice once; every community's admins see
 * it as a band at the top of the admin panel. Members never see one, and
 * neither do brokers (owner, 16 Nov 2026: it is for admins).
 *
 * 🔴 PLATFORM-GLOBAL on purpose: `platform_notices` and
 * `platform_notice_dismissals` have no `tenant_id`. A notice is for every
 * community at once. Who may do what is decided in the controllers:
 *   - write, change, end, list everything: the platform team only;
 *   - read what is live, close one: anyone who passes `requireAdmin()`.
 *
 * 🔴 An admin is sent only what the band shows (currentFor()). Who on the
 * platform team wrote a notice, and how many people closed it, go to the
 * platform team's list alone.
 *
 * The text rules are the community announcement banner's own
 * (SiteAnnouncementService::validateFields()): plain text, one line, 280
 * characters; a link needs words to click. One rule is stricter here: the
 * link must be a full `https://` address. "A page on this site" means nothing
 * for a notice shown inside every community.
 *
 * One text, as written (owner, 16 Nov 2026): a notice is not translated.
 *
 * Every write is recorded twice: on the row (`created_by`, `updated_by`,
 * `ended_by`, `ended_at`) and in `activity_log` with the acting account.
 * 🔴 The activity log row is written with NO community (`tenant_id` NULL): a
 * platform notice belongs to none, and filed under the writer's current
 * community it would be readable by that community's admins.
 *
 * 🔴 Changing what a notice SAYS (its words, kind or link) forgets who closed
 * it, so everyone is shown it again (owner, 16 Nov 2026). Changing only when
 * it shows, or whether it can be closed, does not.
 */
final class PlatformNoticeService
{
    /** @var list<string> */
    public const KINDS = ['info', 'planned_work', 'important'];

    public const DEFAULT_KIND = 'info';

    /** The most notices an admin is shown at once, newest first. */
    public const MAX_SHOWN = 3;

    /** The platform team's list: newest first, this many. */
    public const LIST_LIMIT = 100;

    /** The fields that are what a notice says. A change to any of them is shown again to people who closed it. */
    private const SAYS = ['message', 'kind', 'link_url', 'link_label'];

    // ------------------------------------------------------------------
    // The platform team
    // ------------------------------------------------------------------

    /** @return list<array<string, mixed>> */
    public function listAll(): array
    {
        $rows = DB::table('platform_notices as n')
            ->leftJoin('users as u', 'u.id', '=', 'n.created_by')
            ->orderByDesc('n.created_at')
            ->orderByDesc('n.id')
            ->limit(self::LIST_LIMIT)
            ->get(['n.*', DB::raw(UserDisplayName::sqlFull('u', 'written_by', NameReason::ADMIN_ROUTE))]);

        $closed = DB::table('platform_notice_dismissals')
            ->whereIn('notice_id', $rows->pluck('id')->all() ?: [0])
            ->groupBy('notice_id')
            ->selectRaw('notice_id, COUNT(*) AS c')
            ->pluck('c', 'notice_id');

        return $rows
            ->map(static fn (object $row): array => self::teamShape($row, (int) ($closed[$row->id] ?? 0)))
            ->all();
    }

    /**
     * @param array<string, mixed> $data
     * @return array{notice: array<string, mixed>}|array{errors: list<array{code: string, message: string, field: string}>}
     */
    public function create(int $userId, array $data): array
    {
        [$values, $errors] = self::validate($data, null);
        if ($errors !== []) {
            return ['errors' => $errors];
        }

        $now = now();
        $id = (int) DB::table('platform_notices')->insertGetId([
            'message' => $values['message'],
            'kind' => $values['kind'] ?? self::DEFAULT_KIND,
            'link_url' => $values['link_url'] ?? null,
            'link_label' => $values['link_label'] ?? null,
            'starts_at' => $values['starts_at'] ?? null,
            'ends_at' => $values['ends_at'] ?? null,
            'is_dismissible' => $values['is_dismissible'] ?? 1,
            'is_active' => 1,
            'created_by' => $userId > 0 ? $userId : null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $this->record($userId, 'platform_notice_created', $id);

        return ['notice' => $this->teamNotice($id)];
    }

    /**
     * Change the fields that are present in $data; leave the rest alone.
     * 🔴 Never `is_active`: a notice is ended by end() and stays ended.
     *
     * @param array<string, mixed> $data
     * @return array{notice: array<string, mixed>}|array{errors: list<array{code: string, message: string, field: string}>}|array{error: 'not_found'}
     */
    public function update(int $id, int $userId, array $data): array
    {
        $existing = DB::table('platform_notices')->where('id', $id)->first();
        if ($existing === null) {
            return ['error' => 'not_found'];
        }

        [$values, $errors] = self::validate($data, $existing);
        if ($errors !== []) {
            return ['errors' => $errors];
        }

        if ($values !== []) {
            $saysSomethingNew = false;
            foreach (self::SAYS as $field) {
                if (array_key_exists($field, $values) && (string) ($values[$field] ?? '') !== (string) ($existing->{$field} ?? '')) {
                    $saysSomethingNew = true;
                    break;
                }
            }

            $values['updated_by'] = $userId > 0 ? $userId : null;
            $values['updated_at'] = now();
            // One transaction: a changed notice with its old "closed by" rows
            // still in place would stay hidden from exactly the people who
            // most need to see the change.
            DB::transaction(static function () use ($id, $values, $saysSomethingNew): void {
                DB::table('platform_notices')->where('id', $id)->update($values);
                if ($saysSomethingNew) {
                    DB::table('platform_notice_dismissals')->where('notice_id', $id)->delete();
                }
            });
            $this->record($userId, 'platform_notice_changed', $id);
        }

        return ['notice' => $this->teamNotice($id)];
    }

    /**
     * Take a notice away from every admin now. Ending one that has already
     * ended changes nothing and keeps the first record of who ended it.
     *
     * @return array{notice: array<string, mixed>}|array{error: 'not_found'}
     */
    public function end(int $id, int $userId): array
    {
        $existing = DB::table('platform_notices')->where('id', $id)->first();
        if ($existing === null) {
            return ['error' => 'not_found'];
        }

        if (!empty($existing->is_active)) {
            $now = now();
            DB::table('platform_notices')->where('id', $id)->update([
                'is_active' => 0,
                'ended_by' => $userId > 0 ? $userId : null,
                'ended_at' => $now,
                'updated_at' => $now,
            ]);
            $this->record($userId, 'platform_notice_ended', $id);
        }

        return ['notice' => $this->teamNotice($id)];
    }

    // ------------------------------------------------------------------
    // Admins
    // ------------------------------------------------------------------

    /**
     * The notices this person should be shown now: live, not closed by them,
     * newest first, MAX_SHOWN at most. Only what the band shows.
     *
     * @return list<array<string, mixed>>
     */
    public function currentFor(int $userId): array
    {
        $now = now();

        return DB::table('platform_notices as n')
            ->where('n.is_active', 1)
            ->where(static fn ($q) => $q->whereNull('n.starts_at')->orWhere('n.starts_at', '<=', $now))
            ->where(static fn ($q) => $q->whereNull('n.ends_at')->orWhere('n.ends_at', '>', $now))
            ->whereNotExists(static function ($q) use ($userId): void {
                $q->selectRaw('1')
                    ->from('platform_notice_dismissals as d')
                    ->whereColumn('d.notice_id', 'n.id')
                    ->where('d.user_id', $userId);
            })
            ->orderByDesc('n.created_at')
            ->orderByDesc('n.id')
            ->limit(self::MAX_SHOWN)
            ->get(['n.id', 'n.message', 'n.kind', 'n.link_url', 'n.link_label', 'n.is_dismissible'])
            ->map(static function (object $row): array {
                // Checked again on the way out: a row written by hand must not
                // put a link the band would refuse in front of an admin.
                $link = self::httpsLink($row->link_url);
                $label = $link !== null && is_string($row->link_label) && trim($row->link_label) !== ''
                    ? (string) $row->link_label
                    : null;

                return [
                    'id' => (int) $row->id,
                    'message' => (string) $row->message,
                    'kind' => in_array($row->kind, self::KINDS, true) ? (string) $row->kind : self::DEFAULT_KIND,
                    'link_url' => $label !== null ? $link : null,
                    'link_label' => $label,
                    'is_dismissible' => (bool) $row->is_dismissible,
                ];
            })
            ->all();
    }

    /**
     * Close a notice for one person. Closing it twice is fine.
     *
     * Only a notice that is showing can be closed:
     *   - not started yet: the person has not been shown it, so for them it
     *     does not exist ('not_found'); it cannot be closed in advance;
     *   - already over (ended early, or past its end time): the band may
     *     still be drawing it for up to a minute, so this is not an error,
     *     and there is nothing to record ('ok', no row).
     *
     * @return 'ok'|'not_found'|'not_dismissible'
     */
    public function dismiss(int $id, int $userId): string
    {
        $notice = DB::table('platform_notices')
            ->where('id', $id)
            ->first(['id', 'is_dismissible', 'is_active', 'starts_at', 'ends_at']);
        if ($notice === null) {
            return 'not_found';
        }
        $state = self::state($notice);
        if ($state === 'scheduled') {
            return 'not_found';
        }
        if ($state !== 'live') {
            return 'ok';
        }
        if (empty($notice->is_dismissible)) {
            return 'not_dismissible';
        }

        DB::table('platform_notice_dismissals')->insertOrIgnore([
            'notice_id' => $id,
            'user_id' => $userId,
            'dismissed_at' => now(),
        ]);

        return 'ok';
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /**
     * The banner's own rules, with this table's column name for the kind and
     * the stricter link rule.
     *
     * @param array<string, mixed> $data
     * @return array{0: array<string, mixed>, 1: list<array{code: string, message: string, field: string}>}
     */
    private static function validate(array $data, ?object $existing): array
    {
        // `is_active` is never taken from a request (see update()).
        unset($data['is_active'], $data['style']);
        if (array_key_exists('kind', $data)) {
            $data['style'] = $data['kind'];
            unset($data['kind']);
        }

        [$values, $errors] = SiteAnnouncementService::validateFields($data, $existing, self::KINDS);

        if (array_key_exists('style', $values)) {
            $values['kind'] = $values['style'];
            unset($values['style']);
        }
        $errors = array_map(static function (array $error): array {
            if ($error['field'] === 'style') {
                $error['field'] = 'kind';
            }

            return $error;
        }, $errors);

        if (isset($values['link_url']) && self::httpsLink($values['link_url']) === null
            && !in_array('link_url', array_column($errors, 'field'), true)) {
            unset($values['link_url']);
            $errors[] = [
                'code' => ApiErrorCodes::VALIDATION_INVALID_FORMAT,
                'message' => __('api.platform_notice_link_must_be_https'),
                'field' => 'link_url',
            ];
        }

        // The shared check words a bad link as the community banner's rule
        // ("a page on this site, or https://"). For a notice only https is
        // allowed, so say that, whichever check refused it.
        $errors = array_map(static function (array $error): array {
            if ($error['field'] === 'link_url') {
                $error['message'] = __('api.platform_notice_link_must_be_https');
            }

            return $error;
        }, $errors);

        return [$values, $errors];
    }

    /** The link when it is a safe, full https:// address, else null. */
    private static function httpsLink(mixed $value): ?string
    {
        $link = SiteAnnouncementService::safeLink($value);

        return $link !== null && str_starts_with(strtolower($link), 'https://') ? $link : null;
    }

    /** @return array<string, mixed> */
    private function teamNotice(int $id): array
    {
        $row = DB::table('platform_notices as n')
            ->leftJoin('users as u', 'u.id', '=', 'n.created_by')
            ->where('n.id', $id)
            ->first(['n.*', DB::raw(UserDisplayName::sqlFull('u', 'written_by', NameReason::ADMIN_ROUTE))]);

        if ($row === null) {
            // Only reachable if the row vanished between the write and the read.
            throw new \RuntimeException('platform_notices row disappeared after it was written.');
        }

        return self::teamShape($row, (int) DB::table('platform_notice_dismissals')->where('notice_id', $id)->count());
    }

    /** @return array<string, mixed> */
    private static function teamShape(object $row, int $closedCount): array
    {
        $writtenBy = trim((string) ($row->written_by ?? ''));

        return [
            'id' => (int) $row->id,
            'message' => (string) $row->message,
            'kind' => in_array($row->kind, self::KINDS, true) ? (string) $row->kind : self::DEFAULT_KIND,
            'link_url' => $row->link_url !== null ? (string) $row->link_url : null,
            'link_label' => $row->link_label !== null ? (string) $row->link_label : null,
            'starts_at' => self::iso($row->starts_at),
            'ends_at' => self::iso($row->ends_at),
            'is_dismissible' => (bool) $row->is_dismissible,
            'state' => self::state($row),
            'written_by' => $writtenBy !== '' ? $writtenBy : null,
            'created_at' => self::iso($row->created_at),
            'updated_at' => self::iso($row->updated_at),
            'ended_at' => self::iso($row->ended_at),
            'closed_count' => $closedCount,
        ];
    }

    /** @return 'live'|'scheduled'|'expired'|'ended' */
    private static function state(object $row): string
    {
        if (empty($row->is_active)) {
            return 'ended';
        }
        $now = now()->format('Y-m-d H:i:s');
        if ($row->starts_at !== null && strcmp((string) $row->starts_at, $now) > 0) {
            return 'scheduled';
        }
        if ($row->ends_at !== null && strcmp((string) $row->ends_at, $now) <= 0) {
            return 'expired';
        }

        return 'live';
    }

    private static function iso(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return Carbon::parse((string) $value, (string) config('app.timezone', 'UTC'))->toIso8601String();
    }

    /**
     * The second record of a write (the first is on the row). A failure to
     * write it must not undo the notice, but it must be seen: logged at error.
     */
    private function record(int $userId, string $action, int $noticeId): void
    {
        try {
            // Not ActivityLog::log(): that stamps the community the writer is
            // in. tenant_id is NULL on purpose (see the class comment). The
            // details name the notice, never its words.
            DB::table('activity_log')->insert([
                'tenant_id' => null,
                'user_id' => $userId > 0 ? $userId : null,
                'action' => $action,
                'details' => "Platform notice #{$noticeId}",
                'is_public' => 0,
                'ip_address' => ClientIp::get(),
                'action_type' => 'admin',
                'entity_type' => 'platform_notice',
                'entity_id' => $noticeId,
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::error('Platform notice: the activity log entry could not be written', [
                'action' => $action,
                'notice_id' => $noticeId,
                'user_id' => $userId,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);
        }
    }
}
