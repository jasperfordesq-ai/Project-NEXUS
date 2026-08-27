<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\ChallengeTemplate;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * ChallengeTemplateService — Eloquent-based service for reusable challenge templates.
 *
 * Admins create templates with pre-set fields. When creating a new challenge,
 * users can "Start from template" to pre-fill the form.
 * All queries are tenant-scoped via HasTenantScope trait on the model.
 */
class ChallengeTemplateService
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
     * List all templates for the current tenant.
     */
    public function getAll(): array
    {
        $templates = ChallengeTemplate::with(['creator:id,first_name,last_name,profile_type,organization_name', 'category:id,name'])
            ->orderBy('title')
            ->get();

        return $templates->map(function ($tpl) {
            $arr = $tpl->toArray();
            $arr['creator'] = [
                'id' => (int) $tpl->created_by,
                'name' => $tpl->creator
                    ? UserDisplayName::resolve($tpl->creator)
                    : '',
            ];
            $arr['category_name'] = $tpl->category->name ?? null;
            $arr['default_tags'] = $tpl->default_tags ?? [];
            $arr['evaluation_criteria'] = $tpl->evaluation_criteria ?? [];
            unset($arr['creator_relation']);
            return $arr;
        })->all();
    }

    /**
     * Get a single template by ID.
     */
    public function getById(int $id): ?array
    {
        $tpl = ChallengeTemplate::with(['creator:id,first_name,last_name,profile_type,organization_name', 'category:id,name'])
            ->find($id);

        if (!$tpl) {
            return null;
        }

        $arr = $tpl->toArray();
        $arr['creator'] = [
            'id' => (int) $tpl->created_by,
            'name' => $tpl->creator
                ? UserDisplayName::resolve($tpl->creator)
                : '',
        ];
        $arr['category_name'] = $tpl->category->name ?? null;
        $arr['default_tags'] = $tpl->default_tags ?? [];
        $arr['evaluation_criteria'] = $tpl->evaluation_criteria ?? [];

        return $arr;
    }

    /**
     * Create a template.
     *
     * @return int|null Template ID
     */
    public function create(int $userId, array $data): ?int
    {
        $this->clearErrors();

        if (!$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'Only admins can manage templates');
            return null;
        }

        $title = trim($data['title'] ?? '');
        if (empty($title)) {
            $this->addError('VALIDATION_REQUIRED_FIELD', 'Title is required', 'title');
            return null;
        }

        try {
            $template = ChallengeTemplate::create([
                'title' => $title,
                'description' => !empty($data['description']) ? trim($data['description']) : null,
                'default_tags' => isset($data['default_tags']) && is_array($data['default_tags'])
                    ? $data['default_tags'] : null,
                'default_category_id' => isset($data['default_category_id'])
                    ? (int) $data['default_category_id'] : null,
                'evaluation_criteria' => isset($data['evaluation_criteria']) && is_array($data['evaluation_criteria'])
                    ? $data['evaluation_criteria'] : null,
                'prize_description' => !empty($data['prize_description']) ? trim($data['prize_description']) : null,
                'max_ideas_per_user' => isset($data['max_ideas_per_user'])
                    ? (int) $data['max_ideas_per_user'] : null,
                'created_by' => $userId,
            ]);

            return (int) $template->id;
        } catch (\Throwable $e) {
            Log::error('Template creation failed: ' . $e->getMessage());
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to create template');
            return null;
        }
    }

    /**
     * Update a template.
     */
    public function update(int $id, int $userId, array $data): bool
    {
        $this->clearErrors();

        if (!$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'Only admins can manage templates');
            return false;
        }

        $template = ChallengeTemplate::find($id);
        if (!$template) {
            $this->addError('RESOURCE_NOT_FOUND', 'Template not found');
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

        if (array_key_exists('default_tags', $data)) {
            $updates['default_tags'] = is_array($data['default_tags']) ? $data['default_tags'] : null;
        }

        if (array_key_exists('default_category_id', $data)) {
            $updates['default_category_id'] = $data['default_category_id'] !== null
                ? (int) $data['default_category_id'] : null;
        }

        if (array_key_exists('evaluation_criteria', $data)) {
            $updates['evaluation_criteria'] = is_array($data['evaluation_criteria'])
                ? $data['evaluation_criteria'] : null;
        }

        if (array_key_exists('prize_description', $data)) {
            $updates['prize_description'] = !empty($data['prize_description'])
                ? trim($data['prize_description']) : null;
        }

        if (array_key_exists('max_ideas_per_user', $data)) {
            $updates['max_ideas_per_user'] = $data['max_ideas_per_user'] !== null
                ? (int) $data['max_ideas_per_user'] : null;
        }

        if (empty($updates)) {
            return true;
        }

        try {
            $template->update($updates);
            return true;
        } catch (\Throwable $e) {
            Log::error('Template update failed: ' . $e->getMessage());
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to update template');
            return false;
        }
    }

    /**
     * Delete a template.
     */
    public function delete(int $id, int $userId): bool
    {
        $this->clearErrors();

        if (!$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'Only admins can manage templates');
            return false;
        }

        $template = ChallengeTemplate::find($id);
        if (!$template) {
            $this->addError('RESOURCE_NOT_FOUND', 'Template not found');
            return false;
        }

        try {
            $template->delete();
            return true;
        } catch (\Throwable $e) {
            Log::error('Template deletion failed: ' . $e->getMessage());
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to delete template');
            return false;
        }
    }

    /**
     * Get pre-filled data from a template for creating a challenge.
     */
    public function getTemplateData(int $id): ?array
    {
        $template = $this->getById($id);
        if (!$template) {
            return null;
        }

        return [
            'title' => $template['title'] ?? '',
            'description' => $template['description'] ?? '',
            'category_id' => $template['default_category_id'] ?? null,
            'tags' => $template['default_tags'] ?? [],
            'evaluation_criteria' => $template['evaluation_criteria'] ?? [],
            'prize_description' => $template['prize_description'] ?? null,
            'max_ideas_per_user' => $template['max_ideas_per_user'] ?? null,
        ];
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
