import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  getEvaluation,
  listEvaluations,
  startEvaluation,
  uploadLocalFiles,
  type RemoteEvaluation,
  type RemoteFileRef,
  type UploadedFileResult,
} from "./lib/api";

type ViewId = "home" | "new-evaluation" | "results";
type StepId = 1 | 2 | 3 | 4 | 5;
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

type DocumentPreview =
  | { status: "empty" }
  | { status: "loading"; name: string }
  | { status: "error"; name: string; message: string }
  | {
      status: "ready";
      name: string;
      mode: "pdf";
      objectUrl: string;
      messages: string[];
    }
  | {
      status: "ready";
      name: string;
      mode: "docx";
      messages: string[];
    }
  | {
      status: "ready";
      name: string;
      mode: "text";
      content: string;
      messages: string[];
    };

type EvaluationDraft = {
  capability: "Document summarisation";
  outputSource: OutputSource | null;
  documents: UploadItem[];
  referenceOutputs: UploadItem[];
  policyFiles: UploadItem[];
  aiOutputs: UploadItem[];
  policyText: string;
  modelId: string;
};

type CaseResult = {
  caseId: string;
  sourceDocument: string;
  referenceOutput: string | null;
  candidateSummary: string;
  source: OutputSource;
  modelId: string | null;
  metrics: {
    faithfulness: number;
    coverage: number;
    compliance: number;
    privacy: number;
  };
  strengths: string[];
  missingPoints: string[];
  issues: string[];
  policyFindings: string[];
  generationLatencySeconds: number | null;
  evaluationLatencySeconds: number;
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
  modelId: string | null;
  evaluatorModel: string | null;
  processingSeconds: number | null;
  tokenUsage:
    | {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }
    | null;
  readinessScore: number | null;
  decision: Decision | null;
  metrics: {
    faithfulness: number | null;
    coverage: number | null;
    compliance: number | null;
    privacy: number | null;
    latency: number | null;
  };
  issues: string[];
  strengths: string[];
  caseResults: CaseResult[];
  documents: UploadItem[];
  referenceOutputs: UploadItem[];
  policyFiles: UploadItem[];
  aiOutputs: UploadItem[];
};

const thresholds = {
  faithfulness: 92,
  coverage: 86,
  compliance: 90,
  privacy: 96,
};

const availableModels = [
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
] as const;

const defaultModelId = "gpt-5.4-mini";

const policyGuidancePresets = [
  {
    id: "executive-brief",
    title: "Executive brief",
    description: "Concise, leadership-ready summary with the main obligations and process points.",
    text:
      "Write for senior stakeholders. Keep the summary concise, factual, and easy to scan. Focus on policy scope, key leave entitlements, notice requirements, approval timeframes, and escalation path. Avoid clause-by-clause repetition and unnecessary operational detail.",
  },
  {
    id: "privacy-first",
    title: "Privacy-first",
    description: "Adds stricter privacy and sensitivity constraints.",
    text:
      "Do not include personal names, direct contact details, employee identifiers, account numbers, or any other sensitive internal information. Summarise the policy at a general level and avoid reproducing confidential internal-only wording unless it is essential.",
  },
  {
    id: "structured-policy",
    title: "Structured policy summary",
    description: "Requests a more structured output without relying on separate rule chips.",
    text:
      "Use a structured summary format with short sections for Key points, Notice requirements, Approval process, and Escalation. Keep the tone professional and neutral. Exclude speculation, legal interpretation beyond the policy text, and unsupported assumptions.",
  },
] as const;

const stepItems: Array<{ id: StepId; label: string }> = [
  { id: 1, label: "Capability" },
  { id: 2, label: "Output" },
  { id: 3, label: "Documents" },
  { id: 4, label: "Truth & Rules" },
  { id: 5, label: "Review" },
];

const initialDraft = (): EvaluationDraft => ({
  capability: "Document summarisation",
  outputSource: null,
  documents: [],
  referenceOutputs: [],
  policyFiles: [],
  aiOutputs: [],
  policyText: "",
  modelId: defaultModelId,
});

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
        typeLabel: getTypeLabelFromName(file.name),
      }))
    : [];

const uploadItemKey = (file: UploadItem) =>
  file.key ?? `${file.name}-${file.sizeLabel}-${file.typeLabel}`;

const getFileExtension = (name: string) => name.split(".").pop()?.trim().toLowerCase() ?? "";

const loadDocumentPreview = async (file: File): Promise<DocumentPreview> => {
  const extension = getFileExtension(file.name);

  if (file.type === "application/pdf" || extension === "pdf") {
    return {
      status: "ready",
      name: file.name,
      mode: "pdf",
      objectUrl: URL.createObjectURL(file),
      messages: [],
    };
  }

  if (
    file.type.startsWith("text/") ||
    extension === "txt" ||
    extension === "md" ||
    extension === "markdown"
  ) {
    return {
      status: "ready",
      name: file.name,
      mode: "text",
      content: await file.text(),
      messages: [],
    };
  }

  return {
    status: "error",
    name: file.name,
    message: "Preview is only available for PDF, DOCX, TXT, and MD files.",
  };
};

const mergeUploadItems = (current: UploadItem[], next: UploadItem[]) => {
  const items = new Map(current.map((item) => [uploadItemKey(item), item]));

  next.forEach((item) => {
    items.set(uploadItemKey(item), item);
  });

  return Array.from(items.values());
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

const getModelLabel = (modelId: string | null | undefined) =>
  availableModels.find((model) => model.id === modelId)?.label ?? modelId ?? "Not set";

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
  modelId:
    evaluation.outputSource === "platform-model"
      ? evaluation.config?.modelId ?? defaultModelId
      : null,
  evaluatorModel: evaluation.result?.evaluatorModel ?? null,
  processingSeconds: evaluation.result?.processingSeconds ?? null,
  tokenUsage: evaluation.result?.tokenUsage?.total ?? null,
  readinessScore: evaluation.result?.readinessScore ?? null,
  decision: evaluation.result?.decision ?? null,
  metrics: {
    faithfulness: evaluation.result?.metrics.faithfulness ?? null,
    coverage: evaluation.result?.metrics.coverage ?? null,
    compliance: evaluation.result?.metrics.compliance ?? null,
    privacy: evaluation.result?.metrics.privacy ?? null,
    latency: evaluation.result?.metrics.latency ?? null,
  },
  issues: evaluation.result?.issues ?? (evaluation.error ? [evaluation.error] : []),
  strengths: evaluation.result?.strengths ?? [],
  caseResults:
    evaluation.result?.caseResults?.map((caseResult) => ({
      caseId: caseResult.caseId,
      sourceDocument: caseResult.sourceDocument,
      referenceOutput: caseResult.referenceOutput ?? null,
      candidateSummary: caseResult.candidateSummary,
      source: caseResult.source,
      modelId: caseResult.modelId ?? null,
      metrics: caseResult.metrics,
      strengths: caseResult.strengths ?? [],
      missingPoints: caseResult.missingPoints ?? [],
      issues: caseResult.issues ?? [],
      policyFindings: caseResult.policyFindings ?? [],
      generationLatencySeconds: caseResult.generationLatencySeconds ?? null,
      evaluationLatencySeconds: caseResult.evaluationLatencySeconds,
    })) ?? [],
  documents: evaluation.documents.map(mapRemoteFile),
  referenceOutputs: evaluation.referenceOutputs.map(mapRemoteFile),
  policyFiles: evaluation.policyFiles.map(mapRemoteFile),
  aiOutputs: evaluation.aiOutputs.map(mapRemoteFile),
});

const formatPercent = (value: number) => `${value.toFixed(1)}%`;
const formatLatency = (value: number | null) =>
  value === null ? "Not available" : `${value.toFixed(1)}s`;
const formatSeconds = (value: number | null) =>
  value === null ? "Not available" : `${value.toFixed(1)}s`;
const formatTokenCount = (value: number | null) =>
  value === null ? "Not available" : new Intl.NumberFormat("en-AU").format(value);

const getTone = (decision: Decision | null, status: EvaluationStatus): Tone => {
  if (status === "FAILED") {
    return "bad";
  }
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
    modelId: draft.outputSource === "platform-model" ? draft.modelId : null,
    evaluatorModel: null,
    processingSeconds: null,
    tokenUsage: null,
    readinessScore: null,
    decision: null,
    metrics: {
      faithfulness: null,
      coverage: null,
      compliance: null,
      privacy: null,
      latency: null,
    },
    issues: [],
    strengths: [],
    caseResults: [],
    documents: groupedFiles.documents.map(mapRemoteFile),
    referenceOutputs: groupedFiles.referenceOutputs.map(mapRemoteFile),
    policyFiles: groupedFiles.policyFiles.map(mapRemoteFile),
    aiOutputs: groupedFiles.aiOutputs.map(mapRemoteFile),
  };
};

const CustomSelect = ({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  const selectedOption = options[selectedIndex] ?? options[0];

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  const selectIndex = (index: number) => {
    const next = options[(index + options.length) % options.length];
    if (!next) {
      return;
    }
    onChange(next.id);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        selectIndex(selectedIndex + 1);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        selectIndex(selectedIndex - 1);
      }
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setIsOpen((current) => !current);
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div className="custom-select" ref={containerRef}>
      <button
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={`custom-select__trigger ${isOpen ? "custom-select__trigger--open" : ""}`}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        type="button"
      >
        <span className="custom-select__value">{selectedOption?.label ?? value}</span>
        <span className="custom-select__icon" aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="custom-select__menu" id={listboxId} role="listbox">
          {options.map((option) => {
            const isSelected = option.id === value;

            return (
              <button
                aria-selected={isSelected}
                className={`custom-select__option ${
                  isSelected ? "custom-select__option--active" : ""
                }`}
                key={option.id}
                onClick={() => {
                  onChange(option.id);
                  setIsOpen(false);
                }}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
                {isSelected ? (
                  <span className="custom-select__check" aria-hidden="true">
                    Selected
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
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
  selectedKey,
  onAppend,
  onSelect,
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
  selectedKey?: string | null;
  onAppend: (files: FileList | null) => void;
  onSelect?: (file: UploadItem) => void;
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
              <div
                aria-pressed={onSelect ? selectedKey === uploadItemKey(file) : undefined}
                className={`upload-file-row ${
                  onSelect ? "upload-file-row--selectable" : ""
                } ${selectedKey === uploadItemKey(file) ? "upload-file-row--active" : ""}`}
                key={`${title}-${uploadItemKey(file)}`}
                onClick={
                  onSelect
                    ? (event) => {
                        event.stopPropagation();
                        onSelect(file);
                      }
                    : undefined
                }
                onKeyDown={
                  onSelect
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(file);
                        }
                      }
                    : undefined
                }
                role={onSelect ? "button" : undefined}
                tabIndex={onSelect ? 0 : undefined}
              >
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

const DocumentPreviewPanel = ({
  file,
  emptyMessage = "Add a source document to preview it here before running the evaluation.",
}: {
  file: (UploadItem & { file: File }) | null;
  emptyMessage?: string;
}) => {
  const [preview, setPreview] = useState<DocumentPreview>({ status: "empty" });
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const selectedExtension = file ? getFileExtension(file.name) : "";
  const isSelectedDocx = selectedExtension === "docx";

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    if (!file?.file) {
      setPreview({ status: "empty" });
      return;
    }

    setPreview({ status: "loading", name: file.name });

    if (getFileExtension(file.name) === "docx") {
      const container = docxContainerRef.current;

      if (!container) {
        setPreview({
          status: "error",
          name: file.name,
          message: "The preview surface is not ready yet. Try selecting the document again.",
        });
        return;
      }

      container.innerHTML = "";

      void import("docx-preview")
        .then(({ renderAsync }) =>
          renderAsync(file.file as Blob, container, container, {
            className: "document-preview-docx",
            inWrapper: true,
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
            useBase64URL: true,
          }),
        )
        .then(() => {
          if (!cancelled) {
            setPreview({
              status: "ready",
              name: file.name,
              mode: "docx",
              messages: [],
            });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setPreview({
              status: "error",
              name: file.name,
              message:
                error instanceof Error ? error.message : "Unable to load a preview for this file.",
            });
          }
        });
    } else {
      void loadDocumentPreview(file.file)
        .then((nextPreview) => {
          if (cancelled) {
            if (nextPreview.status === "ready" && nextPreview.mode === "pdf") {
              URL.revokeObjectURL(nextPreview.objectUrl);
            }
            return;
          }

          if (nextPreview.status === "ready" && nextPreview.mode === "pdf") {
            objectUrl = nextPreview.objectUrl;
          }

          setPreview(nextPreview);
        })
        .catch((error) => {
          if (!cancelled) {
            setPreview({
              status: "error",
              name: file.name,
              message:
                error instanceof Error ? error.message : "Unable to load a preview for this file.",
            });
          }
        });
    }

    return () => {
      cancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }

      if (docxContainerRef.current) {
        docxContainerRef.current.innerHTML = "";
      }
    };
  }, [file]);

  return (
    <section className="document-preview-card">
      {!file ? (
        <div className="document-preview-state">
          {emptyMessage}
        </div>
      ) : (
        <>
          <div className="document-preview-stage">
            {isSelectedDocx && preview.status !== "error" ? (
              <>
                <div className="document-preview-scroll document-preview-scroll--docx">
                  <div ref={docxContainerRef} className="document-preview-docx-host" />
                </div>
                {preview.status === "loading" ? (
                  <div className="document-preview-overlay">
                    Loading preview for <strong>{preview.name}</strong>...
                  </div>
                ) : null}
              </>
            ) : preview.status === "loading" ? (
              <div className="document-preview-state">
                Loading preview for <strong>{preview.name}</strong>...
              </div>
            ) : preview.status === "error" ? (
              <div className="document-preview-state document-preview-state--error">
                <strong>{preview.name}</strong>
                <span>{preview.message}</span>
              </div>
            ) : preview.status === "ready" && preview.mode === "pdf" ? (
              <iframe
                className="document-preview-frame"
                src={preview.objectUrl}
                title={`Preview of ${preview.name}`}
              />
            ) : preview.status === "ready" && preview.mode === "text" ? (
              <div className="document-preview-scroll">
                <pre className="document-preview-text">{preview.content}</pre>
              </div>
            ) : (
              <div className="document-preview-state">
                Select a document on the left to load the preview.
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
};

function App() {
  const [view, setView] = useState<ViewId>("home");
  const [step, setStep] = useState<StepId>(1);
  const [draft, setDraft] = useState<EvaluationDraft>(initialDraft);
  const [selectedDocumentPreviewKey, setSelectedDocumentPreviewKey] = useState<string | null>(
    null,
  );
  const [selectedReferencePreviewKey, setSelectedReferencePreviewKey] = useState<string | null>(
    null,
  );
  const [showPolicyPresets, setShowPolicyPresets] = useState(false);
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
  const localDraftDocuments = draft.documents.filter(
    (file): file is UploadItem & { file: File } => Boolean(file.file),
  );
  const selectedDocumentPreview =
    localDraftDocuments.find((file) => uploadItemKey(file) === selectedDocumentPreviewKey) ??
    localDraftDocuments[0] ??
    null;
  const localReferenceOutputs = draft.referenceOutputs.filter(
    (file): file is UploadItem & { file: File } => Boolean(file.file),
  );
  const selectedReferencePreview =
    localReferenceOutputs.find((file) => uploadItemKey(file) === selectedReferencePreviewKey) ??
    localReferenceOutputs[0] ??
    null;

  const stepReady =
    step === 1
      ? Boolean(draft.capability)
      : step === 2
        ? draft.outputSource === "platform-model"
          ? draft.modelId.trim().length > 0
          : draft.outputSource === "uploaded-outputs"
            ? draft.aiOutputs.length > 0
            : false
        : step === 3
          ? draft.documents.length > 0
          : step === 4
            ? draft.referenceOutputs.length > 0
            : true;

  useEffect(() => {
    if (localDraftDocuments.length === 0) {
      setSelectedDocumentPreviewKey(null);
      return;
    }

    if (
      !selectedDocumentPreviewKey ||
      !localDraftDocuments.some((file) => uploadItemKey(file) === selectedDocumentPreviewKey)
    ) {
      setSelectedDocumentPreviewKey(uploadItemKey(localDraftDocuments[0]));
    }
  }, [localDraftDocuments, selectedDocumentPreviewKey]);

  useEffect(() => {
    if (localReferenceOutputs.length === 0) {
      setSelectedReferencePreviewKey(null);
      return;
    }

    if (
      !selectedReferencePreviewKey ||
      !localReferenceOutputs.some((file) => uploadItemKey(file) === selectedReferencePreviewKey)
    ) {
      setSelectedReferencePreviewKey(uploadItemKey(localReferenceOutputs[0]));
    }
  }, [localReferenceOutputs, selectedReferencePreviewKey]);

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

  const applyPolicyPreset = (presetText: string) => {
    setDraft((current) => {
      const existingText = current.policyText.trim();

      if (existingText.includes(presetText)) {
        return current;
      }

      return {
        ...current,
        policyText: existingText ? `${existingText}\n\n${presetText}` : presetText,
      };
    });
  };

  const openNewEvaluation = () => {
    setDraft(initialDraft());
    setStep(1);
    setShowPolicyPresets(false);
    setStatusMessage(null);
    setView("new-evaluation");
  };

  const goNext = () => {
    if (step < 5) {
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
          policyText: draft.policyText.trim(),
          modelId: draft.outputSource === "platform-model" ? draft.modelId : undefined,
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
                      ? getDecisionLabel(evaluation)
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

      {draft.outputSource === "platform-model" ? (
        <div className="form-grid">
          <div className="field field--wide">
            <span>Model</span>
            <CustomSelect
              ariaLabel="Model"
              onChange={(nextValue) => updateDraft("modelId", nextValue)}
              options={availableModels}
              value={draft.modelId}
            />
            <span className="panel-meta">
              This model will generate the summary before the evaluator scores it against the
              source document and reference output.
            </span>
          </div>
        </div>
      ) : draft.outputSource === "uploaded-outputs" ? (
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
            <span className="policy-note">
              Upload one candidate summary for each source document. These files are what the
              evaluator will score.
            </span>
          </div>
        </div>
      ) : null}
    </article>
  );

  const renderDocumentsStep = () => (
    <article className="panel flow-panel">
      <div className="panel-header">
        <span className="panel-title">Upload documents</span>
      </div>

      <div className="upload-layout document-stage">
        <UploadDropzone
          acceptLabel="PDF, DOCX, TXT, MD"
          files={draft.documents}
          hint="Drag & drop source documents"
          loadedLabel="documents loaded"
          selectedKey={selectedDocumentPreviewKey}
          onAppend={(files) => appendDraftFiles("documents", files)}
          onClear={() => clearDraftFiles("documents")}
          onRemove={(file) => removeDraftFile("documents", file)}
          onSelect={(file) => setSelectedDocumentPreviewKey(uploadItemKey(file))}
          title="Source documents"
        />
        <DocumentPreviewPanel file={selectedDocumentPreview} />
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
        <span className="panel-title">Source of truth and policy guidance</span>
      </div>

      <div className="truth-layout">
        <section className="rules-card rules-card--compact">
          <div className="panel-header">
            <span className="panel-title">Reference outputs</span>
          </div>
          <span className="policy-note">
            Upload the approved summaries you want the evaluator to treat as the benchmark.
          </span>
          <div className="upload-layout document-stage">
            <UploadDropzone
              acceptLabel="PDF, DOCX, TXT, MD"
              compact
              files={draft.referenceOutputs}
              hint="Drop approved reference outputs"
              loadedLabel="references loaded"
              selectedKey={selectedReferencePreviewKey}
              onAppend={(files) => appendDraftFiles("referenceOutputs", files)}
              onClear={() => clearDraftFiles("referenceOutputs")}
              onRemove={(file) => removeDraftFile("referenceOutputs", file)}
              onSelect={(file) => setSelectedReferencePreviewKey(uploadItemKey(file))}
              title="Gold summaries"
            />
            <DocumentPreviewPanel
              emptyMessage="Add a reference output to preview it here before running the evaluation."
              file={selectedReferencePreview}
            />
          </div>
        </section>

        <section className="rules-card rules-card--compact">
          <div className="panel-header">
            <span className="panel-title">Policy guidance</span>
            <span className="optional-badge">Optional</span>
          </div>

          <span className="policy-note">
            Leave this blank if you do not need extra rules. You can upload a policy document, add
            a preset, or type extra constraints for how the summary should behave.
          </span>

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
              title="Policy files (optional)"
            />

            <div className="policy-actions">
              <button
                className="ghost-button"
                onClick={() => setShowPolicyPresets((current) => !current)}
                type="button"
              >
                {showPolicyPresets ? "Hide presets" : "Open presets"}
              </button>
              <span>Use presets if you want quick rule templates instead of writing from scratch.</span>
            </div>

            {showPolicyPresets ? (
              <div className="policy-preset-grid">
                {policyGuidancePresets.map((preset) => (
                  <article className="policy-preset-card" key={preset.id}>
                    <div>
                      <strong>{preset.title}</strong>
                      <p>{preset.description}</p>
                    </div>
                    <button
                      className="ghost-button"
                      onClick={() => applyPolicyPreset(preset.text)}
                      type="button"
                    >
                      Add preset
                    </button>
                  </article>
                ))}
              </div>
            ) : null}

            <label className="field field--plain policy-text-field">
              <span>Rule text (optional)</span>
              <textarea
                className="policy-textarea"
                placeholder="Optional. Enter additional policy, formatting, privacy, or compliance guidance for the summary."
                value={draft.policyText}
                onChange={(event) => updateDraft("policyText", event.target.value)}
              />
            </label>
          </div>
        </section>
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
          <span className="panel-label">Policy guidance</span>
          <strong>{draft.policyFiles.length + (draft.policyText.trim() ? 1 : 0)}</strong>
        </div>
        <div className="review-card">
          <span className="panel-label">
            {draft.outputSource === "platform-model" ? "Model" : "AI outputs"}
          </span>
          <strong>
            {draft.outputSource === "platform-model"
              ? getModelLabel(draft.modelId)
              : `${draft.aiOutputs.length} files`}
          </strong>
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
      {step === 5 && renderReviewStep()}

      <section className="wizard-actions">
        <button
          className="ghost-button"
          disabled={step === 1 || isSubmittingEvaluation}
          onClick={goBack}
          type="button"
        >
          Back
        </button>

        {step < 5 ? (
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
        lastEvaluation.status === "RUNNING" ? (
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
                    <span className="detail-label">Source documents</span>
                    <strong>{lastEvaluation.documentCount}</strong>
                  </div>
                  <div>
                    <span className="detail-label">Reference outputs</span>
                    <strong>{lastEvaluation.referenceCount}</strong>
                  </div>
                  <div>
                    <span className="detail-label">Policy guidance</span>
                    <strong>{lastEvaluation.policyCount}</strong>
                  </div>
                  <div>
                    <span className="detail-label">Model</span>
                    <strong>
                      {lastEvaluation.outputSource === "platform-model"
                        ? getModelLabel(lastEvaluation.modelId)
                        : `${lastEvaluation.outputCount} uploaded outputs`}
                    </strong>
                  </div>
                </div>
              </article>
            </section>
          </>
        ) : lastEvaluation.status === "FAILED" ? (
          <section className="content-grid">
            <article className="panel feature-panel">
              <div className="empty-state">
                <strong>Evaluation failed</strong>
                <span>
                  {lastEvaluation.issues[0] ??
                    "The workflow failed before a completed score could be written."}
                </span>
              </div>
            </article>
          </section>
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
                  ? getModelLabel(lastEvaluation.modelId)
                  : `${lastEvaluation.outputCount} outputs`
              }
            />
            <SummaryCard
              label="Runtime"
              value={formatSeconds(lastEvaluation.processingSeconds)}
              meta={`${formatTokenCount(lastEvaluation.tokenUsage?.totalTokens ?? null)} tokens`}
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
                  No generation latency was recorded for this run.
                </div>
              ) : (
                <div className="metric-row metric-row--single">
                  <div className="metric-row__meta">
                    <span>Average generation latency</span>
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
                  <span className="detail-label">Platform model</span>
                  <strong>
                    {lastEvaluation.outputSource === "platform-model"
                      ? getModelLabel(lastEvaluation.modelId)
                      : "Uploaded outputs"}
                  </strong>
                </div>
                <div>
                  <span className="detail-label">Evaluator model</span>
                  <strong>{getModelLabel(lastEvaluation.evaluatorModel)}</strong>
                </div>
                <div>
                  <span className="detail-label">Processing time</span>
                  <strong>{formatSeconds(lastEvaluation.processingSeconds)}</strong>
                </div>
                <div>
                  <span className="detail-label">Total tokens</span>
                  <strong>{formatTokenCount(lastEvaluation.tokenUsage?.totalTokens ?? null)}</strong>
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

          {lastEvaluation.caseResults.length > 0 ? (
            <section className="content-grid">
              <article className="panel">
                <div className="panel-header">
                  <span className="panel-title">Case results</span>
                </div>

                <div className="issue-list">
                  {lastEvaluation.caseResults.map((caseResult) => (
                    <div key={caseResult.caseId} className="issue-item issue-item--neutral">
                      <strong>{caseResult.sourceDocument}</strong>
                      <span>
                        {caseResult.metrics.faithfulness}% faithfulness ·{" "}
                        {caseResult.metrics.coverage}% coverage ·{" "}
                        {caseResult.metrics.compliance}% compliance ·{" "}
                        {caseResult.metrics.privacy}% privacy
                      </span>
                      <span>{caseResult.candidateSummary}</span>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          ) : null}
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
