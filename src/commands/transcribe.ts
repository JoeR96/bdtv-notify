import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import type { Command } from 'commander';
import { readConfig } from '../services/config';
import { WhisperClient } from '../services/whisper-client';

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as ArrayBuffer));
  }
  return Buffer.concat(chunks);
}

function hasHostFfmpeg(): boolean {
  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    execSync(cmd, { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function convertToWav(inputPath: string): string {
  const tmpDir = os.tmpdir();
  const outPath = path.join(tmpDir, `olt-${Date.now()}.wav`);

  if (hasHostFfmpeg()) {
    const result = spawnSync('ffmpeg', ['-y', '-i', inputPath, outPath], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('ffmpeg conversion failed');
  } else {
    // Fall back to Docker-based ffmpeg
    const result = spawnSync(
      'docker',
      [
        'run', '--rm',
        '-v', `${tmpDir}:/tmp/audio`,
        'linuxserver/ffmpeg',
        '-y', '-i', `/tmp/audio/${path.basename(inputPath)}`,
        `/tmp/audio/${path.basename(outPath)}`,
      ],
      { stdio: 'inherit' }
    );
    if (result.status !== 0) throw new Error('Docker ffmpeg conversion failed');
  }

  return outPath;
}

async function runTranscribe(
  file: string | undefined,
  options: { stdin?: boolean; toObsidian?: string }
): Promise<void> {
  const config = readConfig();
  const client = new WhisperClient(config.whisper.port);

  let audioPath: string;
  let tmpToClean: string | null = null;

  if (options.stdin) {
    const buf = await readStdin();
    audioPath = path.join(os.tmpdir(), `olt-stdin-${Date.now()}.wav`);
    fs.writeFileSync(audioPath, buf);
    tmpToClean = audioPath;
  } else if (file) {
    if (!fs.existsSync(file)) {
      console.error(`Error: File not found: ${file}`);
      process.exit(1);
    }
    audioPath = path.resolve(file);
  } else {
    console.error('Error: Provide a file path or use --stdin');
    process.exit(1);
  }

  // Convert non-wav formats
  const ext = path.extname(audioPath).toLowerCase();
  if (ext !== '.wav') {
    const converted = convertToWav(audioPath);
    if (tmpToClean) fs.unlinkSync(tmpToClean);
    tmpToClean = converted;
    audioPath = converted;
  }

  try {
    const result = await client.transcribe(audioPath);

    if (options.toObsidian) {
      const vaultPath = config.obsidian.vault;
      if (!vaultPath) {
        console.error('Error: Obsidian vault not configured. Run olt setup first.');
        process.exit(1);
      }
      const today = new Date().toISOString().slice(0, 10);
      const noteContent = `---\ndate: ${today}\ntype: transcription\n---\n\n${result.text}\n`;
      const notePath = path.join(vaultPath, `${options.toObsidian}.md`);
      fs.writeFileSync(notePath, noteContent, 'utf8');
      console.error(`Saved to: ${notePath}`);
    } else {
      process.stdout.write(result.text + '\n');
    }
  } finally {
    if (tmpToClean && fs.existsSync(tmpToClean)) {
      fs.unlinkSync(tmpToClean);
    }
  }
}

export function registerTranscribe(program: Command): void {
  program
    .command('transcribe [file]')
    .description('Transcribe an audio file via the local Whisper server')
    .option('--stdin', 'Read audio from stdin')
    .option('--to-obsidian <name>', 'Save transcription as an Obsidian note with this name')
    .action(runTranscribe);
}
