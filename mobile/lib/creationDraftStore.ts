// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { storage } from '@/lib/storage';
import { Platform } from 'react-native';
import { loadEncryptedDraftFile, saveEncryptedDraftFile } from './encryptedDraftFile';

export type CreationDraftKind = 'goal' | 'poll' | 'message' | 'quiz-attempt' | 'event-communication' | 'event-people' | 'event-session-registration' | 'event-registration-settings' | 'event-registration-form';

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
// Event bodies allow 20,000 characters. JSON can expand a character to six
// characters; leave bounded headroom for the operation identity and receipt.
// People batches share this bound for up to 100 targets and one shared reason.
const EVENT_COMMUNICATION_MAX_CHUNKS = 384;
export const CREATION_DRAFT_MAX_CHARACTERS = CHUNK_CHARACTERS * MAX_CHUNKS;
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

function maxChunks(scope: CreationDraftScope): number {
  return scope.kind === 'event-communication' || scope.kind === 'event-people' ? EVENT_COMMUNICATION_MAX_CHUNKS : MAX_CHUNKS;
}
const usesDraftFile = (scope: CreationDraftScope) => scope.kind === 'event-registration-form' && Platform.OS !== 'web';

async function readManifest(base: string, required = false, limit = MAX_CHUNKS): Promise<DraftManifest | null> {
  let manifest: DraftManifest | null;
  if (required) {
    const raw = await storage.get(base, { required: true });
    if (raw === null) return null;
    manifest = JSON.parse(raw) as DraftManifest;
  } else {
    manifest = await storage.getJson<DraftManifest>(base);
  }
  if (!manifest || manifest.version !== 1 || !Number.isInteger(manifest.chunks)
      || manifest.chunks < 0 || manifest.chunks > limit) {
    if (required) throw new Error('Invalid saved draft manifest');
    return null;
  }
  if (required && ((manifest.cleared !== undefined && typeof manifest.cleared !== 'boolean')
      || (manifest.cleared === true && manifest.chunks !== 0))) {
    throw new Error('Invalid saved draft tombstone');
  }
  if (required && !(manifest.cleared === true && manifest.chunks === 0)
      && (manifest.chunks === 0 || typeof manifest.generation !== 'string' || !/^[A-Za-z0-9_]+$/.test(manifest.generation))) {
    throw new Error('Invalid saved draft generation');
  }
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
    if (usesDraftFile(scope)) {
      try { await saveEncryptedDraftFile(base, draft); return true; } catch { return false; }
    }
    let previous: DraftManifest | null;
    let chunks: string[];
    let generation: string;
    try {
      previous = await readManifest(base, false, maxChunks(scope));
      chunks = splitUnicode(JSON.stringify(draft));
      if (chunks.length > maxChunks(scope)) return false;
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

/** Required reads throw on unavailable/corrupt storage; null means absent or explicitly cleared. */
export async function loadCreationDraft<T>(scope: CreationDraftScope, options?: { required?: boolean }): Promise<T | null> {
  const base = baseKey(scope);
  await operationQueues.get(base);
  try {
    if (usesDraftFile(scope)) {
      const saved = await loadEncryptedDraftFile<T | null>(base);
      // Only absence permits migration from the old chunk store. A cleared file
      // generation or damaged file must never resurrect an obsolete request.
      if (saved !== null) return saved.value;
    }
    const manifest = await readManifest(base, options?.required, maxChunks(scope));
    if (!manifest || manifest.cleared || manifest.chunks === 0 || !manifest.generation) return null;
    const chunks: string[] = [];
    for (let index = 0; index < manifest.chunks; index += 1) {
      const chunk = await storage.get(chunkKey(base, manifest.generation, index), options);
      if (chunk === null) {
        if (options?.required) throw new Error('Saved draft chunk is missing');
        return null;
      }
      chunks.push(chunk);
    }
    const draft = JSON.parse(chunks.join('')) as T;
    if (options?.required && draft === null) throw new Error('Saved draft payload is null');
    return draft;
  } catch (error) {
    if (options?.required) throw error;
    return null;
  }
}

/** A committed tombstone prevents an old encrypted chunk from resurrecting after discard. */
export async function clearCreationDraft(scope: CreationDraftScope): Promise<boolean> {
  const base = baseKey(scope);
  return enqueueDraftOperation(base, async () => {
    if (usesDraftFile(scope)) {
      try { await saveEncryptedDraftFile(base, null); return true; } catch { return false; }
    }
    let previous: DraftManifest | null;
    try {
      previous = await readManifest(base, false, maxChunks(scope));
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
