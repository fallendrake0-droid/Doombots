import os from 'os';
import fs from 'fs';

// Automatic environment detection for Termux, low RAM (<=4GB), and headless Linux
export const isTermux = Boolean(
    process.env.TERMUX_VERSION || 
    (process.env.PREFIX && process.env.PREFIX.includes('com.termux'))
);

const totalMemBytes = (typeof os.totalmem === 'function') ? os.totalmem() : 4 * 1024 * 1024 * 1024;
export const isLowMemorySystem = totalMemBytes <= 4.5 * 1024 * 1024 * 1024; // 4GB or less
const autoLowMem = process.env.LOW_MEMORY_MODE !== undefined 
    ? process.env.LOW_MEMORY_MODE === 'true' 
    : (isTermux || isLowMemorySystem);

const autoFastMode = process.env.FAST_MODE !== undefined
    ? process.env.FAST_MODE !== 'false'
    : true; // Default to fast mode for fastest response times

const settings = {
    "minecraft_version": "auto", // or specific version like "1.21.6"
    "host": "127.0.0.1", // or "localhost", "your.ip.address.here"
    "port": 55916, // set to -1 to automatically scan for open ports
    "auth": "offline", // or "microsoft"

    // Performance & Memory optimization for Linux 4GB RAM & Termux
    "fast_mode": true, // eliminates artificial latency, enables async memory saves
    "low_memory_mode": true, // memory caps, periodic chunk pruning, aggressive GC
    "max_agent_memory_mb": isTermux ? 512 : 768, // Node V8 heap ceiling per agent (optimized for 4GB RAM)

    // the mindserver manages all agents and hosts the UI
    "mindserver_port": 8080,
    "auto_open_ui": false, // Do not auto-open browser on startup (user can open manually)
    
    "base_profile": "assistant", // survival, assistant, creative, or god_mode
    "profiles": [
        "./andy.json",
        // "./profiles/fast.json",       // Ultra-fast and accurate (Groq / Cerebras)
        // "./profiles/cerebras.json",   // World-record inference speed (Cerebras)
        // "./profiles/sambanova.json",  // Ultra-fast SN40L inference (SambaNova)
        // "./profiles/together.json",   // Blazing fast Llama-3.3-Turbo (Together AI)
        // "./profiles/fireworks.json",  // Fast & accurate low-latency (Fireworks AI)
        // "./profiles/deepseek.json",   // DeepSeek V3/R1
        // "./profiles/gpt.json",        // OpenAI GPT
        // "./profiles/claude.json",     // Anthropic Claude
        // "./profiles/gemini.json",     // Google Gemini Flash
        // "./profiles/llama.json",      // Llama 3.3
        // "./profiles/qwen.json",       // Qwen 2.5
    ],

    "load_memory": false, // load memory from previous session
    "init_message": "Respond with hello world and your name", // sends to all on spawn
    "only_chat_with": [], // users that the bots listen to and send general messages to. if empty it will chat publicly
    "allies": ["orbryx"], // trusted allies that bots will protect, escort, and never attack

    "speak": false,
    // allows all bots to speak through text-to-speech. 
    // specify speech model inside each profile with format: {provider}/{model}/{voice}.
    // if set to "system" it will use basic system text-to-speech. 
    // Works on windows and mac, but linux requires you to install the espeak package through your package manager eg: `apt install espeak` `pacman -S espeak`.

    "chat_ingame": true, // bot responses are shown in minecraft chat
    "language": "en", // translate to/from this language. Supports these language names: https://cloud.google.com/translate/docs/languages
    "bot_count": 5, // Number of bots to spawn into Minecraft (default: 5)
    "spawn_delay": 14, // Seconds to stagger multi-bot logins (avoids Aternos/Spigot connection rate limit throttle)
    "skin": {
        "name": "Zolvd",
        "url": "https://namemc.com/texture/777895bfd4bb9994.png",
        "path": "https://namemc.com/texture/777895bfd4bb9994.png",
        "model": "classic"
    },
    "render_bot_view": true, // Enable 2D/3D World View in browser (http://localhost:3000)
    "viewer_primary_only": true, // Stream world view from primary bot (port 3000) to keep CPU & network light
    "viewer_first_person": false, // false for 2D side-scroller view (Mario-style), true for 3D first-person
    "view_distance": 2, // World view render distance in chunks (optimized for 4GB RAM, weak CPU/GPU, fast FPS)

    "allow_insecure_coding": true, // Enable full action capability & code writing ("make it so they can do everything")
    "allow_vision": false, // allows vision model to interpret screenshots as inputs (keep false on Termux)
    "blocked_actions" : ["!checkBlueprint", "!checkBlueprintLevel", "!getBlueprint", "!getBlueprintLevel"] , // commands to disable and remove from docs. Ex: ["!setMode"]
    "code_timeout_mins": -1, // minutes code is allowed to run. -1 for no timeout
    "relevant_docs_count": 2, // number of relevant code function docs to select for prompting (optimized for minimum tokens)

    "minimize_tokens": true, // optimize prompts across all bots to consume minimum tokens
    "max_messages": 6, // lean conversation context to keep token usage low
    "num_examples": 1, // single concise example minimizes prompt overhead
    "max_commands": -1, // max number of commands that can be used in consecutive responses. -1 for no limit
    "show_command_syntax": "shortened", // condensed command syntax to save 800+ tokens per request
    "narrate_behavior": true, // chat simple automatic actions ('Picking up item!')
    "chat_bot_messages": true, // publicly chat messages to other bots

    "spawn_timeout": 90, // num seconds allowed for the bot to spawn before throwing error. Increase when spawning takes a while.
    "block_place_delay": 0, // delay between placing blocks (ms) if using newAction. helps avoid bot being kicked by anti-cheat mechanisms on servers.
  
    "log_all_prompts": false, // log ALL prompts to file
};

// Automatically load saved terminal configuration if config.json exists
try {
    if (fs.existsSync('./config.json')) {
        const savedConfig = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        Object.assign(settings, savedConfig);
    }
} catch {
    // ignore
}

export default settings;
