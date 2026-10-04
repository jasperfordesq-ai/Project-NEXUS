<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * ImportKnowledgeBase — Bulk import docs/ folder into Knowledge Base articles.
 *
 * Scans the docs/ directory recursively, creates resource categories from
 * folder structure, and creates KB articles from .md and .pdf files.
 * Pairs .md + .pdf files with the same base name as a single article.
 */
class ImportKnowledgeBase extends Command
{
    protected $signature = 'kb:import
        {--tenant= : Tenant ID (required)}
        {--path=docs : Path relative to project root to scan}
        {--dry-run : Show what would be imported without making changes}
        {--publish : Set articles as published instead of draft}';

    protected $description = 'Import markdown and PDF files from docs/ into the Knowledge Base';

    private int $articlesCreated = 0;
    private int $attachmentsCreated = 0;
    private int $categoriesCreated = 0;
    private int $pairsMatched = 0;
    private array $categoryCache = [];

    public function handle(): int
    {
        $tenantId = (int) $this->option('tenant');
        if (! $tenantId) {
            $this->error('--tenant is required. Usage: php artisan kb:import --tenant=2');
            return 1;
        }

        // Verify tenant exists
        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        if (! $tenant) {
            $this->error("Tenant ID {$tenantId} not found.");
            return 1;
        }

        $basePath = base_path($this->option('path'));
        if (! is_dir($basePath)) {
            $this->error("Directory not found: {$basePath}");
            return 1;
        }

        $isDryRun = (bool) $this->option('dry-run');
        $isPublish = (bool) $this->option('publish');

        $this->info("Scanning: {$basePath}");
        $this->info("Tenant: {$tenantId} ({$tenant->name})");
        if ($isDryRun) {
            $this->warn('DRY RUN — no changes will be made.');
        }

        // Collect all files
        $allFiles = File::allFiles($basePath);
        $mdFiles = [];
        $pdfFiles = [];

        foreach ($allFiles as $file) {
            $ext = strtolower($file->getExtension());
            $relativePath = $file->getRelativePathname();
            $baseName = pathinfo($relativePath, PATHINFO_FILENAME);
            $relativeDir = $file->getRelativePath();

            if ($ext === 'md') {
                $mdFiles[$baseName] = [
                    'file'     => $file,
                    'dir'      => $relativeDir,
                    'basename' => $baseName,
                ];
            } elseif ($ext === 'pdf') {
                $pdfFiles[$baseName] = [
                    'file'     => $file,
                    'dir'      => $relativeDir,
                    'basename' => $baseName,
                ];
            }
            // Skip other file types (yaml, etc.)
        }

        $this->info(sprintf('Found %d .md files and %d .pdf files.', count($mdFiles), count($pdfFiles)));

        // Process paired files (same base name = one article with both attached)
        $processed = [];

        foreach ($mdFiles as $baseName => $mdInfo) {
            $pairedPdf = $pdfFiles[$baseName] ?? null;

            $this->importArticle(
                tenantId: $tenantId,
                mdInfo: $mdInfo,
                pdfInfo: $pairedPdf,
                isDryRun: $isDryRun,
                isPublish: $isPublish,
            );

            $processed[$baseName] = true;
            if ($pairedPdf) {
                $this->pairsMatched++;
            }
        }

        // Process standalone PDFs (no matching .md)
        foreach ($pdfFiles as $baseName => $pdfInfo) {
            if (isset($processed[$baseName])) {
                continue; // Already paired
            }

            $this->importArticle(
                tenantId: $tenantId,
                mdInfo: null,
                pdfInfo: $pdfInfo,
                isDryRun: $isDryRun,
                isPublish: $isPublish,
            );
        }

        $this->newLine();
        $this->info('═══════════════════════════════════════════');
        $this->info("  Articles created:    {$this->articlesCreated}");
        $this->info("  Attachments stored:  {$this->attachmentsCreated}");
        $this->info("  Categories created:  {$this->categoriesCreated}");
        $this->info("  MD+PDF pairs:        {$this->pairsMatched}");
        $this->info('═══════════════════════════════════════════');

        if ($isDryRun) {
            $this->warn('DRY RUN complete — no changes were made. Remove --dry-run to import.');
        }

        return 0;
    }

    private function importArticle(int $tenantId, ?array $mdInfo, ?array $pdfInfo, bool $isDryRun, bool $isPublish): void
    {
        $dir = $mdInfo['dir'] ?? $pdfInfo['dir'] ?? '';
        $baseName = $mdInfo['basename'] ?? $pdfInfo['basename'] ?? 'untitled';

        // Determine content
        $content = '';
        $contentType = 'html';
        $title = $this->basenameToTitle($baseName);
        $excerpt = '';

        if ($mdInfo) {
            $content = file_get_contents($mdInfo['file']->getPathname());
            $contentType = 'markdown';

            // Extract title from first # heading
            if (preg_match('/^#\s+(.+)$/m', $content, $m)) {
                $title = trim($m[1]);
            }

            // Extract excerpt from first non-heading, non-empty paragraph
            $lines = explode("\n", $content);
            foreach ($lines as $line) {
                $trimmed = trim($line);
                if (! empty($trimmed) && ! str_starts_with($trimmed, '#') && ! str_starts_with($trimmed, '---')) {
                    $excerpt = Str::limit(strip_tags($trimmed), 200);
                    break;
                }
            }
        } elseif ($pdfInfo) {
            $content = '<p>See attached PDF document.</p>';
            $contentType = 'html';
        }

        // Generate slug
        $slug = $this->generateSlug($title);

        // Check for duplicate slug
        $existingSlug = DB::table('knowledge_base_articles')
            ->where('slug', $slug)
            ->where('tenant_id', $tenantId)
            ->exists();

        if ($existingSlug) {
            $slug = $slug . '-' . time();
        }

        // Resolve category from directory
        $categoryId = null;
        if (! empty($dir)) {
            $categoryId = $this->getOrCreateCategory($tenantId, $dir, $isDryRun);
        }

        $label = $mdInfo && $pdfInfo ? '[MD+PDF]' : ($mdInfo ? '[MD]' : '[PDF]');
        $this->line("  {$label} {$title}");

        if ($isDryRun) {
            $this->articlesCreated++;
            if ($mdInfo) $this->attachmentsCreated++;
            if ($pdfInfo) $this->attachmentsCreated++;
            return;
        }

        // Insert article
        $articleId = DB::table('knowledge_base_articles')->insertGetId([
            'tenant_id'         => $tenantId,
            'title'             => $title,
            'slug'              => $slug,
            'content'           => $content,
            'content_type'      => $contentType,
            'category_id'       => $categoryId,
            'parent_article_id' => null,
            'sort_order'        => 0,
            'is_published'      => $isPublish,
            'views_count'       => 0,
            'helpful_yes'       => 0,
            'helpful_no'        => 0,
            'created_by'        => null,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        $this->articlesCreated++;

        // Attach .md file
        if ($mdInfo) {
            $this->storeAttachment($articleId, $tenantId, $mdInfo['file']);
        }

        // Attach .pdf file
        if ($pdfInfo) {
            $this->storeAttachment($articleId, $tenantId, $pdfInfo['file']);
        }
    }

    private function storeAttachment(int $articleId, int $tenantId, \SplFileInfo $file): void
    {
        $ext = strtolower($file->getExtension());
        $originalName = $file->getFilename();
        $storageName = Str::uuid() . '.' . $ext;
        $storagePath = "tenant_{$tenantId}/kb_attachments/{$storageName}";

        // Copy file to storage
        Storage::disk(\App\Services\KnowledgeBaseAttachmentService::DISK)->put($storagePath, file_get_contents($file->getPathname()));

        $mimeMap = [
            'md'   => 'text/markdown',
            'pdf'  => 'application/pdf',
            'txt'  => 'text/plain',
            'doc'  => 'application/msword',
            'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];

        $attachmentId = DB::table('knowledge_base_attachments')->insertGetId([
            'article_id' => $articleId,
            'tenant_id'  => $tenantId,
            'file_name'  => $originalName,
            'file_path'  => $storagePath,
            'file_url'   => '', // placeholder
            'mime_type'   => $mimeMap[$ext] ?? 'application/octet-stream',
            'file_size'  => $file->getSize(),
            'sort_order' => 0,
            'created_at' => now(),
        ]);

        // Set download URL using the API endpoint
        DB::table('knowledge_base_attachments')
            ->where('id', $attachmentId)
            ->update(['file_url' => "/api/v2/kb/{$articleId}/attachments/{$attachmentId}/download"]);

        $this->attachmentsCreated++;
    }

    private function getOrCreateCategory(int $tenantId, string $dir, bool $isDryRun): ?int
    {
        // Normalize: "admin" or "council-pilot" etc.
        $dir = trim($dir, '/\\');

        if (isset($this->categoryCache[$dir])) {
            return $this->categoryCache[$dir];
        }

        $name = $this->basenameToTitle($dir);
        $slug = $this->generateSlug($dir);

        // Check if already exists
        $existing = DB::table('resource_categories')
            ->where('slug', $slug)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($existing) {
            $this->categoryCache[$dir] = (int) $existing->id;
            return (int) $existing->id;
        }

        if ($isDryRun) {
            $this->categoriesCreated++;
            $this->categoryCache[$dir] = -1;
            return null;
        }

        $categoryId = DB::table('resource_categories')->insertGetId([
            'tenant_id'  => $tenantId,
            'name'       => $name,
            'slug'       => $slug,
            'parent_id'  => null,
            'sort_order' => 0,
            'icon'       => null,
            'description' => null,
            'created_at' => now(),
        ]);

        $this->categoriesCreated++;
        $this->categoryCache[$dir] = $categoryId;

        return $categoryId;
    }

    private function basenameToTitle(string $name): string
    {
        // BROKER_CONTROLS → Broker Controls
        // council-pilot → Council Pilot
        $name = str_replace(['-', '_'], ' ', $name);
        return ucwords(strtolower($name));
    }

    private function generateSlug(string $title): string
    {
        $slug = strtolower(trim($title));
        $slug = preg_replace('/[^a-z0-9]+/', '-', $slug);
        $slug = trim($slug, '-');
        return $slug ?: 'article';
    }
}
