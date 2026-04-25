import type { OllamaGenerateRequest, OllamaGenerateResponse } from '../types';

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(port: number, model: string) {
    this.baseUrl = `http://localhost:${port}`;
    this.model = model;
  }

  async generate(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);

    try {
      const body: OllamaGenerateRequest = { model: this.model, prompt, stream: false };
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as OllamaGenerateResponse;
      return data.response.trimEnd();
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  }

  async pullModel(name: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Failed to pull model ${name}: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as { status?: string; completed?: number; total?: number };
          if (obj.status && obj.total) {
            const pct = Math.round((obj.completed ?? 0) / obj.total * 100);
            process.stderr.write(`\r  Pulling ${name}... ${pct}%`);
          } else if (obj.status) {
            process.stderr.write(`\r  ${obj.status}${' '.repeat(20)}`);
          }
        } catch {
          // skip unparseable lines
        }
      }
    }
    process.stderr.write('\n');
  }
}
