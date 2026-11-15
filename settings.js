const settings = {
    // DoomBots is configured for a local, headless Minecraft server by default.
    // Change these values when joining a LAN or remote server.
    "minecraft_version": "auto",
    "host": "127.0.0.1",
    "port": 25565,
    "auth": "offline",

    // The DoomBots control dashboard.
    "mindserver_port": 8080,
    "auto_open_ui": true,

    "base_profile": "assistant",
    "profiles": [
        "./profiles/doombots/scout.json",
        "./profiles/doombots/miner.json",
        "./profiles/doombots/builder.json",
        "./profiles/doombots/farmer.json",
        "./profiles/doombots/guard.json"
    ],

    "load_memory": false,
    "init_message": null,
    "only_chat_with": [],

    "speak": false,
    "chat_ingame": true,
    "language": "en",
    "render_bot_view": false,

    // Keep the local 0.5B model on safe, built-in Mineflayer commands only.
    "allow_insecure_coding": false,
    "allow_vision": false,
    "blocked_actions": [
        "!newAction",
        "!checkBlueprint",
        "!checkBlueprintLevel",
        "!getBlueprint",
        "!getBlueprintLevel"
    ],
    "code_timeout_mins": -1,
    "relevant_docs_count": 2,

    // These limits keep five Node workers and one shared Ollama model comfortable on 5 GB RAM.
    "max_messages": 8,
    "num_examples": 0,
    "max_commands": 2,
    "command_docs": "compact", // "compact" is tailored to qwen2.5:0.5b; use "full" for larger models
    "show_command_syntax": "shortened",
    "narrate_behavior": false,
    "chat_bot_messages": false,

    "spawn_timeout": 45,
    "block_place_delay": 100,
    "log_all_prompts": false,
};

export default settings;
