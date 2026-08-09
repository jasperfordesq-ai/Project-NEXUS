# Tenant And Community Administrator Guide

Last reviewed: 2026-07-15

Status: **Maintained administrator reference - not a platform-operator runbook**

This guide is for people administering one Project NEXUS tenant or community.
It does not authorize production-server, container, database, provider, or
cross-tenant operations. Platform operations are documented separately under
[system operations](../system/OPERATIONS.md).

## Role Boundaries

Project NEXUS distinguishes ordinary members, tenant/community administrators,
tenant super-administrators, and platform super-administrators. A route or menu
item does not grant authority. The backend's current authorization policy and
the tenant's governance decision are authoritative.

- **Tenant administrators** manage only permitted data and workflows for their
  own tenant.
- **Tenant super-administrators** may receive additional tenant-level settings
  or role-management powers.
- **Platform super-administrators** can perform explicitly protected
  cross-tenant/platform operations. Do not assign or emulate this role to work
  around a tenant permission.

The standalone app under `apps/admin` was retired and deleted on 2026-08-09,
along with its production containers and its `admin.project-nexus.net` proxy.
Administration now happens through the canonical React frontend in the staging
repository. Laravel and that canonical client remain the production behavior and
contract source.

## Administrator Responsibilities

| Area | Typical tasks | Required caution |
| --- | --- | --- |
| Membership and registration | Review eligible registrations, activate/suspend members, and manage permitted roles. | Verify tenant and identity; preserve least privilege and an audit reason. |
| Tenant settings and modules | Configure community details, registration policy, feature switches, categories, and communication preferences. | A disabled module must remain fail-closed; record consequential changes. |
| Content and moderation | Review listings, feed content, groups, events, resources, comments, reports, and legal/CMS content. | Preserve evidence and distinguish hide, reject, archive, and delete actions. |
| Safety and safeguarding | Triage reports, restrictions, vetting/attestation, escalation, or broker/coordinator workflows. | Follow local safeguarding policy; avoid copying sensitive evidence into general notes. |
| Organisations and volunteering | Review organisations, opportunities, applications, hours, and expenses where enabled. | Approval can create ledger, notification, or certificate side effects. |
| Financial/provider workflows | Review marketplace, billing, donations, refunds, disputes, or provider state where enabled. | Never repeat a provider or ledger action casually; use its idempotency/reference evidence. |
| Audit and support | Inspect authorized audit/history views, diagnose user-visible failures, and route incidents. | Do not expose secrets or another tenant's data in support material. |

## Safe Administrative Change

Before a destructive, financial, role, access, or safeguarding decision:

1. confirm the tenant and subject;
2. confirm your role authorizes the action;
3. review current state and dependent effects;
4. record the reason and required evidence;
5. use the intended confirmation/idempotency control; and
6. verify the final state once without repeating the action.

Never edit the database directly to resolve an application workflow. Escalate a
software defect through [SUPPORT.md](../../SUPPORT.md) and a vulnerability
through [SECURITY.md](../../SECURITY.md). Production or data-recovery work needs
separate explicit authorization and the current operator runbook.

## Maintainer References

- [Admin module map](../MODULES.md)
- [Registration policy engine](../REGISTRATION_POLICY_ENGINE.md)
- [API consumer guide](../api/README.md)
- [Security and tenancy architecture](../system/SECURITY_AND_TENANCY.md)
- [Current ASP.NET contract status](../CURRENT_ASPNET_CONTRACT_STATUS.md)
