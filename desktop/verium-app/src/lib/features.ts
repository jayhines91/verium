const env = (import.meta as unknown as { env: Record<string, string> }).env;

const APP_VERSION = env?.VITE_APP_VERSION ?? "1.0.0";

/**
 * DACE binarytest network (play-money testnet). Disabled in alpha releases;
 * set VITE_BINARYTEST_ENABLED=true in .env.local to override during dev.
 */
export const BINARYTEST_ENABLED =
  env?.VITE_BINARYTEST_ENABLED === "true" ||
  (env?.VITE_BINARYTEST_ENABLED !== "false" && !/alpha/i.test(APP_VERSION));

/**
 * Daemon/RPC/explorer overrides on Settings. Hidden in alpha releases;
 * set VITE_ADVANCED_SETTINGS_ENABLED=true in .env.local to override during dev.
 */
export const ADVANCED_SETTINGS_ENABLED =
  env?.VITE_ADVANCED_SETTINGS_ENABLED === "true" ||
  (env?.VITE_ADVANCED_SETTINGS_ENABLED !== "false" &&
    !/alpha/i.test(APP_VERSION));
