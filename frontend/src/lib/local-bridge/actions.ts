export const LOCAL_BRIDGE_ACTIONS = {
  CHECK_STATUS: "JZ_BRIDGE_CHECK_STATUS",
  LIST_CAPABILITIES: "JZ_BRIDGE_LIST_CAPABILITIES",
  LIST_ACCOUNTS: "JZ_BRIDGE_LIST_ACCOUNTS",
} as const;

export type LocalBridgeAction =
  (typeof LOCAL_BRIDGE_ACTIONS)[keyof typeof LOCAL_BRIDGE_ACTIONS];

const LOCAL_BRIDGE_ACTION_VALUES = new Set<string>(
  Object.values(LOCAL_BRIDGE_ACTIONS),
);

export function isLocalBridgeAction(value: unknown): value is LocalBridgeAction {
  return typeof value === "string" && LOCAL_BRIDGE_ACTION_VALUES.has(value);
}
