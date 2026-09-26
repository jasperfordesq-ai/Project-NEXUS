<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;

class Notification extends Model
{
    use HasFactory, HasTenantScope;
    use SoftDeletes;

    protected $table = 'notifications';

    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'user_id', 'type', 'message',
        'link', 'idempotency_key', 'is_read', 'created_at',
    ];

    /**
     * Attributes hidden from JSON serialization to prevent data leakage.
     */
    protected $hidden = ['tenant_id'];

    protected $casts = [
        'is_read' => 'boolean',
        'created_at' => 'datetime',
        'deleted_at' => 'datetime',
    ];

    /**
     * Appended attributes for frontend compatibility.
     *
     * Frontend expects `read_at` (nullable timestamp) and `body`/`title` fields.
     * Backend stores `is_read` (boolean) and `message` (string).
     */
    protected $appends = ['read_at', 'body', 'title'];

    protected static function booted(): void
    {
        static::creating(function (Notification $notification): void {
            $userId = (int) ($notification->user_id ?? 0);
            if ($userId <= 0) {
                return;
            }

            $notification->tenant_id = self::resolveTenantIdForRecipient(
                $userId,
                isset($notification->tenant_id) ? (int) $notification->tenant_id : null,
                'Notification::create'
            );
        });
    }

    /**
     * read_at accessor — converts boolean `is_read` to nullable timestamp.
     *
     * Frontend checks `!notification.read_at` to determine unread status.
     * When read, returns `created_at` as the approximate "read" timestamp
     * (no separate read timestamp column exists).
     */
    public function getReadAtAttribute(): ?string
    {
        if (! $this->is_read) {
            return null;
        }

        return $this->created_at?->toIso8601String() ?? now()->toIso8601String();
    }

    /**
     * body accessor — alias for `message` field.
     *
     * Frontend Notification type defines `body: string`.
     */
    public function getBodyAttribute(): ?string
    {
        return $this->attributes['message'] ?? null;
    }

    /**
     * title accessor — extracts a title from the notification.
     *
     * Frontend Notification type defines `title: string`.
     * Notifications don't have a separate title column, so derive from type.
     */
    public function getTitleAttribute(): string
    {
        $type = $this->attributes['type'] ?? 'notification';
        return ucfirst(str_replace('_', ' ', $type));
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function scopeUnread(Builder $query): Builder
    {
        return $query->where('is_read', false);
    }

    public function scopeOfType(Builder $query, string $type): Builder
    {
        return $query->where('type', $type);
    }

    public function scopeLatest(Builder $query): Builder
    {
        return $query->orderByDesc('created_at');
    }

    /**
     * Create a notification record.
     * Named createNotification to avoid conflict with Eloquent's create().
     *
     * @param int      $userId      Target user to notify
     * @param string   $message     Notification body text
     * @param string|null $link     Optional link for the notification
     * @param string   $type        Notification type (e.g. 'info', 'connection_request', 'federation_connection')
     * @param bool     $isImportant Whether this is a high-priority notification
     * @param int|null $tenantId    Explicit tenant ID for cross-tenant notifications (e.g. federation).
     *                              When null, uses the recipient user's tenant.
     * @param string|null $idempotencyKey Stable per-recipient business-event key.
     * @param bool|null $created Receives whether this call inserted the notification.
     */
    public static function createNotification(
        int $userId,
        string $message,
        ?string $link = null,
        string $type = 'info',
        bool $isImportant = false,
        ?int $tenantId = null,
        ?string $idempotencyKey = null,
        ?bool &$created = null,
    ): int {
        $tenantId = self::resolveTenantIdForRecipient($userId, $tenantId, 'Notification::createNotification');

        $row = [
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'message' => $message,
            'link' => $link,
            'type' => $type,
            'is_read' => 0,
            'created_at' => now(),
        ];
        $idempotencyKey = trim((string) ($idempotencyKey ?? ''));
        if ($idempotencyKey !== '') {
            $row['idempotency_key'] = mb_substr($idempotencyKey, 0, 191);
            $created = DB::table('notifications')->insertOrIgnore($row) === 1;
            return (int) DB::table('notifications')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('idempotency_key', $row['idempotency_key'])
                ->value('id');
        }

        $id = DB::table('notifications')->insertGetId($row);
        $created = true;

        return (int) $id;
    }

    private static function resolveTenantIdForRecipient(int $userId, ?int $candidateTenantId, string $source): ?int
    {
        $contextTenantId = TenantContext::currentId();
        $candidateTenantId = $candidateTenantId ?: ($contextTenantId ?: null);

        $recipientTenantId = DB::table('users')
            ->where('id', $userId)
            ->value('tenant_id');

        if ($recipientTenantId !== null) {
            $recipientTenantId = (int) $recipientTenantId;
            if ($candidateTenantId !== null && (int) $candidateTenantId !== $recipientTenantId) {
                Log::warning('Notification tenant context differed from recipient tenant; using recipient tenant', [
                    'source' => $source,
                    'user_id' => $userId,
                    'context_tenant_id' => $contextTenantId,
                    'candidate_tenant_id' => (int) $candidateTenantId,
                    'recipient_tenant_id' => $recipientTenantId,
                ]);
            }

            return $recipientTenantId;
        }

        if ($candidateTenantId === null) {
            Log::warning('Notification created without tenant context and recipient tenant could not be resolved', [
                'source' => $source,
                'user_id' => $userId,
            ]);
        }

        return $candidateTenantId;
    }

    /**
     * Count unread notifications for a user.
     */
    public static function countUnread(int $userId): int
    {
        return (int) DB::table('notifications')
            ->where('tenant_id', \App\Core\TenantContext::getId())
            ->where('user_id', $userId)
            ->where('is_read', 0)
            ->whereNull('deleted_at')
            ->count();
    }
}
