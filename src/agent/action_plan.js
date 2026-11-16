/**
 * Parse the optional structured format accepted from local models. The result is
 * converted back into the existing command parser, so parameter/domain checks
 * remain the one source of truth before any game action runs.
 */
export function parseActionPlan(response, commandExists = null) {
    if (typeof response !== 'string') return { recognized: false };
    const trimmed = response.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return { recognized: false };

    let plan;
    try {
        plan = JSON.parse(trimmed);
    } catch {
        return { recognized: true, valid: false, error: 'Malformed JSON action plan.' };
    }
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        return { recognized: true, valid: false, error: 'Action plan must be an object.' };
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(plan.action || '')) {
        return { recognized: true, valid: false, error: 'Action plan requires a safe action name.' };
    }
    if (typeof commandExists === 'function' && !commandExists(`!${plan.action}`)) {
        return { recognized: true, valid: false, error: `Action plan requested an unavailable command: ${plan.action}.` };
    }
    if (!Array.isArray(plan.args) || plan.args.length > 6) {
        return { recognized: true, valid: false, error: 'Action plan requires an args array with at most six values.' };
    }
    if (plan.args.some(value => !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)))) {
        return { recognized: true, valid: false, error: 'Action plan arguments must be finite strings, numbers, or booleans.' };
    }
    // The legacy command parser uses quoted strings without escape support.
    // Refuse strings that cannot be represented as exactly one parser argument
    // rather than letting them change or truncate the planned command.
    if (plan.args.some(value => typeof value === 'string' && (
        value.length > 128 || value.includes('"') || value.includes('\\') || [...value].some(character => character.codePointAt(0) < 32)
    ))) {
        return { recognized: true, valid: false, error: 'Action plan string arguments contain unsupported characters.' };
    }
    if (plan.message != null && (typeof plan.message !== 'string' || plan.message.length > 240 || /!\w/.test(plan.message))) {
        return { recognized: true, valid: false, error: 'Action plan message must be short and cannot contain a command.' };
    }

    const commandArgs = plan.args.map(value => typeof value === 'string' ? JSON.stringify(value) : String(value)).join(', ');
    return {
        recognized: true,
        valid: true,
        message: plan.message?.trim() || '',
        command: `!${plan.action}(${commandArgs})`
    };
}
