// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController, Authorize]
public sealed class EventCalendarParityController : ControllerBase
{
    private readonly EventCalendarParityService _calendar; public EventCalendarParityController(EventCalendarParityService calendar)=>_calendar=calendar;
    [HttpGet("api/events/calendar"),HttpGet("api/v2/events/calendar")]
    public async Task<IActionResult> Index([FromQuery]string? from,[FromQuery(Name="to")]string? until,CancellationToken ct){if(!Range(from,until,out var a,out var b))return Json(new(null,Error:new("EVENT_CALENDAR_RANGE_INVALID","Invalid range",422,"from")));return Json(await _calendar.CalendarAsync(Tenant(),UserId(),a,b,Base(),ct));}
    [HttpGet("api/events/{id:int}/calendar-actions"),HttpGet("api/v2/events/{id:int}/calendar-actions")]
    public async Task<IActionResult> Actions(int id,CancellationToken ct){var r=await _calendar.EventAsync(Tenant(),UserId(),id,Base(),ct);return r.Succeeded?Json(new(r.Data is null?null:_calendar.Actions((dynamic)r.Data))):Json(r);}
    [HttpGet("api/events/calendar/feed-tokens"),HttpGet("api/v2/events/calendar/feed-tokens")]
    public async Task<IActionResult> Tokens(CancellationToken ct)=>Json(await _calendar.TokensAsync(Tenant(),UserId(),ct),true);
    [HttpPost("api/events/calendar/feed-tokens"),HttpPost("api/v2/events/calendar/feed-tokens")]
    public async Task<IActionResult> Create([FromBody]System.Text.Json.JsonElement body,CancellationToken ct)=>Json(await _calendar.CreateTokenAsync(Tenant(),UserId(),body.TryGetProperty("label",out var p)&&p.ValueKind==System.Text.Json.JsonValueKind.String?p.GetString():null,Base(),ct),true);
    [HttpDelete("api/events/calendar/feed-tokens/{tokenId:long}"),HttpDelete("api/v2/events/calendar/feed-tokens/{tokenId:long}")]
    public async Task<IActionResult> Revoke(long tokenId,CancellationToken ct)=>Json(await _calendar.RevokeAsync(Tenant(),UserId(),tokenId,ct),true);
    [HttpGet("api/events/{id:int}/calendar.ics"),HttpGet("api/v2/events/{id:int}/calendar.ics")]
    public async Task<IActionResult> EventFeed(int id,CancellationToken ct){var r=await _calendar.EventFeedAsync(Tenant(),UserId(),id,Base(),ct);return r.Error is null?Ics(r.Ics!, $"event-{id}.ics"):Error(r.Error);}
    [HttpGet("api/events/calendar/feed.ics"),HttpGet("api/v2/events/calendar/feed.ics")]
    public async Task<IActionResult> TenantFeed([FromQuery]string? from,[FromQuery(Name="to")]string? until,CancellationToken ct){if(!Range(from,until,out var a,out var b))return Error(new("EVENT_CALENDAR_RANGE_INVALID","Invalid range",422,"from"));var r=await _calendar.TenantFeedAsync(Tenant(),UserId(),a,b,Base(),ct);return r.Error is null?Ics(r.Ics!,"events.ics"):Error(r.Error);}
    [AllowAnonymous]
    [HttpGet("api/events/calendar/personal/{tenantSlug}/{secret}.ics")]
    [HttpGet("api/v2/events/calendar/personal/{tenantSlug}/{secret}.ics")]
    public async Task<IActionResult> Personal(string tenantSlug,[FromRoute]string secret,CancellationToken ct){var r=await _calendar.PersonalFeedAsync(tenantSlug,secret,Base(),ct);return r.Error is null?Ics(r.Ics!,"my-events.ics"):Error(r.Error);}
    private IActionResult Json(EventCalendarResult r,bool sensitive=false){if(sensitive){Response.Headers.CacheControl="private, no-store, max-age=0";Response.Headers.Pragma="no-cache";Response.Headers["Referrer-Policy"]="no-referrer";}return r.Succeeded?r.Meta is null?StatusCode(r.Status,new{success=true,data=r.Data}):StatusCode(r.Status,new{success=true,data=r.Data,meta=r.Meta}):Error(r.Error!);}private IActionResult Error(EventCalendarError e){if(e.Code=="EVENT_CALENDAR_FEED_NOT_FOUND"){Response.Headers.CacheControl="private, no-store, max-age=0";Response.Headers["Referrer-Policy"]="no-referrer";}return StatusCode(e.Status,new{success=false,error=new{code=e.Code,message=e.Message,field=e.Field}});}private IActionResult Ics(string body,string filename){Response.Headers.CacheControl="private, no-store, max-age=0";Response.Headers.Pragma="no-cache";Response.Headers["Referrer-Policy"]="no-referrer";Response.Headers["X-Content-Type-Options"]="nosniff";Response.Headers["X-Robots-Tag"]="noindex, nofollow";return File(System.Text.Encoding.UTF8.GetBytes(body),"text/calendar; charset=utf-8",filename);}private int Tenant()=>User.GetTenantId()??throw new UnauthorizedAccessException();private int UserId()=>User.GetUserId()??throw new UnauthorizedAccessException();private string Base()=>Request.Scheme+"://"+Request.Host.Value;private static bool Range(string? from,string? to,out DateOnly a,out DateOnly b){a=default;b=default;if(from is null&&to is null){var today=DateOnly.FromDateTime(DateTime.UtcNow);a=new(today.Year,today.Month,1);b=a.AddMonths(1);return true;}return from is not null&&to is not null&&DateOnly.TryParseExact(from,"yyyy-MM-dd",out a)&&DateOnly.TryParseExact(to,"yyyy-MM-dd",out b);}
}
