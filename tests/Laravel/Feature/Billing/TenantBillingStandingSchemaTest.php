<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * The payment standing record exists with the columns the lock and the
 * pause / restore service read and write.
 */
final class TenantBillingStandingSchemaTest extends TestCase
{
    public function test_table_has_the_columns_the_design_names(): void
    {
        $this->assertTrue(Schema::hasTable('tenant_billing_standing'));

        $columns = [
            'tenant_id', 'payer', 'paid_until', 'suspended_at', 'suspended_by_user_id',
            'suspension_source', 'suspension_note', 'exempt', 'exempt_reason',
            'exempt_by_user_id', 'exempt_at', 'last_notice_stage', 'last_notice_at',
        ];

        foreach ($columns as $column) {
            $this->assertTrue(Schema::hasColumn('tenant_billing_standing', $column), $column);
        }
    }
}
