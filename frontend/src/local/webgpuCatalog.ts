import { ProviderModelInfo } from "../types";

export interface WebGpuModelSpec {
  name: string;
  label: string;
  size_mb: number;
  parameter_size: string;
  quantization_level: string;
  family: string;
  maxContextTokens: number;
  note: string;
}

export const DEFAULT_WEBGPU_MODEL = "Qwen2.5-3B-Instruct-q4f16_1-MLC";
export const DEFAULT_WEBGPU_CONTEXT_SIZE = 4096;

export const WEBGPU_CURATED_CATALOG: readonly WebGpuModelSpec[] = [
  {
    name: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 3B Instruct (Recommended Default)",
    size_mb: 2505,
    parameter_size: "3B",
    quantization_level: "q4f16_1",
    family: "qwen2",
    maxContextTokens: 4096,
    note: "~2.5 GB VRAM · Balanced speed & JSON accuracy",
  },
  {
    name: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B Instruct",
    size_mb: 2264,
    parameter_size: "3B",
    quantization_level: "q4f16_1",
    family: "llama",
    maxContextTokens: 4096,
    note: "~2.3 GB VRAM · Fast prose",
  },
  {
    name: "Hermes-3-Llama-3.2-3B-q4f16_1-MLC",
    label: "Hermes 3 Llama 3.2 3B",
    size_mb: 2264,
    parameter_size: "3B",
    quantization_level: "q4f16_1",
    family: "llama",
    maxContextTokens: 4096,
    note: "~2.3 GB VRAM · Roleplay-tuned",
  },
  {
    name: "Qwen3-4B-q4f16_1-MLC",
    label: "Qwen 3 4B",
    size_mb: 3432,
    parameter_size: "4B",
    quantization_level: "q4f16_1",
    family: "qwen3",
    maxContextTokens: 8192,
    note: "~3.4 GB VRAM · Up to 8k ctx",
  },
  {
    name: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 7B Instruct",
    size_mb: 5107,
    parameter_size: "7B",
    quantization_level: "q4f16_1",
    family: "qwen2",
    maxContextTokens: 8192,
    note: "~5.1 GB VRAM · Stronger Clerk + Actor (8 GB+ GPU)",
  },
  {
    name: "Llama-3.1-8B-Instruct-q4f16_1-MLC",
    label: "Llama 3.1 8B Instruct",
    size_mb: 5001,
    parameter_size: "8B",
    quantization_level: "q4f16_1",
    family: "llama",
    maxContextTokens: 8192,
    note: "~5.0 GB VRAM · Needs 8 GB+ GPU",
  },
  {
    name: "Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
    label: "Hermes 3 Llama 3.1 8B",
    size_mb: 4876,
    parameter_size: "8B",
    quantization_level: "q4f16_1",
    family: "llama",
    maxContextTokens: 8192,
    note: "~4.9 GB VRAM · Strongest RP (8 GB+ GPU)",
  },
  {
    name: "Qwen3-8B-q4f16_1-MLC",
    label: "Qwen 3 8B",
    size_mb: 5696,
    parameter_size: "8B",
    quantization_level: "q4f16_1",
    family: "qwen3",
    maxContextTokens: 8192,
    note: "~5.7 GB VRAM · Needs 8 GB+ GPU",
  },
  {
    name: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    label: "SmolLM2 1.7B Instruct (Ultra-Light)",
    size_mb: 1774,
    parameter_size: "1.7B",
    quantization_level: "q4f16_1",
    family: "llama",
    maxContextTokens: 4096,
    note: "~1.8 GB VRAM · Integrated GPU friendly",
  },
  {
    name: "gemma-2-2b-it-q4f16_1-MLC",
    label: "Gemma 2 2B IT",
    size_mb: 1895,
    parameter_size: "2B",
    quantization_level: "q4f16_1",
    family: "gemma2",
    maxContextTokens: 4096,
    note: "~1.9 GB VRAM · Lightweight",
  },
] as const;

export function getWebGpuModelSpec(modelName: string | null | undefined): WebGpuModelSpec | undefined {
  if (!modelName) return undefined;
  const cleaned = modelName.replace(/:latest$/i, "");
  return WEBGPU_CURATED_CATALOG.find(
    (m) => m.name.toLowerCase() === cleaned.toLowerCase()
  );
}

export function getWebGpuModelInfos(): ProviderModelInfo[] {
  return WEBGPU_CURATED_CATALOG.map((spec) => ({
    name: spec.name,
    size_mb: spec.size_mb,
    parameter_size: spec.parameter_size,
    quantization_level: spec.quantization_level,
    family: spec.family,
    is_embedding: false,
  }));
}

export function clampWebGpuContext(
  requestedContext: number | null | undefined,
  modelName: string | null | undefined
): { effectiveContext: number; clamped: boolean; maxContext: number } {
  const spec = getWebGpuModelSpec(modelName);
  const maxContext = spec?.maxContextTokens ?? DEFAULT_WEBGPU_CONTEXT_SIZE;
  const requested = requestedContext ?? maxContext;
  if (requested > maxContext) {
    return { effectiveContext: maxContext, clamped: true, maxContext };
  }
  return { effectiveContext: Math.max(4096, requested), clamped: false, maxContext };
}

export function isWebGpuApiPresent(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator && !!(navigator as any).gpu;
}

export async function checkWebGpuAdapter(): Promise<{
  supported: boolean;
  reason?: string;
}> {
  if (!isWebGpuApiPresent()) {
    return {
      supported: false,
      reason:
        "WebGPU is not available in this browser (note: Firefox on Linux requires dom.webgpu.enabled = true in about:config).",
    };
  }
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) {
      return {
        supported: false,
        reason: "No compatible WebGPU adapter/GPU was found.",
      };
    }
    return { supported: true };
  } catch (err: any) {
    return {
      supported: false,
      reason: err?.message || "Failed to initialize WebGPU adapter.",
    };
  }
}
