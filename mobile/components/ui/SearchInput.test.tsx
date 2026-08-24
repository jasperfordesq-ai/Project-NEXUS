// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import SearchInput from './SearchInput';

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');

  const SearchContext = React.createContext({ searchValue: '', onSearchChange: undefined });

  const SearchField = ({
    children,
    value,
    onChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onChange?: (value: string) => void;
  }) => (
    <SearchContext.Provider value={{ searchValue: value ?? '', onSearchChange: onChange }}>
      <View>{children}</View>
    </SearchContext.Provider>
  );
  SearchField.Group = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  SearchField.SearchIcon = () => <View testID="search-icon" />;
  SearchField.Input = React.forwardRef(
    (
      props: {
        accessibilityLabel?: string;
        placeholder?: string;
        testID?: string;
      },
      ref: React.Ref<unknown>,
    ) => {
      const context = React.useContext(SearchContext);
      return (
        <TextInput
          ref={ref}
          accessibilityLabel={props.accessibilityLabel}
          placeholder={props.placeholder}
          testID={props.testID}
          value={context.searchValue}
          onChangeText={context.onSearchChange}
        />
      );
    },
  );
  SearchField.ClearButton = ({ accessibilityLabel }: { accessibilityLabel?: string }) => {
    const context = React.useContext(SearchContext);
    return context.searchValue ? (
      <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" onPress={() => context.onSearchChange?.('')}>
        <Text>clear</Text>
      </Pressable>
    ) : null;
  };

  return { SearchField };
});

describe('SearchInput', () => {
  it('uses HeroUI Native SearchField with a clear action', () => {
    const onChangeText = jest.fn();
    const { getByLabelText, getByPlaceholderText, getByTestId } = render(
      <SearchInput
        value="garden"
        onChangeText={onChangeText}
        placeholder="Search listings"
        accessibilityLabel="Search listings"
        clearLabel="Clear search"
        testID="native-search"
      />,
    );

    /*
      🔴 The magnifier is OUR icon now, not `SearchField.SearchIcon`. The library's version
      hardcodes `accessibilityLabel: "Search icon"` on its SVG and ignores accessibility
      props, so it announced itself as a stop on every search field — measured with TalkBack
      on 2026-08-24. `components/ui/Icon.tsx` hides icons from the accessibility tree, so
      the assertion is that the decorative wrapper is there and the library's is not.
    */
    expect(getByTestId('search-icon-decorative')).toBeTruthy();

    fireEvent.changeText(getByPlaceholderText('Search listings'), 'garden tools');
    expect(onChangeText).toHaveBeenCalledWith('garden tools');

    fireEvent.press(getByLabelText('Clear search'));
    expect(onChangeText).toHaveBeenLastCalledWith('');
  });
});
