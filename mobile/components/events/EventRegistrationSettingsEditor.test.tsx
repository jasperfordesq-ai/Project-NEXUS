// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import Editor from './EventRegistrationSettingsEditor';
import { Button } from '@/components/ui/NativeButton';
import type { OrganizerRegistrationSettings } from '@/lib/api/eventRegistration';
const mockConfirm=jest.fn();
jest.mock('@/components/ui/useConfirm',()=>({useConfirm:()=>({confirm:mockConfirm,confirmDialog:null})}));
jest.mock('@/lib/hooks/useUnsavedChangesGuard',()=>({useUnsavedChangesGuard:jest.fn()}));
jest.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string,options?:{value?:string})=>options?.value ? `${key}: ${options.value}` : key})}));
jest.mock('@/components/ui/Input',()=>({__esModule:true,default:(props:object)=>{const {TextInput}=require('react-native');return <TextInput {...props}/>;}}));
jest.mock('@/components/ui/ChoiceChips',()=>({__esModule:true,default:()=>null}));
jest.mock('@/components/ui/NativeButton',()=>({Button:({children,isDisabled,onPress}:any)=>{const {Pressable,Text}=require('react-native');return <Pressable accessibilityRole="button" accessibilityState={{disabled:isDisabled}} disabled={isDisabled} onPress={onPress}><Text>{children}</Text></Pressable>;}}));
const settings:OrganizerRegistrationSettings={id:1,event_id:42,revision:3,status:'draft',approval_mode:'auto',form_state:'none',published_form_version:null,
per_member_limit:1,guests_enabled:false,max_guests_per_registration:0,guest_retention_days:30,opens_at_utc:null,closes_at_utc:null,cancellation_cutoff_at_utc:null,event_timezone_snapshot:'UTC'};
function props(){return {settings,timezone:'UTC',eventStart:'2030-01-01T00:00:00Z',blocked:false,onSave:jest.fn().mockResolvedValue(undefined),onPublish:jest.fn().mockResolvedValue(undefined)};}
beforeEach(()=>jest.clearAllMocks());
it('preserves edits after failed save and submits the current revision',async()=>{
 const p=props();p.onSave.mockRejectedValue(new Error('Lost'));const v=render(<Editor {...p}/>);
 fireEvent.changeText(v.getByLabelText('registrationSettings.per_member_limit'),'2');
 fireEvent.press(v.getByText('registrationSettings.save'));
 await waitFor(()=>expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({expected_revision:3,per_member_limit:2})));
 expect(v.getByLabelText('registrationSettings.per_member_limit').props.value).toBe('2');
});
it('does not publish unsaved edits',()=>{
 const p=props();const v=render(<Editor {...p}/>);
 fireEvent.changeText(v.getByLabelText('registrationSettings.per_member_limit'),'2');
 fireEvent.press(v.getByText('registrationSettings.publish'));
 expect(p.onPublish).not.toHaveBeenCalled();expect(mockConfirm).not.toHaveBeenCalled();
});
it('confirms published-policy changes before dispatch',async()=>{
 const p={...props(),settings:{...settings,status:'published' as const}};const v=render(<Editor {...p}/>);
 fireEvent.press(v.getByText('registrationSettings.save'));expect(p.onSave).not.toHaveBeenCalled();
 await act(async()=>mockConfirm.mock.calls[0][0].onConfirm());expect(p.onSave).toHaveBeenCalledTimes(1);
});
it.each(['unmount','blocked','edit'] as const)('ignores retained confirmation after %s',async mode=>{
 const p=props();const v=render(<Editor {...p}/>);fireEvent.press(v.getByText('registrationSettings.publish'));
 const confirm=mockConfirm.mock.calls[0][0].onConfirm;
 if(mode==='unmount')v.unmount();else if(mode==='blocked')v.rerender(<Editor {...p} blocked/>);else fireEvent.changeText(v.getByLabelText('registrationSettings.per_member_limit'),'2');
 await act(async()=>confirm());expect(p.onPublish).not.toHaveBeenCalled();
});
it('blocks repeated callbacks until the save settles',async()=>{
 const p=props();let finish!:()=>void;p.onSave.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const v=render(<Editor {...p}/>);const press=v.UNSAFE_getAllByType(Button)[0].props.onPress;
 act(()=>{press();press();});expect(p.onSave).toHaveBeenCalledTimes(1);await act(async()=>finish());
});
it('shows validation and sends nothing for invalid limits',()=>{
 const p=props();const v=render(<Editor {...p}/>);fireEvent.changeText(v.getByLabelText('registrationSettings.per_member_limit'),'11');
 fireEvent.press(v.getByText('registrationSettings.save'));expect(v.getByText('registrationSettings.invalid')).toBeTruthy();expect(p.onSave).not.toHaveBeenCalled();
});
it('compares restored values with current policy and updates the comparison as edits change',()=>{
 const p=props();const recovered={approval:'auto' as const,opens:'',closes:'',cutoff:'',memberLimit:'4',guests:false,maxGuests:'1',retentionDays:'30'};
 const v=render(<Editor {...p} recoveredDraft={recovered}/>);
 expect(v.getByText('registrationSettings.current_value: 1')).toBeTruthy();
 expect(v.getByText('registrationSettings.proposed_value: 4')).toBeTruthy();
 fireEvent.changeText(v.getByLabelText('registrationSettings.per_member_limit'),'1');
 expect(v.getByText('registrationSettings.no_differences')).toBeTruthy();
 expect(v.queryByText('registrationSettings.proposed_value: 4')).toBeNull();
});
