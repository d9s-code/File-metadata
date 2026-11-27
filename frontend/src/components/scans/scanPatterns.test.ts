import { describe, expect, it } from "vitest";
import { paramsText, scanTiming } from "./scanPatterns";

const scan = (pattern: string, params: Record<string, number>, az: number | null = 2, el: number | null = null, ill: number | null = null) => ({
  pattern,
  params,
  beam_az_deg: az,
  beam_el_deg: el,
  illumination_ms: ill,
});

describe("scanTiming", () => {
  it("circular: beamwidth ÷ 360° of the period, back each period", () => {
    const t = scanTiming(scan("circular", { period_s: 10 }));
    expect(t.illuminationMs!.nom).toBeCloseTo(55.556, 2);
    expect(t.revisitS!.nom).toBe(10);
    expect(t.working[0]).toBe("2° ÷ 360° × 10 s = 55.6 ms");
  });

  it("a ± on the period spreads both", () => {
    const t = scanTiming(scan("circular", { period_s: 10, period_s_delta: 1 }));
    expect([t.revisitS!.lo, t.revisitS!.nom, t.revisitS!.hi]).toEqual([9, 10, 11]);
    expect(t.illuminationMs!.lo).toBeCloseTo(50, 5);
    expect(t.illuminationMs!.hi).toBeCloseTo(61.111, 2);
  });

  it("sector: beamwidth ÷ sector of the sweep; one way adds the flyback", () => {
    const uni = scanTiming(scan("sector_uni", { sector_deg: 90, sweep_s: 3, flyback_s: 1 }));
    expect(uni.illuminationMs!.nom).toBeCloseTo(66.667, 2);
    expect(uni.revisitS!.nom).toBe(4);
    expect(scanTiming(scan("sector_bi", { sector_deg: 90, sweep_s: 3 })).revisitS!.nom).toBe(3);
  });

  it("raster: one bar's share per look, looks from the elevation beamwidth over the bar spacing", () => {
    const t = scanTiming(scan("raster", { sector_deg: 60, bars: 4, bar_spacing_deg: 2, frame_s: 4 }, 3, 4));
    expect(t.illuminationMs!.nom).toBeCloseTo(50, 5); // 3/60 × 1 s
    expect([t.looks, t.revisitS!.nom]).toEqual([2, 4]);
    // No elevation beamwidth: one look.
    expect(scanTiming(scan("raster", { sector_deg: 60, bars: 4, bar_spacing_deg: 2, frame_s: 4 }, 3)).looks).toBe(1);
  });

  it("helical comes back after every level; spiral by area; palmer widens the beam", () => {
    expect(scanTiming(scan("helical", { period_s: 2, levels: 5 })).revisitS!.nom).toBe(10);
    expect(scanTiming(scan("spiral", { cone_deg: 20, turns: 5, frame_s: 2 })).illuminationMs!.nom).toBeCloseTo(20, 5);
    expect(scanTiming(scan("palmer", { period_s: 9, nutation_deg: 2 })).illuminationMs!.nom).toBeCloseTo(100, 5);
  });

  it("ESA: pulses × the Mode's PRI, or a dwell time", () => {
    const s = scan("esa", { pulses: 16, revisit_s: 0.5 }, null);
    expect(scanTiming(s).illuminationMs).toBeNull();
    expect(scanTiming(s).working).toEqual(["16 pulses × each Mode's PRI"]);
    expect(scanTiming(s, 1000).illuminationMs!.nom).toBe(16);
    expect(scanTiming(scan("esa", { dwell_ms: 5, revisit_s: 0.5 }, null)).illuminationMs!.nom).toBe(5);
    expect(scanTiming(scan("esa", { revisit_s: 0.5 }, null)).missing).toEqual(["Pulses per dwell or dwell time"]);
  });

  it("tracking is continuous; a typed time wins; what's missing is said", () => {
    expect(scanTiming(scan("conical", {})).continuous).toBe(true);
    const typed = scanTiming(scan("circular", { period_s: 10 }, 2, null, 40));
    expect([typed.illuminationMs!.nom, typed.typed]).toEqual([40, true]);
    expect(scanTiming(scan("circular", {}, null)).missing).toEqual(["Rotation period", "Azimuth beamwidth"]);
    expect(scanTiming(scan("other", { revisit_s: 3 }, null)).missing).toEqual(["Illumination time"]);
  });
});

describe("paramsText", () => {
  it("reads the values with their units and ±", () => {
    expect(paramsText({ pattern: "sector_uni", params: { sector_deg: 90, sweep_s: 3, sweep_s_delta: 0.5 } })).toBe(
      "sector width 90°, sweep time 3 s ± 0.5",
    );
  });
});
