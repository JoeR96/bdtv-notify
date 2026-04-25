import { execSync } from 'node:child_process';
import type { GpuConfig } from '../types';

export function detectGpu(): GpuConfig {
  // On Windows, Docker Desktop handles GPU passthrough via WSL2 — nvidia-ctk is not required.
  // On Linux bare-metal Docker, nvidia-ctk must also be present.
  const isWindows = process.platform === 'win32';

  try {
    const output = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();

    const device = output.split('\n')[0].trim();

    if (!isWindows) {
      execSync('nvidia-ctk --version', { timeout: 3000, stdio: 'ignore' });
    }

    return { detected: true, type: 'nvidia', device };
  } catch {
    // nvidia-smi not available or failed
  }

  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return { detected: true, type: 'apple-silicon', device: 'Apple Silicon' };
  }

  return { detected: false, type: 'none', device: '' };
}
