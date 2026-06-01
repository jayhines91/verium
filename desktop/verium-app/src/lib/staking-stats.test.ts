import { describe, expect, it } from "vitest";
import {
  buildPostReadinessSummary,
  computeCoinAgeMaturity,
  estimateExpectedStakeReward,
  findYoungestStakeReceive,
  formatEstimatedDuration,
  rpcStakeTimeHoursToSeconds,
  VRC_STAKE_MIN_AGE_SECONDS,
} from "@/lib/staking-stats";

describe("rpcStakeTimeHoursToSeconds", () => {
  it("converts node hours to seconds", () => {
    expect(rpcStakeTimeHoursToSeconds(3862)).toBe(3862 * 3600);
  });
});

describe("formatEstimatedDuration", () => {
  it("formats sub-hour", () => {
    expect(formatEstimatedDuration(45)).toBe("~45s");
  });

  it("formats multi-day", () => {
    expect(formatEstimatedDuration(3862 * 3600)).toMatch(/mo|w|d/);
  });
});

describe("estimateExpectedStakeReward", () => {
  it("uses node hours when staking active", () => {
    const est = estimateExpectedStakeReward({
      stakeTimeHours: 2,
      stakingActive: true,
    });
    expect(est?.seconds).toBe(7200);
    expect(est?.source).toBe("node");
  });
});

describe("computeCoinAgeMaturity", () => {
  it("gates before min age", () => {
    const now = 1_000_000;
    const status = computeCoinAgeMaturity(
      now - VRC_STAKE_MIN_AGE_SECONDS + 60,
      now,
    );
    expect(status.eligible).toBe(false);
    expect(status.secondsUntilMinAge).toBe(60);
  });

  it("accumulates time weight after min age", () => {
    const now = 2_000_000;
    const status = computeCoinAgeMaturity(
      now - VRC_STAKE_MIN_AGE_SECONDS - 3600,
      now,
    );
    expect(status.eligible).toBe(true);
    expect(status.timeWeightSeconds).toBe(3600);
  });
});

describe("findYoungestStakeReceive", () => {
  it("picks newest receive", () => {
    const youngest = findYoungestStakeReceive([
      {
        category: "receive",
        amount: 50,
        confirmations: 100,
        txid: "a",
        time: 100,
        timereceived: 100,
        blocktime: 500,
      },
      {
        category: "receive",
        amount: 100,
        confirmations: 10,
        txid: "b",
        time: 200,
        timereceived: 200,
        blocktime: 900,
      },
    ]);
    expect(youngest?.amount).toBe(100);
    expect(youngest?.coinTime).toBe(900);
  });
});

describe("buildPostReadinessSummary", () => {
  it("describes waiting min age", () => {
    const now = 1_000_000;
    const summary = buildPostReadinessSummary({
      receive: {
        amount: 100,
        confirmations: 600,
        coinTime: now - 3600,
      },
      walletStakeWeight: 18,
      nowSeconds: now,
    });
    expect(summary.minAgeLabel).toMatch(/In ~|~/);
    expect(summary.maturityLabel).toBe("Confirmations OK");
  });
});
