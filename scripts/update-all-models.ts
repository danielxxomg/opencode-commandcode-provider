import { writeFileSync } from "fs"
import { join } from "path"

export interface ModelVariant {
  [key: string]: unknown
}

export interface ModelCapabilities {
  temperature: boolean
  reasoning: boolean
  attachment: boolean
  toolcall: boolean
  input: {
    text: boolean
    image: boolean
    pdf: boolean
    audio: boolean
    video: boolean
  }
  output: {
    text: boolean
    image: boolean
    pdf: boolean
    audio: boolean
    video: boolean
  }
  interleaved?: boolean | { field: string }
}

export interface ModelCost {
  input: number
  output: number
  cache: {
    read: number
    write: number
  }
}

export interface ModelEntry {
  id: string
  name: string
  tier: "premium" | "open-source"
  reasoning: boolean
  tool_call: boolean
  capabilities: ModelCapabilities
  variants?: Record<string, ModelVariant>
  cost: ModelCost
  limit: { context: number; output: number }
}

const DEFAULT_REASONING_VARIANTS: Record<string, ModelVariant> = {
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
}

interface RawModelConfig {
  name: string
  tier?: "premium" | "open-source"
  reasoning?: boolean
  hasVision?: boolean
  hasPdf?: boolean
  costInput?: number
  costOutput?: number
  cacheRead?: number
  cacheWrite?: number
  contextLimit?: number
  outputLimit?: number
  variants?: Record<string, ModelVariant>
}

const MODEL_CATALOG: Record<string, RawModelConfig> = {
  // Xiaomi Mimo
  "xiaomi/mimo-v2.5-pro": { name: "Xiaomi Mimo V2.5 Pro", tier: "open-source", reasoning: true, hasVision: true, costInput: 0.2, costOutput: 0.6, contextLimit: 1000000, outputLimit: 131072 },
  "xiaomi/mimo-v2.5": { name: "Xiaomi Mimo V2.5", tier: "open-source", reasoning: true, hasVision: true, costInput: 0.1, costOutput: 0.3, contextLimit: 1000000, outputLimit: 131072 },

  // Anthropic
  "claude-sonnet-5": { name: "Claude Sonnet 5", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 3.0, costOutput: 15.0, contextLimit: 1000000, outputLimit: 64000 },
  "claude-sonnet-4-6": { name: "Claude Sonnet 4.6", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 3.0, costOutput: 15.0, contextLimit: 1000000, outputLimit: 32000 },
  "claude-fable-5": { name: "Claude Fable 5", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 3.0, costOutput: 15.0, contextLimit: 1000000, outputLimit: 64000 },
  "claude-opus-5": { name: "Claude Opus 5", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 15.0, costOutput: 75.0, contextLimit: 1000000, outputLimit: 64000 },
  "claude-opus-4-8": { name: "Claude Opus 4.8", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 15.0, costOutput: 75.0, contextLimit: 1000000, outputLimit: 32000 },
  "claude-opus-4-7": { name: "Claude Opus 4.7", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 15.0, costOutput: 75.0, contextLimit: 1000000, outputLimit: 32000 },
  "claude-haiku-4-5-20251001": { name: "Claude Haiku 4.5", tier: "premium", reasoning: false, hasVision: true, costInput: 0.8, costOutput: 4.0, contextLimit: 200000, outputLimit: 8192 },

  // OpenAI
  "gpt-5.6-sol": { name: "GPT-5.6 Sol", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 2.5, costOutput: 10.0, contextLimit: 1000000, outputLimit: 128000 },
  "gpt-5.6-terra": { name: "GPT-5.6 Terra", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 1.5, costOutput: 6.0, contextLimit: 500000, outputLimit: 128000 },
  "gpt-5.6-luna": { name: "GPT-5.6 Luna", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 0.5, costOutput: 2.0, contextLimit: 256000, outputLimit: 64000 },
  "gpt-5.5": { name: "GPT-5.5", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 2.5, costOutput: 10.0, contextLimit: 256000, outputLimit: 128000 },
  "gpt-5.4": { name: "GPT-5.4", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 2.5, costOutput: 10.0, contextLimit: 256000, outputLimit: 128000 },
  "gpt-5.3-codex": { name: "GPT-5.3 Codex", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 2.5, costOutput: 10.0, contextLimit: 400000, outputLimit: 128000 },
  "gpt-5.4-mini": { name: "GPT-5.4 Mini", tier: "premium", reasoning: true, hasVision: true, hasPdf: true, costInput: 0.15, costOutput: 0.6, contextLimit: 400000, outputLimit: 64000 },

  // DeepSeek
  "deepseek/deepseek-v4-pro": { name: "DeepSeek V4 Pro", tier: "open-source", reasoning: true, costInput: 0.435, costOutput: 0.87, cacheRead: 0.003625, contextLimit: 1000000, outputLimit: 384000 },
  "deepseek/deepseek-v4-flash": { name: "DeepSeek V4 Flash", tier: "open-source", reasoning: true, costInput: 0.14, costOutput: 0.28, cacheRead: 0.01, contextLimit: 1000000, outputLimit: 384000 },

  // Moonshot Kimi
  "moonshotai/Kimi-K3": { name: "Kimi K3", tier: "open-source", reasoning: true, hasVision: true, costInput: 0.6, costOutput: 2.4, contextLimit: 1000000, outputLimit: 131072 },
  "moonshotai/Kimi-K2.7-Code": { name: "Kimi K2.7 Code", tier: "open-source", reasoning: true, hasVision: true, costInput: 0.5, costOutput: 2.0, contextLimit: 500000, outputLimit: 131072 },
  "moonshotai/Kimi-K2.7-Code-Highspeed": { name: "Kimi K2.7 Code Highspeed", tier: "open-source", reasoning: true, hasVision: true, costInput: 0.5, costOutput: 2.0, contextLimit: 500000, outputLimit: 131072 },
  "moonshotai/Kimi-K2.6": { name: "Kimi K2.6", tier: "open-source", reasoning: false, hasVision: true, costInput: 0.4, costOutput: 1.6, contextLimit: 262144, outputLimit: 131072 },
  "moonshotai/Kimi-K2.5": { name: "Kimi K2.5", tier: "open-source", reasoning: false, hasVision: true, costInput: 0.3, costOutput: 1.2, contextLimit: 262144, outputLimit: 131072 },

  // Zhipu GLM
  "zai-org/GLM-5.2": { name: "GLM-5.2", tier: "open-source", reasoning: true, costInput: 1.0, costOutput: 3.0, contextLimit: 1000000, outputLimit: 131072 },
  "zai-org/GLM-5.2-Fast": { name: "GLM-5.2 Fast", tier: "open-source", reasoning: true, costInput: 0.5, costOutput: 1.5, contextLimit: 1000000, outputLimit: 131072 },
  "zai-org/GLM-5.1": { name: "GLM-5.1", tier: "open-source", reasoning: false, costInput: 1.4, costOutput: 4.4, cacheRead: 0.26, contextLimit: 200000, outputLimit: 131072 },
  "zai-org/GLM-5": { name: "GLM-5", tier: "open-source", reasoning: false, costInput: 1.0, costOutput: 3.0, contextLimit: 200000, outputLimit: 131072 },

  // MiniMax
  "MiniMaxAI/MiniMax-M3-Free": { name: "MiniMax M3 (Free)", tier: "open-source", reasoning: true, costInput: 0, costOutput: 0, contextLimit: 1000000, outputLimit: 131072 },
  "MiniMaxAI/MiniMax-M3": { name: "MiniMax M3", tier: "open-source", reasoning: true, costInput: 0.5, costOutput: 2.0, contextLimit: 1000000, outputLimit: 131072 },
  "MiniMaxAI/MiniMax-M2.7": { name: "MiniMax M2.7", tier: "open-source", reasoning: false, costInput: 0.3, costOutput: 1.2, cacheRead: 0.06, contextLimit: 1000000, outputLimit: 131072 },
  "MiniMaxAI/MiniMax-M2.5": { name: "MiniMax M2.5", tier: "open-source", reasoning: false, costInput: 0.2, costOutput: 0.8, contextLimit: 1000000, outputLimit: 131072 },

  // Qwen
  "Qwen/Qwen3.6-Max-Preview": { name: "Qwen 3.6 Max Preview", tier: "open-source", reasoning: true, costInput: 1.3, costOutput: 7.8, cacheRead: 0.26, cacheWrite: 1.63, contextLimit: 1000000, outputLimit: 131072 },
  "Qwen/Qwen3.6-Plus": { name: "Qwen 3.6 Plus", tier: "open-source", reasoning: true, costInput: 0.5, costOutput: 3.0, cacheRead: 0.1, contextLimit: 1000000, outputLimit: 131072 },
  "Qwen/Qwen3.7-Max": { name: "Qwen 3.7 Max", tier: "open-source", reasoning: true, costInput: 1.25, costOutput: 3.75, cacheRead: 0.25, cacheWrite: 1.56, contextLimit: 1000000, outputLimit: 131072 },
  "Qwen/Qwen3.7-Plus": { name: "Qwen 3.7 Plus", tier: "open-source", reasoning: true, costInput: 0.4, costOutput: 1.2, contextLimit: 1000000, outputLimit: 131072 },

  // StepFun
  "stepfun/Step-3.7-Flash": { name: "Step 3.7 Flash", tier: "open-source", reasoning: true, hasVision: true, costInput: 0.15, costOutput: 0.45, contextLimit: 1000000, outputLimit: 131072 },
  "stepfun/Step-3.5-Flash": { name: "Step 3.5 Flash", tier: "open-source", reasoning: true, costInput: 0.1, costOutput: 0.3, cacheRead: 0.02, contextLimit: 1000000, outputLimit: 131072 },

  // Tencent
  "tencent/hy3-paid": { name: "Tencent Hy3 Paid", tier: "open-source", reasoning: true, costInput: 0.3, costOutput: 0.9, contextLimit: 1000000, outputLimit: 131072 },
  "tencent/Hy3": { name: "Tencent Hy3", tier: "open-source", reasoning: true, costInput: 0.2, costOutput: 0.6, contextLimit: 1000000, outputLimit: 131072 },

  // Google
  "google/gemini-3.6-flash": { name: "Gemini 3.6 Flash", tier: "open-source", reasoning: true, hasVision: true, hasPdf: true, costInput: 1.5, costOutput: 9.0, cacheRead: 0.15, contextLimit: 1000000, outputLimit: 65536 },
  "google/gemini-3.5-flash": { name: "Gemini 3.5 Flash", tier: "open-source", reasoning: true, hasVision: true, hasPdf: true, costInput: 1.5, costOutput: 9.0, cacheRead: 0.15, contextLimit: 1000000, outputLimit: 65536 },
  "google/gemini-3.5-flash-lite": { name: "Gemini 3.5 Flash Lite", tier: "open-source", reasoning: true, hasVision: true, hasPdf: true, costInput: 0.25, costOutput: 1.5, cacheRead: 0.03, contextLimit: 1000000, outputLimit: 65536 },
  "google/gemini-3.1-flash-lite": { name: "Gemini 3.1 Flash Lite", tier: "open-source", reasoning: true, hasVision: true, hasPdf: true, costInput: 0.25, costOutput: 1.5, cacheRead: 0.03, contextLimit: 1000000, outputLimit: 65536 },

  // Miscellaneous
  "thinkingmachines/inkling": { name: "Inkling", tier: "open-source", reasoning: true, costInput: 0.2, costOutput: 0.8, contextLimit: 1000000, outputLimit: 131072 },
  "sakana/fugu-ultra": { name: "Sakana Fugu Ultra", tier: "open-source", reasoning: true, costInput: 1.0, costOutput: 3.0, contextLimit: 1000000, outputLimit: 131072 },
  "xai/grok-4.5": { name: "xAI Grok 4.5", tier: "open-source", reasoning: true, costInput: 2.0, costOutput: 6.0, contextLimit: 1000000, outputLimit: 131072 },
  "meta/muse-spark-1.1": { name: "Meta Muse Spark 1.1", tier: "open-source", reasoning: true, hasVision: true, costInput: 0.2, costOutput: 0.6, contextLimit: 1000000, outputLimit: 131072 },
  "nvidia/nemotron-3-ultra-550b-a55b": { name: "Nvidia Nemotron 3 Ultra", tier: "open-source", reasoning: true, costInput: 0.5, costOutput: 1.5, contextLimit: 1000000, outputLimit: 131072 },
  "poolside/laguna-s-2.1-free": { name: "Poolside Laguna S 2.1 (Free)", tier: "open-source", reasoning: true, costInput: 0, costOutput: 0, contextLimit: 1000000, outputLimit: 131072 },
  "inclusionai/ling-3.0-flash-free": { name: "InclusionAI Ling 3.0 Flash (Free)", tier: "open-source", reasoning: true, costInput: 0, costOutput: 0, contextLimit: 1000000, outputLimit: 131072 }
}

function main() {
  const modelEntries: ModelEntry[] = []

  for (const [id, raw] of Object.entries(MODEL_CATALOG)) {
    const isReasoning = raw.reasoning ?? true
    const hasVision = raw.hasVision ?? false
    const hasPdf = raw.hasPdf ?? false

    const capabilities: ModelCapabilities = {
      temperature: true,
      reasoning: isReasoning,
      attachment: hasVision || hasPdf,
      toolcall: true,
      input: {
        text: true,
        image: hasVision,
        pdf: hasPdf,
        audio: false,
        video: false,
      },
      output: {
        text: true,
        image: false,
        pdf: false,
        audio: false,
        video: false,
      },
      interleaved: isReasoning ? { field: "reasoning_content" } : false,
    }

    const entry: ModelEntry = {
      id,
      name: raw.name || id,
      tier: raw.tier || (id.includes("/") ? "open-source" : "premium"),
      reasoning: isReasoning,
      tool_call: true,
      capabilities,
      variants: isReasoning ? (raw.variants || DEFAULT_REASONING_VARIANTS) : undefined,
      cost: {
        input: raw.costInput ?? 0.5,
        output: raw.costOutput ?? 1.5,
        cache: {
          read: raw.cacheRead ?? 0,
          write: raw.cacheWrite ?? 0,
        },
      },
      limit: {
        context: raw.contextLimit ?? 1000000,
        output: raw.outputLimit ?? 131072,
      },
    }

    modelEntries.push(entry)
  }

  const projectRoot = join(import.meta.dir, "..")
  const outputPath = join(projectRoot, "models.json")

  writeFileSync(outputPath, JSON.stringify(modelEntries, null, 2) + "\n", "utf-8")
  console.log(`Successfully generated full-schema models.json for ${modelEntries.length} models`)
}

main()
