<h1 align="center">🤖 DOOMBOTS ⛏️</h1>
<p align="center">
  <strong>Autonomous AI Minecraft Agent Platform • Multi-Version Cross-Play Engine</strong><br>
  Powered by Local & Cloud LLMs • Mineflayer • ViaVersion / Geyser Bridging
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="#-server-connectivity--aternos">Server Setup</a> •
  <a href="#-ai-models--providers">AI Models</a> •
  <a href="#-performance-modes">Performance Modes</a> •
  <a href="#-cli-flags">CLI Reference</a>
</p>

---

## ⚡ Highlights

- **Local Out-of-the-Box**: Defaults to **`ollama/qwen2.5:0.5b`** — no API keys or credit cards required!
- **Interactive Startup Control**: When launched, prompts `Press 'e' for setup or press [Enter] to run (auto-run in 5s)...` with instant Cyberpunk terminal dashboard.
- **Universal Multi-Version Cross-Play**: Bridges Minecraft versions from 1.18 through 1.21.11, 1.26.3, and 26.3 (Spigot, Paper, Geyser, ViaVersion, and ViaBackwards). Includes LoginGuard protections against invalid movement kicks.
- **2D Mario Side-View Live Stream**: Integrated side-scrolling camera on port 3000 (`http://localhost:3000`) smoothly tracking bots with minimal GPU/CPU overhead.
- **Smart Death Item Retrieval via `/back`**: Automatically executes `/back` on respawn to instantly teleport to death coordinates and vacuum dropped gear on mob or hazard deaths. Intelligently detects item-destroying deaths (lava, fire, void, cactus) and PVP player deaths to strictly skip item recovery, eliminating hazardous death loops and player feeding.
- **Manual `/tpa` Teleport Execution (No AI)**: `/tpa orbryx` and player teleport requests are strictly manual and direct, completely bypassing AI LLM inference for zero token cost, instant execution, and eliminating unintended automated teleport triggers.
- **Zero-API Offline Command Suite**: Complete offline squad control without requiring any API keys or when LLM quotas are exhausted. Directly execute `inv`, `status`, `mine`, `farm`, `defend`, `follow me`, `craft`, `smelt`, `build shelter`, `eat`, `pickup`, `drop all`, and `help` instantly with zero token consumption.
- **Ultra-Low Memory & Hardware Optimization**: Fully tuned for 4GB RAM systems, weak multi-core CPUs, and integrated GPUs with 512MB heap ceilings, V8 GC sweeps, and chunk memory limits.
- **Server Auto-Resolution**: Connects directly to LAN, VPS, or remote hosts like Aternos with automatic DNS SRV record resolution.
- **Sub-Second Cloud Speed**: Built-in support for **GroqCloud** (~0.3s responses) and **Cerebras** (1000+ tok/s).
- **Ultra-Low Memory Ready**: Runs smoothly on 4GB Linux, ChromeOS Crostini containers, and Android Termux with optimized V8 heap limits and automatic chunk pruning.
- **Control Center Web Dashboard**: Live web interface hosted at `http://localhost:8080` (`controlcenter:localhost`).

---

## 🚀 Quick Start

### 1. Requirements

- **Node.js**: v18 or v20 LTS recommended (`node -v`).
- **Minecraft**: Java Edition (v1.18 to v1.21.11, or Bedrock servers using Geyser).
- **Ollama** (for local offline mode): [Download Ollama](https://ollama.com/) and run:
  ```bash
  ollama pull qwen2.5:0.5b
  ollama serve &
  ```

### 2. Installation

Clone the repository and install dependencies:
```bash
git clone https://github.com/fallendrake0-droid/Doombots.git
cd Doombots
npm install --omit=optional
```

### 3. Launch Doombots

Start the agent:
```bash
npm start
```

When started, Doombots immediately displays the Cyberpunk terminal dashboard:
```
  ██████╗   ██████╗   ██████╗  ███╗   ███╗██████╗   ██████╗ ████████╗███████╗
  ██╔══██╗ ██╔═══██╗ ██╔═══██╗ ████╗ ████║██╔══██╗ ██╔═══██╗╚══██╔══╝██╔════╝
  ██║  ██║ ██║   ██║ ██║   ██║ ██╔████╔██║██████╔╝ ██║   ██║   ██║   ███████╗
  ██║  ██║ ██║   ██║ ██║   ██║ ██║╚██╔╝██║██╔══██╗ ██║   ██║   ██║   ╚════██║
  ██████╔╝ ╚██████╔╝ ╚██████╔╝ ██║ ╚═╝ ██║██████╔╝ ╚██████╔╝   ██║   ███████║
  ╚═════╝   ╚═════╝   ╚═════╝  ╚═╝     ╚═╝╚═════╝   ╚═════╝    ╚═╝   ╚══════╝
  Autonomous AI Minecraft Agent Platform • Multi-Version Cross-Play Engine

  ┌──────────────────────────────────────────────────────────────────────────┐
  │  🎮 CONTROL CENTER : controlcenter:localhost (http://localhost:8080)     │
  │  🌍 TARGET SERVER  : 127.0.0.1:55916 (Protocol: Java 1.21.4 • ViaVersion)│
  │  🤖 ACTIVE AGENT   : Doombot                                             │
  │  🧠 AI MODEL       : ollama/qwen2.5:0.5b                                 │
  │  🛡️ LOGIN GUARD    : Active (Minecraft 1.21.11 & Geyser / Aternos)       │
  │  ⚡ ENGINE MODE    : Fast Response (0ms delay) | Low-Memory (4GB RAM)    │
  └──────────────────────────────────────────────────────────────────────────┘

[Doombots] Press 'e' for setup or press [Enter] to run (auto-run in 5s)...
```

- **Press `[Enter]`** (or wait 5 seconds): Starts `Doombot` immediately using your current settings.
- **Press `e`**: Opens the interactive configuration wizard to change your model, server host/port, API keys, or bot name.
- **Skip prompt**: Run `npm start -- --now` (or `node main.js --now`).

---

## 🌍 Server Connectivity & Aternos

Doombots supports all Minecraft server environments out-of-the-box:

### Connecting to a Remote Server / Aternos

You can connect directly from the command line using `--host`:

```bash
# Connect to your Aternos server (supports host:port syntax)
npm start -- --host ZCClanOnTOP.aternos.me:38410

# Or with node directly
node main.js --host ZCClanOnTOP.aternos.me:38410
```

> **Aternos Tips**:
> 1. In your Aternos dashboard, make sure your server is online.
> 2. Click **Connect** on your dashboard to find your unique 5-digit port (e.g. `38410`).
> 3. In Aternos **Options**, turn **ON 'Cracked'** if you are connecting with offline authentication.
> 4. If a whitelist is enabled on your server, run `/whitelist add Doombot` in the server console.

### Connecting to Local / LAN Worlds

1. In Minecraft, open your single-player world.
2. Press **Esc** -> **Open to LAN** -> note the port (or set it to `55916`).
3. Run `npm start -- --port <port>`.

---

## 🧠 AI Models & Providers

Doombots supports **over 50 AI providers** with automatic multi-key rotation and low-latency streaming:

### 1. Offline Local Mode (Default: `ollama/qwen2.5:0.5b`)
- Runs 100% locally on your machine without an internet connection or API keys.
- Requires Ollama running in the background (`ollama serve`).

### 2. Ultra-Fast Cloud Mode (Recommended: GroqCloud ~0.3s)
For near-instant sub-second bot reactions on low-spec hardware (Chromebooks, laptops):
1. Get a free API key at [console.groq.com](https://console.groq.com).
2. Run `npm start`, press **`e`**, select **GroqCloud**, and paste your key.
3. The bot will think and reply at **500+ tokens/sec**!

### Supported Providers

| Provider | Model Flag / ID | Key Env Variable | Speed / Feature |
| :--- | :--- | :--- | :--- |
| **Ollama (Local)** | `ollama/qwen2.5:0.5b` | *None needed* | 100% offline, default, privacy-first |
| **GroqCloud** | `groq/openai/gpt-oss-120b` | `GROQCLOUD_API_KEY` | Ultra-fast (~0.3s responses, free tier) |
| **Cerebras** | `cerebras/llama-3.3-70b` | `CEREBRAS_API_KEY` | World-record inference (1000+ tok/s) |
| **SambaNova** | `sambanova/Meta-Llama-3.3-70B-Instruct` | `SAMBANOVA_API_KEY` | Blazing SN40L hardware speed |
| **Together AI** | `together/meta-llama/Llama-3.3-70B-Instruct-Turbo` | `TOGETHER_API_KEY` | Fast open models & Turbo Llama |
| **DeepSeek** | `deepseek/deepseek-chat` | `DEEPSEEK_API_KEY` | DeepSeek-V3 and DeepSeek-R1 |
| **OpenAI** | `openai/gpt-4o-mini` | `OPENAI_API_KEY` | GPT-4o, GPT-4o-mini, o1, o3-mini |
| **Google Gemini** | `google/gemini-2.0-flash` | `GEMINI_API_KEY` | Gemini 2.0 Flash / Pro |
| **Anthropic** | `anthropic/claude-3-5-sonnet-latest` | `ANTHROPIC_API_KEY` | Claude 3.5 Sonnet & Haiku |
| **xAI Grok** | `xai/grok-2-latest` | `XAI_API_KEY` | Grok-2 |
| **Mistral** | `mistral/mistral-large-latest` | `MISTRAL_API_KEY` | Mistral Large, Codestral |
| **Custom / OpenAI-compat** | `custom/<model>` | `CUSTOM_API_KEY` | Connect to any local or self-hosted API |

---

## ⚡ Performance Modes

### Low-Memory Mode (4GB RAM Linux / ChromeOS / Termux)
Designed specifically for resource-constrained systems:
- Caps V8 heap size to avoid Linux OOM-killer crashes.
- Employs compact command documentation and removes verbose block dumps from prompts.
- Periodically unloads distant chunks from world cache.

Run with:
```bash
npm run start:low-mem
# or: node main.js --low-memory
# or: ./start-low-memory.sh
```

### Fast Response Mode
Minimizes cooldown and latency:
- Eliminates the artificial 3-second delay between actions.
- Asynchronous background memory summarization.

Run with:
```bash
npm run start:fast
# or: node main.js --fast
```

---

## 💻 CLI Flags

| Flag | Alias | Description | Example |
| :--- | :--- | :--- | :--- |
| `--bots <count>` | `-b`, `--count` | Number of autonomous bots to spawn (default: 5) | `node main.js --bots 5` |
| `--viewer` | `-v`, `--view` | Enable 3D world view browser stream (default: true) | `node main.js --viewer` |
| `--host <address>` | | Target Minecraft server hostname/IP and optional port | `--host ZCClanOnTOP.aternos.me:38410` |
| `--port <port>` | | Target Minecraft server port | `--port 25565` |
| `--now` | `-y`, `--yes` | Skip startup prompt and connect immediately | `npm start -- --now` |
| `--configure` | `--setup` | Launch the interactive terminal setup wizard | `node main.js --configure` |
| `--fast` | | Enable fast response mode (0ms cooldown) | `node main.js --fast` |
| `--low-memory` | | Optimize memory for 4GB RAM, Chromebooks, and Termux | `node main.js --low-memory` |
| `--profiles <paths...>`| | Specify one or more custom bot profiles | `--profiles ./andy.json` |
| `--help` | `-h` | Display command-line help | `node main.js --help` |

---

## 🌐 3D Interactive World View

Doombots features an interactive **Three.js 3D World View** powered by Prismarine Viewer:
- **Direct Web Access**:
  - Bot 1 (`Doombot`): `http://localhost:3000`
  - Bot 2 (`Doombot2`): `http://localhost:3001`
  - Bot 3 (`Doombot3`): `http://localhost:3002`
  - Bot 4 (`Doombot4`): `http://localhost:3003`
  - Bot 5 (`Doombot5`): `http://localhost:3004`
- **Embedded in Dashboard**: View the 3D camera feeds live in the Control Center at `http://localhost:8080`, or click `🌐 3D View` on any bot card to open full-screen in a browser tab.
- **Controls**: Drag mouse to orbit camera, scroll to zoom, and toggle between third-person world view and first-person perspective.

---

## 🎮 Zero-API & No-Ollama Offline Command Suite

Doombots features a **massive built-in offline command engine** that functions **100% without an AI API key and without running Ollama**. You can speak to any bot in plain English in Minecraft chat, whisper, or broadcast to the squad from the Control Center dashboard (`http://localhost:8080`).

Every offline command runs with **0ms latency, zero tokens, and zero AI overhead**:

### 🛡️ Survival & Vitals
| Plain English Command | Fast Action |
| :--- | :--- |
| `eat` / `eat food` / `feed yourself` | Equips and consumes highest saturation food from inventory |
| `sleep` / `go to sleep` / `bedtime` | Locates nearest safe bed, navigates, and sleeps through night |
| `wake up` / `get out of bed` | Immediately awakens and leaves bed |
| `cure poison` / `drink milk` | Drinks milk bucket to remove negative status effects |
| `extinguish` / `put out fire` | Douses burning player or bot with water bucket |
| `swim up` / `surface water` | Swims vertically upward to reach surface air |
| `climb ladder` / `go up ladder` | Climbs nearest ladder or vine to top landing |

### 🌾 Farming & Livestock
| Plain English Command | Fast Action |
| :--- | :--- |
| `farm` / `harvest crops` | Harvests ripe crops within 16 blocks and replants seeds |
| `till soil` / `make farmland` | Uses hoe to till dirt/grass blocks near water |
| `plant seeds` / `plant crops` | Sows wheat, carrots, or potatoes onto farmland |
| `bonemeal crop` / `fertilize` | Applies bone meal to accelerate crop growth |
| `fish` / `go fishing` | Equips fishing rod, casts into water, and reels in catch |
| `shear sheep` | Shears nearby adult sheep for wool |
| `milk cow` | Uses empty bucket on nearby cow to gather milk |
| `feed animals` / `breed animals` | Feeds wheat or carrots to nearby farm animals |
| `lead animal` | Holds feed to lure animals into pens or enclosures |
| `harvest honey` | Safely harvests honey bottle or comb from beehive |

### ⛏️ Mining & Excavation
| Plain English Command | Fast Action |
| :--- | :--- |
| `mine [count] [block]` | Mines specified count or stacks of any block (e.g. `mine 3 stacks of iron ore`, `mine stone`, `mine andesite`) |
| `collect apples` | Gathers dropped apples and shears leaves |
| `chop tree` / `mine tree` | Cuts down entire tree from base to top canopy (never replants saplings) |
| `strip mine` / `tunnel forward` | Excavates efficient 1x2 tunnel forward with torch illumination |
| `quarry` / `dig quarry` | Excavates clean 3x3 quarry pit downward |
| `staircase down` | Carves safe walkable 3-step descending staircase |
| `find ores` / `locate ores` | Scans surroundings for diamonds, iron, gold, and redstone |
| `mine vein` | Extracts entire connected ore cluster |
| `mine obsidian` | Mines obsidian blocks with diamond pickaxe |
| `spelunking` / `explore cave` | Safely navigates cave system placing illumination torches |

### 🏰 Building & World Manipulation
| Plain English Command | Fast Action |
| :--- | :--- |
| `build wall` | Constructs 5-block long defensive stone/dirt wall |
| `build floor` | Lays smooth floor in 3x3 radius |
| `build box` / `build shelter` | Builds 3x3 protective shelter with door opening |
| `place door` | Installs wooden or iron door at nearest opening |
| `build lookout` / `pillar up` | Constructs vertical observation pillar with safety ledge |
| `fill holes` | Repairs and levels blast craters and dangerous pitfalls |
| `bridge chasm` / `bridge gap` | Bridges across ravines and hazardous gaps safely |
| `seal lava` | Encased or caps dangerous surface lava pools with cobblestone |
| `clear water` / `sponge water` | Absorbs or blocks nuisance water flows |
| `clear foliage` | Clears tall grass, ferns, vines, and shrubs |

### ⚔️ Combat & Squad Defense
| Plain English Command | Fast Action |
| :--- | :--- |
| `defend` / `hunt hostiles` | Hunts and eliminates all hostile monsters within 24 blocks |
| `shoot target` / `snipe mob` | Equips bow/crossbow and snipes distant creepers and skeletons |
| `shield bash` | Blocks with off-hand shield and strikes with weapon |
| `strike and retreat` | Executes hit-and-run tactics to avoid melee damage |
| `critical attack` | Jump-attacks on descent for critical hit damage |
| `flee` / `retreat` | Sprints 25 blocks away from overwhelming hostiles |
| `guard location` | Anchors to current coordinates and protects radius from intruders |
| `toggle pvp` | Toggles player-versus-player engagement mode |

### 🎒 Storage, Logistics & Chests
| Plain English Command | Fast Action |
| :--- | :--- |
| `inv` / `inventory` | Displays full itemized inventory count and hotbar |
| `status` | Reports health, hunger, armor rating, active mode, and coordinates |
| `deposit all` / `store items` | Transfers all gathered ores and blocks into nearest chest |
| `dump trash` | Discards junk items (poisonous potatoes, rotten flesh, seeds) |
| `take food from chest` | Withdraws food rations from nearest storage chest |
| `take ores from chest` | Withdraws raw iron, gold, or diamonds from chest |
| `fuel furnace` | Loads coal, charcoal, or wood into nearest furnace |
| `collect drops` / `vacuum loot` | Gathers all loose dropped items on the ground within 16 blocks |
| `repair item` | Combines damaged items or uses anvil for repair |

### 🤝 Squad Coordination & Roles
| Plain English Command | Fast Action |
| :--- | :--- |
| `regroup` / `squad assemble` | Orders all squad members to converge on caller's position |
| `squad formation [wedge/box/line]` | Sets tactical positioning around team lead |
| `assign miner` | Designates bot to focus on ore extraction and quarrying |
| `assign builder` | Designates bot to structure placement and masonry |
| `assign guard` | Designates bot to sentry duty and monster defense |
| `assign farmer` | Designates bot to agriculture and animal husbandry |
| `share food` | Passes excess bread, steak, or apples to low-hunger teammates |
| `distribute supplies` | Evens out pickaxes, torches, and weapons across squad |
| `assist teammate` | Rushes to nearest ally in combat or needing help |
| `set home` / `go home` | Saves base coordinates and returns home on command |
| `tpa orbryx` | Sends direct, manual teleport request to permanent ally orbryx |

---

## 🎮 In-Game Commands

Once `Doombot` joins your world, speak to the bot directly in Minecraft chat:

```
Hello Doombot!
!goToPlayer <your_username>
!followPlayer <your_username>
!collectBlocks wood 10
!craftRecipe wooden_pickaxe
!givePlayer <your_username> wood 5
!stop
```

You can also view real-time agent status, chat history, and inventory from the web dashboard at:
👉 **`http://localhost:8080`** (`controlcenter:localhost`)

---

## 🛡️ License

This project is open-source under the MIT License.
