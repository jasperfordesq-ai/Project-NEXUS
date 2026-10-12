<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Enterprise;

use Illuminate\Support\Facades\DB;
use PDO;
use App\Core\TenantContext;

/**
 * Permission Service - Enterprise PBAC System
 *
 * Implements Permission-Based Access Control (PBAC) for:
 * - SOC 2 Type II compliance
 * - ISO 27001 compliance
 * - HIPAA compliance (healthcare data)
 * - PCI-DSS compliance (financial data)
 * - GDPR Article 32 (security requirements)
 *
 * Features:
 * - Granular permission checking
 * - Role-based permissions
 * - Direct permission grants/revocations
 * - Permission inheritance
 * - Wildcard permissions (e.g., users.*)
 * - Resource-level permissions
 * - Audit logging
 * - Session caching for performance
 */
class PermissionService
{
    private array $cache = [];
    private bool $auditEnabled = true;
    private int $tenantId;

    public function __construct()
    {
        $this->tenantId = \App\Core\TenantContext::getId();
    }

    // Permission check results (for audit logging)
    const RESULT_GRANTED = 'granted';
    const RESULT_DENIED = 'denied';

    /**
     * Check if user has a specific permission
     *
     * @param int $userId User ID to check
     * @param string $permission Permission name (e.g., 'users.delete', 'gdpr.requests.approve')
     * @param mixed $resource Optional resource for resource-level checks
     * @param bool $logCheck Whether to log this permission check (for compliance)
     * @return bool True if user has permission
     */
    public function can(int $userId, string $permission, $resource = null, bool $logCheck = true): bool
    {
        // Super admins bypass all permission checks
        if ($this->isSuperAdmin($userId)) {
            if ($logCheck && $this->auditEnabled) {
                $this->logPermissionCheck($userId, $permission, true, $resource);
            }
            return true;
        }

        // Check cache first (session-based)
        $cacheKey = "perm_{$userId}_{$permission}";
        if (isset($_SESSION[$cacheKey])) {
            $result = $_SESSION[$cacheKey];
            if ($logCheck && $this->auditEnabled) {
                $this->logPermissionCheck($userId, $permission, $result, $resource);
            }
            return $result;
        }

        // 1. Check for direct permission revocation (overrides everything)
        if ($this->hasDirectRevocation($userId, $permission)) {
            $_SESSION[$cacheKey] = false;
            if ($logCheck && $this->auditEnabled) {
                $this->logPermissionCheck($userId, $permission, false, $resource);
            }
            return false;
        }

        // 2. Check for direct permission grant
        if ($this->hasDirectGrant($userId, $permission)) {
            $_SESSION[$cacheKey] = true;
            if ($logCheck && $this->auditEnabled) {
                $this->logPermissionCheck($userId, $permission, true, $resource);
            }
            return true;
        }

        // 3. Check role-based permissions
        if ($this->hasRolePermission($userId, $permission)) {
            $_SESSION[$cacheKey] = true;
            if ($logCheck && $this->auditEnabled) {
                $this->logPermissionCheck($userId, $permission, true, $resource);
            }
            return true;
        }

        // 4. Check wildcard permissions (e.g., 'users.*' grants 'users.delete')
        if ($this->hasWildcardPermission($userId, $permission)) {
            $_SESSION[$cacheKey] = true;
            if ($logCheck && $this->auditEnabled) {
                $this->logPermissionCheck($userId, $permission, true, $resource);
            }
            return true;
        }

        // 5. Resource-level check (if resource provided)
        if ($resource !== null && method_exists($resource, 'canBeAccessedBy')) {
            $result = $resource->canBeAccessedBy($userId, $permission);
            $_SESSION[$cacheKey] = $result;
            if ($logCheck && $this->auditEnabled) {
                $this->logPermissionCheck($userId, $permission, $result, $resource);
            }
            return $result;
        }

        // Default: deny
        $_SESSION[$cacheKey] = false;
        if ($logCheck && $this->auditEnabled) {
            $this->logPermissionCheck($userId, $permission, false, $resource);
        }
        return false;
    }

    /**
     * Check if user has ALL of the given permissions
     */
    public function canAll(int $userId, array $permissions): bool
    {
        foreach ($permissions as $permission) {
            if (!$this->can($userId, $permission, null, false)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Check if user has ANY of the given permissions
     */
    public function canAny(int $userId, array $permissions): bool
    {
        foreach ($permissions as $permission) {
            if ($this->can($userId, $permission, null, false)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get all permissions for a user (for UI display)
     */
    public function getUserPermissions(int $userId): array
    {
        $permissions = DB::statement("
            SELECT DISTINCT
                p.id,
                p.name,
                p.display_name,
                p.category,
                p.is_dangerous,
                CASE
                    WHEN up.id IS NOT NULL THEN 'direct'
                    WHEN rp.id IS NOT NULL THEN 'role'
                    ELSE 'inherited'
                END as source
            FROM permissions p
            LEFT JOIN user_permissions up ON p.id = up.permission_id
                AND up.user_id = ?
                AND up.granted = TRUE
                AND up.tenant_id = ?
                AND (up.expires_at IS NULL OR up.expires_at > NOW())
            LEFT JOIN user_roles ur ON ur.user_id = ?
                AND ur.tenant_id = ?
                AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
            LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id
                AND rp.permission_id = p.id
            WHERE (up.id IS NOT NULL OR rp.id IS NOT NULL)
            ORDER BY p.category, p.name
        ", [$userId, $this->tenantId, $userId, $this->tenantId])->fetchAll();

        return $permissions;
    }

    /**
     * Get all roles for a user
     */
    public function getUserRoles(int $userId): array
    {
        return DB::statement("
            SELECT
                r.id,
                r.name,
                r.display_name,
                r.description,
                r.level,
                r.is_system,
                ur.assigned_at,
                ur.expires_at,
                assignedBy.username as assigned_by_username
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            LEFT JOIN users assignedBy ON ur.assigned_by = assignedBy.id
            WHERE ur.user_id = ?
                AND ur.tenant_id = ?
                AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
            ORDER BY r.level DESC, r.name
        ", [$userId, $this->tenantId])->fetchAll();
    }

    /**
     * Assign a role to a user (with audit logging)
     */
    public function assignRole(int $userId, int $roleId, int $assignedBy, ?string $expiresAt = null): bool
    {
        try {
            // Check if already assigned
            $existing = DB::statement(
                "SELECT id FROM user_roles WHERE user_id = ? AND role_id = ? AND tenant_id = ?",
                [$userId, $roleId, $this->tenantId]
            )->fetch();

            if ($existing) {
                // Update expiration if different
                if ($expiresAt) {
                    DB::statement(
                        "UPDATE user_roles SET expires_at = ? WHERE id = ? AND tenant_id = ?",
                        [$expiresAt, $existing['id'], $this->tenantId]
                    );
                }
                $this->clearUserPermissionCache($userId);
                return true;
            }

            // Insert new role assignment
            DB::statement(
                "INSERT INTO user_roles (user_id, role_id, assigned_by, expires_at, tenant_id)
                 VALUES (?, ?, ?, ?, ?)",
                [$userId, $roleId, $assignedBy, $expiresAt, $this->tenantId]
            );

            // Audit log
            $this->logAuditEvent('role_assigned', $userId, $assignedBy, $roleId, null, [
                'expires_at' => $expiresAt
            ]);

            $this->clearUserPermissionCache($userId);
            return true;

        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to assign role: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Revoke a role from a user
     */
    public function revokeRole(int $userId, int $roleId, int $revokedBy): bool
    {
        try {
            DB::statement(
                "DELETE FROM user_roles WHERE user_id = ? AND role_id = ? AND tenant_id = ?",
                [$userId, $roleId, $this->tenantId]
            );

            // Audit log
            $this->logAuditEvent('role_revoked', $userId, $revokedBy, $roleId);

            $this->clearUserPermissionCache($userId);
            return true;

        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to revoke role: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Grant a direct permission to a user
     */
    public function grantPermission(int $userId, int $permissionId, int $grantedBy, ?string $reason = null, ?string $expiresAt = null): bool
    {
        try {
            DB::statement(
                "INSERT INTO user_permissions (user_id, permission_id, granted, granted_by, reason, expires_at, tenant_id)
                 VALUES (?, ?, TRUE, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    granted = TRUE,
                    granted_by = VALUES(granted_by),
                    reason = VALUES(reason),
                    expires_at = VALUES(expires_at),
                    granted_at = CURRENT_TIMESTAMP",
                [$userId, $permissionId, $grantedBy, $reason, $expiresAt, $this->tenantId]
            );

            // Audit log
            $this->logAuditEvent('permission_granted', $userId, $grantedBy, null, $permissionId, [
                'reason' => $reason,
                'expires_at' => $expiresAt
            ]);

            $this->clearUserPermissionCache($userId);
            return true;

        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to grant permission: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Revoke a direct permission from a user
     */
    public function revokePermission(int $userId, int $permissionId, int $revokedBy, ?string $reason = null): bool
    {
        try {
            DB::statement(
                "INSERT INTO user_permissions (user_id, permission_id, granted, granted_by, reason, tenant_id)
                 VALUES (?, ?, FALSE, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    granted = FALSE,
                    granted_by = VALUES(granted_by),
                    reason = VALUES(reason),
                    granted_at = CURRENT_TIMESTAMP",
                [$userId, $permissionId, $revokedBy, $reason, $this->tenantId]
            );

            // Audit log
            $this->logAuditEvent('permission_revoked', $userId, $revokedBy, null, $permissionId, [
                'reason' => $reason
            ]);

            $this->clearUserPermissionCache($userId);
            return true;

        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to revoke permission: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Check if user is a PLATFORM super admin — the only tier that bypasses
     * every permission check.
     *
     * 🔴 A tenant super admin is deliberately NOT included (E-103, 12 Oct 2026):
     * its reach is its own community and the communities beneath it, so it can
     * never hold "every permission". This used to accept is_tenant_super_admin
     * from the session and from the users row.
     */
    private function isSuperAdmin(int $userId): bool
    {
        // Check session first for performance
        if (isset($_SESSION['user_id']) && $_SESSION['user_id'] == $userId
            && (!empty($_SESSION['is_super_admin']) || !empty($_SESSION['is_god']))) {
            return true;
        }

        // Check database
        $result = DB::statement("
            SELECT is_super_admin, is_god, role
            FROM users
            WHERE id = ?
            LIMIT 1
        ", [$userId])->fetch();

        return !empty($result['is_super_admin'])
            || !empty($result['is_god'])
            || in_array($result['role'] ?? '', ['super_admin', 'god'], true);
    }

    /**
     * Check if user has a direct permission revocation
     */
    private function hasDirectRevocation(int $userId, string $permission): bool
    {
        $result = DB::statement("
            SELECT 1
            FROM user_permissions up
            JOIN permissions p ON up.permission_id = p.id
            WHERE up.user_id = ?
                AND p.name = ?
                AND up.granted = FALSE
                AND up.tenant_id = ?
                AND (up.expires_at IS NULL OR up.expires_at > NOW())
            LIMIT 1
        ", [$userId, $permission, $this->tenantId])->fetch();

        return !empty($result);
    }

    /**
     * Check if user has a direct permission grant
     */
    private function hasDirectGrant(int $userId, string $permission): bool
    {
        $result = DB::statement("
            SELECT 1
            FROM user_permissions up
            JOIN permissions p ON up.permission_id = p.id
            WHERE up.user_id = ?
                AND p.name = ?
                AND up.granted = TRUE
                AND up.tenant_id = ?
                AND (up.expires_at IS NULL OR up.expires_at > NOW())
            LIMIT 1
        ", [$userId, $permission, $this->tenantId])->fetch();

        return !empty($result);
    }

    /**
     * Check if user has permission through their roles
     */
    private function hasRolePermission(int $userId, string $permission): bool
    {
        $result = DB::statement("
            SELECT 1
            FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = ?
                AND p.name = ?
                AND ur.tenant_id = ?
                AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
            LIMIT 1
        ", [$userId, $permission, $this->tenantId])->fetch();

        return !empty($result);
    }

    /**
     * Check wildcard permissions (e.g., 'users.*' grants 'users.delete')
     */
    private function hasWildcardPermission(int $userId, string $permission): bool
    {
        $parts = explode('.', $permission);

        // Try each level of wildcard (e.g., 'users.profile.*', 'users.*')
        for ($i = count($parts) - 1; $i > 0; $i--) {
            $wildcard = implode('.', array_slice($parts, 0, $i)) . '.*';

            // Check direct grant
            if ($this->hasDirectGrant($userId, $wildcard)) {
                return true;
            }

            // Check role-based grant
            if ($this->hasRolePermission($userId, $wildcard)) {
                return true;
            }
        }

        // Check global wildcard '*'
        return $this->hasDirectGrant($userId, '*') || $this->hasRolePermission($userId, '*');
    }

    /**
     * Log permission check for compliance/audit
     */
    private function logPermissionCheck(int $userId, string $permission, bool $granted, $resource = null): void
    {
        try {
            $resourceType = $resource ? get_class($resource) : null;
            $resourceId = $resource && isset($resource->id) ? $resource->id : null;

            DB::statement("
                INSERT INTO permission_audit_log
                (event_type, user_id, permission_name, result, resource_type, resource_id, ip_address, user_agent)
                VALUES ('permission_checked', ?, ?, ?, ?, ?, ?, ?)
            ", [
                $userId,
                $permission,
                $granted ? self::RESULT_GRANTED : self::RESULT_DENIED,
                $resourceType,
                $resourceId,
                \App\Core\ClientIp::get(),
                $_SERVER['HTTP_USER_AGENT'] ?? null
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to log permission check: " . $e->getMessage());
        }
    }

    /**
     * Log audit event (role assignments, permission grants, etc.)
     */
    private function logAuditEvent(
        string $eventType,
        int $userId,
        ?int $actorId = null,
        ?int $roleId = null,
        ?int $permissionId = null,
        ?array $metadata = null
    ): void {
        try {
            DB::statement("
                INSERT INTO permission_audit_log
                (event_type, user_id, actor_id, role_id, permission_id, ip_address, user_agent, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ", [
                $eventType,
                $userId,
                $actorId,
                $roleId,
                $permissionId,
                \App\Core\ClientIp::get(),
                $_SERVER['HTTP_USER_AGENT'] ?? null,
                $metadata ? json_encode($metadata) : null
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to log audit event: " . $e->getMessage());
        }
    }

    /**
     * Clear permission cache for a user
     */
    public function clearUserPermissionCache(int $userId): void
    {
        // Clear session cache (only if session exists - CLI safe)
        if (isset($_SESSION) && is_array($_SESSION)) {
            foreach (array_keys($_SESSION) as $key) {
                if (str_starts_with($key, "perm_{$userId}_")) {
                    unset($_SESSION[$key]);
                }
            }
        }

        // Update cache invalidation timestamp
        DB::statement(
            "UPDATE users SET permissions_last_updated = NOW() WHERE id = ? AND tenant_id = ?",
            [$userId, TenantContext::getId()]
        );
    }

    /**
     * Get permission by name
     */
    public function getPermissionByName(string $name): ?array
    {
        $result = DB::statement(
            "SELECT * FROM permissions WHERE name = ? LIMIT 1",
            [$name]
        )->fetch();

        return $result ?: null;
    }

    /**
     * Get all permissions grouped by category
     */
    public function getAllPermissions(): array
    {
        $permissions = DB::statement("
            SELECT * FROM permissions
            WHERE (tenant_id = ? OR tenant_id IS NULL)
            ORDER BY category, name
        ", [$this->tenantId])->fetchAll();

        $grouped = [];
        foreach ($permissions as $perm) {
            $grouped[$perm['category']][] = $perm;
        }

        return $grouped;
    }

    /**
     * Create a new role (tenant-scoped)
     */
    public function createRole(string $name, string $displayName, string $description, int $level = 0, bool $isSystem = false): ?int
    {
        try {
            DB::statement(
                "INSERT INTO roles (name, display_name, description, level, is_system, tenant_id)
                 VALUES (?, ?, ?, ?, ?, ?)",
                [$name, $displayName, $description, $level, $isSystem, $this->tenantId]
            );

            return (int) DB::getPdo()->lastInsertId();
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to create role: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Attach permissions to a role (tenant-scoped)
     */
    public function attachPermissionsToRole(int $roleId, array $permissionIds, int $grantedBy): bool
    {
        try {
            foreach ($permissionIds as $permissionId) {
                DB::statement(
                    "INSERT IGNORE INTO role_permissions (role_id, permission_id, granted_by, tenant_id)
                     VALUES (?, ?, ?, ?)",
                    [$roleId, $permissionId, $grantedBy, $this->tenantId]
                );
            }
            return true;
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to attach permissions to role: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Get all roles
     */
    public function getAllRoles(): array
    {
        return DB::statement("
            SELECT
                r.*,
                COUNT(DISTINCT rp.permission_id) as permission_count,
                COUNT(DISTINCT ur.user_id) as user_count
            FROM roles r
            LEFT JOIN role_permissions rp ON r.id = rp.role_id
            LEFT JOIN user_roles ur ON r.id = ur.role_id
                AND ur.tenant_id = ?
                AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
            WHERE r.tenant_id = ?
            GROUP BY r.id
            ORDER BY r.level DESC, r.name
        ", [$this->tenantId, $this->tenantId])->fetchAll();
    }

    /**
     * Disable audit logging (for bulk operations)
     */
    public function disableAudit(): void
    {
        $this->auditEnabled = false;
    }

    /**
     * Enable audit logging
     */
    public function enableAudit(): void
    {
        $this->auditEnabled = true;
    }
}
