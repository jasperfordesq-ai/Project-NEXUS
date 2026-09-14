<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Events\MessageSent;
use App\Models\Message;
use App\Models\User;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Transactional recovery boundary for the jobs emitted after a message commit.
 *
 * The outbox contains no message body or recipient data: the canonical message
 * remains the only payload. A successful dispatch means Laravel accepted the
 * broadcast/listener jobs; provider delivery remains owned by those jobs.
 */
final class MessageDeliveryOutboxService
{
    private const MAX_ATTEMPTS = 8;
    private const CLAIM_MINUTES = 5;

    public function __construct(private readonly Dispatcher $events) {}

    /** Must be called inside the same transaction that creates the message. */
    public static function record(int $tenantId, int $messageId): void
    {
        DB::table('message_delivery_outbox')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'message_id' => $messageId,
            'attempts' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function dispatchMessage(int $tenantId, int $messageId, bool $retryNow = false): bool
    {
        $id = DB::table('message_delivery_outbox')
            ->where('tenant_id', $tenantId)
            ->where('message_id', $messageId)
            ->value('id');

        if ($id === null) {
            return false;
        }

        return $this->dispatchOutboxId((int) $id, $retryNow);
    }

    /** @return array{claimed:int,dispatched:int,retried:int,dead_lettered:int} */
    public function processBatch(int $limit = 100): array
    {
        $limit = max(1, min(500, $limit));
        $ids = DB::table('message_delivery_outbox')
            ->whereNull('dispatched_at')
            ->whereNull('dead_lettered_at')
            ->where(function ($query): void {
                $query->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now());
            })
            ->where(function ($query): void {
                $query->whereNull('claim_until')->orWhere('claim_until', '<=', now());
            })
            ->orderBy('id')
            ->limit($limit)
            ->pluck('id')
            ->map(static fn ($id): int => (int) $id)
            ->all();

        $summary = ['claimed' => 0, 'dispatched' => 0, 'retried' => 0, 'dead_lettered' => 0];
        foreach ($ids as $id) {
            $before = DB::table('message_delivery_outbox')->where('id', $id)->first();
            if ($before === null || ! $this->dispatchOutboxId($id)) {
                $after = DB::table('message_delivery_outbox')->where('id', $id)->first();
                if ($after !== null && (int) $after->attempts > (int) ($before->attempts ?? -1)) {
                    $summary['claimed']++;
                    $summary[$after->dead_lettered_at === null ? 'retried' : 'dead_lettered']++;
                }
                continue;
            }
            $summary['claimed']++;
            $summary['dispatched']++;
        }

        return $summary;
    }

    private function dispatchOutboxId(int $id, bool $retryNow = false): bool
    {
        $now = now();
        $claimed = DB::table('message_delivery_outbox')
            ->where('id', $id)
            ->whereNull('dispatched_at')
            ->whereNull('dead_lettered_at')
            ->when(! $retryNow, function ($query) use ($now): void {
                $query->where(function ($due) use ($now): void {
                    $due->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', $now);
                });
            })
            ->where(function ($query) use ($now): void {
                $query->whereNull('claim_until')->orWhere('claim_until', '<=', $now);
            })
            ->update([
                'attempts' => DB::raw('attempts + 1'),
                'claim_until' => $now->copy()->addMinutes(self::CLAIM_MINUTES),
                'updated_at' => $now,
            ]);

        if ($claimed !== 1) {
            $alreadyDispatched = DB::table('message_delivery_outbox')
                ->where('id', $id)
                ->whereNotNull('dispatched_at')
                ->exists();

            return $alreadyDispatched;
        }

        $row = DB::table('message_delivery_outbox')->where('id', $id)->first();
        if ($row === null) {
            return false;
        }

        try {
            $message = Message::withoutGlobalScopes()
                ->whereKey((int) $row->message_id)
                ->where('tenant_id', (int) $row->tenant_id)
                ->first();
            $sender = $message === null
                ? null
                : User::withoutGlobalScopes()
                    ->whereKey((int) $message->sender_id)
                    ->where('tenant_id', (int) $row->tenant_id)
                    ->first();
            if ($message === null || $sender === null) {
                throw new \RuntimeException('message_delivery_source_missing');
            }

            $ids = [(int) $message->sender_id, (int) $message->receiver_id];
            sort($ids);
            $conversationId = crc32(implode('-', $ids));
            $this->events->dispatch(new MessageSent($message, $sender, $conversationId, (int) $row->tenant_id));

            DB::table('message_delivery_outbox')->where('id', $id)->update([
                'dispatched_at' => now(),
                'claim_until' => null,
                'next_attempt_at' => null,
                'last_error' => null,
                'updated_at' => now(),
            ]);

            return true;
        } catch (\Throwable $error) {
            $attempts = (int) $row->attempts;
            $dead = $attempts >= self::MAX_ATTEMPTS;
            DB::table('message_delivery_outbox')->where('id', $id)->update([
                'claim_until' => null,
                'next_attempt_at' => $dead ? null : $this->nextAttemptAt($attempts),
                'dead_lettered_at' => $dead ? now() : null,
                'last_error' => $this->safeError($error),
                'updated_at' => now(),
            ]);
            Log::log($dead ? 'critical' : 'warning', 'Message delivery outbox dispatch failed', [
                'outbox_id' => $id,
                'message_id' => (int) $row->message_id,
                'tenant_id' => (int) $row->tenant_id,
                'attempt' => $attempts,
                'dead_lettered' => $dead,
                'error' => $this->safeError($error),
            ]);

            return false;
        }
    }

    private function nextAttemptAt(int $attempt): Carbon
    {
        $minutes = [1, 2, 5, 15, 30, 60, 180][$attempt - 1] ?? 360;
        return now()->addMinutes($minutes);
    }

    private function safeError(\Throwable $error): string
    {
        $message = trim($error->getMessage());
        if ($message === '') {
            $message = $error::class;
        }

        $singleLine = preg_replace('/[\r\n\t]+/', ' ', $message) ?? 'message_delivery_dispatch_failed';

        return EventNotificationErrorSanitizer::sanitize($singleLine, 255);
    }
}
