<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\PartnerVenueService;
use App\Services\PartnerVenueVisitService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * AdminPartnerVenueController — tenant-admin management of partner venues,
 * their staff rosters, and engagement reporting.
 */
class AdminPartnerVenueController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly PartnerVenueService $venueService,
        private readonly PartnerVenueVisitService $visitService,
    ) {}

    private function ensureFeature(): void
    {
        if (! TenantContext::hasFeature('partner_venues')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.partner_venues_feature_disabled'), null, 403)
            );
        }
    }

    public function index(Request $request): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $status = $request->query('status');

        return $this->respondWithData([
            'venues' => $this->venueService->adminList(is_string($status) ? $status : null),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->ensureFeature();
        $actorId = $this->requireAdmin();

        $validated = $request->validate($this->rules());

        $venue = $this->venueService->create($validated, $actorId);

        return $this->respondWithData($this->venueService->toPublicArray($venue), null, 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $venue = $this->venueService->find($id);

        if ($venue === null) {
            return $this->respondWithError('NOT_FOUND', __('api.partner_venue_not_found'), null, 404);
        }

        $validated = $request->validate($this->rules(false));

        $venue = $this->venueService->update($venue, $validated);

        return $this->respondWithData($this->venueService->toPublicArray($venue));
    }

    public function archive(int $id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $venue = $this->venueService->find($id);

        if ($venue === null) {
            return $this->respondWithError('NOT_FOUND', __('api.partner_venue_not_found'), null, 404);
        }

        $this->venueService->archive($venue);

        return $this->respondWithData(['message' => __('api.partner_venue_archived')]);
    }

    public function staff(int $id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        if ($this->venueService->find($id) === null) {
            return $this->respondWithError('NOT_FOUND', __('api.partner_venue_not_found'), null, 404);
        }

        return $this->respondWithData(['staff' => $this->venueService->staffList($id)]);
    }

    public function addStaff(Request $request, int $id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        if ($this->venueService->find($id) === null) {
            return $this->respondWithError('NOT_FOUND', __('api.partner_venue_not_found'), null, 404);
        }

        $validated = $request->validate([
            'user_id' => 'required|integer|min:1',
            'role' => 'nullable|string|in:owner,admin,member',
        ]);

        $added = $this->venueService->addStaff(
            $id,
            (int) $validated['user_id'],
            (string) ($validated['role'] ?? 'member'),
        );

        if (! $added) {
            return $this->respondWithError('NOT_FOUND', __('api.partner_venue_staff_member_not_found'), 'user_id', 404);
        }

        return $this->respondWithData(['staff' => $this->venueService->staffList($id)]);
    }

    public function removeStaff(int $id, int $userId): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        if ($this->venueService->find($id) === null) {
            return $this->respondWithError('NOT_FOUND', __('api.partner_venue_not_found'), null, 404);
        }

        $this->venueService->removeStaff($id, $userId);

        return $this->respondWithData(['staff' => $this->venueService->staffList($id)]);
    }

    public function summary(Request $request): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $days = (int) ($request->query('days') ?? 30);

        return $this->respondWithData($this->visitService->summary($days));
    }

    public function exportCsv(Request $request): StreamedResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $venueId = $request->query('venue_id');
        $rows = $this->visitService->visitRows(
            is_numeric($venueId) ? (int) $venueId : null,
            $this->dateParam($request->query('from')),
            $this->dateParam($request->query('to')),
        );

        $filename = 'partner-venue-visits-' . now()->format('Y-m-d') . '.csv';

        return response()->streamDownload(function () use ($rows): void {
            $out = fopen('php://output', 'wb');

            fputcsv($out, [
                __('api.partner_venue_csv_date'),
                __('api.partner_venue_csv_time'),
                __('api.partner_venue_csv_venue'),
                __('api.partner_venue_csv_member_id'),
                __('api.partner_venue_csv_member'),
                __('api.partner_venue_csv_recorded_by'),
                __('api.partner_venue_csv_source'),
            ]);

            foreach ($rows as $row) {
                fputcsv($out, [
                    $row['visited_on'],
                    $row['visited_at'],
                    $row['venue_name'],
                    $row['member_id'],
                    $row['member_name'],
                    $row['recorded_by'],
                    $row['source'],
                ]);
            }

            fclose($out);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=utf-8',
        ]);
    }

    private function dateParam(mixed $value): ?string
    {
        if (! is_string($value) || $value === '') {
            return null;
        }

        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1 ? $value : null;
    }

    /**
     * @return array<string, string>
     */
    private function rules(bool $creating = true): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return [
            'name' => $required . '|string|max:255',
            'description' => 'nullable|string|max:5000',
            'category' => 'nullable|string|in:cafe,shop,leisure,community,other',
            'offer_summary' => 'nullable|string|max:255',
            'address_line' => 'nullable|string|max:255',
            'city' => 'nullable|string|max:100',
            'postcode' => 'nullable|string|max:20',
            'latitude' => 'nullable|numeric|between:-90,90',
            'longitude' => 'nullable|numeric|between:-180,180',
            'website' => 'nullable|url|max:255',
            'contact_email' => 'nullable|email|max:255',
            'logo_url' => 'nullable|string|max:255',
            'status' => 'nullable|string|in:active,paused,archived',
        ];
    }
}
