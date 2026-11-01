// A successful sync writes lastSyncAt. Restarting on every config write
// would recursively spawn new sync and long-poll loops.
export function shouldRestartMcpLoop(oldConfig, newConfig) {
  return Boolean(oldConfig?.enabled) !== Boolean(newConfig?.enabled) ||
    (oldConfig?.token ?? null) !== (newConfig?.token ?? null);
}

// Chrome extension IDs use 32 lowercase letters in the a-p alphabet.
// Reject malformed write targets before any local browser side effect.
export function isValidChromeExtensionId(value) {
  return typeof value === "string" && /^[a-p]{32}$/.test(value);
}

export function assertChromeExtensionId(value) {
  if (!isValidChromeExtensionId(value)) {
    throw new Error("Invalid Chrome extension ID.");
  }
  return value;
}
