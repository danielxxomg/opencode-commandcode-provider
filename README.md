# commandcode-go-opencode-provider

[Command Code](https://commandcode.ai) API provider for [opencode](https://opencode.ai). Use Claude, GPT, Gemini, DeepSeek, Qwen, Kimi, GLM, MiniMax, Step, and other models through a single API key.

> **This fork** adds production-grade retry/backoff, SSE error propagation, and
> key rotation on top of the [original by @brent-weatherall](https://github.com/brent-weatherall/opencode-commandcode-provider).

## What this fork adds (v0.5.0)

- **Automatic Model Discovery**: fetches current model roster and context limits from Command Code's API at startup with zero-latency fallback to the bundled 67-model offline catalog.
- **OpenCode 2 (V2) Support**: native `./v2` entrypoint (`plugins: ["commandcode-go-opencode-provider/v2"]`) with automatic provider catalog transformation.
- **Project & Git Context**: gathers project file tree (respecting `.gitignore`) and Git metadata (branch, status, recent commits) with in-memory caching to empower Command Code's Plan Mode.
- **Reasoning Effort / Thinking Configuration**: support for custom thinking levels (`low`, `medium`, `high`, `max`) on reasoning models.
- **Production-grade Retry with Jitter**: fixed backoff schedule `[1s, 2.5s, 5s]` with ±25% jitter replaces unbounded exponential growth.
- **Error Classification**: 18 non-retryable patterns (auth/quota/validation) and 24 retryable patterns (network/server/timeout).
- **Mid-stream Reconnect & SSE Error Propagation**: `emittedContent` tracking prevents duplicates; SSE error events terminate streams via `controller.error()`.

## Quick Start

### 1. Install from this fork

```bash
git clone https://github.com/danielxxomg/opencode-commandcode-provider.git
cd opencode-commandcode-provider
bun install
```

### 2. Register in OpenCode

#### For OpenCode 2 (V2):
Add to your `opencode.json`:
```json
{
  "plugins": ["commandcode-go-opencode-provider/v2"]
}
```

#### For OpenCode 1 (V1):
Add to your `~/.config/opencode/opencode.json`:
```json
{
  "plugin": ["commandcode-go-opencode-provider/server"],
  "provider": {
    "commandcode": {
      "npm": "commandcode-go-opencode-provider",
      "name": "Command Code",
      "env": ["COMMANDCODE_API_KEY"]
    }
  }
}
```

Or use the local file path if you don't want to publish to npm:

```json
{
  "plugin": ["file:///path/to/opencode-commandcode-provider/plugin.ts"],
  "provider": {
    "commandcode": {
      "npm": "file:///path/to/opencode-commandcode-provider",
      "name": "Command Code (local)",
      "env": ["COMMANDCODE_API_KEY"]
    }
  }
}
```

### 3. Connect

Run `/connect` in opencode, search for **Command Code**, and enter your API key:

```
/connect
```

Or set the environment variable:

```bash
COMMANDCODE_API_KEY=your-key opencode
```

### 4. Select a model

```
/models
```

## Available Models

| Model ID | Name | Tier | Reasoning | Context |
|---|---|---|---|---|
| `xiaomi/mimo-v2.5-pro`                     | Xiaomi Mimo V2.5 Pro        | open-source  | yes | 1M     |
| `xiaomi/mimo-v2.5`                         | Xiaomi Mimo V2.5            | open-source  | yes | 1M     |
| `claude-sonnet-5`                          | Claude Sonnet 5             | premium      | yes | 1M     |
| `claude-sonnet-4-6`                        | Claude Sonnet 4.6           | premium      | yes | 1M     |
| `claude-fable-5`                           | Claude Fable 5              | premium      | yes | 1M     |
| `claude-opus-5`                            | Claude Opus 5               | premium      | yes | 1M     |
| `claude-opus-4-8`                          | Claude Opus 4.8             | premium      | yes | 1M     |
| `claude-opus-4-7`                          | Claude Opus 4.7             | premium      | yes | 1M     |
| `claude-haiku-4-5-20251001`                | Claude Haiku 4.5            | premium      | no  | 200K   |
| `gpt-5.6-sol`                              | GPT-5.6 Sol                 | premium      | yes | 1M     |
| `gpt-5.6-terra`                            | GPT-5.6 Terra               | premium      | yes | 1M     |
| `gpt-5.6-luna`                             | GPT-5.6 Luna                | premium      | yes | 1M     |
| `gpt-5.5`                                  | GPT-5.5                     | premium      | yes | 400K   |
| `gpt-5.4`                                  | GPT-5.4                     | premium      | yes | 400K   |
| `gpt-5.3-codex`                            | GPT-5.3 Codex               | premium      | yes | 400K   |
| `gpt-5.4-mini`                             | GPT-5.4 Mini                | premium      | yes | 400K   |
| `deepseek/deepseek-v4-pro`                 | DeepSeek V4 Pro             | open-source  | yes | 1M     |
| `deepseek/deepseek-v4-flash`               | DeepSeek V4 Flash           | open-source  | yes | 1M     |
| `moonshotai/Kimi-K3`                       | Kimi K3                     | open-source  | yes | 1M     |
| `moonshotai/Kimi-K2.7-Code`                | Kimi K2.7 Code              | open-source  | yes | 500K   |
| `moonshotai/Kimi-K2.7-Code-Highspeed`      | Kimi K2.7 Code Highspeed    | open-source  | yes | 500K   |
| `moonshotai/Kimi-K2.6`                     | Kimi K2.6                   | open-source  | no  | 262K   |
| `moonshotai/Kimi-K2.5`                     | Kimi K2.5                   | open-source  | no  | 262K   |
| `zai-org/GLM-5.2`                          | GLM-5.2                     | open-source  | yes | 1M     |
| `zai-org/GLM-5.2-Fast`                     | GLM-5.2 Fast                | open-source  | yes | 1M     |
| `zai-org/GLM-5.1`                          | GLM-5.1                     | open-source  | no  | 200K   |
| `zai-org/GLM-5`                            | GLM-5                       | open-source  | no  | 200K   |
| `MiniMaxAI/MiniMax-M3-Free`                | MiniMax M3 (Free)           | open-source  | yes | 1M     |
| `MiniMaxAI/MiniMax-M3`                     | MiniMax M3                  | open-source  | yes | 1M     |
| `MiniMaxAI/MiniMax-M2.7`                   | MiniMax M2.7                | open-source  | no  | 1M     |
| `MiniMaxAI/MiniMax-M2.5`                   | MiniMax M2.5                | open-source  | no  | 1M     |
| `Qwen/Qwen3.6-Max-Preview`                 | Qwen 3.6 Max Preview        | open-source  | yes | 1M     |
| `Qwen/Qwen3.6-Plus`                        | Qwen 3.6 Plus               | open-source  | yes | 1M     |
| `Qwen/Qwen3.7-Max`                         | Qwen 3.7 Max                | open-source  | yes | 1M     |
| `Qwen/Qwen3.7-Plus`                        | Qwen 3.7 Plus               | open-source  | yes | 1M     |
| `stepfun/Step-3.7-Flash`                   | Step 3.7 Flash              | open-source  | yes | 1M     |
| `stepfun/Step-3.5-Flash`                   | Step 3.5 Flash              | open-source  | yes | 1M     |
| `tencent/hy3-paid`                         | Tencent Hy3 Paid            | open-source  | yes | 1M     |
| `tencent/Hy3`                              | Tencent Hy3                 | open-source  | yes | 1M     |
| `google/gemini-3.6-flash`                  | Gemini 3.6 Flash            | open-source  | yes | 1M     |
| `google/gemini-3.5-flash`                  | Gemini 3.5 Flash            | open-source  | yes | 1M     |
| `google/gemini-3.5-flash-lite`             | Gemini 3.5 Flash Lite       | open-source  | yes | 1M     |
| `google/gemini-3.1-flash-lite`             | Gemini 3.1 Flash Lite       | open-source  | yes | 1M     |
| `thinkingmachines/inkling`                 | Inkling                     | open-source  | yes | 1M     |
| `sakana/fugu-ultra`                        | Sakana Fugu Ultra           | open-source  | yes | 1M     |
| `xai/grok-4.5`                             | xAI Grok 4.5                | open-source  | yes | 1M     |
| `meta/muse-spark-1.1`                      | Meta Muse Spark 1.1         | open-source  | yes | 1M     |
| `nvidia/nemotron-3-ultra-550b-a55b`        | Nvidia Nemotron 3 Ultra     | open-source  | yes | 1M     |
| `poolside/laguna-s-2.1-free`               | Poolside Laguna S 2.1 (Free) | open-source  | yes | 1M     |
| `inclusionai/ling-3.0-flash-free`          | InclusionAI Ling 3.0 Flash (Free) | open-source  | yes | 1M     |
| `claude-fable-5-1`                         | Claude Fable 5.1            | premium      | no  | 1M     |
| `deepseek/deepseek-v4-flash-vision-exp`    | DeepSeek V4 Flash Vision (exp) | open-source  | no  | 1M     |
| `deepseek/deepseek-v4-flash-fast`          | DeepSeek V4 Flash Fast      | open-source  | no  | 1M     |
| `z-ai/glm-5.3-flash`                       | GLM-5.3 Flash               | open-source  | yes | 1M     |
| `zai-org/GLM-5.3`                          | GLM-5.3                     | open-source  | yes | 1M     |
| `Qwen/Qwen3.8-Max-0902`                    | Qwen 3.8 Max 0902           | open-source  | no  | 1M     |
| `Qwen/Qwen3.8-Max`                         | Qwen 3.8 Max                | open-source  | no  | 1M     |
| `Qwen/Qwen3.8-27B`                         | Qwen 3.8 27B                | open-source  | no  | 262K   |
| `Qwen/Qwen3.8-Flash`                       | Qwen 3.8 Flash              | open-source  | no  | 1M     |
| `Qwen/Qwen3.7-Flash`                       | Qwen 3.7 Flash              | open-source  | no  | 1M     |
| `meituan/LongCat-2.0:free`                 | LongCat 2.0                 | open-source  | no  | 1M     |
| `tencent/hy4-preview`                      | Tencent Hy4 Preview         | open-source  | yes | 1M     |
| `google/gemini-3.7-flash`                  | Gemini 3.7 Flash            | open-source  | no  | 1M     |
| `thinkingmachines/inkling-small`           | Inkling Small               | open-source  | yes | 1M     |
| `meta/muse-spark-1.2`                      | Muse Spark 1.2              | open-source  | no  | 1M     |
| `meta/muse-spark-1.2-contributor`          | Muse Spark 1.2 Contributor  | open-source  | no  | 1M     |
| `xai/grok-4.6`                             | Grok 4.6                    | open-source  | no  | 500K   |

Full model list is maintained in [`models.json`](./models.json). Run `bun run sync` to refresh from the latest Command Code CLI release on npm.

## Development

```bash
git clone https://github.com/danielxxomg/opencode-commandcode-provider.git
cd opencode-commandcode-provider
bun install
bun test
```

### Sync Models

```bash
bun run sync              # update models.json from Command Code
bun run sync:global       # update models.json + write to ~/.config/opencode/opencode.jsonc
```

## License

MIT
