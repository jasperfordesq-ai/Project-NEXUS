<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E088;

use App\Models\User;
use App\Services\CaringCommunity\PaperOnboardingIntakeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\Laravel\TestCase;

/**
 * F-560 (E-088): paper onboarding stored the upload under the extension the
 * client sent — JPEG bytes named x.php landed on disk as <uuid>.php. The
 * stored extension now follows the detected content type.
 */
final class F560PaperOnboardingStoredExtensionTest extends TestCase
{
    use DatabaseTransactions;

    public function test_stored_extension_follows_the_content_not_the_client_name(): void
    {
        Storage::fake('local');
        $coordinator = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $result = app(PaperOnboardingIntakeService::class)->createFromUpload(
            $this->testTenantId,
            (int) $coordinator->id,
            $this->realUpload($this->jpegBytes(), 'scan.php'),
        );

        $this->assertStringEndsWith('.jpg', (string) ($result['stored_path'] ?? $this->storedPath()));
        $this->assertSame([], array_filter(
            Storage::disk('local')->allFiles("caring-paper-onboarding/{$this->testTenantId}"),
            static fn (string $p): bool => str_ends_with($p, '.php')
        ));
    }

    public function test_content_outside_the_allow_list_is_refused(): void
    {
        Storage::fake('local');
        $coordinator = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $this->expectException(\InvalidArgumentException::class);
        app(PaperOnboardingIntakeService::class)->createFromUpload(
            $this->testTenantId,
            (int) $coordinator->id,
            $this->realUpload("<html><body>not a scan</body></html>", 'scan.pdf'),
        );
    }

    /** @var list<string> */
    private array $temp = [];

    protected function tearDown(): void
    {
        foreach ($this->temp as $f) {
            @unlink($f);
        }
        parent::tearDown();
    }

    /**
     * A real file: Laravel's fake uploads report a MIME type derived from the
     * file NAME, which is exactly what this finding is about.
     */
    private function realUpload(string $bytes, string $clientName): UploadedFile
    {
        $path = (string) tempnam(sys_get_temp_dir(), 'e088f560');
        file_put_contents($path, $bytes);
        $this->temp[] = $path;

        return new UploadedFile($path, $clientName, null, null, true);
    }

    private function jpegBytes(): string
    {
        $image = imagecreatetruecolor(8, 8);
        ob_start();
        imagejpeg($image);

        return (string) ob_get_clean();
    }

    private function storedPath(): string
    {
        return (string) \Illuminate\Support\Facades\DB::table('caring_paper_onboarding_intakes')
            ->where('tenant_id', $this->testTenantId)->orderByDesc('id')->value('stored_path');
    }
}
