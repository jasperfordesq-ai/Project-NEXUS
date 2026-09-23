<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\AudioUploader;
use App\Core\MessageAttachmentUploader;
use App\Models\Message;
use App\Models\MessageAttachment;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/** Authenticated, tenant-scoped delivery for private direct-message media. */
class MessageMediaController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function attachment(int $message, int $attachment): BinaryFileResponse
    {
        $userId = $this->requireAuth();
        $record = $this->authorizedMessage($message, $userId);
        $media = MessageAttachment::query()
            ->where('id', $attachment)
            ->where('message_id', $record->id)
            ->firstOrFail();
        $storagePath = (string) $media->getRawOriginal('file_path');
        $path = MessageAttachmentUploader::resolveForTenant($storagePath, (int) $record->tenant_id);
        abort_if($path === null, 404);

        return response()->file($path, $this->privateHeaders((string) $media->mime_type));
    }

    public function voice(int $message): BinaryFileResponse
    {
        $userId = $this->requireAuth();
        $record = $this->authorizedMessage($message, $userId);
        $path = AudioUploader::resolveTenantVoiceFilePath(
            (string) $record->getRawOriginal('audio_url'),
            (int) $record->tenant_id,
        );
        abort_if($path === null, 404);

        $mime = (string) (mime_content_type($path) ?: 'application/octet-stream');
        return response()->file($path, $this->privateHeaders($mime));
    }

    private function authorizedMessage(int $messageId, int $userId): Message
    {
        /** @var Message|null $message */
        $message = Message::query()->find($messageId);
        abort_if($message === null, 404);
        // Delete-for-everyone revokes renewed server delivery of every private
        // media representation. Retention may keep the underlying file for
        // moderation/erasure workflows, but participants must no longer fetch it.
        // Per-user delete flags are deliberately separate and do not revoke the
        // other participant's access.
        $deletedForViewer = ((int) $message->sender_id === $userId && (bool) $message->is_deleted_sender)
            || ((int) $message->receiver_id === $userId && (bool) $message->is_deleted_receiver);
        abort_if((bool) $message->is_deleted || $deletedForViewer, 404);

        $isParticipant = (int) $message->sender_id === $userId || (int) $message->receiver_id === $userId;
        if (! $isParticipant && $message->conversation_id) {
            $isParticipant = DB::table('conversation_participants')
                ->where('tenant_id', (int) $message->tenant_id)
                ->where('conversation_id', $message->conversation_id)
                ->where('user_id', $userId)
                ->exists();
        }
        abort_unless($isParticipant, 403);

        return $message;
    }

    /** @return array<string,string> */
    private function privateHeaders(string $mime): array
    {
        return [
            'Content-Type' => $mime,
            'Cache-Control' => 'private, no-store, max-age=0',
            'Pragma' => 'no-cache',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
            'Cross-Origin-Resource-Policy' => 'same-site',
        ];
    }
}
