<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class NewsletterSubscriber extends Model
{
    use HasFactory, HasTenantScope;

    private const ALLOWED_SOURCES = ['signup', 'import', 'manual', 'member_sync'];

    protected $table = 'newsletter_subscribers';

    protected $fillable = [
        'tenant_id', 'email', 'first_name', 'last_name', 'user_id',
        'source', 'status', 'confirmation_token', 'unsubscribe_token',
        'confirmed_at', 'unsubscribed_at', 'unsubscribe_reason', 'is_active',
    ];

    protected $casts = [
        'user_id' => 'integer',
        'confirmed_at' => 'datetime',
        'unsubscribed_at' => 'datetime',
        'is_active' => 'boolean',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public static function findByEmail(string $email): ?array
    {
        $tenantId = \App\Core\TenantContext::getId();
        $row = DB::table('newsletter_subscribers')
            ->where('tenant_id', $tenantId)
            ->where('email', self::normalizeEmail($email))
            ->first();

        return $row ? (array) $row : null;
    }

    public static function createConfirmed(
        string $email,
        ?string $firstName = null,
        ?string $lastName = null,
        string $source = 'signup',
        ?int $userId = null
    ): int {
        $tenantId = \App\Core\TenantContext::getId();
        $email = self::normalizeEmail($email);
        $source = self::normalizeSource($source);

        $existing = DB::table('newsletter_subscribers')
            ->where('tenant_id', $tenantId)
            ->where('email', $email)
            ->first(['id']);

        $payload = [
            'first_name' => $firstName,
            'last_name' => $lastName,
            'user_id' => $userId,
            'source' => $source,
            'status' => 'active',
            'confirmed_at' => now(),
            'unsubscribed_at' => null,
            'unsubscribe_reason' => null,
            'is_active' => 1,
            'updated_at' => now(),
        ];

        if ($existing) {
            DB::table('newsletter_subscribers')
                ->where('id', $existing->id)
                ->where('tenant_id', $tenantId)
                ->update($payload);

            return (int) $existing->id;
        }

        $payload += [
            'tenant_id' => $tenantId,
            'email' => $email,
            'confirmation_token' => bin2hex(random_bytes(32)),
            'unsubscribe_token' => bin2hex(random_bytes(32)),
            'created_at' => now(),
        ];

        return (int) DB::table('newsletter_subscribers')->insertGetId($payload);
    }

    public static function setStatusById(int $id, string $status): bool
    {
        if (!in_array($status, ['pending', 'active', 'unsubscribed'], true)) {
            return false;
        }

        $payload = [
            'status' => $status,
            'is_active' => $status === 'active' ? 1 : 0,
            'updated_at' => now(),
        ];

        if ($status === 'unsubscribed') {
            $payload['unsubscribed_at'] = now();
            $payload['unsubscribe_reason'] = 'preferences';
        } elseif ($status === 'active') {
            $payload['unsubscribed_at'] = null;
            $payload['unsubscribe_reason'] = null;
        }

        return DB::table('newsletter_subscribers')
            ->where('id', $id)
            ->where('tenant_id', \App\Core\TenantContext::getId())
            ->update($payload) > 0;
    }

    public static function import(array $rows): array
    {
        $imported = 0;
        $skipped = 0;
        $errors = [];

        foreach ($rows as $index => $row) {
            $email = is_array($row) ? ($row['email'] ?? '') : '';

            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $skipped++;
                $errors[] = 'Row ' . ($index + 1) . ': invalid email';
                continue;
            }

            if (self::findByEmail($email)) {
                $skipped++;
                continue;
            }

            self::createConfirmed(
                $email,
                $row['first_name'] ?? null,
                $row['last_name'] ?? null,
                'import',
                isset($row['user_id']) ? (int) $row['user_id'] : null
            );
            $imported++;
        }

        return [
            'imported' => $imported,
            'skipped' => $skipped,
            'errors' => $errors,
        ];
    }

    public static function export(): array
    {
        return DB::table('newsletter_subscribers')
            ->where('tenant_id', \App\Core\TenantContext::getId())
            ->orderBy('email')
            ->get([
                'email',
                'first_name',
                // newsletter_subscribers has its own first_name/last_name and no
                // organisation columns -- this is not a users query.
                'last_name',
                'status',
                'source',
                'created_at',
                'confirmed_at',
                'unsubscribed_at',
            ])
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    public static function syncMembersWithStats(): array
    {
        $tenantId = \App\Core\TenantContext::getId();

        if (!Schema::hasColumn('users', 'newsletter_opt_in')) {
            return [
                'synced' => 0,
                'total_users' => 0,
                'already_subscribed' => 0,
                'eligible' => 0,
                'pending_approval' => 0,
                'suppressed' => 0,
                'consent_column_missing' => true,
            ];
        }

        $suppressedEmails = [];
        if (Schema::hasTable('newsletter_suppression_list')) {
            $suppressedEmails = DB::table('newsletter_suppression_list')
                ->where('tenant_id', $tenantId)
                ->where(function ($query) {
                    $query->whereNull('expires_at')
                        ->orWhere('expires_at', '>', now());
                })
                ->pluck('email')
                ->map(fn ($email) => self::normalizeEmail((string) $email))
                ->flip()
                ->all();
        }

        $users = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('is_approved', 1)
            ->where('newsletter_opt_in', 1)
            ->whereNotNull('email')
            ->where('email', '!=', '')
            ->get(['id', 'email', 'first_name', 'last_name', 'profile_type', 'organization_name', 'status']);

        $synced = 0;
        $alreadySubscribed = 0;
        $pendingApproval = 0;
        $suppressed = 0;

        foreach ($users as $user) {
            if (($user->status ?? 'active') !== 'active') {
                $pendingApproval++;
                continue;
            }

            $email = self::normalizeEmail((string) $user->email);
            if (isset($suppressedEmails[$email])) {
                $suppressed++;
                continue;
            }

            if (self::findByEmail($email)) {
                $alreadySubscribed++;
                continue;
            }

            self::createConfirmed(
                $email,
                $user->first_name ?? null,
                $user->last_name ?? null,
                'member_sync',
                (int) $user->id
            );
            $synced++;
        }

        return [
            'synced' => $synced,
            'total_users' => $users->count(),
            'already_subscribed' => $alreadySubscribed,
            'eligible' => $synced + $alreadySubscribed,
            'pending_approval' => $pendingApproval,
            'suppressed' => $suppressed,
        ];
    }

    private static function normalizeEmail(string $email): string
    {
        return strtolower(trim($email));
    }

    private static function normalizeSource(string $source): string
    {
        return in_array($source, self::ALLOWED_SOURCES, true) ? $source : 'manual';
    }
}
