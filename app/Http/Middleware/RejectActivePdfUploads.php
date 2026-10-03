<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Uploads\PdfActiveContentInspector;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Refuses any uploaded PDF that carries scripts or other active content
 * (F-551, reported by Cyphere: a group file with embedded JavaScript ran when a
 * member opened it).
 *
 * Many API features accept PDFs (messages, group files, team documents,
 * resources, help-centre attachments, job CVs, expense receipts, volunteer
 * credentials, the safeguarding statement) and each validates its own file
 * type, so the content check lives here, once, in the `api` group. That also
 * covers any upload feature added later. GroupFileService repeats the check so
 * the reported path does not depend on this middleware alone.
 *
 * A file is treated as a PDF when its content is sniffed as one, when it is
 * named *.pdf, or when the PDF header appears in its first kilobyte (viewers
 * accept a header anywhere in that range, so a renamed file is still a PDF to
 * them).
 */
final class RejectActivePdfUploads
{
    public function handle(Request $request, Closure $next): Response
    {
        foreach ($this->uploadedFiles($request->allFiles()) as $field => $file) {
            if (! $this->looksLikePdf($file)) {
                continue;
            }

            $path = $file->getRealPath();
            $verdict = is_string($path) && $path !== ''
                ? PdfActiveContentInspector::inspectFile($path)
                : PdfActiveContentInspector::UNINSPECTABLE;

            if ($verdict === PdfActiveContentInspector::CLEAN) {
                continue;
            }

            Log::warning('Refused an uploaded PDF with active content', [
                'verdict' => $verdict,
                'route' => $request->route()?->uri(),
                'field' => $field,
                'size' => $file->getSize(),
            ]);

            $code = $verdict === PdfActiveContentInspector::ACTIVE ? 'PDF_ACTIVE_CONTENT' : 'PDF_NOT_INSPECTABLE';
            $message = $verdict === PdfActiveContentInspector::ACTIVE
                ? __('api.pdf_active_content_refused')
                : __('api.pdf_not_inspectable');

            return response()->json([
                'success' => false,
                'error' => $message,
                'code' => $code,
                'errors' => [
                    ['code' => $code, 'message' => $message, 'field' => $field],
                ],
            ], 422, ['API-Version' => '2.0']);
        }

        return $next($request);
    }

    /**
     * Flatten Laravel's nested file arrays (attachments[] etc.).
     *
     * @param  array<string, mixed>  $files
     * @return iterable<string, UploadedFile>
     */
    private function uploadedFiles(array $files, string $prefix = ''): iterable
    {
        foreach ($files as $key => $value) {
            $name = $prefix === '' ? (string) $key : $prefix . '.' . $key;
            if ($value instanceof UploadedFile) {
                if ($value->isValid()) {
                    yield $name => $value;
                }
            } elseif (is_array($value)) {
                yield from $this->uploadedFiles($value, $name);
            }
        }
    }

    private function looksLikePdf(UploadedFile $file): bool
    {
        if (strtolower($file->getClientOriginalExtension()) === 'pdf') {
            return true;
        }
        if (strtolower((string) $file->getMimeType()) === 'application/pdf') {
            return true;
        }

        $path = $file->getRealPath();
        if (! is_string($path) || $path === '') {
            return false;
        }
        $head = @file_get_contents($path, false, null, 0, 1024);

        return is_string($head) && str_contains($head, '%PDF-');
    }
}
