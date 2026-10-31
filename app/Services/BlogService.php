<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\Category;
use App\Models\Post;
use Illuminate\Database\Eloquent\Builder;

/**
 * BlogService — Eloquent-based service for blog/post operations.
 *
 * Uses the Post model (posts table) which stores blog articles.
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class BlogService
{
    private const PLACEHOLDER_BLOG_SLUGS = [
        'aenean-sed-pulvinar-et-diam',
    ];

    /**
     * Explicit columns permitted in anonymous blog projections.
     *
     * author_id is deliberately absent: public editorial content must never
     * turn the linked platform account into a public member directory entry.
     */
    private const PUBLIC_SUMMARY_COLUMNS = [
        'id',
        'title',
        'slug',
        'excerpt',
        'featured_image',
        'category_id',
        'created_at',
        'updated_at',
    ];

    private const PUBLIC_DETAIL_COLUMNS = [
        'id',
        'title',
        'slug',
        'excerpt',
        'content',
        'html_render',
        'featured_image',
        'category_id',
        'created_at',
        'updated_at',
    ];

    public function __construct(
        private readonly Post $post,
        private readonly Category $category,
    ) {}

    /**
     * Get published blog posts with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getAll(array $filters = []): array
    {
        return $this->getPublicPosts($filters);
    }

    /**
     * Get the anonymous-safe public blog index projection.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getPublicPosts(array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = $this->post->newQuery()
            ->select(self::PUBLIC_SUMMARY_COLUMNS)
            ->published()
            ->with(['category:id,name,slug,color', 'seoMetadata']);
        $this->excludePlaceholderPosts($query);

        if (! empty($filters['category_id'])) {
            $query->where('category_id', (int) $filters['category_id']);
        }

        if (! empty($filters['search'])) {
            $term = '%' . $filters['search'] . '%';
            $query->where(function (Builder $q) use ($term) {
                $q->where('title', 'LIKE', $term)
                  ->orWhere('excerpt', 'LIKE', $term);
            });
        }

        if ($cursor !== null && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('id', '<', (int) $cid);
        }

        $query->orderByDesc('created_at');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $baseUrl = rtrim(env('APP_URL', 'https://api.project-nexus.ie'), '/');

        $formatted = $items->map(function (Post $post) use ($baseUrl) {
            return $this->formatPostSummary($post, $baseUrl);
        })->all();

        return [
            'items'    => $formatted,
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get published blog posts with offset pagination.
     *
     * @return array{items: array, total: int}
     */
    public function getPosts(int $tenantId, int $page = 1, int $perPage = 20, ?int $categoryId = null): array
    {
        $query = $this->post->newQuery()
            ->select(self::PUBLIC_SUMMARY_COLUMNS)
            ->published()
            ->with(['category:id,name,slug,color', 'seoMetadata']);
        $this->excludePlaceholderPosts($query);

        if ($categoryId) {
            $query->where('category_id', $categoryId);
        }

        $total = $query->count();
        $items = $query->orderByDesc('created_at')
            ->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->get();

        $baseUrl = rtrim(env('APP_URL', 'https://api.project-nexus.ie'), '/');

        return [
            'items' => $items->map(fn (Post $p) => $this->formatPostSummary($p, $baseUrl))->all(),
            'total' => $total,
        ];
    }

    /**
     * Get a single blog post by slug.
     */
    public function getBySlug(string $slug, ?int $tenantId = null): ?array
    {
        return $this->getPublicPostBySlug($slug, $tenantId);
    }

    /**
     * Get the anonymous-safe public projection for one published blog post.
     */
    public function getPublicPostBySlug(string $slug, ?int $tenantId = null): ?array
    {
        $post = $this->post->newQuery()
            ->select(self::PUBLIC_DETAIL_COLUMNS)
            ->published()
            ->with(['category:id,name,slug,color', 'seoMetadata'])
            ->whereNotIn('slug', self::PLACEHOLDER_BLOG_SLUGS)
            ->whereRaw("LOWER(CONCAT_WS(' ', title, excerpt, content, html_render)) NOT LIKE ?", ['%lorem ipsum%'])
            ->where('slug', $slug)
            ->first();

        if (! $post) {
            return null;
        }

        $baseUrl = rtrim(env('APP_URL', 'https://api.project-nexus.ie'), '/');
        $seo = $post->seoMetadata;
        // Sanitise on read: the detail view outputs this unescaped ({!! !!}), and
        // html_render is not guaranteed to have passed through the CMS sanitiser on
        // write. sanitizeCms is idempotent, so already-clean content is unaffected.
        $content = \App\Helpers\HtmlSanitizer::sanitizeCms((string) ($post->html_render ?? $post->content ?? ''));
        $wordCount = str_word_count(strip_tags($content));
        $readingTime = max(1, (int) ceil($wordCount / 200));

        return [
            'id'               => $post->id,
            'title'            => $post->title ?? '',
            'slug'             => $post->slug ?? '',
            'excerpt'          => $post->excerpt ?? '',
            'content'          => $content,
            'featured_image'   => $this->resolveImageUrl($post->featured_image, $baseUrl),
            // ISO 8601 with offset (2026-10-23): "2026-10-23 14:00:00" is not a
            // valid schema.org / Open Graph date, and new Date() in React Native
            // may not parse it. posts has no publish column; created_at stands in.
            'published_at'     => self::isoDate($post->created_at),
            'created_at'       => self::isoDate($post->created_at),
            'updated_at'       => $post->updated_at ? self::isoDate($post->updated_at) : null,
            'views'            => 0,
            'reading_time'     => $readingTime,
            'meta_title'       => $seo?->meta_title ?: ($post->title ?? null),
            'meta_description' => $seo?->meta_description ?: ($post->excerpt ?? null),
            'meta_keywords'    => $seo?->meta_keywords ?: null,
            'canonical_url'    => $seo?->canonical_url ?: null,
            'og_image_url'     => $seo?->og_image_url ?: null,
            'noindex'          => (bool) ($seo?->noindex ?? false),
            'category'         => $post->category ? [
                'id'    => $post->category->id,
                'name'  => \App\Services\Translation\TaxonomyNameLocalizer::nameFor('categories', $post->category->id, $post->category->name),
                'color' => $post->category->color ?? 'blue',
            ] : null,
        ];
    }

    /**
     * Get blog categories with post counts.
     */
    public function getCategories(?int $tenantId = null): array
    {
        return $this->category->newQuery()
            ->ofType('blog')
            ->active()
            ->withCount(['posts' => function ($q) {
                $q->where('status', 'published');
                $this->excludePlaceholderPosts($q);
            }])
            ->orderBy('name')
            ->get()
            ->map(fn (Category $c) => [
                'id'         => $c->id,
                'name'       => $c->name,
                'slug'       => $c->slug ?? '',
                'color'      => $c->color ?? 'blue',
                'post_count' => (int) ($c->posts_count ?? 0),
            ])
            ->all();
    }

    // -- Helpers ---------------------------------------------------------------

    private function excludePlaceholderPosts(Builder $query): void
    {
        $query
            ->whereNotIn('slug', self::PLACEHOLDER_BLOG_SLUGS)
            ->whereRaw("LOWER(CONCAT_WS(' ', title, excerpt, content, html_render)) NOT LIKE ?", ['%lorem ipsum%']);
    }

    private function formatPostSummary(Post $post, string $baseUrl): array
    {
        $seo = $post->seoMetadata;

        return [
            'id'             => $post->id,
            'title'          => $post->title ?? '',
            'slug'           => $post->slug ?? '',
            'excerpt'        => $post->excerpt ?? '',
            'featured_image' => $this->resolveImageUrl($post->featured_image, $baseUrl),
            'published_at'   => self::isoDate($post->created_at),
            'created_at'     => self::isoDate($post->created_at),
            'views'          => 0,
            'reading_time'   => 3,
            'meta_title'     => $seo?->meta_title ?: null,
            'meta_description' => $seo?->meta_description ?: null,
            'category'       => $post->category ? [
                'id'    => $post->category->id,
                'name'  => \App\Services\Translation\TaxonomyNameLocalizer::nameFor('categories', $post->category->id, $post->category->name),
                'color' => $post->category->color ?? 'blue',
            ] : null,
        ];
    }

    private function resolveImageUrl(?string $url, string $baseUrl): ?string
    {
        if (! $url) {
            return null;
        }
        if (str_starts_with($url, 'http')) {
            $parts = parse_url($url);
            $path = is_array($parts) ? (string) ($parts['path'] ?? '') : '';
            $host = is_array($parts) ? (string) ($parts['host'] ?? '') : '';
            $baseHost = (string) (parse_url($baseUrl, PHP_URL_HOST) ?: '');

            if (
                (str_starts_with($path, '/storage/') || str_starts_with($path, '/uploads/'))
                && in_array($host, array_filter([$baseHost, 'localhost', '127.0.0.1', 'hour-timebank.ie', 'app.project-nexus.ie']), true)
            ) {
                return $baseUrl . $path;
            }

            return $url;
        }
        return $baseUrl . '/' . ltrim($url, '/');
    }

    /** A stored datetime (app timezone) as ISO 8601 with offset, or '' when empty. */
    private static function isoDate(mixed $value): string
    {
        if ($value === null || $value === '') {
            return '';
        }
        try {
            return \Illuminate\Support\Carbon::parse((string) $value, (string) config('app.timezone', 'UTC'))->toIso8601String();
        } catch (\Throwable) {
            return (string) $value;
        }
    }
}
