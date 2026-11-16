# DoomBots runtime architecture

## Request and action path

```text
Minecraft event
  -> isolated Agent child process
  -> deterministic controllers (survival, bodyguard, combat)
  -> mode controller / validated command handler
  -> Mineflayer + Pathfinder action
  -> Minecraft server

Human instruction
  -> Mineflayer chat or whisper
  -> Agent history + compact prompt
  -> parent-process Ollama gateway (bounded shared queue)
  -> qwen2.5:0.5b
  -> plain command or validated JSON action plan
  -> existing command parameter/domain validation
  -> ActionManager serialises the game action
```

The model never receives authority to execute JavaScript. `!newAction` remains
blocked in the DoomBots profile. Structured plans are converted back into the
existing command parser, where action names, argument counts, types, item/block
names, and numeric domains are checked.

## Components

| Component | Location | Responsibility |
| --- | --- | --- |
| Entry point | `main.js` | Loads the five role profiles and starts the control server. |
| Fleet lifecycle | `src/mindcraft/mindcraft.js`, `src/process/agent_process.js` | Starts one child process per bot; validates local connection/auth settings and uses controlled bounded reconnect only for the failed bot. |
| Control server | `src/mindcraft/mindserver.js` | Localhost dashboard sockets, bot state, bounded state polling, validated fleet routing, shared Ollama requests, and metrics emission. |
| Model policy and Ollama gateway | `src/mindcraft/model_policy.js`, `src/mindcraft/ollama_gateway.js` | Rejects non-`qwen2.5:0.5b` profiles/digests and any JavaScript-enabled setting, then provides one priority queue, timeout, backlog cap, cancellation, and queue/latency/peak metrics for all workers. |
| Agent | `src/agent/agent.js` | Mineflayer lifecycle, chat routing, validated commands, controller update order. |
| Modes | `src/agent/modes.js` | Per-agent cloned automatic modes; no module-level agent or mode state. |
| Safety | `src/agent/safety/survival_controller.js` | Potions, lava/fire response, emergency food, and supported clutch strategies. |
| Combat | `src/agent/combat/` | Legal target selection, normal reach/line-of-sight/cooldown-aware melee, pathfinding, retreat, and bounded bow lead. |
| Bodyguard | `src/agent/guard/bodyguard_controller.js` | Follows a named player and reports mob/recent player attack threats to combat. |
| Coordination | `src/mindcraft/fleet_coordinator.js`, `src/agent/fleet/fleet_client.js` | Compact status exchange; role-aware priority allocation; duplicate prevention; ownership/state validation; bounded retry, expiry, cancellation, and timestamp-safe role-targeted observations. |
| Runtime metrics | `src/mindcraft/runtime_metrics.js` | On-demand/interval-capped parent resource, bot, task, Ollama, pathfinding, and reconnection snapshots with bounded retention. |
| Connection policy | `src/mindcraft/connection_policy.js`, `src/mindcraft/mcserver.js` | Rejects malformed host/port/auth settings before spawning; preserves Mineflayer negotiation on transient preflight failure; uses bounded-concurrency LAN discovery. |
| Builder | `src/agent/build/build_controller.js` | Bounded, inventory-backed shelter/platform/tower plans using normal placement. |
| Protocol guard | `src/utils/packet_guard.js` | Safe velocity-shape normalisation and latest-packet movement throttling. |
| Optional integrations | `src/agent/vision/`, `src/agent/speak.js`, `src/utils/translator.js`, `package.json` | Viewer/WebGL, remote cloud/TTS, translation, and wiki-parsing imports are lazy/optional; headless workers do not load them by default. |

## Priority order

1. **Safety:** lava/fire resistance, healing, emergency food, and clutching.
2. **Active bodyguard threats / combat:** only server-valid Mineflayer actions.
3. **Explicit validated user or fleet tasks.**
4. **Existing automatic modes and optional self-prompting.**

A current action can still be interrupted by the existing action manager. New
controllers avoid long work inside a physics tick; they perform inexpensive
state checks on the agent update loop and start only bounded normal Mineflayer
operations.

## Fleet protocol and retention bounds

Tasks use `queued → assigned → active → completed|failed|cancelled`; recovery
can report `interrupted` and return the task to `queued`, while task expiry is
tracked in the coordinator metrics. The coordinator validates the owner on
all state changes, records a compact bounded failure history, keeps at most the
configured task/observation records, and rejects equivalent active objectives.
`defend`, `guard`, `escort`, and `gather` have configurable priorities. A single
scheduled wake-up handles the next delayed retry **or** task deadline; it is
cancelled when no task needs it, so recovery does not create a polling loop or
unbounded timer set.

A worker reports a compact heartbeat only when its status changes or the
configured heartbeat period elapses. Observations are limited to `resource`,
`hazard`, `threat`, and `location`; their subject, size, recipient roles,
position, timestamp age/future skew, and replacement order are checked before
storage. Only relevant roles receive the stored summary. Operator stop and
coordinator cancel both interrupt local work and clear worker ownership before
future work is accepted.

## Isolation and failure handling

Each DoomBot owns its Mineflayer instance, controllers, mode state, sockets,
timers, inventory, pathfinder, and reconnect state in a dedicated Node child
process. Shared state exists only in the parent control server and is compact:
connection state, role, current action, health/position snapshot, task records,
and Ollama queue metrics. A child failure cannot call `process.exit()` in the
fleet parent. Dashboard full-state requests are parallel, individually capped
at three seconds, and non-overlapping; the normal control page poll is bounded
by `DOOMBOTS_STATE_POLL_MS` (2 seconds by default, clamped to 1–10 seconds).

The control server binds to `localhost`, which is the authentication boundary
for this release. Each spawned agent receives an ephemeral per-process control
token through its environment and must authenticate before it can own an agent
socket; a superseded socket cannot clear a newer worker's availability.
Agent-originated fleet operations require that registered identity, and dashboard
setting changes revalidate both the exact model policy and connection settings.
Do not reverse-proxy the dashboard to an untrusted network without an external
authenticated TLS proxy; per-user dashboard auth is not implemented here.

## Diagnostics and verification

- `npm run diagnose:runtime` reports the actual Node/OS/CPU/RAM environment,
  installed Mineflayer plugin versions when dependencies are present, and the
  reachable Ollama version/model tags. It reports unavailable components rather
  than guessing their version.
- `npm run check:config` validates exactly five named role profiles, the model
  tag/digest requirement, no embedding model, and required safety/reconnect
  controls. Every normal startup also queries Ollama's model tags and refuses
  to run unless the required installed digest is present.
- `npm run test:unit` uses mock child processes, timers, sockets/fetches,
  packet clients, and pure policy modules. It covers lifecycle success/failure/
  retry/cancellation, AI queue timeout/cancellation/concurrency/single-flight,
  task ownership/priority/expiry/reassignment/observation freshness, runtime
  metric retention, connection validation, and combat/survival decisions. It
  does not simulate a live Minecraft server.
- `get-runtime-metrics` and the dashboard `runtime-metrics` stream expose the
  latest bounded sample; disabling individual `settings.metrics` categories
  omits them without starting a new sampler loop.

## Design limits

- The PvP controller does not forge packets, emulate invalid critical hits, or
  bypass server-side range/cooldown/anti-cheat checks.
- Player defence requires a nearby observed swing aimed at the protected player;
  it does not attack arbitrary nearby players.
- Clutch placement is only attempted when normal interaction range allows it.
  The built-in supported strategies are water bucket, cobweb, slime block, and
  hay bale; a game server may still reject placement due to ordinary gameplay
  conditions.
- Integration testing against a live Minecraft server and a local Ollama service
  is required before relying on automation on a production world.
- Native browser rendering, WebGL screenshots, remote TTS, translation, and
  non-Ollama providers are optional features, not part of the low-RAM baseline.
  Enable/install their dependencies deliberately and test them separately.
