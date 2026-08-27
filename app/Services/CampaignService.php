<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Campaign;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * CampaignService — Eloquent-based service for campaigns that group multiple challenges.
 *
 * Campaigns are broader thematic initiatives that can encompass multiple ideation challenges.
 * All queries are tenant-scoped via HasTenantScope trait on the model.
 */
class CampaignService
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
     * List campaigns for the current tenant with cursor pagination.
     */
    public function getAll(array $filters = []): array
    {
        $tenantId = TenantContext::getId();
        $limit = $filters['limit'] ?? 20;
        $cursor = $filters['cursor'] ?? null;

        $query = DB::table('campaigns as c')
            ->leftJoin('users as u', 'c.created_by', '=', 'u.id')
            ->where('c.tenant_id', $tenantId)
            ->select([
                'c.*',
                'u.first_name',
                'u.last_name', 'u.profile_type', 'u.organization_name',
                DB::raw('(SELECT COUNT(*) FROM campaign_challenges cc WHERE cc.campaign_id = c.id) AS challenge_count'),
            ]);

        $status = $filters['status'] ?? null;
        if ($status && in_array($status, ['draft', 'active', 'completed', 'archived'])) {
            $query->where('c.status', $status);
        }

        if ($cursor) {
            $cursorId = base64_decode($cursor);
            if ($cursorId !== false) {
                $query->where('c.id', '<', (int) $cursorId);
            }
        }

        $items = $query->orderByDesc('c.created_at')
            ->orderByDesc('c.id')
            ->limit($limit + 1)
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        $hasMore = count($items) > $limit;
        if ($hasMore) {
            array_pop($items);
        }

        $nextCursor = null;
        if ($hasMore && !empty($items)) {
            $lastItem = end($items);
            $nextCursor = base64_encode((string) $lastItem['id']);
        }

        foreach ($items as &$item) {
            $item['creator'] = [
                'id' => (int) $item['created_by'],
                'name' => UserDisplayName::resolve($item),
            ];
            $item['challenge_count'] = (int) ($item['challenge_count'] ?? 0);
            unset($item['first_name'], $item['last_name']);
        }

        return [
            'items' => $items,
            'cursor' => $nextCursor,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get a campaign by ID with its linked challenges.
     */
    public function getById(int $id): ?array
    {
        $tenantId = TenantContext::getId();

        $campaign = DB::table('campaigns as c')
            ->leftJoin('users as u', 'c.created_by', '=', 'u.id')
            ->where('c.id', $id)
            ->where('c.tenant_id', $tenantId)
            ->select(['c.*', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name'])
            ->first();

        if (!$campaign) {
            return null;
        }

        $result = (array) $campaign;
        $result['creator'] = [
            'id' => (int) $result['created_by'],
            'name' => UserDisplayName::resolve($result),
        ];
        unset($result['first_name'], $result['last_name']);

        // Get linked challenges
        $result['challenges'] = DB::table('campaign_challenges as cc')
            ->join('ideation_challenges as ic', 'cc.challenge_id', '=', 'ic.id')
            ->where('cc.campaign_id', $id)
            ->where('ic.tenant_id', $tenantId)
            ->select(['ic.id', 'ic.title', 'ic.status', 'ic.ideas_count', 'ic.cover_image', 'cc.sort_order'])
            ->orderBy('cc.sort_order')
            ->orderBy('ic.title')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        return $result;
    }

    /**
     * Create a campaign.
     *
     * @return int|null Campaign ID
     */
    public function create(int $userId, array $data): ?int
    {
        $this->clearErrors();

        if (!$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'Only admins can create campaigns');
            return null;
        }

        $title = trim($data['title'] ?? '');
        if (empty($title)) {
            $this->addError('VALIDATION_REQUIRED_FIELD', 'Title is required', 'title');
            return null;
        }

        $status = $data['status'] ?? 'draft';
        if (!in_array($status, ['draft', 'active', 'completed', 'archived'])) {
            $status = 'draft';
        }

        try {
            $campaign = Campaign::create([
                'title' => $title,
                'description' => !empty($data['description']) ? trim($data['description']) : null,
                'cover_image' => !empty($data['cover_image']) ? trim($data['cover_image']) : null,
                'status' => $status,
                'start_date' => !empty($data['start_date']) ? $data['start_date'] : null,
                'end_date' => !empty($data['end_date']) ? $data['end_date'] : null,
                'created_by' => $userId,
            ]);

            return (int) $campaign->id;
        } catch (\Throwable $e) {
            Log::error('Campaign creation failed: ' . $e->getMessage());
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to create campaign');
            return null;
        }
    }

    /**
     * Update a campaign.
     */
    public function update(int $id, int $userId, array $data): bool
    {
        $this->clearErrors();

        if (!$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'Only admins can update campaigns');
            return false;
        }

        $campaign = Campaign::find($id);
        if (!$campaign) {
            $this->addError('RESOURCE_NOT_FOUND', 'Campaign not found');
            return false;
        }

        $updates = [];

        if (isset($data['title'])) {
            $title = trim($data['title']);
            if (empty($title)) {
                $this->addError('VALIDATION_REQUIRED_FIELD', 'Title cannot be empty', 'title');
                return false;
            }
            $updates['title'] = $title;
        }

        if (array_key_exists('description', $data)) {
            $updates['description'] = !empty($data['description']) ? trim($data['description']) : null;
        }

        if (array_key_exists('cover_image', $data)) {
            $updates['cover_image'] = !empty($data['cover_image']) ? trim($data['cover_image']) : null;
        }

        if (isset($data['status']) && in_array($data['status'], ['draft', 'active', 'completed', 'archived'])) {
            $updates['status'] = $data['status'];
        }

        if (array_key_exists('start_date', $data)) {
            $updates['start_date'] = !empty($data['start_date']) ? $data['start_date'] : null;
        }

        if (array_key_exists('end_date', $data)) {
            $updates['end_date'] = !empty($data['end_date']) ? $data['end_date'] : null;
        }

        if (empty($updates)) {
            return true;
        }

        try {
            $campaign->update($updates);
            return true;
        } catch (\Throwable $e) {
            Log::error('Campaign update failed: ' . $e->getMessage());
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to update campaign');
            return false;
        }
    }

    /**
     * Delete a campaign.
     */
    public function delete(int $id, int $userId): bool
    {
        $this->clearErrors();

        if (!$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'Only admins can delete campaigns');
            return false;
        }

        $campaign = Campaign::find($id);
        if (!$campaign) {
            $this->addError('RESOURCE_NOT_FOUND', 'Campaign not found');
            return false;
        }

        try {
            // FK cascade deletes campaign_challenges links
            $campaign->delete();
            return true;
        } catch (\Throwable $e) {
            Log::error('Campaign deletion failed: ' . $e->getMessage());
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to delete campaign');
            return false;
        }
    }

    /**
     * Link a challenge to a campaign.
     */
    public function linkChallenge(int $campaignId, int $challengeId, int $userId, int $sortOrder = 0): bool
    {
        $this->clearErrors();

        if (!$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'Only admins can manage campaign links');
            return false;
        }

        $tenantId = TenantContext::getId();

        // Verify both exist in this tenant
        $campaign = Campaign::find($campaignId);
        if (!$campaign) {
            $this->addError('RESOURCE_NOT_FOUND', 'Campaign not found');
            return false;
        }

        $challenge = DB::table('ideation_challenges')
            ->where('id', $challengeId)
            ->where('tenant_id', $tenantId)
            ->first(['id']);

        if (!$challenge) {
            $this->addError('RESOURCE_NOT_FOUND', 'Challenge not found');
            return false;
        }

        try {
            DB::table('campaign_challenges')->insertOrIgnore([
                'campaign_id' => $campaignId,
                'challenge_id' => $challengeId,
                'sort_order' => $sortOrder,
            ]);
            return true;
        } catch (\Throwable $e) {
            Log::error('Campaign link failed: ' . $e->getMessage());
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to link challenge');
            return false;
        }
    }

    /**
     * Unlink a challenge from a campaign.
     */
    public function unlinkChallenge(int $campaignId, int $challengeId, int $userId): bool
    {
        $this->clearErrors();

        if (!$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'Only admins can manage campaign links');
            return false;
        }

        // Verify the campaign belongs to the current tenant before touching the
        // junction table (campaign_challenges has no tenant_id column, so an
        // unscoped delete by id would let a tenant admin unlink another tenant's
        // campaign-challenge links). Campaign::find applies the HasTenantScope.
        $campaign = Campaign::find($campaignId);
        if (!$campaign) {
            $this->addError('RESOURCE_NOT_FOUND', 'Campaign not found');
            return false;
        }

        try {
            DB::table('campaign_challenges')
                ->where('campaign_id', $campaignId)
                ->where('challenge_id', $challengeId)
                ->delete();
            return true;
        } catch (\Throwable $e) {
            Log::error('Campaign unlink failed: ' . $e->getMessage());
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to unlink challenge');
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
