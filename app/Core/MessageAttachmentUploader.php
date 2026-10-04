<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

/** Stores message attachments outside the web root. */
class MessageAttachmentUploader
{
    public const MAX_BYTES = 10 * 1024 * 1024;
    public const MAX_FILES = 5;

    private const ALLOWED = [
        'jpg' => ['image/jpeg'], 'jpeg' => ['image/jpeg'], 'png' => ['image/png'],
        'gif' => ['image/gif'], 'webp' => ['image/webp'], 'pdf' => ['application/pdf'],
        'txt' => ['text/plain'], 'csv' => ['text/plain', 'text/csv', 'application/csv'],
        'doc' => ['application/msword'],
        'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
        'xls' => ['application/vnd.ms-excel'],
        'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
    ];

    /** @return array{url:string,path:string,name:string,size:int,mime:string,type:string} */
    public static function upload(array $file): array
    {
        if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
            throw new \InvalidArgumentException(__('api.message_attachment_upload_error'));
        }
        $tmp = (string) ($file['tmp_name'] ?? '');
        $size = (int) ($file['size'] ?? ($tmp !== '' ? @filesize($tmp) : 0) ?: 0);
        if ($tmp === '' || ! is_file($tmp)) {
            throw new \InvalidArgumentException(__('api.message_attachment_upload_error'));
        }
        if ($size <= 0 || $size > self::MAX_BYTES) {
            throw new \InvalidArgumentException(__('api.message_attachment_too_large'));
        }

        $originalName = trim((string) ($file['name'] ?? 'attachment'));
        $extension = strtolower((string) pathinfo($originalName, PATHINFO_EXTENSION));
        $mime = self::detectMime($tmp);
        if ($extension === '' || ! isset(self::ALLOWED[$extension]) || ! in_array($mime, self::ALLOWED[$extension], true)) {
            throw new \InvalidArgumentException(__('api.message_attachment_invalid_type'));
        }
        // A .docx/.xlsx must be a real Office package, not any ZIP (F-559).
        if (in_array($extension, ['docx', 'xlsx'], true)
            && ! \App\Support\Uploads\OfficeDocumentInspector::isGenuineOoxml($tmp, $extension)) {
            throw new \InvalidArgumentException(__('api.message_attachment_invalid_type'));
        }

        $tenantId = (int) TenantContext::getId();
        $relative = "message-media/{$tenantId}/attachments/" . bin2hex(random_bytes(16)) . ".{$extension}";
        $target = storage_path('app/private/' . $relative);
        if (! is_dir(dirname($target)) && ! @mkdir(dirname($target), 0700, true) && ! is_dir(dirname($target))) {
            throw new \RuntimeException(__('api.message_attachment_upload_error'));
        }
        $moved = is_uploaded_file($tmp) ? move_uploaded_file($tmp, $target) : rename($tmp, $target);
        if (! $moved) {
            throw new \RuntimeException(__('api.message_attachment_upload_error'));
        }
        @chmod($target, 0600);

        return [
            'url' => $relative,
            'path' => $relative,
            'name' => mb_substr(basename($originalName), 0, 255),
            'size' => $size,
            'mime' => $mime,
            'type' => str_starts_with($mime, 'image/') ? 'image' : 'file',
        ];
    }

    public static function delete(string $storagePath): bool
    {
        $path = self::resolveForTenant($storagePath, (int) TenantContext::getId());
        return $path === null || ! is_file($path) || @unlink($path);
    }

    public static function resolveForTenant(string $storagePath, int $tenantId): ?string
    {
        $prefix = "message-media/{$tenantId}/attachments/";
        if ($tenantId <= 0 || ! str_starts_with($storagePath, $prefix)) {
            return self::resolveLegacyPublicPath($storagePath, $tenantId);
        }
        $filename = substr($storagePath, strlen($prefix));
        if ($filename === '' || basename($filename) !== $filename) {
            return null;
        }
        $root = realpath(storage_path("app/private/message-media/{$tenantId}/attachments"));
        $resolved = realpath(storage_path('app/private/' . $storagePath));
        return $root !== false && $resolved !== false && str_starts_with($resolved, $root . DIRECTORY_SEPARATOR) && is_file($resolved)
            ? $resolved : null;
    }

    private static function resolveLegacyPublicPath(string $storagePath, int $tenantId): ?string
    {
        $prefix = "/uploads/{$tenantId}/message_attachments/";
        if (! str_starts_with($storagePath, $prefix)) return null;
        $filename = substr($storagePath, strlen($prefix));
        if ($filename === '' || basename($filename) !== $filename) return null;
        $root = realpath(base_path("httpdocs/uploads/{$tenantId}/message_attachments"));
        $resolved = realpath(base_path('httpdocs/' . ltrim($storagePath, '/')));
        return $root !== false && $resolved !== false && str_starts_with($resolved, $root . DIRECTORY_SEPARATOR) && is_file($resolved)
            ? $resolved : null;
    }

    private static function detectMime(string $path): string
    {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo !== false) {
            $mime = finfo_file($finfo, $path);
            finfo_close($finfo);
            if (is_string($mime) && $mime !== '') return $mime;
        }
        return (string) (mime_content_type($path) ?: 'application/octet-stream');
    }
}
