<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E088;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-556 (E-088): knowledge-base attachments were written to the PUBLIC disk,
 * so the draft-article rule on the download route could be bypassed by
 * fetching /storage/tenant_X/kb_attachments/<uuid>.ext directly.
 *
 * New uploads go to the private disk; attachments already on the public disk
 * keep downloading through the API, and both Apache layers refuse the static
 * kb_attachments path so those legacy copies cannot be fetched around it.
 */
final class F556KnowledgeBaseAttachmentsArePrivateTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Storage::fake('public');
    }

    public function test_a_new_attachment_is_stored_on_the_private_disk(): void
    {
        $admin = $this->admin();
        $articleId = $this->article((int) $admin->id, true);
        Sanctum::actingAs($admin);

        $response = $this->apiPost(
            "/v2/kb/{$articleId}/attachments",
            ['file' => UploadedFile::fake()->createWithContent('guide.txt', "Plain text guide\n")]
        );
        $response->assertSuccessful();

        $path = (string) DB::table('knowledge_base_attachments')->where('article_id', $articleId)->value('file_path');
        $this->assertNotSame('', $path);
        Storage::disk('local')->assertExists($path);
        Storage::disk('public')->assertMissing($path);
    }

    public function test_member_downloads_a_private_attachment_of_a_published_article(): void
    {
        $admin = $this->admin();
        $articleId = $this->article((int) $admin->id, true);
        $attachmentId = $this->attachment($articleId, 'local', 'private bytes');

        Sanctum::actingAs($this->member());
        $response = $this->apiGet("/v2/kb/{$articleId}/attachments/{$attachmentId}/download");

        $response->assertOk();
        $this->assertSame('private bytes', $response->streamedContent());
        $this->assertStringContainsString('attachment', (string) $response->headers->get('Content-Disposition'));
    }

    public function test_a_legacy_attachment_on_the_public_disk_still_downloads(): void
    {
        $admin = $this->admin();
        $articleId = $this->article((int) $admin->id, true);
        $attachmentId = $this->attachment($articleId, 'public', 'legacy bytes');

        Sanctum::actingAs($this->member());
        $response = $this->apiGet("/v2/kb/{$articleId}/attachments/{$attachmentId}/download");

        $response->assertOk();
        $this->assertSame('legacy bytes', $response->streamedContent());
    }

    public function test_a_member_still_cannot_download_a_draft_articles_attachment(): void
    {
        $admin = $this->admin();
        $articleId = $this->article((int) $admin->id, false);
        $attachmentId = $this->attachment($articleId, 'local', 'draft bytes');

        Sanctum::actingAs($this->member());
        $this->apiGet("/v2/kb/{$articleId}/attachments/{$attachmentId}/download")->assertNotFound();
    }

    public function test_deleting_removes_the_private_file(): void
    {
        $admin = $this->admin();
        $articleId = $this->article((int) $admin->id, true);
        $attachmentId = $this->attachment($articleId, 'local', 'to delete');
        $path = (string) DB::table('knowledge_base_attachments')->where('id', $attachmentId)->value('file_path');

        Sanctum::actingAs($admin);
        $this->apiDelete("/v2/kb/{$articleId}/attachments/{$attachmentId}")->assertSuccessful();

        Storage::disk('local')->assertMissing($path);
    }

    public function test_both_apache_layers_refuse_the_static_kb_attachments_path(): void
    {
        $root = dirname(__DIR__, 5);

        // Production: /storage is an Alias outside the web root (F-554).
        $alias = (string) file_get_contents($root . '/docker/apache/storage-alias.conf');
        $this->assertMatchesRegularExpression('#kb_attachments[^\n]*\n\s*Require all denied#', $alias);

        // Dev: /storage is a symlink inside the web root.
        $htaccess = (string) file_get_contents($root . '/httpdocs/.htaccess');
        $this->assertMatchesRegularExpression('#\^storage/tenant_\[0-9\]\+/kb_attachments/#', $htaccess);
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin',
        ]);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'member',
        ]);
    }

    private function article(int $createdBy, bool $published): int
    {
        return (int) DB::table('knowledge_base_articles')->insertGetId([
            'tenant_id' => $this->testTenantId, 'created_by' => $createdBy,
            'title' => 'F556 fixture', 'slug' => 'f556-' . bin2hex(random_bytes(4)),
            'content' => 'Fixture', 'is_published' => $published,
            'sort_order' => 0, 'created_at' => now(),
        ]);
    }

    private function attachment(int $articleId, string $disk, string $bytes): int
    {
        $path = "tenant_{$this->testTenantId}/kb_attachments/" . bin2hex(random_bytes(8)) . '.txt';
        Storage::disk($disk)->put($path, $bytes);

        return (int) DB::table('knowledge_base_attachments')->insertGetId([
            'article_id' => $articleId, 'tenant_id' => $this->testTenantId,
            'file_name' => 'guide.txt', 'file_path' => $path, 'file_url' => '',
            'mime_type' => 'text/plain', 'file_size' => strlen($bytes),
            'sort_order' => 0, 'created_at' => now(),
        ]);
    }
}
