export const REQUIRED_OLLAMA_MODEL = 'qwen2.5:0.5b';
export const REQUIRED_OLLAMA_DIGEST_PREFIX = 'a8b0c5157701';

/**
 * DoomBots intentionally operates one verified local model. Keep this check in
 * the parent process as well as the startup script so dashboard-created agents
 * cannot silently load a larger or unrelated model.
 */
export function validateDoomBotsModel(profile = {}) {
    const model = profile?.model;
    if (model?.api !== 'ollama') {
        return { ok: false, error: `DoomBots requires the Ollama API for ${REQUIRED_OLLAMA_MODEL}.` };
    }
    if (model.model !== REQUIRED_OLLAMA_MODEL) {
        return { ok: false, error: `DoomBots requires model ${REQUIRED_OLLAMA_MODEL}; substitutions are disabled.` };
    }
    if (profile.model_digest !== REQUIRED_OLLAMA_DIGEST_PREFIX) {
        return { ok: false, error: `DoomBots requires model digest prefix ${REQUIRED_OLLAMA_DIGEST_PREFIX}.` };
    }
    return { ok: true };
}

export function validateDoomBotsSettings(settings = {}) {
    const modelResult = validateDoomBotsModel(settings.profile);
    if (!modelResult.ok) return modelResult;
    if (settings.allow_insecure_coding === true) {
        return { ok: false, error: 'DoomBots does not permit arbitrary model-generated JavaScript.' };
    }
    if (!Array.isArray(settings.blocked_actions) || !settings.blocked_actions.includes('!newAction')) {
        return { ok: false, error: 'DoomBots requires !newAction to remain blocked.' };
    }
    return { ok: true };
}

export function hasRequiredDigest(digest) {
    const normalized = String(digest || '').replace(/^sha256:/i, '');
    return normalized.startsWith(REQUIRED_OLLAMA_DIGEST_PREFIX);
}

/** Query the configured Ollama endpoint before a fleet starts. */
export async function verifyRequiredOllamaModel(options = {}) {
    const baseUrl = (options.baseUrl || process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const fetchImpl = options.fetchImpl || fetch;
    try {
        const response = await fetchImpl(`${baseUrl}/api/tags`);
        if (!response.ok) return { ok: false, error: `Ollama returned HTTP ${response.status}.` };
        const payload = await response.json();
        const model = payload.models?.find(entry => entry.name === REQUIRED_OLLAMA_MODEL || entry.model === REQUIRED_OLLAMA_MODEL);
        if (!model) return { ok: false, error: `${REQUIRED_OLLAMA_MODEL} is not installed.` };
        if (!hasRequiredDigest(model.digest)) {
            return { ok: false, error: `${REQUIRED_OLLAMA_MODEL} has digest ${model.digest || 'unknown'}, expected ${REQUIRED_OLLAMA_DIGEST_PREFIX}.` };
        }
        return { ok: true, model };
    } catch (error) {
        return { ok: false, error: `Could not reach Ollama at ${baseUrl}: ${error?.message || String(error)}` };
    }
}
