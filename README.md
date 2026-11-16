# DoomBots

**DoomBots** is a five-agent Minecraft crew for Linux. One locally hosted
[`qwen2.5:0.5b`](https://ollama.com/library/qwen2.5) model controls five focused
Mineflayer bots through Ollama:

| Bot | Job |
| --- | --- |
| `DoomScout` | Explore and report resources or danger |
| `DoomMiner` | Gather stone, ore, and fuel |
| `DoomBuilder` | Organize materials and build with built-in commands |
| `DoomFarmer` | Maintain food, wood, and basic supplies |
| `DoomGuard` | Protect the crew and report threats |

The default is deliberately conservative: code generation, vision, example
embeddings, and bot-camera rendering are off. Each bot uses the same Ollama
model; DoomBots does **not** load five model copies.

> [!IMPORTANT]
> The 5 GB target is for a **headless Linux server** running a small headless
> Minecraft server, Ollama, and DoomBots. It is not a promise that a graphical
> Minecraft client plus other desktop applications will fit in 5 GB.

## Quick start on Linux (5 GB preset)

### 1. Install prerequisites

- Linux with about **5 GB RAM** and 2+ CPU cores
- Node.js **18, 20, or 22**
- [Ollama](https://ollama.com/download/linux)
- A Java Minecraft server (a current 1.21.x server is recommended)
- `curl`, which the launcher uses to check Ollama

On Debian/Ubuntu, install the basics with:

```bash
sudo apt update
sudo apt install -y curl openjdk-21-jre-headless
```

Install Node.js and Ollama using their official Linux instructions. Confirm
both are available:

```bash
node --version
ollama --version
```

### 2. Start a small local Minecraft server

Start the server **headlessly** on `127.0.0.1:25565`, which is the DoomBots
default in `settings.js`. Give Java a modest heap, for example:

```bash
java -Xms512M -Xmx1024M -jar server.jar nogui
```

The supplied profiles use offline authentication for local testing. For an
offline server, set `online-mode=false` in `server.properties` and keep it on a
trusted local network. For a normal authenticated or remote server, change
`host`, `port`, and `auth` in `settings.js`; use five valid Minecraft accounts
when the server requires Microsoft authentication.

### 3. Install and launch

```bash
git clone https://github.com/fallendrake0-droid/Doombots.git
cd Doombots
npm install
npm run start:lowram
```

On first start, the launcher starts a local Ollama service if one is not already
running and pulls `qwen2.5:0.5b`. It runs Ollama with one parallel request and
one loaded model, then starts all five bots. Open the dashboard at
[http://localhost:8080](http://localhost:8080).

In Minecraft, send a bot a whisper, for example:

```text
/msg DoomMiner collect 16 cobblestone
/msg DoomScout find oak logs and report back
/msg DoomGuard follow Steve and keep them safe
```

The bots coordinate through the control server, but it is best to assign a
clear task to the role that owns it. Use the dashboard to stop or restart an
individual bot.

## Why this fits the target

The default low-RAM configuration makes these trade-offs:

| Component | Low-memory choice |
| --- | --- |
| LLM | One shared `qwen2.5:0.5b` Ollama model, 2,048-token context |
| Ollama concurrency | `OLLAMA_NUM_PARALLEL=1`; requests queue instead of loading parallel contexts |
| Extra models | Embeddings are explicitly disabled; no `embeddinggemma` download is needed |
| Bot workers | Five Node processes inherit a 384 MB V8 heap ceiling |
| Prompts | Compact command reference, no example retrieval, eight-message history |
| Minecraft | Headless server with a 1 GB Java heap example |
| Rendering | Bot camera rendering and vision are disabled |

A practical budget is roughly 0.8–1.3 GB for Ollama and the quantized model,
1–2 GB for the five bot workers, 0.8–1.2 GB for a small Minecraft server, and
the rest for Linux and disk cache. Actual use varies by Minecraft version,
world size, mods, and player count. If the machine swaps or bots are killed by
the OOM killer, lower the Java heap and stop other services before increasing
any DoomBots limits.

## Deterministic protection, PvP, and teamwork

DoomBots does not wait for the language model to react to physics or survival
hazards. The deterministic layer runs before the optional AI prompt loop:

- **Survival controller:** uses matching inventory potions for lava/fire
  resistance, healing, regeneration, water breathing, and other requested safe
  effects; consumes an emergency golden apple at critical health; swims upward
  when actual Mineflayer oxygen falls below the configured threshold; and
  attempts normal water-bucket, cobweb, slime-block, or hay-bale fall clutches
  when the target is in normal interaction range.
- **Combat controller:** validates targets, excludes DoomBots and configured
  teammates, checks normal melee range, line of sight, and weapon cooldowns,
  follows through Mineflayer pathfinding, refreshes normal armour, raises an inventory shield
  at short range, retreats at low health, and uses a lightweight bow lead
  calculation only when a bow shot is relevant. It does not forge packets,
  fake critical hits, or bypass anti-cheat checks. Add trusted non-DoomBot
  names to `combat.team_players` to exclude them from every combat target path.
- **Bodyguard controller:** `!bodyguard("PlayerName")` makes a bot follow and
  defend that player from nearby hostile mobs. Defence against a player observed
  swinging at the protected player is additionally available only after an
  operator sets `bodyguard.protect_from_players` to `true` for a server where it
  is authorised. `!stopBodyguard` ends protection.
- **Fleet coordinator:** `!squadTask("guard", "PlayerName", 1)` and
  `!squadTask("gather", "oak_log", 32)` select an available role-appropriate
  bot, prevent duplicate active tasks, and send a validated task over the
  existing control server.
- **Builder:** `!buildStructure("shelter", "oak_planks", 5)` creates a
  bounded, inventory-backed shelter, platform, or tower via normal block
  placement; it does not generate or execute arbitrary building code.

Use a direct command when you need a specific outcome:

```text
/msg DoomGuard !bodyguard("Steve")
/msg DoomScout !squadTask("gather", "oak_log", 32)
/msg DoomMiner !usePotion("fire_resistance")
/msg DoomBuilder !buildStructure("shelter", "oak_planks", 5)
```

The model may optionally return a small JSON action plan, but the plan is
strictly parsed and converted into the existing command validator. Unknown
commands, malformed JSON, unsafe argument types, embedded commands, and
arbitrary JavaScript are rejected before a game action can run. The parent also
rejects any dashboard or environment configuration that enables `!newAction`.

### Ollama reliability

All worker requests use the parent control server's bounded Ollama gateway by
default. The gateway has one shared queue, configurable concurrency, a bounded
backlog, request timeouts, cancellation when a bot disconnects, and lightweight
wait/run metrics. This avoids each bot independently sending uncontrolled
requests to Ollama. The parent also rejects any model other than the required
DoomBots model, including dashboard-created agents.

The required model is **exactly** `qwen2.5:0.5b` with digest prefix
`a8b0c5157701`. Both `npm start` and `npm run start:lowram` verify the
installed digest through Ollama before starting the fleet; the low-RAM launcher
can pull the named local model first. Startup intentionally fails instead of
silently substituting a different model.

### Reliability and protocol handling

Each bot remains an isolated child process with its own Mineflayer client,
controllers, state, event listeners, and bounded exponential reconnect policy.
An individual disconnect or protocol/parser error restarts only that bot; it no
longer exits the five-bot parent. Packet handling normalises the known nested
velocity shape when present and retains the **latest** throttled movement packet
rather than a stale one. Packet parser failures are reported and cause a
controlled per-bot restart instead of being hidden.

## Configuration

The five default profiles live in `profiles/doombots/`. They all explicitly use:

```json
{
  "model": {
    "api": "ollama",
    "model": "qwen2.5:0.5b",
    "params": {
      "options": { "num_ctx": 2048, "num_predict": 96 }
    }
  },
  "model_digest": "a8b0c5157701",
  "embedding": "none"
}
```

Useful overrides:

```bash
# Use an Ollama server on another machine or in Docker.
OLLAMA_URL=http://192.168.1.20:11434 npm run start:lowram

# Give each bot a different V8 heap ceiling, in MB.
DOOMBOTS_AGENT_HEAP_MB=320 npm run start:lowram

# Keep one inference active at a time on a low-RAM machine (the default).
# Increase only after measuring host RAM and Ollama latency.
DOOMBOTS_OLLAMA_CONCURRENCY=1 DOOMBOTS_OLLAMA_MAX_QUEUE=12 npm run start:lowram

# Change the bounded Ollama request deadline, in milliseconds.
DOOMBOTS_OLLAMA_TIMEOUT_MS=45000 npm run start:lowram
```

`OLLAMA_URL` is also honored when running `npm start`. The low-RAM script only
starts and pulls from a local Ollama endpoint (`127.0.0.1` or `localhost`); for
a remote endpoint, pull the model there first.

Run these after changing the default profiles to verify the five-bot low-RAM
preset and record the actual host/runtime capabilities:

```bash
npm run check:config
npm run test:unit
npm run diagnose:runtime
```

`test:unit` covers pure policy and queue behavior with mocks. It does **not**
connect to a Minecraft server or a running Ollama service; validate those
separately on the target Linux host with `npm run start:lowram`.

### Docker

Docker is optional. Run Ollama and Minecraft on the Linux host, then point the
container at Ollama using `OLLAMA_URL=http://host.docker.internal:11434`. The
included Compose file has the `host.docker.internal` gateway mapping needed on
Linux. Native Linux is the simplest option for a 5 GB machine.

## Safety

DoomBots blocks `!newAction` and keeps insecure code generation off. Do not
change `allow_insecure_coding` or connect bot accounts to an untrusted public
server unless you understand the security implications. Treat all in-game chat
as untrusted input.

## Project lineage

DoomBots is a focused configuration and branding of the Mineflayer multi-agent
framework originally developed by the Mindcraft contributors. Its controller
boundaries were independently designed after studying the lifecycle/task ideas
in `emirks/mineflayer-bots`; combat capability boundaries were independently
designed after studying `nxg-org/mineflayer-custom-pvp`. No source was copied
from either reference. This matters because the installed reference metadata
lists GPL-3.0 for the PvP project while DoomBots remains MIT-licensed. See the
repository history and [LICENSE](LICENSE) for attribution and licensing.
