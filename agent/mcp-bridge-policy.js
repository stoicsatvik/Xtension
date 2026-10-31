// A successful sync writes lastSyncAt. Restarting on every config write
// would recursively spawn new sync and long-poll loops.
export function shouldRestartMcpLoop(oldConfig, newConfig) {
  return Boolean(oldConfig?.enabled) !== Boolean(newConfig?.enabled) ||
    (oldConfig?.token ?? null) !== (newConfig?.token ?? null);
}
