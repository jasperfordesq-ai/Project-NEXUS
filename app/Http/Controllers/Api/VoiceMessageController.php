<?php
// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Core\AudioUploader;
use App\Core\TenantContext;
use App\Services\MessageService;
use App\Services\TranscriptionService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * VoiceMessageController -- Voice message recording and storage.
 *
 * Native Laravel implementation using request()->file() for audio uploads.
 */
class VoiceMessageController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct() {}

    /**
     * POST /api/v2/voice-messages
     *
     * Upload and send a voice message. Accepts either a file upload (field: 'audio')
     * or base64-encoded audio data (field: 'audio_data' + 'mime_type').
     * Form field: 'receiver_id' (required), 'duration' (optional).
     */
    public function store(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('voice_message_store', 10, 60);

        $senderId = $userId;
        $receiverId = (int) request()->input('receiver_id', 0);
        $duration = (int) request()->input('duration', 0);

        if (!$receiverId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'receiver_id']), 'receiver_id', 400);
        }

        $preflightError = MessageService::preflightWrite($senderId, $receiverId);
        if ($preflightError !== null) {
            $status = ($preflightError['code'] ?? null) === 'SAFEGUARDING_POLICY_UNAVAILABLE' ? 503 : 403;
            return $this->respondWithErrors([$preflightError], $status);
        }

        try {
            $audioResult = null;

            $file = request()->file('audio');
            if ($file && $file->isValid()) {
                // Standard file upload — build $_FILES-compatible array for AudioUploader
                $fileArray = [
                    'name'     => $file->getClientOriginalName(),
                    'type'     => $file->getMimeType(),
                    'tmp_name' => $file->getRealPath(),
                    'error'    => UPLOAD_ERR_OK,
                    'size'     => $file->getSize(),
                ];
                $audioResult = AudioUploader::upload($fileArray, $duration);
            } elseif (request()->input('audio_data')) {
                // Base64 encoded audio (from MediaRecorder blob)
                $mimeType = request()->input('mime_type', 'audio/webm');
                $audioResult = AudioUploader::uploadFromBase64(request()->input('audio_data'), $mimeType, $duration);
            } else {
                return $this->respondWithError('VALIDATION_ERROR', __('api.no_audio_data_provided'), 'audio', 400);
            }

            // Persist only the tenant-scoped pointer returned by AudioUploader.
            $tenant = TenantContext::get();
            $tenantId = $tenant['id'];
            $messageData = MessageService::sendVoice(
                $senderId,
                $receiverId,
                (string) $audioResult['url'],
                (int) $audioResult['duration'],
            );

            if (empty($messageData)) {
                AudioUploader::delete((string) $audioResult['url']);
                $errors = \App\Services\MessageService::getErrors();
                $status = (($errors[0]['code'] ?? null) === 'SAFEGUARDING_POLICY_UNAVAILABLE') ? 503 : 403;
                return $this->respondWithErrors($errors, $status);
            }

            $messageId = $messageData['id'] ?? null;

            // Transcribe the audio file (non-blocking — failures are logged, not thrown).
            // E-035 F-164: only through the AI gate — skipped (message still sent)
            // when the community has AI switched off or the member's budget is spent.
            $transcript = null;
            $transcriptLanguage = null;
            try {
                $audioPath = $audioResult['local_path'] ?? null;

                if ($audioPath && file_exists($audioPath)) {
                    $transcription = TranscriptionService::transcribeForMember($senderId, $audioPath);
                    if ($transcription && !empty($transcription['text'])) {
                        $transcript = $transcription['text'];
                        $transcriptLanguage = $transcription['language'] ?? 'en';

                        DB::table('messages')
                            ->where('id', $messageId)
                            ->where('tenant_id', $tenantId)
                            ->update([
                                'transcript'          => $transcript,
                                'transcript_language' => $transcriptLanguage,
                            ]);
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('Voice message transcription failed', [
                    'message_id' => $messageId,
                    'error'      => $e->getMessage(),
                ]);
            }

            return $this->respondWithData([
                'success'              => true,
                'message_id'           => $messageId,
                'audio_url'            => $messageId ? "/api/v2/messages/{$messageId}/voice" : null,
                'duration'             => $audioResult['duration'],
                'transcript'           => $transcript,
                'transcript_language'  => $transcriptLanguage,
            ], null, 201);
        } catch (\Exception $e) {
            Log::error('Voice message store failed', ['error' => $e->getMessage(), 'trace' => $e->getTraceAsString()]);
            return $this->respondWithError('UPLOAD_FAILED', __('api.audio_upload_failed'), 'audio', 400);
        }
    }

}
