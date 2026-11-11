import { describe, expect, it } from "vitest";
import { changesData } from "./client";

describe("changesData — which requests make pages refresh", () => {
  it("counts writes", () => {
    expect(changesData("POST", "/emitters/1/sources/2/elements")).toBe(true);
    expect(changesData("PATCH", "/emitters/1")).toBe(true);
    expect(changesData("DELETE", "/emitters/1/modes/3")).toBe(true);
    expect(changesData("PUT", "/emitters/1/function-code")).toBe(true);
    expect(changesData("POST", "/emitters/1/imports/json-import")).toBe(true);
  });

  it("doesn't count reads, previews, dry runs, comparisons or signing in", () => {
    expect(changesData("GET", "/emitters")).toBe(false);
    expect(changesData("POST", "/emitters/1/imports/json-import/preview")).toBe(false);
    expect(changesData("POST", "/emitters/1/imports/prs-update/preview")).toBe(false);
    expect(changesData("POST", "/ambiguity/findings/9/merge-preview")).toBe(false);
    expect(changesData("PUT", "/intercepts/4/grouping?dry_run=true")).toBe(false);
    expect(changesData("POST", "/reports/mdfs/5/compare")).toBe(false);
    expect(changesData("POST", "/auth/login")).toBe(false);
    expect(changesData("POST", "/pcl/check")).toBe(false);
    expect(changesData("POST", "/pcl/mdfs/7/what-if")).toBe(false);
    // Saving a confidence rule does.
    expect(changesData("POST", "/pcl/platforms/3/rules")).toBe(true);
    // A real regroup does.
    expect(changesData("PUT", "/intercepts/4/grouping?dry_run=false")).toBe(true);
  });
});
