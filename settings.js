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
    "combat": {
        "enabled": true,
        "autonomous_defense": false,
        "allow_player_targets": false,
        "team_players": [],
        "legacy_self_defense": false,
        "attack_range": 3.05,
        "track_range": 18,
        "retreat_health": 6,
        "defensive_equipment": { "enabled": true, "shield_min_range": 3.5, "shield_max_range": 8 },
        "ranged": { "enabled": true, "min_range": 7, "max_range": 22 }
    },
    "survival": {
        "enabled": true,
        "health_potion_threshold": 9,
        "emergency_health_threshold": 5,
        "drowning_air_threshold": 4,
        "clutch": {
            "enabled": true,
            "strategies": ["water_bucket", "cobweb", "slime_block", "hay_bale"]
        }
    },
    "bodyguard": {
        "enabled": true,
        "guard_distance": 3,
        "threat_radius": 12,
        "protect_from_players": false,
        "protect_from_mobs": true
    },
    "reconnect": {
        "enabled": true,
        "max_attempts": 8,
        "base_delay_ms": 1000,
        "max_delay_ms": 30000,
        "stable_reset_ms": 30000
    },
    "fleet": {
        "status_interval_ms": 2000,
        "status_heartbeat_ms": 10000,
        "status_ttl_ms": 15000,
        "task_timeout_ms": 900000,
        "task_retention_ms": 900000,
        "max_retries": 2,
        "retry_delay_ms": 2000,
        "max_tasks": 64,
        "max_observations": 96,
        "observation_ttl_ms": 300000,
        "task_priorities": { "defend": 90, "guard": 80, "escort": 70, "gather": 40 }
    },
    "metrics": {
        "enabled": true,
        "sample_interval_ms": 5000,
        "max_samples": 120,
        "resource": true,
        "bot": true,
        "task": true,
        "ai_queue": true,
        "pathfinding": true,
        "reconnection": true
    },
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
