// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Text,
  View,
  type ViewToken,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Button as HeroButton } from 'heroui-native';
import { useTranslation } from 'react-i18next';

interface CarouselImage {
  uri: string;
  alt?: string;
}

interface ImageCarouselProps {
  images: CarouselImage[];
  height?: number;
  onImagePress?: (index: number) => void;
}

const HORIZONTAL_MARGIN = 16;
const CARD_PADDING = 16;

export default function ImageCarousel({ images, height = 250, onImagePress }: ImageCarouselProps) {
  const { t } = useTranslation('common');
  // Measured per render, not once at module load: a rotation or split-screen resize left
  // the pages snapping to the old width.
  const { width: screenWidth } = useWindowDimensions();
  const IMAGE_WIDTH = screenWidth - HORIZONTAL_MARGIN * 2 - CARD_PADDING * 2;
  const [activeIndex, setActiveIndex] = useState(0);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
  ).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const handleImagePress = useCallback(
    (index: number) => {
      if (onImagePress) {
        onImagePress(index);
      } else {
        router.push({
          pathname: '/(modals)/image-viewer',
          params: { uri: images[index].uri, title: images[index].alt ?? '' },
        });
      }
    },
    [onImagePress, images],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: CarouselImage; index: number }) => (
      <HeroButton
        variant="ghost"
        className="p-0"
        onPress={() => handleImagePress(index)}
        accessibilityLabel={item.alt ?? t('aria.carouselImage', { current: index + 1, total: images.length })}
        accessibilityRole="imagebutton"
      >
        <Image
          source={{ uri: item.uri }}
          recyclingKey={item.uri}
          transition={120}
          style={{ width: IMAGE_WIDTH, height, borderRadius: 10 }}
          contentFit="cover"
        />
      </HeroButton>
    ),
    [handleImagePress, height, images.length, t, IMAGE_WIDTH],
  );

  const keyExtractor = useCallback((_: CarouselImage, index: number) => `carousel-${index}`, []);

  return (
    <View>
      <FlatList
        data={images}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        snapToInterval={IMAGE_WIDTH}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({
          length: IMAGE_WIDTH,
          offset: IMAGE_WIDTH * index,
          index,
        })}
      />

      {/* Image count badge */}
      <View className="absolute top-2 right-2 bg-black/60 rounded-[10px] px-2 py-0.5">
        <Text className="text-white text-[12px] font-semibold">
          {activeIndex + 1}/{images.length}
        </Text>
      </View>

      {/* Page indicator dots */}
      {images.length > 1 ? (
        <View className="absolute bottom-2 left-0 right-0 flex-row justify-center items-center gap-1.5">
          {images.map((_, index) => (
            <View
              key={index}
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: index === activeIndex ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.5)' }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
