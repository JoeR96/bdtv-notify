import * as fs from 'node:fs';
import type { TranscriptionResult } from '../types';

export class WhisperClient {
  private readonly baseUrl: string;

  constructor(port: number) {
    this.baseUrl = `http://localhost:${port}`;
  }

  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    const fileBytes = fs.readFileSync(audioPath);
    const filename = audioPath.split(/[\\/]/).pop() ?? 'audio.wav';

    const formData = new FormData();
    formData.append('file', new Blob([fileBytes]), filename);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);

    try {
      const start = performance.now();
      const res = await fetch(`${this.baseUrl}/inference`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Whisper returned ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as { text?: string };
      const duration = Math.round(performance.now() - start);
      return { text: (data.text ?? '').trim(), duration };
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
