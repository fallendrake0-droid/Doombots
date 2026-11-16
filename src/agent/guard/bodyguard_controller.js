import pf from 'mineflayer-pathfinder';
import { isHostile } from '../../utils/mcdata.js';
import { yawTo } from '../combat/math.js';

const DEFAULTS = {
    enabled: true,
    guard_distance: 3,
    threat_radius: 12,
    player_threat_ttl_ms: 9000,
    follow_update_ms: 800,
    protect_from_players: false,
    protect_from_mobs: true
};

function mergeConfig(config = {}) {
    return { ...DEFAULTS, ...config };
}

function yawDifference(first, second) {
    let difference = Math.abs(first - second) % (Math.PI * 2);
    return difference > Math.PI ? Math.PI * 2 - difference : difference;
}

/**
 * Bodyguard mode protects a named player with deterministic follow and threat
 * selection. A player is only marked hostile after a nearby attack animation
 * is directed at the protected player, preventing attacks on peaceful players.
 */
export class BodyguardController {
    constructor(agent, config = {}) {
        this.agent = agent;
        this.config = mergeConfig(config);
        this.protectedPlayer = null;
        this.lastFollowAt = 0;
        this.playerThreats = new Map();
        this._onSwing = this.onEntitySwing.bind(this);
        this.agent.bot.on('entitySwingArm', this._onSwing);
    }

    updateConfig(config = {}) {
        this.config = mergeConfig(config);
    }

    start(username) {
        if (!this.config.enabled || !/^[A-Za-z0-9_]{3,16}$/.test(username || '')) {
            return { success: false, error: 'A valid Minecraft player name is required.' };
        }
        // A guard assignment owns movement until it is stopped. Interrupt any
        // queued legacy action rather than letting two controllers race the
        // pathfinder for a goal.
        this.agent.actions?.cancelResume();
        this.agent.requestInterrupt?.();
        this.protectedPlayer = username;
        this.playerThreats.clear();
        this.agent.combat.stop();
        return { success: true, message: `Bodyguard mode active for ${username}.` };
    }

    stop() {
        const previous = this.protectedPlayer;
        this.protectedPlayer = null;
        this.playerThreats.clear();
        this.agent.combat.stop();
        return previous ? `Stopped guarding ${previous}.` : 'Bodyguard mode was not active.';
    }

    isActive() {
        return !!this.protectedPlayer;
    }

    getStatus() {
        return {
            active: this.isActive(),
            protectedPlayer: this.protectedPlayer,
            playerThreats: this.playerThreats.size
        };
    }

    isTeamMember(entity) {
        if (!entity || entity.type !== 'player') return false;
        if (entity.username === this.protectedPlayer || entity.username === this.agent.name) return true;
        return this.agent.combat.isTeammate(entity);
    }

    onEntitySwing(entity) {
        // Animation alone is not authoritative proof of player-vs-player
        // aggression, so this optional policy must be explicitly enabled by a
        // server operator before a guard can defend against player targets.
        if (!this.isActive() || !this.config.protect_from_players || entity?.type !== 'player' || this.isTeamMember(entity)) return;
        const protectedEntity = this.agent.bot.players[this.protectedPlayer]?.entity;
        if (!protectedEntity?.position || !entity.position) return;
        const nearProtected = entity.position.distanceTo(protectedEntity.position) <= 4.5;
        const aimedAtProtected = yawDifference(entity.yaw ?? 0, yawTo(entity.position, protectedEntity.position)) < 0.9;
        if (nearProtected && aimedAtProtected) {
            this.playerThreats.set(entity.id, Date.now() + this.config.player_threat_ttl_ms);
            this.agent.combat.reportThreat(entity, 'attacking_protected_player', this.config.player_threat_ttl_ms);
        }
    }

    reportThreat(entity, reason = 'shared_threat') {
        if (!this.isActive() || !entity) return false;
        this.agent.combat.reportThreat(entity, reason, this.config.player_threat_ttl_ms);
        return true;
    }

    async followProtectedPlayer(entity) {
        const now = Date.now();
        if (now - this.lastFollowAt < this.config.follow_update_ms) return;
        this.lastFollowAt = now;
        try {
            const movements = new pf.Movements(this.agent.bot);
            movements.canDig = false;
            movements.canPlaceOn = false;
            movements.allow1by1towers = false;
            this.agent.bot.pathfinder.setMovements(movements);
            this.agent.bot.pathfinder.setGoal(new pf.goals.GoalFollow(entity, this.config.guard_distance), true);
        } catch (error) {
            console.warn(`[bodyguard:${this.agent.name}] follow update failed:`, error.message);
        }
    }

    updateThreats(protectedEntity) {
        const now = Date.now();
        for (const [entityId, expiresAt] of this.playerThreats) {
            const entity = this.agent.bot.entities[entityId];
            if (expiresAt <= now || !entity?.position) {
                this.playerThreats.delete(entityId);
                continue;
            }
            this.agent.combat.reportThreat(entity, 'recent_player_attack', expiresAt - now);
        }

        if (!this.config.protect_from_mobs) return;
        for (const entity of Object.values(this.agent.bot.entities)) {
            if (!isHostile(entity) || !entity.position) continue;
            if (entity.position.distanceTo(protectedEntity.position) <= this.config.threat_radius) {
                this.agent.combat.reportThreat(entity, 'near_protected_player', 1500);
            }
        }
    }

    async update() {
        if (!this.isActive() || !this.config.enabled) return;
        const protectedEntity = this.agent.bot.players[this.protectedPlayer]?.entity;
        if (!protectedEntity?.position) return;
        this.updateThreats(protectedEntity);

        // Combat takes exclusive control of pathfinding while a threat is live.
        // Only resume close escort positioning once there is no active target.
        if (!this.agent.combat.target) {
            await this.followProtectedPlayer(protectedEntity);
        }
    }

    dispose() {
        this.agent.bot.removeListener('entitySwingArm', this._onSwing);
        this.stop();
    }
}
