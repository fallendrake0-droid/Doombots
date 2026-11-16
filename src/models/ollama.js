import { strictFormat } from '../utils/text.js';
import { serverProxy } from '../agent/mindserver_proxy.js';
import { REQUIRED_OLLAMA_MODEL } from '../mindcraft/model_policy.js';

export class Ollama {
    static prefix = 'ollama';
    constructor(model_name, url, params) {
        this.model_name = model_name || REQUIRED_OLLAMA_MODEL;
        this.params = params;
        // OLLAMA_URL makes native Linux and Docker deployments configurable without
        // editing five bot profiles. A profile-specific URL still takes precedence.
        this.url = url || process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
        this.chat_endpoint = '/api/chat';
        this.embedding_endpoint = '/api/embeddings';
    }

    async sendRequest(turns, systemMessage, contextTrimAttempts = 0) {
        const model = this.model_name;
        if (model !== REQUIRED_OLLAMA_MODEL) {
            throw new Error(`DoomBots only permits the verified model ${REQUIRED_OLLAMA_MODEL}.`);
        }
        const messages = strictFormat(turns);
        messages.unshift({ role: 'system', content: systemMessage });
        const maxAttempts = 3;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            console.log(`Awaiting local response... (model: ${model}, attempt: ${attempt})`);
            try {
                const { timeout_ms, priority, ...ollamaParams } = this.params || {};
                const apiResponse = await this.send(this.chat_endpoint, {
                    model,
                    messages,
                    stream: false,
                    ...ollamaParams
                });
                let response = apiResponse?.message?.content;
                if (typeof response !== 'string' || response.trim().length === 0) {
                    throw new Error('Ollama returned no message content.');
                }

                const hasOpenTag = response.includes('<think>');
                const hasCloseTag = response.includes('</think>');
                if (hasOpenTag && !hasCloseTag) {
                    throw new Error('Ollama returned an incomplete thinking block.');
                }
                if (hasCloseTag && !hasOpenTag) response = '<think>' + response;
                if (hasOpenTag || hasCloseTag) response = response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                if (response.length === 0) throw new Error('Ollama response only contained hidden reasoning.');
                return response;
            } catch (error) {
                lastError = error;
                const message = error?.message || String(error);
                if (/context length/i.test(message) && turns.length > 1 && contextTrimAttempts < 2) {
                    // Preserve the most recent context but bound recovery work;
                    // an unavailable/oversized prompt must not create an
                    // unbounded sequence of extra requests on a 5 GB host.
                    const removeCount = Math.max(1, Math.ceil(turns.length / 3));
                    console.warn('Ollama context exceeded; retrying with a compacted history.');
                    return this.sendRequest(turns.slice(removeCount), systemMessage, contextTrimAttempts + 1);
                }
                console.warn(`Ollama request failed (${attempt}/${maxAttempts}): ${message}`);
                if (attempt < maxAttempts) await new Promise(resolve => setTimeout(resolve, 250 * attempt));
            }
        }

        throw new Error(`Ollama unavailable after ${maxAttempts} attempts: ${lastError?.message || 'unknown error'}`);
    }

    async embed(text) {
        // Profiles disable embeddings to keep RAM low. If a legacy caller
        // reaches this path, it must still never substitute another model.
        const response = await this.send(this.embedding_endpoint, { model: REQUIRED_OLLAMA_MODEL, input: text });
        if (!Array.isArray(response?.embedding)) throw new Error('Ollama returned an invalid embedding response.');
        return response.embedding;
    }

    async send(endpoint, body) {
        if (body?.model !== REQUIRED_OLLAMA_MODEL) {
            throw new Error(`DoomBots only permits the verified model ${REQUIRED_OLLAMA_MODEL}.`);
        }
        const timeoutMs = Number(this.params?.timeout_ms || process.env.DOOMBOTS_OLLAMA_TIMEOUT_MS || 45000);
        // Agent workers use the parent gateway when available. It serialises all
        // five bots through one Ollama service and enforces queue/backlog limits.
        if (serverProxy.connected && process.env.DOOMBOTS_OLLAMA_GATEWAY !== 'false') {
            return serverProxy.requestOllama({
                agentName: serverProxy.name || 'unknown-agent',
                endpoint,
                body,
                timeoutMs,
                priority: this.params?.priority || body?.priority || 0
            });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const url = new URL(endpoint, this.url);
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`Ollama status ${response.status}.`);
            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') throw new Error(`Ollama request timed out after ${timeoutMs}ms.`);
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = [...messages];
        imageMessages.push({
            role: "user",
            content: [
                { type: "text", text: systemMessage },
                {
                    type: "image_url",
                    image_url: {
                        url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                    }
                }
            ]
        });
        
        return this.sendRequest(imageMessages, systemMessage);
    }
}
