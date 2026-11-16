import { verifyRequiredOllamaModel } from '../src/mindcraft/model_policy.js';

const result = await verifyRequiredOllamaModel();
if (!result.ok) {
    console.error(`Ollama model verification failed: ${result.error}`);
    process.exitCode = 1;
} else {
    console.log(`Verified ${result.model.name || result.model.model} digest ${result.model.digest}.`);
}
