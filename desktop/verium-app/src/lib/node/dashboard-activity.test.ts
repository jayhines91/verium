import { describe, expect, it } from "vitest";
import {
  deriveDashboardActivity,
  showDashboardActivityBanner,
  txindexBuildProgress,
} from "@/lib/node/dashboard-activity";

describe("deriveDashboardActivity", () => {
  it("shows starting when status is loading", () => {
    const a = deriveDashboardActivity({
      coin: "vericoin",
      statusLoading: true,
    });
    expect(a.kind).toBe("starting");
    expect(a.showSpinner).toBe(true);
    expect(showDashboardActivityBanner(a)).toBe(true);
  });

  it("shows loading_chain when connected but no blockchain yet", () => {
    const a = deriveDashboardActivity({
      coin: "verium",
      status: { connected: true, blocks: 0, headers: 0 },
      blockchainLoading: true,
    });
    expect(a.kind).toBe("loading_chain");
    expect(a.title).toMatch(/Preparing/i);
  });

  it("shows syncing during initial block download", () => {
    const a = deriveDashboardActivity({
      coin: "verium",
      status: { connected: true, initial_block_download: true },
      blockchain: {
        chain: "main",
        blocks: 100,
        headers: 500_000,
        bestblockhash: "abc",
        difficulty: 1,
        mediantime: 0,
        verificationprogress: 0.42,
        initialblockdownload: true,
        size_on_disk: 0,
        pruned: false,
        warnings: "",
      },
    });
    expect(a.kind).toBe("syncing");
    expect(a.progress).toBe(0.42);
  });

  it("uses txindex height for progress when P2P paused for txindex", () => {
    const tip = 6_974_778;
    const idx = 4_832_357;
    const a = deriveDashboardActivity({
      coin: "vericoin",
      status: {
        connected: true,
        blocks: tip,
        txindex_network_paused: true,
        txindex_sync_height: idx,
        verification_progress: 0.9999,
      },
      blockchain: {
        chain: "main",
        blocks: tip,
        headers: tip,
        bestblockhash: "abc",
        difficulty: 1,
        mediantime: 0,
        verificationprogress: 0.9999,
        initialblockdownload: false,
        size_on_disk: 0,
        pruned: false,
        warnings: "",
      },
    });
    expect(a.kind).toBe("syncing");
    expect(a.title).toMatch(/transaction index/i);
    expect(a.progress).toBeCloseTo(idx / tip, 5);
    expect(a.progress).toBeLessThan(1);
    expect(Math.round((a.progress ?? 0) * 100)).toBe(69);
  });

  it("txindexBuildProgress ignores near-complete chain verification", () => {
    expect(txindexBuildProgress(4_832_357, 6_974_778)).toBeCloseTo(
      4_832_357 / 6_974_778,
      5,
    );
    expect(txindexBuildProgress(6_974_778, 6_974_778)).toBeUndefined();
  });

  it("hides banner when ready", () => {
    const a = deriveDashboardActivity({
      coin: "vericoin",
      status: { connected: true, blocks: 6_900_000, headers: 6_900_000 },
      blockchain: {
        chain: "main",
        blocks: 6_900_000,
        headers: 6_900_000,
        bestblockhash: "abc",
        difficulty: 1,
        mediantime: 0,
        verificationprogress: 0.999,
        initialblockdownload: false,
        size_on_disk: 0,
        pruned: false,
        warnings: "",
      },
      networkTip: 6_900_001,
    });
    expect(a.kind).toBe("ready");
    expect(showDashboardActivityBanner(a)).toBe(false);
  });
});
