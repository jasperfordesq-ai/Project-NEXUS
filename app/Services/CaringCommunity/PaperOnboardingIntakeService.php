<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Models\User;
use App\Support\Authorization\MinimumAge;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class PaperOnboardingIntakeService
{
    /**
     * @param array<string, mixed> $seedFields
     * @return array<string, mixed>
     */
    public function createFromUpload(int $tenantId, int $coordinatorId, UploadedFile $file, array $seedFields = []): array
    {
        $extension = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: 'bin');
        $filename = Str::uuid()->toString() . '.' . $extension;
        $storedPath = $file->storeAs("caring-paper-onboarding/{$tenantId}", $filename, 'local');

        $extractedFields = $this->extractFields($seedFields);

        $id = DB::table('caring_paper_onboarding_intakes')->insertGetId([
            'tenant_id' => $tenantId,
            'uploaded_by' => $coordinatorId,
            'status' => 'pending_review',
            'original_filename' => $file->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $file->getMimeType(),
            'file_size' => $file->getSize(),
            'ocr_provider' => 'manual_review_stub',
            'extracted_fields' => json_encode($extractedFields),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $this->find($tenantId, (int) $id) ?? [];
    }

    /**
     * The first slice keeps OCR behind a stable boundary. Seeded fields come
     * from coordinator review input today; a real OCR provider can replace
     * this method without changing controller or UI contracts.
     *
     * @param array<string, mixed> $seedFields
     * @return array<string, string|null>
     */
    public function extractFields(array $seedFields): array
    {
        return [
            'name' => $this->nullableString($seedFields['name'] ?? null),
            'date_of_birth' => $this->nullableString($seedFields['date_of_birth'] ?? null),
            'address' => $this->nullableString($seedFields['address'] ?? null),
            'phone' => $this->nullableString($seedFields['phone'] ?? null),
            'email' => $this->nullableString($seedFields['email'] ?? null),
        ];
    }

    /**
     * @return array{count:int,items:array<int,array<string,mixed>>}
     */
    public function list(int $tenantId, string $status = 'pending_review', int $limit = 20): array
    {
        $allowedStatuses = ['pending_review', 'confirmed', 'rejected', 'all'];
        if (!in_array($status, $allowedStatuses, true)) {
            $status = 'pending_review';
        }

        $query = DB::table('caring_paper_onboarding_intakes')
            ->where('tenant_id', $tenantId)
            ->orderByDesc('created_at')
            ->limit(max(1, min(100, $limit)));

        if ($status !== 'all') {
            $query->where('status', $status);
        }

        $items = $query->get()->map(fn ($row) => $this->formatRow($row))->all();

        return [
            'count' => count($items),
            'items' => $items,
        ];
    }

    /**
     * @param array<string, mixed> $fields
     * @return array<string, mixed>
     */
    public function confirm(int $tenantId, int $intakeId, int $coordinatorId, array $fields): array
    {
        $intake = DB::table('caring_paper_onboarding_intakes')
            ->where('tenant_id', $tenantId)
            ->where('id', $intakeId)
            ->first();

        if (!$intake) {
            return ['success' => false, 'code' => 'NOT_FOUND'];
        }

        if ((string) $intake->status !== 'pending_review') {
            return ['success' => false, 'code' => 'ALREADY_REVIEWED'];
        }

        $name = trim((string) ($fields['name'] ?? ''));
        $email = strtolower(trim((string) ($fields['email'] ?? '')));
        $phone = trim((string) ($fields['phone'] ?? ''));
        $address = trim((string) ($fields['address'] ?? ''));
        $dateOfBirth = trim((string) ($fields['date_of_birth'] ?? ''));

        if ($name === '' || $email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return ['success' => false, 'code' => 'VALIDATION_ERROR'];
        }

        if (User::findByEmail($email)) {
            return ['success' => false, 'code' => 'EMAIL_EXISTS'];
        }

        // Adults-only platform (owner decision 2026-09-25, F-160): a paper form
        // whose date of birth is under 18, or not a real date, never becomes
        // an account (F-249).
        $dobError = MinimumAge::dateOfBirthError($dateOfBirth);
        if ($dobError !== null) {
            return ['success' => false] + $dobError;
        }

        $parts = explode(' ', $name, 2);
        $firstName = $parts[0];
        $lastName = $parts[1] ?? '';
        $tempPassword = substr(bin2hex(random_bytes(12)), 0, 16);

        $newUserId = User::createWithTenant([
            'first_name' => $firstName,
            'last_name' => $lastName,
            'email' => $email,
            'password' => $tempPassword,
            'phone' => $phone !== '' ? $phone : null,
            'location' => $address !== '' ? $address : null,
            'role' => 'member',
            'is_approved' => 1,
        ], $tenantId);

        if (!$newUserId) {
            return ['success' => false, 'code' => 'CREATE_FAILED'];
        }

        $correctedFields = [
            'name' => $name,
            'date_of_birth' => $dateOfBirth !== '' ? $dateOfBirth : null,
            'address' => $address !== '' ? $address : null,
            'phone' => $phone !== '' ? $phone : null,
            'email' => $email,
        ];

        DB::table('caring_paper_onboarding_intakes')
            ->where('tenant_id', $tenantId)
            ->where('id', $intakeId)
            ->update([
                'status' => 'confirmed',
                'reviewed_by' => $coordinatorId,
                'created_user_id' => $newUserId,
                'corrected_fields' => json_encode($correctedFields),
                'coordinator_notes' => $this->nullableString($fields['note'] ?? null),
                'confirmed_at' => now(),
                'updated_at' => now(),
            ]);

        return [
            'success' => true,
            'intake' => $this->find($tenantId, $intakeId),
            'user' => [
                'id' => $newUserId,
                'name' => trim("{$firstName} {$lastName}"),
                'email' => $email,
            ],
            'temp_password' => $tempPassword,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function find(int $tenantId, int $id): ?array
    {
        $row = DB::table('caring_paper_onboarding_intakes')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();

        return $row ? $this->formatRow($row) : null;
    }

    /**
     * @param object $row
     * @return array<string, mixed>
     */
    private function formatRow(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'tenant_id' => (int) $row->tenant_id,
            'uploaded_by' => $row->uploaded_by !== null ? (int) $row->uploaded_by : null,
            'reviewed_by' => $row->reviewed_by !== null ? (int) $row->reviewed_by : null,
            'created_user_id' => $row->created_user_id !== null ? (int) $row->created_user_id : null,
            'status' => (string) $row->status,
            'original_filename' => (string) $row->original_filename,
            'mime_type' => $row->mime_type,
            'file_size' => $row->file_size !== null ? (int) $row->file_size : null,
            'ocr_provider' => (string) $row->ocr_provider,
            'extracted_fields' => $this->decodeJson($row->extracted_fields ?? null),
            'corrected_fields' => $this->decodeJson($row->corrected_fields ?? null),
            'coordinator_notes' => $row->coordinator_notes,
            'created_at' => $row->created_at,
            'updated_at' => $row->updated_at,
            'confirmed_at' => $row->confirmed_at,
            'rejected_at' => $row->rejected_at,
            'document_available' => is_string($row->stored_path) && Storage::disk('local')->exists($row->stored_path),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function decodeJson(mixed $value): ?array
    {
        if (!is_string($value) || $value === '') {
            return null;
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : null;
    }

    private function nullableString(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? $string : null;
    }
}
