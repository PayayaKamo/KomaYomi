/**
 * Guard the YAML front matter of every docs page.
 *
 * Front matter is parsed by VitePress before the site is built, and a plain
 * (unquoted) YAML scalar cannot contain `: ` — the parser reads it as a nested
 * mapping and fails the whole build with "incomplete explicit mapping pair".
 * The same goes for a trailing `:`, or a ` #` that silently starts a comment.
 *
 * `docs:build` runs this first so the failure names the file, line and value
 * instead of surfacing as an opaque YAML error from `vitepress build`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Directories that never hold source pages. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vitepress', 'public', 'assets', '.git'])

/** Count unmatched `[` / `{` on a line, so multi-line flow collections are skipped. */
function bracketDelta(text) {
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '[' || char === '{') depth += 1
    else if (char === ']' || char === '}') depth -= 1
  }
  return depth
}

/** True when a quoted scalar opened and closed on the same line. */
function isClosed(text, quote) {
  for (let i = 1; i < text.length; i += 1) {
    if (text[i] !== quote) continue
    if (quote === "'" && text[i + 1] === "'") {
      i += 1
      continue
    }
    if (quote === '"' && text[i - 1] === '\\') continue
    return true
  }
  return false
}

/**
 * Report front matter lines whose plain scalar would be misparsed.
 * `raw` is the whole file, so every line number points at the real file.
 */
export function inspect(raw) {
  const problems = []
  const block = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(raw)
  if (!block) {
    if (/^---\r?\n/.test(raw)) {
      problems.push({ line: 1, message: 'front matter opens with --- but never closes' })
    }
    return problems
  }

  const lines = block[1].split(/\r?\n/)
  /** Indentation of the block scalar (`|` / `>`) we are inside, or null. */
  let blockIndent = null
  /** Remaining bracket depth of a multi-line flow collection. */
  let flowDepth = 0

  lines.forEach((line, index) => {
    const lineNo = index + 2

    if (blockIndent !== null) {
      if (!line.trim()) return
      const indent = line.length - line.trimStart().length
      if (indent > blockIndent) return
      blockIndent = null
    }
    if (flowDepth > 0) {
      flowDepth += bracketDelta(line)
      return
    }

    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return

    const entry = /^(\s*)(?:-\s+)?[^:#\s][^:]*:(?:\s+(.*))?$/.exec(line)
    if (!entry) {
      // A sequence item that is not a `key: value` pair, e.g. `- plain text`.
      const item = /^\s*-\s+(.*)$/.exec(line)
      const value = item?.[1]?.trim()
      if (value && !value.startsWith('"') && !value.startsWith("'") && value.includes(': ')) {
        problems.push({
          line: lineNo,
          message: `list item contains ": " which YAML reads as a mapping — wrap it in double quotes`,
        })
      }
      return
    }

    const indent = entry[1].length
    const value = (entry[2] ?? '').trim()
    // Nothing after the colon: a nested mapping or sequence follows.
    if (!value) return
    // Block scalars: everything deeper belongs to the scalar.
    if (/^[|>][+-]?\d*$/.test(value)) {
      blockIndent = indent
      return
    }
    const quote = value[0]
    if (quote === '"' || quote === "'") {
      if (!isClosed(value, quote)) {
        problems.push({ line: lineNo, message: `quoted value never closes its ${quote} quote` })
      }
      return
    }
    if (/^[[{]/.test(value)) {
      flowDepth = Math.max(0, bracketDelta(value))
      return
    }

    const hint = 'wrap the whole value in double quotes'
    if (value.includes(': ')) {
      problems.push({ line: lineNo, message: `unquoted value contains ": " — ${hint}` })
    } else if (value.endsWith(':')) {
      problems.push({ line: lineNo, message: `unquoted value ends with ":" — ${hint}` })
    } else if (value.includes(' #')) {
      problems.push({ line: lineNo, message: `unquoted value contains " #", which starts a comment — ${hint}` })
    } else if (/^[&*!%@`]/.test(value)) {
      problems.push({ line: lineNo, message: `unquoted value starts with YAML indicator "${value[0]}" — ${hint}` })
    }
  })

  return problems
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), files)
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(path.join(dir, entry.name))
  }
  return files
}

/** Every front matter problem under `root`, with paths relative to it. */
export function checkDocs(root = docsRoot) {
  const failures = []
  for (const file of walk(root).sort()) {
    for (const problem of inspect(fs.readFileSync(file, 'utf8'))) {
      failures.push({
        file: path.relative(root, file).split(path.sep).join('/'),
        line: problem.line,
        message: problem.message,
      })
    }
  }
  return failures
}

// Runs as a script from `docs:build`; the unit test imports `checkDocs` instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = checkDocs()
  if (failures.length) {
    for (const failure of failures) {
      console.error(`docs/${failure.file}:${failure.line}: ${failure.message}`)
    }
    console.error(`\n${failures.length} front matter problem(s). VitePress would fail to parse these.`)
    process.exit(1)
  }
  console.log('Front matter OK.')
}
