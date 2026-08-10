// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Authorize]
public sealed class EventRegistrationLifecycleController : ControllerBase
{
    private readonly EventRegistrationLifecycleService _registrations;
    public EventRegistrationLifecycleController(EventRegistrationLifecycleService registrations) => _registrations = registrations;

    [HttpPost("api/events/{id:int}/registration/confirm")]
    [HttpPost("api/v2/events/{id:int}/registration/confirm")]
    public async Task<IActionResult> Confirm(int id, CancellationToken ct) => Respond(await _registrations.ConfirmAsync(TenantId(), id, UserId(), Key(), ct));

    [HttpPost("api/events/{id:int}/registration/withdraw")]
    [HttpPost("api/v2/events/{id:int}/registration/withdraw")]
    public async Task<IActionResult> Withdraw(int id, [FromBody] JsonElement body, CancellationToken ct) => Respond(await _registrations.WithdrawAsync(TenantId(), id, UserId(), Key(), Text(body, "reason"), ct));

    [HttpPost("api/events/{id:int}/registration/waitlist")]
    [HttpPost("api/v2/events/{id:int}/registration/waitlist")]
    public async Task<IActionResult> JoinWaitlist(int id, CancellationToken ct) => Respond(await _registrations.JoinWaitlistAsync(TenantId(), id, UserId(), Key(), ct));

    [HttpPost("api/events/{id:int}/registration/waitlist/leave")]
    [HttpPost("api/v2/events/{id:int}/registration/waitlist/leave")]
    public async Task<IActionResult> LeaveWaitlist(int id, [FromBody] JsonElement body, CancellationToken ct) => Respond(await _registrations.LeaveWaitlistAsync(TenantId(), id, UserId(), Key(), Text(body, "reason"), ct));

    [HttpPost("api/events/{id:int}/registration/waitlist/accept")]
    [HttpPost("api/v2/events/{id:int}/registration/waitlist/accept")]
    public async Task<IActionResult> AcceptOffer(int id, [FromBody] JsonElement body, CancellationToken ct) => Respond(await _registrations.AcceptOfferAsync(TenantId(), id, UserId(), Key(), Text(body, "token"), ct));

    private IActionResult Respond(EventRegistrationResult result) => result.Succeeded
        ? StatusCode(result.Status, new { success = true, data = result.Data })
        : StatusCode(result.Error!.Status, new { success = false, error = new { code = result.Error.Code, message = result.Error.Message, field = result.Error.Field } });
    private int TenantId() => User.GetTenantId() ?? throw new UnauthorizedAccessException("Invalid tenant claim");
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid user claim");
    private string Key() => Request.Headers["Idempotency-Key"].ToString();
    private static string? Text(JsonElement body, string name) => body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
