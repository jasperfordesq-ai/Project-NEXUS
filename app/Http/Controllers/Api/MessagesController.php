<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Services\MessageService;
use App\Services\BrokerMessageVisibilityService;
use App\Services\TranscriptionService;
use App\Services\TranslationConfigurationService;
use App\Core\AudioUploader;
use App\Core\MessageAttachmentUploader;
use App\Models\Message;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * MessagesController - Conversations, direct messaging, reactions.
 *
 * Converted from delegation to direct static service calls.
 * sendVoice() uses native Laravel request()->file(). uploadVoice() is retained
 * only as an unrouted compatibility helper; generic sends reject voice URLs.
 * typing() remains delegated (uses Pusher real-time events).
 */
class MessagesController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly MessageService $messageService,
        private readonly BrokerMessageVisibilityService $brokerMessageVisibilityService,
    ) {}

    // ================================================================
    // CONVERSATIONS
    // ================================================================

    /**
     * GET /api/v2/messages/conversations
     */
    public function conversations(): JsonResponse
    {
        $userId = $this->requireAuth();

        $filters = [
            'limit'    => $this->queryInt('per_page', 20, 1, 100),
            'archived' => $this->queryBool('archived', false),
        ];
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->messageService->getConversations($userId, $filters);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $filters['limit'],
            $result['has_more']
        );
    }

    /**
     * GET /api/v2/messages/{id}
     */
    public function show(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $otherUserId = $id;

        // Verify conversation exists
        $conversation = $this->messageService->getConversation($otherUserId, $userId);

        if (!$conversation) {
            $errors = $this->messageService->getErrors();
            if (!empty($errors)) {
                return $this->respondWithErrors($errors, 404);
            }
            return $this->respondWithError('NOT_FOUND', __('api.conversation_not_found'), null, 404);
        }

        $filters = [
            'limit'     => $this->queryInt('per_page', 50, 1, 100),
            'direction' => $this->query('direction', 'older'),
        ];
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->messageService->getMessages($otherUserId, $userId, $filters);

        // Mark as read when viewing (unless explicitly fetching newer messages for polling)
        if ($filters['direction'] !== 'newer' || !$this->query('cursor')) {
            $this->messageService->markAsRead($otherUserId, $userId);
        }

        return $this->respondWithData($result['items'], [
            'conversation' => $conversation,
            'cursor'       => $result['cursor'],
            'per_page'     => $filters['limit'],
            'has_more'     => $result['has_more'],
        ]);
    }

    /**
     * POST /api/v2/messages
     */
    public function send(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('messages_send', 30, 60);

        $data = $this->getAllInput();

        if (empty($data['recipient_id'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_recipient_required'), 'recipient_id', 422);
        }

        // Voice pointers are never accepted from generic message input. Voice
        // bytes must pass through the dedicated multipart upload route, which
        // creates and validates the server-issued tenant-scoped path.
        if (array_key_exists('voice_url', $data)
            || array_key_exists('audio_url', $data)
            || !empty($data['is_voice'])) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.message_voice_file_required'),
                'voice_message',
                422,
            );
        }

        $recipientId = (int) $data['recipient_id'];
        // This is an actual send attempt, not a read-only conversation check.
        // Record denied safeguarding contact attempts so staff can respond.
        $preflightError = $this->messageService->preflightWrite($userId, $recipientId, true);
        if ($preflightError !== null) {
            return $this->respondWithErrors([$preflightError], $this->preflightErrorStatus($preflightError));
        }

        $body = trim($data['body'] ?? '');
        if (mb_strlen($body) > 10000) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_too_long'), 'body', 400);
        }

        // File/image attachments (multipart). Store each up front so a failure is
        // reported before the message is created; pass metadata to the service.
        $uploaded = request()->file('attachments');
        $files = is_array($uploaded) ? $uploaded : ($uploaded ? [$uploaded] : []);
        if (count($files) > MessageAttachmentUploader::MAX_FILES) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_attachment_too_many', ['max' => MessageAttachmentUploader::MAX_FILES]), 'attachments', 422);
        }
        $attachments = [];
        foreach ($files as $file) {
            if (!$file || !$file->isValid()) {
                $this->deleteStagedAttachments($attachments);
                return $this->respondWithError('VALIDATION_ERROR', __('api.message_attachment_upload_error'), 'attachments', 422);
            }
            try {
                $attachments[] = MessageAttachmentUploader::upload([
                    'name'     => $file->getClientOriginalName(),
                    'type'     => $file->getMimeType(),
                    'tmp_name' => $file->getRealPath(),
                    'error'    => UPLOAD_ERR_OK,
                    'size'     => $file->getSize(),
                ]);
            } catch (\InvalidArgumentException $e) {
                $this->deleteStagedAttachments($attachments);
                return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), 'attachments', 422);
            } catch (\Throwable $e) {
                $this->deleteStagedAttachments($attachments);
                Log::error('Message attachment upload failed', ['error' => $e->getMessage()]);
                return $this->respondWithError('UPLOAD_FAILED', __('api.message_attachment_upload_error'), 'attachments', 400);
            }
        }
        if (!empty($attachments)) {
            $data['attachments'] = $attachments;
        }

        if (empty($body) && empty($attachments)) {
            $this->deleteStagedAttachments($attachments);
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_body_required'), 'body', 422);
        }

        $message = $this->messageService->send($userId, $data);

        if (!$message) {
            $this->deleteStagedAttachments($attachments);
            $errors = $this->messageService->getErrors();
            $status = isset($errors[0]) && is_array($errors[0])
                ? $this->preflightErrorStatus($errors[0])
                : 422;
            return $this->respondWithErrors($errors, $status);
        }

        // Award XP for sending a message
        try {
            \App\Services\GamificationService::awardXP($userId, \App\Services\GamificationService::XP_VALUES['send_message'], 'send_message', 'Sent a message');
        } catch (\Throwable $e) {
            \Log::warning('Gamification XP award failed', ['action' => 'send_message', 'user' => $userId, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData($message, null, 201);
    }

    /**
     * PUT /api/v2/messages/{id}/read
     */
    public function markRead(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('messages_mark_read', 60, 60);
        $otherUserId = $id;

        $count = $this->messageService->markAsRead($otherUserId, $userId);

        return $this->respondWithData(['marked_read' => $count]);
    }

    /**
     * GET /api/v2/messages/unread-count
     */
    public function unreadCount(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('messages_unread_count', 60, 60);

        $count = $this->messageService->getUnreadCount($userId);

        return $this->respondWithData(['count' => $count]);
    }

    // ================================================================
    // SAFEGUARDING — COORDINATOR ASSISTANCE
    // ================================================================

    /**
     * POST /api/v2/messages/{id}/request-coordinator
     *
     * Explicit request for a broker/admin/coordinator to help arrange contact with a
     * member who cannot be messaged directly because of safeguarding rules. This — not
     * opening the conversation — is what alerts staff. The restriction is re-checked
     * server-side, so an unrestricted recipient yields a no-op error rather than an alert.
     *
     * @param int $id The recipient (other user) ID.
     */
    public function requestCoordinator(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('messages_request_coordinator', 5, 300);

        $result = $this->messageService->requestCoordinatorAssistance($userId, $id);

        if (empty($result)) {
            return $this->respondWithErrors($this->messageService->getErrors(), 422);
        }

        return $this->respondWithData($result);
    }

    // ================================================================
    // RESTRICTION STATUS
    // ================================================================

    /**
     * GET /api/v2/messages/restriction-status?partner_id={id}
     *
     * With `partner_id`, the payload additionally carries the supporter-view
     * disclosure flags for THIS conversation pair:
     *
     * - `supporter_view_notice_required` — true when EITHER participant has an
     *   active consented message-access grant. Deliberately symmetric: the
     *   payload is identical for both parties, so it never says WHOSE
     *   supporter it is. The frontend folds it into the same cause-agnostic
     *   banner as the broker review notice, which blunts the residual
     *   inference further (a counterparty cannot distinguish broker review
     *   from supporter access).
     * - `own_messages_shared` — true only for the member who granted access,
     *   driving their own persistent reminder. Their own fact; not a leak.
     */
    public function restrictionStatus(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('messages_restriction_status', 30, 60);

        $status = $this->brokerMessageVisibilityService->getUserRestrictionStatus($userId);

        $partnerId = (int) request()->query('partner_id', 0);
        if ($partnerId > 0) {
            $status += \App\Services\SubAccountService::messageAccessNoticeFlags($userId, $partnerId);
        }

        return $this->respondWithData($status);
    }

    // ================================================================
    // ARCHIVE / RESTORE
    // ================================================================

    /**
     * DELETE /api/v2/messages/conversations/{id}
     *
     * Accepts optional body: { "scope": "self" | "everyone" }
     * "self" (default) — hides from current user's inbox only (restorable).
     * "everyone"       — hides from both users' inboxes.
     */
    public function archiveConversation($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('messages_delete', 10, 60);

        $conversation = $this->messageService->getConversation($id, $userId);
        if (!$conversation) {
            return $this->respondWithError('NOT_FOUND', __('api.conversation_not_found'), null, 404);
        }

        $scope = in_array($this->input('scope'), ['self', 'everyone'], true)
            ? $this->input('scope')
            : 'self';

        // Returns int (rows updated) — 0 is valid when already archived (idempotent)
        $this->messageService->archiveConversation($id, $userId, $scope);

        return $this->respondWithData(['success' => true, 'message' => __('api.conversation_deleted')]);
    }

    /**
     * DELETE /api/v2/messages/{id} — Archive/delete conversation
     */
    public function archive($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('messages_delete', 10, 60);

        $conversation = $this->messageService->getConversation($id, $userId);
        if (!$conversation) {
            return $this->respondWithError('NOT_FOUND', __('api.conversation_not_found'), null, 404);
        }

        $this->messageService->archiveConversation($id, $userId);

        return $this->noContent();
    }

    /**
     * POST /api/v2/messages/conversations/{id}/restore
     */
    public function restoreConversation($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('messages_restore', 20, 60);

        $count = $this->messageService->unarchiveConversation($id, $userId);

        if ($count === 0) {
            return $this->respondWithError('NOT_FOUND', __('api.message_no_archived_found'), null, 404);
        }

        return $this->respondWithData(['success' => true, 'message' => __('api.conversation_restored'), 'restored_count' => $count]);
    }

    // ================================================================
    // EDIT / DELETE MESSAGE
    // ================================================================

    /**
     * PUT /api/v2/messages/{id}
     */
    public function update($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('messages_edit', 30, 60);

        $body = trim($this->input('body', ''));
        if (empty($body)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_body_required'), 'body', 400);
        }

        if (mb_strlen($body) > 10000) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_too_long'), 'body', 400);
        }

        $result = $this->messageService->editMessage($id, $userId, $body);

        if ($result === null) {
            $errors = $this->messageService->getErrors();
            if (!empty($errors)) {
                $status = isset($errors[0]) && is_array($errors[0])
                    ? $this->preflightErrorStatus($errors[0])
                    : 403;
                return $this->respondWithErrors($errors, $status);
            }
            return $this->respondWithError('NOT_FOUND', __('api.message_not_found'), null, 404);
        }

        return $this->respondWithData($result);
    }

    /**
     * DELETE /api/v2/messages/{id}
     *
     * Accepts optional body: { "scope": "self" | "everyone" }
     * "everyone" (default) — blanks message for both parties.
     * "self"               — hides message from current user's view only.
     */
    public function deleteMessage($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('messages_delete', 20, 60);

        $scope = in_array($this->input('scope'), ['self', 'everyone'], true)
            ? $this->input('scope')
            : 'everyone';

        $success = $this->messageService->deleteMessage($id, $userId, $scope);

        if (!$success) {
            $errors = $this->messageService->getErrors();
            if (!empty($errors)) {
                return $this->respondWithErrors($errors, 403);
            }
            return $this->respondWithError('NOT_FOUND', __('api.message_not_found'), null, 404);
        }

        return $this->respondWithData(['success' => true, 'message' => __('api.message_deleted')]);
    }

    // ================================================================
    // REACTIONS
    // ================================================================

    /**
     * POST /api/v2/messages/{id}/reactions
     */
    public function toggleReaction($id): JsonResponse
    {
        $id = (int) $id;
        $userId = $this->requireAuth();
        $this->rateLimit('messages_reactions', 60, 60);

        $emoji = $this->input('emoji', '');
        if (empty($emoji)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_emoji_required'), 'emoji', 400);
        }

        if (!in_array($emoji, \App\Support\EmojiConstants::MESSAGE_REACTIONS, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_invalid_emoji'), 'emoji', 400);
        }

        $result = $this->messageService->toggleReaction($id, $userId, $emoji);

        if ($result === null) {
            $errors = $this->messageService->getErrors();
            if (!empty($errors)) {
                $status = isset($errors[0]) && is_array($errors[0])
                    ? $this->preflightErrorStatus($errors[0])
                    : 404;
                return $this->respondWithErrors($errors, $status);
            }
            return $this->respondWithError('NOT_FOUND', __('api.message_not_found'), null, 404);
        }

        return $this->respondWithData([
            'action'     => $result ? 'added' : 'removed',
            'emoji'      => $emoji,
            'message_id' => $id,
        ]);
    }

    /**
     * DELETE /api/v2/messages/conversations (v1 legacy — delete conversation)
     */
    public function deleteConversation(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('messages_delete', 10, 60);

        $otherUserId = $this->inputInt('other_user_id');
        if (!$otherUserId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_other_user_required'), 'other_user_id', 400);
        }

        try {
            $deleted = Message::deleteConversation($userId, $otherUserId);
            return $this->success(['deleted' => $deleted]);
        } catch (\Throwable $e) {
            Log::error('Failed to delete conversation', ['error' => $e->getMessage(), 'user' => $userId, 'other_user' => $otherUserId]);
            return $this->error('Failed to delete conversation', 500);
        }
    }

    /**
     * GET /api/v2/messages/reactions/batch?ids=1,2,3
     */
    public function getReactionsBatch(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('messages_reactions_batch', 30, 60);

        $idsParam = $this->query('ids', '');
        if (empty($idsParam)) {
            return $this->success(['reactions' => []]);
        }

        $ids = array_filter(array_map('intval', explode(',', $idsParam)));
        if (empty($ids)) {
            return $this->success(['reactions' => []]);
        }

        // Limit to 100 messages at a time
        $ids = array_slice($ids, 0, 100);

        try {
            $reactions = Message::getReactionsBatch($ids, $userId);
            return $this->success(['reactions' => $reactions]);
        } catch (\Throwable $e) {
            Log::error('Failed to fetch reactions batch', ['error' => $e->getMessage(), 'ids' => $ids]);
            return $this->error('Failed to fetch reactions', 500);
        }
    }

    // ================================================================
    // TYPING INDICATOR (Pusher real-time)
    // ================================================================

    /**
     * POST /api/v2/messages/typing
     */
    public function typing(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('messages_typing', 60, 60);

        $recipientId = $this->inputInt('recipient_id', 0, 1);
        $isTyping = $this->inputBool('is_typing', true);

        if (!$recipientId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_recipient_id_required'), 'recipient_id', 400);
        }

        $preflightError = $this->messageService->preflightWrite($userId, $recipientId);
        if ($preflightError !== null) {
            return $this->respondWithErrors([$preflightError], $this->preflightErrorStatus($preflightError));
        }

        $this->messageService->setTypingIndicator($recipientId, $userId, $isTyping);

        return $this->respondWithData(['sent' => true]);
    }

    // ================================================================
    // VOICE UPLOADS (native Laravel)
    // ================================================================

    /**
     * POST /api/v2/messages/upload-voice
     *
     * Legacy upload-only helper (not routed).
     * Accepts file upload (field: 'audio') or base64 (field: 'audio_data' + 'mime_type').
     * Do not expose this as a public route: generic send() deliberately rejects
     * client-supplied voice pointers. Clients use the multipart sendVoice route.
     */
    public function uploadVoice(): JsonResponse
    {
        $this->requireAuth();
        $this->rateLimit('messages_voice_upload', 10, 60);

        $duration = $this->inputInt('duration', 0, 0);

        try {
            $audioResult = null;

            $file = request()->file('audio');
            if ($file && $file->isValid()) {
                // Standard file upload
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
                return $this->respondWithError('VALIDATION_ERROR', __('api.message_no_audio'), 'audio', 400);
            }

            return $this->respondWithData([
                'voice_url' => $audioResult['url'],
                'duration'  => $audioResult['duration'],
            ]);
        } catch (\Exception $e) {
            Log::error('Voice upload failed', ['error' => $e->getMessage(), 'trace' => $e->getTraceAsString()]);
            return $this->respondWithError('UPLOAD_FAILED', __('api.message_voice_upload_failed'), 'audio', 400);
        }
    }

    /**
     * POST /api/v2/messages/voice
     *
     * Upload and send a voice message in one step. Uses request()->file() (Laravel native).
     * Field name: 'voice_message'. Form field: 'recipient_id' (required).
     */
    public function sendVoice(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('messages_voice_upload', 10, 60);

        $recipientId = (int) request()->input('recipient_id', 0);
        if (!$recipientId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_recipient_id_required'), 'recipient_id', 400);
        }

        $preflightError = $this->messageService->preflightWrite($userId, $recipientId);
        if ($preflightError !== null) {
            return $this->respondWithErrors([$preflightError], $this->preflightErrorStatus($preflightError));
        }

        $file = request()->file('voice_message');
        if (!$file || !$file->isValid()) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_voice_file_required'), 'voice_message', 400);
        }

        try {
            // Build a $_FILES-compatible array for AudioUploader::upload()
            $fileArray = [
                'name'     => $file->getClientOriginalName(),
                'type'     => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error'    => UPLOAD_ERR_OK,
                'size'     => $file->getSize(),
            ];

            $audioResult = AudioUploader::upload($fileArray, 0);

            // Send the message with voice attachment
            $message = $this->messageService->sendVoice(
                $userId,
                $recipientId,
                (string) $audioResult['url'],
                (int) $audioResult['duration'],
            );

            if (!$message) {
                AudioUploader::delete((string) $audioResult['url']);
                $errors = $this->messageService->getErrors();
                $status = isset($errors[0]) && is_array($errors[0])
                    ? $this->preflightErrorStatus($errors[0])
                    : 422;
                return $this->respondWithErrors($errors, $status);
            }

            // Transcribe the audio (non-blocking — failures are logged, not thrown)
            try {
                $audioPath = $audioResult['local_path'] ?? null;
                if ($audioPath && file_exists($audioPath)) {
                    $transcription = TranscriptionService::transcribe($audioPath);
                    if ($transcription && !empty($transcription['text'])) {
                        $messageId = $message['id'] ?? $message['message_id'] ?? null;
                        if ($messageId) {
                            DB::table('messages')
                                ->where('id', $messageId)
                                ->where('tenant_id', \App\Core\TenantContext::getId())
                                ->update([
                                    'transcript'          => $transcription['text'],
                                    'transcript_language' => $transcription['language'] ?? 'en',
                                ]);
                            $message['transcript'] = $transcription['text'];
                            $message['transcript_language'] = $transcription['language'] ?? 'en';
                        }
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('Voice message transcription failed', [
                    'error' => $e->getMessage(),
                ]);
            }

            return $this->respondWithData($message, null, 201);
        } catch (\Exception $e) {
            Log::error('Voice message send failed', ['error' => $e->getMessage(), 'trace' => $e->getTraceAsString()]);
            return $this->respondWithError('UPLOAD_FAILED', __('api.message_voice_send_failed'), 'voice_message', 400);
        }
    }

    /** @param array<string, mixed> $error */
    private function preflightErrorStatus(array $error): int
    {
        return match ($error['code'] ?? null) {
            'SAFEGUARDING_POLICY_UNAVAILABLE' => 503,
            'VETTING_REQUIRED', 'SAFEGUARDING_CONTACT_RESTRICTED', 'BLOCKED',
            'MESSAGING_DISABLED', 'FORBIDDEN' => 403,
            'NOT_FOUND' => 404,
            default => 422,
        };
    }

    /** @param list<array<string, mixed>> $attachments */
    private function deleteStagedAttachments(array $attachments): void
    {
        foreach ($attachments as $attachment) {
            $url = $attachment['url'] ?? null;
            if (is_string($url) && $url !== '') {
                MessageAttachmentUploader::delete($url);
            }
        }
    }

    /**
     * POST /api/v2/messages/{id}/translate
     *
     * Translate a message to the requested target language.
     * Supports both voice message transcripts and text message bodies.
     * User must be the sender or receiver of the message.
     */
    public function translateTranscript(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        if (!\App\Core\TenantContext::hasFeature('message_translation')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.feature_disabled'), null, 403);
        }

        $this->rateLimit('messages_translate', 20, 60);

        $targetLanguage = trim(request()->input('target_language', ''));
        if (empty($targetLanguage)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_target_language_required'), 'target_language', 400);
        }
        if (strlen($targetLanguage) > 10 || !preg_match('/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/', $targetLanguage)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_target_language_required'), 'target_language', 400);
        }

        $tenantId = \App\Core\TenantContext::getId();

        // Fetch the message — user must be sender or receiver
        $message = DB::table('messages')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->where(function ($q) use ($userId) {
                $q->where('sender_id', $userId)
                  ->orWhere('receiver_id', $userId);
            })
            ->first();

        if (!$message) {
            return $this->respondWithError('NOT_FOUND', __('api.message_not_found'), null, 404);
        }

        // Determine what to translate: transcript (voice messages) or body (text messages)
        $sourceText = null;
        $fromLanguage = 'auto';

        if (!empty($message->transcript)) {
            $sourceText = $message->transcript;
            $fromLanguage = $message->transcript_language ?? 'auto';
        } elseif (!empty($message->body)) {
            $sourceText = $message->body;
            $fromLanguage = 'auto';
        }

        if (empty($sourceText)) {
            return $this->respondWithError('NO_CONTENT', __('api.message_no_translatable_content'), null, 422);
        }

        // INT7: Fetch conversation context for better disambiguation
        $conversationContext = [];
        $translationConfig = TranslationConfigurationService::getAll();
        if (!empty($translationConfig['translation.context_aware'])) {
            $contextLimit = (int) ($translationConfig['translation.context_messages'] ?? 5);
            $otherUserId = ($message->sender_id === $userId) ? $message->receiver_id : $message->sender_id;
            $contextRows = DB::table('messages')
                ->where('tenant_id', $tenantId)
                ->where(function ($q) use ($userId, $otherUserId) {
                    $q->where(function ($q2) use ($userId, $otherUserId) {
                        $q2->where('sender_id', $userId)->where('receiver_id', $otherUserId);
                    })->orWhere(function ($q2) use ($userId, $otherUserId) {
                        $q2->where('sender_id', $otherUserId)->where('receiver_id', $userId);
                    });
                })
                ->where('id', '<', $id)
                ->where('is_deleted', false)
                ->orderByDesc('id')
                ->limit($contextLimit)
                ->pluck('body')
                ->reverse()
                ->values()
                ->filter(fn($b) => !empty($b))
                ->toArray();
            $conversationContext = $contextRows;
        }

        // INT10: Load glossary terms for the target language (only when enabled)
        $glossary = [];
        if (!empty($translationConfig['translation.glossary_enabled'])
            && DB::getSchemaBuilder()->hasTable('translation_glossaries')
        ) {
            // Limit to 50 terms to keep the LLM prompt within reasonable token bounds
            $glossaryRows = DB::table('translation_glossaries')
                ->where('tenant_id', $tenantId)
                ->where('target_language', $targetLanguage)
                ->where('is_active', true)
                ->limit(50)
                ->get(['source_term', 'target_term']);
            foreach ($glossaryRows as $row) {
                $glossary[$row->source_term] = $row->target_term;
            }
        }

        $translatedText = TranscriptionService::translate($sourceText, $fromLanguage, $targetLanguage, $conversationContext, $glossary);

        if ($translatedText === null) {
            return $this->respondWithError('TRANSLATION_FAILED', __('api.message_translation_failed'), null, 500);
        }

        return $this->respondWithData([
            'translated_text' => $translatedText,
            'source_type'     => !empty($message->transcript) ? 'transcript' : 'body',
            'context_used'    => !empty($conversationContext),
        ]);
    }

}
