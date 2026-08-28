<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * SkillTaxonomyService — Laravel DI-based service for skill taxonomy.
 *
 * Manages hierarchical skill categories and user skill assignments.
 */
class SkillTaxonomyService
{
    private static array $errors = [];

    public function getErrors(): array
    {
        return self::$errors;
    }

    // =========================================================================
    // CATEGORY MANAGEMENT
    // =========================================================================

    /**
     * Get skill categories, optionally filtered by parent.
     */
    public function getCategories(?int $parentId = null): array
    {
        $tenantId = TenantContext::getId();

        $query = DB::table('skill_categories')
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->orderBy('display_order')
            ->orderBy('name');

        if ($parentId !== null) {
            $query->where('parent_id', $parentId);
        }

        return $query->get()->map(fn ($r) => (array) $r)->all();
    }

    /**
     * Get the full taxonomy tree for a tenant.
     */
    public function getTree(bool $activeOnly = true): array
    {
        $tenantId = TenantContext::getId();

        $query = DB::table('skill_categories')
            ->where('tenant_id', $tenantId)
            ->orderBy('display_order')
            ->orderBy('name');

        if ($activeOnly) {
            $query->where('is_active', true);
        }

        $rows = $query->get()->map(fn ($r) => (array) $r)->all();

        // Auto-seed defaults if no categories exist
        if (empty($rows)) {
            $this->seedDefaults($tenantId);
            $rows = DB::table('skill_categories')
                ->where('tenant_id', $tenantId)
                ->where('is_active', true)
                ->orderBy('display_order')
                ->orderBy('name')
                ->get()
                ->map(fn ($r) => (array) $r)
                ->all();
        }

        return $this->buildTree($rows);
    }

    /**
     * Get a single category by ID.
     */
    public function getCategoryById(int $id): ?array
    {
        $row = DB::table('skill_categories')
            ->where('id', $id)
            ->where('tenant_id', TenantContext::getId())
            ->first();

        return $row ? (array) $row : null;
    }

    /**
     * Create a new skill category.
     */
    public function createCategory(array $data): ?int
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $name = trim($data['name'] ?? '');
        if (empty($name) || strlen($name) > 100) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.skill_category_name_required'), 'field' => 'name'];
            return null;
        }

        $slug     = $this->generateSlug($name);
        $parentId = ! empty($data['parent_id']) ? (int) $data['parent_id'] : null;

        // Verify parent exists if provided
        if ($parentId !== null) {
            $parentExists = DB::table('skill_categories')
                ->where('id', $parentId)
                ->where('tenant_id', $tenantId)
                ->exists();

            if (! $parentExists) {
                self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.parent_category_not_found'), 'field' => 'parent_id'];
                return null;
            }
        }

        // Check for duplicate slug at same level
        $slugQuery = DB::table('skill_categories')
            ->where('tenant_id', $tenantId)
            ->where('slug', $slug);

        if ($parentId === null) {
            $slugQuery->whereNull('parent_id');
        } else {
            $slugQuery->where('parent_id', $parentId);
        }

        if ($slugQuery->exists()) {
            $slug .= '-' . time();
        }

        return DB::table('skill_categories')->insertGetId([
            'tenant_id'     => $tenantId,
            'name'          => $name,
            'slug'          => $slug,
            'parent_id'     => $parentId,
            'description'   => trim($data['description'] ?? ''),
            'icon'          => $data['icon'] ?? null,
            'display_order' => (int) ($data['display_order'] ?? 0),
            'is_active'     => 1,
        ]);
    }

    /**
     * Update a category.
     */
    public function updateCategory(int $id, array $data): bool
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $exists = DB::table('skill_categories')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $exists) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.category_not_found')];
            return false;
        }

        $updates = [];

        if (isset($data['name'])) {
            $name = trim($data['name']);
            if (empty($name) || strlen($name) > 100) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.skill_category_name_required'), 'field' => 'name'];
                return false;
            }
            $updates['name'] = $name;
            $updates['slug'] = $this->generateSlug($name);
        }

        if (array_key_exists('parent_id', $data)) {
            $updates['parent_id'] = ! empty($data['parent_id']) ? (int) $data['parent_id'] : null;
        }
        if (isset($data['description'])) {
            $updates['description'] = trim($data['description']);
        }
        if (isset($data['icon'])) {
            $updates['icon'] = $data['icon'];
        }
        if (isset($data['display_order'])) {
            $updates['display_order'] = (int) $data['display_order'];
        }
        if (isset($data['is_active'])) {
            $updates['is_active'] = (int) (bool) $data['is_active'];
        }

        if (empty($updates)) {
            return true;
        }

        DB::table('skill_categories')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        return true;
    }

    /**
     * Delete a category (soft: deactivate, or hard: remove if no skills assigned).
     */
    public function deleteCategory(int $id, bool $hard = false): bool
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        if ($hard) {
            // Check if any skills reference this category
            $count = DB::table('user_skills')
                ->where('category_id', $id)
                ->where('tenant_id', $tenantId)
                ->count();

            if ($count > 0) {
                self::$errors[] = ['code' => 'HAS_DEPENDENCIES', 'message' => __('api.skill_category_has_skills')];
                return false;
            }

            // Move child categories to parent (or null)
            $cat = DB::table('skill_categories')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->first();

            if ($cat) {
                DB::table('skill_categories')
                    ->where('parent_id', $id)
                    ->where('tenant_id', $tenantId)
                    ->update(['parent_id' => $cat->parent_id]);
            }

            DB::table('skill_categories')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->delete();
        } else {
            DB::table('skill_categories')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update(['is_active' => 0]);
        }

        return true;
    }

    // =========================================================================
    // USER SKILLS
    // =========================================================================

    /**
     * Search skills by name (autocomplete).
     */
    public function search(string $term, int $limit = 20): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('skill_categories')
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->where('name', 'LIKE', '%' . $term . '%')
            ->orderBy('name')
            ->limit($limit)
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Get skills assigned to a user (simple view).
     */
    public function getMySkills(int $userId): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('user_skills as us')
            ->leftJoin('skill_categories as sc', 'us.skill_id', '=', 'sc.id')
            ->where('us.user_id', $userId)
            ->where('us.tenant_id', $tenantId)
            ->select('us.id', 'us.user_id', 'us.tenant_id', 'us.category_id', 'us.skill_name',
                'us.proficiency as proficiency_level',
                'us.is_offering', 'us.is_requesting', 'us.created_at',
                'sc.name as category_name', 'sc.icon')
            ->orderByDesc('us.created_at')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Get skills for a user (full view with endorsement counts).
     */
    public function getUserSkills(int $userId): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('user_skills as us')
            ->leftJoin('skill_categories as sc', 'us.category_id', '=', 'sc.id')
            ->where('us.user_id', $userId)
            ->where('us.tenant_id', $tenantId)
            ->select(
                'us.id', 'us.user_id', 'us.tenant_id', 'us.category_id', 'us.skill_name',
                'us.proficiency as proficiency_level',
                'us.is_offering', 'us.is_requesting', 'us.created_at',
                'sc.name as category_name', 'sc.slug as category_slug',
                DB::raw('(SELECT COUNT(*) FROM skill_endorsements se WHERE se.endorsed_id = us.user_id AND se.skill_name = us.skill_name AND se.tenant_id = us.tenant_id) as endorsement_count')
            )
            ->orderBy('us.skill_name')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Add a skill to a user (full version with validation).
     */
    public function addUserSkill(int $userId, array $data): ?int
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $skillName = trim($data['skill_name'] ?? '');
        if (empty($skillName) || strlen($skillName) > 100) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.skill_name_required_max'), 'field' => 'skill_name'];
            return null;
        }

        $categoryId  = ! empty($data['category_id']) ? (int) $data['category_id'] : null;
        $proficiency = $data['proficiency_level'] ?? $data['proficiency'] ?? 'intermediate';
        $validProficiencies = ['beginner', 'intermediate', 'advanced', 'expert'];
        if (! in_array($proficiency, $validProficiencies)) {
            $proficiency = 'intermediate';
        }

        // Check for duplicate
        $existing = DB::table('user_skills')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('skill_name', $skillName)
            ->exists();

        if ($existing) {
            self::$errors[] = ['code' => 'DUPLICATE', 'message' => __('api.skill_already_added'), 'field' => 'skill_name'];
            return null;
        }

        return DB::table('user_skills')->insertGetId([
            'user_id'        => $userId,
            'tenant_id'      => $tenantId,
            'category_id'    => $categoryId,
            'skill_name'     => $skillName,
            'proficiency'    => $proficiency,
            'is_offering'    => (int) (bool) ($data['is_offering'] ?? true),
            'is_requesting'  => (int) (bool) ($data['is_requesting'] ?? false),
        ]);
    }

    /**
     * Remove a skill from a user's profile (simple version).
     */
    public function removeSkill(int $userId, int $userSkillId): bool
    {
        return DB::table('user_skills')
            ->where('id', $userSkillId)
            ->where('user_id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->delete() > 0;
    }

    /**
     * Update a user skill.
     */
    public function updateUserSkill(int $userId, int $skillId, array $data): bool
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $exists = DB::table('user_skills')
            ->where('id', $skillId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $exists) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.skill_not_found')];
            return false;
        }

        $updates = [];

        if (isset($data['category_id'])) {
            $updates['category_id'] = ! empty($data['category_id']) ? (int) $data['category_id'] : null;
        }
        $profVal = $data['proficiency_level'] ?? $data['proficiency'] ?? null;
        if ($profVal !== null) {
            $valid = ['beginner', 'intermediate', 'advanced', 'expert'];
            if (in_array($profVal, $valid)) {
                $updates['proficiency'] = $profVal;
            }
        }
        if (isset($data['is_offering'])) {
            $updates['is_offering'] = (int) (bool) $data['is_offering'];
        }
        if (isset($data['is_requesting'])) {
            $updates['is_requesting'] = (int) (bool) $data['is_requesting'];
        }

        if (empty($updates)) {
            return true;
        }

        DB::table('user_skills')
            ->where('id', $skillId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        return true;
    }

    /**
     * Remove a user skill (full version).
     */
    public function removeUserSkill(int $userId, int $skillId): bool
    {
        $tenantId = TenantContext::getId();

        DB::table('user_skills')
            ->where('id', $skillId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->delete();

        return true;
    }

    /**
     * Search/autocomplete skills across the tenant (by user skill names).
     */
    public function searchSkills(string $query, int $limit = 20): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('user_skills')
            ->where('tenant_id', $tenantId)
            ->where('skill_name', 'LIKE', '%' . $query . '%')
            ->groupBy('skill_name', 'category_id')
            ->orderByDesc(DB::raw('COUNT(*)'))
            ->orderBy('skill_name')
            ->limit($limit)
            ->select('skill_name', 'category_id', DB::raw('COUNT(*) as user_count'))
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Get skills breakdown for a category (with user counts).
     */
    public function getCategorySkills(int $categoryId): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('user_skills')
            ->where('tenant_id', $tenantId)
            ->where('category_id', $categoryId)
            ->groupBy('skill_name')
            ->orderByDesc(DB::raw('COUNT(*)'))
            ->select(
                'skill_name',
                DB::raw('COUNT(*) as user_count'),
                DB::raw('SUM(is_offering) as offering_count'),
                DB::raw('SUM(is_requesting) as requesting_count')
            )
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Get members who have a specific skill.
     */
    public function getMembersWithSkill(string $skillName, int $limit = 30): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('user_skills as us')
            ->join('users as u', function ($join) {
                $join->on('u.id', '=', 'us.user_id')
                     ->whereColumn('u.tenant_id', 'us.tenant_id');
            })
            ->where('us.tenant_id', $tenantId)
            ->where('us.skill_name', $skillName)
            ->where('u.status', 'active')
            ->orderByRaw("FIELD(us.proficiency, 'expert', 'advanced', 'intermediate', 'beginner')")
            ->orderBy('u.first_name')
            ->limit($limit)
            ->select(
                'u.id', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.avatar_url as avatar',
                'us.proficiency as proficiency_level',
                'us.is_offering', 'us.is_requesting'
            )
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    private function buildTree(array $rows, ?int $parentId = null): array
    {
        $tree = [];
        foreach ($rows as $row) {
            $rowParent = ! empty($row['parent_id']) ? (int) $row['parent_id'] : null;
            if ($rowParent === $parentId) {
                $row['children'] = $this->buildTree($rows, (int) $row['id']);
                $tree[] = $row;
            }
        }
        return $tree;
    }

    private function generateSlug(string $name): string
    {
        $slug = strtolower(trim($name));
        $slug = preg_replace('/[^a-z0-9\s-]/', '', $slug);
        $slug = preg_replace('/[\s-]+/', '-', $slug);
        return substr($slug, 0, 120);
    }

    private function seedDefaults(int $tenantId): void
    {
        $defaults = [
            ['Technology', 'technology', 'Tech & IT skills', 0],
            ['Home & Garden', 'home-garden', 'Home maintenance, gardening', 1],
            ['Education & Tutoring', 'education-tutoring', 'Teaching and mentoring', 2],
            ['Health & Wellbeing', 'health-wellbeing', 'Health, fitness, wellness', 3],
            ['Arts & Creative', 'arts-creative', 'Art, music, crafts', 4],
            ['Professional Services', 'professional-services', 'Admin, legal, finance', 5],
            ['Transport & Errands', 'transport-errands', 'Driving, shopping, deliveries', 6],
            ['Community & Social', 'community-social', 'Befriending, community work', 7],
        ];

        foreach ($defaults as [$name, $slug, $desc, $order]) {
            $exists = DB::table('skill_categories')
                ->where('tenant_id', $tenantId)
                ->where('slug', $slug)
                ->exists();

            if (! $exists) {
                DB::table('skill_categories')->insert([
                    'tenant_id'     => $tenantId,
                    'name'          => $name,
                    'slug'          => $slug,
                    'parent_id'     => null,
                    'description'   => $desc,
                    'display_order' => $order,
                    'is_active'     => 1,
                ]);
            }
        }
    }

    // =========================================================================
    // PROFICIENCY-WEIGHTED SKILLS (for SmartMatchingEngine)
    // =========================================================================

    /**
     * Return a map of skill_name => weight for a user, based on proficiency level.
     *
     * @return array<string, float>  ['skill_name_lowercase' => weight]
     */
    public static function getProficiencyWeightedSkills(int $userId, int $tenantId): array
    {
        static $cache = [];
        $key = "{$tenantId}:{$userId}";
        if (isset($cache[$key])) {
            return $cache[$key];
        }

        $weights = ['beginner' => 0.6, 'intermediate' => 1.0, 'advanced' => 1.3, 'expert' => 1.6];

        try {
            $rows = DB::table('user_skills')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->select(['skill_name', 'proficiency'])
                ->get();
        } catch (\Throwable $e) {
            return $cache[$key] = [];
        }

        $result = [];
        foreach ($rows as $row) {
            $name = strtolower(trim($row->skill_name));
            $result[$name] = $weights[$row->proficiency] ?? 1.0;
        }

        return $cache[$key] = $result;
    }
}
