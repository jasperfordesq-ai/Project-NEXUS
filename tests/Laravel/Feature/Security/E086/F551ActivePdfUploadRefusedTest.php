<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E086;

use App\Http\Middleware\RejectActivePdfUploads;
use App\Models\Group;
use App\Models\User;
use App\Services\GroupFileService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Symfony\Component\HttpFoundation\Response;
use Tests\Laravel\TestCase;

/**
 * F-551 (E-086, reported by Cyphere, High): the group file upload accepted a PDF
 * with embedded JavaScript, which ran for any member who opened it.
 *
 * Reproduces the reported journey end to end, then pins that the same refusal
 * applies to every other upload feature (through the `api` middleware) and
 * inside GroupFileService itself.
 */
final class F551ActivePdfUploadRefusedTest extends TestCase
{
    use DatabaseTransactions;

    public function test_a_group_member_cannot_upload_a_pdf_carrying_javascript(): void
    {
        Storage::fake('local');
        $group = $this->groupOwnedByActingMember();

        $response = $this->apiPost("/v2/groups/{$group->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('minutes.pdf', F551Pdf::withOpenActionJavaScript()),
        ]);

        $response->assertStatus(422);
        self::assertSame('PDF_ACTIVE_CONTENT', $response->json('code'));
        self::assertSame(0, DB::table('group_files')->where('group_id', $group->id)->count());
        self::assertSame([], Storage::disk('local')->allFiles("groups/{$this->testTenantId}/{$group->id}"));
    }

    public function test_javascript_hidden_in_a_compressed_object_stream_is_refused_too(): void
    {
        Storage::fake('local');
        $group = $this->groupOwnedByActingMember();

        $this->apiPost("/v2/groups/{$group->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('minutes.pdf', F551Pdf::withObjectStreamJavaScript('FlateDecode')),
        ])->assertStatus(422);

        self::assertSame(0, DB::table('group_files')->where('group_id', $group->id)->count());
    }

    public function test_an_ordinary_pdf_still_uploads(): void
    {
        Storage::fake('local');
        $group = $this->groupOwnedByActingMember();

        $this->apiPost("/v2/groups/{$group->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('minutes.pdf', F551Pdf::plain()),
        ])->assertCreated();

        self::assertSame(1, DB::table('group_files')->where('group_id', $group->id)->count());
    }

    public function test_the_api_group_runs_the_check_for_every_upload_feature(): void
    {
        $route = app('router')->getRoutes()->match(Request::create('/api/v2/messages', 'POST'));

        self::assertContains(RejectActivePdfUploads::class, app('router')->gatherRouteMiddleware($route));
    }

    public function test_the_check_catches_a_pdf_whatever_it_is_named_and_wherever_it_is_nested(): void
    {
        $middleware = new RejectActivePdfUploads();
        $request = Request::create('/api/v2/messages', 'POST', [], [], [
            'attachments' => [
                UploadedFile::fake()->createWithContent('photo.jpg', "\xff\xd8\xff\xe0 not a pdf"),
                UploadedFile::fake()->createWithContent('cv.docx', F551Pdf::withOpenActionJavaScript()),
            ],
        ]);

        $response = $middleware->handle($request, static fn (): Response => response()->json(['passed' => true]));

        self::assertSame(422, $response->getStatusCode());
        $body = json_decode((string) $response->getContent(), true);
        self::assertSame('attachments.1', $body['errors'][0]['field']);
    }

    public function test_the_check_lets_ordinary_files_through(): void
    {
        $middleware = new RejectActivePdfUploads();
        $request = Request::create('/api/v2/messages', 'POST', [], [], [
            'attachments' => [
                UploadedFile::fake()->createWithContent('minutes.pdf', F551Pdf::plain()),
                UploadedFile::fake()->createWithContent('notes.txt', 'hello'),
            ],
        ]);

        $response = $middleware->handle($request, static fn (): Response => response()->json(['passed' => true]));

        self::assertSame(200, $response->getStatusCode());
    }

    public function test_group_file_service_refuses_it_without_the_middleware(): void
    {
        Storage::fake('local');
        $group = $this->groupOwnedByActingMember();
        $service = app(GroupFileService::class);

        $result = $service->upload($group->id, (int) auth()->id(), [
            'file' => UploadedFile::fake()->createWithContent('minutes.pdf', F551Pdf::withOpenActionJavaScript()),
        ]);

        self::assertNull($result);
        self::assertSame('PDF_ACTIVE_CONTENT', $service->getErrors()[0]['code'] ?? null);
    }

    private function groupOwnedByActingMember(): Group
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        return Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $user->id,
            'status' => 'active',
            'is_active' => true,
        ]);
    }
}
