export const POTION_EFFECTS = new Set([
    'fire_resistance', 'healing', 'regeneration', 'strength', 'swiftness',
    'water_breathing', 'slow_falling', 'resistance', 'night_vision',
    'invisibility', 'leaping', 'turtle_master', 'poison', 'weakness',
    'harming', 'luck'
]);

// Do not consume effects that damage or weaken the bot merely because a model
// named them. Harmful potions remain detectable but are not self-used.
export const SAFE_SELF_POTION_EFFECTS = new Set([...POTION_EFFECTS].filter(effect =>
    !['poison', 'weakness', 'harming'].includes(effect)
));

/**
 * Minecraft potion metadata differs between versions (legacy NBT versus data
 * components). Collect string leaves recursively and match only known effects.
 */
export function normalizedPotionName(item) {
    if (!item) return null;
    const values = [];
    const seen = new Set();
    const visit = (value, key = '', depth = 0) => {
        if (value == null || depth > 10 || seen.has(value)) return;
        if (typeof value === 'string') {
            if (/potion|effect/i.test(key) || depth > 0) values.push(value);
            return;
        }
        if (typeof value !== 'object') return;
        seen.add(value);
        const entries = value instanceof Map ? value.entries() : Object.entries(value);
        for (const [nestedKey, nested] of entries) {
            visit(nested, nestedKey, depth + 1);
        }
    };
    visit(item.nbt);
    visit(item.components);
    values.push(item.displayName || '', item.name || '');
    const text = values.join(' ').toLowerCase().replace(/minecraft:/g, '').replace(/ /g, '_');
    for (const effect of POTION_EFFECTS) {
        if (text.includes(effect)) return effect;
    }
    return null;
}
