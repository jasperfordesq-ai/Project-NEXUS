// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Where are you based?" field, shared by the onboarding wizard and the
 * home-page location reminder.
 *
 * Wired exactly like the registration form: a plain input until the member
 * focuses it, then the lazily loaded place autocomplete (so the maps code
 * is not downloaded for members who never touch it). Free text is allowed —
 * a picked place supplies coordinates, typed text alone is geocoded in the
 * background.
 *
 * One deliberate difference from registration: typing after a place was
 * picked drops the old coordinates, so a member who edits the text never
 * saves a town name with the coordinates of a different place.
 */

import { lazy, Suspense, useState, type ReactNode } from 'react';

import { Input } from '@/components/ui/Input';
import type { MemberLocationValue } from '@/lib/memberLocation';

const PlaceAutocompleteInput = lazy(() =>
  import('@/components/location/PlaceAutocompleteInput').then((module) => ({
    default: module.PlaceAutocompleteInput,
  })),
);

const FIELD_CLASS_NAMES = {
  inputWrapper: 'bg-theme-elevated',
};

interface MemberLocationFieldProps {
  value: MemberLocationValue;
  onChange: (next: MemberLocationValue) => void;
  label: ReactNode;
  placeholder?: string;
  isRequired?: boolean;
  isInvalid?: boolean;
  errorMessage?: string;
  className?: string;
}

export function MemberLocationField({
  value,
  onChange,
  label,
  placeholder,
  isRequired = false,
  isInvalid = false,
  errorMessage,
  className,
}: MemberLocationFieldProps) {
  const [isActivated, setIsActivated] = useState(false);

  const handleText = (text: string) => onChange({ location: text });

  const plainInput = (activateOnType: boolean) => (
    <Input
      type="text"
      label={label}
      placeholder={placeholder}
      value={value.location}
      onFocus={activateOnType ? () => setIsActivated(true) : undefined}
      onChange={(e) => {
        handleText(e.target.value);
        if (activateOnType) setIsActivated(true);
      }}
      isRequired={isRequired}
      isInvalid={isInvalid}
      errorMessage={errorMessage}
      autoComplete="address-level2"
      classNames={FIELD_CLASS_NAMES}
    />
  );

  return (
    <div className={className}>
      {isActivated ? (
        <Suspense fallback={plainInput(false)}>
          <PlaceAutocompleteInput
            label={label}
            placeholder={placeholder}
            value={value.location}
            onChange={handleText}
            onPlaceSelect={(place) =>
              onChange({
                location: place.formattedAddress,
                latitude: place.lat,
                longitude: place.lng,
              })
            }
            onClear={() => onChange({ location: '' })}
            isRequired={isRequired}
            isInvalid={isInvalid}
            errorMessage={errorMessage}
            classNames={FIELD_CLASS_NAMES}
          />
        </Suspense>
      ) : (
        plainInput(true)
      )}
    </div>
  );
}
