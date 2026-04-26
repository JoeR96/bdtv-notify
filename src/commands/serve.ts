import * as path from 'node:path';
import * as fs from 'node:fs';
import * as net from 'node:net';
import { spawnSync, fork } from 'node:child_process';
import type { Command } from 'commander';
import { readConfig, getPidFile } from '../services/config';

function getComposePath(): string {
  return path.join(__dirname, '..', '..', 'docker-compose.yml');
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => { server.close(); resolve(false); });
    server.listen(port, '127.0.0.1');
  });
}

async function runServe(options: { detach?: boolean }): Promise<void> {
  const config = readConfig();
  const profile = config.gpu.type === 'nvidia' ? 'gpu' : 'cpu';
  const composePath = getComposePath();
  const apiPort = config.api.port;

  // Preflight: warn clearly if tidy API port is already occupied
  if (await isPortInUse(apiPort)) {
    console.error(`\nError: Port ${apiPort} is already in use.`);
    console.error(`  Run  olt stop  to clean up before starting again.\n`);
    process.exit(1);
  }

  console.log(`\nStarting services (profile: ${profile})...`);

  const result = spawnSync(
    'docker',
    ['compose', '-f', composePath, '--profile', profile, 'up', '-d'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        WHISPER_PORT: String(config.whisper.port),
        OLLAMA_PORT: String(config.ollama.port),
        WHISPER_MODEL: config.whisper.model + '.bin',
      },
    }
  );

  if (result.status !== 0) {
    console.error('Error: Failed to start Docker services.');
    process.exit(1);
  }

  console.log('');
  console.log(`  Whisper:  http://localhost:${config.whisper.port}`);
  console.log(`  Ollama:   http://localhost:${config.ollama.port}`);
  console.log(`  Vault:    ${config.obsidian.vault || '(not configured — run olt setup)'}`);

  const tidyApiProcess = path.join(__dirname, '..', 'services', 'tidy-api-process');

  if (options.detach) {
    const child = fork(tidyApiProcess, [], { detached: true, stdio: 'ignore' });
    child.unref();
    if (child.pid !== undefined) {
      fs.writeFileSync(getPidFile(), String(child.pid), 'utf8');
      console.log(`  Tidy API: http://localhost:${apiPort} (PID ${child.pid}, background)`);
    }
  } else {
    console.log(`  Tidy API: http://localhost:${apiPort}`);
    console.log('\n  Listening for tidy requests... (Ctrl+C to stop)\n');

    const { TidyApiServer } = require('../services/tidy-api') as typeof import('../services/tidy-api');
    const server = new TidyApiServer(config);

    try {
      await server.start();
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'EADDRINUSE') {
        console.error(`\nError: Port ${apiPort} is already in use.`);
        console.error(`  Run  olt stop  to clean up before starting again.\n`);
      } else {
        console.error('\nError: Failed to start tidy API:', error.message);
      }
      process.exit(1);
    }

    const shutdown = async (): Promise<void> => {
      console.log('\n  Stopping tidy API...');
      await server.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
  }
}

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Start Docker services and the tidy API')
    .option('-d, --detach', 'Run the tidy API in the background')
    .action(runServe);
}
