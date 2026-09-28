<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\PodcastConfigurationService;
use App\Services\PodcastService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-266 (E-055 I-2, fixed in E-057): the podcast storage setting accepted any
 * configured filesystem disk, including `legacy_httpdocs` (the public web
 * root) and the shared public `public` / `uploads` disks, so hosted audio
 * would be served as a plain file past signed links, moderation, scanning and
 * members-only checks. The storage probe also let any community admin write
 * and delete a file on any platform disk.
 *
 * Safe behaviour: only the disks podcast media is designed for — `local`
 * (private, served through the signed media proxy) and `s3` (the documented
 * cloud default) — are accepted, probed, or used for new uploads.
 *
 * Every disk the probe could touch is faked, so nothing lands in the
 * bind-mounted repository.
 */
class F266PodcastStorageDiskAllowListTest extends TestCase
{
    use DatabaseTransactions;

    private const REFUSED_DISKS = ['legacy_httpdocs', 'public', 'uploads'];

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['podcasts' => true])]);
        TenantContext::setById($this->testTenantId);

        foreach (['local', 's3', ...self::REFUSED_DISKS] as $disk) {
            Storage::fake($disk);
        }

        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]), ['*']);
    }

    private function storedDisk(): ?string
    {
        return DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', PodcastConfigurationService::CONFIG_CLOUD_STORAGE_DISK)
            ->value('setting_value');
    }

    public function test_settings_refuse_platform_public_disks(): void
    {
        foreach (self::REFUSED_DISKS as $disk) {
            $this->apiPut('/v2/admin/config/podcasts/bulk', ['settings' => [
                'podcasts.media_storage_driver' => 'cloud',
                'podcasts.cloud_storage_disk' => $disk,
            ]])
                ->assertStatus(422)
                ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR')
                ->assertJsonPath('errors.0.field', 'podcasts.cloud_storage_disk');

            $this->assertNotSame($disk, $this->storedDisk(), "{$disk} must not be saved");
        }
    }

    public function test_settings_still_accept_the_designed_disks(): void
    {
        foreach (['s3', 'local'] as $disk) {
            $this->apiPut('/v2/admin/config/podcasts/bulk', ['settings' => [
                'podcasts.media_storage_driver' => 'cloud',
                'podcasts.cloud_storage_disk' => $disk,
            ]])->assertOk();

            $this->assertSame($disk, $this->storedDisk());
        }
    }

    public function test_probe_refuses_platform_public_disks_without_touching_them(): void
    {
        foreach (self::REFUSED_DISKS as $disk) {
            $this->apiPost('/v2/admin/podcasts/storage/verify', ['disk' => $disk])
                ->assertOk()
                ->assertJsonPath('data.ok', false)
                ->assertJsonPath('data.checks.write', false)
                ->assertJsonPath('data.error', 'disk_not_allowed');

            $this->assertSame([], Storage::disk($disk)->allFiles(), "nothing may be written to {$disk}");
        }
    }

    public function test_probe_still_verifies_the_designed_disks(): void
    {
        foreach (['s3', 'local'] as $disk) {
            $this->apiPost('/v2/admin/podcasts/storage/verify', ['disk' => $disk])
                ->assertOk()
                ->assertJsonPath('data.ok', true)
                ->assertJsonPath('data.checks.write', true);

            $this->assertSame([], Storage::disk($disk)->allFiles('podcasts/.doctor'));
        }
    }

    public function test_an_already_saved_public_disk_is_no_longer_used_for_uploads(): void
    {
        // A value saved before this fix, written past the controller's validation.
        PodcastConfigurationService::set(PodcastConfigurationService::CONFIG_MEDIA_STORAGE_DRIVER, 'cloud');
        PodcastConfigurationService::set(PodcastConfigurationService::CONFIG_CLOUD_STORAGE_DISK, 'legacy_httpdocs');
        $this->assertSame('local', $this->mediaStorageDisk());

        // Control: an allowed cloud disk is still honoured.
        PodcastConfigurationService::set(PodcastConfigurationService::CONFIG_CLOUD_STORAGE_DISK, 's3');
        $this->assertSame('s3', $this->mediaStorageDisk());
    }

    private function mediaStorageDisk(): string
    {
        $method = new \ReflectionMethod(PodcastService::class, 'mediaStorageDisk');
        $method->setAccessible(true);

        return (string) $method->invoke(null);
    }
}
