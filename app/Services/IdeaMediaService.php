<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\IdeaMedia;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * IdeaMediaService — Eloquent-based CRUD for idea media attachments.
 *
 * Manages images, videos, documents, and links attached to challenge ideas
 * via the idea_media table. All queries are tenant-scoped via HasTenantScope.
 */
class IdeaMediaService
{
    /** @var array<int, array{code: string, message: string, field?: string}> */
    private array $errors = [];

    public function getErrors(): array
    {
        return $this->errors;
    }

    private function clearErrors(): void
    {
        $this->errors = [];
    }

    private function addError(string $code, string $message, ?string $field = null): void
    {
        $error = ['code' => $code, 'message' => $message];
        if ($field !== null) {
            $error['field'] = $field;
        }
        $this->errors[] = $error;
    }

    /**
     * Get all media for a given idea.
     *
     * @return array<int, array<string, mixed>>
     */
    public function getMediaForIdea(int $ideaId): array
    {
        return IdeaMedia::where('idea_id', $ideaId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn ($m) => [
                'id'         => (int) $m->id,
                'idea_id'    => (int) $m->idea_id,
                'media_type' => $m->media_type,
                'url'        => $m->url,
                'caption'    => $m->caption,
                'sort_order' => (int) $m->sort_order,
                'created_at' => $m->created_at,
            ])
            ->all();
    }

    /**
     * Add a media attachment to an idea.
     *
     * @return int|null The new media ID, or null on failure (check getErrors())
     */
    public function addMedia(int $ideaId, int $userId, array $data): ?int
    {
        $this->clearErrors();

        $tenantId = TenantContext::getId();

        // Validate the idea exists and belongs to this tenant
        $idea = DB::table('challenge_ideas as ci')
            ->join('ideation_challenges as ic', 'ic.id', '=', 'ci.challenge_id')
            ->where('ci.id', $ideaId)
            ->where('ic.tenant_id', $tenantId)
            ->select('ci.id', 'ci.user_id', 'ci.challenge_id')
            ->first();

        if (!$idea) {
            $this->addError('RESOURCE_NOT_FOUND', 'Idea not found');
            return null;
        }

        // Only the idea author or an admin can add media
        if ((int) $idea->user_id !== $userId && !$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'You can only add media to your own ideas');
            return null;
        }

        // Validate required fields
        $url = trim($data['url'] ?? '');
        if (empty($url)) {
            $this->addError('VALIDATION_REQUIRED_FIELD', 'URL is required', 'url');
            return null;
        }

        // E-035 F-207: the link is rendered as an `href` by both frontends, so
        // only an absolute http(s) URL is stored — never javascript:, data:,
        // or a scheme-relative link.
        if (!self::isHttpUrl($url)) {
            $this->addError('VALIDATION_INVALID_VALUE', __('api.invalid_url'), 'url');
            return null;
        }

        $mediaType = $data['media_type'] ?? 'image';
        if (!in_array($mediaType, ['image', 'video', 'document', 'link'])) {
            $mediaType = 'image';
        }

        $caption = isset($data['caption']) ? trim($data['caption']) : null;
        if ($caption !== null && mb_strlen($caption) > 500) {
            $caption = mb_substr($caption, 0, 500);
        }

        $sortOrder = isset($data['sort_order']) ? (int) $data['sort_order'] : 0;

        try {
            $media = IdeaMedia::create([
                'idea_id'    => $ideaId,
                'media_type' => $mediaType,
                'url'        => $url,
                'caption'    => $caption,
                'sort_order' => $sortOrder,
            ]);

            return (int) $media->id;
        } catch (\Throwable $e) {
            Log::error('Idea media creation failed: ' . $e->getMessage(), [
                'idea_id' => $ideaId,
                'user_id' => $userId,
            ]);
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to add media');
            return null;
        }
    }

    private static function isHttpUrl(string $url): bool
    {
        if (strlen($url) > 2048 || filter_var($url, FILTER_VALIDATE_URL) === false) {
            return false;
        }
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        $host = (string) parse_url($url, PHP_URL_HOST);

        return ($scheme === 'http' || $scheme === 'https') && $host !== '';
    }

    /**
     * Delete a media attachment.
     *
     * @return bool True on success, false on failure (check getErrors())
     */
    public function deleteMedia(int $mediaId, int $userId): bool
    {
        $this->clearErrors();

        $media = IdeaMedia::find($mediaId);
        if (!$media) {
            $this->addError('RESOURCE_NOT_FOUND', 'Media not found');
            return false;
        }

        // Check the idea author or admin
        $idea = DB::table('challenge_ideas')
            ->where('id', $media->idea_id)
            ->first(['user_id']);

        if (!$idea) {
            $this->addError('RESOURCE_NOT_FOUND', 'Associated idea not found');
            return false;
        }

        if ((int) $idea->user_id !== $userId && !$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'You can only delete media from your own ideas');
            return false;
        }

        try {
            $media->delete();
            return true;
        } catch (\Throwable $e) {
            Log::error('Idea media deletion failed: ' . $e->getMessage(), [
                'media_id' => $mediaId,
                'user_id'  => $userId,
            ]);
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to delete media');
            return false;
        }
    }

    private function isAdmin(int $userId): bool
    {
        $tenantId = TenantContext::getId();
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['role']);

        return $user && in_array($user->role ?? '', ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin']);
    }
}
