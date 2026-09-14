// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { storage } from '@/lib/storage';

export type CreationDraftKind = 'goal' | 'poll' | 'message';

export interface CreationDraftScope {
  kind: CreationDraftKind;
  tenantId: string | number;
  userId: string | number;
  /** Separates several drafts of the same kind, such as individual conversations. */
  contextId?: string | number;
}

interface DraftManifest {
  version: 1;
  chunks: number;
  generation?: string;
  cleared?: boolean;
}

const CHUNK_CHARACTERS = 350;
const MAX_CHUNKS = 32;
const operationQueues = new Map<string, Promise<void>>();

function safeKeyPart(value: string | number): string {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'unknown';
}

function baseKey(scope: CreationDraftScope): string {
  const context = scope.contextId === undefined ? '' : `_${safeKeyPart(scope.contextId)}`;
  return `nexus_creation_draft_v1_${scope.kind}_${safeKeyPart(scope.tenantId)}_${safeKeyPart(scope.userId)}${context}`;
}

function chunkKey(base: string, generation: string, index: number): string {
  return `${base}_${generation}_${index}`;
}

function splitUnicode(value: string): string[] {
  const characters = Array.from(value);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += CHUNK_CHARACTERS) {
    chunks.push(characters.slice(index, index + CHUNK_CHARACTERS).join(''));
  }
  return chunks.length > 0 ? chunks : [''];
}

async function readManifest(base: string): Promise<DraftManifest | null> {
  const manifest = await storage.getJson<DraftManifest>(base);
  if (!manifest || manifest.version !== 1 || !Number.isInteger(manifest.chunks)) return null;
  if (manifest.chunks < 0 || manifest.chunks > MAX_CHUNKS) return null;
  return manifest;
}

async function enqueueDraftOperation<T>(base: string, operation: () => Promise<T>): Promise<T> {
  const previous = operationQueues.get(base) ?? Promise.resolve();
  const queued = previous.catch(() => undefined).then(operation);
  const settled = queued.then(() => undefined, () => undefined);
  operationQueues.set(base, settled);
  try {
    return await queued;
  } finally {
    if (operationQueues.get(base) === settled) operationQueues.delete(base);
  }
}

/**
 * Saves the complete draft through small encrypted chunks. Chunks are written first and
 * the manifest last, so a killed process exposes either the previous complete draft or
 * the new complete draft and never a partly-written value.
 */
export async function saveCreationDraft<T>(scope: CreationDraftScope, draft: T): Promise<boolean> {
  const base = baseKey(scope);
  return enqueueDraftOperation(base, async () => {
    let previous: DraftManifest | null;
    let chunks: string[];
    let generation: string;
    try {
      previous = await readManifest(base);
      chunks = splitUnicode(JSON.stringify(draft));
      if (chunks.length > MAX_CHUNKS) return false;
      generation = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      for (let index = 0; index < chunks.length; index += 1) {
        await storage.set(chunkKey(base, generation, index), chunks[index], { required: true });
      }
      await storage.setJson<DraftManifest>(base, { version: 1, chunks: chunks.length, generation }, { required: true });
    } catch {
      return false;
    }
    // Once the manifest is committed, the new complete draft is authoritative.
    // Old-generation cleanup is space reclamation and cannot make this save fail.
    if (previous?.generation) {
      for (let index = 0; index < previous.chunks; index += 1) {
        await storage.remove(chunkKey(base, previous.generation, index)).catch(() => undefined);
      }
    }
    return true;
  });
}

export async function loadCreationDraft<T>(scope: CreationDraftScope): Promise<T | null> {
  const base = baseKey(scope);
  await operationQueues.get(base);
  try {
    const manifest = await readManifest(base);
    if (!manifest || manifest.cleared || manifest.chunks === 0 || !manifest.generation) return null;
    const chunks: string[] = [];
    for (let index = 0; index < manifest.chunks; index += 1) {
      const chunk = await storage.get(chunkKey(base, manifest.generation, index));
      if (chunk === null) return null;
      chunks.push(chunk);
    }
    return JSON.parse(chunks.join('')) as T;
  } catch {
    return null;
  }
}

/** A committed tombstone prevents an old encrypted chunk from resurrecting after discard. */
export async function clearCreationDraft(scope: CreationDraftScope): Promise<boolean> {
  const base = baseKey(scope);
  return enqueueDraftOperation(base, async () => {
    let previous: DraftManifest | null;
    try {
      previous = await readManifest(base);
      await storage.setJson<DraftManifest>(base, { version: 1, chunks: 0, cleared: true }, { required: true });
    } catch {
      return false;
    }
    // The committed tombstone is the logical delete. Stale encrypted chunks are
    // unreachable and can be reclaimed opportunistically without reopening the draft.
    if (previous?.generation) {
      for (let index = 0; index < previous.chunks; index += 1) {
        await storage.remove(chunkKey(base, previous.generation, index)).catch(() => undefined);
      }
    }
    return true;
  });
}
