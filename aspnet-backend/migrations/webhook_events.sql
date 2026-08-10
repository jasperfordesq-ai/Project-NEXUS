-- Create webhook_events table for CRM volunteering webhook integration
CREATE TABLE IF NOT EXISTS webhook_events (
    "Id" SERIAL PRIMARY KEY,
    "TenantId" INTEGER NOT NULL,
    "EventType" VARCHAR(100) NOT NULL,
    "Source" VARCHAR(50) NOT NULL DEFAULT 'php-platform',
    "PayloadJson" TEXT NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'processed',
    "ErrorMessage" TEXT,
    "ReceivedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT "FK_webhook_events_tenants_TenantId" FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "IX_webhook_events_EventType" ON webhook_events ("EventType");
CREATE INDEX IF NOT EXISTS "IX_webhook_events_ReceivedAt" ON webhook_events ("ReceivedAt");
CREATE INDEX IF NOT EXISTS "IX_webhook_events_Status" ON webhook_events ("Status");
CREATE INDEX IF NOT EXISTS "IX_webhook_events_TenantId" ON webhook_events ("TenantId");

-- Also record this in the EF migrations history so it doesn't try to re-apply
INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260317100015_AddWebhookEvents', '8.0.11')
ON CONFLICT DO NOTHING;
