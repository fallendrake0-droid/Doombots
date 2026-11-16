import settings from '../agent/settings.js';

async function translateText(message, to) {
    try {
        // Translation is optional and English is the low-RAM default. Avoid
        // loading a network-facing translation client into every bot otherwise.
        const { default: translate } = await import('google-translate-api-x');
        const result = await translate(message, { to });
        return result.text || message;
    } catch (error) {
        console.error('Error translating message:', error);
        return message;
    }
}

export async function handleTranslation(message) {
    const preferredLang = String(settings.language);
    if (!preferredLang || preferredLang.toLowerCase() === 'en' || preferredLang.toLowerCase() === 'english') return message;
    return translateText(message, preferredLang);
}

export async function handleEnglishTranslation(message) {
    const preferredLang = String(settings.language);
    if (!preferredLang || preferredLang.toLowerCase() === 'en' || preferredLang.toLowerCase() === 'english') return message;
    return translateText(message, 'english');
}
