<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * KnowledgeBaseAttachmentService — Handles file attachments for KB articles.
 *
 * Supports PDF, Markdown, plain text, Word documents.
 */
class KnowledgeBaseAttachmentService
{
    private const ALLOWED_EXTENSIONS = ['pdf', 'md', 'txt', 'doc', 'docx', 'csv', 'xls', 'xlsx'];

    private const ALLOWED_MIMES = [
        'application/pdf',
        'text/plain',
        'text/markdown',
        'text/x-markdown',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
    ];

    /**
     * Attachments are stored privately and served only through the API
     * download route, which applies the draft-article and tenant rules. They
     * used to be written to the public disk, where /storage served them to
     * anyone with the URL (F-556, E-088); files written then stay there and
     * are still read from it.
     */
    public const DISK = 'local';

    private const LEGACY_DISK = 'public';

    /**
     * The disk that holds this attachment: private for everything uploaded
     * since F-556, public for older uploads.
     */
    public static function diskFor(string $path): \Illuminate\Contracts\Filesystem\Filesystem
    {
        $private = Storage::disk(self::DISK);

        return $private->exists($path) ? $private : Storage::disk(self::LEGACY_DISK);
    }

    /**
     * Get all attachments for an article.
     */
    public function getByArticleId(int $articleId): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('knowledge_base_attachments')
            ->where('article_id', $articleId)
            ->where('tenant_id', $tenantId)
            ->orderBy('sort_order')
            ->orderBy('created_at')
            ->get()
            ->map(fn ($a) => [
                'id'         => (int) $a->id,
                'file_name'  => $a->file_name,
                'file_url'   => $a->file_url,
                'mime_type'  => $a->mime_type,
                'file_size'  => (int) $a->file_size,
                'sort_order' => (int) $a->sort_order,
                'created_at' => $a->created_at,
            ])
            ->all();
    }

    /**
     * Upload and attach a file to a KB article.
     *
     * @return array{id: int, file_name: string, file_url: string, mime_type: string, file_size: int}|array{error: string}
     */
    public function upload(int $articleId, UploadedFile $file, int $tenantId): array
    {
        // Validate extension
        $ext = strtolower($file->getClientOriginalExtension());
        if (! in_array($ext, self::ALLOWED_EXTENSIONS, true)) {
            return ['error' => 'File type not allowed. Supported: ' . implode(', ', self::ALLOWED_EXTENSIONS)];
        }

        // Validate MIME via content inspection
        $detectedMime = $file->getMimeType();
        // PHP finfo reports .md files as text/plain — allow that
        if (! in_array($detectedMime, self::ALLOWED_MIMES, true)) {
            return ['error' => "Detected MIME type '{$detectedMime}' is not allowed."];
        }

        // Block dangerous content disguised as allowed extensions
        $blockedMimes = ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/x-httpd-php'];
        if (in_array($detectedMime, $blockedMimes, true)) {
            return ['error' => 'File content does not match allowed types.'];
        }

        // Store file
        $originalName = $file->getClientOriginalName();
        $storageName  = Str::uuid() . '.' . $ext;
        $storagePath  = "tenant_{$tenantId}/kb_attachments";

        $path = $file->storeAs($storagePath, $storageName, self::DISK);

        if (! $path) {
            return ['error' => 'Failed to store file.'];
        }

        // URL will be set after insert (needs the attachment ID)
        $id = DB::table('knowledge_base_attachments')->insertGetId([
            'article_id' => $articleId,
            'tenant_id'  => $tenantId,
            'file_name'  => $originalName,
            'file_path'  => $path,
            'file_url'   => '', // placeholder, updated below
            'mime_type'   => $ext === 'md' ? 'text/markdown' : $detectedMime,
            'file_size'  => $file->getSize(),
            'sort_order' => 0,
            'created_at' => now(),
        ]);

        // Set the download URL using the API endpoint
        $fileUrl = "/api/v2/kb/{$articleId}/attachments/{$id}/download";
        DB::table('knowledge_base_attachments')
            ->where('id', $id)
            ->update(['file_url' => $fileUrl]);

        return [
            'id'         => $id,
            'file_name'  => $originalName,
            'file_path'  => $path,
            'file_url'   => $fileUrl,
            'mime_type'   => $ext === 'md' ? 'text/markdown' : $detectedMime,
            'file_size'  => $file->getSize(),
            'sort_order' => 0,
            'created_at' => now()->toDateTimeString(),
        ];
    }

    /**
     * Delete a single attachment.
     */
    public function delete(int $attachmentId, int $articleId): bool
    {
        $tenantId = TenantContext::getId();

        $attachment = DB::table('knowledge_base_attachments')
            ->where('id', $attachmentId)
            ->where('article_id', $articleId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $attachment) {
            return false;
        }

        // Delete file from storage
        if ($attachment->file_path) {
            self::diskFor($attachment->file_path)->delete($attachment->file_path);
        }

        DB::table('knowledge_base_attachments')
            ->where('id', $attachmentId)
            ->where('tenant_id', $tenantId)
            ->delete();

        return true;
    }

    /**
     * Delete all attachments for an article (including files on disk).
     */
    public function deleteAllForArticle(int $articleId): void
    {
        $tenantId = TenantContext::getId();

        $attachments = DB::table('knowledge_base_attachments')
            ->where('article_id', $articleId)
            ->where('tenant_id', $tenantId)
            ->get();

        foreach ($attachments as $attachment) {
            if ($attachment->file_path) {
                self::diskFor($attachment->file_path)->delete($attachment->file_path);
            }
        }

        // DB rows will be cascade-deleted by the FK, but explicit delete is safe too
        DB::table('knowledge_base_attachments')
            ->where('article_id', $articleId)
            ->where('tenant_id', $tenantId)
            ->delete();
    }
}
