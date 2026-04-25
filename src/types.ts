export interface WhisperConfig {
  model: string;
  port: number;
}

export interface OllamaConfig {
  model: string;
  port: number;
}

export interface ApiConfig {
  port: number;
}

export type GpuType = 'nvidia' | 'apple-silicon' | 'none';

export interface GpuConfig {
  detected: boolean;
  type: GpuType;
  device: string;
}

export interface ObsidianConfig {
  vault: string;
}

export interface PromptsConfig {
  light: string | null;
  deep: string | null;
}

export interface AppConfig {
  whisper: WhisperConfig;
  ollama: OllamaConfig;
  api: ApiConfig;
  gpu: GpuConfig;
  obsidian: ObsidianConfig;
  prompts: PromptsConfig;
}

export interface TranscriptionResult {
  text: string;
  duration?: number;
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: boolean;
}

export interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}

export type TidyMode = 'light' | 'deep';

export interface TidyRequest {
  file: string;
  mode: TidyMode;
}

export interface TidyResponse {
  file: string;
  mode: TidyMode;
  duration: number;
}

export interface HealthResponse {
  status: 'ok';
  ollama: boolean;
  whisper: boolean;
  vault: string;
}

export interface ExtractedTask {
  title: string;
  priority: 'high' | 'medium' | 'low';
}

export interface WhisperModelEntry {
  name: string;
  sizeMb: number;
  url: string;
}

export interface OllamaModelEntry {
  name: string;
  description: string;
}
