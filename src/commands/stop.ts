import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync, execSync } from 'node:child_process';
import type { Command } from 'commander';
import { getPidFile, readConfig } from '../services/config';

function getComposePath(): string {
  return path.join(__dirname, '..', '..', 'docker-compose.yml');
}

function killProcessOnPort(port: number): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano`, { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const pid = line.trim().split(/\s+/).pop();
          if (pid && pid !== '0') {
            try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); } catch { /* already gone */ }
          }
        }
      }
    } else {
      execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null || true`, { shell: '/bin/sh', stdio: 'ignore' as const });
    }
  } catch { /* port was not in use */ }
}

function isPortInUse(port: number): boolean {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano`, { encoding: 'utf8' });
      return out.split('\n').some(l => l.includes(`:${port}`) && l.includes('LISTENING'));
    } else {
      execSync(`lsof -ti :${port}`, { stdio: 'ignore' });
      return true;
    }
  } catch {
    return false;
  }
}

function runStop(): void {
  const config = readConfig();
  const apiPort = config.api.port;

  // 1. Try PID file first
  const pidFile = getPidFile();
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (!isNaN(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`  Tidy API stopped (PID ${pid})`);
        } catch { /* already gone */ }
      }
    } catch { /* unreadable */ }
    fs.unlinkSync(pidFile);
  }

  // 2. Belt-and-braces: kill anything still holding the port
  if (isPortInUse(apiPort)) {
    console.log(`  Tidy API: port ${apiPort} still in use, forcing stop...`);
    killProcessOnPort(apiPort);
  }

  // 3. Stop Docker
  const composePath = getComposePath();
  console.log('  Stopping Docker services...');
  const result = spawnSync('docker', ['compose', '-f', composePath, 'down'], { stdio: 'inherit' });

  if (result.status !== 0) {
    console.error('Error: Failed to stop Docker services.');
    process.exit(1);
  }
}

export function registerStop(program: Command): void {
  program
    .command('stop')
    .description('Stop Docker services and the tidy API')
    .action(runStop);
}
