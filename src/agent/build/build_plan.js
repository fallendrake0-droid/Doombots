const MAX_BLOCKS = 192;

function blockKey(position) {
    return `${position.x}:${position.y}:${position.z}`;
}

function add(plan, seen, x, y, z) {
    const position = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
    const key = blockKey(position);
    if (!seen.has(key)) {
        seen.add(key);
        plan.push(position);
    }
}

/** Create a deliberately small plan which can be built from real inventory. */
export function createBuildPlan(structure, origin, size) {
    const plan = [];
    const seen = new Set();
    const x0 = Math.floor(origin.x);
    const y0 = Math.floor(origin.y);
    const z0 = Math.floor(origin.z);
    const numericSize = Number.isFinite(Number(size)) ? Number(size) : 5;
    const width = Math.max(3, Math.min(9, Math.floor(numericSize)));
    const kind = String(structure || '').toLowerCase();

    if (kind === 'platform') {
        for (let x = 0; x < width; x++) for (let z = 0; z < width; z++) add(plan, seen, x0 + x, y0, z0 + z);
    } else if (kind === 'tower') {
        for (let y = 0; y < width; y++) add(plan, seen, x0, y0 + y, z0);
    } else if (kind === 'shelter') {
        const height = Math.max(3, Math.ceil(width / 2));
        for (let x = 0; x < width; x++) {
            for (let z = 0; z < width; z++) {
                add(plan, seen, x0 + x, y0, z0 + z);
                add(plan, seen, x0 + x, y0 + height, z0 + z);
            }
        }
        for (let y = 1; y < height; y++) {
            for (let x = 0; x < width; x++) {
                add(plan, seen, x0 + x, y0 + y, z0);
                add(plan, seen, x0 + x, y0 + y, z0 + width - 1);
            }
            for (let z = 1; z < width - 1; z++) {
                add(plan, seen, x0, y0 + y, z0 + z);
                add(plan, seen, x0 + width - 1, y0 + y, z0 + z);
            }
        }
        // Leave a two-block doorway in the centre of the front wall.
        const doorX = x0 + Math.floor(width / 2);
        for (const y of [y0 + 1, y0 + 2]) {
            const key = blockKey({ x: doorX, y, z: z0 });
            const index = plan.findIndex(position => blockKey(position) === key);
            if (index !== -1) plan.splice(index, 1);
        }
    } else {
        throw new Error(`Unsupported structure '${structure}'.`);
    }

    if (plan.length > MAX_BLOCKS) throw new Error(`Build plan exceeds ${MAX_BLOCKS} blocks.`);
    return plan;
}

export { MAX_BLOCKS };
