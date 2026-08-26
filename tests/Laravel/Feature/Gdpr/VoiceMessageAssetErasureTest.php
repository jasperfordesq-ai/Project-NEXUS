<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Gdpr;

use App\Core\TenantContext;
use App\Models\Message;
use App\Models\User;
use App\Services\Enterprise\GdprService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Regression coverage for voice-message file erasure. Database pointers are
 * untrusted legacy data: erasure may unlink only a canonical recording in the
 * current tenant's voice directory. Safe pointers are scrubbed, while a failed
 * unlink retains its pointer so an incomplete erasure can be retried.
 */
class VoiceMessageAssetErasureTest extends TestCase
{
    use DatabaseTransactions;

    public function test_erasure_locks_the_tenant_user_before_export_and_voice_snapshot_reads(): void
    {
        $source = file_get_contents(base_path('app/Services/Enterprise/GdprService.php'));
        self::assertIsString($source);
        $methodStart = strpos($source, 'public function executeAccountDeletion(');
        self::assertNotFalse($methodStart);
        $method = substr($source, $methodStart);

        $userLock = strpos(
            $method,
            'SELECT id FROM users WHERE id = ? AND tenant_id = ? FOR UPDATE'
        );
        // The export is now raised only for a DPO-managed request, so it passes
        // the request id through. A direct self-service deletion skips it
        // entirely — but when it does run it must still run behind the lock,
        // which is the ordering this test exists to pin.
        $exportRead = strpos($method, '$this->generateDataExport($userId, $requestId)');
        $voiceSnapshot = strpos(
            $method,
            'SELECT id, sender_id, audio_url FROM messages'
        );

        self::assertNotFalse($userLock);
        self::assertNotFalse($exportRead);
        self::assertNotFalse($voiceSnapshot);
        self::assertTrue(
            $userLock < $exportRead && $userLock < $voiceSnapshot,
            'Erasure must lock the tenant-user row before any snapshot can omit a concurrent send.',
        );
    }

    private function gdprService(int $tenantId, bool $forceVoiceUnlinkFailure = false): GdprService
    {
        return new class($tenantId, $forceVoiceUnlinkFailure) extends GdprService {
            public function __construct(int $tenantId, private readonly bool $forceVoiceUnlinkFailure)
            {
                parent::__construct($tenantId);
            }

            public function generateDataExport(int $userId, int $requestId = null): string
            {
                return '';
            }

            protected function deleteTenantVoiceRecording(string $url): bool
            {
                if ($this->forceVoiceUnlinkFailure) {
                    return false;
                }

                return parent::deleteTenantVoiceRecording($url);
            }
        };
    }

    public function test_erasure_deletes_only_canonical_current_tenant_voice_file(): void
    {
        $tenantId = $this->testTenantId;
        TenantContext::setById($tenantId);
        $user = User::factory()->forTenant($tenantId)->create();
        $recipient = User::factory()->forTenant($tenantId)->create();

        $otherTenantId = (int) DB::table('tenants')
            ->where('id', '!=', $tenantId)
            ->orderBy('id')
            ->value('id');
        if ($otherTenantId <= 0) {
            $otherTenantId = (int) DB::table('tenants')->insertGetId([
                'name' => 'Voice erasure isolation tenant',
                'slug' => 'voice-erasure-' . uniqid(),
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $suffix = uniqid('', true);
        $ownedUrl = "/uploads/{$tenantId}/voice_messages/voice_owned_{$suffix}.webm";
        $foreignUrl = "/uploads/{$otherTenantId}/voice_messages/voice_foreign_{$suffix}.webm";
        $sentinelName = "gdpr-voice-sentinel-{$suffix}.txt";
        $traversalUrl = "/uploads/{$tenantId}/voice_messages/../../../{$sentinelName}";

        $ownedPath = public_path(ltrim($ownedUrl, '/'));
        $foreignPath = public_path(ltrim($foreignUrl, '/'));
        $sentinelPath = public_path($sentinelName);
        foreach ([dirname($ownedPath), dirname($foreignPath)] as $directory) {
            if (!is_dir($directory)) {
                mkdir($directory, 0775, true);
            }
        }
        file_put_contents($ownedPath, 'owned voice recording');
        file_put_contents($foreignPath, 'foreign tenant voice recording');
        file_put_contents($sentinelPath, 'must survive traversal pointer');

        $messageIds = [];
        try {
            foreach ([$ownedUrl, $foreignUrl, $traversalUrl] as $audioUrl) {
                $message = Message::create([
                    'sender_id' => $user->id,
                    'receiver_id' => $recipient->id,
                    'body' => '',
                    'is_read' => false,
                    'is_voice' => true,
                    'audio_url' => $audioUrl,
                    'audio_duration' => 5,
                    'created_at' => now(),
                ]);
                $messageIds[] = (int) $message->id;
            }

            $this->gdprService($tenantId)->executeAccountDeletion($user->id);

            $this->assertFileDoesNotExist($ownedPath);
            $this->assertFileExists($foreignPath);
            $this->assertFileExists($sentinelPath);
            $this->assertSame(
                0,
                DB::table('messages')->whereIn('id', $messageIds)->whereNotNull('audio_url')->count(),
                'Valid and invalid legacy voice pointers must all be scrubbed from retained message rows.',
            );
        } finally {
            @unlink($ownedPath);
            @unlink($foreignPath);
            @unlink($sentinelPath);
            foreach (glob(storage_path("exports/nexus_data_export_{$user->id}_*.zip")) ?: [] as $export) {
                @unlink($export);
            }
            TenantContext::reset();
        }
    }

    public function test_erasure_preserves_recording_referenced_by_another_sender(): void
    {
        $tenantId = $this->testTenantId;
        TenantContext::setById($tenantId);
        $erasedUser = User::factory()->forTenant($tenantId)->create();
        $recordingOwner = User::factory()->forTenant($tenantId)->create();
        $recipient = User::factory()->forTenant($tenantId)->create();

        $filename = 'voice_shared_' . uniqid('', true) . '.webm';
        $sharedUrl = "/uploads/{$tenantId}/voice_messages/{$filename}";
        // A different raw pointer that resolves to the same canonical file.
        $poisonedUrl = "/uploads/{$tenantId}/voice_messages/%76" . substr($filename, 1);
        $sharedPath = public_path(ltrim($sharedUrl, '/'));
        if (!is_dir(dirname($sharedPath))) {
            mkdir(dirname($sharedPath), 0775, true);
        }
        file_put_contents($sharedPath, 'recording owned by another sender');

        try {
            $ownerMessage = Message::create([
                'sender_id' => $recordingOwner->id,
                'receiver_id' => $recipient->id,
                'body' => '',
                'is_read' => false,
                'is_voice' => true,
                'audio_url' => $sharedUrl,
                'audio_duration' => 5,
                'created_at' => now(),
            ]);
            $poisonedMessage = Message::create([
                'sender_id' => $erasedUser->id,
                'receiver_id' => $recipient->id,
                'body' => '',
                'is_read' => false,
                'is_voice' => true,
                'audio_url' => $poisonedUrl,
                'audio_duration' => 5,
                'created_at' => now(),
            ]);

            $this->gdprService($tenantId)->executeAccountDeletion($erasedUser->id);

            $this->assertFileExists($sharedPath);
            $this->assertNull(
                DB::table('messages')->where('id', $poisonedMessage->id)->value('audio_url'),
                'The erased sender\'s poisoned/shared pointer must be scrubbed.',
            );
            $this->assertSame(
                $sharedUrl,
                DB::table('messages')->where('id', $ownerMessage->id)->value('audio_url'),
                'Another sender\'s legitimate recording linkage must survive.',
            );
        } finally {
            @unlink($sharedPath);
            foreach (glob(storage_path("exports/nexus_data_export_{$erasedUser->id}_*.zip")) ?: [] as $export) {
                @unlink($export);
            }
            TenantContext::reset();
        }
    }

    public function test_unlink_failure_keeps_retry_pointer_and_request_processing(): void
    {
        $tenantId = $this->testTenantId;
        TenantContext::setById($tenantId);
        $user = User::factory()->forTenant($tenantId)->create();
        $recipient = User::factory()->forTenant($tenantId)->create();

        $voiceUrl = "/uploads/{$tenantId}/voice_messages/voice_unlink_failure_" . uniqid('', true) . '.webm';
        $voicePath = public_path(ltrim($voiceUrl, '/'));
        if (!is_dir(dirname($voicePath))) {
            mkdir(dirname($voicePath), 0775, true);
        }
        file_put_contents($voicePath, 'recording whose unlink is forced to fail');

        $requestId = (int) DB::table('gdpr_requests')->insertGetId([
            'user_id' => $user->id,
            'tenant_id' => $tenantId,
            'request_type' => 'erasure',
            'status' => 'processing',
            'requested_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            $message = Message::create([
                'sender_id' => $user->id,
                'receiver_id' => $recipient->id,
                'body' => '',
                'is_read' => false,
                'is_voice' => true,
                'audio_url' => $voiceUrl,
                'audio_duration' => 5,
                'created_at' => now(),
            ]);

            $this->gdprService($tenantId, true)->executeAccountDeletion($user->id, null, $requestId);

            $this->assertFileExists($voicePath);
            $this->assertSame(
                $voiceUrl,
                DB::table('messages')->where('id', $message->id)->value('audio_url'),
                'A failed unlink must retain the only durable pointer needed for retry.',
            );
            $this->assertSame(
                'processing',
                DB::table('gdpr_requests')->where('id', $requestId)->value('status'),
                'A request with undeleted voice PII must never be marked completed.',
            );
            $this->assertNull(
                DB::table('gdpr_requests')->where('id', $requestId)->value('processed_at'),
            );
        } finally {
            @unlink($voicePath);
            foreach (glob(storage_path("exports/nexus_data_export_{$user->id}_*.zip")) ?: [] as $export) {
                @unlink($export);
            }
            TenantContext::reset();
        }
    }
}
