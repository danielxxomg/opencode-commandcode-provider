import {
  loadModels,
  fetchModelsFromApi,
  mergeModels,
  toConfigKey,
  toV2ModelDraft,
} from "./src/models.js"

export const id = "commandcode-go-opencode-provider"

export interface CatalogDraft {
  provider: {
    update(providerID: string, update: (draft: Record<string, unknown>) => void): void
  }
  model: {
    update(
      providerID: string,
      modelID: string,
      update: (draft: Record<string, unknown>) => void,
    ): void
  }
}

export interface V2PluginContext {
  catalog: {
    transform(
      transform: (catalog: CatalogDraft) => void | Promise<void>,
    ): Promise<void>
  }
}

/**
 * OpenCode V2 plugin entrypoint.
 *
 * V2 loads a plugin from the module's default export, which must be an object
 * with a unique `id` and a `setup` function. `setup` registers the Command
 * Code provider and its model catalog through `ctx.catalog.transform`:
 *
 * ```json
 * {
 *   "plugins": ["commandcode-go-opencode-provider/v2"]
 * }
 * ```
 */
export default {
  id,
  setup: async (ctx: V2PluginContext): Promise<void> => {
    let models = loadModels()
    try {
      const apiModels = await fetchModelsFromApi()
      if (apiModels && apiModels.length > 0) {
        models = mergeModels(models, apiModels)
      }
    } catch {
      // Graceful fallback to bundled models
    }

    await ctx.catalog.transform((catalog) => {
      catalog.provider.update("commandcode", (draft) => {
        draft.name = "Command Code"
        draft.package = "aisdk:commandcode-go-opencode-provider"
        draft.settings = {
          baseURL: "https://api.commandcode.ai",
          ...(typeof draft.settings === "object" && draft.settings !== null
            ? (draft.settings as Record<string, unknown>)
            : {}),
        }
      })

      for (const entry of models) {
        catalog.model.update("commandcode", toConfigKey(entry.id), (draft) => {
          const model = toV2ModelDraft(entry)
          draft.modelID = model.modelID
          draft.name = model.name
          draft.capabilities = model.capabilities
          draft.limit = model.limit
          draft.cost = model.cost
        })
      }
    })
  },
}
