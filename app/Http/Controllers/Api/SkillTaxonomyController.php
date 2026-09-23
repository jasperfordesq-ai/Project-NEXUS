<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Services\SkillTaxonomyService;

/**
 * SkillTaxonomyController -- Skill taxonomy and user skills.
 *
 * Converted from legacy delegation to direct static service calls.
 */
class SkillTaxonomyController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly SkillTaxonomyService $skillTaxonomyService,
    ) {}

    // =============================================
    // CATEGORY ENDPOINTS
    // =============================================

    /** GET /api/v2/skills/categories */
    public function getCategories(): JsonResponse
    {
        $this->rateLimit('skills_categories', 30, 60);

        $parentId = $this->query('parent_id');
        $format = $this->query('format', 'tree');

        if ($format === 'flat') {
            $categories = $this->skillTaxonomyService->getCategories(
                $parentId !== null ? (int) $parentId : null
            );
            return $this->respondWithData($categories);
        }

        $tree = $this->skillTaxonomyService->getTree();

        return $this->respondWithData($tree);
    }

    /** GET /api/v2/skills/categories/{id} */
    public function getCategoryById($id): JsonResponse
    {
        $category = $this->skillTaxonomyService->getCategoryById((int) $id);

        if (!$category) {
            return $this->respondWithError('NOT_FOUND', __('api.category_not_found'), null, 404);
        }

        $category['skills'] = $this->skillTaxonomyService->getCategorySkills((int) $id);

        return $this->respondWithData($category);
    }

    /** POST /api/v2/skills/categories (admin) */
    public function createCategory(): JsonResponse
    {
        $this->requireAdmin();
        $this->rateLimit('skills_category_create', 10, 60);

        $data = $this->getAllInput();
        $id = $this->skillTaxonomyService->createCategory($data);

        if ($id === null) {
            return $this->respondWithErrors($this->skillTaxonomyService->getErrors(), 422);
        }

        $category = $this->skillTaxonomyService->getCategoryById($id);

        return $this->respondWithData($category, null, 201);
    }

    /** PUT /api/v2/skills/categories/{id} (admin) */
    public function updateCategory($id): JsonResponse
    {
        $this->requireAdmin();
        $this->rateLimit('skills_category_update', 10, 60);

        $data = $this->getAllInput();
        $success = $this->skillTaxonomyService->updateCategory((int) $id, $data);

        if (!$success) {
            return $this->respondWithErrors($this->skillTaxonomyService->getErrors(), 422);
        }

        $category = $this->skillTaxonomyService->getCategoryById((int) $id);

        return $this->respondWithData($category);
    }

    /** DELETE /api/v2/skills/categories/{id} (admin) */
    public function deleteCategory($id): JsonResponse
    {
        $this->requireAdmin();

        $hard = $this->queryBool('hard', false);
        $success = $this->skillTaxonomyService->deleteCategory((int) $id, $hard);

        if (!$success) {
            return $this->respondWithErrors($this->skillTaxonomyService->getErrors(), 422);
        }

        return $this->respondWithData(['message' => __('api_controllers_2.skill_taxonomy.category_deleted')]);
    }

    // =============================================
    // SKILL SEARCH
    // =============================================

    /** GET /api/v2/skills/search */
    public function search(): JsonResponse
    {
        $this->rateLimit('skills_search', 60, 60);

        $query = $this->query('q', '');
        if (strlen($query) < 1) {
            return $this->respondWithData([]);
        }

        $limit = $this->queryInt('limit', 20, 1, 50);
        $results = $this->skillTaxonomyService->searchSkills($query, $limit);

        return $this->respondWithData($results);
    }

    /** GET /api/v2/skills/members */
    public function getMembersWithSkill(): JsonResponse
    {
        $this->rateLimit('skills_members', 30, 60);

        $skillName = $this->query('skill', '');
        if (strlen($skillName) < 1) {
            return $this->respondWithData([]);
        }

        $limit = $this->queryInt('limit', 30, 1, 50);
        $members = $this->skillTaxonomyService->getMembersWithSkill($skillName, $limit, $this->getOptionalUserId());

        return $this->respondWithData($members);
    }

    // =============================================
    // USER SKILL ENDPOINTS
    // =============================================

    /** GET /api/v2/users/me/skills */
    public function getMySkills(): JsonResponse
    {
        $userId = $this->requireAuth();

        $skills = $this->skillTaxonomyService->getUserSkills($userId);

        return $this->respondWithData($skills);
    }

    /** GET /api/v2/users/{id}/skills */
    public function getUserSkills($id): JsonResponse
    {
        $this->rateLimit('user_skills_view', 30, 60);

        $skills = $this->skillTaxonomyService->getUserSkills((int) $id);

        return $this->respondWithData($skills);
    }

    /** POST /api/v2/users/me/skills */
    public function addSkill(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('skills_add', 20, 60);

        $data = $this->getAllInput();
        $skillId = $this->skillTaxonomyService->addUserSkill($userId, $data);

        if ($skillId === null) {
            return $this->respondWithErrors($this->skillTaxonomyService->getErrors(), 422);
        }

        $skills = $this->skillTaxonomyService->getUserSkills($userId);

        return $this->respondWithData($skills, null, 201);
    }

    /** PUT /api/v2/users/me/skills/{id} */
    public function updateSkill($id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('skills_update', 20, 60);

        $data = $this->getAllInput();
        $success = $this->skillTaxonomyService->updateUserSkill($userId, (int) $id, $data);

        if (!$success) {
            return $this->respondWithErrors($this->skillTaxonomyService->getErrors(), 422);
        }

        $skills = $this->skillTaxonomyService->getUserSkills($userId);

        return $this->respondWithData($skills);
    }

    /** DELETE /api/v2/users/me/skills/{id} */
    public function removeSkill(int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        $this->skillTaxonomyService->removeUserSkill($userId, $id);

        return $this->respondWithData(['message' => __('api_controllers_2.skill_taxonomy.skill_removed')]);
    }
}
