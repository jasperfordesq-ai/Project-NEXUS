<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\ChallengeTag;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * ChallengeTagService — Eloquent-based CRUD for challenge tags.
 *
 * Tags are a per-tenant pool of labels (interest, skill, general) that can
 * be attached to ideation challenges via the challenge_tag_links pivot table.
 * All queries are tenant-scoped via HasTenantScope trait on the model.
 */
class ChallengeTagService
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
     * List all tags for the current tenant, optionally filtered by type.
     */
    public function getAll(?string $tagType = null): array
    {
        $query = ChallengeTag::query();

        if ($tagType && in_array($tagType, ['interest', 'skill', 'general'])) {
            $query->where('tag_type', $tagType);
        }

        return $query->orderBy('name')
            ->get()
            ->map(fn ($r) => $r->toArray())
            ->all();
    }

    /**
     * Get a single tag by ID.
     */
    public function getById(int $id): ?array
    {
        $tag = ChallengeTag::find($id);
        return $tag ? $tag->toArray() : null;
    }

    /**
     * Create a new tag.
     *
     * @return int|null Tag ID
     */
    public function create(int $userId, array $data): ?int
    {
        $this->clearErrors();

        if (!$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'Only admins can manage tags');
            return null;
        }

        $name = trim($data['name'] ?? '');
        if (empty($name)) {
            $this->addError('VALIDATION_REQUIRED_FIELD', 'Name is required', 'name');
            return null;
        }

        $slug = $this->generateSlug($name);
        $tagType = $data['tag_type'] ?? 'general';
        if (!in_array($tagType, ['interest', 'skill', 'general'])) {
            $tagType = 'general';
        }

        // Check for duplicate slug
        $existing = ChallengeTag::where('slug', $slug)->first();
        if ($existing) {
            $this->addError('RESOURCE_CONFLICT', 'A tag with this name already exists', 'name');
            return null;
        }

        try {
            $tag = ChallengeTag::create([
                'name' => $name,
                'slug' => $slug,
                'tag_type' => $tagType,
            ]);

            return (int) $tag->id;
        } catch (\Throwable $e) {
            Log::error('Tag creation failed: ' . $e->getMessage());
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to create tag');
            return null;
        }
    }

    /**
     * Delete a tag.
     */
    public function delete(int $id, int $userId): bool
    {
        $this->clearErrors();

        if (!$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'Only admins can manage tags');
            return false;
        }

        $tag = ChallengeTag::find($id);
        if (!$tag) {
            $this->addError('RESOURCE_NOT_FOUND', 'Tag not found');
            return false;
        }

        try {
            // FK cascade will handle challenge_tag_links
            $tag->delete();
            return true;
        } catch (\Throwable $e) {
            Log::error('Tag deletion failed: ' . $e->getMessage());
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to delete tag');
            return false;
        }
    }

    private function generateSlug(string $name): string
    {
        // Transliterate first so "Niño" becomes "nino", not "nio".
        $slug = strtolower(Str::ascii($name));
        $slug = preg_replace('/[^a-z0-9\s-]/', '', $slug);
        $slug = preg_replace('/[\s-]+/', '-', $slug);
        return trim($slug, '-');
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
