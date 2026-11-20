# Sites 플러그인 로컬 문서 전체본

설치 버전: 1.1.6. 작성일: 2026-11-17. 로컬 패키지에 포함된 Markdown 문서를 생략 없이 모았다. 이는 ChatGPT 서비스 내부 구현이나 특정 사이트의 소스 덤프가 아니다. 아래 원문의 상대 링크는 각 원본 파일 위치를 기준으로 한다.

## 문서 목록
1. `skills/sites/SKILL.md`
2. `skills/sites/references/app-integrations.md`
3. `skills/sites/references/browser-agent-support.md`
4. `skills/sites/references/design/presentation-led.md`
5. `skills/sites/references/identity-and-secrets.md`
6. `skills/sites/references/preview/local.md`
7. `skills/sites/references/preview/managed.md`
8. `skills/sites/references/recurring-updates.md`
9. `skills/sites/references/site-mcp-server.md`
10. `skills/sites/references/storage.md`
11. `skills/sites/references/troubleshooting.md`
12. `skills/sites/templates/vinext-starter/README.md`
13. `skills/sites/templates/vinext-starter/vendor/shadcn-tailwind-4.13.0.LICENSE.md`
14. `skills/sites/templates/worker-esm-starter/README.md`
15. `skills/sites-remix/SKILL.md`


---

원본 파일: `skills/sites/SKILL.md`

---
name: sites
description: Use Sites when the user wants a website built for them (including a landing page, portfolio, dashboard, portal, tracker, hub, game, event registration, or tool), requests changes to a website already built with Sites, wants to publish a website with Sites, or wants to manage Sites hosting.
---

# Sites

Take the requested website through the supported development and publishing workflow. Publish completed new Sites and edits unless the user requests local-only work or saving without deployment. New Sites start private; preserve an existing Site's audience unless the user requests a change. Native tool approvals apply without an additional conversational publishing gate.

For hosting-only changes, use the relevant native Sites tool and confirm its returned state; source preparation is needed only for source changes or publication.

## Workflow

`<plugin-root>` is the installed directory containing `scripts/` and `skills/`. Run helpers with absolute paths and literal arguments from the selected checkout. Keep credentials in session memory and pass them through stdin, never shell arguments, files, or output.

### 1. Select and open

Default to a new Site unless a specific existing Site is identified.

- **Existing hosted Site:** retain its `project_id` and audience, call `get_site` and `create_source_repository_write_credential`, and open with the [source helper](#source-helper) before editing. Omit `archivePath`; use an empty directory when source is missing, then the returned `checkout_path`.
- **New Site:** create a unique, new empty project subdirectory in the task's workspace, normally `/workspace/sites/<slug>` in managed Linux. Default simple pages and browser-local interactions to buildless HTML/JS; use the supplied Vinext starter for server behavior. If the user requests another framework or implementation, or the task specifies a template to reuse, skip the Vinext starter and build directly with that choice. For hosting, follow the minimum deploy format under [Hosting manifest](#hosting-manifest).
- **Local-only:** use the available checkout; skip registration, source synchronization, and publication.

### 2. Prepare and launch

For new Vinext projects, run:

```text
node <plugin-root>/scripts/project-setup.mjs
```

This copies the starter and configures ignored checkout-local state. Helpers select `managed-linux` only for `SITES_MANAGED_LINUX_CONTAINER=1`, otherwise `portable`. For buildless HTML/JS, prepare `dist/` for `index.html` and assets; skip starter setup, installation, and build.

For a retained template, add `--template-source <absolute-sanitized-source-directory>`; exclude Site identity, Git metadata, credentials, and runtime data. For explicitly requested Worker ESM, add `--starter worker-esm` and follow [its README](templates/worker-esm-starter/README.md). Use [Troubleshooting](references/troubleshooting.md#project-configuration) for profile repair or static-to-Worker migration.

After minimal setup, launch registration for new hosted work in a retained execution cell when available. Native `create_site` creates a private, unpublished Site and returns its ID and source credential. Immediately persist the ID when it returns. For static Sites, include `--static-directory` when known to set both fields at once; omit it for Worker builds. For buildless HTML/JS, run:

```text
node <plugin-root>/scripts/set-project-id.mjs --project-id <returned-id> --static-directory dist
```

Reuse an existing ID or registration attempt; resolve uncertain creation before retrying. For app integrations, first read [discovery and declarations](references/app-integrations.md#discover-and-declare).

Start needed dependency installation before feature implementation:

```text
node <plugin-root>/scripts/install-dependencies.mjs
```

Run only when dependencies are missing or their inputs changed. The installer handles host settings, package-manager selection, and interrupted setup; it takes no flags. Use one installer; keep dependency inputs unchanged while it runs. Proceed to implementation once the applicable operations are launched.

For managed-image pnpm additions, use `node "$SITES_PNPM_BIN" add <package>`.

Start required image search or generation when its brief is clear, alongside independent source work. Consider a parallel subagent for image downloads. Delegate bounded asset or research tasks; the Site owner handles the checkout, native Sites calls in the owning conversation, and publication.

### 3. Implement

Write application files while setup runs. For hosted work, await persisted Site identity before further manifest edits or source synchronization. Await installed dependencies before commands that need them.

Implement the requested experience in one focused pass; revise for observed failures or unmet requirements. Replace starter title and description and remove temporary `codex-preview` metadata during implementation. Integrate required assets and complete the requested behavior before publishing.

When `SITES_MANAGED_LINUX_CONTAINER=1`, preview is internal QA. Start it only when the task needs browser QA and `cua_repl.js` is available. If `cua_repl.js` is unavailable, skip browser QA: do not start a preview server, install a browser, or improvise another browser-control path.

When `SITES_MANAGED_LINUX_CONTAINER` is not `1`, use local preview. In visible tasks with user-facing preview support, show the first recognizable version once it serves successfully and keep it current. Background tasks skip user-facing handoff.

Before any preview, browser test, or screenshot, read the selected reference: [managed](references/preview/managed.md) or [local](references/preview/local.md). If preview infrastructure is unavailable, report the verification limit and continue appropriate checks and publication unless passing browser QA is required. Follow [Troubleshooting](references/troubleshooting.md#preview) after failures.

### 4. Validate and package

Collect any remaining registration and installation results, then finalize the source manifest before checks/builds and packaging.

#### Hosting manifest

The tracked `.openai/hosting.json` declares Site identity and deployment configuration. After registration, a minimal static Site uses:

```json
{
  "project_id": "<returned-id>",
  "static": {"directory": "dist"}
}
```

| Field | Contract |
| --- | --- |
| `project_id` | Persist with `set-project-id.mjs` on creation; preserve on updates. |
| `static` | Object with `directory`: `dist`, `dist/client`, `out`, `build`, or `.output/public`. Omit for Worker builds. |
| `d1`, `r2` | [Storage bindings](references/storage.md#bindings); leave unused bindings `null`. |
| `capabilities` | Declare [a Site MCP server](references/site-mcp-server.md#build-the-server) when needed. |
| `plugins`, `connectors` | [App integration declarations](references/app-integrations.md#discover-and-declare). |

A deployable Site needs `.openai/hosting.json` with its `project_id` and one of these build outputs:

- **Static:** Set `static.directory` to a supported directory listed above. It must contain `index.html` and the assets the page uses.
- **Server-backed:** Omit `static`. Build a Cloudflare Worker ES module at `dist/server/index.js` that default-exports an object with a `fetch` handler.

Preserve existing fields. Edit the source manifest; build helpers emit Worker deployment metadata.

Run checks appropriate to the change; lint only when requested. For hosted work, package with the source helper using remaining checks/builds as ordered argument arrays and an absolute `archivePath`. Pass the complete prior opening result as `source` when available.

Buildless HTML/JS uses `commands: []` when no checks remain. Framework projects, including Vinext and static exports, build with `["node", "<plugin-root>/scripts/build-site.mjs"]`. Omit commands already completed successfully with unchanged inputs. Local-only work runs checks/builds directly and skips packaging for publication.

#### Source helper

Use the repository access from registration or `create_source_repository_write_credential` for the same Site. If `auth_mode` is `work_proxy`, it contains no token. Use the same helper or ordinary Git with `remote_url`; Work supplies authentication outside the executor. If Git reports expired access, call `create_source_repository_write_credential` again. Do not configure a token or authentication header for this mode.

```text
node <plugin-root>/scripts/site-workflow.mjs --project-id <project_id>
```

Launch with `exec_command(tty: true, yield_time_ms: 1000)`. After `Ready for Site workflow JSON on stdin (input is hidden).`, send one newline-terminated JSON object with `write_stdin`. Wait for successful exit and retain the final JSON result.

| Input | Value |
| --- | --- |
| `credential` | Returned credential object, through stdin only. |
| `source` | Complete prior opening result, when available. |
| `commands` | Remaining checks/builds as ordered argument arrays; packaging only. |
| `archivePath` | Absolute output archive path for packaging; omit for opening. |

The helper owns Git preparation, ordered commands, commit/push, and packaging. Pass its verified `project_id`, `commit_sha`, and `archive` directly to publishing; keep the archive unchanged until saving succeeds.

### 5. Publish

Use the audience from creation or `get_site`; refresh unknown or changed ownership/access before selecting a tool.

| Audience | Native calls |
| --- | --- |
| Confirmed owner-private | `save_version_and_deploy_private`; if unavailable, `save_site_version` then `deploy_private_site_version`. |
| Other supported audiences | `save_site_version` then `deploy_site_version`. |

Save-only uses `save_site_version` without deployment. A matching archive-backed saved version needs only deployment; source-only versions still need their matching archive. Preserve returned version IDs, including `saved_version_id`, when resuming. Continue an existing deployment rather than starting another.

### 6. Finish

Poll `get_deployment_status` only for `pending`, `building`, or `publishing`; stop on a terminal result. A successful native result with its URL verifies deployment without another status call or browser visit.

Return the literal deployed URL, saved version for save-only work, or local result. In visible tasks, open the deployed URL in the existing Site tab with `open_in_codex` or equivalent when supported; background tasks skip browser handoff. Handoff failure does not invalidate a verified deployment. Report incomplete verification or blockers; read [Troubleshooting](references/troubleshooting.md) after a failure or incomplete result.

## Design

Build around the user's primary task. Choose a coherent visual direction suited to the subject and audience, and preserve established branding when editing. Keep layouts responsive, text readable, and interactions accessible. Use imagery when it contributes to the experience.

Keep functionality within the requested scope. For open-ended presentation-led briefs, develop content and structure as needed for a complete experience. Preserve explicit content constraints and keep bounded edits bounded.

Read applicable guidance before choosing content and structure. Select by the experience's purpose, not merely its visual subject.

| Design guidance | When to use it |
| --- | --- |
| [Presentation-led sites](references/design/presentation-led.md) | New websites primarily meant to introduce, explain, persuade, or showcase: landing pages, marketing sites, portfolios, and interactive presentation sites. |

## Capabilities

Choose capabilities from the requested behavior and preserve those an existing Site uses. This is a reference index, not a checklist of features to add. Read only the relevant pages.

| Capability | When to use it |
| --- | --- |
| [Data and files](references/storage.md) | Durable records in D1 and uploads or generated files in R2. |
| [Identity and access](references/identity-and-secrets.md) | ChatGPT sign-in, user-owned data, runtime secrets, and private service access. |
| [App integrations](references/app-integrations.md) | Let the Site read data and perform actions in apps visitors have connected to ChatGPT. |
| [Site MCP server](references/site-mcp-server.md) | Expose the Site's operations as tools agents can call. |
| [Browser agent support (WebMCP)](references/browser-agent-support.md) | Optionally make the page's actions easier for browser agents to use. |
| [Scheduled updates](references/recurring-updates.md) | Update a published Site while it is closed, using an unattended data path and a linked automation. |

Hosted server code runs in Cloudflare Workers, with 128 MB per isolate and HTTP-based external connections; raw TCP is unavailable. When using the Vinext starter, preserve its `sites()` build integration. Capability references specify any required manifest declarations; not every feature is a `capabilities` entry.


---

원본 파일: `skills/sites/references/app-integrations.md`

# App integrations

Sites can read workspace apps and perform requested writes. Hosted calls use each visitor's connection and consent; [local preview](#local-preview) uses the owning agent's connection and permits reads only. Static-only Sites cannot invoke connectors.

## Discover and declare

Call native `list_plugin_eligibility` (`sites_list_plugin_eligibility`) before selecting apps or previewing their data. Supply `project_id` once registered; follow pagination. Use only `allowed` plugins, returned canonical IDs, and connector membership intersected with available native tools. Read tool schemas and applicable app skills; select needed actions and resolve connection ambiguity. Native access, marketplace names, and `.app.json` entries do not establish Sites eligibility. Never guess IDs/action names or invoke writes to discover schemas.

For a new Site, pass `enable_plugins: true` to `create_site` only after confirming at least one needed plugin is eligible; otherwise omit it. Existing Sites keep their `project_id` and use the shared [save/deploy flow](../SKILL.md#5-publish), which prepares their existing sign-in client; no replacement Site or separate upgrade is needed.

Recheck after workspace/connection changes, and with the Site's ID before every save or publish, including auto-publishing source pushes. Resolve denied, unknown, or missing declarations first; unknown does not mean an admin denial. If eligibility is unavailable or access disabled, continue independent work, explain blocked features, and preserve existing declarations; do not bypass policy by removing them.

Preserve `.openai/hosting.json` and add the discovered declarations:

```json
{
  "plugins": [{"id": "<plugin-id>", "connector_ids": ["<connector-id>"]}],
  "connectors": [{"id": "<connector-id>", "action_selection_mode": "read_only"}]
}
```

Declare each needed connector once. `read_only` is the default; `all` requests connector-wide read/write access, not a per-action/resource grant. Custom action lists are unsupported. The platform resolves releases and credentials. Verify built `dist/.openai/hosting.json` matches source and publish the exact saved Worker build/commit. Declaration/access-mode changes require a new saved deployment.

## Server actions

Keep the starter's `worker/index.ts`, which captures trusted request-scoped `ctx.props.CONNECTORS` before Vinext derives context. In existing Vinext Sites, add or update the starter helpers and Vite wiring only where needed; preserve working equivalent integrations and other projects' architecture. In dynamic server routes, use:

```ts
import { connectorsForRequest } from "@/lib/connectors";
import { connectorResponse } from "@/lib/connector-errors.mjs";

return connectorResponse(await connectorsForRequest().invoke(connectorId, actionName, validatedArgs));
```

Keep connector/action/target selection server-owned. Use same-origin POSTs, validate Origin and inputs against discovered schemas, bound reads, and return private/no-store responses. Never cache bindings across visitors, forward invocation tokens, expose arbitrary proxies, copy provider credentials, call from the browser, or replace live access with build/source snapshots. Match persisted data's visibility to its authorized audience; one visitor's read access does not authorize a shared snapshot.

Writes require a signed-in visitor's explicit click/form submission, authenticated request identity, duplicate-submission protection, visitor write consent, app/workspace permissions, and enabled platform support. Never mutate during rendering, GET, prefetch, or builds.

## Results and consent

Parse validated JSON on non-2xx responses too. Only `status: "success"` confirms success; HTTP 200 and legacy `isError`/`error.code` do not. Preserve `result.content`, `result.structuredContent` including falsy values, diagnostics, and retry timing. Render provider content safely. Keep source-level loading/errors independent; retained data after failed Refresh is stale, not an empty success.

Use `ConnectorError` with a server-generated `chatGPTSignInPath` for the original page/query. Only `reauthentication_required` offers Connect. Navigate at top level through [Sites sign-in](identity-and-secrets.md); reread after return without redirect loops. Sign-in does not guarantee provider access. Honor retry timing, and inspect provider state when write completion is uncertain; never automatically replay writes after errors or sign-in.

Optional `getContext()` supplies cached declared-connector hints, not authorization, provider health, or consent. Check `status`; disabled policy, empty tools, unknown/null tools, and failed context differ. Do not gate reads on metadata or cache it across requests.

Verify hosted reads, Refresh, and sign-in return as the intended visitor/workspace. Test a live external write only when that specific target and change are authorized; otherwise report it unverified. Check the provider result and that unauthorized writes remain denied. Report local reads, hosted consent/reads, and hosted writes separately. Fixtures, builds, and publication alone prove none of these.

## Local preview

Use local preview for live app reads and Refresh during development. The Vinext starter's development adapters relay to the owning task's native connections; they do not supply hosted visitor access. Follow [eligibility and discovery](#discover-and-declare) first. Preview grants cannot establish eligibility, and browser headers grant no authority.

### Start

Start the normal [local](preview/local.md) or [managed](preview/managed.md) preview. Other starters need equivalent adapters or a host binding. In the Site checkout, write ignored `.sites-runtime/connector-grants.json` with eligible connector IDs and discovered read actions:

```json
[{"connectorId":"<connector-id>","actionName":"<read-action>","readOnly":true}]
```

After project dependency installation, run the Site's helper with stdin open in a retained terminal session, using a PTY when needed; wait for its `ready` notification:

```text
node /absolute/site/scripts/connector-preview/connector-preview-session.mjs /absolute/site /absolute/site/.sites-runtime/connector-grants.json
```

For an older checkout missing the helper, copy the complete [helper directory](../templates/vinext-starter/scripts/connector-preview/) into the Site's `scripts/connector-preview/` and install missing dependencies from the [starter manifest](../templates/vinext-starter/package.json).

Keep one session across edits and Refresh. The runner owns concurrency, request expiry, timeouts, and cleanup. Do not automatically replay timed-out calls.

### Serve native reads

Keep one retained execution cell pumping session stdout/stdin while the owning agent edits and tests the Site. Await the pump; an external Node process cannot call task-native tools. Buffer incomplete lines, request enough output for complete messages, and service independent reads concurrently.

The helper emits newline-delimited JSON-RPC 2.0:

```json
{"jsonrpc":"2.0","id":"<call-id>","method":"invoke","params":{"connectorId":"<connector-id>","actionName":"<read-action>","arguments":{}}}
```

Dispatch only through an explicit map from exact `(connectorId, actionName)` pairs to resolved native read functions that validate schemas and read limits. Preserve task authentication and approval rules. Unknown pairs are unauthorized; never dynamically dispatch `tools[event.toolName]` or accept Site-supplied URLs, credentials, or account IDs as authority.

Return the actual MCP object, retaining `content`, `structuredContent`, and `isError`, through structured stdin rather than shell interpolation:

```js
JSON.stringify({ jsonrpc: "2.0", id, result: nativeResult }) + "\n"
```

Thrown/interrupted calls return a JSON-RPC error, not a fabricated result. The runner translates results once; provider-authored text does not establish reauthentication. `ready` and `receipt` are notifications, not invocations.

### Verify and stop

Correlate an initial read and Refresh/query change with native calls. Check useful data, independent errors, concurrency, and recovery. Preview context reports selected grants as `policy: "enabled", tools: null`; it is not hosted discovery or consent evidence. Preview rejects writes; fixtures cannot prove visitor authorization.

In `finally`, send `{"jsonrpc":"2.0","method":"stop"}` followed by a newline, then settle pending work. Stop before building or changing task/account/workspace/connection. Recheck eligibility and recreate grants after those context changes, not ordinary rebuilds. Confirm later requests cannot reach native tools. EOF/termination also closes the session. Before removing stale state, confirm its prior process exited; never take over another session.

Transient requests/results under ignored `.sites-runtime/connector-preview` are blocked from HTTP access and cleaned on shutdown, but remain readable with the agent's filesystem privileges. Production excludes preview adapters and authority. Report the profile, actions, and observed live reads separately from untested hosted paths.


---

원본 파일: `skills/sites/references/browser-agent-support.md`

# Browser agent support (WebMCP)

WebMCP makes the page's existing actions and state directly available as tools for browser agents. It is optional: add it when this materially helps the requested workflow; interactivity alone does not require it.

Register tools client-side through `document.modelContext`; they are available only while the page is open. ChatGPT supports the imperative registration API; feature-detect it for other browsers. Add tools after the initial implementation, without delaying the first meaningful preview.

## Register Real Actions

Register tools once in the client lifecycle and use an `AbortSignal` for cleanup. Each tool has a stable `name`, a description, a JSON Schema `inputSchema`, and an `execute` function; `title` and `annotations` are optional. Use the project's WebMCP types when available, or this minimal registration type:

```ts
type WebMcpRegistry = {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      execute(input: unknown): unknown | Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ): void | Promise<void>;
};
```

The example uses application helpers with these signatures; implement them through the same validation, action, and state update used by the visible interface:

```ts
declare function validateInput(input: unknown): { id: string };
declare function completeTask(input: { id: string }): Promise<{ id: string }>;
declare function reportRegistrationError(error: unknown): void;
```

Inside the client lifecycle:

```ts
const registry = typeof document === "undefined" ? undefined :
  (document as Document & { readonly modelContext?: WebMcpRegistry }).modelContext;
if (typeof registry?.registerTool !== "function") return;
const lifecycle = new AbortController();

try {
  void Promise.resolve(registry.registerTool({
    name: "complete_task",
    description: "Mark the selected task complete.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(input: unknown) {
      const task = await completeTask(validateInput(input));
      return { id: task.id, completed: true };
    },
  }, { signal: lifecycle.signal })).catch(reportRegistrationError);
} catch (error) {
  reportRegistrationError(error);
}
return () => lifecycle.abort();
```

Validate runtime input even when `inputSchema` is present. Return concise JSON-serializable results after the action and visible state finish updating. Tool registration failures should leave the ordinary interface usable. Prefer batched actions where useful, and do not add speculative tools.

Names must distinguish opening or preparing a flow from completing its action. `readOnlyHint` describes tools that do not modify state; `untrustedContentHint` marks external or user-generated output. These annotations are hints, not authorization controls.

## Verify

Use the selected [environment](../SKILL.md) for browser access. In a supported WebMCP context, confirm registration, call a tool with valid input, and read back the resulting application state. Check an invalid input or expected failure without corrupting state. Source inspection, builds, and UI clicks alone do not verify the WebMCP interface.

If no permitted, supported browser context is available, report WebMCP verification as unavailable. Block publishing only when the user explicitly requested WebMCP support; otherwise continue.


---

원본 파일: `skills/sites/references/design/presentation-led.md`

# Presentation-led sites

Develop an open-ended brief into a complete visitor experience, not just a hero and generic feature cards.

- Build a progression that helps visitors understand the subject, explore its specifics, and take an appropriate next step. Each section should add distinct substance; omit repeated pitches and filler.
- Make the subject concrete through relevant imagery, examples, or demonstrations. Let composition and interactions serve the narrative rather than repeating the same layout or adding decorative activity.
- Fill creative gaps with coherent concepts and copy. Ground claims about real people, organizations, and products in supplied or verified facts; do not invent testimonials, customers, statistics, or product capabilities. Keep illustrative demo content distinguishable from real claims.
- Add presentation depth, not unrelated application features. A richer narrative does not by itself require accounts, persistence, or external integrations.


---

원본 파일: `skills/sites/references/identity-and-secrets.md`

# Identity and Secrets

Read when the Site needs identity, protected routes, or runtime secrets. Sites owns hosted authentication; preserve its integration instead of scaffolding a separate OAuth or session stack.

## Request Identity

Signed-in visitors receive `oai-authenticated-user-id` and `oai-authenticated-user-email`. The ID is stable within a Site and differs across Sites; use it for user-owned records. Email and optional full name are display or contact fields. Private Sites require authenticated access: browser visitors sign in, while non-user callers use [service access](#service-access). Public Sites can receive anonymous requests with neither identity header.

The optional `oai-authenticated-user-full-name` is percent-encoded UTF-8 when `oai-authenticated-user-full-name-encoding` is `percent-encoded-utf-8`. The starter helper decodes it and falls back to email. Browser identity, [app consent](app-integrations.md), and service access below are separate permissions.

## Sign-In

Use the server-only helpers in [`app/chatgpt-auth.ts`](../templates/vinext-starter/app/chatgpt-auth.ts):

- `getChatGPTUser()` returns optional identity. API routes and server actions must reject missing identity when required and authorize each operation server-side.
- `requireChatGPTUser(returnTo)` redirects anonymous visitors from protected server-rendered pages. Mark identity-dependent pages `export const dynamic = "force-dynamic"`. When the return path depends on page parameters, compute it in the page and call the helper from a nested async server component.
- Start sign-in with a normal anchor using `chatGPTSignInPath(returnTo)` and `target="_top"`; use `chatGPTSignOutPath(returnTo)` for sign-out. Return paths must be same-origin relative paths.

Sign-in requires top-level navigation, not fetch, client routing, or prefetch. Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, and `/callback`; do not implement those routes or call AuthAPI directly.

Sign-in establishes identity, not workspace membership. Use Sites access policies or explicit server-side membership checks for workspace restrictions. Confirm supported platform capabilities before adding an external identity provider.

## Service Access

If `get_site` returns `siwc_bypass_bearer_token`, send it only to that Site as `OAI-Sites-Authorization: Bearer <token>`. Dispatch validates and consumes it; it supplies neither a visitor identity nor connected-app consent.

A shared update endpoint on a Site confirmed owner-private can rely on this platform access boundary. Preserve additional authorization for user-owned records or narrower permissions. Public write endpoints need their own authorization. Do not change the Site's audience to make an updater work.

For [unattended work](recurring-updates.md), verify source access separately from permission to write to the Site. If the tool surface omits the credential, inspect supported connection options before concluding access is unavailable; do not create or rotate credentials merely to check. The future task must be able to obtain supported access without the authoring session. Keep credentials out of source, browser code, schedule prompts, and output.

## Secrets

Configure hosted runtime values through native Sites tools. Keep secret values out of source, client bundles, and `.openai/hosting.json`; keep local environment files untracked and document key names only in `.env.example`.

For `OPENAI_API_KEY`, use the [OpenAI Developers](plugin://openai-developers@openai-curated-remote) plugin's `openai-platform-api-key` skill and its required approval, then configure the Site secret before deployment. If unavailable, ask the user to enable it.


---

원본 파일: `skills/sites/references/preview/local.md`

# Local preview

For the `portable` profile, selected whenever `SITES_MANAGED_LINUX_CONTAINER` is not `1`, including on Linux devices.

In a visible task with a user-facing preview tool, run the project's dev script or a static HTTP server (preferably with live reload) in a retained session after any required installation. Check that the representative page returns a successful HTTP response, then open the server's printed Local URL with `open_in_codex` or equivalent. Use supported forwarding when execution is remote; loopback on another host is not a device preview.

Reuse the server and Site tab through edits and publication. For a background task or an environment without user-facing preview, start a server only when needed for the work. Request network permissions when required for the server and its readiness check. Stop the owned server during final teardown.


---

원본 파일: `skills/sites/references/preview/managed.md`

# Managed Linux preview

For the `managed-linux` profile, selected only when `SITES_MANAGED_LINUX_CONTAINER=1`.

Follow the `cua_repl.js` tool instructions.

1. Run `sites-preview start <absolute-checkout>` for a checkout beneath `/workspace`. The container's daemon owns one preview; do not launch a separate server.
2. Open the exact URL returned by the CLI in the cloud browser. Do not choose or rewrite the host or port.
3. Reuse the preview through edits, builds, and hosting. Refresh static pages after edits when live reload is unavailable.
4. Use `sites-preview status` for diagnostics. Run `sites-preview stop` when finished or before restarting after a repair.

The CLI runs a nonempty `scripts.dev`; otherwise it serves `.openai/hosting.json`'s `static.directory`. For static HTML, set `static.directory` and create it with `index.html` before starting.

If the CLI, daemon, or browser route is unavailable, report the environment limitation and follow [Troubleshooting](../troubleshooting.md#preview). Do not change network permissions or bypass the sandbox.


---

원본 파일: `skills/sites/references/recurring-updates.md`

# Recurring Updates

Use when the requested outcome needs updates while the Site is closed, or a useful optional automation is being considered. Refreshing an open page does not provide unattended updates.

## Prepare the Update

Reuse [persistent data](storage.md), source access, and a writer callable by a cloud task without the user present. Verify source access and writer authorization independently. [Site service access](identity-and-secrets.md#service-access) supplies neither a signed-in visitor nor consent to access connected apps; preview bindings cannot supply hosted access.

Use [Site MCP server](site-mcp-server.md) when the update needs a hosted tool, reusing existing data operations and connections. Recurring updates do not inherently require a Site plugin. Browser WebMCP and local-only plugins cannot provide the cloud connection. Explain any required Install/Connect step and resume once connected.

Routine runs update data without republishing. For multi-step work, commit source settings, supported access acquisition, required identity/scope, update/readback steps, and retry behavior with the Site through the [workflow](../SKILL.md#workflow). Store no credentials. Verify a fresh cloud task can retrieve that revision through the linked Site. A verified action with a self-contained prompt needs no extra instructions file.

After publication, exercise a new or changed writer through its intended unattended access and read back the persisted result. Reuse an initial content write and unchanged verification; avoid duplicate records. Do not wait for a scheduled occurrence merely to verify readiness.

## Choose the Schedule

Before setup, call `get_site` for the active, published, user-owned Site and its linked `automations`. Missing/null metadata prevents duplicate checking: do not create or offer a schedule, but continue the Site handoff. An empty array means none linked, not that the writer works.

Reuse an automation covering the work, preserving paused state unless asked to resume. Use supported task controls for edits, retaining the Site link; schedule changes need no deployment.

- **Clearly requested:** When no matching automation exists, use Sites `create_schedule` for requested recurring work, an outcome requiring it, or an accepted offer in chat. Recheck linked automations before creating. Preserve requested/accepted timing; otherwise choose reasonable timing in the user's known timezone and ask if it is unknown.
- **Optional:** After the normal Site handoff, offer one complete schedule with `offer_site_schedule` and a short sentence naming work, time, and timezone. Button acceptance already creates and links it; do not call `create_schedule` again. Chat acceptance uses the offered Site/work/timing, including the user's changes.

Skip optional offers for fixed snapshots, manual/browser-only updates, scheduled runs, already-covered work, or a previous offer or decline. Resolve unclear Site, automation, or requested work before changing schedules.

## Handoff

Keep the schedule prompt short and nontechnical: outcome, sources, user requirements, and any verified saved instructions needed by future runs. After creation or edits, confirm saved timing and enabled/paused status. Creation proves a schedule was saved, not that an update ran. Unavailable scheduling does not block Site handoff; report the incomplete scheduling work separately.


---

원본 파일: `skills/sites/references/site-mcp-server.md`

# Site MCP server

Build or update a Site-hosted MCP server and help users access its tools through the Site's plugin in ChatGPT or Codex.

## Build the server

Add `"mcp"` to the capabilities in `.openai/hosting.json` and expose a stateless JSON-RPC `POST /mcp` endpoint. Prefer MCP 2026-07-28 and implement:

- `server/discover`: Return `supportedVersions: ["2026-07-28"]` and `capabilities: {tools: {}}`.
- `tools/list`: Return a `tools` array with each tool's `name` and `inputSchema`.
- `tools/call`: Run `params.name` with `params.arguments` and return MCP `content` blocks; set `isError: true` for tool failures.

### Authentication

Sites authenticates MCP requests and checks that the caller can view the Site before forwarding them to your server. Enforce any additional access rules the tools require. Sites includes the caller’s identity in the incoming `/mcp` request headers. Your server can read these headers when needed:

- `oai-authenticated-user-id`: Site-scoped user ID.
- `oai-authenticated-user-email`: Verified email address.
- `oai-authenticated-user-full-name`: Optional display name, percent-encoded UTF-8.

## Publish and connect

1. Publish the Site through the shared [workflow](../SKILL.md#workflow). When the owner publishes with `"mcp"` in `.openai/hosting.json` capabilities, Sites creates a private App and plugin for them. When the owner republishes, Sites refreshes the connected plugin’s tools by fetching the latest tool list from the Site’s `/mcp` endpoint.
2. Try the tools. The plugin may already be installed and connected automatically. If its tools are available, verify with a tool call, preferably read-only.
3. Help the user install or connect. If tools are missing and installation is unconfirmed, call `get_site` with `include_mcp_connection: true` to get the plugin ID, then call `plugin_management.suggest_plugins` with `{"plugin_ids": ["<returned plugin ID>"]}`. This shows the installation UI. If it reports “Already installed,” a new chat may help the tools appear. The user can also open the plugin under Plugins → Personal → Created by you and choose Install or Connect as needed.

To use this Site’s MCP tools in ChatGPT or Codex, reuse the plugin Sites creates when you publish. This connection doesn’t need a separate App or plugin, local MCP configuration, or `codex mcp add` / `codex mcp login`.


---

원본 파일: `skills/sites/references/storage.md`

# Storage

Read when the requested Site needs persistent data or uploads. Use D1 for structured product data and R2 for files. Browser storage is appropriate for device-local preferences, not records expected to survive across devices or sessions.

## Bindings

Declare logical `d1` and `r2` bindings in `.openai/hosting.json`, preserving existing names; the starter normally uses `DB` and `BUCKET`. Leave unused bindings `null`. Sites provisions and connects the hosted resources.

The Vinext starter uses `db/index.ts` for D1 access and `db/schema.ts` for schema declarations. Access R2 server-side through `env` from `cloudflare:workers`.

## Schema Changes

1. Update the schema and run the starter's `npm run db:generate` before building. Inspect and commit the generated SQL and Drizzle metadata with the source.
2. Keep migrations schema-only and bounded. Backfills and seed datasets belong outside migrations. For an ordinary added column, any provided default must be constant; `NOT NULL` requires a non-null constant default. Added references must be nullable with an implicit or explicit null default.
3. Apply pending migrations to local previews using the starter's [local D1 migration commands](../templates/vinext-starter/README.md#local-d1-migrations). Local and hosted databases are separate.
4. Publish through the shared [workflow](../SKILL.md#workflow). Sites applies hosted migrations before uploading the Worker.

Applied SQL, snapshots, and journal entries are immutable; append new migrations for later changes. A failed deployment can still have applied migrations. Repair an identified failed, unapplied migration before publishing a new version; resolve uncertain migration state before changing history.

Use one statement per D1 `prepare()` call and `batch()` for multiple statements. Do not create or alter migration-owned tables during request handling.


---

원본 파일: `skills/sites/references/troubleshooting.md`

# Troubleshooting

Read after a failed step, or for profile repair and static-to-Worker migration. Start with the returned error and logs when available; fix the identified cause and rerun the affected step. Reuse successful results whose inputs remain unchanged. For source or publishing failures, keep the same Site identity and follow the [workflow](../SKILL.md#workflow).

## Project configuration

For an unknown or invalid starter profile, run `node <plugin-root>/scripts/configure-execution-profile.mjs` in the checkout. Restart preview if the profile changes; keep valid dependencies. If `configured: false`, preserve the project's configuration.

For a static-to-Worker migration, prepare the starter separately and port existing content, assets, and behavior before removing obsolete output. Preserve the repository, `project_id`, audience, and bindings; remove `static` from the source manifest. Continue with the main [build and packaging step](../SKILL.md#4-validate-and-package).

## Preview

For managed preview failures, read the `sites-preview start` error and `sites-preview status` output. Follow [managed preview](preview/managed.md); stop before restarting after a repair. Portable previews follow [local preview](preview/local.md).

Repair identified source or configuration defects before publishing; retain proven compatibility repairs. Retry preview only after a concrete repair or evidence of infrastructure recovery. Missing CLI, daemon, browser routing, or static-preview dependencies are environment limitations. For managed previews, do not replace infrastructure, change network permissions, bypass the sandbox, or modify working application code to compensate. Report browser QA as unverified and continue appropriate checks and publishing unless passing browser QA is required.

## Continue or Report

If deployment reports success without a URL, make one status call for that deployment; report incomplete verification if the URL is still missing.


---

원본 파일: `skills/sites/templates/vinext-starter/README.md`

# vinext-starter

A clean full-stack starter running on [vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git and `tar` (including Windows `tar.exe`) are required for publishing; portable publication does not require Bash

## Sites Lifecycle

The Sites initializer copies the shared starter and selects managed-linux only when `SITES_MANAGED_LINUX_CONTAINER=1`; otherwise it selects portable. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles copy/configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Run `node <plugin-root>/scripts/configure-execution-profile.mjs` only when the profile is unknown for the current checkout and environment. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This starter does not use `wrangler.jsonc`.

Publish archives outside the source checkout or under its ignored `outputs/` directory. Local `.env*`, `.dev.vars*`, TypeScript build state, and tool runtime directories are ignored; keep the hosting manifest, migrations, and authored scripts in source control.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback.

For managed Linux browser QA, follow the Sites skill's managed preview reference. The daemon runs the project's Vite dev script with `--host 0.0.0.0 --port 4173 --strictPort`; use the CLI's returned URL. The ignored local profile survives the daemon's cleared environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `worker/index.ts` is the production Worker entrypoint and preserves request-scoped connector bindings
- `scripts/vite/` contains the maintained Vite integrations and the vendored Sites plugin license
- `scripts/connector-preview/` contains the local connector preview Worker and session helpers
- the remaining `scripts/` files select execution profiles and run installation, development, and builds; the plugin's helpers orchestrate the Sites lifecycle
- `dist/` contains generated deployment output; `.vinext/`, `.wrangler/`, and `.sites-runtime/` contain ignored local tool state
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)


---

원본 파일: `skills/sites/templates/vinext-starter/vendor/shadcn-tailwind-4.13.0.LICENSE.md`

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


---

원본 파일: `skills/sites/templates/worker-esm-starter/README.md`

# Sites Worker ESM starter

Use this starter for a static microsite, click counter, or simple internal UI whose state is browser-scoped. It has no dependencies and needs no install.

Edit `worker/index.js`, then publish through the Sites hosting workflow with this starter's build and validation in `commands`.

The build copies only `worker/index.js` and `.openai/hosting.json`. Do not add standalone asset files. Embed any essential raster bytes in `worker/index.js` and serve or reference them as a data URL.

Pass these argument arrays as `commands`:

```json
[
  ["bash", "scripts/build.sh"],
  ["node", "scripts/validate-artifact.mjs"]
]
```

The deterministic build produces:

```text
dist/
├── .openai/
│   └── hosting.json
└── server/
    └── index.js
```

`dist/server/index.js` is an ES module with a default export containing `fetch(request, env, ctx)`. Edit `worker/index.js`, not the generated file under `dist/`.


---

원본 파일: `skills/sites-remix/SKILL.md`

---
name: sites-remix
description: Remix a Site built with the Sites plugin into a new Site. Use when the user has identified the source Site and asks to remix it.
---

# Remix a Site

A remix is a new Site built by adapting an existing Site.

- Remix creates an unpublished Site from the **published source**, with fresh Git history and destination hosting identity.
- Runtime settings, database records, and stored files are **not copied**. Bundled content is copied. Database schema may be recoverable from source, but source access does not guarantee a complete schema.

## Workflow

Follow these five steps when a user requests a remix.

1. **Create.** If the source is unclear, follow [source clarification](../sites/SKILL.md#1-select-and-open). Use a supplied Site mention's project ID, or resolve the supplied URL/slug with `search_sites`; do not infer IDs, explore unrelated Sites, or require editor-only `get_site` on the original. Choose an initial title/slug and call `remix_site`. Stop if unavailable. Retry an explicitly rejected slug; reconcile uncertain creation before retrying.
2. **Inspect.** [Open the destination](../sites/SKILL.md#1-select-and-open) as an existing hosted Site. Inspect its content, features, storage schema, integrations, and required runtime environment variables from source and documentation. Do not invent missing requirements.
3. **Decide content and features.** Check copied-content treatment and feature choices separately using [Intake questions](#intake-questions). Skip only decisions already supplied. Finish these decisions before asking for configuration values or confirmation.
4. **Configure, adapt and publish.** After intake, handle [Setup](#setup) instructions and confirmations in plain chat. Work in the destination checkout without registering again or generating a starter. Apply [Implementation requirements](#implementation-requirements), then use the [Sites workflow](../sites/SKILL.md#workflow) to build, save, and deploy. Verify retained features work or are intentionally disabled, and respect requests not to publish. Return here for the remix handoff.
5. **Follow up.** Deployment does not finish the remix response. Use [Final handoff](#final-handoff), including when setup issues dominated the conversation.

## Intake questions

- Resolve unclear copied-content treatment and undecided features. A vague request needs useful intake. Skip supplied decisions; preserve the design and unspecified features. Ask about intended use only if it changes the work, as a separate decision; do not offer a generic design refresh.
- For unresolved copied-content treatment, offer two outcomes: keep the copied content, or clear it for replacement content added later. Apply replacement details already supplied. Decide content treatment before proposing new wording; title, audience, and feature changes are separate decisions.
- Use `request_user_input_async` or its available equivalent for intake, falling back to chat. Limit intake to **three questions total**. Offer two or three concrete choices where useful, recommended first, with neutral labels avoiding first- or second-person pronouns.
- Ask one decision per question. Every option must answer that same decision and make sense when selected alone. The tool already provides custom input; never add an option that merely asks for a typed answer. Unanswered questions are not consent.
- For an undecided feature requiring environment variables or an account connection, briefly explain what is needed and who supplies or connects it. Keep inspection summaries, setup instructions, identifiers, and test logistics outside question titles/options. Configuration values and confirmations belong to [Setup](#setup), after intake.
- Explain uncopied data once. Missing content starts empty and can be added after publishing; do not ask users to choose between an empty start and later content, or request uploads during intake.

## Implementation requirements

Apply these requirements while adapting the copied Site.

- **Content and features:** Preserve the design unless a change is explicitly requested; keep unspecified features. Apply confirmed removals to UI and behavior. For temporary disabling, preserve client and server implementations, including inputs and action handlers; guard execution so re-enabling does not require rebuilding the feature. Adapt or clear source-specific links and stored-file dependencies along with their content. Missing or deferred content starts empty, with useful empty states and supported add/upload actions; add samples only when requested. External content needs supported access before it can be used.
- **Storage:** For retained functionality, [recreate required D1 schema and R2 bindings](../sites/references/storage.md) without asking infrastructure questions. Skip resources used only by removed or disabled features. Distinguish required reference data from user records; report incomplete schema rather than guessing. Validate migrations locally and verify hosted storage after deployment applies them.

## Setup

After content and feature decisions, use plain chat for configuration instructions and confirmations, not the intake question tool. A request to keep a feature working resolves only that feature choice; resolve any unspecified copied-content treatment before proceeding to its missing setup.

- **Environment variables and connections:** Required environment variables supply runtime configuration read by the code. Guard calls when required values are missing; preserve normal visitor account-connection flows. Unavailable verification is not consent to add disable switches or disable a retained feature; report it as unverified. If missing owner-provided variables block requested functionality, ask for setup or explicit deferral before publishing. Configure only variables needed by retained features; keep explicitly deferred features disabled. Continue independent work while waiting; do not claim unverified features work.
- **Secret entry:** Collect non-sensitive environment-variable values in plain chat and save them with `update_environment_variables`. Users save secrets directly in Site settings → **Environment variables**, with **Secret** enabled; never collect secret values in chat or source. Wait for confirmation, then use `get_environment_variables` to verify presence without reading values; redacted values are not missing. Deploy a saved version after environment variables change to apply them. Follow [Secrets](../sites/references/identity-and-secrets.md#secrets) for supported `OPENAI_API_KEY` setup.

## Final handoff

Before sending the post-publish response, include each applicable item:

- **Deferred content, including uncopied records/files:** Offer a warm, optional invitation in plain chat to share content or a source when ready, and explain how it will be used. Acknowledge known sources and the next step. Do not require an answer or upload now.
- **Remaining setup:** Name the affected feature, exact missing environment variable/enable flag and non-secret value, configuration location or connection step, and any code toggle/redeploy still needed. Include these in the response, not only a source file. Direct secret entry to Site settings; verify presence after confirmation and functionality before claiming readiness.
