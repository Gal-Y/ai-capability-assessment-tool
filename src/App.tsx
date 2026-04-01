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
  RiskLevel,
} from "./types";

type SectionId =
  | "overview"
  | "capability"
  | "dataset"
  | "evaluation"
  | "economics";

const sectionCopy: Record<SectionId, { label: string; eyebrow: string }> = {
  overview: { label: "Overview", eyebrow: "Prototype" },
  capability: { label: "Capability Setup", eyebrow: "Configuration" },
  dataset: { label: "Dataset Studio", eyebrow: "Evaluation Pack" },
  evaluation: { label: "Readiness Results", eyebrow: "Assessment" },
  economics: { label: "Economic Viability", eyebrow: "Deployment Case" },
};

const currencyFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

const SectionTitle = ({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) => (
  <div className="section-title">
    <span className="eyebrow">{eyebrow}</span>
    <h2>{title}</h2>
    <p>{subtitle}</p>
  </div>
);

const MetricRail = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) => (
  <div className="metric-rail">
    <div className="metric-rail__meta">
      <span>{label}</span>
      <strong>{formatPercent(value)}</strong>
    </div>
    <div className="metric-rail__track">
      <span
        className="metric-rail__fill"
        style={{ width: `${Math.min(100, value)}%`, background: accent }}
      />
    </div>
  </div>
);

const ScenarioBadge = ({ status }: { status: "Pass" | "Review" | "Fail" }) => (
  <span className={`status-pill status-pill--${status.toLowerCase()}`}>
    {status}
  </span>
);

function App() {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [form, setForm] = useState<CapabilityForm>(defaultCapabilityForm);
  const [selectedConfigId, setSelectedConfigId] = useState("strict");
  const [lastRunAt, setLastRunAt] = useState(() => new Date());

  const results = evaluateConfigurations(form);
  const champion = getChampionConfiguration(results);
  const selectedResult =
    results.find((result) => result.config.id === selectedConfigId) ?? champion;
  const metricsAverage = (
    selectedResult.faithfulness +
    selectedResult.coverage +
    selectedResult.compliance +
    selectedResult.privacy
  ) /
  4;

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

  const rerunAssessment = () => {
    setLastRunAt(new Date());
    setActiveSection("evaluation");
  };

  const decisionTone =
    champion.deploymentDecision === "Ready"
      ? "good"
      : champion.deploymentDecision === "Conditional"
        ? "warn"
        : "bad";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <span>A</span>
          </div>
          <div>
            <p className="brand-overline">Thesis Prototype</p>
            <h1>AI Capability Assessment Tool</h1>
          </div>
        </div>

        <div className="sidebar-panel">
          <span className="sidebar-label">Capability</span>
          <strong>{form.capabilityName}</strong>
          <p>
            Initialised for document summarisation with enterprise governance,
            readiness scoring, and viability modelling.
          </p>
        </div>

        <nav className="nav-list">
          {(Object.keys(sectionCopy) as SectionId[]).map((section) => (
            <button
              key={section}
              className={`nav-item ${
                activeSection === section ? "nav-item--active" : ""
              }`}
              onClick={() => setActiveSection(section)}
              type="button"
            >
              <span>{sectionCopy[section].eyebrow}</span>
              <strong>{sectionCopy[section].label}</strong>
            </button>
          ))}
        </nav>

        <div className="sidebar-panel sidebar-panel--highlight">
          <span className="sidebar-label">Champion configuration</span>
          <div className="stack">
            <strong>{champion.config.name}</strong>
            <span className={`signal signal--${decisionTone}`}>
              {champion.deploymentDecision}
            </span>
          </div>
          <p>
            {champion.config.summary} Readiness index{" "}
            {champion.readinessScore.toFixed(1)}.
          </p>
        </div>
      </aside>

      <main className="workspace">
        <header className="hero-card glass-card">
          <div className="hero-copy">
            <span className="eyebrow">Document Summarisation Capability</span>
            <h2>Assess whether summarisation is ready for enterprise deployment.</h2>
            <p>
              This MVP lets you define the capability profile, inspect the test
              corpus, compare governed configurations, and decide whether the
              capability is technically and economically worth deploying.
            </p>
            <div className="hero-meta">
              <span className="sidebar-label">Last run</span>
              <strong>
                {new Intl.DateTimeFormat("en-AU", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(lastRunAt)}
              </strong>
            </div>
            <div className="hero-actions">
              <button className="primary-button" onClick={rerunAssessment} type="button">
                Run assessment
              </button>
              <button
                className="secondary-button"
                onClick={() => setActiveSection("capability")}
                type="button"
              >
                Edit inputs
              </button>
            </div>
          </div>

          <div className="hero-score">
            <div className={`signal-panel signal-panel--${decisionTone}`}>
              <span className="sidebar-label">Deployment decision</span>
              <strong>{champion.deploymentDecision}</strong>
              <p>
                Based on governance thresholds, privacy controls, and target
                payback period.
              </p>
            </div>
            <div className="ring-card">
              <div
                className="readiness-ring"
                style={{
                  background: `conic-gradient(#56b8ff ${champion.readinessScore}%, rgba(255,255,255,0.08) 0)`,
                }}
              >
                <div className="readiness-ring__inner">
                  <strong>{champion.readinessScore.toFixed(0)}</strong>
                  <span>Index</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="summary-grid">
          <article className="solid-card stat-card">
            <span className="sidebar-label">Faithfulness</span>
            <strong>{formatPercent(champion.faithfulness)}</strong>
            <p>Grounded output rate across the seeded enterprise evaluation pack.</p>
          </article>
          <article className="solid-card stat-card">
            <span className="sidebar-label">Privacy posture</span>
            <strong>{formatPercent(champion.privacy)}</strong>
            <p>Measures whether summaries keep restricted content out of general use.</p>
          </article>
          <article className="solid-card stat-card">
            <span className="sidebar-label">Monthly savings</span>
            <strong>{currencyFormatter.format(champion.monthlySavings)}</strong>
            <p>Estimated operating savings against the current manual summarisation flow.</p>
          </article>
          <article className="solid-card stat-card">
            <span className="sidebar-label">Payback</span>
            <strong>
              {Number.isFinite(champion.paybackMonths)
                ? `${champion.paybackMonths.toFixed(1)} months`
                : "No payback"}
            </strong>
            <p>Compared against your deployment target of {form.paybackTargetMonths} months.</p>
          </article>
        </section>

        {activeSection === "overview" && (
          <section className="content-grid page-enter">
            <div className="glass-card">
              <SectionTitle
                eyebrow="Capability Snapshot"
                title="Assessment profile"
                subtitle="The tool treats document summarisation as a reusable capability definition, not a company-specific one-off workflow."
              />
              <div className="detail-list">
                <div>
                  <span>Audience</span>
                  <strong>{form.targetAudience}</strong>
                </div>
                <div>
                  <span>Document mix</span>
                  <strong>{form.documentType}</strong>
                </div>
                <div>
                  <span>Output style</span>
                  <strong>
                    {form.summaryStyle}, {form.outputLength} words max
                  </strong>
                </div>
                <div>
                  <span>Risk level</span>
                  <strong>{form.riskLevel}</strong>
                </div>
              </div>
              <div className="pill-row">
                {form.requiredSections.map((section) => (
                  <span key={section} className="surface-pill">
                    {section}
                  </span>
                ))}
              </div>
            </div>

            <div className="solid-card">
              <SectionTitle
                eyebrow="Thresholds"
                title="Deployment gates"
                subtitle="These gates determine whether a configuration is recommended, conditional, or blocked."
              />
              <MetricRail label="Faithfulness gate" value={form.thresholds.faithfulness} accent="#56b8ff" />
              <MetricRail label="Coverage gate" value={form.thresholds.coverage} accent="#7df0cf" />
              <MetricRail label="Compliance gate" value={form.thresholds.compliance} accent="#ffc067" />
              <MetricRail label="Privacy gate" value={form.thresholds.privacy} accent="#63f5c8" />
              <div className="mini-note">
                Average latency target: <strong>{form.thresholds.maxLatencySeconds}s</strong>
              </div>
            </div>

            <div className="solid-card full-span">
              <SectionTitle
                eyebrow="Champion Evidence"
                title={`${champion.config.name} is the current deployment candidate`}
                subtitle="The selected configuration is the one the framework currently considers strongest against your declared thresholds."
              />
              <div className="comparison-grid">
                <div>
                  <MetricRail label="Faithfulness" value={champion.faithfulness} accent="#56b8ff" />
                  <MetricRail label="Coverage" value={champion.coverage} accent="#7df0cf" />
                </div>
                <div>
                  <MetricRail label="Compliance" value={champion.compliance} accent="#ffc067" />
                  <MetricRail label="Privacy" value={champion.privacy} accent="#63f5c8" />
                </div>
              </div>
            </div>
          </section>
        )}

        {activeSection === "capability" && (
          <section className="content-grid page-enter">
            <div className="glass-card full-span">
              <SectionTitle
                eyebrow="Configuration"
                title="Capability definition"
                subtitle="Adjust the operational context and the readiness gates. The assessment refreshes instantly."
              />

              <div className="form-grid">
                <label className="field">
                  <span>Capability name</span>
                  <input
                    value={form.capabilityName}
                    onChange={(event) => updateField("capabilityName", event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Target audience</span>
                  <input
                    value={form.targetAudience}
                    onChange={(event) => updateField("targetAudience", event.target.value)}
                  />
                </label>

                <label className="field field--wide">
                  <span>Business purpose</span>
                  <textarea
                    rows={3}
                    value={form.businessPurpose}
                    onChange={(event) => updateField("businessPurpose", event.target.value)}
                  />
                </label>

                <label className="field field--wide">
                  <span>Document mix</span>
                  <input
                    value={form.documentType}
                    onChange={(event) => updateField("documentType", event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Summary style</span>
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
                  <span>Maximum length (words)</span>
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
                  <span>Risk level</span>
                  <div className="toggle-row">
                    {(["Low", "Medium", "High"] as RiskLevel[]).map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={`toggle-chip ${
                          form.riskLevel === level ? "toggle-chip--active" : ""
                        }`}
                        onClick={() => updateField("riskLevel", level)}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="field field--wide">
                  <span>Never include</span>
                  <textarea
                    rows={3}
                    value={form.excludedContent}
                    onChange={(event) => updateField("excludedContent", event.target.value)}
                  />
                </label>
              </div>

              <div className="subsection">
                <div className="subsection-header">
                  <div>
                    <span className="eyebrow">Required sections</span>
                    <h3>Summary structure</h3>
                  </div>
                </div>
                <div className="token-editor">
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
              </div>
            </div>

            <div className="solid-card">
              <SectionTitle
                eyebrow="Threshold Controls"
                title="Technical gates"
                subtitle="Move these thresholds to tighten or loosen the deployment bar."
              />
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
                    <span>Compliance</span>
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
                    <span>Max latency</span>
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
            </div>

            <div className="solid-card">
              <SectionTitle
                eyebrow="Live Recommendation"
                title="What the current inputs imply"
                subtitle="As you change thresholds or operating context, the framework updates its recommendation."
              />
              <div className="decision-card">
                <span className={`signal signal--${decisionTone}`}>
                  {champion.deploymentDecision}
                </span>
                <strong>{champion.config.name}</strong>
                <p>{champion.config.summary}</p>
              </div>
              <div className="mini-note">
                Strongest aggregate score:{" "}
                <strong>{champion.readinessScore.toFixed(1)}</strong>
              </div>
            </div>
          </section>
        )}

        {activeSection === "dataset" && (
          <section className="content-grid page-enter">
            <div className="solid-card">
              <SectionTitle
                eyebrow="Synthetic Corpus"
                title="Enterprise evidence pack"
                subtitle="The MVP uses a fictional enterprise corpus so the framework is reusable while still being testable."
              />
              <div className="document-list">
                {enterpriseDocuments.map((document) => (
                  <article key={document.id} className="document-card">
                    <div className="document-card__meta">
                      <span>{document.type}</span>
                      <span>{document.classification}</span>
                    </div>
                    <strong>{document.title}</strong>
                    <p>{document.note}</p>
                    <div className="document-card__footer">
                      <span>{document.lengthPages} pages</span>
                      <span>{document.freshness}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="glass-card">
              <SectionTitle
                eyebrow="Evaluation Cases"
                title="Readiness scenarios"
                subtitle="Each scenario expresses a practical enterprise use case with required points and restricted content."
              />
              <div className="scenario-stack">
                {evaluationScenarios.map((scenario) => (
                  <article key={scenario.id} className="scenario-card">
                    <div className="scenario-card__head">
                      <strong>{scenario.title}</strong>
                      <span>{scenario.audience}</span>
                    </div>
                    <p>{scenario.goal}</p>
                    <div className="pill-row">
                      {scenario.requiredPoints.map((point) => (
                        <span key={point} className="surface-pill">
                          {point}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeSection === "evaluation" && (
          <section className="content-grid page-enter">
            <div className="glass-card full-span">
              <SectionTitle
                eyebrow="Configuration Comparison"
                title="Which deployment pattern is acceptable?"
                subtitle="The framework compares three governance levels rather than scoring a single prompt in isolation."
              />
              <div className="config-grid">
                {results.map((result) => (
                  <button
                    key={result.config.id}
                    className={`config-card ${
                      selectedResult.config.id === result.config.id
                        ? "config-card--selected"
                        : ""
                    }`}
                    onClick={() => setSelectedConfigId(result.config.id)}
                    type="button"
                  >
                    <div className="config-card__head">
                      <div>
                        <span>{result.config.label}</span>
                        <strong>{result.config.name}</strong>
                      </div>
                      <span
                        className={`signal signal--${
                          result.deploymentDecision === "Ready"
                            ? "good"
                            : result.deploymentDecision === "Conditional"
                              ? "warn"
                              : "bad"
                        }`}
                      >
                        {result.deploymentDecision}
                      </span>
                    </div>
                    <p>{result.config.summary}</p>
                    <div className="config-card__stats">
                      <div>
                        <span>Readiness index</span>
                        <strong>{result.readinessScore.toFixed(1)}</strong>
                      </div>
                      <div>
                        <span>Monthly savings</span>
                        <strong>{currencyFormatter.format(result.monthlySavings)}</strong>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="solid-card">
              <SectionTitle
                eyebrow="Selected Configuration"
                title={selectedResult.config.name}
                subtitle="Detailed view of the currently selected operating pattern."
              />
              <MetricRail label="Faithfulness" value={selectedResult.faithfulness} accent="#56b8ff" />
              <MetricRail label="Coverage" value={selectedResult.coverage} accent="#7df0cf" />
              <MetricRail label="Compliance" value={selectedResult.compliance} accent="#ffc067" />
              <MetricRail label="Privacy" value={selectedResult.privacy} accent="#63f5c8" />
              <div className="detail-list detail-list--compact">
                <div>
                  <span>Average latency</span>
                  <strong>{selectedResult.latencySeconds.toFixed(1)}s</strong>
                </div>
                <div>
                  <span>Composite quality</span>
                  <strong>{formatPercent(metricsAverage)}</strong>
                </div>
              </div>
            </div>

            <div className="solid-card">
              <SectionTitle
                eyebrow="Gate Review"
                title="Deployment blockers"
                subtitle="Any failed gate is surfaced directly so the recommendation is explainable."
              />
              {selectedResult.gateFailures.length > 0 ? (
                <ul className="finding-list">
                  {selectedResult.gateFailures.map((failure) => (
                    <li key={failure}>{failure}</li>
                  ))}
                </ul>
              ) : (
                <p className="empty-state">
                  No hard gate failures under the current thresholds.
                </p>
              )}
            </div>

            <div className="glass-card full-span">
              <SectionTitle
                eyebrow="Failure Explorer"
                title="Scenario-level evidence"
                subtitle="Each evaluation case shows its score, status, and the specific reason it was flagged."
              />
              <div className="results-table">
                <div className="results-table__header">
                  <span>Scenario</span>
                  <span>Status</span>
                  <span>Score</span>
                  <span>Findings</span>
                </div>
                {selectedResult.scenarioResults.map((scenario) => (
                  <div key={scenario.scenarioId} className="results-table__row">
                    <div>
                      <strong>{scenario.title}</strong>
                      <span>
                        {scenario.latencySeconds.toFixed(1)}s, {scenario.reviewMinutes.toFixed(1)}m review
                      </span>
                    </div>
                    <ScenarioBadge status={scenario.status} />
                    <strong>{scenario.score.toFixed(1)}</strong>
                    <p>
                      {scenario.findings.length > 0
                        ? scenario.findings[0]
                        : "No material issues triggered in this scenario."}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeSection === "economics" && (
          <section className="content-grid page-enter">
            <div className="glass-card">
              <SectionTitle
                eyebrow="Operating Assumptions"
                title="Business viability inputs"
                subtitle="These values estimate whether the capability is worth deploying once it is technically safe enough."
              />
              <div className="form-grid">
                <label className="field">
                  <span>Monthly document volume</span>
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
                  <span>Manual minutes per document</span>
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
                  <span>Reviewer hourly rate</span>
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
                  <span>Monthly maintenance cost</span>
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
                  <span>Implementation cost</span>
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
                  <span>Target payback (months)</span>
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
            </div>

            <div className="solid-card">
              <SectionTitle
                eyebrow="Business Case"
                title={`${selectedResult.config.name} economics`}
                subtitle="The business case should pass only if technical quality and economics align."
              />
              <div className="economics-stack">
                <div className="economic-line">
                  <span>Current monthly cost</span>
                  <strong>{currencyFormatter.format(selectedResult.monthlyCurrentCost)}</strong>
                </div>
                <div className="economic-line">
                  <span>AI monthly cost</span>
                  <strong>{currencyFormatter.format(selectedResult.monthlyAiCost)}</strong>
                </div>
                <div className="economic-line economic-line--highlight">
                  <span>Estimated monthly savings</span>
                  <strong>{currencyFormatter.format(selectedResult.monthlySavings)}</strong>
                </div>
                <div className="economic-line">
                  <span>Payback period</span>
                  <strong>
                    {Number.isFinite(selectedResult.paybackMonths)
                      ? `${selectedResult.paybackMonths.toFixed(1)} months`
                      : "No payback"}
                  </strong>
                </div>
              </div>
            </div>

            <div className="solid-card">
              <SectionTitle
                eyebrow="Recommendation"
                title="Should the capability proceed?"
                subtitle="Technical readiness alone is not enough if the deployment case does not make commercial sense."
              />
              <div className="decision-card">
                <span className={`signal signal--${decisionTone}`}>
                  {selectedResult.deploymentDecision}
                </span>
                <strong>
                  {selectedResult.monthlySavings > 0
                    ? "The current business case is positive."
                    : "The current business case is weak."}
                </strong>
                <p>
                  {selectedResult.monthlySavings > 0
                    ? `Projected savings cover the implementation cost in ${selectedResult.paybackMonths.toFixed(1)} months.`
                    : "Operational savings do not currently offset implementation and review costs."}
                </p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
