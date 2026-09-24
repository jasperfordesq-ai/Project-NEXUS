<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

use App\Admin\WebPConverter;

/**
 * Image upload handler with resizing, cropping, and WebP conversion.
 * Direct implementation replacing Nexus\Core\ImageUploader delegation.
 */
class ImageUploader
{
    private static $allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    private static $maxSize = 8 * 1024 * 1024; // 8MB
    private static $autoConvertWebP = true;
    private static $maxDimension = 1920;

    /**
     * Upload an image with optional resizing/cropping.
     *
     * @param array  $file      $_FILES['input'] array
     * @param string $directory Subfolder under uploads (e.g. 'listings', 'profiles')
     * @param array  $options   ['crop' => true, 'width' => 200, 'height' => 200]
     * @return string|null Public path to the uploaded file, or null on empty input
     * @throws \Exception On upload error or validation failure
     */
    public static function upload($file, $directory = 'listings', $options = []): ?string
    {
        if (empty($file['name'])) return null;

        if ($file['error'] !== UPLOAD_ERR_OK) {
            throw new \Exception("Upload Error Code: " . $file['error']);
        }

        // Validation - Extension whitelist
        $allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        $extension = \strtolower(\pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!\in_array($extension, $allowedExtensions)) {
            throw new \Exception("Invalid file extension. Only JPG, PNG, GIF, WEBP allowed.");
        }

        // Validation - MIME type check using file content
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $detectedMime = $finfo->file($file['tmp_name']);
        if (!in_array($detectedMime, self::$allowedTypes)) {
            throw new \Exception("Invalid file type. File content does not match allowed image types.");
        }

        // Validation - Verify it's actually an image
        $imageInfo = @\getimagesize($file['tmp_name']);
        if ($imageInfo === false) {
            throw new \Exception("File is not a valid image.");
        }

        // Decompression bomb protection — reject images with extreme pixel counts
        // A 10000x10000 RGBA image = 400MB in memory; limit to ~25 megapixels
        $maxPixels = 25000000; // 25 megapixels (e.g. 5000x5000)
        $pixelCount = ($imageInfo[0] ?? 0) * ($imageInfo[1] ?? 0);
        if ($pixelCount > $maxPixels) {
            throw new \Exception("Image dimensions too large ({$imageInfo[0]}x{$imageInfo[1]}). Maximum 25 megapixels allowed.");
        }

        if ($file['size'] > self::$maxSize) {
            throw new \Exception("File too large. Max 8MB.");
        }

        // Generate secure filename
        $filename = \bin2hex(\random_bytes(16)) . '.' . $extension;

        // Tenant Scoping
        $tenant = TenantContext::get();
        $slug = $tenant['slug'] ?? 'default';
        if ($tenant['id'] == 1 && empty($tenant['slug'])) {
            $slug = 'master';
        }

        // Tenant-scoped directory
        $tenantDir = 'tenants/' . $slug . '/' . $directory;

        // Physical Path
        $targetDir = __DIR__ . '/../../httpdocs/uploads/' . $tenantDir;

        // Create the tenant-scoped directory if missing. Suppress the native
        // warning and re-check is_dir() (race-safe: a concurrent request may have
        // created it) so a genuine failure — e.g. the tenant folder is owned by
        // root and the web user can't write into it — surfaces as a clear,
        // actionable error instead of silently falling through to a doomed
        // move_uploaded_file() that reports a misleading "Failed to save file".
        if (!\is_dir($targetDir) && !@\mkdir($targetDir, 0755, true) && !\is_dir($targetDir)) {
            throw new \Exception("Could not create upload directory ({$targetDir}). The web server user likely lacks write permission on the tenant uploads folder.");
        }

        $targetPath = $targetDir . '/' . $filename;
        $publicPath = '/uploads/' . $tenantDir . '/' . $filename;

        // Move file. Genuine HTTP uploads go through move_uploaded_file() for its
        // is_uploaded_file() safety check. Files the framework injects in the test
        // harness (and other non-SAPI callers) are not registered uploads, so fall
        // back to rename() for those — production behaviour is unchanged because
        // real uploads always satisfy is_uploaded_file().
        $moved = \is_uploaded_file($file['tmp_name'])
            ? \move_uploaded_file($file['tmp_name'], $targetPath)
            : \rename($file['tmp_name'], $targetPath);
        if (!$moved) {
            throw new \Exception("Failed to save file.");
        }

        // Auto-resize oversized images (unless explicit dimensions provided)
        $reencoded = false;
        if (empty($options['width']) && empty($options['crop'])) {
            $reencoded = self::autoResizeIfNeeded($targetPath);
        }

        // Process Image (Resize/Crop) - explicit options from caller
        if (!empty($options['crop']) || !empty($options['width'])) {
            self::processImage($targetPath, $options);
            $reencoded = true;
        }

        // Strip metadata from every JPEG/PNG/WebP (F-192). Only a resize used to
        // re-encode, so a photo of 1920px or less kept its EXIF block — GPS
        // position included — and was served publicly as uploaded. Re-encoding
        // through GD writes pixels only; the orientation flag is applied to the
        // pixels first so portrait photos stay upright.
        if (!$reencoded && \in_array($imageInfo['mime'] ?? '', ['image/jpeg', 'image/png', 'image/webp'], true)) {
            self::processImage($targetPath, []);
        }

        // Auto-convert to WebP for performance (JPG/PNG only)
        if (self::$autoConvertWebP && in_array($extension, ['jpg', 'jpeg', 'png'])) {
            self::convertToWebP($targetPath);
        }

        return $publicPath;
    }

    /**
     * Remove a tenant-scoped upload created by this service.
     *
     * The directory and tenant prefix are both enforced before resolving the
     * path, so a failed domain mutation can clean up its file without exposing
     * a general-purpose arbitrary-file delete primitive.
     */
    public static function deleteTenantUpload(?string $publicPath, string $directory): bool
    {
        if ($publicPath === null || $publicPath === '') {
            return true;
        }

        $directory = trim(str_replace('\\', '/', $directory), '/');
        if ($directory === '' || str_contains($directory, '..')) {
            return false;
        }

        $tenant = TenantContext::get();
        $slug = $tenant['slug'] ?? 'default';
        if (($tenant['id'] ?? null) == 1 && empty($tenant['slug'])) {
            $slug = 'master';
        }

        $tenantDirectory = 'tenants/' . $slug . '/' . $directory;
        $expectedPrefix = '/uploads/' . $tenantDirectory . '/';
        if (!str_starts_with($publicPath, $expectedPrefix)) {
            return false;
        }

        $basePath = realpath(__DIR__ . '/../../httpdocs/uploads/' . $tenantDirectory);
        $targetPath = realpath(__DIR__ . '/../../httpdocs' . $publicPath);
        if ($basePath === false || $targetPath === false || !is_file($targetPath)) {
            return false;
        }

        $basePrefix = rtrim($basePath, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        if (!str_starts_with($targetPath, $basePrefix)) {
            return false;
        }

        return @unlink($targetPath);
    }

    /**
     * Enable or disable automatic WebP conversion.
     */
    public static function setAutoConvertWebP(bool $enabled): void
    {
        self::$autoConvertWebP = $enabled;
    }

    /**
     * Set maximum dimension for auto-resize.
     *
     * @param int $maxDimension Maximum width or height in pixels
     */
    public static function setMaxDimension(int $maxDimension): void
    {
        self::$maxDimension = $maxDimension;
    }

    /**
     * Convert uploaded image to WebP format.
     */
    private static function convertToWebP(string $imagePath): ?array
    {
        try {
            if (!class_exists(WebPConverter::class)) { return null; }
            $converter = new WebPConverter();

            if (!$converter->isCwebpAvailable()) {
                return null;
            }

            $result = $converter->convertOnUpload($imagePath);

            if ($result['success']) {
                \Log::warning("WebP auto-converted: {$imagePath} (saved {$result['savings']}%)");
            }

            return $result;
        } catch (\Exception $e) {
            \Log::warning("WebP conversion failed: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Auto-resize image if it exceeds maximum dimensions.
     */
    /**
     * @return bool True when the image was re-encoded (resized).
     */
    private static function autoResizeIfNeeded(string $path): bool
    {
        if (!\function_exists('imagecreatefromjpeg')) {
            return false;
        }

        $info = @\getimagesize($path);
        if (!$info) {
            return false;
        }

        $srcWidth = $info[0];
        $srcHeight = $info[1];
        $maxDim = self::$maxDimension;

        if ($srcWidth <= $maxDim && $srcHeight <= $maxDim) {
            return false;
        }

        if ($srcWidth > $srcHeight) {
            $newWidth = $maxDim;
            $newHeight = (int)($srcHeight * ($maxDim / $srcWidth));
        } else {
            $newHeight = $maxDim;
            $newWidth = (int)($srcWidth * ($maxDim / $srcHeight));
        }

        self::processImage($path, [
            'width' => $newWidth,
            'height' => $newHeight
        ]);

        \Illuminate\Support\Facades\Log::warning("Auto-resized image: {$srcWidth}x{$srcHeight} -> {$newWidth}x{$newHeight}");

        return true;
    }

    private static function processImage($path, $options)
    {
        if (!\function_exists('imagecreatefromjpeg')) {
            \Illuminate\Support\Facades\Log::warning('Warning: GD library not available. Image uploaded without resizing/cropping.');
            return;
        }

        $info = \getimagesize($path);
        if (!$info) return;

        $mime = $info['mime'];
        $srcWidth = $info[0];
        $srcHeight = $info[1];

        switch ($mime) {
            case 'image/jpeg':
                $image = \imagecreatefromjpeg($path);
                break;
            case 'image/png':
                $image = \imagecreatefrompng($path);
                break;
            case 'image/webp':
                $image = \imagecreatefromwebp($path);
                break;
            case 'image/gif':
                $image = \imagecreatefromgif($path);
                break;
            default:
                return;
        }

        if ($image === false) {
            return;
        }

        // Fix EXIF orientation — phones store rotation as metadata, not pixels.
        // Without this, photos taken in portrait appear sideways.
        if ($mime === 'image/jpeg' && \function_exists('exif_read_data')) {
            $exif = @\exif_read_data($path);
            if ($exif && !empty($exif['Orientation'])) {
                // The re-encode below drops the orientation tag, so every
                // variant — mirrored ones included — must go into the pixels.
                switch ((int) $exif['Orientation']) {
                    case 2: // mirrored horizontally
                        \imageflip($image, IMG_FLIP_HORIZONTAL);
                        break;
                    case 3: // 180°
                        $image = \imagerotate($image, 180, 0);
                        break;
                    case 4: // mirrored vertically
                        \imageflip($image, IMG_FLIP_VERTICAL);
                        break;
                    case 5: // mirrored, then 90° CCW
                        \imageflip($image, IMG_FLIP_HORIZONTAL);
                        $image = \imagerotate($image, 90, 0);
                        break;
                    case 6: // 90° CW (phone held upright)
                        $image = \imagerotate($image, -90, 0);
                        break;
                    case 7: // mirrored, then 90° CW
                        \imageflip($image, IMG_FLIP_HORIZONTAL);
                        $image = \imagerotate($image, -90, 0);
                        break;
                    case 8: // 90° CCW
                        $image = \imagerotate($image, 90, 0);
                        break;
                }
                // Update dimensions after rotation
                $srcWidth = \imagesx($image);
                $srcHeight = \imagesy($image);
            }
        }

        $targetWidth = $options['width'] ?? $srcWidth;
        $targetHeight = $options['height'] ?? (!empty($options['crop']) ? $targetWidth : $srcHeight);

        // Plain re-encode (no resize/crop): keep PNG/WebP transparency, which
        // GD otherwise drops when writing the image it loaded.
        if (empty($options['crop']) && !isset($options['width']) && ($mime === 'image/png' || $mime === 'image/webp')) {
            \imagealphablending($image, false);
            \imagesavealpha($image, true);
        }

        if (!empty($options['crop'])) {
            $thumbRatio = $targetWidth / $targetHeight;
            $srcRatio = $srcWidth / $srcHeight;

            if ($srcRatio > $thumbRatio) {
                $newHeight = $srcHeight;
                $newWidth = (int)($srcHeight * $thumbRatio);
            } else {
                $newWidth = $srcWidth;
                $newHeight = (int)($srcWidth / $thumbRatio);
            }

            $xOffset = (int) (($srcWidth - $newWidth) / 2);
            $yOffset = (int) (($srcHeight - $newHeight) / 2);

            $thumb = \imagecreatetruecolor((int) $targetWidth, (int) $targetHeight);

            if ($mime == 'image/png' || $mime == 'image/webp') {
                \imagealphablending($thumb, false);
                \imagesavealpha($thumb, true);
            }

            \imagecopyresampled($thumb, $image, 0, 0, $xOffset, $yOffset, (int) $targetWidth, (int) $targetHeight, $newWidth, $newHeight);
            $image = $thumb;
        } elseif (isset($options['width'])) {
            $ratio = $srcWidth / $srcHeight;
            if ($targetWidth / $targetHeight > $ratio) {
                $targetWidth = (int) ($targetHeight * $ratio);
            } else {
                $targetHeight = (int) ($targetWidth / $ratio);
            }

            $thumb = \imagecreatetruecolor((int) $targetWidth, (int) $targetHeight);
            if ($mime == 'image/png' || $mime == 'image/webp') {
                \imagealphablending($thumb, false);
                \imagesavealpha($thumb, true);
            }
            \imagecopyresampled($thumb, $image, 0, 0, 0, 0, (int) $targetWidth, (int) $targetHeight, $srcWidth, $srcHeight);
            $image = $thumb;
        }

        switch ($mime) {
            case 'image/jpeg':
                \imagejpeg($image, $path, 90);
                break;
            case 'image/png':
                \imagepng($image, $path);
                break;
            case 'image/webp':
                \imagewebp($image, $path);
                break;
            case 'image/gif':
                \imagegif($image, $path);
                break;
        }

        \imagedestroy($image);
    }
}
