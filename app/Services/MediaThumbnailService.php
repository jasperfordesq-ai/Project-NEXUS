<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\File;

final class MediaThumbnailService
{
    public const MIN_SIZE = 16;
    public const MAX_SIZE = 1200;
    public const DEFAULT_WIDTH = 400;
    public const DEFAULT_HEIGHT = 300;
    public const JPEG_QUALITY = 82;
    public const WEBP_QUALITY = 78;

    public function dimension(mixed $value, int $fallback): int
    {
        $dimension = filter_var($value, FILTER_VALIDATE_INT);
        if ($dimension === false) {
            return $fallback;
        }

        return max(self::MIN_SIZE, min(self::MAX_SIZE, (int) $dimension));
    }

    public function format(?string $requested = null): string
    {
        $requested = strtolower((string) $requested);
        if ($requested === 'avif' && function_exists('imageavif')) {
            return 'avif';
        }
        if ($requested === 'webp' && function_exists('imagewebp')) {
            return 'webp';
        }

        return function_exists('imagewebp') ? 'webp' : 'jpg';
    }

    public function resolveSourcePath(string $src): ?string
    {
        $src = trim($src);
        if ($src === '') {
            return null;
        }

        $path = parse_url($src, PHP_URL_PATH);
        if (!is_string($path) || $path === '') {
            return null;
        }

        $path = '/' . ltrim(rawurldecode($path), '/');
        if (str_contains($path, "\0") || str_contains($path, '..') || str_contains($path, '\\')) {
            return null;
        }

        if ($this->isPrivateUploadPath($path)) {
            return null;
        }

        $resolved = null;
        if (str_starts_with($path, '/uploads/')) {
            $resolved = $this->realPathInside(base_path('httpdocs/uploads'), base_path('httpdocs') . $path);
        } elseif (str_starts_with($path, '/storage/')) {
            $relative = ltrim(substr($path, strlen('/storage/')), '/');
            $storagePath = base_path('storage/app/public/' . $relative);
            $resolved = $this->realPathInside(base_path('storage/app/public'), $storagePath)
                ?? $this->realPathInside(base_path('httpdocs/storage'), base_path('httpdocs') . $path);
        }

        // Re-check the resolved file too, so a symlink or a case-insensitive
        // filesystem cannot reach the private folder under another spelling.
        if ($resolved === null || $this->isPrivateUploadPath(str_replace('\\', '/', $resolved))) {
            return null;
        }

        return $resolved;
    }

    /**
     * Folders Apache refuses to serve directly must not be reachable through
     * the thumbnail renderer either (F-090). Criminal-record certificate
     * evidence lives under `uploads/[tenants/{slug}/]vetting/documents`, and
     * `httpdocs/.htaccess` denies it case-insensitively; this mirrors that for
     * any `vetting` path segment, wherever it appears.
     */
    private function isPrivateUploadPath(string $path): bool
    {
        foreach (explode('/', $path) as $segment) {
            if (strcasecmp($segment, 'vetting') === 0) {
                return true;
            }
        }

        return false;
    }

    public function thumbnailPath(string $sourcePath, int $width, int $height, string $fit, ?string $format = null): string
    {
        $format ??= $this->format();
        $cacheRoot = storage_path('app/public/thumbnails');
        File::ensureDirectoryExists($cacheRoot, 0755, true);

        $signature = hash('sha256', $sourcePath . '|' . (filemtime($sourcePath) ?: 0) . "|{$width}x{$height}|{$fit}|{$format}");

        return $cacheRoot . DIRECTORY_SEPARATOR . substr($signature, 0, 2) . DIRECTORY_SEPARATOR . $signature . '.' . $format;
    }

    public function ensureThumbnail(string $sourcePath, int $width, int $height, string $fit, ?string $format = null): string
    {
        $format ??= $this->format();
        $thumbPath = $this->thumbnailPath($sourcePath, $width, $height, $fit, $format);
        if (!is_file($thumbPath)) {
            $this->createThumbnail($sourcePath, $thumbPath, $width, $height, $fit, $format);
        }

        return $thumbPath;
    }

    public function createThumbnail(string $sourcePath, string $thumbPath, int $width, int $height, string $fit, ?string $format = null): void
    {
        $format ??= $this->format();
        $info = @getimagesize($sourcePath);
        if ($info === false) {
            throw new \RuntimeException('Source is not a readable image.');
        }

        [$srcWidth, $srcHeight] = $info;
        $source = $this->createImageResource($sourcePath, (string) ($info['mime'] ?? ''));
        if ($source === null || $srcWidth <= 0 || $srcHeight <= 0) {
            throw new \RuntimeException('Source image type is not supported.');
        }

        [$srcX, $srcY, $copyWidth, $copyHeight, $destWidth, $destHeight, $destX, $destY] =
            $this->geometry($srcWidth, $srcHeight, $width, $height, $fit);

        $thumb = imagecreatetruecolor($width, $height);
        imagefill($thumb, 0, 0, imagecolorallocate($thumb, 255, 255, 255));
        imagecopyresampled($thumb, $source, $destX, $destY, $srcX, $srcY, $destWidth, $destHeight, $copyWidth, $copyHeight);

        File::ensureDirectoryExists(dirname($thumbPath), 0755, true);
        if ($format === 'avif' && function_exists('imageavif')) {
            imageavif($thumb, $thumbPath, self::WEBP_QUALITY);
        } elseif ($format === 'webp') {
            imagewebp($thumb, $thumbPath, self::WEBP_QUALITY);
        } else {
            imagejpeg($thumb, $thumbPath, self::JPEG_QUALITY);
        }

        imagedestroy($source);
        imagedestroy($thumb);
    }

    private function realPathInside(string $root, string $candidate): ?string
    {
        $rootPath = realpath($root);
        $filePath = realpath($candidate);

        if ($rootPath === false || $filePath === false || !is_file($filePath)) {
            return null;
        }

        return str_starts_with($filePath, rtrim($rootPath, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR)
            ? $filePath
            : null;
    }

    /**
     * @return array{0:int,1:int,2:int,3:int,4:int,5:int,6:int,7:int}
     */
    private function geometry(int $srcWidth, int $srcHeight, int $width, int $height, string $fit): array
    {
        if ($fit === 'contain') {
            $scale = min($width / $srcWidth, $height / $srcHeight);
            $destWidth = max(1, (int) round($srcWidth * $scale));
            $destHeight = max(1, (int) round($srcHeight * $scale));

            return [0, 0, $srcWidth, $srcHeight, $destWidth, $destHeight, (int) (($width - $destWidth) / 2), (int) (($height - $destHeight) / 2)];
        }

        $targetRatio = $width / $height;
        $sourceRatio = $srcWidth / $srcHeight;
        if ($sourceRatio > $targetRatio) {
            $copyHeight = $srcHeight;
            $copyWidth = (int) round($srcHeight * $targetRatio);
            $srcX = (int) (($srcWidth - $copyWidth) / 2);

            return [$srcX, 0, $copyWidth, $copyHeight, $width, $height, 0, 0];
        }

        $copyWidth = $srcWidth;
        $copyHeight = (int) round($srcWidth / $targetRatio);
        $srcY = (int) (($srcHeight - $copyHeight) / 2);

        return [0, $srcY, $copyWidth, $copyHeight, $width, $height, 0, 0];
    }

    private function createImageResource(string $path, string $mime): mixed
    {
        return match ($mime) {
            'image/jpeg' => function_exists('imagecreatefromjpeg') ? @imagecreatefromjpeg($path) : null,
            'image/png' => function_exists('imagecreatefrompng') ? @imagecreatefrompng($path) : null,
            'image/webp' => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($path) : null,
            'image/gif' => function_exists('imagecreatefromgif') ? @imagecreatefromgif($path) : null,
            default => null,
        };
    }
}
