#!/usr/bin/env node
/* Measures what one prompt costs through Claude Code with the HighLevelMarketplaceDev
   server: tool calls, tool output size, and tokens processed. Run it before and after
   changing a tool; see src/lib/mcp/GUIDELINES.md.

   Usage: node scripts/mcp-benchmark.mjs "<prompt>" */
import { spawnSync } from 'node:child_process'

const SERVER_PREFIX = 'mcp__HighLevelMarketplaceDev__'
const prompt = process.argv.slice(2).join(' ').trim()

if (!prompt) {
  console.error('Usage: node scripts/mcp-benchmark.mjs "<prompt>"')
  process.exit(1)
}

const run = spawnSync(
  'claude',
  ['-p', prompt, '--allowedTools', SERVER_PREFIX.slice(0, -2), '--output-format', 'stream-json', '--verbose'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
)
if (run.error || run.status !== 0) {
  console.error(run.error?.message ?? run.stderr)
  process.exit(1)
}

const calls = new Map()
let summary
for (const line of run.stdout.split('\n').filter(Boolean)) {
  const event = JSON.parse(line)
  for (const part of event.message?.content ?? []) {
    if (part.type === 'tool_use' && part.name.startsWith(SERVER_PREFIX)) {
      calls.set(part.id, { tool: part.name.slice(SERVER_PREFIX.length), input: part.input, chars: 0 })
    }
    if (part.type === 'tool_result' && calls.has(part.tool_use_id)) {
      const content = Array.isArray(part.content) ? part.content.map(item => item.text ?? '').join('') : part.content
      calls.get(part.tool_use_id).chars = String(content ?? '').length
    }
  }
  if (event.type === 'result') summary = event
}

const usage = summary?.usage ?? {}
const processed =
  (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
const outputChars = [...calls.values()].reduce((total, call) => total + call.chars, 0)

for (const call of calls.values()) {
  console.log(`${call.tool.padEnd(14)} ${String(call.chars).padStart(6)} chars  ${JSON.stringify(call.input)}`)
}
console.log(`\nHighLevelMarketplaceDev calls: ${calls.size}`)
console.log(`Tool output: ${outputChars} chars (~${Math.round(outputChars / 4)} tokens)`)
console.log(`Turns: ${summary?.num_turns}  Tokens processed: ${processed}  Output tokens: ${usage.output_tokens ?? 0}`)
console.log(`Cost: $${summary?.total_cost_usd?.toFixed(4) ?? 'n/a'}`)
