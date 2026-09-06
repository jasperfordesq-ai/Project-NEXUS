// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { forwardRef } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { SearchField } from 'heroui-native';

import { Ionicons } from '@/components/ui/Icon';
import { useTheme } from '@/lib/hooks/useTheme';

interface SearchInputProps extends Omit<TextInputProps, 'editable' | 'onChangeText' | 'value'> {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  disabled?: boolean;
  containerClassName?: string;
  groupClassName?: string;
  inputClassName?: string;
}

const SearchInput = forwardRef<TextInput, SearchInputProps>(function SearchInput(
  {
    value,
    onChangeText,
    placeholder,
    clearLabel,
    disabled = false,
    accessibilityLabel,
    containerClassName,
    groupClassName,
    inputClassName,
    ...rest
  },
  ref,
) {
  const theme = useTheme();

  return (
    <SearchField
      value={value}
      onChange={onChangeText}
      isDisabled={disabled}
      className={containerClassName ?? 'mb-3'}
    >
      <SearchField.Group className={groupClassName ?? 'min-h-12 rounded-full bg-surface-secondary'}>
        {/*
          🔴 Our own icon, not `SearchField.SearchIcon`.

          The library's icon hardcodes `accessibilityLabel: "Search icon"` on its SVG and
          accepts only `size` and `color`, so every search field on every screen announced a
          decorative magnifier as its own stop — measured with TalkBack on 2026-08-24, where
          the members directory read "Search members…" and then "Search icon". Accessibility
          props passed to it are ignored. `components/ui/Icon.tsx` hides icons from the tree,
          which is the convention the rest of the app already follows.
        */}
        <View className="absolute left-4 z-10" pointerEvents="none" testID="search-icon-decorative">
          <Ionicons name="search" size={16} color={theme.textMuted} />
        </View>
        <SearchField.Input
          ref={ref}
          accessibilityLabel={accessibilityLabel ?? placeholder}
          placeholder={placeholder}
          className={inputClassName ?? 'min-h-12 flex-1 rounded-full pl-11 pr-10'}
          {...rest}
        />
        <SearchField.ClearButton accessibilityLabel={clearLabel} className="mr-2" />
      </SearchField.Group>
    </SearchField>
  );
});

export default SearchInput;
