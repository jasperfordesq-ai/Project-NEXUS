<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\JobVacancy;
use App\Models\User;
use App\Services\MediaThumbnailService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-027 Low findings on public / shared surfaces (F-076, F-090, F-091).
 *
 * Every finding has an attack assertion and a control assertion showing the
 * rightful path still works.
 */
final class PublicSurfaceLowFindingsTest extends TestCase
{
    use DatabaseTransactions;

    /** @var list<string> directories this test created and must remove */
    private array $createdDirs = [];

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        foreach (array_reverse($this->createdDirs) as $dir) {
            File::deleteDirectory($dir);
        }
        $this->createdDirs = [];
        parent::tearDown();
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-076 — job feeds cannot be forged by a job's own text
    // ─────────────────────────────────────────────────────────────────────

    public function test_f076_rss_description_cannot_forge_an_item(): void
    {
        $this->enableJobFeeds();
        $description = 'Real text ]]></description></item><item><title>FORGED RSS ITEM</title><description><![CDATA[x';
        $this->createOpenVacancy('Gardener', $description);

        Cache::forget("job_feed_rss_{$this->testTenantId}");
        $rss = $this->get('/api/v2/jobs/feed.xml', $this->withTenantHeader());
        $rss->assertStatus(200);
        $rssXml = $this->parseXml((string) $rss->getContent());

        $rssTitles = [];
        foreach ($rssXml->channel->item as $item) {
            $rssTitles[] = (string) $item->title;
        }
        $this->assertNotContains('FORGED RSS ITEM', $rssTitles, 'A job description forged a whole RSS item.');
        $rssDescriptions = [];
        foreach ($rssXml->channel->item as $item) {
            $rssDescriptions[(string) $item->link] = (string) $item->description;
        }
        $this->assertContains($description, $rssDescriptions, 'Control: the description survives intact as text.');
    }

    public function test_f076_indeed_description_cannot_forge_a_job(): void
    {
        $this->enableJobFeeds();
        $indeedDescription = 'Real text ]]></description></job><job><title>FORGED INDEED JOB</title><description><![CDATA[x';
        $indeedJob = $this->createOpenVacancy('Indeed role', $indeedDescription);

        $indeedXml = $this->fetchIndeed();
        $indeedTitles = [];
        $indeedDescriptions = [];
        foreach ($indeedXml->job as $entry) {
            $indeedTitles[] = (string) $entry->title;
            $indeedDescriptions[(string) $entry->referencenumber] = (string) $entry->description;
        }
        $this->assertNotContains('FORGED INDEED JOB', $indeedTitles, 'A job description forged a whole Indeed job.');
        $this->assertSame($indeedDescription, $indeedDescriptions[(string) $indeedJob->id] ?? null, 'Control: the description survives intact as text.');
    }

    public function test_f076_indeed_title_with_cdata_terminator_keeps_the_feed_well_formed(): void
    {
        $this->enableJobFeeds();
        $title = 'Gardener ]]></title><title>FORGED TITLE';
        $job = $this->createOpenVacancy($title, 'Plain description');

        $indeedXml = $this->fetchIndeed();
        $titles = [];
        foreach ($indeedXml->job as $entry) {
            $titles[(string) $entry->referencenumber] = (string) $entry->title;
        }
        $this->assertSame($title, $titles[(string) $job->id] ?? null);
        $this->assertNotContains('FORGED TITLE', $titles);
    }

    private function fetchIndeed(): \SimpleXMLElement
    {
        $indeed = $this->get('/api/v2/jobs/feed/indeed.xml', $this->withTenantHeader());
        $indeed->assertStatus(200);

        return $this->parseXml((string) $indeed->getContent());
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-090 — thumbnail endpoint refuses the vetting-documents folder
    // ─────────────────────────────────────────────────────────────────────

    public function test_f090_thumbnail_refuses_legacy_vetting_documents(): void
    {
        $hex = bin2hex(random_bytes(16));
        $slug = 'f090-' . bin2hex(random_bytes(4));

        $this->placePng(base_path('httpdocs/uploads/vetting'), "documents/{$hex}.png");
        $this->placePng(base_path("httpdocs/uploads/tenants/{$slug}"), "vetting/documents/{$hex}.png");

        $svc = app(MediaThumbnailService::class);
        foreach ([
            "/uploads/vetting/documents/{$hex}.png",
            "/uploads/tenants/{$slug}/vetting/documents/{$hex}.png",
            "/uploads/tenants/{$slug}/VETTING/documents/{$hex}.png",
            "/uploads/tenants/{$slug}/vetting%2Fdocuments/{$hex}.png",
            "https://app.example/uploads/vetting/documents/{$hex}.png",
            "/uploads/tenants/{$slug}/posts/../vetting/documents/{$hex}.png",
        ] as $src) {
            $this->assertNull($svc->resolveSourcePath($src), "Thumbnail source must be refused: {$src}");
        }

        $this->get('/api/v2/media/thumbnail?src=' . rawurlencode("/uploads/vetting/documents/{$hex}.png"), $this->withTenantHeader())
            ->assertStatus(404);
    }

    public function test_f090_thumbnail_still_serves_ordinary_uploads(): void
    {
        $slug = 'f090-' . bin2hex(random_bytes(4));
        $this->placePng(base_path("httpdocs/uploads/tenants/{$slug}"), 'posts/picture.png');

        $svc = app(MediaThumbnailService::class);
        $source = $svc->resolveSourcePath("/uploads/tenants/{$slug}/posts/picture.png");
        $this->assertNotNull($source);

        if (function_exists('imagecreatefrompng')) {
            $response = $this->get('/api/v2/media/thumbnail?w=32&h=32&format=jpg&src=' . rawurlencode("/uploads/tenants/{$slug}/posts/picture.png"), $this->withTenantHeader());
            $thumb = $svc->thumbnailPath($source, 32, 32, 'cover', $svc->format('jpg'));
            if (is_file($thumb)) {
                @unlink($thumb);
            }
            // Remove the cache sub-directory (and cache root) only if now empty.
            @rmdir(dirname($thumb));
            @rmdir(dirname($thumb, 2));
            $response->assertStatus(200);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-091 — admin image library and upload are admin-only
    // ─────────────────────────────────────────────────────────────────────

    public function test_f091_member_cannot_use_admin_upload_or_image_library(): void
    {
        Sanctum::actingAs($this->member(), ['*']);

        $this->apiGet('/v2/upload/list')->assertStatus(403);
        $this->apiPost('/v2/upload', [])->assertStatus(403);
        $this->apiPost('/upload', [])->assertStatus(403);
    }

    public function test_f091_broker_is_not_an_admin_for_the_image_library(): void
    {
        Sanctum::actingAs($this->member(['role' => 'broker']), ['*']);

        $this->apiGet('/v2/upload/list')->assertStatus(403);
    }

    public function test_f091_admin_can_still_use_upload_and_image_library(): void
    {
        Sanctum::actingAs($this->admin(), ['*']);

        $this->apiGet('/v2/upload/list')->assertStatus(200);
        $this->assertContains($this->apiPost('/v2/upload', [])->getStatusCode(), [400, 422]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /** @param array<string,mixed> $overrides */
    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => true,
        ], $overrides));
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function enableJobFeeds(): void
    {
        $this->assertTrue(TenantContext::hasFeature('job_vacancies'), 'Fixture: the test tenant must have job vacancies.');
    }

    private function createOpenVacancy(string $title, string $description): JobVacancy
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        return JobVacancy::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'status' => 'open',
            'title' => $title,
            'description' => $description,
            'deadline' => now()->addMonth(),
        ]);
    }

    private function parseXml(string $xml): \SimpleXMLElement
    {
        $previous = libxml_use_internal_errors(true);
        try {
            $parsed = simplexml_load_string($xml);
            $this->assertNotFalse($parsed, 'Feed is not well-formed XML: ' . implode(' | ', array_map(
                static fn ($e) => trim($e->message),
                libxml_get_errors()
            )));
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }

        return $parsed;
    }

    /** Write a tiny real PNG under $root/$relative and register $root for cleanup. */
    private function placePng(string $root, string $relative): void
    {
        if (!is_dir($root)) {
            $this->createdDirs[] = $root;
        }
        $path = $root . '/' . $relative;
        File::ensureDirectoryExists(dirname($path), 0755, true);
        // 1x1 transparent PNG
        file_put_contents($path, base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
        ));
    }
}
