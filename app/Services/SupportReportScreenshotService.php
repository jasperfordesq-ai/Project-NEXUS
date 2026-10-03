<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\SupportReport;
use App\Models\SupportReportAttachment;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Screenshots attached to a "Help & support" report (HELP-11, 3 Oct 2026).
 *
 * A screenshot can show anything that was on the member's screen, so:
 * - it is stored on the private `local` disk, never under httpdocs/uploads,
 *   and only staff can fetch it, through an authenticated endpoint;
 * - every image is decoded and re-encoded through GD before it is kept. That
 *   proves it is an image, and it writes pixels only, so EXIF blocks (a phone
 *   photo's GPS position among them) never reach staff or Jira (cf. F-192);
 * - the pixel count is capped before decoding (decompression-bomb guard), the
 *   same 25-megapixel limit ImageUploader uses.
 *
 * prepare() does all the checking and re-encoding BEFORE the report exists, so
 * a bad file refuses the whole request instead of leaving a report without its
 * screenshots.
 */
final class SupportReportScreenshotService
{
    public const MAX_FILES = 3;
    public const MAX_BYTES = 10 * 1024 * 1024;

    /** The longest side kept; a 4K screen fits, a 50-megapixel photo is scaled down. */
    private const MAX_DIMENSION = 4096;
    private const MAX_PIXELS = 25_000_000;
    private const DISK = 'local';

    /** @var array<string, string> mime => file extension */
    private const TYPES = [
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/webp' => 'webp',
    ];

    /**
     * @return array{bytes:string, mime:string, extension:string, width:int, height:int, original_name:?string}
     * @throws \InvalidArgumentException with a member-facing message
     */
    public function prepare(UploadedFile $file): array
    {
        if (!$file->isValid()) {
            throw new \InvalidArgumentException(__('api.support_reports_screenshot_invalid'));
        }
        if ((int) $file->getSize() > self::MAX_BYTES) {
            throw new \InvalidArgumentException(__('api.support_reports_screenshot_too_large', ['size' => self::MAX_BYTES / 1024 / 1024]));
        }

        $path = $file->getRealPath();
        $mime = $path !== false ? (string) (new \finfo(FILEINFO_MIME_TYPE))->file($path) : '';
        $info = $path !== false ? @getimagesize($path) : false;
        if (!isset(self::TYPES[$mime]) || $info === false || ($info['mime'] ?? '') !== $mime) {
            throw new \InvalidArgumentException(__('api.support_reports_screenshot_invalid'));
        }
        if ((int) $info[0] < 1 || (int) $info[1] < 1 || (int) $info[0] * (int) $info[1] > self::MAX_PIXELS) {
            throw new \InvalidArgumentException(__('api.support_reports_screenshot_invalid'));
        }

        [$bytes, $width, $height] = $this->reencode($path, $mime);

        return [
            'bytes' => $bytes,
            'mime' => $mime,
            'extension' => self::TYPES[$mime],
            'width' => $width,
            'height' => $height,
            'original_name' => $this->displayName($file->getClientOriginalName()),
        ];
    }

    /**
     * @param array{bytes:string, mime:string, extension:string, width:int, height:int, original_name:?string} $prepared
     */
    public function store(SupportReport $report, array $prepared): SupportReportAttachment
    {
        $path = sprintf(
            'support-reports/%d/%d/%s.%s',
            (int) $report->tenant_id,
            (int) $report->id,
            bin2hex(random_bytes(16)),
            $prepared['extension'],
        );

        if (!Storage::disk(self::DISK)->put($path, $prepared['bytes'])) {
            throw new \RuntimeException('Could not save a support report screenshot.');
        }

        return SupportReportAttachment::query()->create([
            'tenant_id' => (int) $report->tenant_id,
            'support_report_id' => (int) $report->id,
            'path' => $path,
            'mime' => $prepared['mime'],
            'size_bytes' => strlen($prepared['bytes']),
            'width' => $prepared['width'],
            'height' => $prepared['height'],
            'original_name' => $prepared['original_name'],
        ]);
    }

    public function contents(SupportReportAttachment $attachment): ?string
    {
        $disk = Storage::disk(self::DISK);
        if (!$this->isOwnPath($attachment) || !$disk->exists($attachment->path)) {
            return null;
        }

        $contents = $disk->get($attachment->path);

        return is_string($contents) ? $contents : null;
    }

    /** The filename a screenshot is given outside the platform (Jira, a download). */
    public function exportFilename(SupportReport $report, SupportReportAttachment $attachment, int $number): string
    {
        $extension = self::TYPES[$attachment->mime] ?? 'png';

        return 'screenshot-' . preg_replace('/[^A-Za-z0-9-]/', '', (string) $report->reference) . '-' . $number . '.' . $extension;
    }

    /** A stored path is only ever read inside its own report's folder. */
    private function isOwnPath(SupportReportAttachment $attachment): bool
    {
        $prefix = sprintf('support-reports/%d/%d/', (int) $attachment->tenant_id, (int) $attachment->support_report_id);

        return str_starts_with((string) $attachment->path, $prefix) && !str_contains((string) $attachment->path, '..');
    }

    /**
     * @return array{0:string, 1:int, 2:int} bytes, width, height
     */
    private function reencode(string $path, string $mime): array
    {
        $image = match ($mime) {
            'image/png' => @imagecreatefrompng($path),
            'image/jpeg' => @imagecreatefromjpeg($path),
            'image/webp' => @imagecreatefromwebp($path),
            default => false,
        };
        if ($image === false) {
            throw new \InvalidArgumentException(__('api.support_reports_screenshot_invalid'));
        }

        if ($mime === 'image/jpeg') {
            $image = $this->applyOrientation($image, $path);
        }

        $width = imagesx($image);
        $height = imagesy($image);
        $longest = max($width, $height);
        if ($longest > self::MAX_DIMENSION) {
            $scale = self::MAX_DIMENSION / $longest;
            $scaled = imagescale($image, max(1, (int) round($width * $scale)), max(1, (int) round($height * $scale)));
            if ($scaled !== false) {
                imagedestroy($image);
                $image = $scaled;
                $width = imagesx($image);
                $height = imagesy($image);
            }
        }

        if ($mime !== 'image/jpeg') {
            imagealphablending($image, false);
            imagesavealpha($image, true);
        }

        ob_start();
        $written = match ($mime) {
            'image/png' => imagepng($image, null, 6),
            'image/jpeg' => imagejpeg($image, null, 88),
            'image/webp' => imagewebp($image, null, 88),
            default => false,
        };
        $bytes = (string) ob_get_clean();
        imagedestroy($image);

        if (!$written || $bytes === '') {
            throw new \InvalidArgumentException(__('api.support_reports_screenshot_invalid'));
        }

        return [$bytes, $width, $height];
    }

    /** A phone photo stores its rotation as metadata; the re-encode drops it, so put it in the pixels. */
    private function applyOrientation(\GdImage $image, string $path): \GdImage
    {
        if (!function_exists('exif_read_data')) {
            return $image;
        }

        $exif = @exif_read_data($path);
        $orientation = is_array($exif) ? (int) ($exif['Orientation'] ?? 1) : 1;

        if (in_array($orientation, [2, 5, 7], true)) {
            imageflip($image, IMG_FLIP_HORIZONTAL);
        } elseif ($orientation === 4) {
            imageflip($image, IMG_FLIP_VERTICAL);
        }

        $angle = match ($orientation) {
            3 => 180,
            5, 8 => 90,
            6, 7 => -90,
            default => 0,
        };
        if ($angle !== 0) {
            $rotated = imagerotate($image, $angle, 0);
            if ($rotated !== false) {
                imagedestroy($image);

                return $rotated;
            }
        }

        return $image;
    }

    /** Shown to staff only; kept short and stripped of anything path-like. */
    private function displayName(?string $name): ?string
    {
        $name = trim(basename(str_replace('\\', '/', (string) $name)));
        $name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name) ?? '';

        return $name === '' ? null : Str::limit($name, 120, '');
    }
}
