<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\KnowledgeBaseService;
use App\Services\KnowledgeBaseAttachmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;

/**
 * KnowledgeBaseController — Community knowledge base articles.
 *
 * Native Eloquent implementation — no legacy delegation.
 */
class KnowledgeBaseController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly KnowledgeBaseService $kbService,
        private readonly KnowledgeBaseAttachmentService $attachmentService,
    ) {}

    /**
     * GET /api/v2/kb
     *
     * List knowledge base articles with cursor pagination.
     * Query: per_page, cursor, category_id, include_unpublished.
     */
    public function index(): JsonResponse
    {
        $userId = $this->getOptionalUserId();

        $filters = [
            'limit'          => $this->queryInt('per_page', 20, 1, 100),
            'published_only' => true,
        ];

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }
        if ($this->query('category_id') !== null) {
            $filters['category_id'] = $this->queryInt('category_id');
        }

        // Admins can see unpublished articles
        if ($this->queryBool('include_unpublished') && $userId) {
            $user = \Illuminate\Support\Facades\Auth::user();
            $role = $user->role ?? 'member';
            if (in_array($role, ['admin', 'tenant_admin', 'super_admin', 'god'])) {
                $filters['published_only'] = false;
            }
        }

        $result = $this->kbService->getAll($filters);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $filters['limit'],
            $result['has_more']
        );
    }

    /**
     * GET /api/v2/kb/{id}
     *
     * Get a single article by ID (increments view count).
     */
    public function show(int $id): JsonResponse
    {
        $article = $this->kbService->getById($id);

        if (! $article) {
            return $this->respondWithError('NOT_FOUND', __('api.kb_article_not_found'), null, 404);
        }

        // Check if unpublished — only admins can see
        if (! ($article['is_published'] ?? true)) {
            $userId = $this->getOptionalUserId();
            if (! $userId) {
                return $this->respondWithError('NOT_FOUND', __('api.kb_article_not_found'), null, 404);
            }
            $user = \Illuminate\Support\Facades\Auth::user();
            $role = $user->role ?? 'member';
            if (! in_array($role, ['admin', 'tenant_admin', 'super_admin', 'god'])) {
                return $this->respondWithError('NOT_FOUND', __('api.kb_article_not_found'), null, 404);
            }
        }

        // Include user's feedback if authenticated
        $userId = $this->getOptionalUserId();
        if ($userId) {
            $feedback = DB::table('knowledge_base_feedback')
                ->where('article_id', $id)
                ->where('user_id', $userId)
                ->where('tenant_id', $this->getTenantId())
                ->first();
            $article['my_feedback'] = $feedback ? (bool) $feedback->is_helpful : null;
        }

        return $this->respondWithData($article);
    }

    /**
     * GET /api/v2/kb/slug/{slug}
     *
     * Get a single article by slug.
     */
    public function showBySlug(string $slug): JsonResponse
    {
        $tenantId = $this->getTenantId();

        $article = DB::table('knowledge_base_articles')
            ->where('slug', $slug)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $article) {
            return $this->respondWithError('NOT_FOUND', __('api.kb_article_not_found'), null, 404);
        }

        $articleArr = (array) $article;

        // Check published status
        $isAdminPreview = false;
        if (! ($articleArr['is_published'] ?? true)) {
            $userId = $this->getOptionalUserId();
            if (! $userId) {
                return $this->respondWithError('NOT_FOUND', __('api.kb_article_not_found'), null, 404);
            }
            $user = \Illuminate\Support\Facades\Auth::user();
            $role = $user->role ?? 'member';
            if (! in_array($role, ['admin', 'tenant_admin', 'super_admin', 'god'])) {
                return $this->respondWithError('NOT_FOUND', __('api.kb_article_not_found'), null, 404);
            }
            $isAdminPreview = true;
        }

        // Increment view count — but skip for admin previews of unpublished
        // articles and for HEAD requests, neither of which represent a real
        // user view.
        $isHead = strtoupper(request()->method()) === 'HEAD';
        if (! $isAdminPreview && ! $isHead) {
            // Column is views_count — 'view_count' 500ed every public slug fetch
            DB::table('knowledge_base_articles')->where('id', $article->id)->where('tenant_id', \App\Core\TenantContext::getId())->increment('views_count');
        }

        return $this->respondWithData($articleArr);
    }

    /**
     * GET /api/v2/kb/search
     *
     * Search knowledge base articles.
     * Query: q (required), limit; per_page opts into cursor-paginated results.
     */
    public function search(): JsonResponse
    {
        $query = $this->query('q', '');
        if (empty(trim($query))) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.kb_search_query_required'), 'q', 400);
        }

        if ($this->query('per_page') !== null) {
            $limit = $this->queryInt('per_page', 20, 1, 50);
            $page = $this->kbService->searchPage($query, $limit, $this->query('cursor'));
            return $this->respondWithCollection($page['items'], $page['cursor'], $limit, $page['has_more']);
        }
        $limit = $this->queryInt('limit', 20, 1, 50);
        $results = $this->kbService->search($query, $limit);

        return $this->respondWithData($results);
    }

    /**
     * POST /api/v2/kb
     *
     * Create a new knowledge base article (admin only).
     */
    public function store(): JsonResponse
    {
        $userId = $this->requireAdmin();
        $this->rateLimit('kb_create', 10, 60);

        $data = $this->getAllInput();

        if (empty(trim($data['title'] ?? ''))) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.title_required'), 'title', 400);
        }

        $articleId = $this->kbService->create($userId, $data);
        $article = $this->kbService->getById($articleId);

        return $this->respondWithData($article, null, 201);
    }

    /**
     * PUT /api/v2/kb/{id}
     *
     * Update a knowledge base article (admin only).
     */
    public function update(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->rateLimit('kb_update', 20, 60);

        $tenantId = $this->getTenantId();
        $data = $this->getAllInput();

        $existing = DB::table('knowledge_base_articles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $existing) {
            return $this->respondWithError('NOT_FOUND', __('api.kb_article_not_found'), null, 404);
        }

        $updateData = [];
        if (isset($data['title'])) $updateData['title'] = trim($data['title']);
        if (isset($data['slug'])) $updateData['slug'] = $data['slug'];
        if (isset($data['content'])) {
            $contentType = $data['content_type'] ?? ($existing->content_type ?? 'html');
            $updateData['content'] = ($contentType === 'html')
                ? \App\Helpers\HtmlSanitizer::sanitizeCms($data['content'])
                : $data['content'];
        }
        if (isset($data['content_type'])) $updateData['content_type'] = $data['content_type'];
        if (array_key_exists('video_url', $data)) $updateData['video_url'] = ! empty($data['video_url']) ? trim($data['video_url']) : null;
        if (array_key_exists('category_id', $data)) $updateData['category_id'] = $data['category_id'];
        if (array_key_exists('parent_article_id', $data)) $updateData['parent_article_id'] = $data['parent_article_id'];
        if (isset($data['sort_order'])) $updateData['sort_order'] = (int) $data['sort_order'];
        if (isset($data['is_published'])) $updateData['is_published'] = (bool) $data['is_published'];
        $updateData['updated_at'] = now();

        DB::table('knowledge_base_articles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($updateData);

        $article = $this->kbService->getById($id);

        return $this->respondWithData($article);
    }

    /**
     * DELETE /api/v2/kb/{id}
     *
     * Delete a knowledge base article (admin only).
     */
    public function destroy(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->rateLimit('kb_delete', 10, 60);
        $tenantId = $this->getTenantId();

        // Check for child articles
        $childCount = DB::table('knowledge_base_articles')
            ->where('parent_article_id', $id)
            ->where('tenant_id', $tenantId)
            ->count();

        if ($childCount > 0) {
            return $this->respondWithError('RESOURCE_CONFLICT', __('api.kb_cannot_delete_with_children'), null, 409);
        }

        // Delete attachment files from disk (DB rows cascade via FK)
        $this->attachmentService->deleteAllForArticle($id);

        $deleted = DB::table('knowledge_base_articles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->delete();

        if (! $deleted) {
            return $this->respondWithError('NOT_FOUND', __('api.kb_article_not_found'), null, 404);
        }

        // Clean up feedback
        DB::table('knowledge_base_feedback')
            ->where('article_id', $id)
            ->where('tenant_id', $tenantId)
            ->delete();

        return $this->noContent();
    }

    /**
     * POST /api/v2/kb/{id}/feedback
     *
     * Submit "Was this helpful?" feedback for an article.
     */
    public function feedback(int $id): JsonResponse
    {
        $userId = $this->getOptionalUserId();
        $this->rateLimit('kb_feedback', 30, 60);
        $tenantId = $this->getTenantId();

        $isHelpful = $this->input('is_helpful');
        if ($isHelpful === null) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.kb_is_helpful_required'), 'is_helpful', 400);
        }

        $comment = $this->input('comment');

        // Check article exists
        $exists = DB::table('knowledge_base_articles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $exists) {
            return $this->respondWithError('NOT_FOUND', __('api.kb_article_not_found'), null, 404);
        }

        // Upsert feedback
        if ($userId) {
            DB::table('knowledge_base_feedback')
                ->updateOrInsert(
                    ['article_id' => $id, 'user_id' => $userId, 'tenant_id' => $tenantId],
                    ['is_helpful' => (bool) $isHelpful, 'comment' => $comment, 'created_at' => now()]
                );
        } else {
            DB::table('knowledge_base_feedback')->insert([
                'article_id' => $id,
                'user_id'    => null,
                'tenant_id'  => $tenantId,
                'is_helpful' => (bool) $isHelpful,
                'comment'    => $comment,
                'created_at' => now(),
            ]);
        }

        // Update article helpfulness stats
        $helpful = (int) DB::table('knowledge_base_feedback')
            ->where('article_id', $id)->where('tenant_id', $tenantId)->where('is_helpful', true)->count();
        $notHelpful = (int) DB::table('knowledge_base_feedback')
            ->where('article_id', $id)->where('tenant_id', $tenantId)->where('is_helpful', false)->count();

        DB::table('knowledge_base_articles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update(['helpful_yes' => $helpful, 'helpful_no' => $notHelpful]);

        return $this->respondWithData(['message' => __('api_controllers_2.knowledge_base.feedback_submitted')]);
    }

    /**
     * POST /api/v2/kb/{id}/attachments
     *
     * Upload a file attachment to a KB article (admin only).
     */
    public function uploadAttachment(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->rateLimit('kb_attachment_upload', 20, 60);

        $tenantId = $this->getTenantId();

        // Verify article exists
        $exists = DB::table('knowledge_base_articles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $exists) {
            return $this->respondWithError('NOT_FOUND', __('api.kb_article_not_found'), null, 404);
        }

        $file = request()->file('file');
        if (! $file || ! $file->isValid()) {
            return $this->respondWithError('UPLOAD_INVALID', __('api.no_valid_file_provided'), 'file', 422);
        }

        $result = $this->attachmentService->upload($id, $file, $tenantId);

        if (isset($result['error'])) {
            return $this->respondWithError('UPLOAD_FAILED', $result['error'], null, 422);
        }

        return $this->respondWithData($result, null, 201);
    }

    /**
     * GET /api/v2/kb/{id}/attachments/{attachmentId}/download
     *
     * Download a file attachment (public, no tenant header required).
     * Looks up tenant from the attachment record itself so direct
     * browser links work without custom headers.
     */
    public function downloadAttachment(int $id, int $attachmentId): \Symfony\Component\HttpFoundation\Response
    {
        // Verify the article exists and get its tenant_id + visibility.
        // Unpublished articles are admin-only everywhere else; attachments
        // must follow the same rule, otherwise anyone who guesses an
        // attachment id can exfiltrate draft content via direct download.
        $article = DB::table('knowledge_base_articles')
            ->where('id', $id)
            ->where('tenant_id', TenantContext::getId())
            ->first(['id', 'tenant_id', 'is_published']);

        if (! $article) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_2.knowledge_base.article_not_found'), null, 404);
        }

        if (isset($article->is_published) && !$article->is_published) {
            // Only admins may download attachments of an unpublished article.
            try {
                $this->requireAdmin();
            } catch (\Throwable $e) {
                return $this->respondWithError('NOT_FOUND', __('api_controllers_2.knowledge_base.article_not_found'), null, 404);
            }
        }

        // Scope attachment lookup to the article's tenant to prevent cross-tenant access
        $attachment = DB::table('knowledge_base_attachments')
            ->where('id', $attachmentId)
            ->where('article_id', $id)
            ->where('tenant_id', $article->tenant_id)
            ->first();

        if (! $attachment) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_2.knowledge_base.attachment_not_found'), null, 404);
        }

        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        if (! $disk->exists($attachment->file_path)) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_2.knowledge_base.file_not_found_on_disk'), null, 404);
        }

        return $disk->download($attachment->file_path, $attachment->file_name, [
            'Content-Type' => $attachment->mime_type,
        ]);
    }

    /**
     * DELETE /api/v2/kb/{id}/attachments/{attachmentId}
     *
     * Delete a file attachment from a KB article (admin only).
     */
    public function deleteAttachment(int $id, int $attachmentId): JsonResponse
    {
        $this->requireAdmin();
        $this->rateLimit('kb_attachment_delete', 20, 60);

        $deleted = $this->attachmentService->delete($attachmentId, $id);

        if (! $deleted) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_2.knowledge_base.attachment_not_found'), null, 404);
        }

        return $this->noContent();
    }
}
