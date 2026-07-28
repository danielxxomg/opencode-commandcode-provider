import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

interface ModelEntry {
  id: string
  name: string
  tier: "premium" | "open-source"
  reasoning: boolean
  tool_call: boolean
  capabilities?: Record<string, unknown>
  variants?: Record<string, unknown>
  cost: { input: number; output: number; cache_read?: number; cache_write?: number; cache?: { read: number; write: number } }
  limit: { context: number; output: number }
}

function loadModels(): ModelEntry[] {
  const modelsPath = join(__dirname, "models.json")
  return JSON.parse(readFileSync(modelsPath, "utf-8"))
}

function toConfigKey(id: string): string {
  const slashIdx = id.indexOf("/")
  const short = slashIdx >= 0 ? id.slice(slashIdx + 1) : id
  return short.toLowerCase()
}

export default async function commandcodePlugin() {
  return {
    config: async (config: Record<string, unknown>) => {
      const providers = config.provider as Record<string, Record<string, unknown>> | undefined
      if (!providers) {
        (config as Record<string, unknown>).provider = { commandcode: {} }
      }
      const cc = ((config as Record<string, unknown>).provider as Record<string, Record<string, unknown>>)?.commandcode as Record<string, unknown> | undefined
      if (!cc) return

      if (!cc.npm) cc.npm = "commandcode-go-opencode-provider"
      if (!cc.name) cc.name = "Command Code"
      if (!cc.env) cc.env = ["COMMANDCODE_API_KEY"]

      if (!cc.models) {
        const models = loadModels()
        const modelsObj: Record<string, unknown> = {}
        for (const entry of models) {
          const shortKey = toConfigKey(entry.id)
          const fullKey = entry.id.toLowerCase()
          const hyphenKey = entry.id.toLowerCase().replace(/\//g, "-")

          const costObj: Record<string, unknown> = {
            input: entry.cost.input,
            output: entry.cost.output,
            cache: entry.cost.cache ?? {
              read: entry.cost.cache_read ?? 0,
              write: entry.cost.cache_write ?? 0,
            },
          }

          const modelDef: Record<string, unknown> = {
            id: entry.id,
            name: entry.name,
            reasoning: entry.reasoning,
            tool_call: entry.tool_call,
            capabilities: entry.capabilities,
            variants: entry.variants,
            cost: costObj,
            limit: entry.limit,
          }

          modelsObj[shortKey] = modelDef
          modelsObj[fullKey] = modelDef
          modelsObj[hyphenKey] = modelDef
        }
        cc.models = modelsObj
      }
    },

    auth: {
      provider: "commandcode",
      methods: [
        {
          type: "api",
          label: "API Key",
          authorize: async (inputs: Record<string, unknown> | undefined) => {
            const rawKey = inputs?.key
            if (typeof rawKey !== "string") return { type: "failed" as const }
            const key = rawKey.trim()
            if (!key) return { type: "failed" as const }
            return { type: "success" as const, key }
          },
        },
      ],
      loader: async (getAuth: () => Promise<{ type: string; key?: string } | null>) => {
        try {
          const auth = await getAuth()
          if (!auth) return {}
          if (auth.type === "api" && auth.key) return { apiKey: auth.key }
          return {}
        } catch {
          return {}
        }
      },
    },
  }
}
