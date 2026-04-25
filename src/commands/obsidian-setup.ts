import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import type { AppConfig } from '../types';
import { readConfig } from '../services/config';

const SHELL_COMMANDS_PLUGIN_ID = 'obsidian-shellcommands';
const WHISPER_PLUGIN_ID = 'whisper';

export const TIDY_LIGHT_ID = 'olt-tidy-light';
export const TIDY_DEEP_ID = 'olt-tidy-deep';
export const TIDY_LIGHT_SEL_ID = 'olt-tidy-light-sel';
export const TIDY_DEEP_SEL_ID = 'olt-tidy-deep-sel';

export interface ObsidianSetupResult {
  whisper: 'configured' | 'missing';
  shellCommands: 'configured' | 'missing';
  hotkeys: 'written';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOutputHandler(handler: string) {
  return { handler, convert_ansi_code: true };
}

function makeShellCommand(id: string, alias: string, winCmd: string, defaultCmd: string) {
  return {
    id,
    platform_specific_commands: { default: defaultCmd, win32: winCmd },
    shells: {},
    alias,
    icon: null,
    confirm_execution: false,
    ignore_error_codes: [],
    input_contents: { stdin: null },
    output_handlers: {
      stdout: makeOutputHandler('notification'),
      stderr: makeOutputHandler('notification'),
    },
    output_wrappers: { stdout: null, stderr: null },
    output_channel_order: 'stdout-first',
    output_handling_mode: 'buffered',
    execution_notification_mode: 'permanent',
    events: {},
    debounce: null,
    command_palette_availability: 'enabled',
    preactions: [],
    variable_default_values: {},
  };
}

function makeSelectionCommand(id: string, alias: string, url: string) {
  // -sf: silent + fail-on-error so non-2xx responses don't land in the note via caret
  const cmd = `curl.exe -sf -X POST "${url}" -H "Content-Type: text/plain" --data-binary @-`;
  const unixCmd = `curl -sf -X POST "${url}" -H "Content-Type: text/plain" --data-binary @-`;
  return {
    ...makeShellCommand(id, alias, cmd, unixCmd),
    input_contents: { stdin: '{{selection}}' },
    ignore_error_codes: [22], // curl -f returns 22 on HTTP error; suppress so no noise
    output_handlers: {
      stdout: makeOutputHandler('current-file-caret'),
      stderr: makeOutputHandler('notification'),
    },
  };
}

function buildTidyCommands(apiPort: number) {
  const fileUrl = `http://localhost:${apiPort}/tidy`;
  const selLightUrl = `http://localhost:${apiPort}/tidy-text?mode=light`;
  const selDeepUrl  = `http://localhost:${apiPort}/tidy-text?mode=deep`;

  // PowerShell single-quoted strings are literal — no escaping needed for the JSON body
  const winLight  = `curl.exe -s -X POST ${fileUrl} -H "Content-Type: application/json" -d '{"file": "{{file_path:relative}}", "mode": "light"}'`;
  const winDeep   = `curl.exe -s -X POST ${fileUrl} -H "Content-Type: application/json" -d '{"file": "{{file_path:relative}}", "mode": "deep"}'`;
  const unixLight = `curl -s -X POST ${fileUrl} -H "Content-Type: application/json" -d '{"file": "{{file_path:relative}}", "mode": "light"}'`;
  const unixDeep  = `curl -s -X POST ${fileUrl} -H "Content-Type: application/json" -d '{"file": "{{file_path:relative}}", "mode": "deep"}'`;

  return [
    makeShellCommand(TIDY_LIGHT_ID, 'Tidy note (light)', winLight, unixLight),
    makeShellCommand(TIDY_DEEP_ID,  'Tidy note (deep)',  winDeep,  unixDeep),
    makeSelectionCommand(TIDY_LIGHT_SEL_ID, 'Tidy selection (light)', selLightUrl),
    makeSelectionCommand(TIDY_DEEP_SEL_ID,  'Tidy selection (deep)',  selDeepUrl),
  ];
}

// ---------------------------------------------------------------------------
// Core configuration logic — used by both the wizard and standalone command
// ---------------------------------------------------------------------------

export function configureObsidianPlugins(config: AppConfig): ObsidianSetupResult {
  const vault = config.obsidian.vault;
  const obsidianDir = path.join(vault, '.obsidian');
  const pluginsDir  = path.join(obsidianDir, 'plugins');
  const result: ObsidianSetupResult = {
    whisper: 'missing',
    shellCommands: 'missing',
    hotkeys: 'written',
  };

  // ── Whisper plugin ─────────────────────────────────────────────────────────
  const whisperDir = path.join(pluginsDir, WHISPER_PLUGIN_ID);
  if (fs.existsSync(whisperDir)) {
    const dataPath = path.join(whisperDir, 'data.json');
    const existing = fs.existsSync(dataPath)
      ? (JSON.parse(fs.readFileSync(dataPath, 'utf8')) as Record<string, unknown>)
      : {};
    fs.writeFileSync(dataPath, JSON.stringify({
      ...existing,
      apiUrl: `http://localhost:${config.whisper.port}/inference`,
    }, null, 2), 'utf8');
    result.whisper = 'configured';
  }

  // ── Shell Commands plugin ──────────────────────────────────────────────────
  const scDir = path.join(pluginsDir, SHELL_COMMANDS_PLUGIN_ID);
  if (fs.existsSync(scDir)) {
    const dataPath = path.join(scDir, 'data.json');
    const existing = fs.existsSync(dataPath)
      ? (JSON.parse(fs.readFileSync(dataPath, 'utf8')) as Record<string, unknown>)
      : null;

    const existingCmds = (existing?.shell_commands as Array<Record<string, unknown>>) ?? [];
    const filtered = existingCmds.filter(
      (c) => c.id !== TIDY_LIGHT_ID && c.id !== TIDY_DEEP_ID
    );

    fs.writeFileSync(dataPath, JSON.stringify({
      ...(existing ?? {}),
      settings_version: '0.23.0',
      shell_commands: [...filtered, ...buildTidyCommands(config.api.port)],
    }, null, 2), 'utf8');
    result.shellCommands = 'configured';
  }

  // ── Hotkeys ────────────────────────────────────────────────────────────────
  const hotkeysPath = path.join(obsidianDir, 'hotkeys.json');
  const existingHotkeys = fs.existsSync(hotkeysPath)
    ? (JSON.parse(fs.readFileSync(hotkeysPath, 'utf8')) as Record<string, unknown>)
    : {};

  fs.writeFileSync(hotkeysPath, JSON.stringify({
    ...existingHotkeys,
    [`${SHELL_COMMANDS_PLUGIN_ID}:shell-command-${TIDY_LIGHT_ID}`]: [
      { modifiers: ['Ctrl', 'Shift'], key: 'T' },
    ],
    [`${SHELL_COMMANDS_PLUGIN_ID}:shell-command-${TIDY_DEEP_ID}`]: [
      { modifiers: ['Ctrl', 'Shift'], key: 'D' },
    ],
    [`${SHELL_COMMANDS_PLUGIN_ID}:shell-command-${TIDY_LIGHT_SEL_ID}`]: [
      { modifiers: ['Ctrl', 'Shift', 'Alt'], key: 'T' },
    ],
    [`${SHELL_COMMANDS_PLUGIN_ID}:shell-command-${TIDY_DEEP_SEL_ID}`]: [
      { modifiers: ['Ctrl', 'Shift', 'Alt'], key: 'D' },
    ],
  }, null, 2), 'utf8');

  // ── Ensure plugins enabled ─────────────────────────────────────────────────
  const communityPath = path.join(obsidianDir, 'community-plugins.json');
  const enabled: string[] = fs.existsSync(communityPath)
    ? (JSON.parse(fs.readFileSync(communityPath, 'utf8')) as string[])
    : [];
  let changed = false;
  for (const id of [WHISPER_PLUGIN_ID, SHELL_COMMANDS_PLUGIN_ID]) {
    if (!enabled.includes(id)) { enabled.push(id); changed = true; }
  }
  if (changed) fs.writeFileSync(communityPath, JSON.stringify(enabled, null, 2), 'utf8');

  return result;
}

// ---------------------------------------------------------------------------
// Standalone  olt obsidian-setup  command
// ---------------------------------------------------------------------------

function runObsidianSetup(): void {
  const config = readConfig();

  if (!config.obsidian.vault) {
    console.error('Error: Obsidian vault not configured. Run  olt setup  first.');
    process.exit(1);
  }
  if (!fs.existsSync(config.obsidian.vault)) {
    console.error(`Error: Vault not found at: ${config.obsidian.vault}`);
    process.exit(1);
  }

  const result = configureObsidianPlugins(config);

  if (result.whisper === 'configured') {
    console.log(`  ✔  Whisper        → apiUrl set to http://localhost:${config.whisper.port}`);
  } else {
    console.log(`  ✘  Whisper        → not installed (install from Community plugins browser)`);
  }

  if (result.shellCommands === 'configured') {
    console.log(`  ✔  Shell Commands → tidy commands + hotkeys written`);
    console.log(`       Ctrl+Shift+T  →  Tidy note (light)`);
    console.log(`       Ctrl+Shift+D  →  Tidy note (deep)`);
  } else {
    console.log(`  ✘  Shell Commands → not installed (install from Community plugins browser)`);
  }

  const allConfigured = result.whisper === 'configured' && result.shellCommands === 'configured';
  if (allConfigured) {
    console.log('\n  Restart Obsidian to apply all changes.');
  } else {
    console.log('\n  Install the missing plugins in Obsidian, then re-run  olt obsidian-setup');
  }
}

export function registerObsidianSetup(program: Command): void {
  program
    .command('obsidian-setup')
    .description('Configure Whisper and Shell Commands plugins in your Obsidian vault')
    .action(runObsidianSetup);
}
