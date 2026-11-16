export function nextReconnectDelay(baseDelayMs, maxDelayMs, attempt) {
    const safeBase = Math.max(100, Number(baseDelayMs) || 1000);
    const safeMax = Math.max(safeBase, Number(maxDelayMs) || 30000);
    const safeAttempt = Math.max(1, Number(attempt) || 1);
    return Math.min(safeMax, safeBase * (2 ** (safeAttempt - 1)));
}

export function shouldReconnect({ intentionalStop, enabled, code, attempt, maxAttempts }) {
    if (intentionalStop || enabled === false) return false;
    // Task validation failure: waiting/restarting cannot manufacture the missing
    // collaborators that caused this exit.
    if (code === 4) return false;
    return attempt <= maxAttempts;
}
