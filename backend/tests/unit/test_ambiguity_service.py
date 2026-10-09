from app.services.ambiguity_service import (
    FlatModeLine,
    carry_forward_reviews,
    compute_pairwise_findings,
    compute_severity,
    flatten_emitter_snapshot,
    flatten_mdf_snapshot,
    flatten_platform_snapshot,
)


def _reviewed(mode_a="a", mode_b="b", rf=50.0, pw=60.0, pri=70.0, severity="medium", by="user-1", note="ok"):
    return {
        "mode_id_a": mode_a,
        "mode_id_b": mode_b,
        "rf_overlap_pct": rf,
        "pw_overlap_pct": pw,
        "pri_overlap_pct": pri,
        "combined_severity": severity,
        "reviewed_by": by,
        "reviewed_at": "2026-01-01T00:00:00Z",
        "reviewer_note": note,
    }


def _unreviewed(mode_a="a", mode_b="b", rf=50.0, pw=60.0, pri=70.0, severity="medium"):
    return {
        "mode_id_a": mode_a,
        "mode_id_b": mode_b,
        "rf_overlap_pct": rf,
        "pw_overlap_pct": pw,
        "pri_overlap_pct": pri,
        "combined_severity": severity,
    }


def _line(rf=(2900, 3100), pw=(0.5, 1.2), pri_min=None, pri_max=None, stagger=None):
    return {
        "rf_min_mhz": rf[0],
        "rf_max_mhz": rf[1],
        "pw_min_us": pw[0],
        "pw_max_us": pw[1],
        "pri_min_us": pri_min,
        "pri_max_us": pri_max,
        "jitter_min_us": None,
        "jitter_max_us": None,
        "pri_stagger_values_us": stagger,
    }


def _mode(mode_id, pri_type, line):
    return FlatModeLine(
        mode_id=mode_id,
        mode_name=mode_id,
        pri_type=pri_type,
        ew_group_id="g",
        ew_group_name="G",
        source_id="s",
        source_name="S",
        emitter_id="e",
        emitter_name="E",
        platform_id=None,
        platform_name=None,
        line=line,
    )


def test_identical_ranges_are_exact_overlap():
    a = _mode("a", "fixed", _line(pri_min=800, pri_max=1200))
    b = _mode("b", "fixed", _line(pri_min=800, pri_max=1200))
    findings = compute_pairwise_findings([a, b])
    assert len(findings) == 1
    assert findings[0]["combined_severity"] == "exact_overlap"
    assert findings[0]["rf_overlap_pct"] == 100.0
    assert findings[0]["pri_overlap_pct"] == 100.0


def test_disjoint_rf_produces_no_finding_regardless_of_pw_pri():
    a = _mode("a", "fixed", _line(rf=(2900, 3100), pri_min=800, pri_max=1200))
    b = _mode("b", "fixed", _line(rf=(5000, 5200), pri_min=800, pri_max=1200))
    assert compute_pairwise_findings([a, b]) == []


def test_different_pri_types_are_never_ambiguous():
    fixed = _mode("f", "fixed", _line(pri_min=800, pri_max=1200))
    stagger = _mode("s", "stagger", _line(stagger=[800, 850, 900]))
    cw = _mode("c", "cw", _line())
    xlet = _mode("x", "xlet", _line())
    assert compute_pairwise_findings([fixed, stagger, cw, xlet]) == []


def test_two_cw_modes_are_compared_on_rf_and_pw_only():
    [finding] = compute_pairwise_findings([_mode("a", "cw", _line()), _mode("b", "cw", _line())])
    assert finding["pri_overlap_pct"] is None
    assert finding["pri_comparison_type"] == "cw-cw"
    assert finding["combined_severity"] == "exact_overlap"


def test_staggers_without_range_matching_compare_identical_steps():
    a = _mode("a", "stagger", _line(stagger=[800, 850, 900]))
    b = _mode("b", "stagger", _line(stagger=[850, 900, 999]))
    [finding] = compute_pairwise_findings([a, b])
    assert abs(finding["pri_overlap_pct"] - (2 / 3 * 100)) < 0.01
    assert finding["details"]["pri_basis"] == "steps"


def test_staggers_with_range_matching_compare_frame_time():
    # Different steps, same frame time (2550): matched on frame time, they overlap fully.
    a = _mode("a", "stagger", {**_line(stagger=[800, 850, 900]), "pri_range_matching": True, "frame_time_delta_us": 5})
    b = _mode("b", "stagger", {**_line(stagger=[700, 900, 950]), "pri_range_matching": True, "frame_time_delta_us": 5})
    [finding] = compute_pairwise_findings([a, b])
    assert finding["pri_overlap_pct"] == 100.0
    assert finding["details"]["pri_basis"] == "frame_time"
    assert finding["details"]["compared"]["mode_a"]["frame_time"] == [2545, 2555]
    assert finding["details"]["compared"]["mode_a"]["stagger"] is None


def test_only_one_stagger_with_range_matching_is_never_ambiguous():
    a = _mode("a", "stagger", {**_line(stagger=[800, 850, 900]), "pri_range_matching": True})
    b = _mode("b", "stagger", _line(stagger=[800, 850, 900]))
    assert compute_pairwise_findings([a, b]) == []


def test_fixed_modes_are_always_compared_on_jitter():
    with_jitter = lambda lo, hi: {**_line(pri_min=800, pri_max=1200), "jitter_min_us": lo, "jitter_max_us": hi}  # noqa: E731
    # 5–15 vs 10–30 overlap 5 of the narrower 10 → 50%, the least → sets the severity.
    [finding] = compute_pairwise_findings([_mode("a", "fixed", with_jitter(5, 15)), _mode("b", "fixed", with_jitter(10, 30))])
    assert finding["details"]["jitter_overlap_pct"] == 50.0
    assert finding["details"]["limiting"] == "jitter"
    assert finding["combined_severity"] == "medium"
    assert finding["details"]["compared"]["mode_b"]["jitter"] == [10, 30]
    # Jitter that doesn't overlap tells them apart.
    assert compute_pairwise_findings([_mode("a", "fixed", with_jitter(5, 15)), _mode("b", "fixed", with_jitter(20, 30))]) == []
    # 0–0 is a steady PRI: inside 0–10, outside 5–15.
    [steady] = compute_pairwise_findings([_mode("a", "fixed", with_jitter(0, 0)), _mode("b", "fixed", with_jitter(0, 10))])
    assert steady["details"]["jitter_overlap_pct"] == 100.0
    assert compute_pairwise_findings([_mode("a", "fixed", with_jitter(0, 0)), _mode("b", "fixed", with_jitter(5, 15))]) == []


def test_severity_buckets_by_threshold():
    tolerance = {"low_threshold": 30, "high_threshold": 70, "exact_threshold": 99}
    assert compute_severity(0, 50, 50, tolerance) == "none"
    assert compute_severity(20, 50, 50, tolerance) == "low"
    assert compute_severity(50, 50, 50, tolerance) == "medium"
    assert compute_severity(80, 80, 80, tolerance) == "high"
    assert compute_severity(100, 100, 100, tolerance) == "exact_overlap"


def test_point_range_containment():
    a = _mode("a", "fixed", _line(rf=(3000, 3000), pri_min=800, pri_max=1200))
    b = _mode("b", "fixed", _line(rf=(2900, 3100), pri_min=800, pri_max=1200))
    findings = compute_pairwise_findings([a, b])
    assert findings[0]["rf_overlap_pct"] == 100.0


def test_flatten_emitter_snapshot_skips_modes_without_a_line():
    snapshot = {
        "id": "e1",
        "name": "Emitter1",
        "ew_groups": [
            {
                "id": "g1",
                "name": "G1",
                "modes": [
                    {"id": "m1", "name": "M1", "pri_type": "fixed", "source_id": "s1", "source_name": "S1", "line": _line(pri_min=1, pri_max=2)},
                    {"id": "m2", "name": "M2", "pri_type": "xlet", "source_id": "s1", "source_name": "S1", "line": None},
                ],
            }
        ],
    }
    flat = flatten_emitter_snapshot(snapshot)
    assert len(flat) == 1
    assert flat[0].mode_id == "m1"


def test_flatten_platform_and_mdf_snapshots_carry_context_through():
    emitter_snapshot = {
        "id": "e1",
        "name": "Emitter1",
        "ew_groups": [
            {
                "id": "g1",
                "name": "G1",
                "modes": [
                    {"id": "m1", "name": "M1", "pri_type": "cw", "source_id": "s1", "source_name": "S1", "line": _line()}
                ],
            }
        ],
    }
    platform_snapshot = {
        "id": "p1",
        "name": "Platform1",
        "links": [{"emitter_id": "e1", "emitter_name": "Emitter1", "emitter_snapshot": emitter_snapshot}],
    }
    mdf_snapshot = {
        "id": "mdf1",
        "name": "MDF1",
        "links": [{"platform_id": "p1", "platform_name": "Platform1", "platform_snapshot": platform_snapshot}],
    }

    from_platform = flatten_platform_snapshot(platform_snapshot)
    assert from_platform[0].platform_id == "p1"
    assert from_platform[0].emitter_id == "e1"

    from_mdf = flatten_mdf_snapshot(mdf_snapshot)
    assert from_mdf[0].platform_id == "p1"
    assert from_mdf[0].emitter_id == "e1"
    assert from_mdf[0].mode_id == "m1"


def test_carry_forward_reviews_matches_unordered_pair_and_unchanged_numbers():
    new = [_unreviewed(mode_a="b", mode_b="a")]  # order flipped vs. the prior finding
    prior = [_reviewed()]
    carry_forward_reviews(new, prior)
    assert new[0]["reviewed_by"] == "user-1"
    assert new[0]["reviewed_at"] == "2026-01-01T00:00:00Z"
    assert new[0]["reviewer_note"] == "ok"


def test_carry_forward_reviews_skips_when_severity_changed():
    new = [_unreviewed(severity="high")]
    prior = [_reviewed(severity="medium")]
    carry_forward_reviews(new, prior)
    assert "reviewed_by" not in new[0]


def test_carry_forward_reviews_skips_when_overlap_pct_changed():
    new = [_unreviewed(rf=55.0)]
    prior = [_reviewed(rf=50.0)]
    carry_forward_reviews(new, prior)
    assert "reviewed_by" not in new[0]


def test_carry_forward_reviews_skips_unmatched_pair():
    new = [_unreviewed(mode_a="c", mode_b="d")]
    prior = [_reviewed(mode_a="a", mode_b="b")]
    carry_forward_reviews(new, prior)
    assert "reviewed_by" not in new[0]


def test_carry_forward_reviews_handles_empty_prior_list():
    new = [_unreviewed()]
    carry_forward_reviews(new, [])
    assert "reviewed_by" not in new[0]


def test_margins_widen_the_ranges_compared_unless_turned_off():
    # RF 2900–3000 and 3005–3100 don't touch as typed; ±5 MHz margins make them meet.
    a = {**_line(rf=(2900, 3000)), "rf_delta": 5, "pw_delta": 0.1}
    b = {**_line(rf=(3005, 3100)), "rf_delta": 5, "pw_delta": 0.1}
    assert compute_pairwise_findings([_mode("a", "cw", a), _mode("b", "cw", b)], {"apply_margins": False}) == []

    [finding] = compute_pairwise_findings([_mode("a", "cw", a), _mode("b", "cw", b)])
    assert finding["details"]["margins_applied"] is True
    assert finding["details"]["compared"]["mode_a"]["rf"] == [2895, 3005]
    assert finding["details"]["compared"]["mode_b"]["rf"] == [3000, 3105]
    assert finding["details"]["compared"]["mode_a"]["pw"] == [0.4, 1.3]
    assert finding["rf_overlap_pct"] == 4.76  # 5 MHz of the narrower 105
    assert finding["details"]["limiting"] == "rf"


def test_stagger_steps_still_match_only_when_identical_with_margins():
    a = {**_line(stagger=[800, 850]), "pri_delta": 5}
    b = {**_line(stagger=[801, 851]), "pri_delta": 5}
    assert compute_pairwise_findings([_mode("a", "stagger", a), _mode("b", "stagger", b)]) == []


def test_the_limiting_parameter_is_the_one_overlapping_least():
    a = _line(rf=(2900, 3100), pw=(0.5, 1.0), pri_min=800, pri_max=1200)
    b = _line(rf=(2900, 3100), pw=(0.9, 1.4), pri_min=800, pri_max=1200)
    [finding] = compute_pairwise_findings([_mode("a", "fixed", a), _mode("b", "fixed", b)])
    assert finding["details"]["limiting"] == "pw"


def test_across_emitters_only_skips_pairs_inside_one_emitter():
    line = _line(pri_min=800, pri_max=1200)
    a1, a2, b1 = _mode("a1", "fixed", line), _mode("a2", "fixed", line), _mode("b1", "fixed", line)
    b1.emitter_id = "other"
    assert len(compute_pairwise_findings([a1, a2, b1])) == 3
    findings = compute_pairwise_findings([a1, a2, b1], across_emitters_only=True)
    assert {frozenset((f["mode_id_a"], f["mode_id_b"])) for f in findings} == {
        frozenset(("a1", "b1")),
        frozenset(("a2", "b1")),
    }
