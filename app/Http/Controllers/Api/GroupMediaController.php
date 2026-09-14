<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\GroupStorageQuarantineException;
use App\Exceptions\SafeguardingPolicyException;
use App\Services\GroupAccessService;
use App\Services\GroupAuditService;
use App\Services\GroupContentCreationReceiptService;
use App\Services\GroupFileService;
use App\Services\GroupService;
use App\Services\GroupStorageQuarantine;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

/** Private group gallery API for validated images and videos. */
final class GroupMediaController extends BaseApiController
{
    protected bool $isV2Api = true;

    private const MAX_FILE_SIZE = 50 * 1024 * 1024;
    private const MAX_CAPTION_LENGTH = 2_000;
    private const MAX_IMAGE_PIXELS = 25_000_000;

    /** @var array<string, list<string>> */
    private const MIME_EXTENSIONS = [
        'image/jpeg' => ['jpg', 'jpeg'],
        'image/png' => ['png'],
        'image/gif' => ['gif'],
        'image/webp' => ['webp'],
        'video/mp4' => ['mp4', 'm4v'],
        'video/webm' => ['webm'],
        'video/quicktime' => ['mov'],
    ];

    public function index(int $id): JsonResponse|StreamedResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) {
            return $userId;
        }
        $this->rateLimit('groups_media_read', 120, 60);

        if (($authorizationError = $this->authorizeParent($id, $userId, false)) !== null) {
            return $authorizationError;
        }

        $tenantId = (int) TenantContext::getId();
        $contentId = $this->query('content');
        if ($contentId !== null) {
            if (! ctype_digit((string) $contentId) || (int) $contentId < 1) {
                return $this->respondWithError('NOT_FOUND', __('api.group_media_not_found'), null, 404);
            }
            return $this->streamMedia($id, (int) $contentId, $tenantId);
        }

        $limit = $this->queryInt('per_page', 20, 1, 100);
        $cursor = $this->query('cursor');
        $type = $this->query('type');
        if ($type !== null && ! in_array($type, ['image', 'video'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_media_filter_invalid'), 'type', 422);
        }

        $query = DB::table('group_media as m')
            ->leftJoin('users as u', function ($join) use ($tenantId): void {
                $join->on('u.id', '=', 'm.uploaded_by')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('m.group_id', $id)
            ->where('m.tenant_id', $tenantId)
            ->whereNotNull('m.file_path')
            ->where('m.file_path', '!=', '')
            ->select([
                'm.id', 'm.group_id', 'm.file_path', 'm.url', 'm.media_type as type',
                'm.original_name', 'm.mime_type', 'm.thumbnail_path', 'm.caption',
                'm.file_size', 'm.width', 'm.height', 'm.uploaded_by', 'm.created_at',
                'm.updated_at', 'u.name as uploader_name', 'u.avatar_url as uploader_avatar',
            ]);

        if ($type !== null) {
            $query->where('m.media_type', $type);
        }
        if ($cursor !== null && $cursor !== '') {
            $decodedCursor = $this->decodeMediaCursor($cursor);
            if ($decodedCursor === null) {
                return $this->respondWithError('INVALID_CURSOR', __('api.invalid_cursor'), 'cursor', 422);
            }
            $query->where('m.id', '<', $decodedCursor);
        }

        $rows = $query->orderByDesc('m.id')->limit($limit + 1)->get();
        $hasMore = $rows->count() > $limit;
        if ($hasMore) {
            $rows->pop();
        }
        $last = $rows->last();
        $viewerCanManage = GroupAccessService::canManage($id, $userId);

        return $this->successResponse([
            'items' => $rows
                ->map(fn (object $row): array => $this->serializeMedia($row, $id, $userId, $viewerCanManage))
                ->all(),
            'cursor' => $hasMore && $last !== null ? $this->encodeMediaCursor((int) $last->id) : null,
            'has_more' => $hasMore,
        ]);
    }

    public function upload(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) {
            return $userId;
        }
        $this->rateLimit('groups_media_upload', 10, 60);

        if (($authorizationError = $this->authorizeParent($id, $userId, true)) !== null) {
            return $authorizationError;
        }

        $file = request()->file('file');
        $caption = trim((string) request()->input('caption', ''));
        $validated = $this->validateMediaUpload($file, $caption);
        if ($validated instanceof JsonResponse) {
            return $validated;
        }

        $tenantId = (int) TenantContext::getId();
        try {
            GroupService::assertSafeguardingBroadcastAllowed(
                $id,
                $userId,
                $tenantId,
                'group_media_upload',
                trim($validated['name'] . ' ' . $caption),
            );
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        /** @var UploadedFile $file */
        $file = $validated['file'];
        $realPath = $file->getRealPath();
        if (! is_string($realPath) || $realPath === '') {
            return $this->respondWithError('UPLOAD_FAILED', __('api.group_media_store_failed'), 'file', 500);
        }
        $digest = hash_file('sha256', $realPath);
        if (! is_string($digest) || $digest === '') {
            return $this->respondWithError('UPLOAD_FAILED', __('api.group_media_store_failed'), 'file', 500);
        }
        $identity = GroupContentCreationReceiptService::identity(
            request()->header('Idempotency-Key') ?? request()->input('idempotency_key'),
            [
                'caption' => $caption,
                'digest' => $digest,
                'group_id' => $id,
                'mime' => $validated['mime'],
                'name' => $validated['name'],
                'size' => $validated['size'],
                'type' => $validated['type'],
            ],
        );
        if ($identity === false) {
            return $this->respondWithError('IDEMPOTENCY_INVALID', __('event_registration.idempotency_invalid'), 'idempotency_key', 422);
        }
        $path = $file->storeAs(
            "groups/{$tenantId}/{$id}/media",
            Str::random(40) . '.' . $validated['extension'],
            'local',
        );
        if (! is_string($path) || $path === '') {
            return $this->respondWithError('UPLOAD_FAILED', __('api.group_media_store_failed'), 'file', 500);
        }

        try {
            $mutation = DB::transaction(function () use ($id, $userId, $tenantId, $path, $validated, $caption, $identity): array {
                if ($identity !== null) {
                    GroupContentCreationReceiptService::lockActor($tenantId, $userId);
                    $receipt = GroupContentCreationReceiptService::find($tenantId, $userId, 'media', $identity['key_hash']);
                    if ($receipt !== null) {
                        return GroupContentCreationReceiptService::matches($receipt, $identity['request_hash'])
                            ? ['id' => (int) $receipt->result_id, 'replayed' => true, 'conflict' => false]
                            : ['id' => null, 'replayed' => true, 'conflict' => true];
                    }
                }

                DB::table('tenants')->where('id', $tenantId)->lockForUpdate()->first();
                $group = DB::table('groups')
                    ->where('id', $id)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                if ($group === null || $this->authorizeParent($id, $userId, true) !== null) {
                    return ['id' => null, 'replayed' => false, 'conflict' => false];
                }
                if (! $this->quotaAvailable($id, $tenantId, $validated['size'])) {
                    return ['id' => null, 'replayed' => false, 'conflict' => false];
                }

                $now = now();
                $mediaId = (int) DB::table('group_media')->insertGetId([
                    'group_id' => $id,
                    'tenant_id' => $tenantId,
                    'file_path' => $path,
                    'url' => null,
                    'media_type' => $validated['type'],
                    'original_name' => $validated['name'],
                    'mime_type' => $validated['mime'],
                    'thumbnail_path' => null,
                    'caption' => $caption !== '' ? $caption : null,
                    'file_size' => $validated['size'],
                    'width' => $validated['width'],
                    'height' => $validated['height'],
                    'uploaded_by' => $userId,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                GroupAuditService::log(
                    GroupAuditService::ACTION_MEDIA_UPLOADED,
                    $id,
                    $userId,
                    [
                        'media_id' => $mediaId,
                        'media_type' => $validated['type'],
                        'original_name' => $validated['name'],
                        'file_size' => $validated['size'],
                        'target_user_id' => $userId,
                    ],
                );

                if ($identity !== null) {
                    GroupContentCreationReceiptService::store(
                        $tenantId,
                        $userId,
                        $id,
                        'media',
                        $identity,
                        $mediaId,
                        ['id' => $mediaId],
                    );
                }

                return ['id' => $mediaId, 'replayed' => false, 'conflict' => false];
            }, 3);
        } catch (Throwable $exception) {
            Storage::disk('local')->delete($path);
            Log::error('Group media database write failed after storage', [
                'group_id' => $id,
                'error' => $exception->getMessage(),
            ]);
            return $this->respondWithError('UPLOAD_FAILED', __('api.group_media_store_failed'), 'file', 500);
        }

        if ($mutation['conflict']) {
            Storage::disk('local')->delete($path);
            return $this->respondWithError('IDEMPOTENCY_CONFLICT', __('event_registration.idempotency_conflict'), 'idempotency_key', 409);
        }

        $mediaId = $mutation['id'];
        if ($mutation['replayed']) {
            Storage::disk('local')->delete($path);
        }
        if ($mediaId === null) {
            Storage::disk('local')->delete($path);
            return $this->respondWithError('UPLOAD_FAILED', __('api.group_media_store_failed'), 'file', 409);
        }

        $row = DB::table('group_media as m')
            ->leftJoin('users as u', function ($join) use ($tenantId): void {
                $join->on('u.id', '=', 'm.uploaded_by')->where('u.tenant_id', '=', $tenantId);
            })
            ->where('m.id', $mediaId)
            ->where('m.tenant_id', $tenantId)
            ->select([
                'm.id', 'm.group_id', 'm.file_path', 'm.url', 'm.media_type as type',
                'm.original_name', 'm.mime_type', 'm.thumbnail_path', 'm.caption',
                'm.file_size', 'm.width', 'm.height', 'm.uploaded_by', 'm.created_at',
                'm.updated_at', 'u.name as uploader_name', 'u.avatar_url as uploader_avatar',
            ])
            ->first();
        if ($row === null) {
            return $this->respondWithError('NOT_FOUND', __('api.group_media_not_found'), null, 404);
        }

        return $this->successResponse(
            $this->serializeMedia($row, $id, $userId, GroupAccessService::canManage($id, $userId)),
            201,
        );
    }

    public function destroy(int $id, int $mediaId): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) {
            return $userId;
        }
        $this->rateLimit('groups_media_delete', 20, 60);

        if (($authorizationError = $this->authorizeParent($id, $userId, true)) !== null) {
            return $authorizationError;
        }
        $tenantId = (int) TenantContext::getId();

        try {
            $result = (new GroupStorageQuarantine())->run(function (\Closure $quarantine) use ($id, $mediaId, $userId, $tenantId): string {
                DB::table('groups')
                    ->where('id', $id)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                $media = DB::table('group_media')
                    ->where('id', $mediaId)
                    ->where('group_id', $id)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                if ($media === null) {
                    return 'not_found';
                }
                if ((int) $media->uploaded_by !== $userId && ! GroupAccessService::canManage($id, $userId)) {
                    return 'forbidden';
                }

                $assets = [];
                foreach ([$media->file_path ?? null, $media->thumbnail_path ?? null] as $storedPath) {
                    if (! is_string($storedPath) || ! $this->isSafeStoragePath($storedPath, $tenantId, $id)) {
                        continue;
                    }
                    foreach (['local', 'public'] as $diskName) {
                        $assets[] = ['disk' => $diskName, 'path' => $storedPath];
                    }
                }
                $quarantine($assets);

                $deleted = DB::table('group_media')
                    ->where('id', $mediaId)
                    ->where('group_id', $id)
                    ->where('tenant_id', $tenantId)
                    ->delete();
                if ($deleted !== 1) {
                    throw new \RuntimeException('Group media metadata delete lost its locked row.');
                }

                DB::table('group_content_creation_receipts')
                    ->where('tenant_id', $tenantId)
                    ->where('group_id', $id)
                    ->where('operation_type', 'media')
                    ->where('result_id', $mediaId)
                    ->delete();

                GroupAuditService::log(
                    GroupAuditService::ACTION_MEDIA_DELETED,
                    $id,
                    $userId,
                    [
                        'media_id' => $mediaId,
                        'media_type' => (string) $media->media_type,
                        'original_name' => (string) ($media->original_name ?? ''),
                        'file_size' => (int) ($media->file_size ?? 0),
                        'target_user_id' => (int) $media->uploaded_by,
                    ],
                );

                return 'deleted';
            });
        } catch (GroupStorageQuarantineException $exception) {
            Log::error('Group media storage quarantine failed', [
                'group_id' => $id,
                'media_id' => $mediaId,
                'error' => $exception->getMessage(),
            ]);
            return $this->respondWithError('STORAGE_DELETE_FAILED', __('api.group_media_delete_storage_failed'), null, 500);
        } catch (Throwable $exception) {
            Log::error('Group media delete failed', [
                'group_id' => $id,
                'media_id' => $mediaId,
                'error' => $exception->getMessage(),
            ]);
            return $this->respondWithError('DELETE_FAILED', __('api.group_media_delete_failed'), null, 500);
        }

        return match ($result) {
            'deleted' => $this->successResponse(['message' => __('api_controllers_3.group_media.media_deleted')]),
            'forbidden' => $this->respondWithError('FORBIDDEN', __('api.group_media_delete_forbidden'), null, 403),
            'storage_failed' => $this->respondWithError('STORAGE_DELETE_FAILED', __('api.group_media_delete_storage_failed'), null, 500),
            default => $this->respondWithError('NOT_FOUND', __('api.group_media_not_found'), null, 404),
        };
    }

    private function validateMediaUpload(mixed $file, string $caption): array|JsonResponse
    {
        if (! $file instanceof UploadedFile || ! $file->isValid()) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_media_file_required'), 'file', 400);
        }
        if (mb_strlen($caption) > self::MAX_CAPTION_LENGTH) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_media_caption_too_long', ['max' => self::MAX_CAPTION_LENGTH]), 'caption', 422);
        }

        $size = (int) $file->getSize();
        if ($size < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_media_empty'), 'file', 422);
        }
        if ($size > self::MAX_FILE_SIZE) {
            return $this->respondWithError('FILE_TOO_LARGE', __('api.group_media_size_exceeded'), 'file', 413);
        }

        $name = trim($file->getClientOriginalName());
        if ($name === '' || mb_strlen($name) > 255 || preg_match('/[\x00-\x1F\x7F]/u', $name) === 1
            || str_contains($name, '/') || str_contains($name, '\\')) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_media_name_invalid'), 'file', 422);
        }

        $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $mime = strtolower(trim(explode(';', (string) $file->getMimeType(), 2)[0]));
        if (! isset(self::MIME_EXTENSIONS[$mime]) || ! in_array($extension, self::MIME_EXTENSIONS[$mime], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_media_type_not_allowed'), 'file', 422);
        }

        $type = str_starts_with($mime, 'image/') ? 'image' : 'video';
        $width = null;
        $height = null;
        if ($type === 'image') {
            $realPath = $file->getRealPath();
            $dimensions = is_string($realPath) ? @getimagesize($realPath) : false;
            $width = (int) ($dimensions[0] ?? 0);
            $height = (int) ($dimensions[1] ?? 0);
            if ($dimensions === false || $width < 1 || $height < 1 || ($width * $height) > self::MAX_IMAGE_PIXELS) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.group_media_dimensions_invalid'), 'file', 422);
            }
        }

        return [
            'file' => $file,
            'name' => $name,
            'extension' => $extension,
            'mime' => $mime,
            'type' => $type,
            'size' => $size,
            'width' => $width,
            'height' => $height,
        ];
    }

    private function quotaAvailable(int $groupId, int $tenantId, int $incomingBytes): bool
    {
        $groupBytes = (int) DB::table('group_files')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->sum('file_size')
            + (int) DB::table('group_media')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->sum('file_size');
        if ($groupBytes + $incomingBytes > GroupFileService::MAX_GROUP_STORAGE) {
            return false;
        }

        $tenantBytes = (int) DB::table('group_files')->where('tenant_id', $tenantId)->sum('file_size')
            + (int) DB::table('group_media')->where('tenant_id', $tenantId)->sum('file_size');
        return $tenantBytes + $incomingBytes <= GroupFileService::MAX_TENANT_STORAGE;
    }

    private function authorizeParent(int $groupId, int $userId, bool $write): ?JsonResponse
    {
        $tenantId = (int) TenantContext::getId();
        if (! DB::table('groups')->where('id', $groupId)->where('tenant_id', $tenantId)->exists()) {
            return $this->respondWithError('NOT_FOUND', __('api.group_not_found'), null, 404);
        }

        $allowed = $write
            ? GroupAccessService::canWriteContent($groupId, $userId)
            : GroupAccessService::canViewMemberContent($groupId, $userId);
        if (! $allowed) {
            return $this->respondWithError(
                'FORBIDDEN',
                $write ? __('api.group_media_upload_forbidden') : __('api.group_media_forbidden'),
                null,
                403,
            );
        }

        return null;
    }

    private function streamMedia(int $groupId, int $mediaId, int $tenantId): JsonResponse|StreamedResponse
    {
        $media = DB::table('group_media')
            ->where('id', $mediaId)
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->first();
        if ($media === null) {
            return $this->respondWithError('NOT_FOUND', __('api.group_media_not_found'), null, 404);
        }

        $thumbnail = $this->query('variant') === 'thumbnail';
        $path = (string) ($thumbnail ? ($media->thumbnail_path ?? '') : ($media->file_path ?? ''));
        $disk = Storage::disk('local');
        if (! $this->isSafeStoragePath($path, $tenantId, $groupId) || ! $disk->exists($path)) {
            return $this->respondWithError('NOT_FOUND', __('api.group_media_not_found'), null, 404);
        }

        try {
            $mime = $disk->mimeType($path) ?: 'application/octet-stream';
        } catch (Throwable) {
            $mime = 'application/octet-stream';
        }
        $filename = (string) ($media->original_name ?: basename($path));

        return $disk->response($path, $filename, [
            'Content-Type' => $mime,
            'Content-Disposition' => 'inline; filename="' . addslashes($filename) . '"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'Cross-Origin-Resource-Policy' => 'same-origin',
        ]);
    }

    private function serializeMedia(
        object $media,
        int $groupId,
        int $viewerUserId,
        bool $viewerCanManage,
    ): array {
        $hasPrivateFile = is_string($media->file_path ?? null) && $media->file_path !== '';
        return [
            'id' => (int) $media->id,
            'group_id' => $groupId,
            'type' => (string) $media->type,
            'original_name' => $media->original_name !== null ? (string) $media->original_name : null,
            'mime_type' => $media->mime_type !== null ? (string) $media->mime_type : null,
            'url' => $hasPrivateFile ? $this->protectedMediaUrl($groupId, (int) $media->id) : null,
            'thumbnail_url' => ! empty($media->thumbnail_path)
                ? $this->protectedMediaUrl($groupId, (int) $media->id, true)
                : null,
            'caption' => $media->caption !== null ? (string) $media->caption : null,
            'file_size' => (int) $media->file_size,
            'width' => $media->width !== null ? (int) $media->width : null,
            'height' => $media->height !== null ? (int) $media->height : null,
            'uploaded_by' => (int) $media->uploaded_by,
            'uploader_name' => (string) ($media->uploader_name ?? ''),
            'uploader_avatar' => $media->uploader_avatar !== null ? (string) $media->uploader_avatar : null,
            'uploader' => [
                'id' => (int) $media->uploaded_by,
                'name' => (string) ($media->uploader_name ?? ''),
                'avatar_url' => $media->uploader_avatar !== null ? (string) $media->uploader_avatar : null,
            ],
            'created_at' => CarbonImmutable::parse($media->created_at)->toIso8601String(),
            'updated_at' => CarbonImmutable::parse($media->updated_at ?? $media->created_at)->toIso8601String(),
            'capabilities' => [
                'can_view' => true,
                'can_delete' => $viewerCanManage || (int) $media->uploaded_by === $viewerUserId,
            ],
        ];
    }

    private function protectedMediaUrl(int $groupId, int $mediaId, bool $thumbnail = false): string
    {
        return "/api/v2/groups/{$groupId}/media?content={$mediaId}" . ($thumbnail ? '&variant=thumbnail' : '');
    }

    private function encodeMediaCursor(int $id): string
    {
        return base64_encode((string) $id);
    }

    private function decodeMediaCursor(string $cursor): ?int
    {
        $decoded = base64_decode($cursor, true);
        return $decoded !== false && ctype_digit($decoded) && (int) $decoded > 0 ? (int) $decoded : null;
    }

    private function isSafeStoragePath(string $path, int $tenantId, int $groupId): bool
    {
        if ($path === '' || str_contains($path, "\0")) {
            return false;
        }
        $normalized = str_replace('\\', '/', $path);
        if (str_starts_with($normalized, '/') || preg_match('/^[A-Za-z]:\//', $normalized) === 1) {
            return false;
        }
        foreach (explode('/', $normalized) as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                return false;
            }
        }

        return str_starts_with($normalized, "groups/{$tenantId}/{$groupId}/media/");
    }
}
