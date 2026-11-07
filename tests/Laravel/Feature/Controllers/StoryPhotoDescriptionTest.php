<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A photo story can carry a short written description for screen-reader
 * users (AWID accessibility report, point 6: every image a member uploads).
 * Before this the viewer could only say "Story from {name}".
 */
final class StoryPhotoDescriptionTest extends TestCase
{
    use DatabaseTransactions;

    /** @var list<string> */
    private array $uploaded = [];

    protected function tearDown(): void
    {
        foreach ($this->uploaded as $url) {
            $path = base_path('httpdocs/' . ltrim((string) parse_url($url, PHP_URL_PATH), '/'));
            if (is_file($path)) {
                @unlink($path);
            }
        }
        parent::tearDown();
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function postPhotoStory(array $fields): \Illuminate\Testing\TestResponse
    {
        $response = $this->post('/api/v2/stories', array_merge([
            'media_type' => 'image',
            'media' => UploadedFile::fake()->image('IMG_3001.png', 40, 40),
        ], $fields), $this->withTenantHeader());
        if (is_string($response->json('data.media_url'))) {
            $this->uploaded[] = $response->json('data.media_url');
        }

        return $response;
    }

    public function test_a_photo_story_keeps_the_description_its_author_wrote(): void
    {
        $this->member();

        $response = $this->postPhotoStory(['media_alt' => 'Our community garden in bloom']);

        $response->assertStatus(201);
        $response->assertJsonPath('data.media_alt', 'Our community garden in bloom');
        $this->assertSame(
            'Our community garden in bloom',
            DB::table('stories')->where('id', $response->json('data.id'))->value('media_alt')
        );
    }

    public function test_a_blank_description_is_stored_as_none(): void
    {
        $this->member();

        $response = $this->postPhotoStory(['media_alt' => '   ']);

        $response->assertStatus(201);
        $this->assertNull($response->json('data.media_alt'));
    }

    public function test_a_description_longer_than_255_characters_is_refused(): void
    {
        $this->member();

        $response = $this->postPhotoStory(['media_alt' => str_repeat('x', 256)]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.field', 'media_alt');
    }

    public function test_a_text_story_has_no_photo_description(): void
    {
        $this->member();

        $response = $this->post('/api/v2/stories', [
            'media_type' => 'text',
            'text_content' => 'Hello everyone',
            'media_alt' => 'Not a photo',
        ], $this->withTenantHeader());

        $response->assertStatus(201);
        $this->assertNull($response->json('data.media_alt'));
    }
}
