<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Models\PodcastEpisode;
use App\Models\PodcastShow;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

final class PodcastCreationReceiptService
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

    /** @return array{show:PodcastShow,replayed:bool} */
    public static function createShow(int $userId, array $data, array $identity): array
    {
        return DB::transaction(function () use ($userId, $data, $identity): array {
            $tenantId = TenantContext::getId();
            self::lockActor($tenantId, $userId);
            $receipt = self::find($tenantId, $userId, 'show', $identity['key_hash']);
            if ($receipt) {
                self::assertMatches($receipt, $identity['request_hash']);
                $show = PodcastShow::find((int) $receipt->result_id);
                if (!$show) throw new \DomainException('Podcast creation result is no longer available');
                return ['show' => $show, 'replayed' => true];
            }

            $show = PodcastService::createShow($userId, $data);
            self::store($tenantId, $userId, 'show', null, $identity, (int) $show->id);
            return ['show' => $show, 'replayed' => false];
        });
    }

    /** @return array{episode:PodcastEpisode,replayed:bool} */
    public static function createEpisode(
        PodcastShow $show,
        int $userId,
        array $data,
        ?UploadedFile $audioFile,
        array $identity,
    ): array {
        return DB::transaction(function () use ($show, $userId, $data, $audioFile, $identity): array {
            $tenantId = TenantContext::getId();
            self::lockActor($tenantId, $userId);
            $receipt = self::find($tenantId, $userId, 'episode', $identity['key_hash']);
            if ($receipt) {
                self::assertMatches($receipt, $identity['request_hash']);
                if ((int) $receipt->show_id !== (int) $show->id) {
                    throw new \InvalidArgumentException('Idempotency key belongs to another podcast show');
                }
                $episode = PodcastEpisode::with('chapters')->find((int) $receipt->result_id);
                if (!$episode) throw new \DomainException('Podcast creation result is no longer available');
                return ['episode' => $episode, 'replayed' => true];
            }

            $episode = PodcastService::createEpisode($show, $userId, $data, $audioFile);
            self::store($tenantId, $userId, 'episode', (int) $show->id, $identity, (int) $episode->id);
            return ['episode' => $episode, 'replayed' => false];
        });
    }

    private static function lockActor(int $tenantId, int $userId): void
    {
        DB::table('users')->where('tenant_id', $tenantId)->where('id', $userId)->lockForUpdate()->exists();
    }

    private static function find(int $tenantId, int $userId, string $type, string $keyHash): ?object
    {
        return DB::table('podcast_creation_receipts')
            ->where('tenant_id', $tenantId)->where('actor_user_id', $userId)
            ->where('operation_type', $type)->where('idempotency_key_hash', $keyHash)->first();
    }

    private static function assertMatches(object $receipt, string $requestHash): void
    {
        if (!hash_equals((string) $receipt->request_hash, $requestHash)) {
            throw new \InvalidArgumentException('Idempotency key was reused for different podcast content');
        }
    }

    private static function store(int $tenantId, int $userId, string $type, ?int $showId, array $identity, int $resultId): void
    {
        DB::table('podcast_creation_receipts')->insert([
            'tenant_id' => $tenantId, 'actor_user_id' => $userId, 'operation_type' => $type,
            'show_id' => $showId, 'idempotency_key_hash' => $identity['key_hash'],
            'request_hash' => $identity['request_hash'], 'result_id' => $resultId, 'created_at' => now(),
        ]);
    }

    private static function canonicalize(array $value): array
    {
        foreach ($value as $key => $item) if (is_array($item)) $value[$key] = self::canonicalize($item);
        if (!array_is_list($value)) ksort($value);
        return $value;
    }
}
