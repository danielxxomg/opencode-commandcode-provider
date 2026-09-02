import { readdirSync, statSync, readFileSync, existsSync } from "fs"
import { join, relative } from "path"
import { execSync } from "child_process"

export interface GitContext {
  isGitRepo: boolean
  currentBranch: string
  mainBranch: string
  gitStatus: string
  recentCommits: string[]
}

export interface ProjectContext {
  structure: string[]
  git: GitContext
}

const DEFAULT_SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".nyc_output",
  "tmp",
  "temp",
  ".cache",
  ".DS_Store",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  "target",
  "out",
])

const MAX_FILES = 200
const MAX_DEPTH = 5
const CACHE_TTL_MS = 30000 // 30s cache TTL to prevent I/O thrashing

let cachedContext: ProjectContext | null = null
let lastGatheredTime = 0

export function parseGitignore(rootDir: string): Set<string> {
  const p = join(rootDir, ".gitignore")
  if (!existsSync(p)) return new Set()
  try {
    const patterns = new Set<string>()
    for (const line of readFileSync(p, "utf-8").split("\n")) {
      const t = line.trim()
      if (t && !t.startsWith("#")) patterns.add(t)
    }
    return patterns
  } catch {
    return new Set()
  }
}

export function shouldSkip(name: string, relPath: string, gitignore: Set<string>): boolean {
  if (DEFAULT_SKIP.has(name)) return true
  for (const pat of gitignore) {
    const p = pat.endsWith("/") ? pat.slice(0, -1) : pat
    if (p === relPath || relPath.startsWith(p + "/") || p === name) return true
    if (pat.includes("*")) {
      const re = new RegExp("^" + pat.replace(/\./g, "\\.").replace(/\*/g, "[^/]*") + "$")
      if (re.test(name)) return true
    }
  }
  return false
}

export function gatherStructure(rootDir: string): string[] {
  const entries: string[] = []
  const gitignore = parseGitignore(rootDir)

  function walk(dir: string, depth: number) {
    if (entries.length >= MAX_FILES || depth > MAX_DEPTH) return

    let items: string[]
    try {
      items = readdirSync(dir)
    } catch {
      return
    }

    for (const name of items.sort()) {
      if (entries.length >= MAX_FILES) break
      const fullPath = join(dir, name)
      const relPath = relative(rootDir, fullPath)
      if (shouldSkip(name, relPath, gitignore)) continue

      let st
      try {
        st = statSync(fullPath)
      } catch {
        continue
      }

      if (st.isDirectory()) {
        entries.push(relPath + "/")
        walk(fullPath, depth + 1)
      } else if (st.isFile()) {
        entries.push(relPath)
      }
    }
  }

  walk(rootDir, 0)
  return entries
}

function runGit(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", stdio: "pipe", maxBuffer: 1024 * 1024 }).trim()
  } catch {
    return ""
  }
}

export function gatherGit(rootDir: string): GitContext {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: rootDir, stdio: "pipe" })
  } catch {
    return { isGitRepo: false, currentBranch: "", mainBranch: "", gitStatus: "", recentCommits: [] }
  }

  const currentBranch = runGit("git branch --show-current", rootDir)

  let mainBranch = ""
  for (const cand of ["main", "master"]) {
    try {
      execSync(`git rev-parse --verify ${cand}`, { cwd: rootDir, stdio: "pipe" })
      mainBranch = cand
      break
    } catch {
      /* not found */
    }
  }

  const gitStatus = runGit("git status --short", rootDir)

  let recentCommits: string[] = []
  const log = runGit('git log --oneline -10 --format="%h %s (%an, %ad)" --date=short', rootDir)
  if (log) {
    recentCommits = log.split("\n")
  }

  return { isGitRepo: true, currentBranch, mainBranch, gitStatus, recentCommits }
}

export function gatherContext(rootDir: string = process.cwd()): ProjectContext {
  const now = Date.now()
  if (cachedContext && now - lastGatheredTime < CACHE_TTL_MS) {
    return cachedContext
  }

  cachedContext = {
    structure: gatherStructure(rootDir),
    git: gatherGit(rootDir),
  }
  lastGatheredTime = now
  return cachedContext
}

export function clearContextCache(): void {
  cachedContext = null
  lastGatheredTime = 0
}
