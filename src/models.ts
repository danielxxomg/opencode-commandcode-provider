import { readFileSync, existsSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface ModelEntry {
  id: string
  name: string
  tier: "premium" | "open-source"
  reasoning: boolean
  tool_call: boolean
  capabilities?: {
    vision?: boolean
    pdf?: boolean
    reasoning?: boolean
    tool_call?: boolean
    [key: string]: unknown
  }
  variants?: Record<string, unknown>
  cost: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
    cache?: { read: number; write: number }
  }
  limit: { context: number; output: number }
}

export interface ApiModel {
  id: string
  name?: string
  context_length?: number
}

export function loadPluginConfig(): { disableModelSync?: boolean } {
  const configPath = join(homedir(), ".config", "opencode", "commandcode-go-opencode-provider.json")
  if (!existsSync(configPath)) return {}
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"))
  } catch {
    return {}
  }
}

export function loadModels(): ModelEntry[] {
  const modelsPath = join(__dirname, "..", "models.json")
  try {
    return JSON.parse(readFileSync(modelsPath, "utf-8"))
  } catch (err) {
    throw new Error(
      `Bundled models.json missing or corrupt at ${modelsPath}; ` +
        `please reinstall commandcode-go-opencode-provider.`,
      { cause: err },
    )
  }
}

export async function fetchModelsFromApi(
  apiKey?: string,
  fetchFn: typeof fetch = fetch,
): Promise<ApiModel[] | null> {
  if (loadPluginConfig().disableModelSync) return null

  const key = apiKey || process.env.COMMANDCODE_API_KEY
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const headers: Record<string, string> = {}
    if (key) {
      headers["Authorization"] = `Bearer ${key}`
    }

    const resp = await fetchFn("https://api.commandcode.ai/provider/v1/models", {
      headers,
      signal: controller.signal,
    })

    if (!resp.ok) return null
    const data = (await resp.json()) as { data?: ApiModel[] }
    return data.data ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export function mergeModels(local: ModelEntry[], api: ApiModel[]): ModelEntry[] {
  const apiMap = new Map(api.map((m) => [m.id, m]))
  const merged: ModelEntry[] = []

  for (const entry of local) {
    const apiModel = apiMap.get(entry.id)
    if (apiModel?.context_length) {
      merged.push({
        ...entry,
        limit: { ...entry.limit, context: apiModel.context_length },
      })
    } else {
      merged.push(entry)
    }
    apiMap.delete(entry.id)
  }

  for (const [id, apiModel] of apiMap) {
    const isReasoning =
      /reasoning|r1|thinking|kimi-k|glm-5|sol|terra|luna/i.test(id) ||
      /reasoning|r1|thinking/i.test(apiModel.name ?? "")
    const isVision = /vision|gemini|claude|gpt|grok/i.test(id)

    merged.push({
      id,
      name: apiModel.name ?? id.split("/").pop() ?? id,
      tier: id.includes("/") ? "open-source" : "premium",
      reasoning: isReasoning,
      tool_call: true,
      capabilities: {
        vision: isVision,
        pdf: /claude|gemini|gpt/i.test(id),
        reasoning: isReasoning,
        tool_call: true,
      },
      cost: { input: 0, output: 0 },
      limit: { context: apiModel.context_length ?? 131072, output: 131072 },
    })
  }

  return merged
}

export function toConfigKey(id: string): string {
  const slashIdx = id.indexOf("/")
  const short = slashIdx >= 0 ? id.slice(slashIdx + 1) : id
  return short.toLowerCase()
}

export interface V1ModelConfig {
  id: string
  name: string
  reasoning: boolean
  tool_call: boolean
  capabilities?: Record<string, unknown>
  variants?: Record<string, unknown>
  cost: Record<string, unknown>
  limit: { context: number; output: number }
}

export function toV1ModelConfig(entry: ModelEntry): V1ModelConfig {
  const cost: Record<string, unknown> = {
    input: entry.cost.input,
    output: entry.cost.output,
    cache: entry.cost.cache ?? {
      read: entry.cost.cache_read ?? 0,
      write: entry.cost.cache_write ?? 0,
    },
  }
  return {
    id: entry.id,
    name: entry.name,
    reasoning: entry.reasoning,
    tool_call: entry.tool_call,
    capabilities: entry.capabilities,
    variants: entry.variants,
    cost,
    limit: entry.limit,
  }
}

export interface V2ModelDraft {
  modelID: string
  name: string
  capabilities: { tools: boolean; input: string[]; output: string[] }
  limit: { context: number; output: number }
  cost: {
    input: number
    output: number
    cache?: { read: number; write: number }
  }
}

export function toV2ModelDraft(entry: ModelEntry): V2ModelDraft {
  const inputTypes = ["text"]
  if (entry.capabilities?.vision) inputTypes.push("image")
  if (entry.capabilities?.pdf) inputTypes.push("pdf")

  const draft: V2ModelDraft = {
    modelID: entry.id,
    name: entry.name,
    capabilities: {
      tools: entry.tool_call,
      input: inputTypes,
      output: ["text"],
    },
    limit: entry.limit,
    cost: { input: entry.cost.input, output: entry.cost.output },
  }
  if (entry.cost.cache_read !== undefined || entry.cost.cache !== undefined) {
    draft.cost.cache = entry.cost.cache ?? {
      read: entry.cost.cache_read ?? 0,
      write: entry.cost.cache_write ?? 0,
    }
  }
  return draft
}

export function toV2ModelMap(entries: ModelEntry[]): Record<string, V2ModelDraft> {
  const map: Record<string, V2ModelDraft> = {}
  for (const entry of entries) {
    map[toConfigKey(entry.id)] = toV2ModelDraft(entry)
  }
  return map
}
