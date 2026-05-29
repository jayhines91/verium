import { describe, expect, it } from "vitest";
import {
  isNodeReady,
  nodeStateFromStatus,
  nodeStatusLabel,
  recoveryHintFromStatus,
  recoveryActionLabel,
} from "@/lib/node/status";
import type { NodeStatus } from "@/lib/rpc/client";

describe("node status mapping", () => {
  it("prefers user_message for labels", () => {
    const status = {
      connected: false,
      user_message: "Loading blockchain…",
    } as NodeStatus;
    expect(nodeStatusLabel(status)).toBe("Loading blockchain…");
  });

  it("maps connected sync to ready states", () => {
    expect(
      isNodeReady({ connected: true, state: "connected_syncing" } as NodeStatus),
    ).toBe(true);
    expect(
      isNodeReady({ connected: true, state: "connected_ready" } as NodeStatus),
    ).toBe(true);
    expect(isNodeReady({ connected: false } as NodeStatus)).toBe(false);
  });

  it("derives recovery hints", () => {
    expect(
      recoveryHintFromStatus({
        chain_corrupt: true,
        needs_bootstrap: true,
        connected: false,
      } as NodeStatus),
    ).toBe("bootstrap_chain");
    expect(recoveryActionLabel("restart_node")).toBe("Restart node");
  });

  it("maps backend state strings", () => {
    expect(
      nodeStateFromStatus({ state: "auth_mismatch", connected: false } as NodeStatus),
    ).toBe("auth_mismatch");
  });

  it("maps recovery hints for banner actions", () => {
    expect(recoveryActionLabel("repair_chain")).toBe("Repair blockchain");
    expect(
      recoveryHintFromStatus({
        recovery_hint: "restart_node",
        connected: false,
      } as NodeStatus),
    ).toBe("restart_node");
    expect(
      recoveryHintFromStatus({
        chain_corrupt: true,
        needs_bootstrap: true,
        connected: false,
      } as NodeStatus),
    ).toBe("bootstrap_chain");
  });
});
