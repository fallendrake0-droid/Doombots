import Groq from 'groq-sdk';
import { getKey, recordKeyFailure, getKeyCount } from '../utils/keys.js';

// THIS API IS NOT TO BE CONFUSED WITH GROK!
// Go to grok.js for that. :)

const DECOMMISSIONED_GROQ_MODELS = {
    'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
    'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
    'llama-3.1-70b-versatile': 'openai/gpt-oss-120b',
    'llama-3.2-1b-preview': 'openai/gpt-oss-20b',
    'llama-3.2-3b-preview': 'openai/gpt-oss-20b',
    'llama3-8b-8192': 'openai/gpt-oss-20b',
    'llama3-70b-8192': 'openai/gpt-oss-120b',
    'mixtral-8x7b-32768': 'openai/gpt-oss-120b',
    'gemma-7b-it': 'openai/gpt-oss-20b',
    'gemma2-9b-it': 'openai/gpt-oss-20b'
};

export function normalizeGroqModel(name) {
    if (!name) return 'openai/gpt-oss-120b';
    const clean = name.replace(/^groq\//, '');
    if (DECOMMISSIONED_GROQ_MODELS[clean]) {
        return DECOMMISSIONED_GROQ_MODELS[clean];
    }
    return clean;
}

// Umbrella class for everything under the sun... That GroqCloud provides, that is.
export class GroqCloudAPI {
    static prefix = 'groq';

    constructor(model_name, url, params) {
        const normalized = normalizeGroqModel(model_name);
        if (model_name && normalized !== model_name.replace(/^groq\//, '')) {
            console.warn(`[Groq] Notice: '${model_name}' was decommissioned by Groq. Upgraded to active model '${normalized}'.`);
        }
        this.model_name = normalized;
        this.url = url;
        this.params = params || {};

        if (this.params.tools)
            delete this.params.tools;

        this._initClient();
    }

    _initClient() {
        this.currentKey = getKey('GROQCLOUD_API_KEY');
        const opts = { apiKey: this.currentKey };
        if (this.url) opts.baseURL = this.url;
        this.groq = new Groq(opts);
    }

    async sendRequest(turns, systemMessage, stop_seq = null) {
        let messages = [{ role: 'system', content: systemMessage }].concat(turns);

        // Handle deprecated max_tokens parameter
        if (this.params.max_tokens) {
            this.params.max_completion_tokens = this.params.max_tokens;
            delete this.params.max_tokens;
        }

        if (!this.params.max_completion_tokens) {
            this.params.max_completion_tokens = 512;
        }

        const model = normalizeGroqModel(this.model_name || 'openai/gpt-oss-120b');
        this.model_name = model;
        const pack = {
            messages,
            model,
            stream: false,
            stop: stop_seq,
            ...(this.params || {})
        };

        const maxRetries = getKeyCount('GROQCLOUD_API_KEY') > 1 ? 2 : 1;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                console.log(`Awaiting Groq response (${pack.model})...`);
                let completion = await this.groq.chat.completions.create(pack);
                let res = completion.choices[0]?.message?.content || '';
                res = res.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                return res;
            } catch (err) {
                const isRateLimit = err?.status === 429 || err?.message?.includes('rate limit') || err?.message?.includes('429');
                if (isRateLimit && attempt < maxRetries - 1) {
                    console.warn('[Groq] Rate limit encountered, rotating key...');
                    recordKeyFailure('GROQCLOUD_API_KEY', this.currentKey);
                    this._initClient();
                    continue;
                }
                const isNotFound = err?.status === 404 || err?.message?.includes('model_not_found') || err?.message?.includes('does not exist') || err?.message?.includes('decommissioned');
                if (isNotFound) {
                    let nextModel = null;
                    try {
                        const modelList = await this.groq.models.list();
                        const candidate = modelList?.data?.find(m => 
                            (m.id.includes('gpt-oss') || m.id.includes('qwen') || m.id.includes('llama')) && m.id !== pack.model
                        );
                        if (candidate) nextModel = candidate.id;
                    } catch {}
                    if (!nextModel) {
                        const fallbacks = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
                        nextModel = fallbacks.find(m => m !== pack.model);
                    }
                    if (nextModel && nextModel !== pack.model) {
                        console.warn(`[Groq] Model ${pack.model} not available, switching to active model ${nextModel}...`);
                        this.model_name = nextModel;
                        pack.model = nextModel;
                        attempt--;
                        continue;
                    }
                }
                if (err.message && err.message.includes('content must be a string')) {
                    return 'Vision is only supported by certain models.';
                }
                console.error('[Groq] Error:', err?.message || err);
                return 'My brain disconnected, try again.';
            }
        }
        return 'My brain disconnected, try again.';
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = messages.filter(message => message.role !== 'system');
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
        
        return this.sendRequest(imageMessages);
    }

    async embed(_) {
        throw new Error('Embeddings are not supported by Groq.');
    }
}
