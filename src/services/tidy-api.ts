import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AppConfig, TidyMode, TidyRequest, TidyResponse, HealthResponse } from '../types';
import { OllamaClient } from './ollama-client';
import { WhisperClient } from './whisper-client';

const MAX_BODY_SIZE = 1_048_576; // 1 MB

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('Request body too large'));
        return;
      }
      data += chunk.toString();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function validateFilePath(
  vaultPath: string,
  requestedFile: string
): { valid: true; resolved: string } | { valid: false; error: string; status: number } {
  if (requestedFile.includes('..')) {
    return { valid: false, error: 'Invalid path: path traversal not allowed', status: 400 };
  }

  const normalizedVault = path.normalize(vaultPath);
  const resolved = path.resolve(normalizedVault, requestedFile);

  if (!resolved.startsWith(normalizedVault + path.sep) && resolved !== normalizedVault) {
    return { valid: false, error: 'Path outside vault', status: 403 };
  }

  return { valid: true, resolved };
}

function loadPrompt(mode: TidyMode, config: AppConfig): string {
  // Check user override in config
  const overridePath = mode === 'light' ? config.prompts.light : config.prompts.deep;
  if (overridePath && fs.existsSync(overridePath)) {
    return fs.readFileSync(overridePath, 'utf8');
  }

  // Check convention-based override directory
  const { getConfigDir } = require('./config') as typeof import('./config');
  const conventionPath = path.join(getConfigDir(), 'prompts', `${mode}-tidy.md`);
  if (fs.existsSync(conventionPath)) {
    return fs.readFileSync(conventionPath, 'utf8');
  }

  // Fall back to bundled prompt
  const bundledPath = path.join(__dirname, '..', 'prompts', `${mode}-tidy.md`);
  return fs.readFileSync(bundledPath, 'utf8');
}

export class TidyApiServer {
  private server: http.Server;
  private readonly config: AppConfig;
  private readonly ollama: OllamaClient;
  private readonly whisper: WhisperClient;
  private readonly activeRequests = new Set<string>();

  constructor(config: AppConfig) {
    this.config = config;
    this.ollama = new OllamaClient(config.ollama.port, config.ollama.model);
    this.whisper = new WhisperClient(config.whisper.port);
    this.server = http.createServer((req, res) => { void this.handleRequest(req, res); });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Content-Type', 'application/json');

    try {
      if (req.method === 'POST' && req.url === '/tidy') {
        await this.handleTidy(req, res);
      } else if (req.method === 'POST' && req.url?.startsWith('/tidy-text')) {
        await this.handleTidyText(req, res);
      } else if (req.method === 'GET' && req.url === '/health') {
        await this.handleHealth(res);
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
      console.error('[tidy-api] Error:', err);
    }
  }

  private async handleTidy(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: string;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(413);
      res.end(JSON.stringify({ error: 'Request body too large' }));
      return;
    }

    let parsed: Partial<TidyRequest>;
    try {
      parsed = JSON.parse(body) as Partial<TidyRequest>;
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    const { file, mode = 'light' } = parsed;

    if (!file || typeof file !== 'string') {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing required field: file' }));
      return;
    }

    if (mode !== 'light' && mode !== 'deep') {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid mode: must be "light" or "deep"' }));
      return;
    }

    const vault = this.config.obsidian.vault;
    if (!vault) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Vault not configured. Run olt setup first.' }));
      return;
    }

    const validation = validateFilePath(vault, file);
    if (!validation.valid) {
      res.writeHead(validation.status);
      res.end(JSON.stringify({ error: validation.error }));
      return;
    }

    const { resolved } = validation;

    if (!fs.existsSync(resolved)) {
      res.writeHead(404);
      res.setHeader('Content-Type', 'text/plain');
      res.end('File not found in vault');
      return;
    }

    if (this.activeRequests.has(resolved)) {
      res.writeHead(429);
      res.setHeader('Content-Type', 'text/plain');
      res.end('⏳ Already tidying this note — please wait');
      return;
    }

    this.activeRequests.add(resolved);
    try {
      const content = fs.readFileSync(resolved, 'utf8');
      const promptTemplate = loadPrompt(mode, this.config);
      const fullPrompt = promptTemplate.replace('{text}', content);

      const start = performance.now();
      const tidied = await this.ollama.generate(fullPrompt);
      const duration = (performance.now() - start) / 1000;

      fs.writeFileSync(resolved, tidied, 'utf8');

      const relPath = path.relative(vault, resolved);
      const label = mode === 'light' ? 'Light' : 'Deep';
      console.log(`[tidy] ${mode} ${relPath} (${duration.toFixed(1)}s)`);

      res.setHeader('Content-Type', 'text/plain');
      res.writeHead(200);
      res.end(`✅ ${label} tidy done (${duration.toFixed(1)}s)`);
    } catch {
      res.writeHead(422);
      res.setHeader('Content-Type', 'text/plain');
      res.end('❌ Ollama unavailable or model not loaded');
    } finally {
      this.activeRequests.delete(resolved);
    }
  }

  private async handleTidyText(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Parse mode from query string: /tidy-text?mode=light|deep
    const mode: TidyMode = req.url?.includes('mode=deep') ? 'deep' : 'light';

    let text: string;
    try {
      text = await readBody(req);
    } catch {
      res.writeHead(413);
      res.end('Request body too large');
      return;
    }

    if (!text.trim()) {
      res.writeHead(400);
      res.end('No text provided');
      return;
    }

    const key = 'selection';
    if (this.activeRequests.has(key)) {
      res.writeHead(429);
      // Non-200 with -sf curl flag means nothing reaches current-file-caret
      res.end('Already tidying selection');
      return;
    }

    this.activeRequests.add(key);
    try {
      const start = performance.now();
      const promptTemplate = loadPrompt(mode, this.config);
      const fullPrompt = promptTemplate.replace('{text}', text);
      const tidied = await this.ollama.generate(fullPrompt);
      const duration = (performance.now() - start) / 1000;

      console.log(`[tidy-text] ${mode} (${duration.toFixed(1)}s)`);

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.writeHead(200);
      res.end(tidied);
    } catch {
      res.writeHead(422);
      res.end('Ollama unavailable or model not loaded');
    } finally {
      this.activeRequests.delete(key);
    }
  }

  private async handleHealth(res: http.ServerResponse): Promise<void> {
    const [ollamaOk, whisperOk] = await Promise.all([
      this.ollama.health(),
      this.whisper.health(),
    ]);

    const response: HealthResponse = {
      status: 'ok',
      ollama: ollamaOk,
      whisper: whisperOk,
      vault: this.config.obsidian.vault,
    };

    res.writeHead(200);
    res.end(JSON.stringify(response));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.config.api.port, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
