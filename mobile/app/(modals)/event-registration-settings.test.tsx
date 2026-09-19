// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { AppState } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import Editor from '@/components/events/EventRegistrationSettingsEditor';
let mockId: string | string[] | undefined='42';
let mockFocused=true;
let mockUserId=7;
let mockState:any;
let mockOperation:any;
const mockUseOperation=jest.fn();
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:mockId})}));
jest.mock('@react-navigation/native',()=>({useIsFocused:()=>mockFocused}));
jest.mock('@/lib/hooks/useAuth',()=>({useAuth:()=>({user:{id:mockUserId}})}));
jest.mock('@/lib/hooks/useTenant',()=>({useTenant:()=>({tenant:{id:2}})}));
jest.mock('@/lib/hooks/useApi',()=>({useApi:()=>mockState}));
jest.mock('@/lib/hooks/useRegistrationSettingsOperations',()=>({useRegistrationSettingsOperations:(scope:unknown,allowed:boolean,accepted:unknown)=>{mockUseOperation(scope,allowed,accepted);return {...mockOperation,blocked:mockOperation.blocked||!allowed};}}));
jest.mock('@/components/events/EventRegistrationSettingsEditor',()=>({__esModule:true,default:()=>null}));
jest.mock('@/components/ui/AppTopBar',()=> 'View');
jest.mock('@/components/ModalErrorBoundary',()=>({children}:{children:React.ReactNode})=>children);
jest.mock('@/components/withRouteGate',()=>({withRouteGate:(screen:unknown)=>screen}));
jest.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
import Screen from './event-registration-settings';
const settings={id:1,event_id:42,revision:3,status:'draft',approval_mode:'auto',form_state:'none',published_form_version:null,per_member_limit:1,guests_enabled:false,max_guests_per_registration:0,guest_retention_days:30,opens_at_utc:null,closes_at_utc:null,cancellation_cutoff_at_utc:null,event_timezone_snapshot:'UTC'};
beforeEach(()=>{
 jest.clearAllMocks();mockId='42';mockFocused=true;mockUserId=7;Object.defineProperty(AppState,'currentState',{value:'active',configurable:true,writable:true});
 mockState={data:{event:{permissions:{manage_registration:true},schedule:{timezone:'UTC',start_at:'2030-01-01T00:00:00Z'}},settings},isLoading:false,error:null,errorStatus:null,refresh:jest.fn()};
 mockOperation={saved:null,blocked:false,busy:false,storageFailed:false,operationFailed:false,submit:jest.fn().mockResolvedValue(undefined),review:jest.fn().mockResolvedValue(undefined),reload:jest.fn().mockResolvedValue(undefined)};
});
it.each([undefined,'0','1.5','01',['42']])('rejects malformed route %s',id=>{
 mockId=id;const v=render(<Screen/>);expect(v.UNSAFE_queryByType(Editor)).toBeNull();expect(mockUseOperation).not.toHaveBeenCalled();
});
it('passes policy, event timezone and owner identity to the editor',()=>{
 const v=render(<Screen/>);expect(v.UNSAFE_getByType(Editor).props).toMatchObject({settings,timezone:'UTC',blocked:false});
 expect(mockUseOperation).toHaveBeenCalledWith({tenantId:2,userId:7,eventId:42},true,expect.any(Function));
});
it('disables writes when unfocused and clears the editor when permission is revoked',()=>{
 const v=render(<Screen/>);mockFocused=false;v.rerender(<Screen/>);expect(v.UNSAFE_getByType(Editor).props.blocked).toBe(true);
 mockState={...mockState,data:{...mockState.data,event:{...mockState.data.event,permissions:{manage_registration:false}}}};
 v.rerender(<Screen/>);expect(v.UNSAFE_queryByType(Editor)).toBeNull();
});
it('restores a reviewed draft without submitting it automatically',()=>{
 mockOperation.saved={status:'review',key:'original',settings:{...settings,revision:5},schedule:{timezone:'Europe/Dublin',start_at:'2031-01-01T00:00:00Z'},intent:{action:'save',input:{...settings,per_member_limit:4,expected_revision:3}}};
 const v=render(<Screen/>);expect(v.UNSAFE_getByType(Editor).props).toMatchObject({settings:{revision:5},recoveredDraft:{memberLimit:'4'},recoveredInput:{expected_revision:3}});
 expect(mockOperation.submit).not.toHaveBeenCalled();
});
it('requires an explicit press to review a rejected request',()=>{
 mockOperation.saved={status:'rejected'};mockOperation.blocked=true;const v=render(<Screen/>);
 expect(mockOperation.review).not.toHaveBeenCalled();fireEvent.press(v.getByText('registrationSettings.review'));expect(mockOperation.review).toHaveBeenCalledTimes(1);
});
it('replaces the policy base when the signed-in account changes',()=>{
 const v=render(<Screen/>);mockUserId=8;mockState={...mockState,data:{...mockState.data,settings:{...settings,revision:8}}};v.rerender(<Screen/>);
 expect(v.UNSAFE_getByType(Editor).props.settings.revision).toBe(8);
});
