from app.services.ambiguity_service import (
    FlatModeLine,
    compute_pairwise_findings,
    compute_pri_overlap,
    compute_severity,
    flatten_emitter_snapshot,
    flatten_mdf_snapshot,
    flatten_platform_snapshot,
)


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


def test_fixed_vs_stagger_partial_overlap_percentage():
    a = _mode("a", "fixed", _line(pri_min=800, pri_max=1200))
    b = _mode("b", "stagger", _line(stagger=[800, 850, 2000]))
    pct, comparison_type = compute_pri_overlap(a.line, "fixed", b.line, "stagger")
    assert comparison_type == "fixed-stagger"
    assert abs(pct - (2 / 3 * 100)) < 0.01


def test_stagger_vs_stagger_shared_values():
    a_line = _line(stagger=[800, 850, 900])
    b_line = _line(stagger=[850, 900, 999])
    pct, _ = compute_pri_overlap(a_line, "stagger", b_line, "stagger")
    assert abs(pct - (2 / 3 * 100)) < 0.01


def test_cw_vs_anything_is_non_comparable_and_severity_from_rf_pw_only():
    a = _mode("a", "cw", _line())
    b = _mode("b", "fixed", _line(pri_min=800, pri_max=1200))
    findings = compute_pairwise_findings([a, b])
    assert findings[0]["pri_overlap_pct"] is None
    assert findings[0]["pri_comparison_type"] == "cw-fixed"
    # RF and PW are both fully overlapping and PRI is non-comparable -> exact_overlap driven by RF+PW alone
    assert findings[0]["combined_severity"] == "exact_overlap"


def test_xlet_is_also_non_comparable():
    pct, comparison_type = compute_pri_overlap(_line(), "xlet", _line(pri_min=1, pri_max=2), "fixed")
    assert pct is None
    assert comparison_type == "fixed-xlet"


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
