<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Services\HelpService;

/**
 * HelpController — Eloquent-powered FAQ and help content for members.
 *
 * All endpoints migrated to native DB facade / Eloquent — no legacy delegation.
 */
class HelpController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly HelpService $helpService,
    ) {}

    // -----------------------------------------------------------------
    //  GET /api/v2/help/faqs (public)
    // -----------------------------------------------------------------

    public function faqs(): JsonResponse
    {
        $tenantId = $this->getTenantId();
        $categoryId = $this->queryInt('category_id');
        $q = $this->query('q');

        $faqs = $this->helpService->getFaqs($tenantId, $categoryId, $q);

        return $this->respondWithData($faqs);
    }

    /** Alias for routes that use getFaqs instead of faqs */
    public function getFaqs(): JsonResponse
    {
        return $this->faqs();
    }

    // -----------------------------------------------------------------
    //  Admin endpoints
    // -----------------------------------------------------------------

    /**
     * GET /api/v2/admin/help/faqs
     *
     * Returns all FAQs for the current tenant (including unpublished).
     */
    public function adminGetFaqs(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $rows = DB::table('help_faqs')
            ->where('tenant_id', $tenantId)
            ->orderBy('category')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        $formatted = $rows->map(fn ($row) => [
            'id'           => (int) $row->id,
            'category'     => $row->category,
            'question'     => $row->question,
            'answer'       => $row->answer,
            'sort_order'   => (int) $row->sort_order,
            'is_published' => (bool) $row->is_published,
            'created_at'   => $row->created_at,
            'updated_at'   => $row->updated_at ?? null,
        ])->all();

        return $this->respondWithData($formatted);
    }

    /**
     * POST /api/v2/admin/help/faqs
     *
     * Creates a new FAQ for the current tenant.
     * Body: { category?, question, answer, sort_order?, is_published? }
     */
    public function adminCreateFaq(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $data = $this->getAllInput();

        $question = trim($data['question'] ?? '');
        $answer   = trim($data['answer'] ?? '');

        if ($question === '') {
            return $this->respondWithError(
                'VALIDATION_REQUIRED_FIELD',
                __('api.question_required'),
                'question',
                400
            );
        }

        if ($answer === '') {
            return $this->respondWithError(
                'VALIDATION_REQUIRED_FIELD',
                __('api.answer_required'),
                'answer',
                400
            );
        }

        // Sanitize HTML in answer to prevent stored XSS
        // Admin-authored, so it keeps `class` (member content does not — F-075).
        $answer = \App\Helpers\HtmlSanitizer::sanitize($answer, true, true);

        $newId = DB::table('help_faqs')->insertGetId([
            'tenant_id'    => $tenantId,
            'category'     => trim($data['category'] ?? 'General'),
            'question'     => $question,
            'answer'       => $answer,
            'sort_order'   => (int) ($data['sort_order'] ?? 0),
            'is_published' => isset($data['is_published']) ? (int) (bool) $data['is_published'] : 1,
        ]);

        return $this->respondWithData(['id' => $newId, 'created' => true], null, 201);
    }

    /**
     * PUT /api/v2/admin/help/faqs/{id}
     *
     * Updates an existing FAQ belonging to the current tenant.
     * Body: Any subset of { category, question, answer, sort_order, is_published }
     */
    public function adminUpdateFaq(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $data = $this->getAllInput();

        if (empty($data)) {
            return $this->respondWithError(
                'VALIDATION_NO_FIELDS',
                __('api.no_fields_provided'),
                null,
                400
            );
        }

        $allowed = ['category', 'question', 'answer', 'sort_order', 'is_published'];
        $updates = [];

        foreach ($allowed as $field) {
            if (array_key_exists($field, $data)) {
                $updates[$field] = $data[$field];
            }
        }

        // Sanitize HTML in answer to prevent stored XSS
        if (isset($updates['answer'])) {
            $updates['answer'] = \App\Helpers\HtmlSanitizer::sanitize((string) $updates['answer'], true, true); // admin-authored (F-075)
        }

        if (empty($updates)) {
            return $this->respondWithError(
                'VALIDATION_NO_FIELDS',
                __('api.no_fields_provided'),
                null,
                400
            );
        }

        DB::table('help_faqs')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        return $this->respondWithData(['id' => $id, 'updated' => true]);
    }

    /**
     * DELETE /api/v2/admin/help/faqs/{id}
     *
     * Deletes an FAQ belonging to the current tenant.
     */
    public function adminDeleteFaq(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        DB::table('help_faqs')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->delete();

        return $this->respondWithData(['id' => $id, 'deleted' => true]);
    }

    /**
     * POST /api/v2/help/feedback
     *
     * Record feedback on a help article (helpful/not helpful).
     * Body: { article_slug, helpful? }
     */
    public function feedback(): JsonResponse
    {
        $data = $this->getAllInput();
        $articleSlug = $data['article_slug'] ?? '';
        $helpful = $data['helpful'] ?? true;

        if (empty($articleSlug)) {
            return $this->error(__('api_controllers_2.help.missing_article_slug'), 400);
        }

        $article = DB::table('help_articles')
            ->where('tenant_id', $this->getTenantId())
            ->where('slug', $articleSlug)
            ->where('is_public', 1)
            ->first();

        if (! $article) {
            return $this->error(__('api_controllers_2.help.article_not_found'), 404);
        }

        $userId = $this->getOptionalUserId();
        $ipAddress = request()->ip();

        try {
            // Check if feedback already submitted
            if ($userId) {
                $exists = DB::table('help_article_feedback')
                    ->where('article_id', $article->id)
                    ->where('user_id', $userId)
                    ->exists();
            } else {
                $exists = DB::table('help_article_feedback')
                    ->where('article_id', $article->id)
                    ->where('ip_address', $ipAddress)
                    ->whereNull('user_id')
                    ->exists();
            }

            if ($exists) {
                return $this->respondWithError('DUPLICATE_ERROR', __('api.feedback_already_submitted'));
            }

            DB::table('help_article_feedback')->insert([
                'article_id' => $article->id,
                'helpful'    => $helpful ? 1 : 0,
                'user_id'    => $userId,
                'ip_address' => $ipAddress,
                'created_at' => now(),
            ]);

            return $this->respondWithData(['message' => __('api_controllers_2.help.feedback_recorded')]);
        } catch (\Exception $e) {
            // Feedback table may not exist yet
            return $this->respondWithData(['message' => __('api_controllers_2.help.feedback_recorded')]);
        }
    }
}
