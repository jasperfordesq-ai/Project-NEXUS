<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Observers;

use App\Jobs\SyncUserSearchIndexJob;
use App\Models\User;
use App\Observers\Concerns\IndexesEmbeddings;
use App\Support\UserDisplayName;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Keeps the Meilisearch users index in sync with the users table.
 *
 * Dispatches SyncUserSearchIndexJob (Redis-queued, auto-retrying) rather than
 * calling SearchService directly — so a transient Meilisearch outage during a
 * signup or profile edit doesn't leave the user missing from search forever.
 *
 * Without this observer, user profile updates (name, bio, etc.) are NOT
 * reflected in search results until the next full sync script run.
 */
class UserObserver
{
    use IndexesEmbeddings;

    /**
     * Fields that, when changed, require a re-index.
     * MUST stay in sync with the document shape built in SearchService::indexUser
     * and the searchable attributes declared in SearchService::ensureIndexes.
     */
    private const SEARCHABLE_FIELDS = [
        'first_name',
        'last_name',
        'organization_name',
        'bio',
        'skills',
        'location',
        'status',
        'profile_type',
        'avatar_url',
    ];

    /**
     * Fields that determine the stored `users.name` display value.
     */
    private const NAME_FIELDS = [
        'first_name',
        'last_name',
        'profile_type',
        'organization_name',
    ];

    /**
     * Keep the stored `users.name` column in step with the display name.
     *
     * `users.name` is a real NOT NULL column read by well over a hundred call
     * sites (many of which select it WITHOUT `profile_type`/`organization_name`,
     * so they cannot resolve an organisation name themselves). It used to be
     * written as `first_name . ' ' . last_name` on insert and never rewritten,
     * which meant an ORGANISATION account -- `profile_type = 'organisation'`,
     * trading name in `organization_name` -- kept showing its contact person's
     * personal name for ever, and a self-registered account stored '' because
     * RegistrationService never set the column at all.
     *
     * Firing on `saving` covers every Eloquent write in one place. Raw
     * `DB::table('users')->insert(...)` writers set the column themselves -- no
     * model event reaches them -- and a backfill migration repaired the rows
     * that predate this.
     */
    public function saving(User $user): void
    {
        // On update, only touch `name` when something that feeds it changed.
        // Recomputing on every save would burn a query on unrelated writes
        // (last_active_at is written on virtually every request).
        if ($user->exists && empty(array_intersect(array_keys($user->getDirty()), self::NAME_FIELDS))) {
            return;
        }

        $attributes = $user->getAttributes();
        $parts = [];
        $missing = [];

        // `name` itself is topped up too, but is NOT in NAME_FIELDS: it must never
        // TRIGGER a recompute (it is the output), yet the guard below needs the
        // real stored value. Without it, a model selected without `name` reads
        // the stored name as '' and the guard cannot protect it.
        $wanted = array_merge(self::NAME_FIELDS, ['name']);

        foreach ($wanted as $field) {
            if (array_key_exists($field, $attributes)) {
                $parts[$field] = $attributes[$field];
            } else {
                $missing[] = $field;
            }
        }

        // A partially-selected model must not be allowed to blank out the other
        // half of the name -- top the picture up from the row before deciding.
        if ($missing !== [] && $user->exists && $user->getKey()) {
            try {
                $row = DB::table('users')->where('id', $user->getKey())->first($missing);
                foreach ($missing as $field) {
                    $parts[$field] = $row->{$field} ?? null;
                }
            } catch (\Throwable $e) {
                Log::warning('UserObserver: could not top up name fields', [
                    'user_id' => $user->getKey(),
                    'error'   => $e->getMessage(),
                ]);

                return;
            }
        }

        $resolved = UserDisplayName::forStorage(
            $parts['profile_type'] ?? null,
            $parts['organization_name'] ?? null,
            $parts['first_name'] ?? null,
            $parts['last_name'] ?? null,
        );

        // Never replace a real stored name with an empty string: an account can
        // legitimately have no first/last name (SSO, imports) while `name`
        // carries the only name it has.
        if ($resolved === '' && trim((string) ($parts['name'] ?? '')) !== '') {
            return;
        }

        $user->setAttribute('name', $resolved);
    }

    public function created(User $user): void
    {
        $this->dispatchIndex($user->id, 'created');
        $this->reindexEmbedding($user, 'user');
    }

    public function updated(User $user): void
    {
        $dirty = array_keys($user->getDirty());
        if (empty(array_intersect($dirty, self::SEARCHABLE_FIELDS))) {
            return;
        }
        $this->dispatchIndex($user->id, 'updated');
        $this->reindexEmbedding($user, 'user');
    }

    public function deleted(User $user): void
    {
        try {
            SyncUserSearchIndexJob::dispatch($user->id, 'remove');
        } catch (\Throwable $e) {
            Log::error('UserObserver: failed to dispatch remove-from-index job', [
                'user_id' => $user->id,
                'error'   => $e->getMessage(),
            ]);
        }
        $this->deleteEmbedding($user, 'user');
    }

    private function dispatchIndex(int $userId, string $reason): void
    {
        try {
            SyncUserSearchIndexJob::dispatch($userId, 'index');
        } catch (\Throwable $e) {
            // Dispatching shouldn't normally fail (Redis connection). If it does,
            // log — the periodic sync script is the backstop.
            Log::error('UserObserver: failed to dispatch index job', [
                'user_id' => $userId,
                'reason'  => $reason,
                'error'   => $e->getMessage(),
            ]);
        }
    }
}
