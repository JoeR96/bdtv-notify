import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('detectGpu', () => {
  it('returns none when nvidia-smi throws', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockImplementation(() => { throw new Error('not found'); });

    const { detectGpu } = await import('./gpu-detect');
    const result = detectGpu();
    expect(result).toEqual({ detected: false, type: 'none', device: '' });
  });

  it('returns nvidia on win32 with nvidia-smi success (no ctk needed)', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockImplementation((cmd: unknown) => {
      if (String(cmd).includes('nvidia-smi')) return Buffer.from('NVIDIA GeForce RTX 5080\n');
      throw new Error('ctk not found');
    });

    const { detectGpu } = await import('./gpu-detect');
    const result = detectGpu();
    expect(result.type).toBe('nvidia');
    expect(result.detected).toBe(true);
    expect(result.device).toBe('NVIDIA GeForce RTX 5080');

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns nvidia on linux when both nvidia-smi and nvidia-ctk succeed', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockImplementation((cmd: unknown) => {
      if (String(cmd).includes('nvidia-smi')) return Buffer.from('Tesla T4\n');
      return Buffer.from('nvidia-ctk version 1.0\n');
    });

    const { detectGpu } = await import('./gpu-detect');
    const result = detectGpu();
    expect(result.type).toBe('nvidia');
    expect(result.device).toBe('Tesla T4');

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns none on linux when nvidia-smi succeeds but nvidia-ctk fails', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockImplementation((cmd: unknown) => {
      if (String(cmd).includes('nvidia-smi')) return Buffer.from('GTX 1080\n');
      throw new Error('ctk not found');
    });

    const { detectGpu } = await import('./gpu-detect');
    const result = detectGpu();
    expect(result.type).toBe('none');

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });
});
