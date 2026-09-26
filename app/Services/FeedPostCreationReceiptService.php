<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Models\FeedPost;
use Illuminate\Support\Facades\DB;

final class FeedPostCreationReceiptService
{
    /** @return array{key_hash:string,request_hash:string}|null|false */
    public static function identity(?string $key, array $intent): array|null|false
    {
        $key = trim((string) $key);
        if ($key === '') return null;
        if (strlen($key) < 8 || strlen($key) > 191) return false;
        return [
            'key_hash' => hash('sha256', $key),
            'request_hash' => hash('sha256', json_encode(
                self::canonicalize($intent),
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            )),
        ];
    }

    /** @return array{post:mixed,replayed:bool} */
    public static function create(int $userId, array $identity, callable $create): array
    {
        return DB::transaction(function () use ($userId, $identity, $create): array {
            $tenantId = TenantContext::getId();
            DB::table('users')->where('tenant_id', $tenantId)->where('id', $userId)->lockForUpdate()->exists();
            $receipt = DB::table('feed_post_creation_receipts')
                ->where('tenant_id', $tenantId)->where('actor_user_id', $userId)
                ->where('idempotency_key_hash', $identity['key_hash'])->first();
            if ($receipt) {
                if (! hash_equals((string) $receipt->request_hash, $identity['request_hash'])) {
                    throw new \InvalidArgumentException('Idempotency key was reused for different post content');
                }
                $post = FeedPost::find((int) $receipt->post_id);
                if (! $post) throw new \DomainException('Post creation result is no longer available');
                return ['post' => $post, 'replayed' => true];
            }

            $post = $create();
            // FeedService returns validation failures as arrays. Do not create a receipt
            // when the requested operation created no post.
            if (! $post instanceof FeedPost) return ['post' => $post, 'replayed' => false];
            DB::table('feed_post_creation_receipts')->insert([
                'tenant_id' => $tenantId,
                'actor_user_id' => $userId,
                'idempotency_key_hash' => $identity['key_hash'],
                'request_hash' => $identity['request_hash'],
                'post_id' => $post->id,
                'created_at' => now(),
            ]);
            return ['post' => $post, 'replayed' => false];
        });
    }

    private static function canonicalize(array $value): array
    {
        foreach ($value as $key => $item) if (is_array($item)) $value[$key] = self::canonicalize($item);
        if (! array_is_list($value)) ksort($value);
        return $value;
    }
}
