<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\MemberImport;

use App\Core\Mailer;
use App\Core\TenantContext;
use App\Services\Auth\WelcomeInvitationMailer;
use App\Services\EmailDispatchService;
use App\Support\Authorization\AdminTier;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * The durable outbox of welcome invitations (`member_invitation_outbox`).
 *
 * Rows are added by the member import (one per new member, inside the
 * member's own transaction) and by the admin "send invitation" bulk action.
 * The scheduled `members:send-invitations` command drains it about one email
 * a second, so a 5,000-member import is never 5,000 emails in one minute, and
 * a restart or a mail-provider outage loses nothing.
 *
 * The owner's bar, and how this class meets it:
 *  - nobody is emailed twice: a row is claimed by a unique token in one
 *    UPDATE, every later write is guarded by that token, a per-member database
 *    lock stops two rows for the same member being sent at once, a member
 *    invited in the last 24 hours is skipped, and a send that was interrupted
 *    half way (the process died) is never retried automatically;
 *  - "invited in the last 24 hours" means by ANY sender: another outbox row,
 *    or a set-password link issued directly (password_resets, e.g. the admin
 *    "Resend welcome email" action);
 *  - nobody who signed in, is held (not `active` and approved), or whose
 *    address is suppressed or undeliverable gets one: the member is re-checked
 *    at send time, and those are a terminal `skipped`, never retried;
 *  - last_error never holds personal data (see safeError());
 *  - nothing silently vanishes: every row ends `sent`, `skipped` (with a
 *    reason) or `failed` (with the error), and a claim abandoned by a dead
 *    worker is taken back after 10 minutes.
 *
 * Time comes from the application clock (now()), not the database's, so
 * backoff and the 24-hour rule follow Carbon::setTestNow in tests.
 */
final class InvitationOutbox
{
    public const SOURCE_IMPORT = 'import';
    public const SOURCE_ADMIN_BULK = 'admin_bulk';

    /** Not in this community (or deleted). */
    public const SKIP_NOT_FOUND = 'not_found';
    /** Has signed in — they do not need a set-password invitation. */
    public const SKIP_SIGNED_IN = 'signed_in';
    /** Not `active` — e.g. held for an identity check, suspended, pending approval. */
    public const SKIP_NOT_ACTIVE = 'not_active';
    /** The address bounced, complained or unsubscribed. Terminal. */
    public const SKIP_SUPPRESSED = 'suppressed';
    /** Already sent an invitation in the last 24 hours. */
    public const SKIP_RECENTLY_INVITED = 'recently_invited';
    /** Not a plain member (staff accounts are invited one at a time). */
    public const SKIP_NOT_MEMBER = 'not_member';
    /** Already waiting in the outbox. Reported by eligibility() only; never stored on a row. */
    public const SKIP_ALREADY_QUEUED = 'already_queued';
    /** The address can never receive mail (reserved domain, malformed). Terminal. */
    public const SKIP_UNDELIVERABLE = 'undeliverable';

    /** Every reason eligibility() can report, in the order the rules are applied. */
    public const SKIP_REASONS = [
        self::SKIP_NOT_FOUND,
        self::SKIP_NOT_MEMBER,
        self::SKIP_NOT_ACTIVE,
        self::SKIP_SIGNED_IN,
        self::SKIP_SUPPRESSED,
        self::SKIP_UNDELIVERABLE,
        self::SKIP_ALREADY_QUEUED,
        self::SKIP_RECENTLY_INVITED,
    ];

    /** Finished rows (sent, skipped, failed) are deleted this long after they last changed. */
    public const RETENTION_DAYS = 30;

    /** A send that throws this many times is given up (`failed`). */
    public const MAX_ATTEMPTS = 5;

    /** A `processing` claim older than this belongs to a dead worker. */
    public const STALE_CLAIM_MINUTES = 10;

    /** How long a member stays "recently invited". */
    public const RECENT_HOURS = 24;

    /** The scheduled sender's pace (a 50-second budget, one email a second). */
    public const SENDS_PER_MINUTE = 50;

    /**
     * Written to last_error just before the email is handed to the provider.
     * Every way out of `processing` overwrites it, so a claimed row that still
     * carries it was being SENT when its worker died: the email may or may not
     * have gone, and it is not retried (a second email is the worse outcome).
     */
    private const SEND_STARTED = 'send_started';

    /** last_error of a row given up because its send was interrupted (see SEND_STARTED). */
    private const INTERRUPTED = 'Interrupted while sending; not retried so the member is never emailed twice';

    private const CHUNK = 500;

    private const TABLE = 'member_invitation_outbox';

    public function __construct(private readonly WelcomeInvitationMailer $mailer)
    {
    }

    // ------------------------------------------------------------------ enqueue

    /**
     * Which of these members may be invited now, and why the rest may not.
     * Each member is reported once, under the first rule they fail.
     *
     * @param list<int>|array<int,int> $userIds
     * @return array{eligible: list<int>, skipped: array<string, list<int>>}
     */
    public function eligibility(int $tenantId, array $userIds): array
    {
        $skipped = array_fill_keys(self::SKIP_REASONS, []);
        $eligible = [];
        $ids = array_values(array_unique(array_filter(array_map('intval', $userIds), static fn (int $id): bool => $id > 0)));

        foreach (array_chunk($ids, self::CHUNK) as $chunk) {
            $users = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $chunk)
                ->get(['id', 'email', 'role', 'status', 'is_approved', 'last_login_at', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god'])
                ->keyBy('id');

            $emails = $users->pluck('email')->filter()->map(static fn ($e): string => (string) $e)->values()->all();
            $suppressed = $this->suppressedEmails($emails);
            $recentLinks = $this->emailsWithRecentInvitationLink($tenantId, $emails);

            $open = DB::table(self::TABLE)
                ->where('tenant_id', $tenantId)
                ->whereIn('user_id', $chunk)
                ->whereIn('status', ['pending', 'processing'])
                ->pluck('user_id')->map('intval')->flip();

            $recent = $this->recentOutboxRows(DB::table(self::TABLE)->where('tenant_id', $tenantId)->whereIn('user_id', $chunk))
                ->pluck('user_id')->map('intval')->flip();

            foreach ($chunk as $id) {
                $user = $users->get($id);
                $email = $user === null ? '' : strtolower(trim((string) $user->email));
                $reason = match (true) {
                    $user === null => self::SKIP_NOT_FOUND,
                    !self::isPlainMember($user) => self::SKIP_NOT_MEMBER,
                    !self::isActive($user) => self::SKIP_NOT_ACTIVE,
                    $user->last_login_at !== null => self::SKIP_SIGNED_IN,
                    isset($suppressed[$email]) => self::SKIP_SUPPRESSED,
                    EmailDispatchService::isUnroutableRecipient((string) $user->email) => self::SKIP_UNDELIVERABLE,
                    $open->has($id) => self::SKIP_ALREADY_QUEUED,
                    $recent->has($id), isset($recentLinks[$email]) => self::SKIP_RECENTLY_INVITED,
                    default => null,
                };
                if ($reason === null) {
                    $eligible[] = $id;
                } else {
                    $skipped[$reason][] = $id;
                }
            }
        }

        return ['eligible' => $eligible, 'skipped' => $skipped];
    }

    /**
     * Queue invitations for the eligible members. Safe to repeat: a member
     * already queued (by this or any request) is reported as already_queued,
     * and the unique (tenant, member, request) key makes a racing duplicate a
     * no-op.
     *
     * @param list<int>|array<int,int> $userIds
     * @return array{queued: int, skipped: array<string, int>, eta_minutes: int}
     */
    public function enqueue(int $tenantId, array $userIds, string $source, string $requestKey, ?int $requestedBy): array
    {
        self::assertSource($source);
        self::assertRequestKey($requestKey);

        $check = $this->eligibility($tenantId, $userIds);
        $queued = 0;
        $now = now()->toDateTimeString();

        foreach (array_chunk($check['eligible'], self::CHUNK) as $chunk) {
            $rows = array_map(static fn (int $userId): array => [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'request_key' => $requestKey,
                'source' => $source,
                'requested_by' => $requestedBy,
                'status' => 'pending',
                'attempts' => 0,
                'available_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ], $chunk);
            $queued += DB::table(self::TABLE)->insertOrIgnore($rows);
        }

        return [
            'queued' => $queued,
            'skipped' => array_map('count', $check['skipped']),
            'eta_minutes' => $queued > 0 ? $this->etaMinutes() : 0,
        ];
    }

    /**
     * Queue one invitation from inside the import writer's transaction, so the
     * invitation exists if and only if the member does. No eligibility query:
     * the writer has just created this member as an active plain member who
     * has never signed in. A plain INSERT, so anything unexpected rolls the
     * member back with it rather than being swallowed.
     */
    public function enqueueOneInTransaction(int $tenantId, int $userId, string $requestKey, int $requestedBy): void
    {
        self::assertRequestKey($requestKey);
        $now = now()->toDateTimeString();

        DB::table(self::TABLE)->insert([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'request_key' => $requestKey,
            'source' => self::SOURCE_IMPORT,
            'requested_by' => $requestedBy,
            'status' => 'pending',
            'attempts' => 0,
            'available_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    /** Invitations of this community still waiting to go (including any being sent right now). */
    public function pendingCount(int $tenantId): int
    {
        return DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->whereIn('status', ['pending', 'processing'])
            ->count();
    }

    // -------------------------------------------------------------------- drain

    /**
     * Claim up to $limit due invitations and send them, $gapMs apart, until
     * $budgetSeconds is spent. Rows not reached in time are handed back.
     *
     * @return array{claimed: int, sent: int, skipped: int, failed: int, retrying: int, released: int}
     *         `failed` counts rows given up for good; `retrying` rows whose send
     *         failed and will be tried again later; `released` rows handed back
     *         untried (budget spent, or the member was being sent by another worker).
     */
    public function drain(int $limit, float $budgetSeconds, int $gapMs = 1000): array
    {
        $summary = ['claimed' => 0, 'sent' => 0, 'skipped' => 0, 'failed' => 0, 'retrying' => 0, 'released' => 0];
        if ($limit < 1) {
            return $summary;
        }

        $deadline = microtime(true) + max(0.0, $budgetSeconds);
        $token = (string) Str::uuid();
        $rows = $this->claim($token, $limit);
        $summary['claimed'] = count($rows);
        $sentBefore = false;

        foreach ($rows as $index => $row) {
            if (microtime(true) >= $deadline) {
                $rest = array_map(static fn (object $r): int => (int) $r->id, array_slice($rows, $index));
                $summary['released'] += $this->release($rest, $token, null);
                break;
            }

            $outcome = $this->process($row, $token, $gapMs, $sentBefore);
            if ($outcome !== 'lost') {
                $summary[$outcome]++;
            }
        }

        return $summary;
    }

    /**
     * One UPDATE claims due rows (and rows abandoned by a dead worker) under a
     * fresh token; InnoDB row locks make two concurrent claims take disjoint
     * rows. Then read back exactly what this token holds.
     *
     * @return list<object>
     */
    private function claim(string $token, int $limit): array
    {
        $now = now();
        DB::update(
            'UPDATE ' . self::TABLE . "
                SET status = 'processing', claim_token = ?, claimed_at = ?, attempts = attempts + 1, updated_at = ?
              WHERE (status = 'pending' AND available_at <= ?)
                 OR (status = 'processing' AND claimed_at < ?)
              ORDER BY available_at, id
              LIMIT ?",
            [
                $token,
                $now->toDateTimeString(),
                $now->toDateTimeString(),
                $now->toDateTimeString(),
                $now->copy()->subMinutes(self::STALE_CLAIM_MINUTES)->toDateTimeString(),
                $limit,
            ]
        );

        return DB::table(self::TABLE)
            ->where('claim_token', $token)
            ->where('status', 'processing')
            ->orderBy('available_at')
            ->orderBy('id')
            ->get()
            ->all();
    }

    /** @return 'sent'|'skipped'|'failed'|'retrying'|'released'|'lost' */
    private function process(object $row, string $token, int $gapMs, bool &$sentBefore): string
    {
        $id = (int) $row->id;

        if ($row->last_error === self::SEND_STARTED) {
            return $this->giveUp($id, $token, self::INTERRUPTED);
        }
        if ((int) $row->attempts > self::MAX_ATTEMPTS) {
            return $this->giveUp($id, $token, 'Interrupted ' . self::MAX_ATTEMPTS . ' times before sending; given up');
        }

        try {
            return TenantContext::runForTenant(
                (int) $row->tenant_id,
                fn (): string => $this->processForTenant($row, $token, $gapMs, $sentBefore)
            );
        } catch (\Throwable $e) {
            // The tenant could not be loaded, or the database failed outside the send.
            return $this->attemptFailed($row, $token, $e);
        }
    }

    /** @return 'sent'|'skipped'|'failed'|'retrying'|'released'|'lost' */
    private function processForTenant(object $row, string $token, int $gapMs, bool &$sentBefore): string
    {
        $id = (int) $row->id;
        $tenantId = (int) $row->tenant_id;
        $userId = (int) $row->user_id;

        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first([
                'id', 'tenant_id', 'email', 'first_name', 'last_name', 'role', 'status', 'is_approved', 'last_login_at',
                'preferred_language', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god',
            ]);

        // Undeliverable is checked here, before any link is issued: the
        // dispatcher would refuse the send, and retrying it five times would
        // only issue and revoke five links.
        $reason = match (true) {
            $user === null => self::SKIP_NOT_FOUND,
            !self::isPlainMember($user) => self::SKIP_NOT_MEMBER,
            !self::isActive($user) => self::SKIP_NOT_ACTIVE,
            $user->last_login_at !== null => self::SKIP_SIGNED_IN,
            Mailer::isSuppressed((string) $user->email) => self::SKIP_SUPPRESSED,
            EmailDispatchService::isUnroutableRecipient((string) $user->email) => self::SKIP_UNDELIVERABLE,
            default => null,
        };
        if ($reason !== null) {
            return $this->skip($id, $token, $reason);
        }

        // Two rows for one member (two requests) must never both be sent: hold a
        // per-member lock across the 24-hour check, the send and its record.
        $lock = sprintf('nexus_member_invite_%d_%d', $tenantId, $userId);
        if (!$this->acquireMemberLock($lock)) {
            return $this->release([$id], $token, now()->addMinute()->toDateTimeString()) === 1 ? 'released' : 'lost';
        }

        try {
            // Any invitation in the last 24 hours counts, whoever sent it: another
            // outbox row, or a link issued directly (e.g. "Resend welcome email").
            $sentRecently = $this->recentOutboxRows(
                DB::table(self::TABLE)->where('tenant_id', $tenantId)->where('user_id', $userId)->where('id', '!=', $id)
            )->exists()
                || $this->emailsWithRecentInvitationLink($tenantId, [(string) $user->email]) !== [];
            if ($sentRecently) {
                return $this->skip($id, $token, self::SKIP_RECENTLY_INVITED);
            }

            if ($sentBefore && $gapMs > 0) {
                usleep($gapMs * 1000);
            }
            if ($this->guarded($id, $token)->update(['last_error' => self::SEND_STARTED, 'updated_at' => now()->toDateTimeString()]) !== 1) {
                return 'lost';
            }

            $sentBefore = true;
            try {
                $this->mailer->send((array) $user, true);
            } catch (\Throwable $e) {
                return $this->attemptFailed($row, $token, $e);
            }

            // The email has gone. From here on nothing may put the row back to
            // `pending`: if recording it fails, the row stays `processing` with
            // SEND_STARTED, and the stale-claim sweep gives it up unsent.
            $now = now()->toDateTimeString();
            try {
                $marked = $this->guarded($id, $token)->update([
                    'status' => 'sent',
                    'sent_at' => $now,
                    'claim_token' => null,
                    'last_error' => null,
                    'updated_at' => $now,
                ]);
            } catch (\Throwable $e) {
                Log::error('[InvitationOutbox] Invitation sent but could not be recorded', ['outbox_id' => $id, 'tenant_id' => $tenantId, 'user_id' => $userId, 'exception' => $e::class]);
                return 'lost';
            }
            if ($marked !== 1) {
                // Another worker took the row back as abandoned; it will see
                // SEND_STARTED and give up rather than send it again.
                Log::warning('[InvitationOutbox] Invitation sent but its claim was lost', ['outbox_id' => $id, 'tenant_id' => $tenantId, 'user_id' => $userId]);
                return 'lost';
            }

            $this->logSent($row, $userId);

            return 'sent';
        } finally {
            $this->releaseMemberLock($lock);
        }
    }

    /** @return 'failed'|'retrying'|'lost' */
    private function attemptFailed(object $row, string $token, \Throwable $e): string
    {
        $id = (int) $row->id;
        $attempts = (int) $row->attempts;
        $error = self::safeError($e);
        $terminal = $attempts >= self::MAX_ATTEMPTS;
        $now = now();

        $updated = $this->guarded($id, $token)->update($terminal
            ? ['status' => 'failed', 'claim_token' => null, 'last_error' => $error, 'updated_at' => $now->toDateTimeString()]
            : [
                'status' => 'pending',
                'claim_token' => null,
                'claimed_at' => null,
                'available_at' => $now->copy()->addMinutes($attempts * $attempts * 5)->toDateTimeString(),
                'last_error' => $error,
                'updated_at' => $now->toDateTimeString(),
            ]);

        Log::warning('[InvitationOutbox] Welcome invitation send failed', [
            'outbox_id' => $id,
            'tenant_id' => (int) $row->tenant_id,
            'user_id' => (int) $row->user_id,
            'attempt' => $attempts,
            'terminal' => $terminal,
            'exception' => $e::class,
        ]);

        if ($updated !== 1) {
            return 'lost';
        }

        return $terminal ? 'failed' : 'retrying';
    }

    /** @return 'failed'|'lost' */
    private function giveUp(int $id, string $token, string $error): string
    {
        return $this->guarded($id, $token)->update([
            'status' => 'failed',
            'claim_token' => null,
            'last_error' => $error,
            'updated_at' => now()->toDateTimeString(),
        ]) === 1 ? 'failed' : 'lost';
    }

    /** @return 'skipped'|'lost' */
    private function skip(int $id, string $token, string $reason): string
    {
        return $this->guarded($id, $token)->update([
            'status' => 'skipped',
            'skip_reason' => $reason,
            'claim_token' => null,
            'updated_at' => now()->toDateTimeString(),
        ]) === 1 ? 'skipped' : 'lost';
    }

    /**
     * Hand claimed rows back untried: the claim's attempt is not counted.
     *
     * @param list<int> $ids
     */
    private function release(array $ids, string $token, ?string $availableAt): int
    {
        if ($ids === []) {
            return 0;
        }
        $values = [
            'status' => 'pending',
            'claim_token' => null,
            'claimed_at' => null,
            'attempts' => DB::raw('IF(attempts > 0, attempts - 1, 0)'),
            'updated_at' => now()->toDateTimeString(),
        ];
        if ($availableAt !== null) {
            $values['available_at'] = $availableAt;
        }

        return DB::table(self::TABLE)
            ->whereIn('id', $ids)
            ->where('status', 'processing')
            ->where('claim_token', $token)
            ->update($values);
    }

    /** Every write after the claim: a worker whose claim was taken back can change nothing. */
    private function guarded(int $id, string $token): \Illuminate\Database\Query\Builder
    {
        return DB::table(self::TABLE)
            ->where('id', $id)
            ->where('status', 'processing')
            ->where('claim_token', $token);
    }

    /**
     * A MariaDB named lock: held by this connection, released if the process
     * dies. Refused (not waited for) when another connection — or this same
     * connection, further up the stack — is already sending to this member.
     */
    private function acquireMemberLock(string $name): bool
    {
        $row = DB::selectOne('SELECT IF(IS_USED_LOCK(?) = CONNECTION_ID(), 0, GET_LOCK(?, 0)) AS got', [$name, $name]);

        return $row !== null && (int) $row->got === 1;
    }

    private function releaseMemberLock(string $name): void
    {
        try {
            DB::selectOne('SELECT RELEASE_LOCK(?) AS released', [$name]);
        } catch (\Throwable $e) {
            // The lock dies with the connection anyway.
        }
    }

    private function logSent(object $row, int $userId): void
    {
        $source = $row->source === self::SOURCE_IMPORT ? 'import' : 'bulk';
        try {
            // Written directly: the actor is the admin who asked, or nobody
            // (the system), which ActivityLog::log's int user id cannot express.
            DB::table('activity_log')->insert([
                'tenant_id' => (int) $row->tenant_id,
                'user_id' => $row->requested_by !== null ? (int) $row->requested_by : null,
                'action' => 'member_invitation_sent',
                'details' => "Sent welcome invitation to user #{$userId} ({$source})",
                'is_public' => 0,
                'action_type' => 'system',
                'entity_type' => 'user',
                'entity_id' => $userId,
                'created_at' => now()->toDateTimeString(),
            ]);
        } catch (\Throwable $e) {
            // The email went and the row says so; a missing log line must not undo that.
            Log::warning('[InvitationOutbox] Could not write the activity log entry', ['outbox_id' => (int) $row->id, 'error' => $e->getMessage()]);
        }
    }

    // ---------------------------------------------------------------- retention

    /**
     * Delete finished rows (sent, skipped, failed) that have not changed for
     * $days days, across every community, in chunks. Rows still waiting or
     * being sent are never deleted, however old. Run by the sending command
     * after each drain. 30 days is a working choice pending the DPO.
     */
    public function pruneFinished(int $days = self::RETENTION_DAYS): int
    {
        $cutoff = now()->subDays(max(1, $days))->toDateTimeString();
        $chunk = 1000;
        $total = 0;
        do {
            $deleted = DB::delete(
                'DELETE FROM ' . self::TABLE . "
                  WHERE status IN ('sent', 'skipped', 'failed') AND updated_at < ?
                  ORDER BY id LIMIT {$chunk}",
                [$cutoff]
            );
            $total += $deleted;
        } while ($deleted === $chunk);

        return $total;
    }

    // ------------------------------------------------------------------ helpers

    /** `active` AND approved: a member awaiting approval is not invited yet. */
    private static function isActive(object $user): bool
    {
        return ($user->status ?? null) === 'active' && (int) ($user->is_approved ?? 0) === 1;
    }

    /**
     * Restrict an outbox query to rows that mean "this member was (or may have
     * been) emailed in the last 24 hours": sent, being sent right now, or given
     * up because a send was interrupted half way.
     */
    private function recentOutboxRows(Builder $query): Builder
    {
        $since = now()->subHours(self::RECENT_HOURS)->toDateTimeString();

        return $query->where(function (Builder $recent) use ($since): void {
            $recent->where(fn (Builder $q) => $q->where('status', 'sent')->where('sent_at', '>=', $since))
                ->orWhere(fn (Builder $q) => $q->where('status', 'processing')->where('last_error', self::SEND_STARTED)->where('updated_at', '>=', $since))
                ->orWhere(fn (Builder $q) => $q->where('status', 'failed')->where('last_error', self::INTERRUPTED)->where('updated_at', '>=', $since));
        });
    }

    /**
     * Addresses (lower-cased) of this community that were issued a set-password
     * invitation link in the last 24 hours by ANY sender — the outbox, the admin
     * "Resend welcome email" action, account creation. An invitation row has
     * `expires_at` set; a forgot-password row leaves it NULL and does not count.
     *
     * Compared on the DATABASE clock: PasswordResetTokens::issueInvitation()
     * writes created_at with the database's NOW(), not the application's.
     *
     * @param list<string> $emails
     * @return array<string, true>
     */
    private function emailsWithRecentInvitationLink(int $tenantId, array $emails): array
    {
        $emails = array_values(array_unique(array_filter($emails, static fn (string $e): bool => $e !== '')));
        if ($emails === []) {
            return [];
        }

        return DB::table('password_resets')
            ->where('tenant_id', $tenantId)
            ->whereIn('email', $emails)
            ->whereNotNull('expires_at')
            ->whereRaw('created_at >= NOW() - INTERVAL ' . self::RECENT_HOURS . ' HOUR')
            ->pluck('email')
            ->mapWithKeys(static fn ($email): array => [strtolower(trim((string) $email)) => true])
            ->all();
    }

    /**
     * What may be stored in last_error: the exception class and a message free
     * of personal data. A database error's message carries the SQL with its
     * bound values (an email address, say), so only its SQLSTATE and driver
     * code are kept; any other message has email addresses redacted.
     */
    private static function safeError(\Throwable $e): string
    {
        for ($cause = $e; $cause !== null; $cause = $cause->getPrevious()) {
            if ($cause instanceof QueryException) {
                $info = is_array($cause->errorInfo) ? $cause->errorInfo : [];
                $state = (string) ($info[0] ?? $cause->getCode());
                $driver = isset($info[1]) ? ' (driver error ' . (int) $info[1] . ')' : '';

                return mb_substr($cause::class . ': SQLSTATE ' . $state . $driver, 0, 500);
            }
        }

        $message = (string) preg_replace('/[^\s@<>()\[\]"\',;:]+@[^\s@<>()\[\]"\',;:]+/u', '[email]', $e->getMessage());

        return mb_substr($e::class . ($message !== '' ? ': ' . $message : ''), 0, 500);
    }

    /** A role-'member' account with none of the staff flags (AdminTier is the canonical staff test). */
    private static function isPlainMember(object $user): bool
    {
        return ($user->role ?? null) === 'member' && !AdminTier::allows($user);
    }

    /**
     * The same rule as Mailer::isSuppressed() (any reason, any category), for many
     * addresses in one query.
     *
     * @param list<string> $emails
     * @return array<string, true> lower-cased addresses
     */
    private function suppressedEmails(array $emails): array
    {
        if ($emails === [] || !Schema::hasTable('email_suppression')) {
            return [];
        }

        return DB::table('email_suppression')
            ->whereIn('email', array_values(array_unique($emails)))
            ->pluck('email')
            ->mapWithKeys(static fn ($email): array => [strtolower(trim((string) $email)) => true])
            ->all();
    }

    /**
     * Minutes until the whole platform's queue (this request included) has been
     * sent, at least 1. An estimate: other communities' invitations share the pace.
     * $notYetQueued adds invitations about to be queued (a count shown before
     * the admin confirms), so the two estimates agree.
     */
    public function etaMinutes(int $notYetQueued = 0): int
    {
        $waiting = DB::table(self::TABLE)->whereIn('status', ['pending', 'processing'])->count();

        return max(1, self::minutesToSend($waiting + max(0, $notYetQueued)));
    }

    /** Minutes the scheduled sender needs for this many invitations at its pace; 0 for none. */
    public static function minutesToSend(int $count): int
    {
        return $count <= 0 ? 0 : (int) ceil($count / self::SENDS_PER_MINUTE);
    }

    private static function assertSource(string $source): void
    {
        if (!in_array($source, [self::SOURCE_IMPORT, self::SOURCE_ADMIN_BULK], true)) {
            throw new \InvalidArgumentException("Unknown invitation source: {$source}");
        }
    }

    private static function assertRequestKey(string $requestKey): void
    {
        if ($requestKey === '' || strlen($requestKey) > 36) {
            throw new \InvalidArgumentException('An invitation request key is 1 to 36 characters');
        }
    }
}
