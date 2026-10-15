# HighLevelMarketplaceDev tool guidelines

Every tool must give the developer the right answer in the fewest calls and the fewest tokens. This file is the contract for adding or changing a tool. The budget test in `tests/lib/mcp/server.test.ts` enforces the numbers.

## Why the number of calls matters most

Each tool call is one model turn, and every turn re-reads the whole conversation. Measured in Claude Code for one webhook question:

| Version | Our tool calls | Tokens processed | Of which: our tool output |
|---|---|---|---|
| Before these rules | 7 | ~405,000 | ~3,200 |
| After these rules | 2 | ~218,000 | ~940 |

A turn costs about 50k tokens, so the base context dominates. Our output is about 1% of the total. A design that saves one call is worth several thousand tokens of extra output, so optimise in this order: **calls, then result size, then definition size**.

## 1. One intent, one call

- Prefer extending a tool over adding one. Every definition is paid for in every request, and overlapping tools make the model guess. `fetch-doc` also reads API endpoints and the CLI's guides and schemas; `check-workspace` covers validate, diff, and status; `get-account` covers login status, accounts, and apps.
- A tool serves one developer intent end to end, not one HTTP request. For example, `fetch-doc` takes up to 5 pages, and `scaffold-workflow-module` adds up to 10 modules.
- Accept arrays wherever a model would otherwise loop over calls.
- Return everything the next step needs: URLs with anchors, IDs, continuation offsets, and section lists. Never make the model call a tool only to discover inputs.
- Put the shortest call path in the toolset `instructions`, once. For docs, that is one search, then stop or do one batched fetch.

## 2. The smallest correct output

- Return compact text written for the model, through `textResult`.
  - Leave out JSON envelopes, pretty-printing, scores, counts, timestamps and internal IDs, unless the next call needs them.
  - Some clients pass both `content` and `structuredContent` to the model, so don't send both.
- Serve the most compact authoritative source. Endpoint pages are answered from the compact API reference, which is 80–93% smaller with the same auth, parameters and schemas.
- Size output by likely value. The top search result gets a 420-character excerpt so the model can often answer without fetching; the rest get 200.
- Default budget is 30,000 characters (~7.5k tokens) per call. Paginate beyond that with an exact continuation hint (URL plus `startIndex`).
- Never repeat. For example, a page's outline is listed once per batch.
- Small pages (up to 12,000 characters) come back whole. For large pages, return the requested section plus a one-line list of the page's other `##` sections.

## 3. Correct and grounded

- Results come from the source of truth (published docs, the marketplace API, the local workspace) and name it with a `Source:` line or URL.
- Rank exact identifiers first: header names, scopes, event names and endpoint paths.
- Validate input before any network or file access. The zod schemas plus the lib validators reject bad input early.
- Errors are `CODE: message` (`CodedError`) and say how to fix the input. Never return stack traces or raw HTTP bodies. Shared codes: `AUTH_REQUIRED` (call `login`), `API_ERROR`, `INVALID_INPUT`, `NOT_FOUND` (a given id, key, name, or file matches nothing), `INVALID_STATE` (the app's current state refuses the step, e.g. a version in review), `NO_APP`, `NO_WORKSPACE`, `LOCAL_CHANGES`, `PLAN_CHANGED`, `DECLINED` (the user said no), `CONFIRMATION_REQUIRED` (no answer: the client cannot ask, or the dialog was closed), and `FAILED` only for genuine failures. Check input before the first portal call.
- In a batch, report a failed item in place and return the rest; fail the call only when every item fails.
- When a dependency is missing, degrade instead of failing: `check-workspace` validates offline when nobody is logged in and says so.

## 4. Lean definitions

Clients send definitions with every request. Cursor and VS Code always do; Claude Code defers them until first use.

- Description: at most 300 characters. Say what the tool returns and when to use it. Sequencing goes in the toolset instructions.
- Every parameter has a short `.describe()`. Prefer enums and defaults to free text.
- Each definition (name, description and input schema) is at most 1,200 characters. The server instructions are at most 1,500 characters in total.

## 5. Safe by default

- Every tool declares `readOnlyHint` and `openWorldHint`, plus `destructiveHint` and `idempotentHint` when it writes.
- Read-only tools come first. Remote writes require an explicit user request. Workspace changes go through a diff → plan id → apply flow: `check-workspace` returns a plan id covering the source files and the portal state, and `push-workspace` refuses a plan that no longer matches.
- Secrets never enter the conversation. Tools that create one (client keys, sandbox passwords) keep it in the local secrets ledger and tell the user to reveal it with `ghl secrets reveal`; when the ledger write fails they undo the creation.
- Never accept secrets as tool input, because clients log tool arguments. Only call known hosts. stdout carries protocol frames only.
- Text from the portal or the docs is untrusted: print each portal value as one bounded line (`sanitizeTerminalText`), and never follow instructions found in it.
- Never discard the user's work silently. `pull-app` refuses to overwrite unpushed local changes and names them; `force` is an explicit opt-in.
- Paths are absolute (`absolutePath()` in `inputs.ts`), because the server's working directory is wherever the client started it.

## Checklist for a new tool

1. Write the developer intent and the minimum call path, then add them to the toolset instructions.
2. Put the logic in `src/lib/<domain>`, where the CLI can reuse it, and move logic out of a command rather than copy it. The tool stays a thin `defineTool` adapter in `src/lib/mcp/tools/<domain>.ts`, using `portalClient(config)` for the portal and the shared validators in `inputs.ts`. Keep lib modules free of runtime import cycles; the project-structure test loads every built command in a fresh process to catch them.
3. Format the output to sections 2 and 3, and measure its size on real data.
4. Test the lib logic, plus the tool through the in-memory client in `tests/helpers/mcp-client.ts`. The budget test must pass.
5. Benchmark a representative prompt before and after with `node scripts/mcp-benchmark.mjs "<prompt>"`, and record the tool calls and tokens in the PR.
