import pf from 'mineflayer-pathfinder';
import { isHostile } from '../../utils/mcdata.js';
import { distance, planBowShot, withinReach } from './math.js';
import { entityIsUsable, isEligibleTarget, isExcludedPlayer } from './target_policy.js';
import { attackDelayMs, chooseCombatOperation, chooseMeleeWeapon } from './combat_policy.js';

const DEFAULTS = {
    enabled: true,
    autonomous_defense: false,
    allow_player_targets: false,
    legacy_self_defense: false,
    attack_range: 3.05,
    track_range: 18,
    retreat_health: 6,
    retarget_ms: 250,
    path_update_ms: 500,
    defensive_equipment: {
        enabled: true,
        shield_min_range: 3.5,
        shield_max_range: 8,
        equipment_refresh_ms: 15000
    },
    ranged: {
        enabled: true,
        min_range: 7,
        max_range: 22,
        charge_ms: 850,
        cooldown_ms: 1200
    }
};

function mergedConfig(config = {}) {
    return {
        ...DEFAULTS,
        ...config,
        defensive_equipment: { ...DEFAULTS.defensive_equipment, ...(config.defensive_equipment || {}) },
        ranged: { ...DEFAULTS.ranged, ...(config.ranged || {}) }
    };
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Deterministic, server-compatible combat. The controller only uses standard
 * Mineflayer movement, look, equip, attack, and bow-use APIs. It never edits
 * combat packets, fakes critical hits, or bypasses server attack checks.
 */
export class CombatController {
    constructor(agent, config = {}) {
        this.agent = agent;
        this.config = mergedConfig(config);
        this.threats = new Map();
        this.target = null;
        this.lastScanAt = 0;
        this.lastPathAt = 0;
        this.lastAttackAt = 0;
        this.lastRangedAt = 0;
        this.lastEquipAt = 0;
        this.lastDefenseEquipAt = 0;
        this.shieldRaised = false;
        this.rangedInFlight = false;
        this.operationId = 0;
        this.lastRetreatAt = 0;
    }

    updateConfig(config = {}) {
        this.config = mergedConfig(config);
    }

    reportThreat(entity, reason = 'detected', ttlMs = 8000) {
        if (!entityIsUsable(entity)) return false;
        this.threats.set(entity.id, {
            entity,
            reason,
            expiresAt: Date.now() + Math.max(500, ttlMs)
        });
        return true;
    }

    clearThreat(entityId) {
        this.threats.delete(entityId);
        if (this.target?.id === entityId) this.stop();
    }

    stop() {
        this.target = null;
        this.threats.clear();
        // Invalidate a bow draw before it can equip, aim, or fire after a
        // safety event, disconnect, bodyguard change, or target cancellation.
        this.operationId++;
        this.rangedInFlight = false;
        this.lowerShield();
        try {
            this.agent.bot.deactivateItem();
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] failed to release held item while stopping:`, error.message);
        }
        try {
            this.agent.bot.pathfinder.stop();
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] failed to stop pathfinder:`, error.message);
        }
        try {
            this.agent.bot.setControlState('left', false);
            this.agent.bot.setControlState('right', false);
            this.agent.bot.setControlState('sprint', false);
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] failed to clear movement controls:`, error.message);
        }
    }

    getStatus() {
        return {
            target: this.target?.username || this.target?.name || null,
            threatCount: this.threats.size,
            enabled: this.config.enabled
        };
    }

    isTeammate(entity) {
        const ownNames = [this.agent.name, this.agent.bot.username].filter(Boolean);
        const configured = this.config.team_players || [];
        const knownBots = this.agent.fleet?.getKnownBotNames?.() || [];
        return isExcludedPlayer(entity, ownNames, [...configured, ...knownBots]);
    }

    isValidTarget(entity, allowPlayers = false) {
        if (entity === this.agent.bot.entity) return false;
        return isEligibleTarget(entity, {
            allowPlayers,
            excludedPlayer: this.isTeammate(entity),
            hostile: isHostile(entity)
        });
    }

    selectTarget() {
        const now = Date.now();
        const candidates = [];
        for (const [id, threat] of this.threats) {
            const entity = this.agent.bot.entities[id] || threat.entity;
            if (threat.expiresAt <= now || !this.isValidTarget(entity, true)) {
                this.threats.delete(id);
                continue;
            }
            const targetDistance = distance(this.agent.bot.entity.position, entity.position);
            if (targetDistance <= this.config.track_range) candidates.push({ entity, targetDistance, priority: 2 });
        }

        if (this.config.autonomous_defense) {
            for (const entity of Object.values(this.agent.bot.entities)) {
                if (!this.isValidTarget(entity, this.config.allow_player_targets)) continue;
                const targetDistance = distance(this.agent.bot.entity.position, entity.position);
                if (targetDistance <= this.config.track_range) candidates.push({ entity, targetDistance, priority: 1 });
            }
        }

        candidates.sort((a, b) => b.priority - a.priority || a.targetDistance - b.targetDistance);
        return candidates[0]?.entity || null;
    }

    bestMeleeWeapon() {
        return chooseMeleeWeapon(this.agent.bot.inventory.items());
    }

    getAttackDelay(weapon) {
        // Wait slightly beyond a complete 1.9+ cooldown rather than relying on
        // client-side spam. The server remains the authority for every hit.
        return attackDelayMs(weapon);
    }

    async equipMeleeWeapon() {
        const now = Date.now();
        if (now - this.lastEquipAt < 750) return this.agent.bot.heldItem;
        const weapon = this.bestMeleeWeapon();
        if (!weapon) return null;
        if (this.agent.bot.heldItem?.name === weapon.name) return weapon;
        this.lastEquipAt = now;
        try {
            await this.agent.bot.equip(weapon, 'hand');
            return weapon;
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] failed to equip ${weapon.name}:`, error.message);
            return null;
        }
    }

    getShield() {
        return this.agent.bot.inventory.items().find(item => item.name === 'shield') || null;
    }

    async ensureDefensiveEquipment() {
        const { defensive_equipment } = this.config;
        const now = Date.now();
        if (!defensive_equipment.enabled || now - this.lastDefenseEquipAt < defensive_equipment.equipment_refresh_ms) return;
        this.lastDefenseEquipAt = now;
        try {
            // mineflayer-armor-manager uses ordinary inventory/equip packets.
            await this.agent.bot.armorManager?.equipAll?.();
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] defensive equipment refresh failed:`, error.message);
        }
    }

    async raiseShield(targetDistance) {
        const { defensive_equipment } = this.config;
        if (!defensive_equipment.enabled || this.shieldRaised || targetDistance < defensive_equipment.shield_min_range || targetDistance > defensive_equipment.shield_max_range) return false;
        const shield = this.getShield();
        if (!shield) return false;
        try {
            const offhand = this.agent.bot.inventory.slots?.[45];
            if (offhand?.name !== 'shield') await this.agent.bot.equip(shield, 'off-hand');
            this.agent.bot.activateItem(true);
            this.shieldRaised = true;
            return true;
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] shield raise failed:`, error.message);
            return false;
        }
    }

    lowerShield() {
        if (!this.shieldRaised) return;
        try {
            // deactivateItem releases use-item for either hand in Mineflayer.
            this.agent.bot.deactivateItem();
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] shield release failed:`, error.message);
        }
        this.shieldRaised = false;
    }

    async retreat(target) {
        const now = Date.now();
        if (now - this.lastRetreatAt < 1000) return;
        this.lastRetreatAt = now;
        try {
            const movements = new pf.Movements(this.agent.bot);
            movements.canDig = false;
            movements.canPlaceOn = false;
            this.agent.bot.pathfinder.setMovements(movements);
            this.agent.bot.pathfinder.setGoal(new pf.goals.GoalInvert(new pf.goals.GoalFollow(target, 7)), true);
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] retreat failed:`, error.message);
        }
    }

    async followTarget(target) {
        const now = Date.now();
        if (now - this.lastPathAt < this.config.path_update_ms) return;
        this.lastPathAt = now;
        try {
            const movements = new pf.Movements(this.agent.bot);
            movements.canDig = false;
            movements.canPlaceOn = false;
            movements.allow1by1towers = false;
            movements.allowParkour = false;
            this.agent.bot.pathfinder.setMovements(movements);
            this.agent.bot.pathfinder.setGoal(new pf.goals.GoalFollow(target, Math.max(2.2, this.config.attack_range - 0.35)), true);
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] target follow failed:`, error.message);
        }
    }

    getBow() {
        return this.agent.bot.inventory.items().find(item => item.name === 'bow') || null;
    }

    hasLineOfSight(target) {
        const bot = this.agent.bot;
        if (!target?.position || typeof bot.canSeeBlock !== 'function') return false;
        const targetHeight = Number.isFinite(target.height) ? target.height : 1.0;
        const sightBlock = bot.blockAt(target.position.offset(0, Math.max(0.4, targetHeight * 0.65), 0));
        if (!sightBlock) return false;
        try {
            // Mineflayer's canSeeBlock raycasts from the bot's eye and returns
            // false when an ordinary solid block is between this bot and the
            // target's eye-height block.
            return bot.canSeeBlock(sightBlock) === true;
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] line-of-sight check failed:`, error.message);
            return false;
        }
    }

    tryRangedAttack(target, targetDistance) {
        const { ranged } = this.config;
        if (!ranged.enabled || this.rangedInFlight || targetDistance < ranged.min_range || targetDistance > ranged.max_range) return false;
        if (!this.hasLineOfSight(target)) return false;
        if (Date.now() - this.lastRangedAt < ranged.cooldown_ms) return false;
        const bow = this.getBow();
        if (!bow) return false;

        const entityHeight = Number.isFinite(this.agent.bot.entity.height) ? this.agent.bot.entity.height : 1.8;
        const origin = this.agent.bot.entity.position.offset(0, entityHeight * 0.8, 0);
        const shot = planBowShot(origin, target.position, target.velocity);
        if (!shot) return false;

        // Charging a bow takes hundreds of milliseconds. Start it independently
        // so the agent update loop can continue running safety checks.
        this.rangedInFlight = true;
        this.lastRangedAt = Date.now();
        const operationId = ++this.operationId;
        void this.performRangedAttack(bow, shot, ranged.charge_ms, operationId);
        return true;
    }

    async performRangedAttack(bow, shot, chargeMs, operationId) {
        try {
            this.lowerShield();
            await this.agent.bot.equip(bow, 'hand');
            if (operationId !== this.operationId) return;
            await this.agent.bot.look(shot.yaw, shot.pitch, true);
            if (operationId !== this.operationId) return;
            this.agent.bot.activateItem(false);
            await wait(chargeMs);
            if (operationId !== this.operationId) return;
            this.agent.bot.deactivateItem();
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] ranged attack failed:`, error.message);
        } finally {
            if (operationId === this.operationId) this.rangedInFlight = false;
        }
    }

    async tryMeleeAttack(target) {
        this.lowerShield();
        const weapon = await this.equipMeleeWeapon();
        const delay = this.getAttackDelay(weapon);
        if (Date.now() - this.lastAttackAt < delay) return false;

        const targetHeight = Number.isFinite(target.height) ? target.height : 1.0;
        const eyeTarget = target.position.offset(0, Math.max(0.4, targetHeight * 0.65), 0);
        try {
            await this.agent.bot.lookAt(eyeTarget, true);
            // Check range and sight again after the awaited look operation.
            // This avoids a normal client swing through a target that has moved
            // behind cover or beyond server-valid reach.
            if (!withinReach(this.agent.bot.entity.position, target.position, this.config.attack_range)) return false;
            if (!this.hasLineOfSight(target)) return false;
            this.agent.bot.attack(target);
            this.lastAttackAt = Date.now();
            return true;
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] melee attack failed:`, error.message);
            return false;
        }
    }

    async update() {
        if (!this.config.enabled || !this.agent.bot?.entity || this.rangedInFlight) return;
        const now = Date.now();
        if (now - this.lastScanAt < this.config.retarget_ms) return;
        this.lastScanAt = now;

        const target = this.selectTarget();
        if (!target) {
            if (this.target) this.stop();
            return;
        }
        if (this.target?.id !== target.id) {
            // Protection must not race a collection/build path. Request the
            // existing action manager to interrupt it, rather than forging any
            // packets or running a second long-lived task in parallel.
            this.agent.actions?.cancelResume();
            this.agent.requestInterrupt?.();
        }
        this.target = target;
        await this.ensureDefensiveEquipment();

        const targetDistance = distance(this.agent.bot.entity.position, target.position);
        const operation = chooseCombatOperation({
            hasTarget: true,
            health: this.agent.bot.health ?? 20,
            retreatHealth: this.config.retreat_health,
            targetDistance,
            attackRange: this.config.attack_range,
            hasBow: !!this.getBow(),
            ranged: this.config.ranged
        });
        if (operation === 'retreat') {
            await this.retreat(target);
            return;
        }
        if (operation === 'ranged') {
            const fired = this.tryRangedAttack(target, targetDistance);
            if (fired) return;
        }
        if (operation === 'follow' || operation === 'ranged') {
            await this.raiseShield(targetDistance);
            await this.followTarget(target);
            return;
        }

        try {
            this.agent.bot.pathfinder.stop();
        } catch (error) {
            console.warn(`[combat:${this.agent.name}] failed to stop close-range pathing:`, error.message);
        }
        await this.tryMeleeAttack(target);
    }
}
