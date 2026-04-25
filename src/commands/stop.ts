import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { Command } from 'commander';
import { getPidFile } from '../services/config';

function getComposePath(): string {
  return path.join(__dirname, '..', '..', 'docker-compose.yml');
}

function runStop(): void {
  // Stop tidy API process if running
  const pidFile = getPidFile();
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (!isNaN(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`  Tidy API stopped (PID ${pid})`);
        } catch {
          // Process already dead
        }
      }
    } catch {
      // PID file unreadable
    }
    fs.unlinkSync(pidFile);
  }

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
