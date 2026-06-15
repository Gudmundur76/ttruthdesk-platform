import { describe, it, expect } from "vitest";
import {
  inferImfIndicator,
  inferImfCountry,
  matchesEconomicsSignals,
} from "./imf";

describe("IMF adapter — indicator inference", () => {
  it("infers NGDP_RPCH for GDP growth claims", () => {
    const r = inferImfIndicator("US GDP growth was 2.5% in 2023");
    expect(r.code).toBe("NGDP_RPCH");
  });

  it("infers PCPIPCH for inflation claims", () => {
    const r = inferImfIndicator("Inflation in the eurozone reached 8.4%");
    expect(r.code).toBe("PCPIPCH");
  });

  it("infers BCA_NGDPD for current account claims", () => {
    const r = inferImfIndicator(
      "Germany's current account surplus is 7% of GDP"
    );
    expect(r.code).toBe("BCA_NGDPD");
  });

  it("infers GGXWDG_NGDP for government debt claims", () => {
    const r = inferImfIndicator("Japan's public debt exceeds 250% of GDP");
    expect(r.code).toBe("GGXWDG_NGDP");
  });

  it("defaults to NGDP_RPCH for unknown economics claims", () => {
    const r = inferImfIndicator("The economy is recovering from the recession");
    expect(r.code).toBe("NGDP_RPCH");
  });
});

describe("IMF adapter — country inference", () => {
  it("infers USA for United States", () => {
    expect(inferImfCountry("US GDP growth was 2.5%")).toBe("USA");
  });

  it("infers CHN for China", () => {
    expect(inferImfCountry("China's inflation rate is 2.1%")).toBe("CHN");
  });

  it("infers GBR for United Kingdom", () => {
    expect(inferImfCountry("United Kingdom unemployment fell to 4.2%")).toBe(
      "GBR"
    );
  });

  it("infers EUQ for eurozone", () => {
    expect(inferImfCountry("Eurozone GDP contracted in Q3")).toBe("EUQ");
  });

  it("defaults to 001 (World) for unrecognized countries", () => {
    expect(inferImfCountry("Global GDP growth slowed to 3.1%")).toBe("001");
  });
});

describe("IMF adapter — economics signal matching", () => {
  it("matches GDP claims", () => {
    expect(matchesEconomicsSignals("US GDP grew 2.5% in 2023")).toBe(true);
  });

  it("matches inflation claims", () => {
    expect(
      matchesEconomicsSignals("Inflation peaked at 9.1% in June 2022")
    ).toBe(true);
  });

  it("matches IMF-specific claims", () => {
    expect(
      matchesEconomicsSignals("The IMF forecasts 3.2% global growth")
    ).toBe(true);
  });

  it("does not match non-economics claims", () => {
    expect(matchesEconomicsSignals("Lysozyme is found in human tears")).toBe(
      false
    );
  });

  it("matches recession claims", () => {
    expect(
      matchesEconomicsSignals("The US entered a technical recession in 2022")
    ).toBe(true);
  });
});
