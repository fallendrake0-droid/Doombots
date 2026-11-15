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

## Configuration

The five default profiles live in `profiles/doombots/`. They all explicitly use:

```json
{
  "api": "ollama",
  "model": "qwen2.5:0.5b",
  "params": {
    "options": { "num_ctx": 2048, "num_predict": 96 }
  },
  "embedding": "none"
}
```

Useful overrides:

```bash
# Use an Ollama server on another machine or in Docker.
OLLAMA_URL=http://192.168.1.20:11434 npm run start:lowram

# Give each bot a different V8 heap ceiling, in MB.
DOOMBOTS_AGENT_HEAP_MB=320 npm run start:lowram
```

`OLLAMA_URL` is also honored when running `npm start`. The low-RAM script only
starts and pulls from a local Ollama endpoint (`127.0.0.1` or `localhost`); for
a remote endpoint, pull the model there first.

Run this after changing the default profiles to verify the five-bot low-RAM
preset:

```bash
npm run check:config
```

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
framework originally developed by the Mindcraft contributors. See the
repository history and [LICENSE](LICENSE) for attribution and licensing.
