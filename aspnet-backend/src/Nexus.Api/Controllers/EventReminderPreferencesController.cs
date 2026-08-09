// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController, Authorize]
public sealed class EventReminderPreferencesController(EventReminderPreferenceService reminders) : ControllerBase
{
    [HttpGet("api/events/{id:int}/reminders")]
    [HttpGet("api/v2/events/{id:int}/reminders")]
    public Task<IActionResult> Read(int id, CancellationToken ct) => Run(reminders.ReadAsync(Tenant(), id, UserId(), ct));

    [HttpPut("api/events/{id:int}/reminders")]
    [HttpPut("api/v2/events/{id:int}/reminders")]
    public Task<IActionResult> Replace(int id, [FromBody] JsonElement body, CancellationToken ct) => Run(reminders.ReplaceAsync(Tenant(), id, UserId(), body, ct));

    [HttpDelete("api/events/{id:int}/reminders")]
    [HttpDelete("api/v2/events/{id:int}/reminders")]
    public Task<IActionResult> Reset(int id, [FromQuery(Name = "expected_revision")] int expectedRevision, CancellationToken ct) => Run(reminders.ResetAsync(Tenant(), id, UserId(), expectedRevision, ct));

    private async Task<IActionResult> Run(Task<EventReminderPreferenceResult> task)
    {
        var result = await task; Response.Headers.CacheControl = "private, no-store"; Response.Headers.Pragma = "no-cache"; Response.Headers.Vary = "Authorization, Cookie, X-Tenant-ID";
        return result.Succeeded ? Ok(new { success = true, data = result.Data }) : StatusCode(result.Error!.Status, new { success = false, error = new { code = result.Error.Code, message = result.Error.Message, field = result.Error.Field } });
    }
    private int Tenant() => User.GetTenantId() ?? throw new UnauthorizedAccessException();
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException();
}
