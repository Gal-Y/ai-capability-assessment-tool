import { useState } from "react";
import { defaultCapabilityForm } from "./data/mockData";
import type { RiskLevel } from "./types";

type ViewId = "home" | "new-evaluation" | "results";
type StepId = 1 | 2 | 3 | 4 | 5 | 6;
type Decision = "Ready" | "Conditional" | "Not Ready";
type Tone = "good" | "warn" | "bad";
type OutputSource = "platform-model" | "uploaded-outputs";

type UploadItem = {
  name: string;
  sizeLabel: string;
  typeLabel: string;
};

type EvaluationDraft = {
  capability: "Document summarisation";
  outputSource: OutputSource | null;
  documents: UploadItem[];
  referenceOutputs: UploadItem[];
  policyFiles: UploadItem[];
  aiOutputs: UploadItem[];
  audience: string;
  outputStyle: string;
  maxWords: number;
  riskLevel: RiskLevel;
  modelId: string;
  promptPreset: string;
  providedLatencySeconds: string;
  providedCostPerDocument: string;
};

type EvaluationRecord = {
  id: number;
  createdAt: string;
  capability: string;
  outputSource: OutputSource;
  documentCount: number;
  referenceCount: number;
  policyCount: number;
  outputCount: number;
  audience: string;
  outputStyle: string;
  maxWords: number;
  riskLevel: RiskLevel;
  modelId: string | null;
  promptPreset: string | null;
  readinessScore: number;
  decision: Decision;
  metrics: {
    faithfulness: number;
    coverage: number;
    compliance: number;
    privacy: number;
    latency: number | null;
  };
  costPerDocument: number | null;
  issues: string[];
  documents: UploadItem[];
  referenceOutputs: UploadItem[];
  policyFiles: UploadItem[];
  aiOutputs: UploadItem[];
};

const thresholds = defaultCapabilityForm.thresholds;

const modelProfiles: Record<
  string,
  { quality: number; latency: number; costPerDocument: number }
> = {
  "GPT-4.1 Mini": { quality: 1.2, latency: 2.4, costPerDocument: 0.014 },
  "GPT-4.1": { quality: 3.1, latency: 3.1, costPerDocument: 0.032 },
  "Claude 3.7 Sonnet": { quality: 2.7, latency: 3.6, costPerDocument: 0.029 },
};

const stepItems: Array<{ id: StepId; label: string }> = [
  { id: 1, label: "Capability" },
  { id: 2, label: "Output" },
  { id: 3, label: "Documents" },
  { id: 4, label: "Truth Pack" },
  { id: 5, label: "Configure" },
  { id: 6, label: "Review" },
];

const initialDraft = (): EvaluationDraft => ({
  capability: "Document summarisation",
  outputSource: null,
  documents: [],
  referenceOutputs: [],
  policyFiles: [],
  aiOutputs: [],
  audience: "",
  outputStyle: defaultCapabilityForm.summaryStyle,
  maxWords: defaultCapabilityForm.outputLength,
  riskLevel: defaultCapabilityForm.riskLevel,
  modelId: "GPT-4.1 Mini",
  promptPreset: "Balanced",
  providedLatencySeconds: "",
  providedCostPerDocument: "",
});

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const hashSeed = (value: string) =>
  value
    .split("")
    .reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 10007, 7);

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

const parseOptionalNumber = (value: string) => {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const formatPercent = (value: number) => `${value.toFixed(1)}%`;
const formatCurrency = (value: number | null) =>
  value === null ? "Not provided" : `$${value.toFixed(3)}`;
const formatLatency = (value: number | null) =>
  value === null ? "Not provided" : `${value.toFixed(1)}s`;

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
    draft.outputSource,
    draft.documents.map((document) => document.name).join("|"),
    draft.referenceOutputs.map((file) => file.name).join("|"),
    draft.policyFiles.map((file) => file.name).join("|"),
    draft.aiOutputs.map((file) => file.name).join("|"),
    draft.audience,
    draft.outputStyle,
    draft.maxWords,
    draft.riskLevel,
    draft.modelId,
    draft.promptPreset,
    evaluationIndex,
  ].join("-");

  const docBoost = Math.min(draft.documents.length * 2.4, 10);
  const referenceBoost = Math.min(draft.referenceOutputs.length * 3.1, 9.3);
  const policyBoost = Math.min(draft.policyFiles.length * 1.8, 4.5);
  const outputCoverageRatio =
    draft.outputSource === "uploaded-outputs"
      ? Math.min(1, draft.aiOutputs.length / Math.max(1, draft.documents.length))
      : 1;
  const riskPenalty =
    draft.riskLevel === "High" ? 4.6 : draft.riskLevel === "Medium" ? 2.1 : 0;
  const styleBoost =
    draft.outputStyle === "Board-ready briefing"
      ? 2.8
      : draft.outputStyle === "Executive brief"
        ? 2.4
        : draft.outputStyle === "Structured bullet summary"
          ? 2.1
          : 1.5;
  const audienceBoost = draft.audience.trim() ? 1.1 : 0;
  const modelProfile =
    draft.outputSource === "platform-model"
      ? modelProfiles[draft.modelId]
      : null;
  const promptBoost =
    draft.promptPreset === "Strict"
      ? 1.8
      : draft.promptPreset === "Evidence-led"
        ? 1.4
        : 0.8;

  const faithfulness = clamp(
    81 +
      docBoost * 0.45 +
      referenceBoost * 1.05 +
      policyBoost * 0.35 +
      (modelProfile?.quality ?? 1.6) +
      outputCoverageRatio * 2.6 -
      riskPenalty * 0.32 +
      jitter(seed, 1),
    70,
    99,
  );

  const coverage = clamp(
    79 +
      docBoost * 0.88 +
      referenceBoost * 0.52 +
      outputCoverageRatio * 6 -
      (draft.maxWords < 140 ? 4.2 : 0) +
      jitter(seed, 2),
    68,
    99,
  );

  const compliance = clamp(
    84 +
      styleBoost * 1.05 +
      policyBoost * 0.72 +
      promptBoost +
      audienceBoost -
      riskPenalty * 0.15 +
      jitter(seed, 3),
    70,
    99,
  );

  const privacy = clamp(
    87 +
      referenceBoost * 0.35 +
      policyBoost * 1.15 +
      (modelProfile?.quality ?? 1.6) * 0.4 -
      riskPenalty * 0.48 +
      jitter(seed, 4),
    75,
    99,
  );

  const providedLatency = parseOptionalNumber(draft.providedLatencySeconds);
  const latency =
    draft.outputSource === "platform-model"
      ? clamp(
          (modelProfile?.latency ?? 2.8) +
            draft.documents.length * 0.52 +
            draft.referenceOutputs.length * 0.12 +
            (draft.maxWords > 260 ? 0.4 : 0),
          1.8,
          8.2,
        )
      : providedLatency;

  const costPerDocument =
    draft.outputSource === "platform-model"
      ? Number(
          (
            (modelProfile?.costPerDocument ?? 0.02) *
            (1 + draft.documents.length * 0.06)
          ).toFixed(3),
        )
      : parseOptionalNumber(draft.providedCostPerDocument);

  const readinessScore =
    faithfulness * 0.31 +
    coverage * 0.25 +
    compliance * 0.2 +
    privacy * 0.19 +
    (latency === null ? 82 : Math.max(0, 100 - latency * 10)) * 0.05;

  const issues: string[] = [];

  if (faithfulness < thresholds.faithfulness) {
    issues.push("Strengthen alignment against the source of truth.");
  }
  if (coverage < thresholds.coverage) {
    issues.push("Increase document coverage or reduce output compression.");
  }
  if (compliance < thresholds.compliance) {
    issues.push("Tighten the output instructions and response format.");
  }
  if (privacy < thresholds.privacy) {
    issues.push("Add stronger handling for sensitive enterprise content.");
  }
  if (draft.referenceOutputs.length < 1) {
    issues.push("Upload at least one reference output.");
  }
  if (
    draft.outputSource === "uploaded-outputs" &&
    draft.aiOutputs.length !== draft.documents.length
  ) {
    issues.push("Match one uploaded AI output to each source document.");
  }
  if (latency !== null && latency > thresholds.maxLatencySeconds) {
    issues.push("Latency is above the current operational threshold.");
  }

  const qualityPass =
    faithfulness >= thresholds.faithfulness &&
    coverage >= thresholds.coverage &&
    compliance >= thresholds.compliance &&
    privacy >= thresholds.privacy;
  const latencyPass = latency === null || latency <= thresholds.maxLatencySeconds;

  let decision: Decision = "Not Ready";

  if (qualityPass && latencyPass) {
    decision = "Ready";
  } else if (issues.length <= 3 && privacy >= thresholds.privacy - 2) {
    decision = "Conditional";
  }

  return {
    id: evaluationIndex,
    createdAt: new Date().toISOString(),
    capability: draft.capability,
    outputSource: draft.outputSource ?? "platform-model",
    documentCount: draft.documents.length,
    referenceCount: draft.referenceOutputs.length,
    policyCount: draft.policyFiles.length,
    outputCount:
      draft.outputSource === "uploaded-outputs"
        ? draft.aiOutputs.length
        : draft.documents.length,
    audience: draft.audience,
    outputStyle: draft.outputStyle,
    maxWords: draft.maxWords,
    riskLevel: draft.riskLevel,
    modelId: draft.outputSource === "platform-model" ? draft.modelId : null,
    promptPreset:
      draft.outputSource === "platform-model" ? draft.promptPreset : null,
    readinessScore,
    decision,
    metrics: {
      faithfulness,
      coverage,
      compliance,
      privacy,
      latency,
    },
    costPerDocument,
    issues: issues.slice(0, 4),
    documents: draft.documents,
    referenceOutputs: draft.referenceOutputs,
    policyFiles: draft.policyFiles,
    aiOutputs: draft.aiOutputs,
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
      <strong>{formatPercent(value)}</strong>
    </div>
    <div className="metric-row__bar">
      <span
        className={`metric-row__fill ${
          value >= target ? "metric-row__fill--good" : "metric-row__fill--bad"
        }`}
        style={{ width: `${Math.min(100, value)}%` }}
      />
      <span className="metric-row__target" style={{ left: `${target}%` }} />
    </div>
  </div>
);

const FileListColumn = ({
  label,
  files,
}: {
  label: string;
  files: UploadItem[];
}) => (
  <div className="file-column">
    <span className="panel-label">{label}</span>
    {files.length > 0 ? (
      files.map((file) => (
        <div key={`${label}-${file.name}`} className="file-row">
          <span>{file.name}</span>
          <span>{file.sizeLabel}</span>
        </div>
      ))
    ) : (
      <div className="file-row file-row--empty">No files</div>
    )}
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
        ? draft.outputSource !== null
        : step === 3
          ? draft.documents.length > 0
          : step === 4
            ? draft.referenceOutputs.length > 0
            : step === 5
              ? draft.audience.trim().length > 0 &&
                draft.maxWords > 0 &&
                (draft.outputSource === "platform-model"
                  ? draft.modelId.trim().length > 0
                  : draft.aiOutputs.length > 0)
              : true;

  const updateDraft = <Key extends keyof EvaluationDraft>(
    key: Key,
    value: EvaluationDraft[Key],
  ) => {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const openNewEvaluation = () => {
    setDraft(initialDraft());
    setStep(1);
    setView("new-evaluation");
  };

  const goNext = () => {
    if (step < 6) {
      setStep((current) => (current + 1) as StepId);
    }
  };

  const goBack = () => {
    if (step > 1) {
      setStep((current) => (current - 1) as StepId);
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
          label="Capabilities available"
          value="1"
          meta="Document summarisation"
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
                <span className="detail-label">Output source</span>
                <strong>
                  {lastEvaluation.outputSource === "platform-model"
                    ? "Platform model"
                    : "Uploaded AI outputs"}
                </strong>
              </div>
              <div>
                <span className="detail-label">Documents</span>
                <strong>{lastEvaluation.documentCount}</strong>
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
                <span>Output</span>
                <span>Status</span>
                <span>Score</span>
              </div>
              {evaluations.slice(0, 5).map((evaluation) => (
                <div key={evaluation.id} className="table__row">
                  <span>{evaluation.capability}</span>
                  <span>
                    {evaluation.outputSource === "platform-model"
                      ? "Platform model"
                      : "Uploaded outputs"}
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

      <button className="choice-card choice-card--active" type="button">
        <div>
          <strong>Document summarisation</strong>
          <span>Available</span>
        </div>
        <span className="choice-card__dot" />
      </button>
    </article>
  );

  const renderOutputSourceStep = () => (
    <article className="panel flow-panel">
      <div className="panel-header">
        <span className="panel-title">Select output source</span>
      </div>

      <div className="option-grid">
        <button
          className={`choice-card ${
            draft.outputSource === "platform-model" ? "choice-card--active" : ""
          }`}
          onClick={() => updateDraft("outputSource", "platform-model")}
          type="button"
        >
          <div>
            <strong>Use platform model</strong>
            <span>Generate summaries in the app</span>
          </div>
          <span className="choice-card__dot" />
        </button>

        <button
          className={`choice-card ${
            draft.outputSource === "uploaded-outputs" ? "choice-card--active" : ""
          }`}
          onClick={() => updateDraft("outputSource", "uploaded-outputs")}
          type="button"
        >
          <div>
            <strong>Upload AI outputs</strong>
            <span>Evaluate summaries from an external system</span>
          </div>
          <span className="choice-card__dot" />
        </button>
      </div>
    </article>
  );

  const renderDocumentsStep = () => (
    <article className="panel flow-panel">
      <div className="panel-header">
        <span className="panel-title">Upload documents</span>
      </div>

      <label className="upload-card">
        <input
          hidden
          multiple
          type="file"
          onChange={(event) => updateDraft("documents", toUploadItems(event.target.files))}
        />
        <div>
          <span className="upload-card__label">Source documents</span>
          <strong>{draft.documents.length} files</strong>
        </div>
        <span className="upload-card__meta">PDF, DOCX, TXT, MD</span>
      </label>

      <div className="file-columns">
        <FileListColumn label="Documents" files={draft.documents} />
      </div>
    </article>
  );

  const renderTruthPackStep = () => (
    <article className="panel flow-panel">
      <div className="panel-header">
        <span className="panel-title">Upload source of truth</span>
      </div>

      <div className="option-grid">
        <label className="upload-card">
          <input
            hidden
            multiple
            type="file"
            onChange={(event) =>
              updateDraft("referenceOutputs", toUploadItems(event.target.files))
            }
          />
          <div>
            <span className="upload-card__label">Reference outputs</span>
            <strong>{draft.referenceOutputs.length} files</strong>
          </div>
          <span className="upload-card__meta">Required</span>
        </label>

        <label className="upload-card">
          <input
            hidden
            multiple
            type="file"
            onChange={(event) =>
              updateDraft("policyFiles", toUploadItems(event.target.files))
            }
          />
          <div>
            <span className="upload-card__label">Rules / policies</span>
            <strong>{draft.policyFiles.length} files</strong>
          </div>
          <span className="upload-card__meta">Optional</span>
        </label>
      </div>

      <div className="file-columns">
        <FileListColumn label="Reference outputs" files={draft.referenceOutputs} />
        <FileListColumn label="Rules / policies" files={draft.policyFiles} />
      </div>
    </article>
  );

  const renderConfigureStep = () => (
    <article className="panel flow-panel">
      <div className="panel-header">
        <span className="panel-title">Configure evaluation</span>
      </div>

      {draft.outputSource === "platform-model" ? (
        <div className="form-grid">
          <label className="field">
            <span>Model</span>
            <select
              value={draft.modelId}
              onChange={(event) => updateDraft("modelId", event.target.value)}
            >
              {Object.keys(modelProfiles).map((modelName) => (
                <option key={modelName}>{modelName}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Prompt preset</span>
            <select
              value={draft.promptPreset}
              onChange={(event) => updateDraft("promptPreset", event.target.value)}
            >
              <option>Balanced</option>
              <option>Evidence-led</option>
              <option>Strict</option>
            </select>
          </label>

          <label className="field field--wide">
            <span>Target audience</span>
            <input
              value={draft.audience}
              onChange={(event) => updateDraft("audience", event.target.value)}
            />
          </label>

          <label className="field">
            <span>Output style</span>
            <select
              value={draft.outputStyle}
              onChange={(event) => updateDraft("outputStyle", event.target.value)}
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
              onChange={(event) => updateDraft("maxWords", Number(event.target.value))}
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
                  onClick={() => updateDraft("riskLevel", level)}
                  type="button"
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="form-grid">
          <label className="upload-card upload-card--full">
            <input
              hidden
              multiple
              type="file"
              onChange={(event) =>
                updateDraft("aiOutputs", toUploadItems(event.target.files))
              }
            />
            <div>
              <span className="upload-card__label">Uploaded AI outputs</span>
              <strong>{draft.aiOutputs.length} files</strong>
            </div>
            <span className="upload-card__meta">One output per document</span>
          </label>

          <label className="field">
            <span>Average latency (optional)</span>
            <input
              placeholder="e.g. 3.2"
              value={draft.providedLatencySeconds}
              onChange={(event) =>
                updateDraft("providedLatencySeconds", event.target.value)
              }
            />
          </label>

          <label className="field">
            <span>Cost / document (optional)</span>
            <input
              placeholder="e.g. 0.021"
              value={draft.providedCostPerDocument}
              onChange={(event) =>
                updateDraft("providedCostPerDocument", event.target.value)
              }
            />
          </label>

          <label className="field field--wide">
            <span>Target audience</span>
            <input
              value={draft.audience}
              onChange={(event) => updateDraft("audience", event.target.value)}
            />
          </label>

          <label className="field">
            <span>Output style</span>
            <select
              value={draft.outputStyle}
              onChange={(event) => updateDraft("outputStyle", event.target.value)}
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
              onChange={(event) => updateDraft("maxWords", Number(event.target.value))}
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
                  onClick={() => updateDraft("riskLevel", level)}
                  type="button"
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
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
          <span className="panel-label">Output source</span>
          <strong>
            {draft.outputSource === "platform-model"
              ? "Platform model"
              : "Uploaded AI outputs"}
          </strong>
        </div>
        <div className="review-card">
          <span className="panel-label">Documents</span>
          <strong>{draft.documents.length}</strong>
        </div>
        <div className="review-card">
          <span className="panel-label">Reference outputs</span>
          <strong>{draft.referenceOutputs.length}</strong>
        </div>
        <div className="review-card">
          <span className="panel-label">Rules / policies</span>
          <strong>{draft.policyFiles.length}</strong>
        </div>
        <div className="review-card">
          <span className="panel-label">
            {draft.outputSource === "platform-model" ? "Model" : "AI outputs"}
          </span>
          <strong>
            {draft.outputSource === "platform-model"
              ? draft.modelId
              : `${draft.aiOutputs.length} files`}
          </strong>
        </div>
        <div className="review-card">
          <span className="panel-label">Output style</span>
          <strong>{draft.outputStyle}</strong>
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
      {step === 2 && renderOutputSourceStep()}
      {step === 3 && renderDocumentsStep()}
      {step === 4 && renderTruthPackStep()}
      {step === 5 && renderConfigureStep()}
      {step === 6 && renderReviewStep()}

      <section className="wizard-actions">
        <button
          className="ghost-button"
          disabled={step === 1}
          onClick={goBack}
          type="button"
        >
          Back
        </button>

        {step < 6 ? (
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
          <h1>Latest result</h1>
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
              label="Output source"
              value={
                lastEvaluation.outputSource === "platform-model"
                  ? "Platform model"
                  : "Uploaded outputs"
              }
              meta={
                lastEvaluation.outputSource === "platform-model"
                  ? lastEvaluation.modelId ?? "No model"
                  : `${lastEvaluation.outputCount} outputs`
              }
            />
            <SummaryCard
              label="Latency"
              value={formatLatency(lastEvaluation.metrics.latency)}
              meta={formatCurrency(lastEvaluation.costPerDocument)}
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

              {lastEvaluation.metrics.latency === null ? (
                <div className="issue-item issue-item--neutral">
                  Operational latency not provided.
                </div>
              ) : (
                <div className="metric-row metric-row--single">
                  <div className="metric-row__meta">
                    <span>Latency</span>
                    <strong>{formatLatency(lastEvaluation.metrics.latency)}</strong>
                  </div>
                </div>
              )}
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
                  <span className="detail-label">Output style</span>
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
                <span className="panel-title">Files</span>
              </div>
              <div className="file-columns">
                <FileListColumn label="Documents" files={lastEvaluation.documents} />
                <FileListColumn
                  label="Reference outputs"
                  files={lastEvaluation.referenceOutputs}
                />
                <FileListColumn label="Rules / policies" files={lastEvaluation.policyFiles} />
                {lastEvaluation.outputSource === "uploaded-outputs" ? (
                  <FileListColumn label="AI outputs" files={lastEvaluation.aiOutputs} />
                ) : null}
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
