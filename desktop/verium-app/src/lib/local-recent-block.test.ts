import { describe, expect, it } from "vitest";
import { mergeRecentBlocks } from "@/lib/local-recent-block";
import type { ExplorerBlock } from "@/lib/explorer-api";

function block(height: number, hash: string): ExplorerBlock {
  return { id: height, hash, height, time: height };
}

describe("mergeRecentBlocks", () => {
  it("prepends a local block not yet on the explorer feed", () => {
    const explorer = [block(100, "a"), block(99, "b")];
    const local = [
      {
        ...block(101, "new"),
        miner_address: "Vabc",
        output_total: "1.5",
      },
    ];
    const merged = mergeRecentBlocks(explorer, local, 10);
    expect(merged[0]?.height).toBe(101);
    expect(merged[0]?.miner_address).toBe("Vabc");
  });

  it("enriches an explorer row at the same height with local miner metadata", () => {
    const explorer = [{ ...block(100, "a"), miner_address: undefined }];
    const local = [{ ...block(100, "a"), miner_address: "Vyours" }];
    const merged = mergeRecentBlocks(explorer, local, 10);
    expect(merged[0]?.miner_address).toBe("Vyours");
  });
});
