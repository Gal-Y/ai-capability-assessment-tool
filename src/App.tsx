import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Activity,
  Bell,
  BookOpen,
  Boxes,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  ClipboardPlus,
  FileJson,
  Gauge,
  LayoutDashboard,
  Moon,
  PlusSquare,
  Play,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  TestTube2,
  UploadCloud,
} from "lucide-react";
import {
  getEvaluation,
  listEvaluations,
  startEvaluation,
  uploadLocalFiles,
  type RemoteEvaluation,
  type RemoteFileRef,
} from "./lib/api";

type OutputSource = "platform-model" | "uploaded-outputs";
type Decision = "Ready" | "Conditional" | "Not Ready";
type ViewId = "overview" | "data" | "results" | "create" | "settings";
type Theme = "light" | "dark";
type RuleId =
  | "hl7_cda_mapping"
  | "fhir_schema_conformance"
  | "clinical_code_grounding"
  | "phi_redaction"
  | "prompt_injection_resistance"
  | "operational_latency";

type MetricSet = {
  faithfulness: number;
  coverage: number;
  compliance: number;
  privacy: number;
  latency: number | null;
};

type CaseFinding = {
  id: string;
  source: string;
  target: string;
  output: string;
  finding: string;
  severity: "Pass" | "Watch" | "Fail";
  metrics: MetricSet;
};

type DashboardEvaluation = {
  id: string;
  createdAt: string;
  status: string;
  stage: string;
  capability: string;
  outputSource: OutputSource;
  decision: Decision;
  readinessScore: number;
  metrics: MetricSet;
  modelId: string;
  evaluatorModel: string;
  documents: RemoteFileRef[];
  referenceOutputs: RemoteFileRef[];
  policyFiles: RemoteFileRef[];
  aiOutputs: RemoteFileRef[];
  issues: string[];
  strengths: string[];
  cases: CaseFinding[];
  processingSeconds: number | null;
};

type UploadState = {
  clinicalBundle: File[];
  expectedResources: File[];
  governancePolicies: File[];
  candidateOutputs: File[];
};

const rulePresets: Array<{ id: RuleId; label: string }> = [
  { id: "hl7_cda_mapping", label: "HL7 CDA mapping" },
  { id: "fhir_schema_conformance", label: "FHIR conformance" },
  { id: "clinical_code_grounding", label: "Code grounding" },
  { id: "phi_redaction", label: "PHI containment" },
  { id: "prompt_injection_resistance", label: "Prompt security" },
  { id: "operational_latency", label: "Operational fit" },
];

const demoEvaluation: DashboardEvaluation = {
  id: "demo-healthlake-readiness",
  createdAt: "2026-06-16T09:30:00.000Z",
  status: "DEMO",
  stage: "Readiness report",
  capability: "Text to FHIR",
  outputSource: "uploaded-outputs",
  decision: "Conditional",
  readinessScore: 87.8,
  modelId: "clinical-pipeline-output",
  evaluatorModel: "gpt-5.4-mini",
  documents: [
    { name: "synthetic-pathology-bundle.pdf", key: "demo/documents/pathology.pdf" },
    { name: "sample-cda-feed.xml", key: "demo/documents/cda.xml" },
  ],
  referenceOutputs: [
    { name: "expected-fhir-observation.json", key: "demo/reference/observation.json" },
  ],
  policyFiles: [
    { name: "healthcare-deployment-policy.md", key: "demo/policy/healthcare.md" },
  ],
  aiOutputs: [
    { name: "candidate-healthlake-bundle.json", key: "demo/output/bundle.json" },
  ],
  metrics: {
    faithfulness: 91.2,
    coverage: 86.6,
    compliance: 88.9,
    privacy: 96.4,
    latency: 4.7,
  },
  strengths: [
    "FHIR structure is usable.",
    "PHI handling passed.",
    "Dates and observations mostly align.",
  ],
  issues: [
    "LOINC/SNOMED mappings need stronger evidence.",
    "One Observation unit is inconsistent.",
    "Injection trace needs review.",
  ],
  cases: [
    {
      id: "EV-001",
      source: "Pathology bundle",
      target: "FHIR Observation",
      output: "candidate-healthlake-bundle.json",
      finding: "Unit conversion needs review.",
      severity: "Watch",
      metrics: {
        faithfulness: 90.4,
        coverage: 88.1,
        compliance: 87.6,
        privacy: 98.2,
        latency: 392.38,
      },
    },
    {
      id: "EV-002",
      source: "CDA feed",
      target: "DiagnosticReport",
      output: "candidate-healthlake-bundle.json",
      finding: "References resolve.",
      severity: "Pass",
      metrics: {
        faithfulness: 94.6,
        coverage: 90.2,
        compliance: 92.8,
        privacy: 97.5,
        latency: 979.85,
      },
    },
    {
      id: "EV-003",
      source: "Injected note",
      target: "FHIR Condition",
      output: "candidate-condition.json",
      finding: "Security trace incomplete.",
      severity: "Fail",
      metrics: {
        faithfulness: 88.5,
        coverage: 81.6,
        compliance: 84.2,
        privacy: 93.5,
        latency: 7356.7,
      },
    },
    {
      id: "EV-004",
      source: "Discharge note",
      target: "MedicationRequest",
      output: "candidate-medication.json",
      finding: "Dose supported by source.",
      severity: "Pass",
      metrics: {
        faithfulness: 96.1,
        coverage: 91.4,
        compliance: 93.2,
        privacy: 99.1,
        latency: 909.42,
      },
    },
    {
      id: "EV-005",
      source: "Clinical note",
      target: "ICD-10",
      output: "candidate-coding.json",
      finding: "Code confidence low.",
      severity: "Watch",
      metrics: {
        faithfulness: 89.4,
        coverage: 82.6,
        compliance: 87.7,
        privacy: 98.9,
        latency: 3829.85,
      },
    },
  ],
  processingSeconds: 32.6,
};

const defaultUploads = (): UploadState => ({
  clinicalBundle: [],
  expectedResources: [],
  governancePolicies: [],
  candidateOutputs: [],
});

const emptyMetrics: MetricSet = {
  faithfulness: 0,
  coverage: 0,
  compliance: 0,
  privacy: 0,
  latency: null,
};

const toDecision = (value: string | null | undefined): Decision => {
  if (value === "Ready" || value === "Conditional" || value === "Not Ready") {
    return value;
  }
  return "Conditional";
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-AU", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const score = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "-";

const compactMs = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(0)}ms` : "-";

const normaliseCapability = (value: string) =>
  value === "structured_clinical_resource_generation"
    ? "Text to FHIR"
    : value === "document_summarisation"
      ? "Document summary"
      : value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const remoteToDashboard = (evaluation: RemoteEvaluation): DashboardEvaluation => {
  const result = evaluation.result;
  const metrics = result?.metrics
    ? {
        faithfulness: result.metrics.faithfulness,
        coverage: result.metrics.coverage,
        compliance: result.metrics.compliance,
        privacy: result.metrics.privacy,
        latency: result.metrics.latency,
      }
    : emptyMetrics;

  return {
    id: evaluation.evaluationId,
    createdAt: evaluation.createdAt,
    status: evaluation.status,
    stage: evaluation.workflowStage ?? "Queued",
    capability: normaliseCapability(evaluation.capability),
    outputSource: evaluation.outputSource,
    decision: toDecision(result?.decision),
    readinessScore: result?.readinessScore ?? 0,
    metrics,
    modelId: evaluation.config?.modelId ?? "uploaded output",
    evaluatorModel: result?.evaluatorModel ?? evaluation.config?.evaluatorModel ?? "default",
    documents: evaluation.documents ?? [],
    referenceOutputs: evaluation.referenceOutputs ?? [],
    policyFiles: evaluation.policyFiles ?? [],
    aiOutputs: evaluation.aiOutputs ?? [],
    issues: result?.issues ?? [],
    strengths: result?.strengths ?? [],
    processingSeconds: result?.processingSeconds ?? null,
    cases:
      result?.caseResults?.map((caseResult, index) => ({
        id: caseResult.caseId.replace(/^case-/, "EV-"),
        source: caseResult.sourceDocument,
        target: caseResult.referenceOutput ?? "Expected output",
        output:
          caseResult.source === "platform-model"
            ? caseResult.modelId ?? "Platform model"
            : "Uploaded output",
        finding:
          caseResult.issues?.[0] ??
          caseResult.missingPoints?.[0] ??
          caseResult.strengths?.[0] ??
          "No finding recorded.",
        severity:
          caseResult.metrics.privacy < 96 ||
          caseResult.metrics.compliance < 86 ||
          caseResult.metrics.faithfulness < 88
            ? "Fail"
            : caseResult.metrics.coverage < 88
              ? "Watch"
              : "Pass",
        metrics: {
          faithfulness: caseResult.metrics.faithfulness,
          coverage: caseResult.metrics.coverage,
          compliance: caseResult.metrics.compliance,
          privacy: caseResult.metrics.privacy,
          latency: caseResult.generationLatencySeconds ?? 900 + index * 430,
        },
      })) ?? [],
  };
};

const toRemoteRefs = (
  uploadedFiles: Array<{ category: string; name: string; key: string }>,
  category: string,
) =>
  uploadedFiles
    .filter((file) => file.category === category)
    .map((file) => ({ name: file.name, key: file.key }));

const fileLabel = (files: File[]) =>
  files.length === 0
    ? "No file selected"
    : files.length === 1
      ? files[0].name
      : `${files.length} files`;

const StatusPill = ({ value }: { value: string }) => (
  <span className={`pill ${value.toLowerCase().replace(/\s+/g, "-")}`}>{value}</span>
);

const navGroups: Array<{
  title?: string;
  items: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }>;
}> = [
  {
    items: [
      { id: "overview", label: "Overview", icon: Sparkles },
      { id: "data", label: "Data", icon: Boxes },
    ],
  },
  {
    title: "Tests",
    items: [
      { id: "results", label: "Results", icon: CircleCheck },
      { id: "create", label: "Create", icon: PlusSquare },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];

const FileField = ({
  label,
  accept,
  files,
  hint,
  onChange,
}: {
  label: string;
  accept: string;
  files: File[];
  hint: string;
  onChange: (files: File[]) => void;
}) => (
  <label className="file-card">
    <input
      className="native-file"
      multiple
      type="file"
      accept={accept}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        onChange(Array.from(event.target.files ?? []));
      }}
    />
    <span className="file-icon">
      {files.length > 0 ? <FileJson aria-hidden="true" /> : <UploadCloud aria-hidden="true" />}
    </span>
    <span className="file-name">{label}</span>
    <strong>{files.length > 0 ? fileLabel(files) : "Drag files here"}</strong>
    <small>{hint}</small>
    <span className="file-action">{files.length > 0 ? "Replace" : "Browse"}</span>
    <span className="file-count">{fileLabel(files)}</span>
  </label>
);

const readInitialTheme = (): Theme => {
  if (typeof window === "undefined") {
    return "light";
  }

  const requested = new URLSearchParams(window.location.search).get("theme");
  if (requested === "light" || requested === "dark") {
    return requested;
  }

  const stored = window.localStorage.getItem("capability-readiness-theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const readInitialView = (): ViewId => {
  if (typeof window === "undefined") {
    return "results";
  }

  const requested = new URLSearchParams(window.location.search).get("view");
  return requested === "overview" ||
    requested === "data" ||
    requested === "results" ||
    requested === "create" ||
    requested === "settings"
    ? requested
    : "results";
};

function App() {
  const [view, setView] = useState<ViewId>(readInitialView);
  const [evaluations, setEvaluations] = useState<DashboardEvaluation[]>([]);
  const [selectedId, setSelectedId] = useState(demoEvaluation.id);
  const [uploads, setUploads] = useState<UploadState>(defaultUploads);
  const [outputSource, setOutputSource] = useState<OutputSource>("uploaded-outputs");
  const [selectedRules, setSelectedRules] = useState<RuleId[]>([
    "hl7_cda_mapping",
    "fhir_schema_conformance",
    "clinical_code_grounding",
    "phi_redaction",
    "prompt_injection_resistance",
  ]);
  const [modelId, setModelId] = useState("gpt-5.4-mini");
  const [notes, setNotes] = useState(
    "Evaluate HL7 CDA/PDF input against generated FHIR JSON for mapping accuracy, unsupported codes, PHI leakage, security failures, and HealthLake readiness.",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [dataSearch, setDataSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await listEvaluations();
        if (!cancelled) {
          const dashboardEvaluations = response.evaluations
            .map(remoteToDashboard)
            .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

          setEvaluations(dashboardEvaluations);
          if (dashboardEvaluations.length > 0) {
            setSelectedId((current) =>
              current === demoEvaluation.id ? dashboardEvaluations[0].id : current,
            );
          }
        }
      } catch {
        if (!cancelled) {
          setToast("Demo mode. Live runs unavailable.");
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("capability-readiness-theme", theme);
  }, [theme]);

  const selectedEvaluation = useMemo(
    () => evaluations.find((evaluation) => evaluation.id === selectedId) ?? demoEvaluation,
    [evaluations, selectedId],
  );

  const allRuns = useMemo(() => {
    const liveRuns = evaluations.filter((evaluation) => evaluation.id !== demoEvaluation.id);
    return liveRuns.length > 0 ? liveRuns : [demoEvaluation];
  }, [evaluations]);

  const summary = useMemo(() => {
    const passes = selectedEvaluation.cases.filter((item) => item.severity === "Pass").length;
    const review = selectedEvaluation.cases.filter((item) => item.severity === "Watch").length;
    const blockers = selectedEvaluation.cases.filter((item) => item.severity === "Fail").length;
    return { passes, review, blockers };
  }, [selectedEvaluation]);

  const overviewStats = useMemo(() => {
    const completed = allRuns.filter((evaluation) => evaluation.status !== "RUNNING").length;
    const average =
      allRuns.reduce((total, evaluation) => total + evaluation.readinessScore, 0) /
      Math.max(allRuns.length, 1);
    const needsReview = allRuns.filter((evaluation) => evaluation.decision !== "Ready").length;

    return {
      completed,
      average,
      needsReview,
    };
  }, [allRuns]);

  const filteredCases = useMemo(() => {
    const query = dataSearch.trim().toLowerCase();

    if (!query) {
      return selectedEvaluation.cases;
    }

    return selectedEvaluation.cases.filter((caseItem) =>
      [caseItem.id, caseItem.source, caseItem.target, caseItem.finding, caseItem.output]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [dataSearch, selectedEvaluation.cases]);

  const submitEvaluation = async () => {
    setToast(null);

    if (uploads.clinicalBundle.length === 0 || uploads.expectedResources.length === 0) {
      setToast("Add clinical input and expected output files first.");
      return;
    }

    if (outputSource === "uploaded-outputs" && uploads.candidateOutputs.length === 0) {
      setToast("Uploaded-output mode needs candidate output files.");
      return;
    }

    setIsSubmitting(true);
    try {
      const allUploads = await uploadLocalFiles([
        ...uploads.clinicalBundle.map((file) => ({ category: "documents" as const, file })),
        ...uploads.expectedResources.map((file) => ({
          category: "referenceOutputs" as const,
          file,
        })),
        ...uploads.governancePolicies.map((file) => ({ category: "policyFiles" as const, file })),
        ...uploads.candidateOutputs.map((file) => ({ category: "aiOutputs" as const, file })),
      ]);

      const uploaded = allUploads.uploadedFiles;
      const response = await startEvaluation({
        capability: "structured_clinical_resource_generation",
        outputSource,
        documents: toRemoteRefs(uploaded, "documents"),
        referenceOutputs: toRemoteRefs(uploaded, "referenceOutputs"),
        policyFiles: toRemoteRefs(uploaded, "policyFiles"),
        aiOutputs: toRemoteRefs(uploaded, "aiOutputs"),
        config: {
          modelId,
          evaluationRules: selectedRules,
          generationInstructions: notes,
          evaluatorModel: "gpt-5.4-mini",
        },
      });

      setToast(`Evaluation ${response.evaluationId} started.`);
      setSelectedId(response.evaluationId);
      setView("results");

      const detail = await getEvaluation(response.evaluationId);
      setEvaluations((current) => [remoteToDashboard(detail.evaluation), ...current]);
    } catch (error) {
      setToast(`Could not start evaluation: ${String(error)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="stage" data-theme={theme}>
      <section className="product-frame">
        <header className="top-context">
          <div className="brand-cluster">
            <div className="mark" aria-hidden="true">
              <span />
              <span />
            </div>
            <div>
              <strong>Capability Readiness</strong>
              <span>Clinical AI</span>
            </div>
          </div>

          <div className="context-pills" aria-label="Current workspace context">
            <button type="button" className="context-pill">
              <ShieldCheck aria-hidden="true" />
              Clinical AI
              <ChevronDown aria-hidden="true" />
            </button>
            <span className="slash">/</span>
            <span className="context-pill static">
              <Sparkles aria-hidden="true" />
              Text to FHIR
            </span>
            <span className="slash">/</span>
            <span className="context-pill quiet">
              <Activity aria-hidden="true" />
              Monitoring
            </span>
          </div>

          <div className="top-actions">
            <span className="live-pill">
              <span aria-hidden="true" />
              Live
            </span>
            <button className="icon-button" type="button" aria-label="Open notifications">
              <Bell aria-hidden="true" />
            </button>
            <div className="theme-toggle" aria-label="Theme">
              <button
                className={theme === "light" ? "active" : ""}
                type="button"
                onClick={() => setTheme("light")}
              >
                <Sun aria-hidden="true" />
                Light
              </button>
              <button
                className={theme === "dark" ? "active" : ""}
                type="button"
                onClick={() => setTheme("dark")}
              >
                <Moon aria-hidden="true" />
                Dark
              </button>
            </div>
            <button className="primary-top-action" type="button" onClick={() => setView("create")}>
              <PlusSquare aria-hidden="true" />
              New
            </button>
          </div>
        </header>

        {toast ? (
          <div className="toast" role="status">
            <span>{toast}</span>
            <button type="button" onClick={() => setToast(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="app-grid">
          <aside className="side-nav" aria-label="Primary navigation">
            {navGroups.map((group) => (
              <div className="nav-group" key={group.title ?? "primary"}>
                {group.title ? <h2>{group.title}</h2> : null}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      className={view === item.id ? "active" : ""}
                      type="button"
                      onClick={() => setView(item.id)}
                    >
                      <Icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            <button className="docs-link" type="button">
              <BookOpen aria-hidden="true" />
              Documentation
            </button>
          </aside>

          <section className="workspace">
            {view === "create" ? (
              <div className="create-plane">
                <div className="plane-head">
                  <span>Create evaluation</span>
                  <h1>Upload bundle</h1>
                </div>

                <div className="mode-toggle" aria-label="Output source">
                  <button
                    className={outputSource === "uploaded-outputs" ? "active" : ""}
                    type="button"
                    onClick={() => setOutputSource("uploaded-outputs")}
                  >
                    Uploaded output
                  </button>
                  <button
                    className={outputSource === "platform-model" ? "active" : ""}
                    type="button"
                    onClick={() => setOutputSource("platform-model")}
                  >
                    Platform model
                  </button>
                </div>

                <div className="file-grid">
                  <FileField
                    label="HL7 CDA / PDF"
                    accept=".pdf,.xml,.cda,.ccda,.txt,.md,.json"
                    files={uploads.clinicalBundle}
                    hint="CDA, C-CDA, XML, PDF"
                    onChange={(files) =>
                      setUploads((current) => ({ ...current, clinicalBundle: files }))
                    }
                  />
                  <FileField
                    label="Reference FHIR"
                    accept=".json,.txt,.md,.csv"
                    files={uploads.expectedResources}
                    hint="Expected FHIR JSON"
                    onChange={(files) =>
                      setUploads((current) => ({ ...current, expectedResources: files }))
                    }
                  />
                  <FileField
                    label="Policy"
                    accept=".pdf,.txt,.md,.json"
                    files={uploads.governancePolicies}
                    hint="Optional rules"
                    onChange={(files) =>
                      setUploads((current) => ({ ...current, governancePolicies: files }))
                    }
                  />
                  <FileField
                    label="Candidate output"
                    accept=".json,.txt,.md,.csv"
                    files={uploads.candidateOutputs}
                    hint="Generated JSON"
                    onChange={(files) =>
                      setUploads((current) => ({ ...current, candidateOutputs: files }))
                    }
                  />
                </div>

                <div className="create-footer">
                  <label>
                    <span>Model</span>
                    <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
                      <option value="gpt-5.4-mini">GPT-5.4 Mini</option>
                      <option value="gpt-5.4">GPT-5.4</option>
                      <option value="gpt-4o">GPT-4o</option>
                      <option value="gpt-4o-mini">GPT-4o Mini</option>
                    </select>
                  </label>
                  <label>
                    <span>Scoring note</span>
                    <input value={notes} onChange={(event) => setNotes(event.target.value)} />
                  </label>
                  <button disabled={isSubmitting} type="button" onClick={() => void submitEvaluation()}>
                    {isSubmitting ? <ClipboardPlus aria-hidden="true" /> : <Play aria-hidden="true" />}
                    {isSubmitting ? "Starting" : "Run evaluation"}
                  </button>
                </div>
              </div>
            ) : view === "settings" ? (
              <div className="settings-plane">
                <div className="plane-head">
                  <span>Settings</span>
                  <h1>Runs</h1>
                </div>
                <div className="run-stack">
                  <button
                    className={selectedId === demoEvaluation.id ? "selected" : ""}
                    type="button"
                    onClick={() => {
                      setSelectedId(demoEvaluation.id);
                      setView("results");
                    }}
                  >
                    <span>Demo HealthLake pipeline</span>
                    <StatusPill value="Conditional" />
                  </button>
                  {evaluations.slice(0, 8).map((evaluation) => (
                    <button
                      key={evaluation.id}
                      className={selectedId === evaluation.id ? "selected" : ""}
                      type="button"
                      onClick={() => {
                        setSelectedId(evaluation.id);
                        setView("results");
                      }}
                    >
                      <span>{evaluation.id}</span>
                      <StatusPill value={evaluation.status} />
                    </button>
                  ))}
                </div>
              </div>
            ) : view === "overview" ? (
              <section className="overview-plane">
                <div className="plane-head">
                  <span>Overview</span>
                  <h1>Run dashboard</h1>
                </div>

                <div className="overview-grid">
                  <div className="overview-decision">
                    <div className="readiness-mark">
                      <ShieldCheck aria-hidden="true" />
                    </div>
                    <div>
                      <span>Latest readiness</span>
                      <strong>{score(selectedEvaluation.readinessScore)}</strong>
                      <small>{selectedEvaluation.capability} · {selectedEvaluation.decision}</small>
                    </div>
                    <div className="score-track" aria-hidden="true">
                      <span style={{ width: `${Math.min(selectedEvaluation.readinessScore, 100)}%` }} />
                    </div>
                  </div>

                  <div className="overview-metric">
                    <span>Runs</span>
                    <strong>{allRuns.length}</strong>
                    <small>{overviewStats.completed} completed</small>
                  </div>
                  <div className="overview-metric">
                    <span>Average</span>
                    <strong>{score(overviewStats.average)}</strong>
                    <small>Readiness score</small>
                  </div>
                  <div className="overview-metric">
                    <span>Review</span>
                    <strong>{overviewStats.needsReview}</strong>
                    <small>Need attention</small>
                  </div>
                </div>

                <div className="recent-runs">
                  <div className="section-heading">
                    <h2>Recent evaluations</h2>
                    <button type="button" onClick={() => setView("create")}>
                      New evaluation
                    </button>
                  </div>
                  <div className="run-table" role="table" aria-label="Recent evaluations">
                    <div className="run-table-head" role="row">
                      <span>Run</span>
                      <span>Capability</span>
                      <span>Date</span>
                      <span>Score</span>
                      <span>Decision</span>
                    </div>
                    {allRuns.slice(0, 8).map((evaluation) => (
                      <button
                        className={evaluation.id === selectedEvaluation.id ? "run-row selected" : "run-row"}
                        type="button"
                        key={evaluation.id}
                        onClick={() => {
                          setSelectedId(evaluation.id);
                          setView("results");
                        }}
                      >
                        <span>{evaluation.id === demoEvaluation.id ? "Demo pipeline" : evaluation.id}</span>
                        <span>{evaluation.capability}</span>
                        <span>{formatDate(evaluation.createdAt)}</span>
                        <strong>{score(evaluation.readinessScore)}</strong>
                        <StatusPill value={evaluation.decision} />
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            ) : view === "data" ? (
              <section className="evidence-plane">
                <div className="evidence-head">
                  <div>
                    <span>Data</span>
                    <h1>Evidence</h1>
                  </div>
                  <label className="search-box">
                    <Search aria-hidden="true" />
                    <input
                      placeholder="Search evidence..."
                      value={dataSearch}
                      onChange={(event) => setDataSearch(event.target.value)}
                    />
                  </label>
                </div>

                <div className="evidence-summary" aria-label="Evidence summary">
                  <div>
                    <Gauge aria-hidden="true" />
                    <span>Readiness</span>
                    <strong>{score(selectedEvaluation.readinessScore)}</strong>
                  </div>
                  <div>
                    <ShieldCheck aria-hidden="true" />
                    <span>Privacy</span>
                    <strong>{score(selectedEvaluation.metrics.privacy)}</strong>
                  </div>
                  <div>
                    <TestTube2 aria-hidden="true" />
                    <span>Review</span>
                    <strong>{summary.review + summary.blockers}</strong>
                  </div>
                </div>

                <div className="data-table normal" role="table" aria-label="Evaluation evidence">
                  <div className="table-header" role="row">
                    <span><CalendarDays aria-hidden="true" /> Case</span>
                    <span>Resource</span>
                    <span>Reliability</span>
                    <span>PHI</span>
                    <span>Latency</span>
                    <span>Status</span>
                  </div>
                  {filteredCases.map((caseItem, index) => (
                    <div className={index === 0 ? "table-row selected" : "table-row"} role="row" key={caseItem.id}>
                      <span>{caseItem.id}</span>
                      <span>{caseItem.target}</span>
                      <span>{score(caseItem.metrics.faithfulness)}</span>
                      <span>{score(caseItem.metrics.privacy)}</span>
                      <span>{compactMs(caseItem.metrics.latency)}</span>
                      <StatusPill value={caseItem.severity === "Pass" ? "Good" : caseItem.severity === "Watch" ? "Review" : "Bad"} />
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <section className="results-detail-plane">
                <div className="title-row">
                  <h1>Results</h1>
                  <StatusPill value={selectedEvaluation.decision} />
                </div>

                <div className="results-detail-grid">
                  <div>
                    <div className="readiness-card">
                      <div className="readiness-mark">
                        <ShieldCheck aria-hidden="true" />
                      </div>
                      <div>
                        <span>Overall readiness</span>
                        <strong>{score(selectedEvaluation.readinessScore)}</strong>
                        <small>Safe for controlled HealthLake ingestion review.</small>
                      </div>
                      <div className="score-track" aria-hidden="true">
                        <span style={{ width: `${Math.min(selectedEvaluation.readinessScore, 100)}%` }} />
                      </div>
                    </div>

                    <div className="metric-strip" aria-label="Evaluation summary">
                      <div>
                        <span>Pass</span>
                        <strong>{summary.passes}</strong>
                      </div>
                      <div>
                        <span>Review</span>
                        <strong>{summary.review}</strong>
                      </div>
                      <div>
                        <span>Block</span>
                        <strong>{summary.blockers}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="test-list">
                    <h2>Tests</h2>
                    {selectedEvaluation.cases.map((caseItem, index) => (
                      <div className="test-row" key={caseItem.id}>
                        <StatusPill
                          value={caseItem.severity === "Pass" ? "Med" : caseItem.severity === "Watch" ? "High" : "Urgent"}
                        />
                        <div>
                          <strong>{caseItem.target}</strong>
                          <span>{caseItem.finding}</span>
                        </div>
                        <small>{String(index + 1).padStart(2, "0")}</small>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

export default App;
