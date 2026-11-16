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
| Fleet lifecycle | `src/mindcraft/mindcraft.js`, `src/process/agent_process.js` | Starts one child process per bot; controlled bounded reconnect only for the failed bot. |
| Control server | `src/mindcraft/mindserver.js` | Dashboard sockets, bot state, fleet task routing, shared Ollama requests. |
| Model policy and Ollama gateway | `src/mindcraft/model_policy.js`, `src/mindcraft/ollama_gateway.js` | Rejects non-`qwen2.5:0.5b` profiles/digests and any JavaScript-enabled setting, then provides one priority queue, timeout, backlog cap, cancellation, and metrics for all workers. |
| Agent | `src/agent/agent.js` | Mineflayer lifecycle, chat routing, validated commands, controller update order. |
| Modes | `src/agent/modes.js` | Per-agent cloned automatic modes; no module-level agent or mode state. |
| Safety | `src/agent/safety/survival_controller.js` | Potions, lava/fire response, emergency food, and supported clutch strategies. |
| Combat | `src/agent/combat/` | Legal target selection, normal reach/line-of-sight/cooldown-aware melee, pathfinding, retreat, and bounded bow lead. |
| Bodyguard | `src/agent/guard/bodyguard_controller.js` | Follows a named player and reports mob/recent player attack threats to combat. |
| Coordination | `src/mindcraft/fleet_coordinator.js`, `src/agent/fleet/fleet_client.js` | Compact status exchange and role-aware, duplicate-safe squad task allocation. |
| Builder | `src/agent/build/build_controller.js` | Bounded, inventory-backed shelter/platform/tower plans using normal placement. |
| Protocol guard | `src/utils/packet_guard.js` | Safe velocity-shape normalisation and latest-packet movement throttling. |

## Priority order

1. **Safety:** lava/fire resistance, healing, emergency food, and clutching.
2. **Active bodyguard threats / combat:** only server-valid Mineflayer actions.
3. **Explicit validated user or fleet tasks.**
4. **Existing automatic modes and optional self-prompting.**

A current action can still be interrupted by the existing action manager. New
controllers avoid long work inside a physics tick; they perform inexpensive
state checks on the agent update loop and start only bounded normal Mineflayer
operations.

## Isolation and failure handling

Each DoomBot owns its Mineflayer instance, controllers, mode state, sockets,
timers, inventory, pathfinder, and reconnect state in a dedicated Node child
process. Shared state exists only in the parent control server and is compact:
connection state, role, current action, health/position snapshot, task records,
and Ollama queue metrics. A child failure cannot call `process.exit()` in the
fleet parent.

## Diagnostics and verification

- `npm run diagnose:runtime` reports the actual Node/OS/CPU/RAM environment,
  installed Mineflayer plugin versions when dependencies are present, and the
  reachable Ollama version/model tags. It reports unavailable components rather
  than guessing their version.
- `npm run check:config` validates exactly five named role profiles, the model
  tag/digest requirement, no embedding model, and required safety/reconnect
  controls. Every normal startup also queries Ollama's model tags and refuses
  to run unless the required installed digest is present.
- `npm run test:unit` uses mock child processes, sockets/fetches, packet
  clients, and pure policy modules. It covers lifecycle success/failure/retry/
  cancellation, AI queue timeout/cancellation/concurrency/single-flight,
  action-plan validation, task ownership/expiry/reassignment, and combat and
  survival decisions. It does not simulate a live Minecraft server.

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
