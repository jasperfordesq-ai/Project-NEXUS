<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\ImageUploader;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * E-035 F-192 — ImageUploader re-encoded a photo only when it had to resize
 * it, so a JPEG of 1920px or less kept its EXIF block, GPS position included,
 * and was served publicly as uploaded. Every JPEG/PNG/WebP upload must be
 * stored without its metadata, and a phone's orientation flag must still be
 * applied to the pixels so portrait photos stay upright.
 */
class ImageUploadMetadataStripTest extends TestCase
{
    use DatabaseTransactions;

    private const DIR = 'e035-metadata-test';

    /** @var list<string> */
    private array $cleanup = [];

    protected function tearDown(): void
    {
        foreach ($this->cleanup as $path) {
            foreach ([$path, preg_replace('/\.(jpe?g|png)$/i', '.webp', $path)] as $p) {
                if (is_string($p) && is_file($p)) {
                    @unlink($p);
                }
            }
            @rmdir(dirname($path)); // only succeeds once the test folder is empty
        }
        $this->cleanup = [];
        parent::tearDown();
    }

    /**
     * A minimal little-endian TIFF/EXIF block: IFD0 carries Orientation and a
     * pointer to a GPS IFD holding GPSLatitudeRef=N and GPSLatitude 53/20/0.
     */
    private static function exifBlock(int $orientation): string
    {
        $le16 = static fn (int $v): string => pack('v', $v);
        $le32 = static fn (int $v): string => pack('V', $v);

        // IFD0 at offset 8: two entries.
        $ifd0Size = 2 + 2 * 12 + 4;
        $gpsOffset = 8 + $ifd0Size;
        $tiff = 'II' . $le16(42) . $le32(8);
        $tiff .= $le16(2);
        $tiff .= $le16(0x0112) . $le16(3) . $le32(1) . $le16($orientation) . $le16(0); // Orientation SHORT
        $tiff .= $le16(0x8825) . $le16(4) . $le32(1) . $le32($gpsOffset);           // GPS IFD pointer
        $tiff .= $le32(0);

        // GPS IFD: two entries, rational data follows it.
        $gpsSize = 2 + 2 * 12 + 4;
        $dataOffset = $gpsOffset + $gpsSize;
        $tiff .= $le16(2);
        $tiff .= $le16(0x0001) . $le16(2) . $le32(2) . "N\0\0\0";                      // GPSLatitudeRef ASCII
        $tiff .= $le16(0x0002) . $le16(5) . $le32(3) . $le32($dataOffset);             // GPSLatitude RATIONAL x3
        $tiff .= $le32(0);
        $tiff .= $le32(53) . $le32(1) . $le32(20) . $le32(1) . $le32(0) . $le32(1);

        return "Exif\0\0" . $tiff;
    }

    private function jpegWithGps(int $width, int $height, int $orientation = 1): string
    {
        $img = imagecreatetruecolor($width, $height);
        imagefilledrectangle($img, 0, 0, (int) ($width / 2), $height, imagecolorallocate($img, 200, 30, 30));
        ob_start();
        imagejpeg($img, null, 90);
        $jpeg = (string) ob_get_clean();
        imagedestroy($img);

        $app1 = self::exifBlock($orientation);
        $segment = "\xFF\xE1" . pack('n', strlen($app1) + 2) . $app1;
        $withExif = substr($jpeg, 0, 2) . $segment . substr($jpeg, 2);

        $path = tempnam(sys_get_temp_dir(), 'e035jpg');
        file_put_contents($path, $withExif);

        return $path;
    }

    private function upload(string $tmp, string $name): string
    {
        TenantContext::setById($this->testTenantId);
        $public = ImageUploader::upload([
            'name' => $name, 'type' => 'image/jpeg', 'tmp_name' => $tmp,
            'error' => UPLOAD_ERR_OK, 'size' => filesize($tmp),
        ], self::DIR);
        $this->assertIsString($public);
        $stored = base_path('httpdocs' . $public);
        $this->cleanup[] = $stored;
        $this->assertFileExists($stored);

        return $stored;
    }

    public function test_small_jpeg_is_stored_without_gps_exif(): void
    {
        $tmp = $this->jpegWithGps(320, 200);
        $exifIn = @exif_read_data($tmp);
        $this->assertIsArray($exifIn, 'setup: fixture must carry EXIF');
        $this->assertSame('N', $exifIn['GPSLatitudeRef'] ?? null, 'setup: fixture must carry GPS');

        $stored = $this->upload($tmp, 'holiday.jpg');

        $bytes = (string) file_get_contents($stored);
        $this->assertStringNotContainsString("Exif\0\0", $bytes, 'Stored JPEG must carry no EXIF block.');
        $exifOut = @exif_read_data($stored);
        $this->assertFalse(is_array($exifOut) && isset($exifOut['GPSLatitudeRef']), 'GPS survived the upload.');

        $info = getimagesize($stored);
        $this->assertSame([320, 200], [$info[0], $info[1]], 'A small upload must not be resized.');
    }

    public function test_orientation_is_applied_to_pixels_when_metadata_is_stripped(): void
    {
        // Orientation 6 = rotate 90° clockwise to display upright.
        $tmp = $this->jpegWithGps(300, 200, 6);

        $stored = $this->upload($tmp, 'portrait.jpg');

        $info = getimagesize($stored);
        $this->assertSame([200, 300], [$info[0], $info[1]], 'Portrait orientation must be baked into the pixels.');
        $this->assertStringNotContainsString("Exif\0\0", (string) file_get_contents($stored));
    }

    public function test_png_text_metadata_is_stripped_and_transparency_kept(): void
    {
        $img = imagecreatetruecolor(40, 40);
        imagealphablending($img, false);
        imagesavealpha($img, true);
        imagefilledrectangle($img, 0, 0, 39, 39, imagecolorallocatealpha($img, 0, 0, 0, 127));
        ob_start();
        imagepng($img);
        $png = (string) ob_get_clean();
        imagedestroy($img);

        // Insert a tEXt chunk after IHDR (8-byte signature + 25-byte IHDR chunk).
        $data = "Comment\0E035-secret-location";
        $chunk = pack('N', strlen($data)) . 'tEXt' . $data . pack('N', crc32('tEXt' . $data));
        $tmp = tempnam(sys_get_temp_dir(), 'e035png');
        file_put_contents($tmp, substr($png, 0, 33) . $chunk . substr($png, 33));
        $this->assertStringContainsString('E035-secret-location', (string) file_get_contents($tmp));

        TenantContext::setById($this->testTenantId);
        $public = ImageUploader::upload([
            'name' => 'logo.png', 'type' => 'image/png', 'tmp_name' => $tmp,
            'error' => UPLOAD_ERR_OK, 'size' => filesize($tmp),
        ], self::DIR);
        $stored = base_path('httpdocs' . $public);
        $this->cleanup[] = $stored;

        $this->assertStringNotContainsString('E035-secret-location', (string) file_get_contents($stored));
        $out = imagecreatefrompng($stored);
        $alpha = (imagecolorat($out, 5, 5) >> 24) & 0x7F;
        $this->assertSame(127, $alpha, 'Transparency must survive the re-encode.');
    }
}
