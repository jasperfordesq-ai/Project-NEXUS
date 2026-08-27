<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * AdminResourcesController -- Admin resource / knowledge base management.
 *
 * All endpoints require admin authentication.
 */
class AdminResourcesController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * GET /api/v2/admin/resources
     *
     * Query params: search, status (all|published|draft), page, limit
     */
    public function index(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $search = $this->query('search', '');
        $status = $this->query('status', 'all');
        $page   = max(1, $this->queryInt('page', 1));
        $limit  = min(200, max(1, $this->queryInt('limit', 50)));
        $offset = ($page - 1) * $limit;

        $query = DB::table('knowledge_base_articles as a')
            ->leftJoin('users as u', 'a.created_by', '=', 'u.id')
            ->leftJoin('categories as rc', 'a.category_id', '=', 'rc.id')
            ->where('a.tenant_id', $tenantId);

        if ($status === 'published') {
            $query->where('a.is_published', true);
        } elseif ($status === 'draft') {
            $query->where('a.is_published', false);
        }

        if (! empty(trim($search))) {
            $like = '%' . $search . '%';
            $query->where(function ($q) use ($like) {
                $q->where('a.title', 'LIKE', $like)
                  ->orWhere('a.content', 'LIKE', $like);
            });
        }

        $total = (clone $query)->count();

        $items = $query
            ->orderByDesc('a.updated_at')
            ->offset($offset)
            ->limit($limit)
            ->select(
                'a.id', 'a.title', 'a.slug', 'a.content_type',
                'a.is_published', 'a.views_count', 'a.helpful_yes',
                'a.created_at', 'a.updated_at',
                'u.first_name as author_first_name',
                'u.last_name as author_last_name', 'u.profile_type as author_profile_type', 'u.organization_name as author_organization_name',
                'rc.name as category_name'
            )
            ->get()
            ->map(static function ($row): array {
                $authorName = UserDisplayName::resolvePrefixed($row, 'author_');

                return [
                'id'            => (int) $row->id,
                'title'         => $row->title,
                'category'      => $row->category_name ?? '',
                'author_name'   => $authorName !== '' ? $authorName : null,
                'author_code'   => $authorName === '' ? 'system' : null,
                'views'         => (int) $row->views_count,
                'helpful_votes' => (int) $row->helpful_yes,
                'status'        => $row->is_published ? 'published' : 'draft',
                'updated_at'    => $row->updated_at,
                ];
            })
            ->all();

        return response()->json([
            'success' => true,
            'data' => [
                'items' => $items,
                'meta' => [
                    'page'       => $page,
                    'per_page'   => $limit,
                    'total'      => $total,
                    'total_pages' => $total > 0 ? (int) ceil($total / $limit) : 0,
                ],
            ],
        ]);
    }

    /**
     * GET /api/v2/admin/resources/{id}
     */
    public function show(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $article = DB::table('knowledge_base_articles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $article) {
            return $this->respondWithError('NOT_FOUND', __('api.article_not_found'), null, 404);
        }

        // Include attachments
        $attachments = DB::table('knowledge_base_attachments')
            ->where('article_id', $id)
            ->where('tenant_id', $tenantId)
            ->orderBy('sort_order')
            ->get()
            ->map(fn ($a) => [
                'id'         => (int) $a->id,
                'file_name'  => $a->file_name,
                'file_url'   => $a->file_url,
                'mime_type'  => $a->mime_type,
                'file_size'  => (int) $a->file_size,
            ])
            ->all();

        $data = (array) $article;
        $data['attachments'] = $attachments;

        return $this->respondWithData($data);
    }

    /**
     * DELETE /api/v2/admin/resources/{id}
     */
    public function destroy(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $exists = DB::table('knowledge_base_articles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $exists) {
            return $this->respondWithError('NOT_FOUND', __('api.article_not_found'), null, 404);
        }

        // Delete attachments from disk
        $attachments = DB::table('knowledge_base_attachments')
            ->where('article_id', $id)
            ->where('tenant_id', $tenantId)
            ->get();

        foreach ($attachments as $att) {
            if ($att->file_path) {
                \Illuminate\Support\Facades\Storage::disk('public')->delete($att->file_path);
            }
        }

        // Delete article (attachments cascade via FK, feedback manually)
        DB::table('knowledge_base_feedback')
            ->where('article_id', $id)
            ->where('tenant_id', $tenantId)
            ->delete();

        DB::table('knowledge_base_articles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->delete();

        return $this->respondWithData(['deleted' => true, 'id' => $id]);
    }
}
