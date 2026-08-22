<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for VoiceMessageController — voice message upload.
 */
class VoiceMessageControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  POST /messages/voice
    // ------------------------------------------------------------------

    public function test_store_requires_auth(): void
    {
        $response = $this->apiPost('/messages/voice', []);

        $response->assertStatus(401);
    }

    public function test_store_requires_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/messages/voice', []);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    /**
     * 🔴 Every voice message on the platform was stored as one second long.
     *
     * `MessagesController::sendVoice()` — the route both frontends actually call — passed a
     * literal 0 to `AudioUploader::upload()`, which stores `max(1, $duration)`. Measured on a
     * device on 2026-08-22: recordings of 38s, 2s and 4s all arrived as `audio_duration = 1`
     * and rendered to the recipient as "0:00". The sibling `/messages/voice` route has always
     * read `duration` from the request; only this one did not, which is why reading the
     * duration handling a few methods up in the same file made it look correct.
     *
     * This is a source assertion rather than an upload round-trip because the uploader writes
     * to the real filesystem and validates real audio; what regressed was a single argument,
     * and that is what is pinned here.
     */
    public function test_the_mobile_voice_route_passes_the_recorded_duration_not_a_literal_zero(): void
    {
        $source = file_get_contents(app_path('Http/Controllers/Api/MessagesController.php'));

        $sendVoice = substr($source, (int) strpos($source, 'public function sendVoice'));
        $sendVoice = substr($sendVoice, 0, (int) strpos($sendVoice, "
    public function ", 10) ?: strlen($sendVoice));

        $this->assertStringContainsString(
            "request()->input('duration'",
            $sendVoice,
            'sendVoice() must read the recorded duration from the request.'
        );
        $this->assertStringNotContainsString(
            'AudioUploader::upload($fileArray, 0)',
            $sendVoice,
            'sendVoice() must not pass a literal 0 — that stores every voice message as one second.'
        );
        $this->assertStringContainsString(
            'AudioUploader::upload($fileArray, $duration)',
            $sendVoice
        );
    }

    public function test_the_uploader_floors_a_missing_duration_and_refuses_an_implausible_one(): void
    {
        $source = file_get_contents(app_path('Core/AudioUploader.php'));

        // The floor is what makes a missing duration look like a real one-second clip, and
        // the ceiling is what stops a client claiming an arbitrary length.
        $this->assertStringContainsString("=> max(1, \$duration)", $source);
        $this->assertStringContainsString('$duration > self::$maxDuration', $source);
    }

    public function test_voice_messages_do_not_send_a_second_direct_email(): void
    {
        $source = file_get_contents(app_path('Http/Controllers/Api/VoiceMessageController.php'));

        $this->assertStringContainsString('MessageService::send', $source);
        $this->assertStringNotContainsString('EmailDispatchService::sendRaw', $source);
        $this->assertStringNotContainsString('voice_message.email_subject', $source);
    }

    public function test_transcription_uses_the_server_owned_uploaded_path_without_refetching(): void
    {
        $controller = file_get_contents(app_path('Http/Controllers/Api/VoiceMessageController.php'));
        $messages = file_get_contents(app_path('Http/Controllers/Api/MessagesController.php'));

        $this->assertStringContainsString('$audioResult[\'local_path\'] ?? null', $controller);
        $this->assertStringContainsString('$audioResult[\'local_path\'] ?? null', $messages);
        $this->assertStringNotContainsString('safeDownloadAudio', $controller);
        $this->assertStringContainsString('TranscriptionService::transcribe($audioPath)', $messages);
    }
}
