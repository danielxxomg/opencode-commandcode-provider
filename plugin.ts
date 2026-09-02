import {
  loadModels,
  fetchModelsFromApi,
  mergeModels,
  toConfigKey,
  toV1ModelConfig,
  type ModelEntry,
} from "./src/models.js"

export default async function commandcodePlugin() {
  return {
    config: async (config: Record<string, unknown>) => {
      const providers = config.provider as Record<string, Record<string, unknown>> | undefined
      if (!providers) {
        ;(config as Record<string, unknown>).provider = { commandcode: {} }
      }
      const cc = ((config as Record<string, unknown>).provider as Record<string, Record<string, unknown>>)?.commandcode as
        | Record<string, unknown>
        | undefined
      if (!cc) return

      if (!cc.npm) cc.npm = "commandcode-go-opencode-provider"
      if (!cc.name) cc.name = "Command Code"
      if (!cc.env) cc.env = ["COMMANDCODE_API_KEY"]

      if (!cc.models) {
        let models = loadModels()
        try {
          const apiModels = await fetchModelsFromApi()
          if (apiModels && apiModels.length > 0) {
            models = mergeModels(models, apiModels)
          }
        } catch {
          // Graceful fallback to bundled models
        }

        const modelsObj: Record<string, unknown> = {}
        for (const entry of models) {
          const shortKey = toConfigKey(entry.id)
          const fullKey = entry.id.toLowerCase()
          const hyphenKey = entry.id.toLowerCase().replace(/\//g, "-")

          const modelDef = toV1ModelConfig(entry)

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
