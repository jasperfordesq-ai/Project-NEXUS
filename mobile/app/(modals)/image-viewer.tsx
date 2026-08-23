// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect } from 'react';
import { Dimensions, ScrollView, Share, StatusBar, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button as HeroButton, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

function ImageViewerScreenInner() {
  const { t } = useTranslation('home');
  const { uri, title } = useLocalSearchParams<{ uri: string; title?: string }>();

  const { width, height } = Dimensions.get('window');

  async function handleShare() {
    if (!uri) return;
    const message = title ? `${title}\n${uri}` : uri;
    await Share.share({ message, url: uri });
  }

  function handleClose() {
    router.back();
  }

  useEffect(() => {
    if (!uri) {
      router.back();
    }
  }, [uri]);

  if (!uri) {
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1 }}>
        <Surface
          variant="default"
          className="absolute left-4 right-4 top-2 z-10 flex-row items-center justify-between rounded-panel-inner px-2 py-2"
          style={{ backgroundColor: 'rgba(0,0,0,0.52)' }}
        >
          <HeroButton
            isIconOnly
            variant="secondary"
            onPress={handleClose}
            accessibilityLabel={t('imageViewer.close')}
            style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </HeroButton>
          <HeroButton
            isIconOnly
            variant="secondary"
            onPress={() => void handleShare()}
            accessibilityLabel={t('imageViewer.share')}
            style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}
          >
            <Ionicons name="share-outline" size={20} color="#FFFFFF" />
          </HeroButton>
        </Surface>

        {/*
          Pinch-to-zoom via ScrollView:
          - iOS: native pinch gesture via maximumZoomScale + pinchGestureEnabled
          - Android: ScrollView zoom works on both platforms when the content
            has an explicit pixel size driven by Dimensions (not flex/percentage).
            Using flex: 1 or width: '100%' collapses to 0px inside a zoomable
            ScrollView on Android — explicit width/height from Dimensions fixes this.
        */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            width,
            height,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          maximumZoomScale={5}
          minimumZoomScale={1}
          pinchGestureEnabled
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          bouncesZoom
          centerContent
        >
          <Image
            source={{ uri }}
            style={{ width, height }}
            contentFit="contain"
            accessibilityLabel={title ?? t('imageViewer.close')}
          />
        </ScrollView>

        <View className="pb-3" />
      </SafeAreaView>
    </View>
  );
}

export default function ImageViewerScreen() {
  return (
    <ModalErrorBoundary>
      <ImageViewerScreenInner />
    </ModalErrorBoundary>
  );
}
