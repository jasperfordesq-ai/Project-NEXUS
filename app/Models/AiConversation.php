<?php
// Copyright � 2024�2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;

class AiConversation extends Model
{
    use HasFactory, HasTenantScope;

    protected $table = 'ai_conversations';

    protected $fillable = [
        'tenant_id',
        'user_id',
        'title',
        'provider',
        'model',
        'context_type',
        'context_id',
    ];

    protected $casts = [
        'user_id' => 'integer',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(AiMessage::class, 'conversation_id');
    }

    /**
     * Get all conversations for a user (with message count and first message).
     */
    public static function getByUserId(int $userId, int $tenantId, ?int $limit = null, int $offset = 0): array
    {
        $query = DB::table('ai_conversations as c')
            ->select([
                'c.*',
                DB::raw('(SELECT COUNT(*) FROM ai_messages WHERE conversation_id = c.id) as message_count'),
                DB::raw("(SELECT content FROM ai_messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_message"),
            ])
            ->where('c.tenant_id', $tenantId)
            ->where('c.user_id', $userId)
            ->orderByDesc('c.updated_at')
            ->orderByDesc('c.created_at');

        if ($limit !== null) {
            $query->limit($limit)->offset($offset);
        }

        $rows = $query->get();

        return $rows->map(fn ($r) => (array) $r)->all();
    }

    /**
     * Count conversations for a user.
     */
    public static function countByUserId(int $userId, int $tenantId): int
    {
        return (int) DB::table('ai_conversations')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->count();
    }

    /**
     * Check if a conversation belongs to a user.
     */
    public static function belongsToUser(int $conversationId, int $userId): bool
    {
        $tenantId = TenantContext::getId();

        return DB::table('ai_conversations')
            ->where('id', $conversationId)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->exists();
    }

    /**
     * Get a conversation with its messages.
     */
    public static function getWithMessages(int $conversationId): ?array
    {
        $tenantId = TenantContext::getId();

        $conversation = DB::table('ai_conversations')
            ->where('id', $conversationId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$conversation) {
            return null;
        }

        $result = (array) $conversation;

        $result['messages'] = DB::table('ai_messages')
            ->where('conversation_id', $conversationId)
            ->orderBy('created_at')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        return $result;
    }
}
