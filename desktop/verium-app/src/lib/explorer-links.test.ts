import { describe, expect, it } from "vitest";
import {
  buildTxExplorerUrl,
  defaultTxExplorerTemplate,
  effectiveTxExplorerTemplate,
  explorerTemplateTargetsOtherChain,
} from "@/lib/explorer-links";

const VRM_TX = "https://staging-explorer.vericonomy.com/vrm/tx/%s";
const VRC_TX = "https://staging-explorer.vericonomy.com/vrc/tx/%s";

describe("explorerTemplateTargetsOtherChain", () => {
  it("detects vrm template when active coin is vericoin", () => {
    expect(explorerTemplateTargetsOtherChain("vericoin", VRM_TX)).toBe(true);
  });

  it("detects vrc template when active coin is verium", () => {
    expect(explorerTemplateTargetsOtherChain("verium", VRC_TX)).toBe(true);
  });

  it("allows matching chain path", () => {
    expect(explorerTemplateTargetsOtherChain("vericoin", VRC_TX)).toBe(false);
    expect(explorerTemplateTargetsOtherChain("verium", VRM_TX)).toBe(false);
  });
});

describe("effectiveTxExplorerTemplate", () => {
  it("rewrites stored vrm template for vericoin", () => {
    expect(effectiveTxExplorerTemplate("vericoin", VRM_TX)).toBe(VRC_TX);
  });

  it("keeps stored vrm template for verium", () => {
    expect(effectiveTxExplorerTemplate("verium", VRM_TX)).toBe(VRM_TX);
  });
});

describe("buildTxExplorerUrl", () => {
  it("uses vrc path when coin is vericoin despite vrm pref", () => {
    const url = buildTxExplorerUrl(
      "vericoin",
      VRM_TX,
      "909a742a28b3d7f7eba05968ea526f3d860a736da214af032d5837850894a1e1",
    );
    expect(url).toContain("/vrc/tx/");
    expect(url).not.toContain("/vrm/tx/");
  });
});

describe("defaultTxExplorerTemplate", () => {
  it("uses chain-specific paths", () => {
    expect(defaultTxExplorerTemplate("verium")).toContain("/vrm/tx/");
    expect(defaultTxExplorerTemplate("vericoin")).toContain("/vrc/tx/");
  });
});
