<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Tenant-scoped sub-regions for Caring Community pilots.
 *
 * This is AG77's first practical layer: Quartier/Ortsteil style subdivisions
 * that can be used before a canton supplies authoritative boundary datasets.
 */
class CaringSubRegionService
{
    private const TABLE = 'caring_sub_regions';

    private const PER_PAGE = 50;

    public function isAvailable(): bool
    {
        return Schema::hasTable(self::TABLE);
    }

    private function assertAvailable(): void
    {
        if (! $this->isAvailable()) {
            throw new RuntimeException(__('api.service_unavailable'));
        }
    }

    /**
     * @return array{data: array<int, array>, total: int, per_page: int, current_page: int}
     */
    public function list(int $tenantId, array $filters = [], bool $admin = false): array
    {
        $this->assertAvailable();

        $page = max(1, (int) ($filters['page'] ?? 1));
        $offset = ($page - 1) * self::PER_PAGE;
        $search = isset($filters['search']) && $filters['search'] !== '' ? (string) $filters['search'] : null;
        $type = isset($filters['type']) && $filters['type'] !== '' ? (string) $filters['type'] : null;

        $query = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId);

        if (! $admin) {
            $query->where('status', 'active');
        }

        if ($type !== null) {
            $query->where('type', $type);
        }

        if ($search !== null) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'LIKE', '%' . $search . '%')
                    ->orWhere('description', 'LIKE', '%' . $search . '%')
                    ->orWhere('slug', 'LIKE', '%' . Str::slug($search) . '%');
            });
        }

        $total = (clone $query)->count();

        $rows = $query
            ->orderBy('name')
            ->offset($offset)
            ->limit(self::PER_PAGE)
            ->get()
            ->map(fn ($row) => $this->castRow((array) $row))
            ->all();

        return [
            'data' => $rows,
            'total' => $total,
            'per_page' => self::PER_PAGE,
            'current_page' => $page,
        ];
    }

    public function get(int $id, int $tenantId): ?array
    {
        $this->assertAvailable();

        $row = DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        return $row ? $this->castRow((array) $row) : null;
    }

    public function create(int $tenantId, array $data, int $adminUserId): array
    {
        $this->assertAvailable();

        $slug = $this->normaliseSlug($data['slug'] ?? $data['name'] ?? '');
        $this->assertSlugAvailable($tenantId, $slug);

        $id = DB::table(self::TABLE)->insertGetId([
            'tenant_id' => $tenantId,
            'name' => trim((string) ($data['name'] ?? '')),
            'slug' => $slug,
            'type' => (string) ($data['type'] ?? 'quartier'),
            'description' => isset($data['description']) ? (string) $data['description'] : null,
            'postal_codes' => $this->encodeJsonArray($data['postal_codes'] ?? null),
            'boundary_geojson' => isset($data['boundary_geojson']) ? json_encode($data['boundary_geojson']) : null,
            'center_latitude' => $data['center_latitude'] ?? null,
            'center_longitude' => $data['center_longitude'] ?? null,
            'status' => (string) ($data['status'] ?? 'active'),
            'created_by' => $adminUserId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $this->get($id, $tenantId) ?? [];
    }

    public function update(int $id, int $tenantId, array $data): array
    {
        $this->assertAvailable();

        $payload = ['updated_at' => now()];

        foreach (['name', 'type', 'description', 'status', 'center_latitude', 'center_longitude'] as $field) {
            if (array_key_exists($field, $data)) {
                $payload[$field] = $data[$field] !== null ? $data[$field] : null;
            }
        }

        if (array_key_exists('slug', $data)) {
            $slug = $this->normaliseSlug($data['slug']);
            $this->assertSlugAvailable($tenantId, $slug, $id);
            $payload['slug'] = $slug;
        }

        if (array_key_exists('postal_codes', $data)) {
            $payload['postal_codes'] = $this->encodeJsonArray($data['postal_codes']);
        }

        if (array_key_exists('boundary_geojson', $data)) {
            $payload['boundary_geojson'] = $data['boundary_geojson'] !== null
                ? json_encode($data['boundary_geojson'])
                : null;
        }

        DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($payload);

        return $this->get($id, $tenantId) ?? [];
    }

    public function delete(int $id, int $tenantId): void
    {
        $this->assertAvailable();

        DB::transaction(function () use ($id, $tenantId) {
            if (Schema::hasTable('caring_care_providers') && Schema::hasColumn('caring_care_providers', 'sub_region_id')) {
                DB::table('caring_care_providers')
                    ->where('tenant_id', $tenantId)
                    ->where('sub_region_id', $id)
                    ->update(['sub_region_id' => null, 'updated_at' => now()]);
            }

            DB::table(self::TABLE)
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update(['status' => 'inactive', 'updated_at' => now()]);
        });
    }

    private function normaliseSlug(mixed $value): string
    {
        $slug = Str::slug((string) $value);

        if ($slug === '') {
            throw new RuntimeException(__('api.caring_sub_region_slug_invalid'));
        }

        return $slug;
    }

    private function assertSlugAvailable(int $tenantId, string $slug, ?int $ignoreId = null): void
    {
        $query = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('slug', $slug);

        if ($ignoreId !== null) {
            $query->where('id', '!=', $ignoreId);
        }

        if ($query->exists()) {
            throw new RuntimeException(__('api.caring_sub_region_slug_exists'));
        }
    }

    private function encodeJsonArray(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_string($value)) {
            $value = array_values(array_filter(array_map('trim', explode(',', $value))));
        }

        return json_encode(array_values((array) $value));
    }

    private function castRow(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'tenant_id' => (int) $row['tenant_id'],
            'name' => (string) $row['name'],
            'slug' => (string) $row['slug'],
            'type' => (string) $row['type'],
            'description' => isset($row['description']) ? (string) $row['description'] : null,
            'postal_codes' => isset($row['postal_codes']) ? json_decode((string) $row['postal_codes'], true) : null,
            'boundary_geojson' => isset($row['boundary_geojson']) ? json_decode((string) $row['boundary_geojson'], true) : null,
            'center_latitude' => isset($row['center_latitude']) ? (float) $row['center_latitude'] : null,
            'center_longitude' => isset($row['center_longitude']) ? (float) $row['center_longitude'] : null,
            'status' => (string) $row['status'],
            'created_by' => isset($row['created_by']) ? (int) $row['created_by'] : null,
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }
}
