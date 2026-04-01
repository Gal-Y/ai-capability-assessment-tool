import { useState } from "react";
import {
  defaultCapabilityForm,
  enterpriseDocuments,
  evaluationScenarios,
} from "./data/mockData";
import {
  evaluateConfigurations,
  getChampionConfiguration,
} from "./lib/evaluator";
import type {
  CapabilityForm,
  ConfigurationResult,
  RiskLevel,
} from "./types";

type ViewId = "home" | "setup" | "scenarios" | "economics";
type Tone = "good" | "warn" | "bad";

const navGroups: Array<{
  label: string;
  items: Array<{ id: ViewId; label: string }>;
}> = [
  {
    label: "Workspace",
    items: [
      { id: "home", label: "Home" },
      { id: "setup", label: "Capability" },
    ],
  },
  {
    label: "Evaluation",
    items: [
      { id: "scenarios", label: "Cases" },
      { id: "economics", label: "Economics" },
    ],
  },
];

const chartMetrics = [
  {
    label: "Faith",
    getValue: (result: ConfigurationResult) => result.faithfulness,
  },
  {
    label: "Cover",
    getValue: (result: ConfigurationResult) => result.coverage,
  },
  {
    label: "Policy",
    getValue: (result: ConfigurationResult) => result.compliance,
  },
  {
    label: "Privacy",
    getValue: (result: ConfigurationResult) => result.privacy,
  },
];

const colorByConfig: Record<string, string> = {
  baseline: "#7c5cff",
  guarded: "#d8dce6",
  strict: "#3d7aff",
};

const currencyFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

const formatPercent = (value: number) => `${value.toFixed(1)}%`;
const formatMonths = (value: number) =>
  Number.isFinite(value) ? `${value.toFixed(1)} mo` : "No payback";

const getDecisionTone = (decision: ConfigurationResult["deploymentDecision"]): Tone => {
  if (decision === "Ready") {
    return "good";
  }
  if (decision === "Conditional") {
    return "warn";
  }
  return "bad";
};

const DecisionPill = ({
  label,
  tone,
}: {
  label: string;
  tone: Tone;
}) => <span className={`decision-pill decision-pill--${tone}`}>{label}</span>;

const ScenarioPill = ({
  label,
}: {
  label: "Pass" | "Review" | "Fail";
}) => (
  <span className={`decision-pill decision-pill--${label.toLowerCase()}`}>
    {label}
  </span>
);

const MetricRail = ({
  label,
  value,
  target,
}: {
  label: string;
  value: number;
  target: number;
}) => {
  const passes = value >= target;

  return (
    <div className="gate-row">
      <div className="gate-row__meta">
        <span>{label}</span>
        <strong>{formatPercent(value)}</strong>
      </div>
      <div className="metric-bar">
        <span
          className={`metric-bar__fill metric-bar__fill--${passes ? "good" : "bad"}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
        <span className="metric-bar__target" style={{ left: `${target}%` }} />
      </div>
    </div>
  );
};

const TrendChart = ({
  results,
}: {
  results: ConfigurationResult[];
}) => {
  const width = 560;
  const height = 190;
  const paddingX = 30;
  const paddingY = 22;
  const chartHeight = height - paddingY * 2;
  const stepX = (width - paddingX * 2) / (chartMetrics.length - 1);

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Config quality chart">
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = paddingY + (100 - tick) / 100 * chartHeight;

          return (
            <line
              key={tick}
              x1={paddingX}
              x2={width - paddingX}
              y1={y}
              y2={y}
              className="trend-chart__grid"
            />
          );
        })}

        {results.map((result) => {
          const points = chartMetrics
            .map((metric, index) => {
              const x = paddingX + stepX * index;
              const y =
                paddingY +
                (100 - metric.getValue(result)) / 100 * chartHeight;

              return `${x},${y}`;
            })
            .join(" ");

          return (
            <g key={result.config.id}>
              <polyline
                fill="none"
                points={points}
                stroke={colorByConfig[result.config.id]}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {chartMetrics.map((metric, index) => {
                const cx = paddingX + stepX * index;
                const cy =
                  paddingY +
                  (100 - metric.getValue(result)) / 100 * chartHeight;

                return (
                  <circle
                    key={`${result.config.id}-${metric.label}`}
                    cx={cx}
                    cy={cy}
                    r="4"
                    fill={colorByConfig[result.config.id]}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      <div className="trend-chart__axis">
        {chartMetrics.map((metric) => (
          <span key={metric.label}>{metric.label}</span>
        ))}
      </div>
    </div>
  );
};

function App() {
  const [activeView, setActiveView] = useState<ViewId>("home");
  const [form, setForm] = useState<CapabilityForm>(defaultCapabilityForm);
  const [selectedConfigId, setSelectedConfigId] = useState("strict");
  const [lastRunAt, setLastRunAt] = useState(() => new Date());

  const results = evaluateConfigurations(form);
  const champion = getChampionConfiguration(results);
  const selectedResult =
    results.find((result) => result.config.id === selectedConfigId) ?? champion;
  const championTone = getDecisionTone(champion.deploymentDecision);
  const selectedTone = getDecisionTone(selectedResult.deploymentDecision);
  const passCount = selectedResult.scenarioResults.filter(
    (scenario) => scenario.status === "Pass",
  ).length;
  const reviewCount = selectedResult.scenarioResults.filter(
    (scenario) => scenario.status === "Review",
  ).length;
  const failCount = selectedResult.scenarioResults.filter(
    (scenario) => scenario.status === "Fail",
  ).length;
  const passRate =
    (passCount / Math.max(1, selectedResult.scenarioResults.length)) * 100;
  const flaggedCases = [...selectedResult.scenarioResults].sort(
    (left, right) => left.score - right.score,
  );

  const updateField = <Key extends keyof CapabilityForm>(
    key: Key,
    value: CapabilityForm[Key],
  ) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const updateThreshold = (
    key: keyof CapabilityForm["thresholds"],
    value: number,
  ) => {
    setForm((current) => ({
      ...current,
      thresholds: {
        ...current.thresholds,
        [key]: value,
      },
    }));
  };

  const updateRequiredSection = (index: number, value: string) => {
    setForm((current) => ({
      ...current,
      requiredSections: current.requiredSections.map((section, currentIndex) =>
        currentIndex === index ? value : section,
      ),
    }));
  };

  const runAssessment = () => {
    setLastRunAt(new Date());
    setActiveView("home");
  };

  const renderHome = () => (
    <>
      <header className="screen-header">
        <div>
          <span className="screen-label">Document Summarisation</span>
          <h1>Readiness workspace</h1>
        </div>
        <div className="screen-actions">
          <span className="run-stamp">
            {new Intl.DateTimeFormat("en-AU", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(lastRunAt)}
          </span>
          <button className="ghost-button" onClick={() => setActiveView("setup")} type="button">
            Setup
          </button>
          <button className="primary-button" onClick={runAssessment} type="button">
            Run
          </button>
        </div>
      </header>

      <section className="top-cards">
        <article className="panel summary-card summary-card--accent">
          <span className="card-label">Overall</span>
          <div className="summary-card__value">
            <DecisionPill label={champion.deploymentDecision} tone={championTone} />
            <strong>{champion.readinessScore.toFixed(1)}</strong>
          </div>
          <div className="summary-card__meta">
            <span>{champion.config.name}</span>
            <span>{formatPercent(champion.faithfulness)}</span>
          </div>
        </article>

        <article className="panel summary-card">
          <span className="card-label">Top config</span>
          <strong>{champion.config.label}</strong>
          <div className="summary-card__meta">
            <span>{champion.config.name}</span>
            <span>{formatPercent(champion.privacy)}</span>
          </div>
        </article>

        <article className="panel summary-card">
          <span className="card-label">Gate status</span>
          <strong>{5 - champion.gateFailures.length}/5</strong>
          <div className="summary-card__meta">
            <span>Thresholds</span>
            <span>{champion.gateFailures.length} issues</span>
          </div>
        </article>

        <article className="panel summary-card">
          <span className="card-label">Payback</span>
          <strong>{formatMonths(champion.paybackMonths)}</strong>
          <div className="summary-card__meta">
            <span>Savings</span>
            <span>{currencyFormatter.format(champion.monthlySavings)}</span>
          </div>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel gauge-panel">
          <div className="panel-head">
            <span className="panel-title">Latest run</span>
            <span className="panel-meta">{selectedResult.config.name}</span>
          </div>

          <div className="gauge-wrap">
            <div
              className="gauge"
              style={{
                background: `conic-gradient(var(--success) ${passRate}%, rgba(255,255,255,0.08) 0)`,
              }}
            >
              <div className="gauge__inner">
                <strong>{passRate.toFixed(1)}%</strong>
                <span>{passCount}/{selectedResult.scenarioResults.length} passed</span>
              </div>
            </div>
          </div>

          <div className="stat-strip">
            <div>
              <span>Pass</span>
              <strong>{passCount}</strong>
            </div>
            <div>
              <span>Review</span>
              <strong>{reviewCount}</strong>
            </div>
            <div>
              <span>Fail</span>
              <strong>{failCount}</strong>
            </div>
            <div>
              <span>Latency</span>
              <strong>{selectedResult.latencySeconds.toFixed(1)}s</strong>
            </div>
          </div>
        </article>

        <article className="panel cases-panel">
          <div className="panel-head panel-head--stack">
            <div>
              <span className="panel-title">Case review</span>
            </div>
            <div className="tab-row">
              {results.map((result) => (
                <button
                  key={result.config.id}
                  className={`tab-button ${
                    selectedResult.config.id === result.config.id
                      ? "tab-button--active"
                      : ""
                  }`}
                  onClick={() => setSelectedConfigId(result.config.id)}
                  type="button"
                >
                  {result.config.label}
                </button>
              ))}
            </div>
          </div>

          <div className="table">
            <div className="table__head">
              <span>Case</span>
              <span>Status</span>
              <span>Score</span>
              <span>Finding</span>
            </div>
            {flaggedCases.map((scenario) => (
              <div key={scenario.scenarioId} className="table__row">
                <div>
                  <strong>{scenario.title}</strong>
                  <span>{scenario.latencySeconds.toFixed(1)}s</span>
                </div>
                <ScenarioPill label={scenario.status} />
                <strong>{scenario.score.toFixed(1)}</strong>
                <span>
                  {scenario.findings[0] ?? "No issue"}
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="dashboard-grid dashboard-grid--lower">
        <article className="panel">
          <div className="panel-head">
            <span className="panel-title">Config quality</span>
          </div>
          <TrendChart results={results} />
          <div className="legend-row">
            {results.map((result) => (
              <span key={result.config.id} className="legend-item">
                <i
                  className="legend-swatch"
                  style={{ background: colorByConfig[result.config.id] }}
                />
                {result.config.name}
              </span>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <span className="panel-title">Gates</span>
            <DecisionPill label={selectedResult.deploymentDecision} tone={selectedTone} />
          </div>

          <MetricRail
            label="Faithfulness"
            value={selectedResult.faithfulness}
            target={form.thresholds.faithfulness}
          />
          <MetricRail
            label="Coverage"
            value={selectedResult.coverage}
            target={form.thresholds.coverage}
          />
          <MetricRail
            label="Policy"
            value={selectedResult.compliance}
            target={form.thresholds.compliance}
          />
          <MetricRail
            label="Privacy"
            value={selectedResult.privacy}
            target={form.thresholds.privacy}
          />

          <div className="issue-stack">
            {selectedResult.gateFailures.length > 0 ? (
              selectedResult.gateFailures.map((failure) => (
                <div key={failure} className="issue-chip">
                  {failure}
                </div>
              ))
            ) : (
              <div className="issue-chip issue-chip--good">All gates clear</div>
            )}
          </div>
        </article>
      </section>
    </>
  );

  const renderSetup = () => (
    <>
      <header className="screen-header">
        <div>
          <span className="screen-label">Capability</span>
          <h1>Setup</h1>
        </div>
      </header>

      <section className="editor-grid">
        <article className="panel panel--wide">
          <div className="panel-head">
            <span className="panel-title">Profile</span>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Name</span>
              <input
                value={form.capabilityName}
                onChange={(event) => updateField("capabilityName", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Audience</span>
              <input
                value={form.targetAudience}
                onChange={(event) => updateField("targetAudience", event.target.value)}
              />
            </label>

            <label className="field field--wide">
              <span>Purpose</span>
              <textarea
                rows={3}
                value={form.businessPurpose}
                onChange={(event) => updateField("businessPurpose", event.target.value)}
              />
            </label>

            <label className="field field--wide">
              <span>Documents</span>
              <input
                value={form.documentType}
                onChange={(event) => updateField("documentType", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Style</span>
              <select
                value={form.summaryStyle}
                onChange={(event) => updateField("summaryStyle", event.target.value)}
              >
                <option>Executive brief</option>
                <option>Structured bullet summary</option>
                <option>Operational digest</option>
                <option>Board-ready briefing</option>
              </select>
            </label>

            <label className="field">
              <span>Max words</span>
              <input
                min={80}
                max={500}
                type="number"
                value={form.outputLength}
                onChange={(event) =>
                  updateField("outputLength", Number(event.target.value))
                }
              />
            </label>

            <div className="field">
              <span>Risk</span>
              <div className="chip-row">
                {(["Low", "Medium", "High"] as RiskLevel[]).map((level) => (
                  <button
                    key={level}
                    className={`chip-button ${
                      form.riskLevel === level ? "chip-button--active" : ""
                    }`}
                    onClick={() => updateField("riskLevel", level)}
                    type="button"
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <label className="field field--wide">
              <span>Exclude</span>
              <textarea
                rows={3}
                value={form.excludedContent}
                onChange={(event) => updateField("excludedContent", event.target.value)}
              />
            </label>
          </div>

          <div className="panel-head panel-head--spaced">
            <span className="panel-title">Sections</span>
          </div>
          <div className="token-row">
            {form.requiredSections.map((section, index) => (
              <input
                key={`${section}-${index}`}
                value={section}
                onChange={(event) =>
                  updateRequiredSection(index, event.target.value)
                }
              />
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <span className="panel-title">Thresholds</span>
          </div>

          <div className="slider-stack">
            <label className="slider-field">
              <div>
                <span>Faithfulness</span>
                <strong>{form.thresholds.faithfulness}%</strong>
              </div>
              <input
                type="range"
                min={70}
                max={99}
                value={form.thresholds.faithfulness}
                onChange={(event) =>
                  updateThreshold("faithfulness", Number(event.target.value))
                }
              />
            </label>

            <label className="slider-field">
              <div>
                <span>Coverage</span>
                <strong>{form.thresholds.coverage}%</strong>
              </div>
              <input
                type="range"
                min={70}
                max={99}
                value={form.thresholds.coverage}
                onChange={(event) =>
                  updateThreshold("coverage", Number(event.target.value))
                }
              />
            </label>

            <label className="slider-field">
              <div>
                <span>Policy</span>
                <strong>{form.thresholds.compliance}%</strong>
              </div>
              <input
                type="range"
                min={70}
                max={99}
                value={form.thresholds.compliance}
                onChange={(event) =>
                  updateThreshold("compliance", Number(event.target.value))
                }
              />
            </label>

            <label className="slider-field">
              <div>
                <span>Privacy</span>
                <strong>{form.thresholds.privacy}%</strong>
              </div>
              <input
                type="range"
                min={80}
                max={100}
                value={form.thresholds.privacy}
                onChange={(event) =>
                  updateThreshold("privacy", Number(event.target.value))
                }
              />
            </label>

            <label className="slider-field">
              <div>
                <span>Latency</span>
                <strong>{form.thresholds.maxLatencySeconds}s</strong>
              </div>
              <input
                type="range"
                min={2}
                max={9}
                value={form.thresholds.maxLatencySeconds}
                onChange={(event) =>
                  updateThreshold("maxLatencySeconds", Number(event.target.value))
                }
              />
            </label>
          </div>
        </article>
      </section>
    </>
  );

  const renderScenarios = () => (
    <>
      <header className="screen-header">
        <div>
          <span className="screen-label">Evaluation</span>
          <h1>Cases</h1>
        </div>
      </header>

      <section className="editor-grid">
        <article className="panel">
          <div className="panel-head">
            <span className="panel-title">Documents</span>
          </div>
          <div className="list-stack">
            {enterpriseDocuments.map((document) => (
              <div key={document.id} className="list-row">
                <div>
                  <strong>{document.title}</strong>
                  <span>
                    {document.type} · {document.classification}
                  </span>
                </div>
                <span>{document.lengthPages}p</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel panel--wide">
          <div className="panel-head">
            <span className="panel-title">Scenarios</span>
          </div>
          <div className="table">
            <div className="table__head">
              <span>Scenario</span>
              <span>Audience</span>
              <span>Difficulty</span>
              <span>Restricted</span>
            </div>
            {evaluationScenarios.map((scenario) => (
              <div key={scenario.id} className="table__row">
                <div>
                  <strong>{scenario.title}</strong>
                  <span>{scenario.goal}</span>
                </div>
                <span>{scenario.audience}</span>
                <strong>{scenario.difficulty}/4</strong>
                <span>{scenario.restrictedContent.length}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </>
  );

  const renderEconomics = () => (
    <>
      <header className="screen-header">
        <div>
          <span className="screen-label">Economics</span>
          <h1>Business case</h1>
        </div>
      </header>

      <section className="editor-grid">
        <article className="panel panel--wide">
          <div className="panel-head">
            <span className="panel-title">Inputs</span>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Volume / month</span>
              <input
                min={100}
                type="number"
                value={form.volumePerMonth}
                onChange={(event) =>
                  updateField("volumePerMonth", Number(event.target.value))
                }
              />
            </label>

            <label className="field">
              <span>Manual mins</span>
              <input
                min={1}
                type="number"
                value={form.manualMinutesPerDocument}
                onChange={(event) =>
                  updateField(
                    "manualMinutesPerDocument",
                    Number(event.target.value),
                  )
                }
              />
            </label>

            <label className="field">
              <span>Hourly rate</span>
              <input
                min={20}
                type="number"
                value={form.reviewHourlyRate}
                onChange={(event) =>
                  updateField("reviewHourlyRate", Number(event.target.value))
                }
              />
            </label>

            <label className="field">
              <span>Maintenance</span>
              <input
                min={0}
                type="number"
                value={form.maintenanceCost}
                onChange={(event) =>
                  updateField("maintenanceCost", Number(event.target.value))
                }
              />
            </label>

            <label className="field">
              <span>Implementation</span>
              <input
                min={0}
                type="number"
                value={form.implementationCost}
                onChange={(event) =>
                  updateField("implementationCost", Number(event.target.value))
                }
              />
            </label>

            <label className="field">
              <span>Payback target</span>
              <input
                min={1}
                type="number"
                value={form.paybackTargetMonths}
                onChange={(event) =>
                  updateField("paybackTargetMonths", Number(event.target.value))
                }
              />
            </label>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head panel-head--stack">
            <span className="panel-title">Configuration</span>
            <div className="tab-row">
              {results.map((result) => (
                <button
                  key={result.config.id}
                  className={`tab-button ${
                    selectedResult.config.id === result.config.id
                      ? "tab-button--active"
                      : ""
                  }`}
                  onClick={() => setSelectedConfigId(result.config.id)}
                  type="button"
                >
                  {result.config.label}
                </button>
              ))}
            </div>
          </div>

          <div className="stat-stack">
            <div className="stat-line">
              <span>Current</span>
              <strong>{currencyFormatter.format(selectedResult.monthlyCurrentCost)}</strong>
            </div>
            <div className="stat-line">
              <span>AI</span>
              <strong>{currencyFormatter.format(selectedResult.monthlyAiCost)}</strong>
            </div>
            <div className="stat-line stat-line--accent">
              <span>Savings</span>
              <strong>{currencyFormatter.format(selectedResult.monthlySavings)}</strong>
            </div>
            <div className="stat-line">
              <span>Payback</span>
              <strong>{formatMonths(selectedResult.paybackMonths)}</strong>
            </div>
          </div>
        </article>
      </section>
    </>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <span className="brand-label">Thesis MVP</span>
            <strong>Capability Lab</strong>
          </div>
        </div>

        <div className="workspace-chip">
          <span>Document Summarisation</span>
          <strong>{champion.readinessScore.toFixed(1)}</strong>
        </div>

        {navGroups.map((group) => (
          <div key={group.label} className="nav-group">
            <span className="nav-group__label">{group.label}</span>
            {group.items.map((item) => (
              <button
                key={item.id}
                className={`sidebar-link ${
                  activeView === item.id ? "sidebar-link--active" : ""
                }`}
                onClick={() => setActiveView(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-footer">
          <DecisionPill label={champion.deploymentDecision} tone={championTone} />
          <span>{champion.config.name}</span>
        </div>
      </aside>

      <main className="workspace">
        {activeView === "home" && renderHome()}
        {activeView === "setup" && renderSetup()}
        {activeView === "scenarios" && renderScenarios()}
        {activeView === "economics" && renderEconomics()}
      </main>
    </div>
  );
}

export default App;
