// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

/** The text of a file bundled with the app (the result of require('./x.txt')). */
export async function readBundledText(module: number): Promise<string> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  return FileSystem.readAsStringAsync(asset.localUri ?? asset.uri);
}
