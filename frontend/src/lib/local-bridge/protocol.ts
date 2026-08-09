import { isLocalBridgeAction, type LocalBridgeAction } from "./actions";

export const LOCAL_BRIDGE_PROTOCOL = "jiuzhang-local-bridge" as const;
export const LOCAL_BRIDGE_PROTOCOL_VERSION = 1 as const;

export interface LocalBridgeRequest<T = unknown> {
  protocol: typeof LOCAL_BRIDGE_PROTOCOL;
  version: typeof LOCAL_BRIDGE_PROTOCOL_VERSION;
  type: "request";
  traceId: string;
  action: LocalBridgeAction;
  timestamp: number;
  nonce: string;
  data: T;
}

interface LocalBridgeResponseBase {
  protocol: typeof LOCAL_BRIDGE_PROTOCOL;
  version: typeof LOCAL_BRIDGE_PROTOCOL_VERSION;
  type: "response";
  traceId: string;
  action: LocalBridgeAction;
  message: string;
  timestamp: number;
}

export interface LocalBridgeSuccessResponse<T = unknown>
  extends LocalBridgeResponseBase {
  ok: true;
  code: 200;
  data: T;
}

export interface LocalBridgeErrorResponse extends LocalBridgeResponseBase {
  ok: false;
  code: number;
  errorCode: string;
  data: null;
}

export type LocalBridgeResponse<T = unknown> =
  | LocalBridgeSuccessResponse<T>
  | LocalBridgeErrorResponse;

export interface BridgeStatus {
  online: boolean;
  status: string;
  service: string;
  version: string;
  protocolVersion: typeof LOCAL_BRIDGE_PROTOCOL_VERSION;
  actions: LocalBridgeAction[];
  checkedAt: string;
}

export function isLocalBridgeResponse(value: unknown): value is LocalBridgeResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  const hasValidEnvelope =
    response.protocol === LOCAL_BRIDGE_PROTOCOL &&
    response.version === LOCAL_BRIDGE_PROTOCOL_VERSION &&
    response.type === "response" &&
    typeof response.traceId === "string" &&
    isLocalBridgeAction(response.action) &&
    typeof response.message === "string" &&
    typeof response.timestamp === "number";

  if (!hasValidEnvelope) return false;
  if (response.ok === true) {
    return (
      response.code === 200 &&
      "data" in response &&
      !("errorCode" in response)
    );
  }
  if (response.ok === false) {
    return (
      typeof response.code === "number" &&
      typeof response.errorCode === "string" &&
      response.errorCode.length > 0 &&
      response.data === null
    );
  }
  return false;
}
