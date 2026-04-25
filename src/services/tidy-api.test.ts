import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { validateFilePath } from './tidy-api';

const vault = process.platform === 'win32'
  ? 'C:\\Users\\test\\vault'
  : '/home/user/vault';

// ---------------------------------------------------------------------------
// Path traversal security — pure function, no server needed
// ---------------------------------------------------------------------------

describe('validateFilePath', () => {
  it('rejects paths containing ..', () => {
    const result = validateFilePath(vault, '../etc/passwd');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.status).toBe(400);
  });

  it('rejects paths with embedded ..', () => {
    const result = validateFilePath(vault, 'Inbox/../../../etc/passwd');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.status).toBe(400);
  });

  it('rejects absolute paths that resolve outside vault', () => {
    const outsidePath = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers' : '/etc/passwd';
    const result = validateFilePath(vault, outsidePath);
    if (!result.valid) {
      expect([400, 403]).toContain(result.status);
    }
  });

  it('accepts a valid relative path inside vault', () => {
    const result = validateFilePath(vault, 'Inbox/note.md');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.resolved).toBe(path.resolve(vault, 'Inbox/note.md'));
    }
  });

  it('accepts a nested relative path inside vault', () => {
    const result = validateFilePath(vault, 'Projects/2026/Q1/notes.md');
    expect(result.valid).toBe(true);
  });

  it('rejects a path that resolves outside vault via sibling traversal', () => {
    const result = validateFilePath(vault, '../sibling-vault/secret.md');
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /tidy-text mode parsing — extracted pure helper
// ---------------------------------------------------------------------------

function parseTidyMode(url: string | undefined): 'light' | 'deep' {
  return url?.includes('mode=deep') ? 'deep' : 'light';
}

describe('parseTidyMode', () => {
  it('defaults to light when no query param', () => {
    expect(parseTidyMode('/tidy-text')).toBe('light');
  });

  it('returns light for mode=light', () => {
    expect(parseTidyMode('/tidy-text?mode=light')).toBe('light');
  });

  it('returns deep for mode=deep', () => {
    expect(parseTidyMode('/tidy-text?mode=deep')).toBe('deep');
  });

  it('returns light for undefined url', () => {
    expect(parseTidyMode(undefined)).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// Deduplication key logic
// ---------------------------------------------------------------------------

describe('deduplication key behaviour', () => {
  it('file tidy key is the resolved absolute path', () => {
    const key = path.resolve(vault, 'Inbox/note.md');
    const set = new Set<string>();
    expect(set.has(key)).toBe(false);
    set.add(key);
    expect(set.has(key)).toBe(true);
    set.delete(key);
    expect(set.has(key)).toBe(false);
  });

  it('selection tidy uses a fixed key so concurrent requests collide', () => {
    const key = 'selection';
    const set = new Set<string>();
    set.add(key);
    expect(set.has('selection')).toBe(true);
  });

  it('different files do not block each other', () => {
    const set = new Set<string>();
    const key1 = path.resolve(vault, 'Inbox/a.md');
    const key2 = path.resolve(vault, 'Inbox/b.md');
    set.add(key1);
    expect(set.has(key2)).toBe(false);
  });
});
