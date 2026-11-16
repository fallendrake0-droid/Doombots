# DoomBots reliability engineering report

**Audit date:** 2026-11-15 (London)
**Scope:** the committed five-bot DoomBots profile, not a claim of live-world validation.

## Executive summary

DoomBots is configured as five independently controllable Mineflayer workers:
`DoomScout`, `DoomMiner`, `DoomBuilder`, `DoomFarmer`, and `DoomGuard`. They use
one parent-controlled local Ollama service and the only accepted model is
`qwen2.5:0.5b` with digest prefix `a8b0c5157701`. Startup and dashboard-created
agents reject other models, embeddings, and JavaScript-generating action paths.

The reliability work separates fast deterministic safety/combat decisions from
small-model reasoning, isolates each bot in a child process, bounds all shared
work/retention, and makes fleet coordination stateful and recoverable. Headless
workers now avoid importing optional camera/WebGL/cloud-model modules on the
normal DoomBots path.

## Architecture and control boundaries

```text
Minecraft events
  -> isolated Mineflayer child (one per bot)
  -> deterministic survival / bodyguard / legal combat controllers
  -> validated command/action manager
  -> normal Mineflayer + Pathfinder operations

Human chat or compact model request
  -> bounded parent Socket.IO bridge
  -> one priority/cancellable Ollama gateway
  -> exact qwen2.5:0.5b local model
  -> plain command or validated scalar JSON action plan
  -> registered command validation (never arbitrary JavaScript)

Fleet status/task/observation
  -> parent FleetCoordinator
  -> bounded role-aware task/observation records
  -> only relevant registered workers
```

The parent control server binds to `localhost`. Each worker receives an
in-memory generated, per-process control token through its child environment;
the server verifies it before binding a socket to a bot and ignores a superseded
socket's later disconnect. This prevents unauthenticated local Socket.IO clients
from replacing an agent channel merely by knowing its Minecraft name. Localhost
is still the dashboard trust boundary: a hostile same-account/local process is
not protected by per-user dashboard authentication. If the dashboard must be
reachable over a network, place it behind an authenticated TLS reverse proxy and
do not expose Minecraft/offline-mode accounts to untrusted users.

See [DOOMBOTS_ARCHITECTURE.md](DOOMBOTS_ARCHITECTURE.md) for the component map
and state-flow details.

## Findings, root causes, and implemented fixes

| Finding / root cause | Fix and location |
| --- | --- |
| A generic task handoff had no explicit state/owner/retry contract, so duplicate work, orphaned work, and stale observations could occur. | `src/mindcraft/fleet_coordinator.js` now tracks queued, assigned, active, completed, failed, interrupted, expired, and cancelled outcomes; validates owner/state transitions; blocks equivalent active tasks; records bounded history; prioritises role-compatible work; retries only to a cap; wakes once for the next retry or deadline. `src/agent/fleet/fleet_client.js` reports state, reacts to cancellation, and retains only bounded newer observations. |
| Fleet recovery could depend on unrelated activity after a delay. | A single injected/testable scheduler handles delayed retry **and** assigned/active task timeout deadlines, cancelling itself when no future task event remains. |
| Workers could be left locally busy after an operator/fleet cancellation. | Worker cancellation interrupts the active action/bodyguard state, clears local ownership, and refreshes status. `!stop` reports an interrupt for an active fleet task. |
| Dashboard state polling waited serially without an acknowledgement deadline, so one bad worker could delay all cards. | `mindserver.js` requests agent state in parallel, applies a 3-second deadline per worker, avoids overlapping polls, and clamps `DOOMBOTS_STATE_POLL_MS` to 1–10 seconds. |
| Parent resource/task/AI/pathfinding/reconnect information was not presented as one bounded operational signal. | `src/mindcraft/runtime_metrics.js` samples only on ordinary status/query activity, has category toggles and capped retention, emits `runtime-metrics`, and is rendered in the local dashboard. |
| A dashboard setting restart rechecked model policy but not endpoint/auth shape, and an arbitrary local socket could claim a public bot name. | `src/mindcraft/connection_policy.js` validates hostname/IP format, port range, auth (`offline` or `microsoft`), and version type on both create and settings update paths. `AgentConnection` creates a per-child control token, `AgentProcess` passes it only in the child environment, and `mindserver.js` validates it before socket binding. Explicit incompatible version preflight is rejected; transient preflight failures use Mineflayer negotiation. |
| LAN discovery checked 16,000 ports one at a time and globally muted `console.log`, delaying start and affecting unrelated logs. | `src/mindcraft/mcserver.js` now uses bounded-concurrency socket attempts and does not mutate global logging. |
| The headless path eagerly imported Prismarine Viewer/WebGL/canvas and cloud model/TTS modules, increasing per-worker memory and making `canvas` installation a hard failure. | Graphics, remote TTS, wiki parsing, and translation imports are lazy. `canvas`, `node-canvas-webgl`, `prismarine-viewer`, and `three` are optional dependencies; the Docker image uses lockfile-verified `npm ci --omit=optional --omit=dev`. `DOOMBOTS_OLLAMA_ONLY=1` limits child model-module discovery to the local Ollama adapter. |
| A packet workaround could produce stale movement output. | The packet guard only normalises finite known velocity shapes and, when a normal movement packet is rate-limited, flushes the newest state. It does not alter combat/rotation packets or bypass anti-cheat. |

## Key files and interfaces

- `settings.js` — exactly five role profiles; bounded fleet/metrics defaults;
  legal combat, safety, bodyguard, reconnect, and low-RAM defaults.
- `main.js`, `scripts/check-ollama-model.mjs`, `model_policy.js` — exact model
  availability/digest gate; no silent model substitution.
- `src/mindcraft/ollama_gateway.js` — one bounded priority queue with request
  timeout, cancellation on disconnect, single-flight, peak/timeout metrics, and
  deterministic failure responses.
- `src/mindcraft/fleet_coordinator.js` — parent task/observation ownership and
  bounded recovery state machine.
- `src/agent/fleet/fleet_client.js`, `src/agent/mindserver_proxy.js` — compact
  worker status, task status/cancel, and observation socket protocol.
- `src/mindcraft/mindserver.js` — registered-agent checks, dashboard controls,
  dashboard metrics stream, and safe state poll fan-out.
- `src/agent/combat/`, `src/agent/safety/`, `src/agent/guard/` — deterministic
  normal-gameplay combat/survival/bodyguard controllers.
- `src/process/agent_process.js` — per-worker child lifecycle/backoff; one bot
  failure does not terminate the remaining four.
- `src/utils/packet_guard.js` — narrow compatibility guard rather than broad
  parser error suppression.

## Compatibility and safety boundaries

- The combat implementation uses ordinary Mineflayer target selection, normal
  reach, line-of-sight, cooldown-aware attacks, pathfinding, shield/equipment,
  retreat, and lightweight projectile lead. It excludes packet exploits,
  critical-hit spoofing, deceptive rotations, and anti-cheat bypasses.
- Bodyguard defense is named-player based. Player-versus-player defence remains
  conservative and requires explicit configuration/observed aggression.
- Survival uses normal inventory and placement operations for food, shield,
  potions, fire/lava response, drowning mitigation, and reachable water/cobweb/
  slime/hay-bale clutch strategies. Server gameplay rules can still reject a
  normal operation.
- Model output is text or a small validated action plan. `!newAction` is
  blocked and untrusted chat cannot become executable JavaScript.
- Only compact, role-targeted observations cross workers. They have allowlisted
  topics, safe-size fields, timestamp age/future-skew checks, TTL, and stale
  replacement protection.
- The client/server protocol work is based on source-level Mineflayer and
  plugin API inspection. It does not claim packet compatibility against every
  server/mod/proxy combination.

## Dependency and performance audit

The low-RAM baseline is intentionally headless:

- `qwen2.5:0.5b` is one local Ollama model with one configured parallel request;
  embeddings, bot camera rendering, vision, examples, remote TTS, and code
  generation are disabled.
- Each bot child inherits a 384 MiB V8 heap cap by default; this is a guardrail,
  not a memory reservation. The user must still measure RSS and leave capacity
  for Ollama, Java, Linux, world/mod load, and disk cache.
- Graphics packages are optional because native `canvas` installation can fail
  on systems without a usable prebuild or Node build headers. They are not
  imported in the normal headless path.
- The repository retains upstream multi-provider modules for compatibility, but
  the DoomBots child sets the local-Ollama-only module selection and profile
  policy. The five-bot runtime does not select an alternate provider.
- No new external runtime dependency was added for coordination or metrics.
  Timer, socket, resource, and retention handling uses Node built-ins and
  existing Socket.IO/Mineflayer dependencies. `package-lock.json` is committed
  for reproducible installs; use `npm ci` rather than resolving a fresh graph.
- `npm audit --omit=optional --audit-level=high` completed with **no high or
  critical findings** after moving unused cloud SDKs out of the baseline. It
  still reports 11 moderate findings in the Mineflayer authentication chain
  (`minecraft-protocol` → `prismarine-auth`/`yggdrasil` → `uuid`); npm reports
  no fix currently available. Treat that upstream dependency result as a
  deployment risk to revisit when Mineflayer publishes an update.

## Inspiration and licensing boundary

Architecture was independently informed by public Mineflayer project patterns:
per-session factories, explicit lifecycle/backoff, compact queues, separation
of combat responsibilities, and normal Mineflayer APIs. No source code or
packages were copied from those projects. In particular, unsafe packet,
velocity, critical-hit, or anti-cheat-evasion methods are excluded. Existing
project licensing and dependency licenses continue to govern their own code.

## Exact Linux setup and startup

1. Install Node.js 18, 20, or 22; Ollama; `curl`; and a headless Java runtime.
   For Debian/Ubuntu: `sudo apt update && sudo apt install -y curl openjdk-21-jre-headless`.
2. Start a trusted Minecraft server. The default is `127.0.0.1:25565` with
   offline auth for local testing. A small baseline is:

   ```bash
   java -Xms512M -Xmx1024M -jar server.jar nogui
   ```

   For a remote/authenticated server, change `host`, `port`, and `auth` in
   `settings.js` and use valid Microsoft accounts. Do not use offline mode on an
   untrusted network.
3. Clone and install the headless baseline:

   ```bash
   git clone https://github.com/fallendrake0-droid/Doombots.git
   cd Doombots
   npm ci --omit=optional
   npm run check:config
   npm run test:unit
   npm run start:lowram
   ```

4. `start:lowram` starts local Ollama only when necessary, pulls only
   `qwen2.5:0.5b` for a local endpoint, verifies digest `a8b0c5157701`, then
   starts the five workers. It aborts if model verification fails. The dashboard
   is `http://localhost:8080`.
5. Measure the target host during a supervised first run. Adjust Java heap or
   stop unrelated services before raising bot/Ollama limits. Use
   `npm run diagnose:runtime` to record actual installed/reachable components.

Useful bounded overrides:

```bash
DOOMBOTS_AGENT_HEAP_MB=320 npm run start:lowram
DOOMBOTS_OLLAMA_CONCURRENCY=1 DOOMBOTS_OLLAMA_MAX_QUEUE=12 npm run start:lowram
DOOMBOTS_OLLAMA_TIMEOUT_MS=45000 DOOMBOTS_STATE_POLL_MS=3000 npm run start:lowram
```

## Verification status

### Tested in this checkout

- `npm run test:unit`: **45 passing** dependency-free Node tests with mocks for task
  ownership/priority/retry/timeout/observation freshness, retry timer cleanup,
  lifecycle failure/reconnect/cancellation, Ollama queue priority/single-flight/
  timeout/cancellation, runtime metric capping, connection policy, packet guard,
  action plan validation, combat math/policy, and survival policy.
- `npm run check:config`: validates exactly five profiles, exact model/digest
  profile policy, disabled embeddings, bounded fleet settings, safety/bodyguard,
  reconnect, and metrics configuration.
- `node --check` on changed production modules and `git diff --check`.

### Not tested here

- A real Minecraft server/proxy/modpack, five authenticated sessions, actual
  Mineflayer pathfinding/collection/armour APIs, combat, bodyguard, fall clutch,
  packet handling, or multi-bot recovery under live latency.
- A reachable local Ollama endpoint and the actual digest response for the
  required model.
- Docker/Compose startup, native optional graphics/vision, remote TTS,
  translation, or browser-specific dashboard behaviour.

### Blocked in this environment

The sandbox initially lacked runtime packages and a reachable local Ollama
service. The former direct `canvas` install path also encountered a certificate
failure for a prebuild followed by Node-header download failure. Graphics are
now optional, and a locked `npm ci --omit=optional` install succeeds here, but
live game/Ollama validation remains environment-specific. No Minecraft server,
accounts, or Docker daemon are available here. The existing ESLint flat config
also targets browser globals/ECMAScript 2021 while the Node ESM codebase uses
`process` and top-level `await`; a broad pre-existing lint cleanup was not used
as a release gate. Syntax checks and the test suite are the static checks
reported above.

### Recommended before production use

1. Run the exact startup sequence above on the target Linux host and retain the
   `check-ollama-model` output.
2. Use a private staging world to test all five joins, disconnect/reconnect,
   task expiry/reassignment, operator cancellation, and restart controls.
3. Test only legitimate combat/survival commands with the target server's rules
   and obtain authorization for any player-protection configuration.
4. Monitor dashboard RSS/heap and host memory over a normal world session;
   lower Java/bot limits if the host swaps or approaches OOM.
5. Keep the localhost dashboard private or deploy a properly authenticated TLS
   proxy before any remote access.
