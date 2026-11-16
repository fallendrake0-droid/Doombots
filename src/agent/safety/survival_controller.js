import Vec3 from 'vec3';
import { normalizedPotionName, POTION_EFFECTS, SAFE_SELF_POTION_EFFECTS } from './potions.js';
import { canAttemptClutch, isSolidLandingBlock, shouldHandleSurvivalState } from './survival_policy.js';

const DEFAULTS = {
    enabled: true,
    update_ms: 150,
    health_potion_threshold: 9,
    emergency_health_threshold: 5,
    drowning_air_threshold: 4,
    lava_potion_first: true,
    clutch: {
        enabled: true,
        min_fall_blocks: 4,
        max_scan_blocks: 48,
        cooldown_ms: 1200,
        strategies: ['water_bucket', 'cobweb', 'slime_block', 'hay_bale']
    }
};

function mergeConfig(config = {}) {
    return { ...DEFAULTS, ...config, clutch: { ...DEFAULTS.clutch, ...(config.clutch || {}) } };
}

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isFinitePosition(position) {
    return position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

/**
 * Deterministic survival and inventory reaction layer. It is deliberately
 * separate from the language model so lava, falling, and low-health events do
 * not wait for inference. Every action uses ordinary Mineflayer APIs.
 */
export class SurvivalController {
    constructor(agent, config = {}) {
        this.agent = agent;
        this.config = mergeConfig(config);
        this.lastUpdateAt = 0;
        this.lastPotionAt = 0;
        this.lastClutchAt = 0;
        this.inFlight = false;
        this.lastEvent = null;
    }

    updateConfig(config = {}) {
        this.config = mergeConfig(config);
    }

    getStatus() {
        return {
            lastEvent: this.lastEvent,
            busy: this.inFlight,
            enabled: this.config.enabled
        };
    }

    interruptCurrentAction() {
        this.agent.actions?.cancelResume();
        this.agent.requestInterrupt?.();
        // Safety has priority over a bow draw or target pursuit. stop() also
        // invalidates any asynchronous ranged operation before it can fire.
        this.agent.combat?.stop();
    }

    findPotion(effectNames) {
        const desired = Array.isArray(effectNames) ? effectNames : [effectNames];
        return this.agent.bot.inventory.items().find(item => desired.includes(normalizedPotionName(item))) || null;
    }

    async usePotion(effectNames, reason = 'manual') {
        const requested = Array.isArray(effectNames) ? effectNames : [effectNames];
        if (requested.some(effect => !SAFE_SELF_POTION_EFFECTS.has(effect))) return false;
        const potion = this.findPotion(requested);
        if (!potion) return false;
        const now = Date.now();
        if (now - this.lastPotionAt < 750) return false;
        this.interruptCurrentAction();
        this.lastPotionAt = now;
        this.lastEvent = `potion:${normalizedPotionName(potion)}:${reason}`;

        try {
            await this.agent.bot.equip(potion, 'hand');
            if (potion.name === 'potion') {
                await this.agent.bot.consume();
            } else {
                // Throw self-use splash/lingering potions at the bot's feet with
                // the ordinary server-authoritative interaction.
                await this.agent.bot.lookAt(this.agent.bot.entity.position.offset(0, 0.1, 0), true);
                this.agent.bot.activateItem(false);
                await sleep(125);
                this.agent.bot.deactivateItem();
            }
            return true;
        } catch (error) {
            console.warn(`[safety:${this.agent.name}] failed to use ${potion.name}:`, error.message);
            return false;
        }
    }

    async useEmergencyFood() {
        const apple = this.agent.bot.inventory.items().find(item => item.name === 'enchanted_golden_apple' || item.name === 'golden_apple');
        if (!apple) return false;
        this.interruptCurrentAction();
        try {
            await this.agent.bot.equip(apple, 'hand');
            await this.agent.bot.consume();
            this.lastEvent = 'food:golden_apple';
            return true;
        } catch (error) {
            console.warn(`[safety:${this.agent.name}] failed to eat emergency food:`, error.message);
            return false;
        }
    }

    isIn(blockNames) {
        const bot = this.agent.bot;
        const feet = bot.blockAt(bot.entity.position);
        const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
        const matches = block => {
            if (!block) return false;
            if (blockNames.includes(block.name)) return true;
            // Modern waterlogged blocks retain their own block name; use the
            // documented block properties when Mineflayer exposes them.
            return blockNames.includes('water') && block.getProperties?.().waterlogged === true;
        };
        return matches(feet) || matches(head);
    }

    findLandingBlock() {
        const position = this.agent.bot.entity.position;
        const startY = Math.floor(position.y - 1);
        for (let drop = 0; drop <= this.config.clutch.max_scan_blocks; drop++) {
            const block = this.agent.bot.blockAt(new Vec3(Math.floor(position.x), startY - drop, Math.floor(position.z)));
            if (isSolidLandingBlock(block)) {
                return { block, drop: position.y - (block.position.y + 1) };
            }
            if (block?.name === 'lava') return null;
        }
        return null;
    }

    async placeClutchBlock(itemName, landing) {
        const item = this.agent.bot.inventory.findInventoryItem(itemName);
        if (!item) return false;
        const target = this.agent.bot.blockAt(landing.block.position.offset(0, 1, 0));
        if (!target || !['air', 'cave_air', 'void_air'].includes(target.name)) return false;
        try {
            await this.agent.bot.equip(item, 'hand');
            await this.agent.bot.placeBlock(landing.block, new Vec3(0, 1, 0));
            this.lastEvent = `clutch:${itemName}`;
            return true;
        } catch (error) {
            console.warn(`[safety:${this.agent.name}] ${itemName} clutch failed:`, error.message);
            return false;
        }
    }

    async waterClutch(landing) {
        if (this.agent.bot.game?.dimension?.includes('nether')) return false;
        const bucket = this.agent.bot.inventory.findInventoryItem('water_bucket');
        if (!bucket) return false;
        try {
            await this.agent.bot.equip(bucket, 'hand');
            // Place against the known solid landing block rather than using an
            // untargeted use-item packet; servers validate this normally.
            await this.agent.bot.placeBlock(landing.block, new Vec3(0, 1, 0));
            this.lastEvent = 'clutch:water_bucket';
            return true;
        } catch (error) {
            console.warn(`[safety:${this.agent.name}] water clutch failed:`, error.message);
            return false;
        }
    }

    async tryClutch() {
        const { clutch } = this.config;
        const bot = this.agent.bot;
        if (!clutch.enabled || !isFinitePosition(bot.entity.position)) return false;
        const landing = this.findLandingBlock();
        if (!landing) return false;
        const landingDistance = bot.entity.position.distanceTo(landing.block.position.offset(0.5, 1, 0.5));
        if (!canAttemptClutch({
            onGround: bot.entity.onGround,
            verticalVelocity: bot.entity.velocity?.y,
            cooldownElapsed: Date.now() - this.lastClutchAt >= clutch.cooldown_ms,
            landingDrop: landing.drop,
            minFallBlocks: clutch.min_fall_blocks,
            landingDistance
        })) return false;

        this.interruptCurrentAction();
        this.lastClutchAt = Date.now();
        for (const strategy of clutch.strategies) {
            if (strategy === 'water_bucket' && await this.waterClutch(landing)) return true;
            if (['cobweb', 'slime_block', 'hay_bale'].includes(strategy) && await this.placeClutchBlock(strategy, landing)) return true;
        }
        return false;
    }

    async placeWaterAtFeet() {
        const bot = this.agent.bot;
        const bucket = bot.inventory.findInventoryItem('water_bucket');
        if (!bucket || bot.game?.dimension?.includes('nether')) return false;
        const feet = bot.blockAt(bot.entity.position);
        const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
        const reference = isSolidLandingBlock(feet) ? feet : below;
        if (!isSolidLandingBlock(reference)) return false;
        this.interruptCurrentAction();
        try {
            await bot.equip(bucket, 'hand');
            await bot.placeBlock(reference, new Vec3(0, 1, 0));
            this.lastEvent = 'escape:water_bucket';
            return true;
        } catch (error) {
            console.warn(`[safety:${this.agent.name}] water escape failed:`, error.message);
            return false;
        }
    }

    async handleLavaOrFire() {
        this.lastEvent = 'danger:lava_or_fire';
        if (this.config.lava_potion_first && await this.usePotion('fire_resistance', 'lava')) return true;
        return this.placeWaterAtFeet();
    }

    async handleDrowning() {
        this.lastEvent = 'danger:drowning';
        if (await this.usePotion('water_breathing', 'drowning')) return true;
        // This is intentionally simple and server-valid: stop a nonessential
        // path and swim upward. A dedicated water route can replace it later
        // without letting an LLM delay an immediate air recovery.
        this.interruptCurrentAction();
        try {
            this.agent.bot.pathfinder.stop();
            this.agent.bot.setControlState('jump', true);
            this.lastEvent = 'escape:surface';
            return true;
        } catch (error) {
            console.warn(`[safety:${this.agent.name}] drowning escape failed:`, error.message);
            return false;
        }
    }

    async update() {
        if (!this.config.enabled || this.inFlight || !this.agent.bot?.entity) return;
        const now = Date.now();
        if (now - this.lastUpdateAt < this.config.update_ms) return;
        this.lastUpdateAt = now;

        const bot = this.agent.bot;
        const inLavaOrFire = this.isIn(['lava', 'fire', 'soul_fire', 'magma_block']) || bot.entity.isInLava === true;
        const submerged = this.isIn(['water', 'bubble_column']);
        const oxygen = bot.oxygenLevel;
        const drowning = submerged && Number.isFinite(oxygen) && oxygen <= this.config.drowning_air_threshold;
        if (!submerged && this.lastEvent === 'escape:surface') {
            try {
                bot.setControlState('jump', false);
                this.lastEvent = 'recovered:surface';
            } catch (error) {
                console.warn(`[safety:${this.agent.name}] failed to clear swim control:`, error.message);
            }
        }
        const criticalHealth = (bot.health ?? 20) <= this.config.emergency_health_threshold;
        const lowHealth = (bot.health ?? 20) <= this.config.health_potion_threshold;
        const falling = !bot.entity.onGround && bot.entity.velocity?.y < -0.28;
        if (!shouldHandleSurvivalState({
            inLavaOrFire,
            health: bot.health ?? 20,
            emergencyHealthThreshold: this.config.emergency_health_threshold,
            healthPotionThreshold: this.config.health_potion_threshold,
            falling,
            drowning
        })) return;

        this.inFlight = true;
        try {
            // Clutch is most timing-sensitive and therefore runs before an
            // inventory heal during a fall.
            if (falling && await this.tryClutch()) return;
            if (drowning && await this.handleDrowning()) return;
            if (inLavaOrFire && await this.handleLavaOrFire()) return;
            if (criticalHealth && await this.usePotion(['healing', 'regeneration'], 'critical_health')) return;
            if (criticalHealth) await this.useEmergencyFood();
            else if (lowHealth) await this.usePotion(['healing', 'regeneration'], 'low_health');
        } finally {
            this.inFlight = false;
        }
    }
}

export { normalizedPotionName, POTION_EFFECTS };
