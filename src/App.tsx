import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { defaultCapabilityForm } from "./data/mockData";
import {
  getEvaluation,
  listEvaluations,
  startEvaluation,
  uploadLocalFiles,
  type RemoteEvaluation,
  type RemoteFileRef,
  type UploadedFileResult,
} from "./lib/api";
import type { RiskLevel } from "./types";

type ViewId = "home" | "new-evaluation" | "results";
type StepId = 1 | 2 | 3 | 4 | 5 | 6;
type Decision = "Ready" | "Conditional" | "Not Ready";
type EvaluationStatus = "RUNNING" | "COMPLETED" | "FAILED";
type Tone = "good" | "warn" | "bad" | "neutral";
type OutputSource = "platform-model" | "uploaded-outputs";
type UploadFieldKey = "documents" | "referenceOutputs" | "policyFiles" | "aiOutputs";

type UploadItem = {
  name: string;
  sizeLabel: string;
  typeLabel: string;
  key?: string;
  file?: File;
};

type EvaluationDraft = {
  capability: "Document summarisation";
  outputSource: OutputSource | null;
  documents: UploadItem[];
  referenceOutputs: UploadItem[];
  policyFiles: UploadItem[];
  aiOutputs: UploadItem[];
  requiredSections: string[];
  excludedContent: string[];
  policyText: string;
  redactSensitiveContent: boolean;
  audience: string;
  outputStyle: string;
  maxWords: string;
  riskLevel: RiskLevel;
  modelId: string;
  promptPreset: string;
  providedLatencySeconds: string;
  providedCostPerDocument: string;
};

type EvaluationRecord = {
  id: string;
  createdAt: string;
  status: EvaluationStatus;
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
  readinessScore: number | null;
  decision: Decision | null;
  metrics: {
    faithfulness: number | null;
    coverage: number | null;
    compliance: number | null;
    privacy: number | null;
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

const requiredSectionOptions = [
  "Key points",
  "Risks",
  "Actions",
  "Deadlines",
  "Decisions",
  "Escalations",
];

const excludedContentOptions = [
  "PII",
  "Employee names",
  "Account IDs",
  "Legal advice",
  "Speculation",
  "Confidential annexes",
];

const stepItems: Array<{ id: StepId; label: string }> = [
  { id: 1, label: "Capability" },
  { id: 2, label: "Output" },
  { id: 3, label: "Documents" },
  { id: 4, label: "Truth & Rules" },
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
  requiredSections: defaultCapabilityForm.requiredSections,
  excludedContent: defaultCapabilityForm.excludedContent.split(",").map((item) => item.trim()),
  policyText: "",
  redactSensitiveContent: true,
  audience: "",
  outputStyle: defaultCapabilityForm.summaryStyle,
  maxWords: String(defaultCapabilityForm.outputLength),
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
        file,
        name: file.name,
        sizeLabel: toSizeLabel(file.size),
        typeLabel: file.type || "File",
      }))
    : [];

const uploadItemKey = (file: UploadItem) =>
  file.key ?? `${file.name}-${file.sizeLabel}-${file.typeLabel}`;

const mergeUploadItems = (current: UploadItem[], next: UploadItem[]) => {
  const items = new Map(current.map((item) => [uploadItemKey(item), item]));

  next.forEach((item) => {
    items.set(uploadItemKey(item), item);
  });

  return Array.from(items.values());
};

const toggleSelection = (current: string[], value: string) =>
  current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];

const parseOptionalNumber = (value: string) => {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseWordLimit = (value: string) => {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toTitleCase = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const getTypeLabelFromName = (name: string) => {
  const extension = name.split(".").pop()?.trim();

  return extension ? extension.toUpperCase() : "Uploaded";
};

const mapRemoteFile = (file: RemoteFileRef): UploadItem => ({
  key: file.key,
  name: file.name,
  sizeLabel: "Uploaded",
  typeLabel: getTypeLabelFromName(file.name),
});

const normalizeCapability = (capability: string) =>
  capability === "document_summarisation"
    ? "Document summarisation"
    : toTitleCase(capability);

const toEvaluationStatus = (status: string): EvaluationStatus =>
  status === "COMPLETED" || status === "FAILED" ? status : "RUNNING";

const sortEvaluations = (items: EvaluationRecord[]) =>
  [...items].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );

const upsertEvaluation = (
  current: EvaluationRecord[],
  next: EvaluationRecord,
): EvaluationRecord[] => sortEvaluations([next, ...current.filter((item) => item.id !== next.id)]);

const mapRemoteEvaluation = (evaluation: RemoteEvaluation): EvaluationRecord => ({
  id: evaluation.evaluationId,
  createdAt: evaluation.createdAt,
  status: toEvaluationStatus(evaluation.status),
  capability: normalizeCapability(evaluation.capability),
  outputSource: evaluation.outputSource,
  documentCount: evaluation.documentCount ?? evaluation.documents.length,
  referenceCount: evaluation.referenceCount ?? evaluation.referenceOutputs.length,
  policyCount: evaluation.policyCount ?? evaluation.policyFiles.length,
  outputCount:
    evaluation.outputCount ??
    (evaluation.outputSource === "uploaded-outputs"
      ? evaluation.aiOutputs.length
      : evaluation.documents.length),
  audience: evaluation.config?.audience ?? "",
  outputStyle: evaluation.config?.outputStyle ?? "Executive brief",
  maxWords: evaluation.config?.maxWords ?? defaultCapabilityForm.outputLength,
  riskLevel: (evaluation.config?.riskLevel as RiskLevel | undefined) ?? "High",
  modelId:
    evaluation.outputSource === "platform-model"
      ? evaluation.config?.modelId ?? "GPT-4.1 Mini"
      : null,
  promptPreset:
    evaluation.outputSource === "platform-model"
      ? evaluation.config?.promptPreset ?? "Balanced"
      : null,
  readinessScore: evaluation.result?.readinessScore ?? null,
  decision: evaluation.result?.decision ?? null,
  metrics: {
    faithfulness: evaluation.result?.metrics.faithfulness ?? null,
    coverage: evaluation.result?.metrics.coverage ?? null,
    compliance: evaluation.result?.metrics.compliance ?? null,
    privacy: evaluation.result?.metrics.privacy ?? null,
    latency: evaluation.result?.metrics.latency ?? null,
  },
  costPerDocument: evaluation.result?.costPerDocument ?? null,
  issues: evaluation.result?.issues ?? [],
  documents: evaluation.documents.map(mapRemoteFile),
  referenceOutputs: evaluation.referenceOutputs.map(mapRemoteFile),
  policyFiles: evaluation.policyFiles.map(mapRemoteFile),
  aiOutputs: evaluation.aiOutputs.map(mapRemoteFile),
});

const formatPercent = (value: number) => `${value.toFixed(1)}%`;
const formatCurrency = (value: number | null) =>
  value === null ? "Not provided" : `$${value.toFixed(3)}`;
const formatLatency = (value: number | null) =>
  value === null ? "Not provided" : `${value.toFixed(1)}s`;

const getTone = (decision: Decision | null, status: EvaluationStatus): Tone => {
  if (status !== "COMPLETED" || decision === null) {
    return "neutral";
  }
  if (decision === "Ready") {
    return "good";
  }
  if (decision === "Conditional") {
    return "warn";
  }

  return "bad";
};

const getDecisionLabel = (evaluation: EvaluationRecord) =>
  evaluation.status === "COMPLETED"
    ? evaluation.decision ?? "Completed"
    : evaluation.status === "FAILED"
      ? "Failed"
      : "Running";

const createPendingEvaluation = (
  evaluationId: string,
  draft: EvaluationDraft,
  uploadedFiles: UploadedFileResult[],
): EvaluationRecord => {
  const groupedFiles = {
    documents: uploadedFiles
      .filter((file) => file.category === "documents")
      .map((file) => ({ key: file.key, name: file.name })),
    referenceOutputs: uploadedFiles
      .filter((file) => file.category === "referenceOutputs")
      .map((file) => ({ key: file.key, name: file.name })),
    policyFiles: uploadedFiles
      .filter((file) => file.category === "policyFiles")
      .map((file) => ({ key: file.key, name: file.name })),
    aiOutputs: uploadedFiles
      .filter((file) => file.category === "aiOutputs")
      .map((file) => ({ key: file.key, name: file.name })),
  };

  return {
    id: evaluationId,
    createdAt: new Date().toISOString(),
    status: "RUNNING",
    capability: draft.capability,
    outputSource: draft.outputSource ?? "platform-model",
    documentCount: groupedFiles.documents.length,
    referenceCount: groupedFiles.referenceOutputs.length,
    policyCount: groupedFiles.policyFiles.length,
    outputCount:
      draft.outputSource === "uploaded-outputs"
        ? groupedFiles.aiOutputs.length
        : groupedFiles.documents.length,
    audience: draft.audience,
    outputStyle: draft.outputStyle,
    maxWords: parseWordLimit(draft.maxWords) ?? defaultCapabilityForm.outputLength,
    riskLevel: draft.riskLevel,
    modelId: draft.outputSource === "platform-model" ? draft.modelId : null,
    promptPreset: draft.outputSource === "platform-model" ? draft.promptPreset : null,
    readinessScore: null,
    decision: null,
    metrics: {
      faithfulness: null,
      coverage: null,
      compliance: null,
      privacy: null,
      latency: null,
    },
    costPerDocument: null,
    issues: [],
    documents: groupedFiles.documents.map(mapRemoteFile),
    referenceOutputs: groupedFiles.referenceOutputs.map(mapRemoteFile),
    policyFiles: groupedFiles.policyFiles.map(mapRemoteFile),
    aiOutputs: groupedFiles.aiOutputs.map(mapRemoteFile),
  };
};

const simulateEvaluation = (
  draft: EvaluationDraft,
  evaluationIndex: number,
): EvaluationRecord => {
  const maxWords = parseWordLimit(draft.maxWords) ?? defaultCapabilityForm.outputLength;
  const seed = [
    draft.capability,
    draft.outputSource,
    draft.documents.map((document) => document.name).join("|"),
    draft.referenceOutputs.map((file) => file.name).join("|"),
    draft.policyFiles.map((file) => file.name).join("|"),
    draft.aiOutputs.map((file) => file.name).join("|"),
    draft.requiredSections.join("|"),
    draft.excludedContent.join("|"),
    draft.redactSensitiveContent ? "redact" : "allow",
    draft.policyText,
    draft.audience,
    draft.outputStyle,
    maxWords,
    draft.riskLevel,
    draft.modelId,
    draft.promptPreset,
    evaluationIndex,
  ].join("-");

  const docBoost = Math.min(draft.documents.length * 2.4, 10);
  const referenceBoost = Math.min(draft.referenceOutputs.length * 3.1, 9.3);
  const policyBoost = Math.min(draft.policyFiles.length * 1.8, 4.5);
  const sectionBoost = Math.min(draft.requiredSections.length * 0.7, 4.2);
  const excludedBoost = Math.min(draft.excludedContent.length * 0.55, 3.4);
  const policyTextBoost = draft.policyText.trim() ? 1.4 : 0;
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
      sectionBoost * 0.25 +
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
      sectionBoost * 0.58 +
      outputCoverageRatio * 6 -
      (maxWords < 140 ? 4.2 : 0) +
      jitter(seed, 2),
    68,
    99,
  );

  const compliance = clamp(
    84 +
      styleBoost * 1.05 +
      policyBoost * 0.72 +
      sectionBoost * 0.82 +
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
      excludedBoost +
      policyTextBoost +
      (draft.redactSensitiveContent ? 1.25 : -1.8) +
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
            (maxWords > 260 ? 0.4 : 0),
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
  if (!draft.redactSensitiveContent) {
    issues.push("Enable sensitive-content redaction before deployment.");
  }
  if (draft.referenceOutputs.length < 1) {
    issues.push("Upload at least one reference output.");
  }
  if (draft.requiredSections.length < 2) {
    issues.push("Define at least two required sections for the summary.");
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
    id: String(evaluationIndex),
    createdAt: new Date().toISOString(),
    status: "COMPLETED",
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
    maxWords,
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
        <div key={`${label}-${uploadItemKey(file)}`} className="file-row">
          <span>{file.name}</span>
          <span>{file.sizeLabel}</span>
        </div>
      ))
    ) : (
      <div className="file-row file-row--empty">No files</div>
    )}
  </div>
);

const UploadDropzone = ({
  title,
  hint,
  acceptLabel,
  files,
  compact = false,
  showEmptyList = false,
  loadedLabel = "loaded",
  onAppend,
  onRemove,
  onClear,
}: {
  title: string;
  hint: string;
  acceptLabel: string;
  files: UploadItem[];
  compact?: boolean;
  showEmptyList?: boolean;
  loadedLabel?: string;
  onAppend: (files: FileList | null) => void;
  onRemove: (file: UploadItem) => void;
  onClear: () => void;
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const openPicker = () => {
    inputRef.current?.click();
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onAppend(event.target.files);
    event.target.value = "";
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (event.currentTarget === event.target) {
      setIsDragActive(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    onAppend(event.dataTransfer.files);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  };

  return (
    <section className="upload-dropzone-stack">
      <div
        className={`upload-dropzone ${compact ? "upload-dropzone--compact" : ""} ${
          isDragActive ? "upload-dropzone--drag" : files.length > 0 ? "upload-dropzone--filled" : ""
        }`}
        onClick={openPicker}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        <input hidden multiple onChange={handleChange} ref={inputRef} type="file" />

        <div className="upload-dropzone__icon">{files.length > 0 ? files.length : "+"}</div>

        <div className="upload-dropzone__body">
          <span className="panel-label">{title}</span>
          <strong>
            {isDragActive
              ? "Drop files here"
              : files.length > 0
                ? `${files.length} file${files.length === 1 ? "" : "s"} selected`
                : hint}
          </strong>
          <span>{acceptLabel}</span>
        </div>

        <div className="upload-dropzone__actions">
          <span className="upload-dropzone__chip">
            {files.length > 0 ? "Add more" : "Browse"}
          </span>
        </div>
      </div>

      {files.length > 0 || showEmptyList ? (
        <div className="upload-files">
          <div className="upload-files__head">
            <span>{files.length > 0 ? `${files.length} ${loadedLabel}` : "Awaiting files"}</span>
            {files.length > 0 ? (
              <button
                className="ghost-button upload-file-row__remove"
                onClick={(event) => {
                  event.stopPropagation();
                  onClear();
                }}
                type="button"
              >
                Clear all
              </button>
            ) : null}
          </div>

          {files.length > 0 ? (
            files.map((file) => (
              <div className="upload-file-row" key={`${title}-${uploadItemKey(file)}`}>
                <div className="upload-file-row__body">
                  <strong>{file.name}</strong>
                  <span>
                    {file.typeLabel} · {file.sizeLabel}
                  </span>
                </div>
                <button
                  className="ghost-button upload-file-row__remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(file);
                  }}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))
          ) : (
            <div className="upload-empty-row">No files added</div>
          )}
        </div>
      ) : null}
    </section>
  );
};

function App() {
  const [view, setView] = useState<ViewId>("home");
  const [step, setStep] = useState<StepId>(1);
  const [draft, setDraft] = useState<EvaluationDraft>(initialDraft);
  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([]);
  const [selectedEvaluationId, setSelectedEvaluationId] = useState<string | null>(null);
  const [isLoadingEvaluations, setIsLoadingEvaluations] = useState(true);
  const [isSubmittingEvaluation, setIsSubmittingEvaluation] = useState(false);
  const [pollingEvaluationId, setPollingEvaluationId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const selectedEvaluation =
    evaluations.find((evaluation) => evaluation.id === selectedEvaluationId) ?? null;
  const lastEvaluation = selectedEvaluation ?? evaluations[0] ?? null;
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
                (parseWordLimit(draft.maxWords) ?? 0) > 0 &&
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

  const appendDraftFiles = (key: UploadFieldKey, files: FileList | null) => {
    const nextFiles = toUploadItems(files);

    if (nextFiles.length === 0) {
      return;
    }

    setDraft((current) => ({
      ...current,
      [key]: mergeUploadItems(current[key], nextFiles),
    }));
  };

  const removeDraftFile = (key: UploadFieldKey, file: UploadItem) => {
    setDraft((current) => ({
      ...current,
      [key]: current[key].filter((item) => uploadItemKey(item) !== uploadItemKey(file)),
    }));
  };

  const clearDraftFiles = (key: UploadFieldKey) => {
    setDraft((current) => ({
      ...current,
      [key]: [],
    }));
  };

  const toggleDraftSelection = (
    key: "requiredSections" | "excludedContent",
    value: string,
  ) => {
    setDraft((current) => ({
      ...current,
      [key]: toggleSelection(current[key], value),
    }));
  };

  const openNewEvaluation = () => {
    setDraft(initialDraft());
    setStep(1);
    setStatusMessage(null);
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

  useEffect(() => {
    let isMounted = true;

    const loadEvaluations = async () => {
      try {
        const response = await listEvaluations();

        if (!isMounted) {
          return;
        }

        const nextEvaluations = sortEvaluations(
          response.evaluations.map(mapRemoteEvaluation),
        );

        setEvaluations(nextEvaluations);
        setSelectedEvaluationId((current) => current ?? nextEvaluations[0]?.id ?? null);
      } catch (error) {
        if (isMounted) {
          setStatusMessage(
            error instanceof Error
              ? error.message
              : "Unable to load evaluations from AWS.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingEvaluations(false);
        }
      }
    };

    void loadEvaluations();

    return () => {
      isMounted = false;
    };
  }, []);

  const pollEvaluation = async (evaluationId: string) => {
    setPollingEvaluationId(evaluationId);

    try {
      const response = await getEvaluation(evaluationId);
      const nextEvaluation = mapRemoteEvaluation(response.evaluation);

      setEvaluations((current) => upsertEvaluation(current, nextEvaluation));
      setSelectedEvaluationId(evaluationId);
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to refresh the evaluation status.",
      );
    } finally {
      setPollingEvaluationId((current) =>
        current === evaluationId ? null : current,
      );
    }
  };

  useEffect(() => {
    if (!lastEvaluation || lastEvaluation.status !== "RUNNING") {
      return;
    }

    if (pollingEvaluationId === lastEvaluation.id) {
      return;
    }

    const timer = window.setTimeout(() => {
      void pollEvaluation(lastEvaluation.id);
    }, 2400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [lastEvaluation, pollingEvaluationId]);

  const runEvaluation = async () => {
    if (draft.outputSource === null) {
      return;
    }

    setIsSubmittingEvaluation(true);
    setStatusMessage(null);
    setView("results");

    try {
      const uploadSources = [
        ...draft.documents
          .filter((item): item is UploadItem & { file: File } => Boolean(item.file))
          .map((item) => ({ category: "documents" as const, file: item.file })),
        ...draft.referenceOutputs
          .filter((item): item is UploadItem & { file: File } => Boolean(item.file))
          .map((item) => ({ category: "referenceOutputs" as const, file: item.file })),
        ...draft.policyFiles
          .filter((item): item is UploadItem & { file: File } => Boolean(item.file))
          .map((item) => ({ category: "policyFiles" as const, file: item.file })),
        ...draft.aiOutputs
          .filter((item): item is UploadItem & { file: File } => Boolean(item.file))
          .map((item) => ({ category: "aiOutputs" as const, file: item.file })),
      ];

      const uploadResponse = await uploadLocalFiles(uploadSources);
      const groupedFiles = {
        documents: uploadResponse.uploadedFiles
          .filter((file) => file.category === "documents")
          .map((file) => ({ name: file.name, key: file.key })),
        referenceOutputs: uploadResponse.uploadedFiles
          .filter((file) => file.category === "referenceOutputs")
          .map((file) => ({ name: file.name, key: file.key })),
        policyFiles: uploadResponse.uploadedFiles
          .filter((file) => file.category === "policyFiles")
          .map((file) => ({ name: file.name, key: file.key })),
        aiOutputs: uploadResponse.uploadedFiles
          .filter((file) => file.category === "aiOutputs")
          .map((file) => ({ name: file.name, key: file.key })),
      };

      const evaluationResponse = await startEvaluation({
        capability: "document_summarisation",
        outputSource: draft.outputSource,
        documents: groupedFiles.documents,
        referenceOutputs: groupedFiles.referenceOutputs,
        policyFiles: groupedFiles.policyFiles,
        aiOutputs: groupedFiles.aiOutputs,
        config: {
          audience: draft.audience,
          outputStyle: draft.outputStyle,
          maxWords: parseWordLimit(draft.maxWords) ?? defaultCapabilityForm.outputLength,
          riskLevel: draft.riskLevel,
          requiredSections: draft.requiredSections,
          excludedContent: draft.excludedContent,
          redactSensitiveContent: draft.redactSensitiveContent,
          policyText: draft.policyText.trim(),
          modelId: draft.outputSource === "platform-model" ? draft.modelId : undefined,
          promptPreset:
            draft.outputSource === "platform-model" ? draft.promptPreset : undefined,
          providedLatencySeconds:
            draft.outputSource === "uploaded-outputs"
              ? draft.providedLatencySeconds.trim() || undefined
              : undefined,
          providedCostPerDocument:
            draft.outputSource === "uploaded-outputs"
              ? draft.providedCostPerDocument.trim() || undefined
              : undefined,
        },
      });

      const pendingEvaluation = createPendingEvaluation(
        evaluationResponse.evaluationId,
        draft,
        uploadResponse.uploadedFiles,
      );

      setEvaluations((current) => upsertEvaluation(current, pendingEvaluation));
      setSelectedEvaluationId(evaluationResponse.evaluationId);
      setStatusMessage("Evaluation started. Results will appear when the workflow completes.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to start the evaluation.",
      );
    } finally {
      setIsSubmittingEvaluation(false);
    }
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
              : isLoadingEvaluations
                ? "Loading"
                : "None"
          }
          meta="Most recent run"
        />
      </section>

      {statusMessage ? <div className="status-banner">{statusMessage}</div> : null}

      <section className="content-grid">
        <article className="panel feature-panel">
          <div className="panel-header">
            <span className="panel-title">Last evaluation</span>
            {lastEvaluation ? (
              <DecisionPill
                label={getDecisionLabel(lastEvaluation)}
                tone={getTone(lastEvaluation.decision, lastEvaluation.status)}
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
                <strong>
                  {lastEvaluation.readinessScore === null
                    ? getDecisionLabel(lastEvaluation)
                    : lastEvaluation.readinessScore.toFixed(1)}
                </strong>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <strong>{isLoadingEvaluations ? "Loading evaluations" : "No evaluations yet"}</strong>
              <span>
                {isLoadingEvaluations
                  ? "Pulling deployed runs from AWS."
                  : "Start your first capability assessment."}
              </span>
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
                    label={getDecisionLabel(evaluation)}
                    tone={getTone(evaluation.decision, evaluation.status)}
                  />
                  <strong>
                    {evaluation.readinessScore === null
                      ? "Pending"
                      : evaluation.readinessScore.toFixed(1)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state empty-state--small">
              <span>{isLoadingEvaluations ? "Loading runs..." : "Nothing to show yet."}</span>
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

      <div className="upload-layout">
        <UploadDropzone
          acceptLabel="PDF, DOCX, TXT, MD"
          files={draft.documents}
          hint="Drag & drop source documents"
          loadedLabel="documents loaded"
          onAppend={(files) => appendDraftFiles("documents", files)}
          onClear={() => clearDraftFiles("documents")}
          onRemove={(file) => removeDraftFile("documents", file)}
          title="Source documents"
        />
      </div>

      <div className="upload-metrics">
        <div className="upload-metric-card">
          <span className="panel-label">Selected</span>
          <strong>{draft.documents.length}</strong>
        </div>
        <div className="upload-metric-card">
          <span className="panel-label">Cases</span>
          <strong>{draft.documents.length}</strong>
        </div>
        <div className="upload-metric-card">
          <span className="panel-label">Mapping</span>
          <strong>1 doc = 1 case</strong>
        </div>
      </div>
    </article>
  );

  const renderTruthPackStep = () => (
    <article className="panel flow-panel">
      <div className="panel-header">
        <span className="panel-title">Source of truth and rules</span>
      </div>

      <div className="truth-layout">
        <div className="truth-top-grid">
          <section className="rules-card rules-card--compact">
            <div className="panel-header">
              <span className="panel-title">Reference outputs</span>
            </div>
            <UploadDropzone
              acceptLabel="PDF, DOCX, TXT, MD"
              compact
              files={draft.referenceOutputs}
              hint="Drop approved reference outputs"
              loadedLabel="references loaded"
              onAppend={(files) => appendDraftFiles("referenceOutputs", files)}
              onClear={() => clearDraftFiles("referenceOutputs")}
              onRemove={(file) => removeDraftFile("referenceOutputs", file)}
              title="Gold summaries"
            />
          </section>

          <section className="rules-card rules-card--compact">
            <div className="panel-header">
              <span className="panel-title">Policy guidance</span>
            </div>

            <div className="policy-stack">
              <UploadDropzone
                acceptLabel="PDF, DOCX, TXT, MD"
                compact
                files={draft.policyFiles}
                hint="Drop governance or policy files"
                loadedLabel="policy files loaded"
                onAppend={(files) => appendDraftFiles("policyFiles", files)}
                onClear={() => clearDraftFiles("policyFiles")}
                onRemove={(file) => removeDraftFile("policyFiles", file)}
                title="Policy files"
              />

              <label className="field field--plain policy-text-field">
                <span>Rule text</span>
                <textarea
                  className="policy-textarea"
                  placeholder="Enter additional rules, compliance notes, or organisation-specific summarisation constraints."
                  value={draft.policyText}
                  onChange={(event) => updateDraft("policyText", event.target.value)}
                />
              </label>
            </div>
          </section>
        </div>

        <section className="rules-card rules-card--wide">
          <div className="panel-header">
            <span className="panel-title">Deterministic rules</span>
          </div>

          <div className="rules-control-grid">
            <label className="field rule-field">
              <span>Word limit</span>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="220"
                type="text"
                value={draft.maxWords}
                onChange={(event) =>
                  updateDraft("maxWords", event.target.value.replace(/[^\d]/g, ""))
                }
              />
            </label>

            <div className="field rule-field">
              <span>Sensitive content</span>
              <div className="toggle-row">
                <button
                  className={`toggle-card ${
                    draft.redactSensitiveContent ? "toggle-card--active" : ""
                  }`}
                  onClick={() => updateDraft("redactSensitiveContent", true)}
                  type="button"
                >
                  Redact
                </button>
                <button
                  className={`toggle-card ${
                    !draft.redactSensitiveContent ? "toggle-card--active" : ""
                  }`}
                  onClick={() => updateDraft("redactSensitiveContent", false)}
                  type="button"
                >
                  Allow
                </button>
              </div>
            </div>

            <div className="field rule-field rule-field--wide">
              <span>Required sections</span>
              <div className="chip-row">
                {requiredSectionOptions.map((section) => (
                  <button
                    key={section}
                    className={`chip-button ${
                      draft.requiredSections.includes(section) ? "chip-button--active" : ""
                    }`}
                    onClick={() => toggleDraftSelection("requiredSections", section)}
                    type="button"
                  >
                    {section}
                  </button>
                ))}
              </div>
            </div>

            <div className="field rule-field rule-field--wide">
              <span>Exclude</span>
              <div className="chip-row">
                {excludedContentOptions.map((rule) => (
                  <button
                    key={rule}
                    className={`chip-button ${
                      draft.excludedContent.includes(rule) ? "chip-button--active" : ""
                    }`}
                    onClick={() => toggleDraftSelection("excludedContent", rule)}
                    type="button"
                  >
                    {rule}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
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
          <div className="field field--wide field--plain">
            <UploadDropzone
              acceptLabel="PDF, DOCX, TXT, MD"
              files={draft.aiOutputs}
              hint="Drop generated AI summaries"
              onAppend={(files) => appendDraftFiles("aiOutputs", files)}
              onClear={() => clearDraftFiles("aiOutputs")}
              onRemove={(file) => removeDraftFile("aiOutputs", file)}
              title="Uploaded AI outputs"
            />
          </div>

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
          <strong>{draft.policyFiles.length + (draft.policyText.trim() ? 1 : 0)}</strong>
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
          <span className="panel-label">Word limit</span>
          <strong>{draft.maxWords}</strong>
        </div>
        <div className="review-card">
          <span className="panel-label">Risk</span>
          <strong>{draft.riskLevel}</strong>
        </div>
        <div className="review-card">
          <span className="panel-label">Required sections</span>
          <strong>{draft.requiredSections.length}</strong>
        </div>
        <div className="review-card">
          <span className="panel-label">Excluded items</span>
          <strong>{draft.excludedContent.length}</strong>
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
          disabled={step === 1 || isSubmittingEvaluation}
          onClick={goBack}
          type="button"
        >
          Back
        </button>

        {step < 6 ? (
          <button
            className="primary-button"
            disabled={!stepReady || isSubmittingEvaluation}
            onClick={goNext}
            type="button"
          >
            Next
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={!stepReady || isSubmittingEvaluation}
            onClick={runEvaluation}
            type="button"
          >
            {isSubmittingEvaluation ? "Starting..." : "Run evaluation"}
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

      {statusMessage ? <div className="status-banner">{statusMessage}</div> : null}

      {lastEvaluation ? (
        lastEvaluation.status !== "COMPLETED" ? (
          <>
            <section className="card-grid">
              <SummaryCard
                label="Status"
                value={getDecisionLabel(lastEvaluation)}
                meta="Workflow state"
              />
              <SummaryCard
                label="Evaluation ID"
                value={lastEvaluation.id}
                meta="Tracked in AWS"
              />
              <SummaryCard
                label="Output source"
                value={
                  lastEvaluation.outputSource === "platform-model"
                    ? "Platform model"
                    : "Uploaded outputs"
                }
                meta={`${lastEvaluation.documentCount} source docs`}
              />
              <SummaryCard
                label="Started"
                value={new Intl.DateTimeFormat("en-AU", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(lastEvaluation.createdAt))}
                meta="Most recent update"
              />
            </section>

            <section className="content-grid">
              <article className="panel feature-panel">
                <div className="empty-state">
                  <strong>Evaluation in progress</strong>
                  <span>
                    Files are uploaded and the Step Functions workflow is running.
                  </span>
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <span className="panel-title">Current setup</span>
                </div>
                <div className="detail-grid">
                  <div>
                    <span className="detail-label">Audience</span>
                    <strong>{lastEvaluation.audience || "Not set"}</strong>
                  </div>
                  <div>
                    <span className="detail-label">Output style</span>
                    <strong>{lastEvaluation.outputStyle}</strong>
                  </div>
                  <div>
                    <span className="detail-label">Risk</span>
                    <strong>{lastEvaluation.riskLevel}</strong>
                  </div>
                  <div>
                    <span className="detail-label">Documents</span>
                    <strong>{lastEvaluation.documentCount}</strong>
                  </div>
                </div>
              </article>
            </section>
          </>
        ) : (
          <>
          <section className="card-grid">
            <SummaryCard
              label="Decision"
              value={lastEvaluation.decision ?? "Completed"}
              meta="Overall outcome"
            />
            <SummaryCard
              label="Readiness"
              value={lastEvaluation.readinessScore?.toFixed(1) ?? "—"}
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
                  label={getDecisionLabel(lastEvaluation)}
                  tone={getTone(lastEvaluation.decision, lastEvaluation.status)}
                />
              </div>

              {lastEvaluation.metrics.faithfulness !== null &&
              lastEvaluation.metrics.coverage !== null &&
              lastEvaluation.metrics.compliance !== null &&
              lastEvaluation.metrics.privacy !== null ? (
                <>
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
                </>
              ) : (
                <div className="issue-item issue-item--neutral">
                  Metric results have not been written yet.
                </div>
              )}

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
        )
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
