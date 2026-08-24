import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import type { AmbiguityFinding } from "../../api/ambiguity";

const COLOR_A = "#2b5aa0";
const COLOR_B = "#c2410c";

function RangeBarChart({ title, unit, bars }: { title: string; unit: string; bars: { name: string; range: [number, number]; color: string }[] }) {
  const data = bars.map((b) => ({ name: b.name, range: b.range, color: b.color }));
  return (
    <div className="range-chart">
      <h6>
        {title} ({unit})
      </h6>
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" domain={["auto", "auto"]} />
          <YAxis type="category" dataKey="name" width={90} />
          <Tooltip />
          <Bar dataKey="range" fill="#2b5aa0" radius={3}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function StaggerScatter({ valuesA, valuesB }: { valuesA: number[]; valuesB: number[] }) {
  const dataA = valuesA.map((v) => ({ x: v, y: 1 }));
  const dataB = valuesB.map((v) => ({ x: v, y: 2 }));
  return (
    <div className="range-chart">
      <h6>PRI (Stagger values, µs)</h6>
      <ResponsiveContainer width="100%" height={120}>
        <ScatterChart margin={{ left: 10, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" dataKey="x" name="PRI" unit="µs" />
          <YAxis type="number" dataKey="y" domain={[0, 3]} ticks={[1, 2]} tickFormatter={(v) => (v === 1 ? "Mode A" : "Mode B")} />
          <ZAxis range={[80, 80]} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={dataA} fill={COLOR_A} />
          <Scatter data={dataB} fill={COLOR_B} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RfPriScatterPlot({ finding }: { finding: AmbiguityFinding }) {
  const { mode_a, mode_b } = finding.details;

  const rfBars = [
    { name: `A: ${mode_a.mode_name}`, range: [mode_a.line.rf_min_mhz, mode_a.line.rf_max_mhz] as [number, number], color: COLOR_A },
    { name: `B: ${mode_b.mode_name}`, range: [mode_b.line.rf_min_mhz, mode_b.line.rf_max_mhz] as [number, number], color: COLOR_B },
  ];
  const pwBars = [
    { name: `A: ${mode_a.mode_name}`, range: [mode_a.line.pw_min_us, mode_a.line.pw_max_us] as [number, number], color: COLOR_A },
    { name: `B: ${mode_b.mode_name}`, range: [mode_b.line.pw_min_us, mode_b.line.pw_max_us] as [number, number], color: COLOR_B },
  ];

  const bothFixed = mode_a.line.pri_min_us != null && mode_b.line.pri_min_us != null;
  const bothStagger = !!mode_a.line.pri_stagger_values_us?.length && !!mode_b.line.pri_stagger_values_us?.length;

  return (
    <div className="scatter-plot-group">
      <RangeBarChart title="RF" unit="MHz" bars={rfBars} />
      <RangeBarChart title="PW" unit="µs" bars={pwBars} />
      {bothFixed && (
        <RangeBarChart
          title="PRI (Fixed)"
          unit="µs"
          bars={[
            { name: `A: ${mode_a.mode_name}`, range: [mode_a.line.pri_min_us as number, mode_a.line.pri_max_us as number], color: COLOR_A },
            { name: `B: ${mode_b.mode_name}`, range: [mode_b.line.pri_min_us as number, mode_b.line.pri_max_us as number], color: COLOR_B },
          ]}
        />
      )}
      {bothStagger && (
        <StaggerScatter valuesA={mode_a.line.pri_stagger_values_us ?? []} valuesB={mode_b.line.pri_stagger_values_us ?? []} />
      )}
      {!bothFixed && !bothStagger && (
        <p className="hint-text">PRI is not directly comparable for this pair ({finding.pri_comparison_type}).</p>
      )}
    </div>
  );
}
