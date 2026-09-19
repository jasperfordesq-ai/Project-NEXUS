// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { registrationSettingsDraft as draft, registrationSettingsPayload as payload } from './eventRegistrationSettingsDraft';
import type { OrganizerRegistrationSettings } from './api/eventRegistration';
const start='2030-07-20T09:00:00Z';
it('converts event-zone input independently of the device timezone',()=>{
 const form={...draft(null,'Europe/Dublin'),opens:'2030-07-01 10:00',closes:'2030-07-20 10:00'};
 expect(payload(form,null,'Europe/Dublin',start)).toMatchObject({opens_at_utc:'2030-07-01T09:00:00.000Z',closes_at_utc:'2030-07-20T09:00:00.000Z'});
});
it.each(['2030-03-31 01:30','2030-10-27 01:30','2030-02-30 10:00'])('rejects nonexistent or ambiguous date %s', opens=>{
 expect(payload({...draft(null,'Europe/Dublin'),opens,closes:'2030-12-01 10:00'},null,'Europe/Dublin','2031-01-01T00:00:00Z')).toBeNull();
});
it('preserves unchanged instants with seconds during an overlap',()=>{
 const settings={id:1,event_id:42,revision:1,status:'draft',approval_mode:'auto',form_state:'none',published_form_version:null,
 per_member_limit:1,guests_enabled:false,max_guests_per_registration:0,guest_retention_days:30,
 opens_at_utc:'2030-10-27T01:30:15Z',closes_at_utc:'2030-10-28T10:00:17Z',cancellation_cutoff_at_utc:null,event_timezone_snapshot:'Europe/Dublin'} satisfies OrganizerRegistrationSettings;
 expect(payload(draft(settings,'Europe/Dublin'),settings,'Europe/Dublin','2031-01-01T00:00:00Z')?.opens_at_utc).toBe(settings.opens_at_utc);
 expect(payload({...draft(settings,'Europe/Dublin'),opens:'',closes:''},settings,'Europe/Dublin','2031-01-01T00:00:00Z')).toMatchObject({opens_at_utc:null,closes_at_utc:null});
});
it.each([{memberLimit:'1e1'},{memberLimit:'1.5'},{retentionDays:'0'},{closes:'2030-07-20 11:00',opens:'2030-07-01 10:00'}])('rejects invalid policy %j', patch=>{
 expect(payload({...draft(null,'Europe/Dublin'),...patch},null,'Europe/Dublin',start)).toBeNull();
});
it('preserves the rejected request instant when the current policy has a different value',()=>{
 const recovered={approval_mode:'auto' as const,per_member_limit:1,guests_enabled:false,max_guests_per_registration:0,guest_retention_days:30,expected_revision:1,
 opens_at_utc:'2030-10-27T01:30:15Z',closes_at_utc:'2030-10-28T10:00:17Z',cancellation_cutoff_at_utc:null};
 const form={...draft(null,'Europe/Dublin'),opens:'2030-10-27T01:30',closes:'2030-10-28T10:00'};
 expect(payload(form,null,'Europe/Dublin','2031-01-01T00:00:00Z',recovered)).toMatchObject({opens_at_utc:recovered.opens_at_utc,closes_at_utc:recovered.closes_at_utc});
});
