import { useState } from "react";
import { defaultCapabilityForm } from "./data/mockData";
import type { RiskLevel } from "./types";

type ViewId = "home" | "new-evaluation" | "results";
type StepId = 1 | 2 | 3 | 4;
type Decision = "Ready" | "Conditional" | "Not Ready";
type Tone = "good" | "warn" | "bad";

type UploadItem = {
  name: string;
  sizeLabel: string;
  typeLabel: string;
};

type EvaluationDraft = {
  capability: "Document summarisation";
  documents: UploadItem[];
  sources: UploadItem[];
  audience: string;
  outputStyle: string;
  maxWords: number;
  riskLevel: RiskLevel;
};

type EvaluationRecord = {
  id: number;
  createdAt: string;
  capability: string;
  documentCount: number;
  sourceCount: number;
  audience: string;
  outputStyle: string;
  maxWords: number;
  riskLevel: RiskLevel;
  readinessScore: number;
  decision: Decision;
  metrics: {
    faithfulness: number;
    coverage: number;
    compliance: number;
    privacy: number;
    latency: number;
  };
  issues: string[];
  documents: UploadItem[];
  sources: UploadItem[];
};

const thresholds = defaultCapabilityForm.thresholds;

const stepItems: Array<{ id: StepId; label: string }> = [
  { id: 1, label: "Capability" },
  { id: 2, label: "Uploads" },
  { id: 3, label: "Setup" },
  { id: 4, label: "Review" },
];

const initialDraft = (): EvaluationDraft => ({
  capability: "Document summarisation",
  documents: [],
  sources: [],
  audience: "",
  outputStyle: defaultCapabilityForm.summaryStyle,
  maxWords: defaultCapabilityForm.outputLength,
  riskLevel: defaultCapabilityForm.riskLevel,
});

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const hashSeed = (value: string) =>
  value.split("").reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 10007, 7);

const jitter = (seed: string, salt: number) =>
  (((hashSeed(`${seed}-${salt}`) % 1000) / 1000) - 0.5) * 3;

const toSizeLabel = (size: number) =>
  size >= 1_000_000
    ? `${(size / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1000))} KB`;

const toUploadItems = (files: FileList | null): UploadItem[] =>
  files
    ? Array.from(files).map((file) => ({
        name: file.name,
        sizeLabel: toSizeLabel(file.size),
        typeLabel: file.type || "File",
      }))
    : [];

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

const getTone = (decision: Decision): Tone => {
  if (decision === "Ready") {
    return "good";
  }
  if (decision === "Conditional") {
    return "warn";
  }
  return "bad";
};

const simulateEvaluation = (
  draft: EvaluationDraft,
  evaluationIndex: number,
): EvaluationRecord => {
  const seed = [
    draft.capability,
    draft.documents.map((document) => document.name).join("|"),
    draft.sources.map((source) => source.name).join("|"),
    draft.audience,
    draft.outputStyle,
    draft.maxWords,
    draft.riskLevel,
    evaluationIndex,
  ].join("-");
  const docBoost = Math.min(draft.documents.length * 2.5, 10);
  const sourceBoost = Math.min(draft.sources.length * 3.2, 9.6);
  const riskPenalty =
    draft.riskLevel === "High" ? 4.4 : draft.riskLevel === "Medium" ? 2.2 : 0;
  const styleBoost =
    draft.outputStyle === "Board-ready briefing"
      ? 2.7
      : draft.outputStyle === "Executive brief"
        ? 2.4
        : draft.outputStyle === "Structured bullet summary"
          ? 2.1
          : 1.6;
  const audienceBoost = draft.audience.trim() ? 0.9 : 0;

  const faithfulness = clamp(
    83 + docBoost * 0.45 + sourceBoost * 1.05 - riskPenalty * 0.38 + jitter(seed, 1),
    70,
    99,
  );
  const coverage = clamp(
    81 +
      docBoost * 1.05 +
      sourceBoost * 0.42 -
      (draft.maxWords < 140 ? 4.5 : 0) +
      jitter(seed, 2),
    68,
    99,
  );
  const compliance = clamp(
    86 + styleBoost * 1.15 + audienceBoost - riskPenalty * 0.16 + jitter(seed, 3),
    70,
    99,
  );
  const privacy = clamp(
    89 + sourceBoost * 0.95 - riskPenalty * 0.58 + jitter(seed, 4),
    75,
    99,
  );
  const latency = clamp(
    1.8 +
      draft.documents.length * 0.55 +
      draft.sources.length * 0.2 +
      (draft.maxWords > 250 ? 0.35 : 0) +
      Math.max(0, draft.documents.length - 3) * 0.1,
    1.8,
    7.8,
  );
  const readinessScore =
    faithfulness * 0.3 +
    coverage * 0.25 +
    compliance * 0.2 +
    privacy * 0.2 +
    Math.max(0, 100 - latency * 10) * 0.05;

  const issues: string[] = [];

  if (faithfulness < thresholds.faithfulness) {
    issues.push("Add stronger source-of-truth references.");
  }
  if (coverage < thresholds.coverage) {
    issues.push("Increase document coverage or widen the batch.");
  }
  if (compliance < thresholds.compliance) {
    issues.push("Tighten the output format and summary instructions.");
  }
  if (privacy < thresholds.privacy) {
    issues.push("Improve protection against sensitive content leakage.");
  }
  if (latency > thresholds.maxLatencySeconds) {
    issues.push("Reduce batch size or shorten the output length.");
  }
  if (draft.documents.length < 2) {
    issues.push("Use more than one document for a stronger evaluation pack.");
  }
  if (draft.sources.length < 2) {
    issues.push("Upload at least two source-of-truth files if available.");
  }

  let decision: Decision = "Not Ready";

  if (
    faithfulness >= thresholds.faithfulness &&
    coverage >= thresholds.coverage &&
    compliance >= thresholds.compliance &&
    privacy >= thresholds.privacy &&
    latency <= thresholds.maxLatencySeconds
  ) {
    decision = "Ready";
  } else if (issues.length <= 3 && privacy >= thresholds.privacy - 2) {
    decision = "Conditional";
  }

  return {
    id: evaluationIndex,
    createdAt: new Date().toISOString(),
    capability: draft.capability,
    documentCount: draft.documents.length,
    sourceCount: draft.sources.length,
    audience: draft.audience,
    outputStyle: draft.outputStyle,
    maxWords: draft.maxWords,
    riskLevel: draft.riskLevel,
    readinessScore,
    decision,
    metrics: {
      faithfulness,
      coverage,
      compliance,
      privacy,
      latency,
    },
    issues: issues.slice(0, 4),
    documents: draft.documents,
    sources: draft.sources,
  };
};

const SummaryCard = ({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) => (
  <article className="panel stat-card">
    <span className="panel-label">{label}</span>
    <strong>{value}</strong>
    <span className="panel-meta">{meta}</span>
  </article>
);

const DecisionPill = ({
  label,
  tone,
}: {
  label: string;
  tone: Tone;
}) => <span className={`decision-pill decision-pill--${tone}`}>{label}</span>;

const MetricRail = ({
  label,
  value,
  target,
}: {
  label: string;
  value: number;
  target: number;
}) => (
  <div className="metric-row">
    <div className="metric-row__meta">
      <span>{label}</span>
      <strong>{label === "Latency" ? `${value.toFixed(1)}s` : formatPercent(value)}</strong>
    </div>
    <div className="metric-row__bar">
      <span
        className={`metric-row__fill ${
          label === "Latency"
            ? value <= target
              ? "metric-row__fill--good"
              : "metric-row__fill--bad"
            : value >= target
              ? "metric-row__fill--good"
              : "metric-row__fill--bad"
        }`}
        style={{
          width: `${
            label === "Latency"
              ? Math.min(100, (value / 8) * 100)
              : Math.min(100, value)
          }%`,
        }}
      />
      <span
        className="metric-row__target"
        style={{
          left: `${
            label === "Latency"
              ? Math.min(100, (target / 8) * 100)
              : Math.min(100, target)
          }%`,
        }}
      />
    </div>
  </div>
);

function App() {
  const [view, setView] = useState<ViewId>("home");
  const [step, setStep] = useState<StepId>(1);
  const [draft, setDraft] = useState<EvaluationDraft>(initialDraft);
  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([]);

  const lastEvaluation = evaluations[0];
  const evaluatedCapabilityCount = new Set(
    evaluations.map((evaluation) => evaluation.capability),
  ).size;

  const stepReady =
    step === 1
      ? Boolean(draft.capability)
      : step === 2
        ? draft.documents.length > 0 && draft.sources.length > 0
        : step === 3
          ? draft.audience.trim().length > 0 && draft.maxWords > 0
          : true;

  const openNewEvaluation = () => {
    setDraft(initialDraft());
    setStep(1);
    setView("new-evaluation");
  };

  const goNext = () => {
    if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      setStep(4);
    }
  };

  const goBack = () => {
    if (step === 4) {
      setStep(3);
    } else if (step === 3) {
      setStep(2);
    } else if (step === 2) {
      setStep(1);
    }
  };

  const runEvaluation = () => {
    const result = simulateEvaluation(draft, evaluations.length + 1);

    setEvaluations((current) => [result, ...current]);
    setView("results");
  };

  const renderHome = () => (
    <>
      <header className="screen-header">
        <div>
          <span className="screen-label">Dashboard</span>
          <h1>Home</h1>
        </div>
      </header>

      <section className="card-grid">
        <SummaryCard
          label="Total evaluations"
          value={String(evaluations.length)}
          meta="Runs completed"
        />
        <SummaryCard
          label="Capabilities evaluated"
          value={String(evaluatedCapabilityCount)}
          meta="Unique capabilities"
        />
        <SummaryCard
          label="Last evaluation"
          value={
            lastEvaluation
              ? new Intl.DateTimeFormat("en-AU", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(lastEvaluation.createdAt))
              : "None"
          }
          meta="Most recent run"
        />
        <SummaryCard
          label="Latest decision"
          value={lastEvaluation ? lastEvaluation.decision : "None"}
          meta={lastEvaluation ? `${lastEvaluation.readinessScore.toFixed(1)} score` : "No result yet"}
        />
      </section>

      <section className="content-grid">
        <article className="panel feature-panel">
          <div className="panel-header">
            <span className="panel-title">Last evaluation</span>
            {lastEvaluation ? (
              <DecisionPill
                label={lastEvaluation.decision}
                tone={getTone(lastEvaluation.decision)}
              />
            ) : null}
          </div>

          {lastEvaluation ? (
            <div className="detail-grid">
              <div>
                <span className="detail-label">Capability</span>
                <strong>{lastEvaluation.capability}</strong>
              </div>
              <div>
                <span className="detail-label">Documents</span>
                <strong>{lastEvaluation.documentCount}</strong>
              </div>
              <div>
                <span className="detail-label">Source of truth</span>
                <strong>{lastEvaluation.sourceCount}</strong>
              </div>
              <div>
                <span className="detail-label">Readiness</span>
                <strong>{lastEvaluation.readinessScore.toFixed(1)}</strong>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <strong>No evaluations yet</strong>
              <span>Start your first capability assessment.</span>
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-header">
            <span className="panel-title">Recent evaluations</span>
          </div>

          {evaluations.length > 0 ? (
            <div className="table">
              <div className="table__head">
                <span>Capability</span>
                <span>When</span>
                <span>Status</span>
                <span>Score</span>
              </div>
              {evaluations.slice(0, 5).map((evaluation) => (
                <div key={evaluation.id} className="table__row">
                  <span>{evaluation.capability}</span>
                  <span>
                    {new Intl.DateTimeFormat("en-AU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(evaluation.createdAt))}
                  </span>
                  <DecisionPill
                    label={evaluation.decision}
                    tone={getTone(evaluation.decision)}
                  />
                  <strong>{evaluation.readinessScore.toFixed(1)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state empty-state--small">
              <span>Nothing to show yet.</span>
            </div>
          )}
        </article>
      </section>
    </>
  );

  const renderCapabilityStep = () => (
    <article className="panel flow-panel">
      <div className="panel-header">
        <span className="panel-title">Select capability</span>
      </div>

      <button className="capability-card capability-card--active" type="button">
        <div>
          <strong>Document summarisation</strong>
          <span>Available</span>
        </div>
        <span className="capability-card__dot" />
      </button>
    </article>
  );

  const renderUploadStep = () => (
    <article className="panel flow-panel">
      <div className="panel-header">
        <span className="panel-title">Upload files</span>
      </div>

      <div className="upload-grid">
        <label className="upload-card">
          <input
            hidden
            multiple
            type="file"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                documents: toUploadItems(event.target.files),
              }))
            }
          />
          <span className="upload-card__label">Documents</span>
          <strong>{draft.documents.length || 0} files</strong>
          <span className="upload-card__meta">PDF, DOCX, TXT, MD</span>
        </label>

        <label className="upload-card">
          <input
            hidden
            multiple
            type="file"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                sources: toUploadItems(event.target.files),
              }))
            }
          />
          <span className="upload-card__label">Source of truth</span>
          <strong>{draft.sources.length || 0} files</strong>
          <span className="upload-card__meta">Reference summaries or gold outputs</span>
        </label>
      </div>

      <div className="file-columns">
        <div className="file-column">
          <span className="panel-label">Documents</span>
          {draft.documents.length > 0 ? (
            draft.documents.map((file) => (
              <div key={file.name} className="file-row">
                <span>{file.name}</span>
                <span>{file.sizeLabel}</span>
              </div>
            ))
          ) : (
            <div className="file-row file-row--empty">No files</div>
          )}
        </div>

        <div className="file-column">
          <span className="panel-label">Source of truth</span>
          {draft.sources.length > 0 ? (
            draft.sources.map((file) => (
              <div key={file.name} className="file-row">
                <span>{file.name}</span>
                <span>{file.sizeLabel}</span>
              </div>
            ))
          ) : (
            <div className="file-row file-row--empty">No files</div>
          )}
        </div>
      </div>
    </article>
  );

  const renderSetupStep = () => (
    <article className="panel flow-panel">
      <div className="panel-header">
        <span className="panel-title">Evaluation setup</span>
      </div>

      <div className="form-grid">
        <label className="field field--wide">
          <span>Target audience</span>
          <input
            value={draft.audience}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                audience: event.target.value,
              }))
            }
          />
        </label>

        <label className="field">
          <span>Output style</span>
          <select
            value={draft.outputStyle}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                outputStyle: event.target.value,
              }))
            }
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
            value={draft.maxWords}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                maxWords: Number(event.target.value),
              }))
            }
          />
        </label>

        <div className="field field--wide">
          <span>Risk level</span>
          <div className="chip-row">
            {(["Low", "Medium", "High"] as RiskLevel[]).map((level) => (
              <button
                key={level}
                className={`chip-button ${
                  draft.riskLevel === level ? "chip-button--active" : ""
                }`}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    riskLevel: level,
                  }))
                }
                type="button"
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>
    </article>
  );

  const renderReviewStep = () => (
    <article className="panel flow-panel">
      <div className="panel-header">
        <span className="panel-title">Review</span>
      </div>

      <div className="review-grid">
        <div className="review-card">
          <span className="panel-label">Capability</span>
          <strong>{draft.capability}</strong>
        </div>
        <div className="review-card">
          <span className="panel-label">Documents</span>
          <strong>{draft.documents.length}</strong>
        </div>
        <div className="review-card">
          <span className="panel-label">Source of truth</span>
          <strong>{draft.sources.length}</strong>
        </div>
        <div className="review-card">
          <span className="panel-label">Output</span>
          <strong>{draft.outputStyle}</strong>
        </div>
        <div className="review-card">
          <span className="panel-label">Max words</span>
          <strong>{draft.maxWords}</strong>
        </div>
        <div className="review-card">
          <span className="panel-label">Risk</span>
          <strong>{draft.riskLevel}</strong>
        </div>
      </div>
    </article>
  );

  const renderNewEvaluation = () => (
    <>
      <header className="screen-header">
        <div>
          <span className="screen-label">Evaluation</span>
          <h1>Start evaluation</h1>
        </div>
      </header>

      <section className="stepper">
        {stepItems.map((item) => (
          <div
            key={item.id}
            className={`stepper-item ${
              item.id === step
                ? "stepper-item--active"
                : item.id < step
                  ? "stepper-item--done"
                  : ""
            }`}
          >
            <span>{item.id}</span>
            <strong>{item.label}</strong>
          </div>
        ))}
      </section>

      {step === 1 && renderCapabilityStep()}
      {step === 2 && renderUploadStep()}
      {step === 3 && renderSetupStep()}
      {step === 4 && renderReviewStep()}

      <section className="wizard-actions">
        <button
          className="ghost-button"
          disabled={step === 1}
          onClick={goBack}
          type="button"
        >
          Back
        </button>

        {step < 4 ? (
          <button
            className="primary-button"
            disabled={!stepReady}
            onClick={goNext}
            type="button"
          >
            Next
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={!stepReady}
            onClick={runEvaluation}
            type="button"
          >
            Run evaluation
          </button>
        )}
      </section>
    </>
  );

  const renderResults = () => (
    <>
      <header className="screen-header">
        <div>
          <span className="screen-label">Results</span>
          <h1>Last result</h1>
        </div>
        <button className="primary-button" onClick={openNewEvaluation} type="button">
          New evaluation
        </button>
      </header>

      {lastEvaluation ? (
        <>
          <section className="card-grid">
            <SummaryCard
              label="Decision"
              value={lastEvaluation.decision}
              meta="Overall outcome"
            />
            <SummaryCard
              label="Readiness"
              value={lastEvaluation.readinessScore.toFixed(1)}
              meta="Composite score"
            />
            <SummaryCard
              label="Documents"
              value={String(lastEvaluation.documentCount)}
              meta="Files in batch"
            />
            <SummaryCard
              label="Source of truth"
              value={String(lastEvaluation.sourceCount)}
              meta="Reference files"
            />
          </section>

          <section className="content-grid">
            <article className="panel">
              <div className="panel-header">
                <span className="panel-title">Metrics</span>
                <DecisionPill
                  label={lastEvaluation.decision}
                  tone={getTone(lastEvaluation.decision)}
                />
              </div>

              <MetricRail
                label="Faithfulness"
                value={lastEvaluation.metrics.faithfulness}
                target={thresholds.faithfulness}
              />
              <MetricRail
                label="Coverage"
                value={lastEvaluation.metrics.coverage}
                target={thresholds.coverage}
              />
              <MetricRail
                label="Compliance"
                value={lastEvaluation.metrics.compliance}
                target={thresholds.compliance}
              />
              <MetricRail
                label="Privacy"
                value={lastEvaluation.metrics.privacy}
                target={thresholds.privacy}
              />
              <MetricRail
                label="Latency"
                value={lastEvaluation.metrics.latency}
                target={thresholds.maxLatencySeconds}
              />
            </article>

            <article className="panel">
              <div className="panel-header">
                <span className="panel-title">Issues</span>
              </div>

              {lastEvaluation.issues.length > 0 ? (
                <div className="issue-list">
                  {lastEvaluation.issues.map((issue) => (
                    <div key={issue} className="issue-item">
                      {issue}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state empty-state--small">
                  <span>No blocking issues.</span>
                </div>
              )}
            </article>
          </section>

          <section className="content-grid">
            <article className="panel">
              <div className="panel-header">
                <span className="panel-title">Setup</span>
              </div>
              <div className="detail-grid">
                <div>
                  <span className="detail-label">Audience</span>
                  <strong>{lastEvaluation.audience}</strong>
                </div>
                <div>
                  <span className="detail-label">Output</span>
                  <strong>{lastEvaluation.outputStyle}</strong>
                </div>
                <div>
                  <span className="detail-label">Max words</span>
                  <strong>{lastEvaluation.maxWords}</strong>
                </div>
                <div>
                  <span className="detail-label">Risk</span>
                  <strong>{lastEvaluation.riskLevel}</strong>
                </div>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <span className="panel-title">Uploaded files</span>
              </div>
              <div className="file-columns">
                <div className="file-column">
                  <span className="panel-label">Documents</span>
                  {lastEvaluation.documents.map((file) => (
                    <div key={file.name} className="file-row">
                      <span>{file.name}</span>
                      <span>{file.sizeLabel}</span>
                    </div>
                  ))}
                </div>
                <div className="file-column">
                  <span className="panel-label">Source of truth</span>
                  {lastEvaluation.sources.map((file) => (
                    <div key={file.name} className="file-row">
                      <span>{file.name}</span>
                      <span>{file.sizeLabel}</span>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </section>
        </>
      ) : (
        <article className="panel feature-panel">
          <div className="empty-state">
            <strong>No result yet</strong>
            <span>Run an evaluation to see results here.</span>
          </div>
        </article>
      )}
    </>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <span className="brand-label">Thesis MVP</span>
            <strong>AI Capability Tool</strong>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`sidebar-link ${view === "home" ? "sidebar-link--active" : ""}`}
            onClick={() => setView("home")}
            type="button"
          >
            Home
          </button>
          <button
            className={`sidebar-link ${
              view === "results" ? "sidebar-link--active" : ""
            }`}
            onClick={() => setView("results")}
            type="button"
          >
            Results
          </button>
        </nav>

        <button className="sidebar-primary" onClick={openNewEvaluation} type="button">
          Start evaluation
        </button>

        <div className="sidebar-panel">
          <span className="panel-label">Available capability</span>
          <strong>Document summarisation</strong>
        </div>
      </aside>

      <main className="workspace">
        {view === "home" && renderHome()}
        {view === "new-evaluation" && renderNewEvaluation()}
        {view === "results" && renderResults()}
      </main>
    </div>
  );
}

export default App;
