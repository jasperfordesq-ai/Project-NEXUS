<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\ImageUploadService;
use Illuminate\Http\JsonResponse;

/**
 * UploadController — File/image upload handling.
 */
class UploadController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly ImageUploadService $uploadService,
    ) {}

    /**
     * POST /api/v2/upload
     *
     * Upload an image file. Accepts multipart/form-data with a 'file' field.
     * Optional: type (avatar|cover|listing|post), max_width, max_height.
     */
    public function store(): JsonResponse
    {
        // Admin-only (F-091): every caller is an admin tool (newsletter builder,
        // page builder, blog featured image). Members upload through their own
        // feature-specific endpoints, which validate and scope what they store.
        $this->requireAdmin();
        $this->rateLimit('upload', 20, 60);

        // Validate file upload. SVG is intentionally excluded (XSS vector).
        // Non-image types are allowed for document uploads (CV, resources).
        request()->validate([
            'file' => 'required|file|max:10240|mimes:jpg,jpeg,png,gif,webp,pdf,doc,docx,xls,xlsx,csv,txt,mp3,mp4,wav',
        ]);

        $file = request()->file('file');

        if (!$file || !$file->isValid()) {
            return $this->respondWithError('UPLOAD_INVALID', __('api.no_valid_file_provided'), 'file', 422);
        }

        // Double-check MIME type via file content inspection (not just extension)
        // Blocks HTML/SVG/PHP disguised as allowed extensions
        $detectedMime = $file->getMimeType();
        $blockedMimes = ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/x-httpd-php'];
        if ($detectedMime && in_array($detectedMime, $blockedMimes, true)) {
            return $this->respondWithError('UPLOAD_BLOCKED', __('api.file_type_blocked'), 'file', 422);
        }

        $type = $this->input('type', 'general');

        // ImageUploadService::upload(UploadedFile $file, string $directory).
        // The old 4-arg call coerced $userId into the directory name, so
        // files landed in a directory named after the user's id and $type
        // was silently ignored. Failures throw — they don't return ['error'].
        try {
            $result = $this->uploadService->upload($file, 'uploads/' . preg_replace('/[^a-z0-9_-]/i', '', $type));
        } catch (\Throwable $e) {
            return $this->respondWithError('UPLOAD_FAILED', $e->getMessage(), null, 422);
        }

        return $this->respondWithData($result, null, 201);
    }

    /**
     * GET /api/v2/upload/list
     *
     * List the current tenant's previously-uploaded images (newest first) so the
     * newsletter builder's asset library can browse + reuse them, not just upload.
     */
    public function index(): JsonResponse
    {
        // Admin-only (F-091): the library lists every image the tenant uploaded.
        $this->requireAdmin();
        $this->rateLimit('upload_list', 60, 60);

        return $this->respondWithData(['images' => $this->uploadService->listImages()]);
    }
}
