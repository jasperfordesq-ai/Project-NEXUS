<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\GroupStorageQuarantineException;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;
use ZipArchive;

/** Manages tenant-scoped, private group files and their metadata. */
final class GroupFileService
{
    public const MAX_FILE_SIZE = 25 * 1024 * 1024;
    public const MAX_GROUP_STORAGE = 500 * 1024 * 1024;
    public const MAX_TENANT_STORAGE = 10 * 1024 * 1024 * 1024;
    public const MAX_IMAGE_PIXELS = 25_000_000;
    public const MAX_FOLDER_LENGTH = 100;
    public const MAX_DESCRIPTION_LENGTH = 2_000;

    /** @var list<array{code: string, message: string, field?: string}> */
    private array $errors = [];

    /**
     * Content MIME to permitted filename extensions. SVG is intentionally
     * excluded because it can contain script and event handlers.
     *
     * @var array<string, list<string>>
     */
    private const MIME_EXTENSIONS = [
        'image/jpeg' => ['jpg', 'jpeg'],
        'image/png' => ['png'],
        'image/gif' => ['gif'],
        'image/webp' => ['webp'],
        'application/pdf' => ['pdf'],
        'application/msword' => ['doc'],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => ['docx'],
        'application/vnd.ms-excel' => ['xls'],
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => ['xlsx'],
        'application/vnd.ms-powerpoint' => ['ppt'],
        'application/vnd.openxmlformats-officedocument.presentationml.presentation' => ['pptx'],
        'text/plain' => ['txt', 'csv', 'md', 'markdown'],
        'text/csv' => ['csv'],
        'text/markdown' => ['md', 'markdown'],
        'application/zip' => ['zip'],
        'application/x-rar-compressed' => ['rar'],
        'application/vnd.rar' => ['rar'],
        'video/mp4' => ['mp4', 'm4v'],
        'video/webm' => ['webm'],
        'audio/mpeg' => ['mp3'],
        'audio/wav' => ['wav'],
        'audio/x-wav' => ['wav'],
        'audio/ogg' => ['ogg', 'oga'],
    ];

    /** @return list<array{code: string, message: string, field?: string}> */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /** List files without exposing internal storage paths. */
    public function list(int $groupId, int $userId, array $filters = []): ?array
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();

        if (! $this->authorizeParent($groupId, $userId, false)) {
            return null;
        }

        $limit = max(1, min((int) ($filters['limit'] ?? 20), 100));
        $cursor = $filters['cursor'] ?? null;
        $folder = $filters['folder'] ?? null;
        $search = trim((string) ($filters['search'] ?? ''));
        $viewerCanManage = GroupAccessService::canManage($groupId, $userId);

        $query = DB::table('group_files as gf')
            ->join('users as u', function ($join) use ($tenantId): void {
                $join->on('gf.uploaded_by', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('gf.group_id', $groupId)
            ->where('gf.tenant_id', $tenantId)
            ->select([
                'gf.id',
                'gf.group_id',
                'gf.file_name',
                'gf.file_type',
                'gf.file_size',
                'gf.uploaded_by',
                'gf.folder',
                'gf.description',
                'gf.download_count',
                'gf.created_at',
                'gf.updated_at',
                'u.name as uploader_name',
                'u.avatar_url as uploader_avatar',
            ]);

        if ($folder !== null && $folder !== '') {
            $query->where('gf.folder', (string) $folder);
        }
        if ($search !== '') {
            $escaped = addcslashes($search, '\\%_');
            $query->where('gf.file_name', 'LIKE', '%' . $escaped . '%');
        }
        if ($cursor !== null && $cursor !== '') {
            $decoded = is_string($cursor) ? base64_decode($cursor, true) : false;
            if ($decoded === false || ! ctype_digit($decoded) || (int) $decoded < 1) {
                $this->errors[] = ['code' => 'INVALID_CURSOR', 'message' => __('api.invalid_cursor')];
                return null;
            }
            $query->where('gf.id', '<', (int) $decoded);
        }

        $rows = $query->orderByDesc('gf.id')->limit($limit + 1)->get();
        $hasMore = $rows->count() > $limit;
        if ($hasMore) {
            $rows->pop();
        }
        $last = $rows->last();

        return [
            'items' => $rows
                ->map(fn (object $row): array => $this->serializeFile($row, $userId, $viewerCanManage))
                ->all(),
            'cursor' => $hasMore && $last !== null ? base64_encode((string) $last->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /** Upload a validated file and compensate storage if the database write fails. */
    public function upload(int $groupId, int $userId, array $fileData): ?array
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();

        if (! $this->authorizeParent($groupId, $userId, true)) {
            return null;
        }

        $validated = $this->validateUpload($fileData);
        if ($validated === null) {
            return null;
        }

        /** @var UploadedFile $file */
        $file = $validated['file'];
        $originalName = $validated['name'];
        $mimeType = $validated['mime'];
        $extension = $validated['extension'];
        $folder = $validated['folder'];
        $description = $validated['description'];
        $fileSize = $validated['size'];

        $realPath = $file->getRealPath();
        if (! is_string($realPath) || $realPath === '') {
            $this->errors[] = ['code' => 'UPLOAD_FAILED', 'message' => __('api.group_file_store_failed')];
            return null;
        }
        $digest = hash_file('sha256', $realPath);
        if (! is_string($digest) || $digest === '') {
            $this->errors[] = ['code' => 'UPLOAD_FAILED', 'message' => __('api.group_file_store_failed')];
            return null;
        }
        $identity = GroupContentCreationReceiptService::identity(
            $fileData['idempotency_key'] ?? null,
            [
                'description' => $description,
                'digest' => $digest,
                'folder' => $folder,
                'group_id' => $groupId,
                'mime' => $mimeType,
                'name' => $originalName,
                'size' => $fileSize,
            ],
        );
        if ($identity === false) {
            $this->errors[] = ['code' => 'IDEMPOTENCY_INVALID', 'message' => __('event_registration.idempotency_invalid'), 'field' => 'idempotency_key'];
            return null;
        }

        GroupService::assertSafeguardingBroadcastAllowed(
            $groupId,
            $userId,
            $tenantId,
            'group_file_upload',
            trim($originalName . ' ' . (string) $folder . ' ' . (string) $description),
        );

        $storedName = Str::random(40) . '.' . $extension;
        $path = $file->storeAs("groups/{$tenantId}/{$groupId}", $storedName, 'local');
        if (! is_string($path) || $path === '') {
            $this->errors[] = ['code' => 'UPLOAD_FAILED', 'message' => __('api.group_file_store_failed')];
            return null;
        }

        try {
            $mutation = DB::transaction(function () use (
                $groupId,
                $userId,
                $tenantId,
                $originalName,
                $path,
                $mimeType,
                $fileSize,
                $folder,
                $description,
                $identity,
            ): array {
                if ($identity !== null) {
                    GroupContentCreationReceiptService::lockActor($tenantId, $userId);
                    $receipt = GroupContentCreationReceiptService::find($tenantId, $userId, 'file', $identity['key_hash']);
                    if ($receipt !== null) {
                        return GroupContentCreationReceiptService::matches($receipt, $identity['request_hash'])
                            ? ['id' => (int) $receipt->result_id, 'replayed' => true, 'conflict' => false]
                            : ['id' => null, 'replayed' => true, 'conflict' => true];
                    }
                }

                DB::table('tenants')->where('id', $tenantId)->lockForUpdate()->first();
                $group = DB::table('groups')
                    ->where('id', $groupId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                if ($group === null || ! $this->authorizeParent($groupId, $userId, true)) {
                    return ['id' => null, 'replayed' => false, 'conflict' => false];
                }
                if (! $this->assertQuotaAvailable($groupId, $tenantId, $fileSize)) {
                    return ['id' => null, 'replayed' => false, 'conflict' => false];
                }

                $now = now();
                $fileId = (int) DB::table('group_files')->insertGetId([
                    'group_id' => $groupId,
                    'tenant_id' => $tenantId,
                    'file_name' => $originalName,
                    'file_path' => $path,
                    'file_type' => $mimeType,
                    'file_size' => $fileSize,
                    'uploaded_by' => $userId,
                    'folder' => $folder,
                    'description' => $description,
                    'download_count' => 0,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                GroupAuditService::log(
                    GroupAuditService::ACTION_FILE_UPLOADED,
                    $groupId,
                    $userId,
                    [
                        'file_id' => $fileId,
                        'file_name' => $originalName,
                        'file_type' => $mimeType,
                        'file_size' => $fileSize,
                        'target_user_id' => $userId,
                    ],
                );

                GroupWebhookService::fire($groupId, GroupWebhookService::EVENT_FILE_UPLOADED, [
                    'file_id' => $fileId,
                    'file_name' => $originalName,
                ]);

                if ($identity !== null) {
                    GroupContentCreationReceiptService::store(
                        $tenantId,
                        $userId,
                        $groupId,
                        'file',
                        $identity,
                        $fileId,
                        ['id' => $fileId],
                    );
                }

                return ['id' => $fileId, 'replayed' => false, 'conflict' => false];
            }, 3);
        } catch (Throwable $exception) {
            Storage::disk('local')->delete($path);
            throw $exception;
        }

        if ($mutation['conflict']) {
            Storage::disk('local')->delete($path);
            $this->errors[] = ['code' => 'IDEMPOTENCY_CONFLICT', 'message' => __('event_registration.idempotency_conflict'), 'field' => 'idempotency_key'];
            return null;
        }

        $fileId = $mutation['id'];
        if ($mutation['replayed']) {
            Storage::disk('local')->delete($path);
        }
        if ($fileId === null) {
            Storage::disk('local')->delete($path);
            return null;
        }

        if (! $mutation['replayed']) {
            try { GroupChallengeService::incrementProgress($groupId, 'files'); } catch (Throwable $e) { Log::warning('GroupFileService: challenge progress failed', ['group_id' => $groupId, 'error' => $e->getMessage()]); }
        }

        $row = DB::table('group_files as gf')
            ->join('users as u', function ($join) use ($tenantId): void {
                $join->on('gf.uploaded_by', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('gf.id', $fileId)
            ->where('gf.tenant_id', $tenantId)
            ->select([
                'gf.id', 'gf.group_id', 'gf.file_name', 'gf.file_type', 'gf.file_size',
                'gf.uploaded_by', 'gf.folder', 'gf.description', 'gf.download_count',
                'gf.created_at', 'gf.updated_at', 'u.name as uploader_name',
                'u.avatar_url as uploader_avatar',
            ])
            ->first();

        return $row === null ? null : $this->serializeFile($row, $userId, GroupAccessService::canManage($groupId, $userId));
    }

    /** Return private stream metadata for the controller only. */
    public function download(int $groupId, int $fileId, int $userId): ?array
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();

        if (! $this->authorizeParent($groupId, $userId, false)) {
            return null;
        }

        $file = DB::table('group_files')
            ->where('id', $fileId)
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->first();
        if ($file === null) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_file_not_found')];
            return null;
        }

        $path = (string) $file->file_path;
        if (! $this->isSafeStoragePath($path, $tenantId, $groupId)
            || ! Storage::disk('local')->exists($path)) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_file_missing_on_disk')];
            return null;
        }

        DB::table('group_files')
            ->where('id', $fileId)
            ->where('tenant_id', $tenantId)
            ->increment('download_count');

        return [
            'file_path' => $path,
            'file_name' => (string) $file->file_name,
            'file_type' => (string) $file->file_type,
            'file_size' => (int) $file->file_size,
        ];
    }

    /** Delete a row and its private bytes with rollback compensation. */
    public function delete(int $groupId, int $fileId, int $userId): bool
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();
        if (! $this->authorizeParent($groupId, $userId, true)) {
            return false;
        }

        try {
            return (new GroupStorageQuarantine())->run(function (Closure $quarantine) use ($groupId, $fileId, $userId, $tenantId): bool {
                DB::table('groups')
                    ->where('id', $groupId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                $file = DB::table('group_files')
                    ->where('id', $fileId)
                    ->where('group_id', $groupId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                if ($file === null) {
                    $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_file_not_found')];
                    return false;
                }

                if ((int) $file->uploaded_by !== $userId && ! GroupAccessService::canManage($groupId, $userId)) {
                    $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_file_delete_forbidden')];
                    return false;
                }

                $path = (string) $file->file_path;
                if ($this->isSafeStoragePath($path, $tenantId, $groupId)
                    && Storage::disk('local')->exists($path)) {
                    $quarantine([['disk' => 'local', 'path' => $path]]);
                }

                $deleted = DB::table('group_files')
                    ->where('id', $fileId)
                    ->where('tenant_id', $tenantId)
                    ->delete();
                if ($deleted !== 1) {
                    throw new \RuntimeException('Group file metadata delete lost its locked row.');
                }

                DB::table('group_content_creation_receipts')
                    ->where('tenant_id', $tenantId)
                    ->where('group_id', $groupId)
                    ->where('operation_type', 'file')
                    ->where('result_id', $fileId)
                    ->delete();

                GroupAuditService::log(
                    GroupAuditService::ACTION_FILE_DELETED,
                    $groupId,
                    $userId,
                    [
                        'file_id' => $fileId,
                        'file_name' => (string) $file->file_name,
                        'file_type' => (string) $file->file_type,
                        'file_size' => (int) $file->file_size,
                        'target_user_id' => (int) $file->uploaded_by,
                    ],
                );

                return true;
            });
        } catch (GroupStorageQuarantineException $exception) {
            Log::error('GroupFileService: storage quarantine failed', [
                'group_id' => $groupId,
                'file_id' => $fileId,
                'error' => $exception->getMessage(),
            ]);
            $this->errors[] = ['code' => 'STORAGE_DELETE_FAILED', 'message' => __('api.group_file_delete_storage_failed')];
            return false;
        } catch (Throwable $exception) {
            Log::error('GroupFileService: delete failed', [
                'group_id' => $groupId,
                'file_id' => $fileId,
                'error' => $exception->getMessage(),
            ]);
            $this->errors[] = ['code' => 'DELETE_FAILED', 'message' => __('api.group_file_delete_failed')];
            return false;
        }
    }

    public function getFolders(int $groupId, int $userId): ?array
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();
        if (! $this->authorizeParent($groupId, $userId, false)) {
            return null;
        }

        return DB::table('group_files')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->whereNotNull('folder')
            ->where('folder', '!=', '')
            ->select('folder', DB::raw('COUNT(*) as file_count'))
            ->groupBy('folder')
            ->orderBy('folder')
            ->get()
            ->map(fn (object $row): array => ['folder' => (string) $row->folder, 'file_count' => (int) $row->file_count])
            ->all();
    }

    public function getStats(int $groupId, int $userId): ?array
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();
        if (! $this->authorizeParent($groupId, $userId, false)) {
            return null;
        }

        $stats = DB::table('group_files')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->selectRaw('COUNT(*) as total_files, COALESCE(SUM(file_size), 0) as total_size, COUNT(DISTINCT uploaded_by) as unique_uploaders')
            ->first();

        return [
            'total_files' => (int) ($stats->total_files ?? 0),
            'total_size' => (int) ($stats->total_size ?? 0),
            'unique_uploaders' => (int) ($stats->unique_uploaders ?? 0),
            'group_quota' => self::MAX_GROUP_STORAGE,
            'tenant_quota' => self::MAX_TENANT_STORAGE,
        ];
    }

    /** @return array{file: UploadedFile, name: string, extension: string, mime: string, size: int, folder: ?string, description: ?string}|null */
    private function validateUpload(array $fileData): ?array
    {
        $file = $fileData['file'] ?? null;
        if (! $file instanceof UploadedFile || ! $file->isValid()) {
            $this->errors[] = ['code' => 'INVALID_FILE', 'message' => __('api.group_file_required'), 'field' => 'file'];
            return null;
        }

        $size = (int) $file->getSize();
        if ($size < 1) {
            $this->errors[] = ['code' => 'INVALID_FILE', 'message' => __('api.group_file_empty'), 'field' => 'file'];
            return null;
        }
        if ($size > self::MAX_FILE_SIZE) {
            $this->errors[] = ['code' => 'FILE_TOO_LARGE', 'message' => __('api.group_file_size_exceeded'), 'field' => 'file'];
            return null;
        }

        $name = trim($file->getClientOriginalName());
        if ($name === '' || mb_strlen($name) > 255 || preg_match('/[\\x00-\\x1F\\x7F]/u', $name) === 1
            || str_contains($name, '/') || str_contains($name, '\\')) {
            $this->errors[] = ['code' => 'INVALID_NAME', 'message' => __('api.group_file_name_invalid'), 'field' => 'file'];
            return null;
        }

        $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $realPath = $file->getRealPath();
        if ($extension === '' || ! is_string($realPath) || $realPath === '') {
            $this->errors[] = ['code' => 'INVALID_TYPE', 'message' => __('api.group_file_extension_invalid'), 'field' => 'file'];
            return null;
        }
        $mime = $this->normalizeContentMime($realPath, $extension, (string) $file->getMimeType());
        if ($mime === null || ! in_array($extension, self::MIME_EXTENSIONS[$mime] ?? [], true)) {
            $this->errors[] = ['code' => 'INVALID_TYPE', 'message' => __('api.group_file_type_not_allowed'), 'field' => 'file'];
            return null;
        }

        if (str_starts_with($mime, 'image/')) {
            $dimensions = @getimagesize($realPath);
            $width = (int) ($dimensions[0] ?? 0);
            $height = (int) ($dimensions[1] ?? 0);
            if ($dimensions === false || $width < 1 || $height < 1 || ($width * $height) > self::MAX_IMAGE_PIXELS) {
                $this->errors[] = ['code' => 'INVALID_DIMENSIONS', 'message' => __('api.group_file_dimensions_invalid'), 'field' => 'file'];
                return null;
            }
        }

        $folder = trim((string) ($fileData['folder'] ?? ''));
        if ($folder !== '' && (mb_strlen($folder) > self::MAX_FOLDER_LENGTH
            || preg_match('/[\\x00-\\x1F\\x7F]/u', $folder) === 1
            || str_contains($folder, '/') || str_contains($folder, '\\')
            || in_array($folder, ['.', '..'], true))) {
            $this->errors[] = ['code' => 'INVALID_FOLDER', 'message' => __('api.group_file_folder_invalid'), 'field' => 'folder'];
            return null;
        }

        $description = trim((string) ($fileData['description'] ?? ''));
        if (mb_strlen($description) > self::MAX_DESCRIPTION_LENGTH) {
            $this->errors[] = ['code' => 'DESCRIPTION_TOO_LONG', 'message' => __('api.group_file_description_too_long', ['max' => self::MAX_DESCRIPTION_LENGTH]), 'field' => 'description'];
            return null;
        }

        return [
            'file' => $file,
            'name' => $name,
            'extension' => $extension,
            'mime' => $mime,
            'size' => $size,
            'folder' => $folder !== '' ? $folder : null,
            'description' => $description !== '' ? $description : null,
        ];
    }

    private function normalizeContentMime(string $path, string $extension, string $detectedMime): ?string
    {
        $mime = strtolower(trim(explode(';', $detectedMime, 2)[0]));
        if ($mime === 'application/zip' && in_array($extension, ['docx', 'xlsx', 'pptx'], true)) {
            if (! class_exists(ZipArchive::class)) {
                return null;
            }
            $zip = new ZipArchive();
            if ($zip->open($path) !== true || $zip->locateName('[Content_Types].xml') === false) {
                $zip->close();
                return null;
            }
            $requiredDirectory = ['docx' => 'word/', 'xlsx' => 'xl/', 'pptx' => 'ppt/'][$extension];
            $valid = false;
            for ($index = 0; $index < $zip->numFiles; ++$index) {
                $entry = $zip->getNameIndex($index);
                if (is_string($entry) && str_starts_with($entry, $requiredDirectory)) {
                    $valid = true;
                    break;
                }
            }
            $zip->close();
            if (! $valid) {
                return null;
            }
            return [
                'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            ][$extension];
        }

        if ($mime === 'text/plain' && $extension === 'csv') {
            return 'text/csv';
        }
        if ($mime === 'text/plain' && in_array($extension, ['md', 'markdown'], true)) {
            return 'text/markdown';
        }

        return array_key_exists($mime, self::MIME_EXTENSIONS) ? $mime : null;
    }

    private function assertQuotaAvailable(int $groupId, int $tenantId, int $incomingBytes): bool
    {
        $groupBytes = (int) DB::table('group_files')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->sum('file_size')
            + (int) DB::table('group_media')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->sum('file_size');
        if ($groupBytes + $incomingBytes > self::MAX_GROUP_STORAGE) {
            $this->errors[] = ['code' => 'GROUP_QUOTA_EXCEEDED', 'message' => __('api.group_storage_quota_exceeded')];
            return false;
        }

        $tenantBytes = (int) DB::table('group_files')->where('tenant_id', $tenantId)->sum('file_size')
            + (int) DB::table('group_media')->where('tenant_id', $tenantId)->sum('file_size');
        if ($tenantBytes + $incomingBytes > self::MAX_TENANT_STORAGE) {
            $this->errors[] = ['code' => 'TENANT_QUOTA_EXCEEDED', 'message' => __('api.tenant_group_storage_quota_exceeded')];
            return false;
        }

        return true;
    }

    private function serializeFile(object $file, int $viewerUserId, bool $viewerCanManage): array
    {
        return [
            'id' => (int) $file->id,
            'group_id' => (int) $file->group_id,
            'file_name' => (string) $file->file_name,
            'file_type' => (string) $file->file_type,
            'file_size' => (int) $file->file_size,
            'folder' => $file->folder !== null ? (string) $file->folder : null,
            'description' => $file->description !== null ? (string) $file->description : null,
            'download_count' => (int) $file->download_count,
            'uploaded_by' => (int) $file->uploaded_by,
            'uploader_name' => (string) $file->uploader_name,
            'uploader_avatar' => $file->uploader_avatar !== null ? (string) $file->uploader_avatar : null,
            'uploader' => [
                'id' => (int) $file->uploaded_by,
                'name' => (string) $file->uploader_name,
                'avatar_url' => $file->uploader_avatar !== null ? (string) $file->uploader_avatar : null,
            ],
            'created_at' => CarbonImmutable::parse($file->created_at)->toIso8601String(),
            'updated_at' => CarbonImmutable::parse($file->updated_at ?? $file->created_at)->toIso8601String(),
            'capabilities' => [
                'can_download' => true,
                'can_delete' => $viewerCanManage || (int) $file->uploaded_by === $viewerUserId,
            ],
        ];
    }

    private function authorizeParent(int $groupId, int $userId, bool $write): bool
    {
        $tenantId = (int) TenantContext::getId();
        if (! DB::table('groups')->where('id', $groupId)->where('tenant_id', $tenantId)->exists()) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_not_found')];
            return false;
        }

        $allowed = $write
            ? GroupAccessService::canWriteContent($groupId, $userId)
            : GroupAccessService::canViewMemberContent($groupId, $userId);
        if (! $allowed) {
            $this->errors[] = [
                'code' => 'FORBIDDEN',
                'message' => $write ? __('api.group_files_upload_forbidden') : __('api.group_files_member_required'),
            ];
            return false;
        }

        return true;
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

        return str_starts_with($normalized, "groups/{$tenantId}/{$groupId}/");
    }
}
