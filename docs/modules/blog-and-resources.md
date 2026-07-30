# Blog & Resources Modules

Last reviewed: 2026-07-30

Audience: maintainers and contributors working on content publishing, the resource library, SEO, or the accessible (GOV.UK) frontend.

Both modules ship in every tenant installation. Each is independently toggled by a feature flag (both default **ON**).

---

## Feature flags

| Flag | Default | Effect when OFF |
|------|---------|-----------------|
| `blog` | ON | Blog routes redirect to `/`; sitemap skips `/blog`; prerender drops `/blog` and all post URLs |
| `resources` | ON | `/resources` and `/kb` show "coming soon"; `/kb/:id` redirects to `/`; prerender drops `/kb/{id}` URLs (the sitemap never emits `/resources` or a `/kb` index — see Prerender below) |

React gating lives in the route files, not `App.tsx` (which is a provider shell whose only route is the `/*` catch-all rendering `TenantShell`). The blog gate is in `react-frontend/src/routes/PublicAppRoutes.tsx`; the resources and knowledge-base gates are in `react-frontend/src/routes/AppRoutes.tsx`:

```tsx
// react-frontend/src/routes/PublicAppRoutes.tsx
<FeatureGate feature="blog" redirect="/">
  <BlogPage />
</FeatureGate>

// react-frontend/src/routes/AppRoutes.tsx
<FeatureGate feature="resources" fallback={<ComingSoonPage ... />}>
  <ResourcesPage />
</FeatureGate>
```

PHP (Sitemap, Prerender, AI context) reads `TenantContext::hasFeature('blog')` / `hasFeature('resources')`.

---

## Blog

### Overview

The blog module provides tenant-scoped article publishing. Admins author posts in the admin panel; the public reads them via the React frontend or accessible (GOV.UK) frontend. Blog posts participate in the social layer (comments, reactions, likes, bookmarks, shares, feed activity, prerendering, and SEO).

### Key files

| Layer | File |
|-------|------|
| Eloquent model | `app/Models/Post.php` |
| Business logic | `app/Services/BlogService.php` |
| Public API | `app/Http/Controllers/Api/BlogPublicController.php` |
| Admin API | `app/Http/Controllers/Api/AdminBlogController.php` |
| React frontend | `react-frontend/src/pages/blog/BlogPage.tsx`, `BlogPostPage.tsx` |
| Accessible frontend trait | `app/Http/Controllers/GovukAlpha/Concerns/BlogReviewsParity.php` |
| SEO metadata model | `app/Models/SeoMetadata.php` |
| Prerender observer | `app/Observers/PostPrerenderObserver.php` |

### Database tables

| Table | Purpose |
|-------|---------|
| `posts` | Blog posts (`tenant_id`, `author_id`, `title`, `slug`, `content`, `html_render`, `excerpt`, `featured_image`, `status`, `category_id`, `content_json`) |
| `categories` | Shared category table; blog categories use `type = 'blog'` |
| `seo_metadata` | Per-post SEO fields (`entity_type = 'post'`, `entity_id`) — `meta_title`, `meta_description`, `meta_keywords`, `canonical_url`, `og_image_url`, `noindex` |
| `comments` | Comments on posts via `target_type = 'blog'` or `'blog_post'` |
| `reactions` | Emoji reactions on posts |

### Tenant scoping

`Post` uses the `HasTenantScope` trait. Every query issued by `BlogService` and `AdminBlogController` carries an implicit `WHERE tenant_id = <current>`. `AdminBlogController` additionally asserts `tenant_id = ?` in every raw `DB::` query.

### Post lifecycle

Posts have two statuses: `draft` and `published`. Only `published` posts appear in public API responses. Admins toggle status individually via `POST /api/v2/admin/blog/{id}/toggle-status` or in bulk via `POST /api/v2/admin/blog/bulk-publish`.

On every `Post` save or delete, `PostPrerenderObserver` invalidates the affected snapshot and enqueues a recache (see `app/Observers/PostPrerenderObserver.php`). This keeps SEO snapshots fresh without a manual re-render.

Content is sanitised on both write (via `App\Helpers\HtmlSanitizer::sanitizeCms()`) and read (detail view applies a second idempotent pass to guard against pre-sanitiser legacy content).

Placeholder/demo posts are silently excluded from all public responses. The exclusion is slug-based and content-based (the string `lorem ipsum`).

### Slug uniqueness

Slugs are auto-generated from the title at creation time (lowercase, hyphens) and are unique within a tenant. If a collision occurs, a Unix timestamp suffix is appended. Custom slug overrides via the `slug` field in `POST /api/v2/admin/blog` or `PUT /api/v2/admin/blog/{id}` are subject to the same deduplication check.

### Blog content (html_render vs content)

Two content fields exist for backwards compatibility:

- `content` — raw HTML or Markdown authored in older tooling.
- `html_render` — rendered HTML from a structured editor (JSON stored in `content_json`).

`BlogService::getBySlug()` prefers `html_render` over `content`, then sanitises the result.

### SEO

Each post can have an associated `seo_metadata` row. Fields exposed in API responses: `meta_title`, `meta_description`, `meta_keywords`, `canonical_url`, `og_image_url`, `noindex`. The React frontend passes these to `<PageMeta>` for server-side prerendering.

The Sitemap service includes all published blog posts (excluding placeholders) when `blog` is ON. Priority `0.7`, changefreq `weekly` per-post; the index `/blog` is `0.8`, changefreq `daily`.

### Reading time

`BlogService::getBySlug()` computes estimated reading time as `ceil(word_count / 200)` minutes, minimum 1.

### Public API endpoints (no auth required)

All three blog public endpoints are exempt from `auth:sanctum` middleware via `->withoutMiddleware('auth:sanctum')`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/blog` | Cursor-paginated list of published posts. Params: `per_page` (1–50, default 12), `cursor`, `search`, `category_id` |
| GET | `/api/v2/blog/categories` | Blog category list with `post_count` |
| GET | `/api/v2/blog/{slug}` | Single published post by slug (includes full content, SEO fields, reading time) |

See `routes/api.php` lines 1211–1213 and `app/Http/Controllers/Api/BlogPublicController.php`.

### Admin API endpoints (admin auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/admin/blog` | Paginated post list. Params: `page`, `limit`, `status` (draft\|published), `search` |
| POST | `/api/v2/admin/blog` | Create post. Body: `title` (required), `slug`, `content`, `excerpt`, `status`, `featured_image`, `category_id`, `meta_title`, `meta_description`, `noindex` |
| GET | `/api/v2/admin/blog/{id}` | Post detail including SEO metadata |
| PUT | `/api/v2/admin/blog/{id}` | Update any post fields |
| DELETE | `/api/v2/admin/blog/{id}` | Delete post (permanent) |
| POST | `/api/v2/admin/blog/{id}/toggle-status` | Toggle draft ↔ published |
| POST | `/api/v2/admin/blog/bulk-delete` | Bulk delete (max 100 IDs per request, rate-limited 10/min) |
| POST | `/api/v2/admin/blog/bulk-publish` | Bulk publish draft posts (max 100 IDs per request, rate-limited 10/min) |
| GET | `/api/v2/admin/tools/blog-backups` | List blog content backups |
| POST | `/api/v2/admin/tools/blog-backups/{id}/restore` | Restore a blog backup |

See `routes/api.php` lines 1824–1831 (`AdminBlogController`) and 2803–2804 (blog backups, served by `AdminToolsController`), plus `app/Http/Controllers/Api/AdminBlogController.php`.

### AI blog generation

`POST /api/ai/generate/blog` — **admin only**. `AiChatController::generateBlog()` calls `requireAdmin()` as its first statement, which returns 403 `AUTH_INSUFFICIENT_PERMISSIONS` to any non-admin-tier user. The route at `routes/api.php:3223` inherits `auth:sanctum` from the group opened at `routes/api.php:3122` but carries no `admin` route middleware — contrast `/ai/test-provider` at `routes/api.php:3217`, which is registered with `middleware(['admin', 'throttle:nexus-route-10-per-1m'])` — so `requireAdmin()` in the controller is the only admin gate.

### Social interactions on blog posts

The blog integrates with the shared social layer:

- **Comments** — `CommentService` handles `target_type = 'blog_post'` (normalised to `'blog'` internally). Comment threads appear on both the React frontend and the accessible frontend.
- **Reactions / likes** — `ReactionService` supports `'blog'` as a valid content type.
- **Bookmarks** — `BookmarkService` supports `'blog'` as a bookmarkable type.
- **Shares** — `ShareService` supports `'blog'`.
- **Feed activity** — Published blog posts appear in the tenant feed.

### Frontend entry points

React:

- `/blog` → `react-frontend/src/pages/blog/BlogPage.tsx` — category filter tabs, search, cursor-paginated grid.
- `/blog/:slug` → `react-frontend/src/pages/blog/BlogPostPage.tsx` — full post with comment thread, reactions.

Accessible (GOV.UK) frontend under `/{tenantSlug}/accessible/`:

- `GET /blog` — index (govuk-alpha.blog.index)
- `GET /blog/feed.xml` — RSS feed (govuk-alpha.blog.feed)
- `GET /blog/{slug}` — post detail (govuk-alpha.blog.show)
- `POST /blog/{slug}/comments` — add comment (throttled 20/min)
- `POST /blog/{slug}/like` — toggle like (throttled 60/min)
- `GET /blog/{slug}/comments` — full comment thread with edit/delete/reply (blogreviews.blog.comments)
- `POST /blog/{slug}/comments/add` — rich comment store
- `POST /blog/{slug}/react` — emoji reaction on post (throttled 60/min)
- `GET /blog/{slug}/likers/{reaction}` — who reacted with a given emoji

Routes defined in `routes/govuk-alpha.php` (base) and `routes/govuk-alpha-parity/blogreviews.php` (rich interactions).

### Prerender

`PrerenderService::FEATURE_GATED_ROUTES` maps `'blog'` → `['/blog']`. Individual post URLs are also tracked and re-rendered on save/delete events via `PostPrerenderObserver`. When the `blog` feature is OFF the entire set of routes is skipped.

---

## Resources

### Overview

The resources module is a tenant-scoped file library. Any authenticated member can upload documents, images, or spreadsheets. Files are served as streamed downloads with a download counter. The library supports a two-level hierarchical category tree, text search, cursor pagination, drag-and-drop reorder (admin only), and social interactions (comments, reactions).

A separate admin-managed knowledge base (`knowledge_base_articles`, surfaced at `/kb`) shares the `resources` feature flag but uses a distinct table and controller.

### Key files

| Layer | File |
|-------|------|
| Eloquent model | `app/Models/ResourceItem.php` |
| Business logic | `app/Services/ResourceService.php` |
| Public API | `app/Http/Controllers/Api/ResourcePublicController.php` |
| Category API | `app/Http/Controllers/Api/ResourceCategoryController.php` |
| Admin API | `app/Http/Controllers/Api/AdminResourcesController.php` (knowledge base articles) |
| React frontend | `react-frontend/src/pages/resources/ResourcesPage.tsx` |
| Accessible frontend trait | `app/Http/Controllers/GovukAlpha/Concerns/ResourcesParity.php` |

### Database tables

| Table | Purpose |
|-------|---------|
| `resources` | Uploaded files (`tenant_id`, `user_id`, `category_id`, `title`, `description`, `file_path`, `file_type`, `file_size`, `downloads`, `sort_order`, `content_type`, `content_body`) |
| `resource_categories` | Hierarchical category tree (`tenant_id`, `name`, `slug`, `parent_id`, `sort_order`, `icon`, `description`) |
| `categories` | Also used for flat resource categories (`type = 'resource'`) via `ResourcePublicController::categories()` |
| `knowledge_base_articles` | Admin-authored knowledge-base articles (`tenant_id`, `title`, `slug`, `content`, `is_published`, `views_count`, `helpful_yes`, `helpful_no`) |
| `knowledge_base_attachments` | Files attached to KB articles |
| `knowledge_base_feedback` | Helpfulness votes on KB articles |

### Tenant scoping

`ResourceItem` uses `HasTenantScope`. All raw `DB::` queries in `ResourcePublicController` and `ResourceCategoryController` include `WHERE r.tenant_id = ?` / `WHERE rc.tenant_id = ?`. Delete operations assert `tenant_id` before removing files from disk and rows from the database.

### File upload

`POST /api/v2/resources` accepts `multipart/form-data`. Validation enforced by `ResourcePublicController::store()`:

- **Allowed extensions** (extension allowlist): `pdf`, `doc`, `docx`, `xls`, `xlsx`, `txt`, `csv`, `jpg`, `png`, `gif`, `webp`. SVG is intentionally excluded (XSS vector).
- **Size limit**: 10 MB (`10 * 1024 * 1024` bytes). Size is read via `filesize()` on the temp path rather than `SplFileInfo::getSize()` (which throws in Laravel).
- **MIME type verification**: Every extension maps to a positive allowlist of MIME types detected by `finfo`. The file is rejected if the detected MIME does not appear in that extension's allowlist — so renaming an executable to `.pdf` is caught.
- **Filenames**: A cryptographically random hex name (`bin2hex(random_bytes(16))`) plus the original extension is generated for every upload. The original filename is never stored on disk.

Files land at `httpdocs/uploads/{tenant_id}/resources/{random_name}.{ext}`. The path stored in the `resources.file_path` column is the bare filename (not the full path). The public file URL is resolved at read time using `UrlHelper::getBaseUrl()`.

### File download

`GET /api/v2/resources/{id}/download` requires authentication. The controller:

1. Resolves the full filesystem path using `realpath()` and confirms it is inside the `httpdocs/uploads` directory (path traversal guard).
2. Increments `resources.downloads` before streaming.
3. Returns a `StreamedResponse` with `Content-Disposition: attachment`, the correct `Content-Type`, and `Content-Length`. The download filename is derived from the resource title (URL-safe, original extension).

### Category tree

`ResourceCategoryController::tree()` returns a nested tree or flat list (`?flat=1`). Categories carry a `resource_count` (left join against `resources`). Deleting a category fails with HTTP 409 if it has child categories. On successful category deletion, the `category_id` on affected resources is set to `null` (not deleted).

`ResourcePublicController::categories()` returns a flat list from the `categories` table (`type = 'resource'`) with per-tenant counts — a separate simpler path used by the React filter bar.

### Admin reorder

`PUT /api/v2/resources/reorder` accepts `{"items": [{"id": 1, "sort_order": 0}, ...]}`. The operation runs in a transaction; any invalid ID rolls back. List results are ordered by `sort_order ASC, created_at DESC`.

### Ownership and deletion

Delete and update operations check ownership or admin role (`admin`, `super_admin`, `tenant_admin`) before proceeding. The uploader or any admin can delete a resource. On delete, the physical file is removed from disk before the database row is deleted.

### Knowledge base (admin-managed)

The knowledge base at `/kb` shares the `resources` feature flag. It is entirely admin-authored via `AdminResourcesController` (backed by `knowledge_base_articles`). The admin list supports status filter (`published`, `draft`, `all`), search, and offset pagination. Deleting an article cascades to `knowledge_base_attachments` (files removed from `Storage::disk('public')`) and `knowledge_base_feedback`.

### Member API endpoints

Unlike the blog public routes, **no resources route opts out of `auth:sanctum`** — every path below sits inside the `Route::middleware('auth:sanctum')` group and returns 401 to an unauthenticated caller.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v2/resources` | required | Cursor-paginated list. Params: `per_page` (1–50, default 20), `cursor`, `search`, `category_id` |
| GET | `/api/v2/resources/categories` | required | Flat category list with counts |
| GET | `/api/v2/resources/categories/tree` | required | Hierarchical category tree (`?flat=1` for flat list) |
| POST | `/api/v2/resources` | required | Upload a resource (multipart/form-data). Fields: `file` (required), `title` (required), `description`, `category_id` |
| GET | `/api/v2/resources/{id}/download` | required | Stream file download, increment counter |
| PUT | `/api/v2/resources/{id}` | required | Update `title`, `description`, `category_id`, or `content_body` (owner or admin) |
| DELETE | `/api/v2/resources/{id}` | required | Delete resource and file on disk (owner or admin) |

### Admin API endpoints (admin auth required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v2/resources/categories` | Create category (rate-limited 10/min) |
| PUT | `/api/v2/resources/categories/{id}` | Update category (rate-limited 20/min) |
| DELETE | `/api/v2/resources/categories/{id}` | Delete category (rate-limited 10/min) |
| PUT | `/api/v2/resources/reorder` | Reorder resources by sort_order (rate-limited 10/min) |
| GET | `/api/v2/admin/resources` | List knowledge-base articles. Params: `search`, `status`, `page`, `limit` |
| GET | `/api/v2/admin/resources/{id}` | KB article detail with attachments |
| DELETE | `/api/v2/admin/resources/{id}` | Delete KB article, attachments, and feedback |

See `routes/api.php` lines 1224–1234 and 2622–2624.

### Social interactions on resources

Resources support the same social layer as blog posts:

- **Comments** — `CommentService` handles `target_type = 'resource'` (mapped to the `resources` table and `user_id` ownership column).
- **Reactions** — `ReactionService` supports the `'resource'` content type.

### Frontend entry points

React:

- `/resources` → `react-frontend/src/pages/resources/ResourcesPage.tsx` — category tree sidebar, search, cursor-paginated list, upload modal (authenticated), download button.

Accessible (GOV.UK) frontend under `/{tenantSlug}/accessible/`:

- `GET /resources` — simple browse (govuk-alpha.resources.index)
- `GET /resources/library` — full library with category tree, filters, pagination, reorder
- `GET /resources/upload` / `POST /resources/upload` — upload form (throttled 20/min)
- `POST /resources/reorder` — admin drag-and-drop reorder (throttled 60/min)
- `GET /resources/{id}/download` — streamed download with counter
- `GET /resources/{id}/delete` / `POST /resources/{id}/delete` — delete confirmation (throttled 30/min)
- `POST /resources/{id}/react` — emoji reaction (throttled 30/min)
- `GET /resources/{id}/comments` — comment thread
- `POST /resources/{id}/comments/add` — add comment (throttled 30/min)
- `POST /resources/{id}/comments/{commentId}/delete` — delete comment (throttled 30/min)

Routes defined in `routes/govuk-alpha.php` (simple browse) and `routes/govuk-alpha-parity/resources.php` (full library and actions).

### Prerender

`PrerenderService::FEATURE_GATED_ROUTES` contains only `blog` and `merchant_coupons` — there is no `resources` key. The `resources` feature instead gates dynamic `/kb/` URLs through the separate prefix map in `PrerenderService::dynamicRouteGateAllows()`.

The Sitemap service never emits `/resources` or a `/kb` index. Its only KB generator, `getKbArticleUrls()`, produces `/kb/{id}` at changefreq `monthly`, priority `0.6` — and it currently has no callers (`getContentMethods()` registers only `blog_posts` and `cms_pages`), so no KB URLs reach the sitemap today.

---

## Security invariants

**Blog:**

- All public read endpoints require no auth but are still tenant-scoped via `TenantContext`.
- Admin write endpoints call `$this->requireAdmin()` before any DB operation.
- All user-supplied HTML content passes through `HtmlSanitizer::sanitizeCms()` on both write and read of the detail view.
- Bulk operations cap at 100 IDs per request and are rate-limited to prevent abuse.
- Every delete and update confirms `tenant_id` in the `WHERE` clause.

**Resources:**

- Extension + MIME allowlist enforcement prevents disguised executable uploads. SVG is intentionally excluded.
- All file-system paths are resolved with `realpath()` and verified to be inside the `httpdocs/uploads` directory before read or delete operations.
- Cryptographically random filenames prevent enumeration of uploaded files.
- Download endpoint requires authentication.
- Delete and edit require ownership OR admin role, verified server-side.

---

## Failure modes and recovery

| Failure | Behaviour | Recovery |
|---------|-----------|----------|
| Post slug collision on create | A Unix timestamp suffix is appended; creation succeeds | No action needed; the generated slug can be edited via `PUT /api/v2/admin/blog/{id}` |
| Blog post HTML contains un-sanitised content (legacy) | `getBySlug()` applies a second idempotent sanitiser pass on read | None needed; new posts are sanitised on write |
| Placeholder post leaks into public feed | `excludePlaceholderPosts()` scoper is applied; should not occur normally | Check for `lorem ipsum` in content and remove via admin panel |
| Resource temp file missing (Docker overlay FS) | `POST /api/v2/resources` returns `FILE_UPLOAD_FAILED` (500) with `upload_temp_file_not_found` | Retry the upload; if persistent, check Docker overlay volume configuration |
| Resource file missing on disk at download time | Returns 404 `file_not_found` | Re-upload the resource; the DB row can be deleted via admin |
| Resource category deleted with children | Returns HTTP 409 | Delete or re-parent child categories first |
| KB article deleted, attachments still on disk | `AdminResourcesController::destroy()` calls `Storage::disk('public')->delete()` for each attachment; individual `unlink` failures are silent | Check `storage/app/public` for orphaned files manually |
| `resources` feature toggled OFF | Prerender stops queuing `/kb/{id}` URLs; React shows the "coming soon" fallback for `/resources` and `/kb`, and redirects `/kb/:id` to `/` | Toggle feature back ON via admin panel |

---

## Tests

Run from the repository root:

```bash
# Blog — unit and feature
vendor/bin/phpunit --filter=BlogServiceTest
vendor/bin/phpunit --filter=BlogPublicControllerTest
vendor/bin/phpunit --filter=AdminBlogControllerTest

# Resources — unit and feature
vendor/bin/phpunit --filter=ResourceServiceTest
vendor/bin/phpunit --filter=ResourcePublicControllerTest
vendor/bin/phpunit --filter=ResourceCategoryControllerTest
vendor/bin/phpunit --filter=AdminResourcesControllerTest
vendor/bin/phpunit --filter=ResourceItemTest

# Accessible frontend parity
vendor/bin/phpunit --filter=BlogReviewsParityTest
vendor/bin/phpunit --filter=ResourcesParityTest
vendor/bin/phpunit --filter=ResourcesSocialParityTest

# React
cd react-frontend && npm test -- BlogPage
cd react-frontend && npm test -- BlogPostPage
cd react-frontend && npm test -- ResourcesPage
```

Key test files:

| File | What it covers |
|------|---------------|
| `tests/Laravel/Unit/Services/BlogServiceTest.php` | `getAll`, `getBySlug`, `getPosts`, `getCategories` |
| `tests/Laravel/Feature/Controllers/BlogPublicControllerTest.php` | Public index/categories/show including 404 on missing slug |
| `tests/Laravel/Feature/Controllers/AdminBlogControllerTest.php` | Admin CRUD, toggle status, bulk operations |
| `tests/Laravel/Unit/Services/ResourceServiceTest.php` | `getAll`, `download`, `delete` with wrong-user guard |
| `tests/Laravel/Feature/Controllers/ResourcePublicControllerTest.php` | Index, categories, store (MIME mismatch rejection), destroy auth guard |
| `tests/Laravel/Feature/Controllers/ResourceCategoryControllerTest.php` | Category CRUD, tree, reorder |
| `tests/Laravel/Feature/Controllers/AdminResourcesControllerTest.php` | KB article list/show/delete |
| `tests/Laravel/Unit/Models/ResourceItemTest.php` | Model structure and relationships |
| `tests/Laravel/Feature/GovukAlpha/BlogReviewsParityTest.php` | Accessible blog comment thread, reactions, likers |
| `tests/Laravel/Feature/GovukAlpha/ResourcesParityTest.php` | Accessible library, upload, download, delete |
| `tests/Laravel/Feature/GovukAlpha/ResourcesSocialParityTest.php` | Accessible resource reactions and comments |

---

## Related modules and routes

- **Comments** — `app/Services/CommentService.php` (handles `blog_post`, `blog`, `resource` target types)
- **Reactions** — `app/Services/ReactionService.php` (handles `blog`, `resource` types)
- **Sitemap** — `app/Services/SitemapService.php` (blog posts + the `/blog` index; no `/resources` or `/kb` URLs are emitted)
- **Prerender** — `app/Services/PrerenderService.php`, `app/Observers/PostPrerenderObserver.php`
- **Feed** — `app/Services/FeedService.php` (surfaces blog posts in the activity feed)
- **AI context** — `app/Services/AI/AiModuleDocsService.php` (provides blog and resources module context to the AI chat assistant)
- **Route definitions** — `routes/api.php` (API), `routes/govuk-alpha.php` + `routes/govuk-alpha-parity/blogreviews.php` + `routes/govuk-alpha-parity/resources.php` (accessible frontend)
