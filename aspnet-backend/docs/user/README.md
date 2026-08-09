# Project NEXUS User Guide

Last reviewed: 2026-07-15

Status: **Maintained user reference - not a product-readiness certificate**

This guide explains the shared Project NEXUS product concepts that members may
encounter. It is intentionally backend-neutral. Your community may use a
different name, domain, enabled-module set, registration policy, or navigation
layout.

Laravel and its canonical React client remain the production behavior source of
truth. The ASP.NET backend and the Web UK implementation in this repository are
experimental and are not certified as drop-in production replacements. A
feature appearing in this guide does not prove that the ASP.NET edition or Web
UK has completed that feature.

## Choose A Guide

| Guide | Use it for |
| --- | --- |
| [Getting started](GETTING_STARTED.md) | Joining a community, signing in, onboarding, and understanding tenant-specific availability. |
| [Community features](COMMUNITY_FEATURES.md) | Listings, exchanges, time credits, groups, events, volunteering, messaging, learning, and optional modules. |
| [Account, security, and privacy](ACCOUNT_SECURITY_PRIVACY.md) | Passwords, two-factor authentication, passkeys, blocking/reporting, data export, and account deletion. |
| [Accessibility, language, and support](ACCESSIBILITY_LANGUAGE_SUPPORT.md) | The accessible service, language choice, known evidence limits, and how to report a problem. |
| [Administrator guide](../admin/README.md) | Tenant/community administration rather than ordinary member tasks. |

## Which Surface Am I Using?

| Surface | Current status | What that means for users |
| --- | --- | --- |
| Canonical React with Laravel | Production source-of-truth product | Follow the link supplied by your community. Labels and available modules are tenant-specific. |
| Laravel Blade accessible service | Current accessible browser-experience source | Use the `/accessible` address supplied by your community. |
| Shared Web UK in `apps/web-uk` | Experimental, Laravel-first implementation | It is still under source and manual-accessibility verification. It must not be presented as certified merely because a page exists. |
| ASP.NET API | Experimental second backend | It is being made contract-correct but is not a certified replacement for Laravel. |
| Standalone .NET admin app | Secondary administration surface | Its route presence does not certify a complete admin workflow. |

The legacy `/alpha` accessible address is redirect compatibility only. The
canonical accessible mount is `/{tenantSlug}/accessible`.

## Feature Availability

Project NEXUS is multi-tenant: each community has its own members, policies,
roles, feature switches, and content. A feature can be unavailable because it
is disabled for your community, restricted to a role, awaiting approval, or not
implemented on the edition you are viewing. Do not work around an unavailable
feature by changing the URL or using another community's identifier.

## Getting Help Safely

Use your community's in-product Help Centre, Knowledge Base, Contact, Trust and
Safety, or Report a Problem links when available. Include the page address,
community name, the task you attempted, and the error shown. Do not include a
password, access token, passkey data, identity document, private message, or
another person's personal information in a public issue.

Repository maintainers can diagnose software defects, but only a tenant or
community administrator can decide membership, moderation, safeguarding, or
local-policy questions.
