import type { InitProgressReport, MLCEngineInterface, ResponseFormat } from "@mlc-ai/web-llm";
import { ContextClampNotice, RelayDriverResult, RelayLlmRequest, WebGpuProgress } from "./types";
import { checkWebGpuAdapter, clampWebGpuContext } from "./webgpuCatalog";

export interface WebGpuStateListener {
  onProgress?: (progress: WebGpuProgress | null) => void;
  onLoadedModelChange?: (model: string | null) => void;
  onContextClamped?: (notice: ContextClampNotice) => void;
}

class WebGpuDriver {
  private engine: MLCEngineInterface | null = null;
  private worker: Worker | null = null;
  private loadedModel: string | null = null;
  private loadedContext: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<WebGpuStateListener>();

  subscribe(listener: WebGpuStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getLoadedModel(): string | null {
    return this.loadedModel;
  }

  private emitProgress(p: WebGpuProgress | null): void {
    for (const l of this.listeners) l.onProgress?.(p);
  }

  private emitLoadedModel(model: string | null): void {
    for (const l of this.listeners) l.onLoadedModelChange?.(model);
  }

  private emitClamped(notice: ContextClampNotice): void {
    for (const l of this.listeners) l.onContextClamped?.(notice);
  }

  private async ensureEngine(model: string, requestedContext: number | null | undefined): Promise<MLCEngineInterface> {
    const adapterCheck = await checkWebGpuAdapter();
    if (!adapterCheck.supported) {
      throw new Error(adapterCheck.reason || "WebGPU is not supported in this browser.");
    }

    const { effectiveContext, clamped } = clampWebGpuContext(requestedContext, model);
    if (clamped && requestedContext != null) {
      this.emitClamped({
        model,
        requestedContext,
        effectiveContext,
      });
    }

    if (this.engine && this.loadedModel === model && this.loadedContext === effectiveContext) {
      return this.engine;
    }

    const webllm = await import("@mlc-ai/web-llm");

    if (!this.worker) {
      this.worker = new Worker(new URL("./webgpu.worker.ts", import.meta.url), {
        type: "module",
      });
    }

    const chatOpts = effectiveContext === 4096 ? undefined : { context_window_size: effectiveContext };
    const initProgressCallback = (report: InitProgressReport) => {
      this.emitProgress({
        model,
        progress: report.progress ?? 0,
        text: report.text || "Preparing WebGPU model...",
      });
    };

    try {
      if (!this.engine) {
        this.emitProgress({ model, progress: 0, text: `Loading ${model}...` });
        this.engine = await webllm.CreateWebWorkerMLCEngine(
          this.worker,
          model,
          { initProgressCallback },
          chatOpts
        );
      } else {
        this.emitProgress({ model, progress: 0, text: `Switching WebGPU model to ${model}...` });
        await this.engine.unload();
        this.engine.setInitProgressCallback(initProgressCallback);
        await this.engine.reload(model, chatOpts);
      }
      this.loadedModel = model;
      this.loadedContext = effectiveContext;
      this.emitLoadedModel(model);
      this.emitProgress(null);
      return this.engine;
    } catch (err) {
      this.loadedModel = null;
      this.loadedContext = null;
      this.emitLoadedModel(null);
      this.emitProgress(null);
      throw err;
    }
  }

  async preload(model: string, requestedContext?: number | null): Promise<void> {
    const task = this.queue.then(() => this.ensureEngine(model, requestedContext));
    this.queue = task.catch(() => {});
    await task;
  }

  async unload(): Promise<void> {
    const task = this.queue.then(async () => {
      if (this.engine) {
        try {
          await this.engine.unload();
        } catch {
          // ignore unload errors on lost GPU device
        }
      }
      this.loadedModel = null;
      this.loadedContext = null;
      this.emitLoadedModel(null);
      this.emitProgress(null);
    });
    this.queue = task.catch(() => {});
    return task;
  }

  run(
    req: RelayLlmRequest,
    onChunk: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<RelayDriverResult> {
    const task = this.queue.then(() => this.execute(req, onChunk, signal));
    // Keep the queue alive even if one request rejects.
    this.queue = task.catch(() => {});
    return task;
  }

  private async execute(
    req: RelayLlmRequest,
    onChunk: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<RelayDriverResult> {
    if (signal?.aborted) {
      throw new Error("Request aborted before execution.");
    }

    const engine = await this.ensureEngine(req.model, req.options.context_size);

    const onAbort = () => {
      try {
        engine.interruptGenerate();
      } catch {
        // ignore interrupt errors
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      let response_format: ResponseFormat | undefined;
      if (req.options.json_schema) {
        response_format = {
          type: "json_object",
          schema: JSON.stringify(req.options.json_schema),
        };
      } else if (req.options.json_mode) {
        response_format = { type: "json_object" };
      }

      const messages = req.messages.map((m) => ({
        role: (m.role === "system" || m.role === "user" || m.role === "assistant"
          ? m.role
          : "user") as "system" | "user" | "assistant",
        content: m.content,
      }));

      if (req.mode === "stream") {
        const chunks = await engine.chat.completions.create({
          messages,
          temperature: req.options.temperature,
          max_tokens: req.options.max_tokens,
          stream: true,
        });
        let fullContent = "";
        let finishReason: string | null = null;
        for await (const chunk of chunks) {
          if (signal?.aborted) break;
          const choice = chunk.choices?.[0];
          const delta = choice?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            fullContent += delta;
            onChunk(delta);
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }
        return { content: fullContent, done_reason: finishReason };
      }

      const completion = await engine.chat.completions.create({
        messages,
        temperature: req.options.temperature,
        max_tokens: req.options.max_tokens,
        stream: false,
        response_format,
      });
      const choice = completion.choices?.[0];
      return {
        content: choice?.message?.content || "",
        done_reason: choice?.finish_reason || null,
      };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

export const webGpuDriver = new WebGpuDriver();
