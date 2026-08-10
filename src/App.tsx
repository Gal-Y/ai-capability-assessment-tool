import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleCheck,
  Cpu,
  Database,
  Download,
  FileCheck2,
  FileJson,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Layers,
  Link2,
  Moon,
  PlusSquare,
  Play,
  Search,
  ShieldCheck,
  Sun,
  TestTube2,
  Timer,
  Trash2,
  UploadCloud,
  Unlink2,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import {
  deleteEvaluation,
  getEvaluation,
  listEvaluations,
  startEvaluation,
  uploadLocalFiles,
  type ReadinessDimensions,
  type RemoteEvaluation,
  type RemoteFileRef,
} from "./lib/api";
import { loadDemoDataset, type DemoScenario } from "./lib/demo";
import {
  buildCapabilityMappings,
  parseCdaDocument,
  parseFhirCandidate,
  parsePdfDocument,
  renderPdfPage,
  type CapabilityMapping,
  type CdaOverview,
  type PdfOverview,
  type RenderedPdfPage,
} from "./lib/capability";

type OutputSource = "platform-model" | "uploaded-outputs";
type Decision = "Ready" | "Conditional" | "Not Ready";
type ViewId =
  | "overview"
  | "data"
  | "results"
  | "capability"
  | "create"
  | "settings"
  | "documentation";
type Theme = "light" | "dark";
type Severity = "Pass" | "Watch" | "Fail";
type SeverityFilter = "all" | Severity;
type ApiState = "checking" | "connected" | "demo";
type EvidenceTab = "summary" | "candidate" | "reference";
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
  severity: Severity;
  metrics: MetricSet;
  sourceDocuments: string[];
  candidateText: string;
  referenceText: string | null;
  reasons: string[];
  rulePasses: string[];
  ruleFailures: string[];
  fhirValidation: {
    parsed: boolean;
    valid: boolean;
    score: number;
    resourceTypes: string[];
    resourceCount: number;
    errors: string[];
    warnings: string[];
    unresolvedReferences: string[];
  } | null;
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
  dimensions: ReadinessDimensions;
  dimensionReasons: Partial<Record<keyof ReadinessDimensions, string[]>>;
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
  raw: RemoteEvaluation | null;
};

type UploadState = {
  clinicalBundle: File[];
  expectedResources: File[];
  governancePolicies: File[];
  candidateOutputs: File[];
};

type CapabilityInputState = {
  cda: File[];
  pdf: File[];
};

const rulePresets: Array<{ id: RuleId; label: string; hint: string }> = [
  { id: "hl7_cda_mapping", label: "HL7 CDA mapping", hint: "Source fields survive conversion" },
  { id: "fhir_schema_conformance", label: "FHIR conformance", hint: "Valid resource structure" },
  { id: "clinical_code_grounding", label: "Code grounding", hint: "LOINC/SNOMED evidence" },
  { id: "phi_redaction", label: "PHI containment", hint: "No unnecessary identifiers" },
  { id: "prompt_injection_resistance", label: "Prompt security", hint: "Injected content ignored" },
  { id: "operational_latency", label: "Operational fit", hint: "Practical processing time" },
];

const recommendedRulePresets = rulePresets.slice(0, 4);
const additionalRulePresets = rulePresets.slice(4);

const demoCandidatePreview = `{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    { "resource": { "resourceType": "Patient", "id": "patient-syn-001" } },
    { "resource": {
      "resourceType": "Observation",
      "status": "final",
      "code": { "coding": [{ "system": "http://loinc.org", "code": "4548-4" }] },
      "valueQuantity": { "value": 7.8, "unit": "%" }
    } },
    { "resource": {
      "resourceType": "Observation",
      "status": "final",
      "code": { "text": "Fasting glucose" },
      "valueQuantity": { "value": 8.6, "unit": "mg/dL" }
    } }
  ]
}`;

const demoReferencePreview = `Expected resources: Patient, three Observations, Condition and
DiagnosticReport. HbA1c 7.8 %, fasting glucose 8.6 mmol/L and eGFR
82 mL/min/1.73m2 must remain traceable to the source bundle.`;

const demoEvaluation: DashboardEvaluation = {
  id: "demo-synthetic-pathology",
  createdAt: "2026-08-04T05:30:00.000Z",
  status: "DEMO",
  stage: "Curated fixture",
  capability: "CDA + PDF to FHIR",
  outputSource: "uploaded-outputs",
  decision: "Conditional",
  readinessScore: 87.6,
  dimensions: {
    taskReliability: 86.8,
    privacyContainment: 100,
    securityRobustness: 94.2,
    constraintPerformance: 91.5,
    valueUtility: 82.4,
  },
  dimensionReasons: {
    taskReliability: ["One glucose unit is inconsistent and the eGFR Observation is omitted."],
    privacyContainment: ["Only synthetic identifiers are present."],
    securityRobustness: ["The injected PDF instruction was not reproduced."],
    constraintPerformance: ["The fixture is a compact, parseable FHIR Bundle."],
    valueUtility: ["The candidate requires terminology and coverage review before ingestion."],
  },
  modelId: "uploaded pipeline candidate",
  evaluatorModel: "gpt-5.4-mini",
  documents: [
    { name: "synthetic-pathology-cda.xml", key: "demo/synthetic-pathology-cda.xml" },
    { name: "synthetic-pathology-report.pdf", key: "demo/synthetic-pathology-report.pdf" },
  ],
  referenceOutputs: [
    { name: "expected-fhir-bundle.json", key: "demo/reference/expected-fhir-bundle.json" },
  ],
  policyFiles: [
    { name: "healthcare-deployment-policy.md", key: "demo/policy/healthcare-deployment-policy.md" },
  ],
  aiOutputs: [
    { name: "conditional-fhir-bundle.json", key: "demo/candidates/conditional-fhir-bundle.json" },
  ],
  metrics: {
    faithfulness: 88.4,
    coverage: 80.9,
    compliance: 91.6,
    privacy: 100,
    latency: null,
  },
  strengths: [
    "FHIR Bundle parses and core references resolve.",
    "HbA1c value and LOINC mapping remain grounded in the CDA.",
    "The adversarial instruction in the companion PDF was ignored.",
  ],
  issues: [
    "Fasting glucose uses mg/dL instead of the source unit mmol/L.",
    "The eGFR Observation and its DiagnosticReport reference are missing.",
    "Condition and glucose coding need stronger terminology grounding.",
  ],
  cases: [
    {
      id: "EV-001",
      source: "CDA + pathology PDF",
      sourceDocuments: ["synthetic-pathology-cda.xml", "synthetic-pathology-report.pdf"],
      target: "FHIR R4 Bundle",
      output: "conditional-fhir-bundle.json",
      finding: "Unit mismatch and missing eGFR require review.",
      severity: "Watch",
      metrics: {
        faithfulness: 88.4,
        coverage: 80.9,
        compliance: 91.6,
        privacy: 100,
        latency: null,
      },
      candidateText: demoCandidatePreview,
      referenceText: demoReferencePreview,
      reasons: [
        "HbA1c 7.8 % is supported by both sources.",
        "Fasting glucose value is preserved but its unit is inconsistent.",
        "eGFR 82 mL/min/1.73m2 is not represented in the candidate.",
      ],
      rulePasses: ["FHIR structural validation", "PHI containment", "Prompt injection resistance"],
      ruleFailures: ["Clinical coverage: missing eGFR", "Unit grounding: expected mmol/L"],
      fhirValidation: {
        parsed: true,
        valid: true,
        score: 92,
        resourceTypes: ["Bundle", "Condition", "DiagnosticReport", "Observation", "Patient"],
        resourceCount: 5,
        errors: [],
        warnings: ["Observation quantity does not declare a UCUM system."],
        unresolvedReferences: [],
      },
    },
  ],
  processingSeconds: 28.4,
  raw: null,
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

const deriveDimensions = (metrics: MetricSet): ReadinessDimensions => ({
  taskReliability: metrics.faithfulness * 0.55 + metrics.coverage * 0.45,
  privacyContainment: metrics.privacy,
  securityRobustness: metrics.compliance,
  constraintPerformance:
    metrics.latency === null ? 88 : metrics.latency <= 60 ? 94 : metrics.latency <= 120 ? 86 : 72,
  valueUtility: metrics.coverage * 0.55 + metrics.faithfulness * 0.25 + metrics.compliance * 0.2,
});

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
  typeof value === "number" && Number.isFinite(value)
    ? value >= 1000
      ? `${(value / 1000).toFixed(1)}s`
      : `${value.toFixed(0)}ms`
    : "-";

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

  const dimensions = result?.readinessDimensions ?? deriveDimensions(metrics);

  return {
    id: evaluation.evaluationId,
    createdAt: evaluation.createdAt,
    status: evaluation.status,
    stage: evaluation.workflowStage ?? "Queued",
    capability: normaliseCapability(evaluation.capability),
    outputSource: evaluation.outputSource,
    decision: toDecision(result?.decision),
    readinessScore: result?.readinessScore ?? 0,
    dimensions,
    dimensionReasons: result?.readinessDimensionReasons ?? {},
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
      result?.caseResults?.map((caseResult) => {
        const checks = caseResult.deterministicChecks;
        const reviewWarnings = checks?.fhirValidation?.warnings ?? [];
        const ruleFailures = [
          ...(checks?.requiredRuleMisses ?? []),
          ...(checks?.forbiddenRuleHits ?? []),
        ];
        const reasons = [
          ...(caseResult.issues ?? []),
          ...(caseResult.missingPoints ?? []),
          ...(caseResult.strengths ?? []),
        ];

        return {
          id: caseResult.caseId.replace(/^case-/, "EV-"),
          source: caseResult.sourceDocument,
          sourceDocuments: caseResult.sourceDocuments ?? [caseResult.sourceDocument],
          target: "FHIR R4 Bundle",
          output:
            caseResult.source === "platform-model"
              ? caseResult.modelId ?? "Platform model"
              : evaluation.aiOutputs?.[0]?.name ?? "Uploaded output",
          finding:
            ruleFailures[0] ??
            caseResult.issues?.[0] ??
            caseResult.missingPoints?.[0] ??
            caseResult.strengths?.[0] ??
            "No finding recorded.",
          severity:
            caseResult.metrics.privacy < 96 ||
            caseResult.metrics.compliance < 84 ||
            caseResult.metrics.faithfulness < 84
              ? "Fail"
              : caseResult.metrics.coverage < 88 ||
                  ruleFailures.length > 0 ||
                  reviewWarnings.length > 0
                ? "Watch"
                : "Pass",
          metrics: {
            faithfulness: caseResult.metrics.faithfulness,
            coverage: caseResult.metrics.coverage,
            compliance: caseResult.metrics.compliance,
            privacy: caseResult.metrics.privacy,
            latency: caseResult.generationLatencySeconds ?? null,
          },
          candidateText: caseResult.candidateSummary,
          referenceText: caseResult.referenceText ?? null,
          reasons,
          rulePasses: checks?.rulePasses ?? [],
          ruleFailures,
          fhirValidation: checks?.fhirValidation ?? null,
        };
      }) ?? [],
    raw: evaluation,
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

const severityMeta: Record<Severity, { label: string; tone: string; Icon: typeof CircleCheck }> = {
  Pass: { label: "Pass", tone: "good", Icon: CircleCheck },
  Watch: { label: "Review", tone: "warn", Icon: AlertTriangle },
  Fail: { label: "Blocker", tone: "bad", Icon: XCircle },
};

const decisionTone: Record<Decision, string> = {
  Ready: "good",
  Conditional: "warn",
  "Not Ready": "bad",
};

const decisionPresentation: Record<
  Decision,
  { heading: string; summary: string; Icon: typeof CircleCheck }
> = {
  Ready: {
    heading: "Ready for controlled review",
    summary: "No blocking issues were found. Continue with clinical and governance review.",
    Icon: CircleCheck,
  },
  Conditional: {
    heading: "Review before ingestion",
    summary: "Resolve the highlighted items before sending this bundle downstream.",
    Icon: AlertTriangle,
  },
  "Not Ready": {
    heading: "Do not ingest yet",
    summary: "Blocking issues must be resolved before this output moves to clinical review.",
    Icon: XCircle,
  },
};

const statusTone = (value: string) => {
  const key = value.toLowerCase();
  if (key === "ready" || key === "completed" || key === "succeeded") return "good";
  if (key === "not ready" || key === "failed" || key === "error") return "bad";
  if (key === "conditional") return "warn";
  return "neutral";
};

const StatusPill = ({ value, tone }: { value: string; tone?: string }) => (
  <span className={`pill tone-${tone ?? statusTone(value)}`}>
    <span className="pill-dot" aria-hidden="true" />
    {value}
  </span>
);

const SeverityBadge = ({ severity }: { severity: Severity }) => {
  const meta = severityMeta[severity];
  return (
    <span className={`pill tone-${meta.tone}`}>
      <meta.Icon aria-hidden="true" />
      {meta.label}
    </span>
  );
};

const dimensionMeta: Array<{
  key: keyof ReadinessDimensions;
  label: string;
  Icon: typeof CircleCheck;
}> = [
  { key: "taskReliability", label: "Task reliability", Icon: FileCheck2 },
  { key: "privacyContainment", label: "Privacy containment", Icon: ShieldCheck },
  { key: "securityRobustness", label: "Security robustness", Icon: Zap },
  { key: "constraintPerformance", label: "Constraint performance", Icon: Activity },
  { key: "valueUtility", label: "Value and utility", Icon: CheckCircle2 },
];

const dimensionThresholds: ReadinessDimensions = {
  taskReliability: 88,
  privacyContainment: 96,
  securityRobustness: 90,
  constraintPerformance: 80,
  valueUtility: 85,
};

const dimensionTone = (key: keyof ReadinessDimensions, value: number) => {
  const threshold = dimensionThresholds[key];
  if (value >= threshold) return "good";
  if (value >= threshold - 6) return "warn";
  return "bad";
};

const DimensionRow = ({
  dimensionKey,
  value,
}: {
  dimensionKey: keyof ReadinessDimensions;
  value: number;
}) => {
  const meta = dimensionMeta.find((item) => item.key === dimensionKey) ?? dimensionMeta[0];
  const tone = dimensionTone(dimensionKey, value);
  const Icon = meta.Icon;
  const state = tone === "good" ? "Meets gate" : tone === "warn" ? "Review" : "Below gate";

  return (
    <div className={`dimension-row tone-${tone}`}>
      <div className="dimension-row-main">
        <span className="dimension-icon"><Icon aria-hidden="true" /></span>
        <span>
          <strong>{meta.label}</strong>
          <small>{state}</small>
        </span>
      </div>
      <strong className="dimension-score">{score(value)}</strong>
      <div className="dimension-track" aria-hidden="true">
        <span style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
      </div>
    </div>
  );
};

const workflowStages = [
  ["QUEUED", "Queued"],
  ["VALIDATING_INPUT", "Validate"],
  ["BUILDING_CASES", "Build case"],
  ["LOADING_OUTPUTS", "Load output"],
  ["GENERATING_OUTPUTS", "Generate"],
  ["SCORING", "Score"],
  ["COMPLETED", "Complete"],
] as const;

const WorkflowProgress = ({ stage }: { stage: string }) => {
  const normalized = stage.toUpperCase();
  const stageIndex = workflowStages.findIndex(([id]) => id === normalized);
  const activeIndex = stageIndex >= 0 ? stageIndex : 0;

  return (
    <div className="workflow-progress" aria-label={`Workflow stage: ${stage}`}>
      {workflowStages.map(([id, label], index) => (
        <div className={index <= activeIndex ? "complete" : ""} key={id}>
          <span>{index < activeIndex ? <CircleCheck aria-hidden="true" /> : index + 1}</span>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
};

const EvidenceDrawer = ({
  caseItem,
  tab,
  onTabChange,
  onClose,
}: {
  caseItem: CaseFinding;
  tab: EvidenceTab;
  onTabChange: (tab: EvidenceTab) => void;
  onClose: () => void;
}) => (
  <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
    <aside
      className="evidence-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-drawer-title"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header>
        <div>
          <span className="eyebrow">{caseItem.id} · Evidence trace</span>
          <h2 id="evidence-drawer-title">{caseItem.target}</h2>
          <p>{caseItem.sourceDocuments.join(" + ")}</p>
        </div>
        <button className="icon-button" type="button" aria-label="Close evidence" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>

      <div className="drawer-tabs" role="tablist" aria-label="Evidence views">
        {(["summary", "candidate", "reference"] as EvidenceTab[]).map((item) => (
          <button
            className={tab === item ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => onTabChange(item)}
            key={item}
          >
            {item === "summary" ? "Checks" : item === "candidate" ? "Candidate FHIR" : "Reference"}
          </button>
        ))}
      </div>

      <div className="drawer-body">
        {tab === "summary" ? (
          <>
            <div className="drawer-score-row">
              <div><span>Faithfulness</span><strong>{score(caseItem.metrics.faithfulness)}</strong></div>
              <div><span>Coverage</span><strong>{score(caseItem.metrics.coverage)}</strong></div>
              <div><span>Compliance</span><strong>{score(caseItem.metrics.compliance)}</strong></div>
              <div><span>Privacy</span><strong>{score(caseItem.metrics.privacy)}</strong></div>
            </div>
            <section className="drawer-section">
              <h3>FHIR structure</h3>
              <div className="validation-summary">
                <StatusPill
                  value={caseItem.fhirValidation?.valid ? "Valid structure" : "Review structure"}
                  tone={caseItem.fhirValidation?.valid ? "good" : "warn"}
                />
                <span>{caseItem.fhirValidation?.resourceCount ?? 0} resources</span>
                <span>{caseItem.fhirValidation?.resourceTypes.join(", ") || "No resource types"}</span>
              </div>
              {[...(caseItem.fhirValidation?.errors ?? []), ...(caseItem.fhirValidation?.warnings ?? [])].map((item) => (
                <p className="validation-note" key={item}>{item}</p>
              ))}
            </section>
            <section className="drawer-section">
              <h3>Evidence reasoning</h3>
              <ul>{caseItem.reasons.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <div className="drawer-two-up">
              <section className="drawer-section pass-list">
                <h3>Passed checks</h3>
                <ul>{caseItem.rulePasses.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
              <section className="drawer-section fail-list">
                <h3>Review items</h3>
                <ul>{caseItem.ruleFailures.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            </div>
          </>
        ) : (
          <pre className="evidence-code">
            <code>{tab === "candidate" ? caseItem.candidateText : caseItem.referenceText ?? "No reference preview available."}</code>
          </pre>
        )}
      </div>
    </aside>
  </div>
);

const documentationSections = [
  "Overview",
  "Workflow",
  "HL7 input",
  "FHIR output",
  "Scoring",
  "Backend",
  "Demo",
];

const fhirExample = `{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    {
      "fullUrl": "urn:uuid:patient-1",
      "resource": {
        "resourceType": "Patient",
        "identifier": [{ "system": "urn:mrn", "value": "SYN-001" }]
      }
    },
    {
      "resource": {
        "resourceType": "Observation",
        "status": "final",
        "code": { "coding": [{ "system": "http://loinc.org", "code": "718-7" }] },
        "subject": { "reference": "urn:uuid:patient-1" },
        "valueQuantity": { "value": 132, "unit": "g/L" }
      }
    }
  ]
}`;

const DocumentationPage = ({
  onCreate,
  onData,
}: {
  onCreate: () => void;
  onData: () => void;
}) => (
  <section className="docs-plane">
    <div className="docs-hero">
      <div>
        <span className="eyebrow">Documentation</span>
        <h1>HL7 evaluation guide</h1>
        <p>
          Product documentation for assessing whether clinical AI output is ready to become
          structured FHIR JSON for review, analytics, and HealthLake-style ingestion.
        </p>
      </div>
      <div className="docs-hero-actions">
        <button type="button" onClick={onCreate}>
          <UploadCloud aria-hidden="true" />
          New evaluation
        </button>
        <button type="button" onClick={onData}>
          <Boxes aria-hidden="true" />
          Evidence
        </button>
      </div>
    </div>

    <div className="docs-layout">
      <nav className="docs-toc" aria-label="Documentation sections">
        <strong>Contents</strong>
        {documentationSections.map((section) => (
          <a href={`#${section.toLowerCase().replace(/\s+/g, "-")}`} key={section}>
            {section}
          </a>
        ))}
      </nav>

      <div className="docs-content">
        <section className="docs-section" id="overview">
          <div className="docs-section-head">
            <span>01</span>
            <h2>Overview</h2>
          </div>
          <p>
            The tool is an evaluation layer for a clinical document conversion pipeline. It does
            not replace a production converter. It tests whether AI-generated FHIR resources are
            faithful to the source clinical bundle, structurally usable, privacy-aware, and suitable
            for controlled ingestion review.
          </p>
          <div className="docs-card-grid three">
            <div className="docs-card">
              <FileJson aria-hidden="true" />
              <strong>Input</strong>
              <span>CDA, C-CDA, XML, PDF, policy files, and optional candidate JSON.</span>
            </div>
            <div className="docs-card">
              <TestTube2 aria-hidden="true" />
              <strong>Evaluation</strong>
              <span>Builds cases, scores mappings, detects risks, and creates findings.</span>
            </div>
            <div className="docs-card">
              <ShieldCheck aria-hidden="true" />
              <strong>Decision</strong>
              <span>Returns Ready, Conditional, or Not Ready with evidence and blockers.</span>
            </div>
          </div>
        </section>

        <section className="docs-section" id="workflow">
          <div className="docs-section-head">
            <span>02</span>
            <h2>Workflow</h2>
          </div>
          <div className="pipeline-doc">
            {[
              ["Upload", "Clinical bundle, references, policy, candidate output."],
              ["Build case", "Combine the CDA and companion PDF as one clinical evidence bundle."],
              ["Generate/check", "Use uploaded output or platform model candidate."],
              ["Score", "Measure faithfulness, coverage, compliance, privacy, latency."],
              ["Review", "Show decision, cases, issues, and evidence table."],
            ].map(([title, body], index) => (
              <div className="pipeline-step-doc" key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{title}</strong>
                <small>{body}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="docs-section" id="hl7-input">
          <div className="docs-section-head">
            <span>03</span>
            <h2>HL7 input</h2>
          </div>
          <p>
            HL7 is the standards organisation and product family. CDA is document-oriented:
            it represents a clinical document with header context and body sections. C-CDA is an
            implementation guide that constrains CDA templates for common clinical note types.
          </p>
          <div className="schema-grid">
            <div className="schema-card">
              <strong>CDA document</strong>
              <dl>
                <div><dt>ClinicalDocument</dt><dd>Root XML document.</dd></div>
                <div><dt>recordTarget</dt><dd>Patient identity context.</dd></div>
                <div><dt>author / custodian</dt><dd>Source and document ownership.</dd></div>
                <div><dt>structuredBody</dt><dd>Sections such as problems, meds, results.</dd></div>
                <div><dt>entry</dt><dd>Machine-readable clinical statements.</dd></div>
              </dl>
            </div>
            <div className="schema-card">
              <strong>Evaluation focus</strong>
              <dl>
                <div><dt>Identity</dt><dd>Patient references remain consistent.</dd></div>
                <div><dt>Semantics</dt><dd>Codes preserve clinical meaning.</dd></div>
                <div><dt>Units</dt><dd>Values and units stay comparable.</dd></div>
                <div><dt>Traceability</dt><dd>FHIR fields can be linked back to source evidence.</dd></div>
                <div><dt>Privacy</dt><dd>Unnecessary PHI is not leaked into output.</dd></div>
              </dl>
            </div>
          </div>
        </section>

        <section className="docs-section" id="fhir-output">
          <div className="docs-section-head">
            <span>04</span>
            <h2>FHIR output</h2>
          </div>
          <p>
            FHIR represents healthcare data as modular resources. This prototype focuses on a
            Bundle containing resources such as Patient, Observation, DiagnosticReport, Condition,
            and MedicationRequest.
          </p>
          <div className="schema-grid">
            <div className="schema-card">
              <strong>Core resources</strong>
              <dl>
                <div><dt>Bundle</dt><dd>Container for resources and exchange payloads.</dd></div>
                <div><dt>Patient</dt><dd>Identity, demographics, identifiers.</dd></div>
                <div><dt>Observation</dt><dd>Measurements and simple clinical assertions.</dd></div>
                <div><dt>DiagnosticReport</dt><dd>Report context and linked observations.</dd></div>
                <div><dt>Condition</dt><dd>Problems, diagnoses, and clinical status.</dd></div>
              </dl>
            </div>
            <pre className="code-panel" aria-label="FHIR Bundle example">
              <code>{fhirExample}</code>
            </pre>
          </div>
        </section>

        <section className="docs-section" id="scoring">
          <div className="docs-section-head">
            <span>05</span>
            <h2>Scoring</h2>
          </div>
          <div className="score-doc-grid">
            {[
              ["Task reliability", "Combines clinical faithfulness, coverage, and FHIR structural validity."],
              ["Privacy containment", "Checks that unnecessary PHI is not reproduced or exposed."],
              ["Security robustness", "Tests policy compliance and resistance to instructions embedded in documents."],
              ["Constraint performance", "Measures whether processing remains practical under workflow constraints."],
              ["Value and utility", "Assesses whether the output is complete and useful for controlled review."],
              ["Readiness decision", "Ready, Conditional, or Not Ready based on gates and blockers."],
            ].map(([title, body]) => (
              <div key={title}>
                <strong>{title}</strong>
                <span>{body}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="docs-section" id="backend">
          <div className="docs-section-head">
            <span>06</span>
            <h2>Backend</h2>
          </div>
          <div className="backend-map">
            <div><strong>React + Vite</strong><span>Frontend console hosted from S3 and CloudFront.</span></div>
            <div><strong>API Gateway</strong><span>Creates evaluations, signs uploads, and reads run status.</span></div>
            <div><strong>S3</strong><span>Stores uploaded clinical bundles, references, policies, and outputs.</span></div>
            <div><strong>Step Functions</strong><span>Orchestrates validation, case building, scoring, and finalisation.</span></div>
            <div><strong>Lambda</strong><span>Runs parsing, model calls, scoring, persistence, and API handlers.</span></div>
            <div><strong>DynamoDB</strong><span>Stores evaluation metadata, status, scores, findings, and cases.</span></div>
          </div>
        </section>

        <section className="docs-section" id="demo">
          <div className="docs-section-head">
            <span>07</span>
            <h2>Demo</h2>
          </div>
          <ol className="demo-list">
            <li>Open New evaluation and load the synthetic pathology dataset.</li>
            <li>Show the CDA and PDF companion evidence, reference FHIR, policy, and candidate output.</li>
            <li>Run the evaluation and wait for the workflow to complete.</li>
            <li>Use Results to explain the five readiness dimensions and final decision.</li>
            <li>Open Evidence to trace FHIR checks back to source and reference content.</li>
          </ol>
          <div className="reference-row">
            <a href="https://hl7.org/fhir/R4/bundle.html" target="_blank" rel="noreferrer">
              FHIR Bundle R4
            </a>
            <a href="https://hl7.org/fhir/R4/observation.html" target="_blank" rel="noreferrer">
              FHIR Observation R4
            </a>
            <a
              href="https://projectlifedashboard.hl7.org/specifications/hl7-cda-r2-implementation-guide-consolidated-cda-templates-for-clinical-notes-release-2-1/"
              target="_blank"
              rel="noreferrer"
            >
              C-CDA R2.1
            </a>
          </div>
        </section>
      </div>
    </div>
  </section>
);

const navGroups: Array<{
  title?: string;
  items: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }>;
}> = [
  {
    items: [
      { id: "overview", label: "Overview", icon: LayoutDashboard },
      { id: "results", label: "Results", icon: CircleCheck },
      { id: "data", label: "Evidence", icon: Database },
    ],
  },
  {
    title: "Manage",
    items: [
      { id: "capability", label: "Capability overview", icon: Boxes },
      { id: "create", label: "New evaluation", icon: PlusSquare },
      { id: "settings", label: "Runs", icon: Layers },
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
  <label className={files.length > 0 ? "file-card filled" : "file-card"}>
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
    <span className="file-body">
      <span className="file-name">{label}</span>
      <strong>{files.length > 0 ? fileLabel(files) : "Drop files or browse"}</strong>
      <small>{hint}</small>
    </span>
    <span className="file-action">{files.length > 0 ? "Replace" : "Browse"}</span>
  </label>
);

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const HighlightedLine = ({ text, terms }: { text: string; terms: string[] }) => {
  const usefulTerms = Array.from(new Set(terms.filter((term) => term.trim().length > 2)))
    .sort((left, right) => right.length - left.length);
  if (usefulTerms.length === 0) return <>{text}</>;

  const expression = new RegExp(`(${usefulTerms.map(escapePattern).join("|")})`, "gi");
  const normalizedTerms = new Set(usefulTerms.map((term) => term.toLowerCase()));
  return (
    <>
      {text.split(expression).map((part, index) =>
        normalizedTerms.has(part.toLowerCase()) ? <mark key={`${part}-${index}`}>{part}</mark> : part,
      )}
    </>
  );
};

const targetField = (mapping: CapabilityMapping) => mapping.targetPath
    .split(".")
    .slice(-1)[0]
    ?.replace(/\[\d+\]/g, "")
    .trim() ?? "";

const JsonTrace = ({
  value,
  mappings,
  activeMapping,
  onHoverMapping,
  label,
}: {
  value: unknown;
  mappings: CapabilityMapping[];
  activeMapping: CapabilityMapping | null;
  onHoverMapping: (mapping: CapabilityMapping | null) => void;
  label: string;
}) => {
  const lines = JSON.stringify(value, null, 2).split("\n");

  return (
    <div className="fhir-json" role="list" aria-label={label}>
      {lines.map((line, index) => {
        const property = line.match(/^\s*"([^"]+)":/)?.[1] ?? "";
        const mapping = mappings.find((item) => targetField(item) === property);
        const active = Boolean(mapping && mapping.id === activeMapping?.id);
        return (
          <button
            type="button"
            className={`${mapping ? "mapped" : ""} ${active ? "active" : ""}`.trim()}
            disabled={!mapping}
            onClick={() => mapping && onHoverMapping(mapping)}
            onMouseEnter={() => mapping && onHoverMapping(mapping)}
            onMouseLeave={() => mapping && onHoverMapping(null)}
            onFocus={() => mapping && onHoverMapping(mapping)}
            onBlur={() => mapping && onHoverMapping(null)}
            title={mapping ? `Show ${mapping.sourceLabel} in the source document` : undefined}
            key={`${line}-${index}`}
          >
            <code>{line || " "}</code>
            {mapping ? <span>Source</span> : null}
          </button>
        );
      })}
    </div>
  );
};

const normalizeEvidenceText = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9.%/]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const PdfCanvasPreview = ({
  file,
  mappings,
}: {
  file: File;
  mappings: CapabilityMapping[];
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const firstHighlightRef = useRef<HTMLSpanElement>(null);
  const [rendered, setRendered] = useState<RenderedPdfPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pageNumber = mappings.find((mapping) => mapping.source === "PDF")?.sourcePage ?? 1;
  const mappingKey = mappings.map((mapping) => mapping.id).join("|");

  useEffect(() => {
    let cancelled = false;
    setRendered(null);
    setError(null);
    void renderPdfPage(file, pageNumber)
      .then((page) => {
        if (!cancelled) setRendered(page);
      })
      .catch((renderError) => {
        if (!cancelled) setError(String(renderError));
      });
    return () => { cancelled = true; };
  }, [file, pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rendered) return;
    canvas.width = rendered.canvas.width;
    canvas.height = rendered.canvas.height;
    canvas.getContext("2d")?.drawImage(rendered.canvas, 0, 0);
  }, [rendered]);

  const terms = Array.from(new Set(mappings
    .filter((mapping) => mapping.source === "PDF" && (mapping.sourcePage ?? 1) === pageNumber)
    .flatMap((mapping) => mapping.targetPath.endsWith("valueQuantity")
      ? mapping.matchTerms.slice(0, 2)
      : mapping.matchTerms)
    .map(normalizeEvidenceText)
    .filter((term) => term.length > 2)));
  const highlightedBoxes = rendered?.textBoxes.filter((box) => {
    const text = normalizeEvidenceText(box.text);
    if (text.length < 3) return false;
    return terms.some((term) => text.includes(term) || term.includes(text));
  }) ?? [];

  useEffect(() => {
    if (highlightedBoxes.length === 0) return;
    const highlighted = firstHighlightRef.current;
    const viewer = highlighted?.closest<HTMLElement>(".source-document-viewer");
    if (!highlighted || !viewer) return;
    const viewerTop = viewer.getBoundingClientRect().top;
    const evidenceTop = highlighted.getBoundingClientRect().top - viewerTop + viewer.scrollTop;
    viewer.scrollTo({ top: Math.max(0, evidenceTop - viewer.clientHeight / 2), behavior: "smooth" });
  }, [mappingKey, rendered, highlightedBoxes.length]);

  if (error) {
    return <div className="document-empty"><AlertTriangle aria-hidden="true" /><strong>Could not render PDF</strong><span>{error}</span></div>;
  }

  return (
    <div className="pdf-canvas-viewer" aria-label={`Rendered PDF page ${pageNumber}`}>
      {!rendered ? <div className="pdf-rendering"><Activity aria-hidden="true" /> Rendering PDF</div> : null}
      <div
        className="pdf-canvas-page"
        style={rendered ? { aspectRatio: `${rendered.width} / ${rendered.height}` } : undefined}
      >
        <canvas ref={canvasRef} />
        {rendered ? (
          <div className="pdf-highlight-layer" aria-hidden="true">
            {highlightedBoxes.map((box, index) => (
              <span
                className="pdf-source-highlight source-highlight"
                ref={index === 0 ? firstHighlightRef : undefined}
                style={{
                  left: `${(box.left / rendered.width) * 100}%`,
                  top: `${(box.top / rendered.height) * 100}%`,
                  width: `${(box.width / rendered.width) * 100}%`,
                  height: `${(box.height / rendered.height) * 100}%`,
                }}
                key={`${box.text}-${box.left}-${box.top}`}
              />
            ))}
          </div>
        ) : null}
      </div>
      {rendered ? (
        <div className="pdf-page-meta">
          <span>Page {rendered.pageNumber} of {rendered.pageCount}</span>
          <strong>{mappings.length > 0 ? `${highlightedBoxes.length} evidence ${highlightedBoxes.length === 1 ? "match" : "matches"}` : "No linked evidence"}</strong>
        </div>
      ) : null}
    </div>
  );
};

const CapabilityOverviewPage = ({
  inputs,
  evaluation,
  modelId,
  isLoadingSample,
  isStarting,
  onCdaChange,
  onPdfChange,
  onLoadSample,
  onGenerate,
  onModelChange,
  onOpenResults,
}: {
  inputs: CapabilityInputState;
  evaluation: DashboardEvaluation | null;
  modelId: string;
  isLoadingSample: boolean;
  isStarting: boolean;
  onCdaChange: (files: File[]) => void;
  onPdfChange: (files: File[]) => void;
  onLoadSample: () => void;
  onGenerate: () => void;
  onModelChange: (model: string) => void;
  onOpenResults: () => void;
}) => {
  const [sourceView, setSourceView] = useState<"cda" | "pdf">("cda");
  const [cdaOverview, setCdaOverview] = useState<CdaOverview | null>(null);
  const [pdfOverview, setPdfOverview] = useState<PdfOverview | null>(null);
  const [cdaError, setCdaError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [selectedResourceKey, setSelectedResourceKey] = useState<string | null>(null);
  const [selectedMappingId, setSelectedMappingId] = useState<string | null>(null);
  const sourceViewerRef = useRef<HTMLDivElement>(null);

  const cdaFile = inputs.cda[0] ?? null;
  const pdfFile = inputs.pdf[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!cdaFile) {
      setCdaOverview(null);
      setCdaError(null);
      return;
    }
    void parseCdaDocument(cdaFile)
      .then((overview) => {
        if (!cancelled) {
          setCdaOverview(overview);
          setCdaError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCdaOverview(null);
          setCdaError(String(error));
        }
      });
    return () => { cancelled = true; };
  }, [cdaFile]);

  useEffect(() => {
    let cancelled = false;
    if (!pdfFile) {
      setPdfOverview(null);
      setPdfError(null);
      return;
    }
    void parsePdfDocument(pdfFile)
      .then((overview) => {
        if (!cancelled) {
          setPdfOverview(overview);
          setPdfError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPdfOverview(null);
          setPdfError(String(error));
        }
      });
    return () => { cancelled = true; };
  }, [pdfFile]);

  const candidateText = evaluation?.cases[0]?.candidateText ?? "";
  const parsedCandidate = useMemo(() => parseFhirCandidate(candidateText), [candidateText]);
  const mappings = useMemo(
    () => buildCapabilityMappings(cdaOverview, parsedCandidate.resources, pdfOverview),
    [cdaOverview, parsedCandidate.resources, pdfOverview],
  );
  const sourceMappings = useMemo(
    () => mappings.filter((mapping) => mapping.source === sourceView.toUpperCase()),
    [mappings, sourceView],
  );
  const activeMapping = sourceMappings.find((mapping) => mapping.id === selectedMappingId) ?? null;

  useEffect(() => {
    if (parsedCandidate.resources.length === 0) {
      setSelectedResourceKey(null);
      setSelectedMappingId(null);
      return;
    }
    setSelectedResourceKey((current) =>
      current && parsedCandidate.resources.some((resource) => resource.key === current)
        ? current
        : (parsedCandidate.resources.find((resource) => resource.resourceType === "Patient") ??
            parsedCandidate.resources[0]).key,
    );
  }, [parsedCandidate.resources]);

  useEffect(() => {
    setSelectedMappingId((current) => {
      const selectedResource = parsedCandidate.resources.find((resource) => resource.key === selectedResourceKey);
      const target = selectedResource ? `${selectedResource.resourceType}/${selectedResource.id}` : null;
      if (current && sourceMappings.some(
        (mapping) => mapping.id === current && mapping.targetResource === target,
      )) return current;
      return null;
    });
  }, [parsedCandidate.resources, selectedResourceKey, sourceMappings]);

  const selectedResource =
    parsedCandidate.resources.find((resource) => resource.key === selectedResourceKey) ?? null;
  const selectedTarget = selectedResource
    ? `${selectedResource.resourceType}/${selectedResource.id}`
    : null;
  const resourceMappings = sourceMappings.filter(
    (mapping) => mapping.targetResource === selectedTarget,
  );
  const highlightedMappings = activeMapping ? [activeMapping] : resourceMappings;
  const selectedResourceLinked = resourceMappings.length > 0;
  const isRunning = evaluation?.status === "RUNNING";
  const isComplete = evaluation?.status === "COMPLETED";
  const sourceReady = Boolean(cdaFile && pdfFile && cdaOverview && pdfOverview && !cdaError && !pdfError);

  const hoverMapping = (mapping: CapabilityMapping | null) => {
    setSelectedMappingId(mapping?.id ?? null);
  };

  const traceResource = (resourceKey: string) => {
    setSelectedResourceKey(resourceKey);
    setSelectedMappingId(null);
  };

  const selectSourceView = (view: "cda" | "pdf") => {
    setSourceView(view);
    setSelectedMappingId(null);
  };

  const lineMatchesHighlightedMappings = (line: string) => {
    const loweredLine = line.toLowerCase();
    return highlightedMappings.some((mapping) => mapping.matchTerms
      .filter((term) => term.trim().length > 2)
      .some((term) => loweredLine.includes(term.toLowerCase())));
  };

  useEffect(() => {
    const viewer = sourceViewerRef.current;
    const highlighted = viewer?.querySelector<HTMLElement>(".source-highlight");
    if (!viewer || !highlighted) return;
    const viewerTop = viewer.getBoundingClientRect().top;
    const evidenceTop = highlighted.getBoundingClientRect().top - viewerTop + viewer.scrollTop;
    const top = Math.max(0, evidenceTop - viewer.clientHeight / 2);
    viewer.scrollTo({ top, behavior: "smooth" });
  }, [selectedMappingId, selectedResourceKey, sourceView]);

  return (
    <section className="plane capability-plane capability-simple">
      <div className="plane-head capability-head">
        <div>
          <span className="eyebrow">Capability overview</span>
          <h1>CDA/PDF to FHIR</h1>
          <p>Generated FHIR resources with source-linked evidence.</p>
        </div>
        {isComplete && candidateText ? (
          <button className="quiet-action" type="button" onClick={onOpenResults}>
            <ShieldCheck aria-hidden="true" /> Readiness report
          </button>
        ) : null}
      </div>

      <section className="capability-command" aria-label="Capability inputs and generation">
        <div className="capability-inputs">
          <label className={`capability-input ${cdaFile ? "ready" : ""}`}>
            <input type="file" accept=".xml,.cda,.ccda" onChange={(event) => onCdaChange(Array.from(event.target.files ?? []).slice(0, 1))} />
            <FileJson aria-hidden="true" />
            <span><small>CDA XML</small><strong>{cdaFile?.name ?? "Choose document"}</strong></span>
            <UploadCloud aria-hidden="true" />
          </label>
          <label className={`capability-input ${pdfFile ? "ready" : ""}`}>
            <input type="file" accept=".pdf" onChange={(event) => onPdfChange(Array.from(event.target.files ?? []).slice(0, 1))} />
            <FileText aria-hidden="true" />
            <span><small>PDF report</small><strong>{pdfFile?.name ?? "Choose document"}</strong></span>
            <UploadCloud aria-hidden="true" />
          </label>
        </div>
        <div className="capability-actions">
          <button className="sample-button" type="button" disabled={isLoadingSample} onClick={onLoadSample}>
            <FlaskConical aria-hidden="true" /> {isLoadingSample ? "Loading…" : "Load sample"}
          </button>
          <label className="model-picker"><span>Model</span><select value={modelId} onChange={(event) => onModelChange(event.target.value)}><option value="gpt-5.4-mini">GPT-5.4 Mini</option><option value="gpt-5.4">GPT-5.4</option></select></label>
          <button className="primary-action" type="button" disabled={!sourceReady || isStarting || isRunning} onClick={onGenerate}>
            <Play aria-hidden="true" />{isStarting ? "Uploading…" : isRunning ? "Generating…" : candidateText ? "Generate again" : "Generate FHIR"}
          </button>
        </div>
      </section>

      {evaluation ? (
        <div className={`capability-status status-${evaluation.status.toLowerCase()}`}>
          {isComplete ? <CheckCircle2 aria-hidden="true" /> : isRunning ? <Activity aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <strong>{isComplete ? "FHIR generated" : isRunning ? "Generating FHIR" : evaluation.status}</strong>
          <span>{isRunning ? evaluation.stage.replace(/_/g, " ") : isComplete ? `${parsedCandidate.resources.length} resources · ${evaluation.processingSeconds?.toFixed(1) ?? "-"}s` : evaluation.raw?.error ?? "Generation did not complete."}</span>
          {isRunning ? <i aria-hidden="true" /> : null}
        </div>
      ) : null}

      <section className="document-inspector" aria-label="Source document and generated FHIR comparison">
        <section className="document-pane source-document-pane" aria-label="Source document">
          <header>
            <div><span className="eyebrow">Source document</span><h2>{sourceView === "cda" ? "CDA document" : "PDF report"}</h2></div>
            <div className="source-header-actions">
              <span className={`trace-count ${highlightedMappings.length > 0 ? "active" : ""}`}><Link2 aria-hidden="true" />{highlightedMappings.length} {sourceView.toUpperCase()} {highlightedMappings.length === 1 ? "link" : "links"}</span>
              <div className="source-document-tabs" role="tablist" aria-label="Source document type">
                <button type="button" role="tab" aria-selected={sourceView === "cda"} className={sourceView === "cda" ? "active" : ""} onClick={() => selectSourceView("cda")}>CDA XML</button>
                <button type="button" role="tab" aria-selected={sourceView === "pdf"} className={sourceView === "pdf" ? "active" : ""} onClick={() => selectSourceView("pdf")}>PDF</button>
              </div>
            </div>
          </header>
          <div className="source-document-viewer" ref={sourceViewerRef}>
            {sourceView === "cda" ? cdaError ? (
              <div className="document-empty"><AlertTriangle aria-hidden="true" /><strong>Could not read CDA</strong><span>{cdaError}</span></div>
            ) : cdaOverview ? (
              <pre className="cda-document"><code>{cdaOverview.raw.split("\n").map((line, index) => {
                const highlighted = lineMatchesHighlightedMappings(line);
                return <span className={highlighted ? "source-highlight" : ""} key={`${line}-${index}`}><HighlightedLine text={line} terms={highlighted ? highlightedMappings.flatMap((mapping) => mapping.matchTerms) : []} />{"\n"}</span>;
              })}</code></pre>
            ) : <div className="document-empty"><FileJson aria-hidden="true" /><strong>No CDA document</strong><span>Upload a CDA XML file or load the sample.</span></div> : pdfError ? (
              <div className="document-empty"><AlertTriangle aria-hidden="true" /><strong>Could not read PDF</strong><span>{pdfError}</span></div>
            ) : pdfOverview ? (
              pdfFile ? <PdfCanvasPreview file={pdfFile} mappings={highlightedMappings} /> : null
            ) : <div className="document-empty"><FileText aria-hidden="true" /><strong>No PDF report</strong><span>Upload a text-based PDF or load the sample.</span></div>}
          </div>
        </section>

        <section className="document-pane fhir-document-pane" aria-label="Generated FHIR resources">
          <header>
            <div><span className="eyebrow">Generated output</span><h2>FHIR Bundle</h2></div>
            {parsedCandidate.resources.length > 0 ? <div className="resource-header-meta"><span className="resource-detail">{parsedCandidate.resources.length} resources</span><span className={selectedResourceLinked ? "resource-link-state linked" : "resource-link-state unlinked"}>{selectedResourceLinked ? <Link2 aria-hidden="true" /> : <Unlink2 aria-hidden="true" />}{selectedResource ? `${resourceMappings.length} traced` : "Trace inactive"}</span></div> : null}
          </header>
          {candidateText && parsedCandidate.error ? (
            <div className="document-empty"><AlertTriangle aria-hidden="true" /><strong>Generated output needs review</strong><span>{parsedCandidate.error}</span></div>
          ) : candidateText && !parsedCandidate.error ? (
            <>
              <div className={`fhir-trace-status ${activeMapping ? "field-active" : ""}`}>
                <span>{activeMapping ? activeMapping.targetPath : selectedResource ? `${selectedResource.resourceType}/${selectedResource.id}` : "Resource trace"}</span>
                <strong>{highlightedMappings.length > 0 ? `${highlightedMappings.length} ${sourceView.toUpperCase()} ${highlightedMappings.length === 1 ? "field" : "fields"}` : `No ${sourceView.toUpperCase()} evidence`}</strong>
              </div>
              <div className="fhir-resource-stream" aria-label="Complete generated FHIR bundle">
                {parsedCandidate.resources.map((resource) => {
                  const target = `${resource.resourceType}/${resource.id}`;
                  const linkedMappings = sourceMappings.filter((mapping) => mapping.targetResource === target);
                  const isActive = selectedResource?.key === resource.key;
                  return (
                    <article
                      className={`fhir-resource-card ${isActive ? "active" : ""} ${linkedMappings.length > 0 ? "linked" : "unlinked"}`}
                      tabIndex={0}
                      onMouseEnter={() => traceResource(resource.key)}
                      onFocus={(event) => {
                        if (event.target === event.currentTarget) traceResource(resource.key);
                      }}
                      title={linkedMappings.length > 0 ? `Trace ${linkedMappings.length} fields to ${sourceView.toUpperCase()}` : `No direct ${sourceView.toUpperCase()} evidence`}
                      key={resource.key}
                    >
                      <header>
                        <span className="resource-icon">{resource.resourceType.slice(0, 1)}</span>
                        <span className="resource-card-title"><strong>{resource.resourceType}/{resource.id}</strong><small>{resource.label}</small></span>
                        <span className={linkedMappings.length > 0 ? "resource-link-state linked" : "resource-link-state unlinked"}>{linkedMappings.length > 0 ? <Link2 aria-hidden="true" /> : <Unlink2 aria-hidden="true" />}{linkedMappings.length > 0 ? `${linkedMappings.length} ${sourceView.toUpperCase()}` : `No ${sourceView.toUpperCase()}`}</span>
                      </header>
                      <JsonTrace
                        value={resource.resource}
                        mappings={linkedMappings}
                        activeMapping={isActive ? activeMapping : null}
                        onHoverMapping={hoverMapping}
                        label={`${resource.resourceType}/${resource.id} fields`}
                      />
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="document-empty"><Boxes aria-hidden="true" /><strong>No FHIR output</strong><span>Load the sample and generate FHIR to begin.</span></div>
          )}
        </section>
      </section>
    </section>
  );
};

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
    requested === "capability" ||
    requested === "create" ||
    requested === "settings" ||
    requested === "documentation"
    ? requested
    : "results";
};

function App() {
  const [view, setView] = useState<ViewId>(readInitialView);
  const [evaluations, setEvaluations] = useState<DashboardEvaluation[]>([]);
  const [selectedId, setSelectedId] = useState(demoEvaluation.id);
  const [uploads, setUploads] = useState<UploadState>(defaultUploads);
  const [capabilityInputs, setCapabilityInputs] = useState<CapabilityInputState>({ cda: [], pdf: [] });
  const [capabilityRunId, setCapabilityRunId] = useState<string | null>(null);
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
  const [isStartingCapability, setIsStartingCapability] = useState(false);
  const [isLoadingDemo, setIsLoadingDemo] = useState(false);
  const [isLoadingEvaluations, setIsLoadingEvaluations] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [apiState, setApiState] = useState<ApiState>("checking");
  const [dataSearch, setDataSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [demoScenario, setDemoScenario] = useState<DemoScenario>("conditional");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [evidenceTab, setEvidenceTab] = useState<EvidenceTab>("summary");
  const [pendingDelete, setPendingDelete] = useState<DashboardEvaluation | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const runningIdsKey = evaluations
    .filter((evaluation) => evaluation.status === "RUNNING")
    .map((evaluation) => evaluation.id)
    .sort()
    .join(",");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await listEvaluations();
        if (!cancelled) {
          const dashboardEvaluations = response.evaluations
            .filter(
              (evaluation) =>
                evaluation.capability === "structured_clinical_resource_generation" ||
                Boolean(evaluation.result?.readinessDimensions),
            )
            .map(remoteToDashboard)
            .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

          setApiState("connected");
          setEvaluations(dashboardEvaluations);
          if (dashboardEvaluations.length > 0) {
            setSelectedId((current) =>
              current === demoEvaluation.id ? dashboardEvaluations[0].id : current,
            );
          }
        }
      } catch {
        if (!cancelled) {
          setApiState("demo");
          setToast("AWS is unavailable. The curated synthetic evaluation remains available.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingEvaluations(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!runningIdsKey) {
      return;
    }

    let cancelled = false;
    const runningIds = runningIdsKey.split(",").filter(Boolean);

    const refreshRunning = async () => {
      const results = await Promise.allSettled(runningIds.map((id) => getEvaluation(id)));
      if (cancelled) return;

      const refreshed = results
        .filter((result): result is PromiseFulfilledResult<{ evaluation: RemoteEvaluation }> => result.status === "fulfilled")
        .map((result) => remoteToDashboard(result.value.evaluation));

      if (refreshed.length > 0) {
        setEvaluations((current) => {
          const replacements = new Map(refreshed.map((evaluation) => [evaluation.id, evaluation]));
          const merged = current.map((evaluation) => replacements.get(evaluation.id) ?? evaluation);
          for (const evaluation of refreshed) {
            if (!merged.some((item) => item.id === evaluation.id)) merged.unshift(evaluation);
          }
          return merged.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
        });
      }
    };

    void refreshRunning();
    const intervalId = window.setInterval(() => void refreshRunning(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [runningIdsKey]);

  useEffect(() => {
    window.localStorage.setItem("capability-readiness-theme", theme);
    const params = new URLSearchParams(window.location.search);
    params.set("theme", theme);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [theme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("view") === view) {
      return;
    }

    params.set("view", view);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [view]);

  const selectedEvaluation = useMemo(
    () => evaluations.find((evaluation) => evaluation.id === selectedId) ?? demoEvaluation,
    [evaluations, selectedId],
  );

  const capabilityEvaluation = useMemo(
    () => evaluations.find((evaluation) => evaluation.id === capabilityRunId) ?? null,
    [capabilityRunId, evaluations],
  );

  const selectedCase = useMemo(
    () => selectedEvaluation.cases.find((item) => item.id === selectedCaseId) ?? null,
    [selectedCaseId, selectedEvaluation.cases],
  );

  const allRuns = useMemo(() => {
    if (isLoadingEvaluations && evaluations.length === 0) {
      return [];
    }

    const liveRuns = evaluations.filter((evaluation) => evaluation.id !== demoEvaluation.id);
    return liveRuns.length > 0 ? liveRuns : [demoEvaluation];
  }, [evaluations, isLoadingEvaluations]);

  const runOptions = useMemo(
    () =>
      isLoadingEvaluations && evaluations.length === 0
        ? []
        : [demoEvaluation, ...evaluations.filter((evaluation) => evaluation.id !== demoEvaluation.id)],
    [evaluations, isLoadingEvaluations],
  );

  const summary = useMemo(() => {
    const passes = selectedEvaluation.cases.filter((item) => item.severity === "Pass").length;
    const review = selectedEvaluation.cases.filter((item) => item.severity === "Watch").length;
    const blockers = selectedEvaluation.cases.filter((item) => item.severity === "Fail").length;
    return { passes, review, blockers };
  }, [selectedEvaluation]);

  const selectedDecisionPresentation = decisionPresentation[selectedEvaluation.decision];
  const SelectedDecisionIcon = selectedDecisionPresentation.Icon;
  const visibleIssues = selectedEvaluation.issues.slice(0, 3);
  const remainingIssues = selectedEvaluation.issues.slice(3);

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

  const isInitialEvaluationLoad = isLoadingEvaluations && evaluations.length === 0;

  const filteredCases = useMemo(() => {
    const query = dataSearch.trim().toLowerCase();

    return selectedEvaluation.cases.filter((caseItem) => {
      if (severityFilter !== "all" && caseItem.severity !== severityFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [caseItem.id, caseItem.source, caseItem.target, caseItem.finding, caseItem.output]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [dataSearch, severityFilter, selectedEvaluation.cases]);

  const toggleRule = (rule: RuleId) => {
    setSelectedRules((current) =>
      current.includes(rule) ? current.filter((item) => item !== rule) : [...current, rule],
    );
  };

  const loadSample = async () => {
    setIsLoadingDemo(true);
    setToast(null);
    try {
      const sampleUploads = await loadDemoDataset(demoScenario);
      setUploads(sampleUploads);
      setOutputSource("uploaded-outputs");
      setNotes(
        `Evaluate the ${demoScenario} synthetic pathology candidate against the CDA and companion PDF as one clinical bundle.`,
      );
      setToast(`${demoScenario[0].toUpperCase()}${demoScenario.slice(1)} synthetic dataset loaded.`);
    } catch (error) {
      setToast(`Could not load the synthetic dataset: ${String(error)}`);
    } finally {
      setIsLoadingDemo(false);
    }
  };

  const loadCapabilitySample = async () => {
    setIsLoadingDemo(true);
    setToast(null);
    try {
      const sample = await loadDemoDataset("ready");
      setCapabilityInputs({
        cda: sample.clinicalBundle.filter((file) => /\.(?:xml|cda|ccda)$/i.test(file.name)).slice(0, 1),
        pdf: sample.clinicalBundle.filter((file) => /\.pdf$/i.test(file.name)).slice(0, 1),
      });
      setCapabilityRunId(null);
      setToast("Synthetic CDA and PDF loaded. You can inspect both before generation.");
    } catch (error) {
      setToast(`Could not load the capability samples: ${String(error)}`);
    } finally {
      setIsLoadingDemo(false);
    }
  };

  const generateCapability = async () => {
    setToast(null);
    if (capabilityInputs.cda.length === 0 || capabilityInputs.pdf.length === 0) {
      setToast("Add one CDA document and one companion PDF first.");
      return;
    }

    setIsStartingCapability(true);
    try {
      const allUploads = await uploadLocalFiles(
        [...capabilityInputs.cda, ...capabilityInputs.pdf].map((file) => ({
          category: "documents" as const,
          file,
        })),
      );
      const response = await startEvaluation({
        capability: "structured_clinical_resource_generation",
        outputSource: "platform-model",
        documents: toRemoteRefs(allUploads.uploadedFiles, "documents"),
        referenceOutputs: [],
        policyFiles: [],
        aiOutputs: [],
        config: {
          modelId,
          evaluatorModel: "gpt-5.4-mini",
          caseMode: "clinical-bundle",
          datasetLabel: "Capability showcase bundle",
          evaluationRules: [
            "hl7_cda_mapping",
            "fhir_schema_conformance",
            "clinical_code_grounding",
            "prompt_injection_resistance",
          ],
          generationInstructions:
            "Generate one FHIR R4 Bundle that maps every clinically supported field from the CDA. Treat the PDF as corroborating evidence. Preserve synthetic identifiers, values, units, dates, LOINC codes, SNOMED CT codes, and resource references. Return JSON only.",
        },
      });

      setCapabilityRunId(response.evaluationId);
      setSelectedId(response.evaluationId);
      setToast(`Generation ${response.evaluationId} started.`);
      const detail = await getEvaluation(response.evaluationId);
      const dashboardEvaluation = remoteToDashboard(detail.evaluation);
      setEvaluations((current) => [
        dashboardEvaluation,
        ...current.filter((item) => item.id !== dashboardEvaluation.id),
      ]);
    } catch (error) {
      setToast(`Could not start FHIR generation: ${String(error)}`);
    } finally {
      setIsStartingCapability(false);
    }
  };

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
          caseMode: "clinical-bundle",
          datasetLabel: "Synthetic pathology CDA and PDF bundle",
        },
      });

      setToast(`Evaluation ${response.evaluationId} started.`);
      setSelectedId(response.evaluationId);
      setView("results");

      const detail = await getEvaluation(response.evaluationId);
      const dashboardEvaluation = remoteToDashboard(detail.evaluation);
      setEvaluations((current) => [dashboardEvaluation, ...current.filter((item) => item.id !== dashboardEvaluation.id)]);
    } catch (error) {
      setToast(`Could not start evaluation: ${String(error)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete || pendingDelete.id === demoEvaluation.id) return;
    setIsDeleting(true);
    try {
      await deleteEvaluation(pendingDelete.id);
      setEvaluations((current) => current.filter((evaluation) => evaluation.id !== pendingDelete.id));
      if (selectedId === pendingDelete.id) setSelectedId(demoEvaluation.id);
      setToast(`Deleted ${pendingDelete.id}.`);
      setPendingDelete(null);
    } catch (error) {
      setToast(`Could not delete the run: ${String(error)}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const exportEvaluation = () => {
    const payload = selectedEvaluation.raw ?? selectedEvaluation;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedEvaluation.id}-readiness-report.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runPicker = (
    <label className="run-picker">
      <span>Run</span>
      <select
        value={isInitialEvaluationLoad ? "" : selectedId}
        disabled={isInitialEvaluationLoad}
        onChange={(event) => setSelectedId(event.target.value)}
      >
        {isInitialEvaluationLoad ? (
          <option value="">Loading runs…</option>
        ) : (
          runOptions.map((run) => (
            <option key={run.id} value={run.id}>
              {run.id === demoEvaluation.id ? "Synthetic pathology baseline" : run.id}
            </option>
          ))
        )}
      </select>
    </label>
  );

  return (
    <div className="app" data-theme={theme}>
      <header className="top-bar">
        <div className="brand-cluster">
          <div className="mark" aria-hidden="true">
            <ShieldCheck />
          </div>
          <div>
            <strong>Galen Clinical Readiness</strong>
            <span>HL7 CDA + PDF → FHIR R4</span>
          </div>
        </div>

        <div className="top-actions">
          <span className={`live-pill state-${apiState}`}>
            <span aria-hidden="true" />
            {apiState === "connected" ? "AWS connected" : apiState === "checking" ? "Connecting" : "Fixture mode"}
          </span>
          <div className="theme-toggle" role="group" aria-label="Theme">
            <button
              className={theme === "light" ? "active" : ""}
              type="button"
              aria-label="Light theme"
              onClick={() => setTheme("light")}
            >
              <Sun aria-hidden="true" />
            </button>
            <button
              className={theme === "dark" ? "active" : ""}
              type="button"
              aria-label="Dark theme"
              onClick={() => setTheme("dark")}
            >
              <Moon aria-hidden="true" />
            </button>
          </div>
          <button className="primary-top-action" type="button" onClick={() => setView("create")}>
            <PlusSquare aria-hidden="true" />
            New evaluation
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
          <button
            className={view === "documentation" ? "docs-link active" : "docs-link"}
            type="button"
            onClick={() => setView("documentation")}
          >
            <BookOpen aria-hidden="true" />
            Documentation
          </button>
          <div className="synthetic-note">
            <FlaskConical aria-hidden="true" />
            <span><strong>Synthetic only</strong><small>No clinical use</small></span>
          </div>
        </aside>

        <main
          className={`workspace ${
            view === "capability"
              ? "workspace-capability"
              : view === "results"
                ? "workspace-results"
                : ""
          }`}
        >
          {view === "capability" ? (
            <CapabilityOverviewPage
              inputs={capabilityInputs}
              evaluation={capabilityEvaluation}
              modelId={modelId}
              isLoadingSample={isLoadingDemo}
              isStarting={isStartingCapability}
              onCdaChange={(files) => {
                setCapabilityInputs((current) => ({ ...current, cda: files }));
                setCapabilityRunId(null);
              }}
              onPdfChange={(files) => {
                setCapabilityInputs((current) => ({ ...current, pdf: files }));
                setCapabilityRunId(null);
              }}
              onLoadSample={() => void loadCapabilitySample()}
              onGenerate={() => void generateCapability()}
              onModelChange={setModelId}
              onOpenResults={() => {
                if (capabilityEvaluation) setSelectedId(capabilityEvaluation.id);
                setView("results");
              }}
            />
          ) : view === "documentation" ? (
            <DocumentationPage onCreate={() => setView("create")} onData={() => setView("data")} />
          ) : view === "create" ? (
            <section className="plane create-plane">
              <div className="plane-head">
                <div>
                  <span className="eyebrow">Evaluation builder</span>
                  <h1>Assess a clinical AI output</h1>
                  <p>Choose the output, add the evidence, then run the readiness checks.</p>
                </div>
                <span className="scope-chip"><ShieldCheck aria-hidden="true" /> Pre-ingestion gate</span>
              </div>

              <div className="demo-launcher">
                <div className="demo-launcher-copy">
                  <span className="demo-icon"><FlaskConical aria-hidden="true" /></span>
                  <div>
                    <span className="eyebrow">Presentation dataset</span>
                    <h2>Synthetic pathology bundle</h2>
                    <p>CDA + PDF · reference FHIR R4 · policy · controlled candidate</p>
                  </div>
                </div>
                <label className="scenario-select">
                  <span>Sample outcome</span>
                  <select value={demoScenario} onChange={(event) => setDemoScenario(event.target.value as DemoScenario)}>
                    <option value="ready">Ready</option>
                    <option value="conditional">Review</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </label>
                <button className="sample-action" type="button" disabled={isLoadingDemo} onClick={() => void loadSample()}>
                  {isLoadingDemo ? "Loading…" : "Load dataset"}
                  <ArrowRight aria-hidden="true" />
                </button>
              </div>

              <div className="card">
                <div className="section-heading numbered-heading">
                  <span>01</span>
                  <div><h2 className="card-title">Choose output source</h2><small>How should Galen get the FHIR candidate?</small></div>
                </div>
                <div className="mode-cards" role="radiogroup" aria-label="Output source">
                  <button
                    className={outputSource === "uploaded-outputs" ? "mode-card active" : "mode-card"}
                    type="button"
                    role="radio"
                    aria-checked={outputSource === "uploaded-outputs"}
                    onClick={() => setOutputSource("uploaded-outputs")}
                  >
                    <span className="mode-radio" aria-hidden="true" />
                    <span className="mode-card-copy">
                      <strong>Uploaded output</strong>
                      <span>Score FHIR your pipeline already produced.</span>
                    </span>
                  </button>
                  <button
                    className={outputSource === "platform-model" ? "mode-card active" : "mode-card"}
                    type="button"
                    role="radio"
                    aria-checked={outputSource === "platform-model"}
                    onClick={() => setOutputSource("platform-model")}
                  >
                    <span className="mode-radio" aria-hidden="true" />
                    <span className="mode-card-copy">
                      <strong>Platform model</strong>
                      <span>Generate FHIR with the selected model, then score it.</span>
                    </span>
                  </button>
                </div>
              </div>

              <div className="card">
                <div className="section-heading numbered-heading">
                  <span>02</span>
                  <div><h2 className="card-title">Add evidence</h2><small>Required files are marked. Keep related sources together as one case.</small></div>
                </div>
                <div className="file-grid">
                  <FileField
                    label="Source documents"
                    accept=".pdf,.xml,.cda,.ccda,.txt,.md,.json"
                    files={uploads.clinicalBundle}
                    hint="CDA, C-CDA, XML, PDF · required"
                    onChange={(files) =>
                      setUploads((current) => ({ ...current, clinicalBundle: files }))
                    }
                  />
                  <FileField
                    label="Reference FHIR"
                    accept=".json,.txt,.md,.csv"
                    files={uploads.expectedResources}
                    hint="Expected FHIR JSON · required"
                    onChange={(files) =>
                      setUploads((current) => ({ ...current, expectedResources: files }))
                    }
                  />
                  <FileField
                    label="Policy"
                    accept=".pdf,.txt,.md,.json"
                    files={uploads.governancePolicies}
                    hint="Governance rules · optional"
                    onChange={(files) =>
                      setUploads((current) => ({ ...current, governancePolicies: files }))
                    }
                  />
                  {outputSource === "uploaded-outputs" ? (
                    <FileField
                      label="Candidate FHIR"
                      accept=".json,.txt,.md,.csv"
                      files={uploads.candidateOutputs}
                      hint="Generated JSON · required"
                      onChange={(files) =>
                        setUploads((current) => ({ ...current, candidateOutputs: files }))
                      }
                    />
                  ) : (
                    <div className="file-note">
                      <span className="file-icon"><Cpu aria-hidden="true" /></span>
                      <span><strong>Candidate FHIR</strong><small>Generated by the platform model after you run.</small></span>
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="section-heading numbered-heading">
                  <span>03</span>
                  <div><h2 className="card-title">Choose checks</h2><small>Recommended checks are selected. Add the optional checks if needed.</small></div>
                </div>
                <div className="rule-grid">
                  {recommendedRulePresets.map((rule) => {
                    const active = selectedRules.includes(rule.id);
                    return (
                      <button
                        key={rule.id}
                        type="button"
                        className={active ? "rule-chip active" : "rule-chip"}
                        aria-pressed={active}
                        onClick={() => toggleRule(rule.id)}
                      >
                        <span className="rule-check" aria-hidden="true">
                          <CircleCheck />
                        </span>
                        <span>
                          <strong>{rule.label}</strong>
                          <small>{rule.hint}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <details className="advanced-rules">
                  <summary>
                    <span>Advanced checks</span>
                    <small>{additionalRulePresets.filter((rule) => selectedRules.includes(rule.id)).length} of {additionalRulePresets.length} selected</small>
                    <ChevronRight aria-hidden="true" />
                  </summary>
                  <div className="rule-grid">
                    {additionalRulePresets.map((rule) => {
                      const active = selectedRules.includes(rule.id);
                      return (
                        <button
                          key={rule.id}
                          type="button"
                          className={active ? "rule-chip active" : "rule-chip"}
                          aria-pressed={active}
                          onClick={() => toggleRule(rule.id)}
                        >
                          <span className="rule-check" aria-hidden="true">
                            <CircleCheck />
                          </span>
                          <span>
                            <strong>{rule.label}</strong>
                            <small>{rule.hint}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </details>
              </div>

              <div className="card create-footer">
                <div className="run-summary">
                  <span className="eyebrow">Ready to run?</span>
                  <h2>Start the readiness evaluation</h2>
                  <p>Galen will compare the candidate against the reference FHIR and selected checks.</p>
                </div>
                <button
                  className="primary-action"
                  disabled={isSubmitting}
                  type="button"
                  onClick={() => void submitEvaluation()}
                >
                  <Play aria-hidden="true" />
                  {isSubmitting ? "Uploading and starting…" : "Run readiness evaluation"}
                </button>
                <details className="advanced-settings">
                  <summary>
                    <span>Advanced settings</span>
                    <small>Model and scoring note</small>
                    <ChevronRight aria-hidden="true" />
                  </summary>
                  <div className="settings-fields">
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
                  </div>
                </details>
              </div>
            </section>
          ) : view === "settings" ? (
            <section className="plane">
              <div className="plane-head">
                <div>
                  <span className="eyebrow">Run registry</span>
                  <h1>Evaluation history</h1>
                  <p>Open, compare or remove persisted AWS evaluation runs.</p>
                </div>
              </div>
              <div className="card run-registry">
                <div className="run-registry-head">
                  <span>Run</span><span>Created</span><span>Score</span><span>Decision</span><span aria-hidden="true" />
                </div>
                <div className="run-registry-row fixture-row">
                  <button type="button" onClick={() => { setSelectedId(demoEvaluation.id); setView("results"); }}>
                    <span className="run-primary"><FlaskConical aria-hidden="true" /><span><strong>Synthetic pathology baseline</strong><small>Curated presentation fixture</small></span></span>
                    <span>{formatDate(demoEvaluation.createdAt)}</span>
                    <strong>{score(demoEvaluation.readinessScore)}</strong>
                    <StatusPill value={demoEvaluation.decision} tone="warn" />
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
                {evaluations.map((evaluation) => (
                  <div className="run-registry-row" key={evaluation.id}>
                    <button type="button" onClick={() => { setSelectedId(evaluation.id); setView("results"); }}>
                      <span className="run-primary"><Activity aria-hidden="true" /><span><strong>{evaluation.id}</strong><small>{evaluation.capability}</small></span></span>
                      <span>{formatDate(evaluation.createdAt)}</span>
                      <strong>{evaluation.status === "RUNNING" ? "-" : score(evaluation.readinessScore)}</strong>
                      <StatusPill value={evaluation.status === "COMPLETED" ? evaluation.decision : evaluation.status} tone={evaluation.status === "COMPLETED" ? decisionTone[evaluation.decision] : undefined} />
                      <ChevronRight aria-hidden="true" />
                    </button>
                    <button
                      className="delete-run"
                      type="button"
                      aria-label={`Delete ${evaluation.id}`}
                      disabled={evaluation.status === "RUNNING"}
                      onClick={() => setPendingDelete(evaluation)}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : view === "overview" ? (
            <section className="plane">
              <div className="plane-head">
                <div>
                  <span className="eyebrow">Overview</span>
                  <h1>Run dashboard</h1>
                  <p>Readiness across recent evaluation runs.</p>
                </div>
                <button className="primary-action" type="button" onClick={() => setView("create")}>
                  <PlusSquare aria-hidden="true" />
                  New evaluation
                </button>
              </div>

              <div className="stat-grid">
                <div className="card stat-tile hero">
                  <span className="stat-label">Latest readiness</span>
                  {isInitialEvaluationLoad ? (
                    <>
                      <div className="stat-hero-row">
                        <strong className="stat-value skeleton-value" aria-label="Loading latest readiness" />
                        <span className="skeleton-pill" aria-hidden="true" />
                      </div>
                      <div className="meter-track tone-neutral loading-meter" aria-hidden="true">
                        <span />
                      </div>
                      <small>Loading latest run…</small>
                    </>
                  ) : (
                    <>
                      <div className="stat-hero-row">
                        <strong className="stat-value">{score(selectedEvaluation.readinessScore)}</strong>
                        <StatusPill
                          value={selectedEvaluation.decision}
                          tone={decisionTone[selectedEvaluation.decision]}
                        />
                      </div>
                      <div className={`meter-track tone-${decisionTone[selectedEvaluation.decision]}`} aria-hidden="true">
                        <span
                          style={{ width: `${Math.min(selectedEvaluation.readinessScore, 100)}%` }}
                        />
                      </div>
                      <small>{selectedEvaluation.capability} · {formatDate(selectedEvaluation.createdAt)}</small>
                    </>
                  )}
                </div>
                <div className="card stat-tile">
                  <span className="stat-label">Runs</span>
                  {isInitialEvaluationLoad ? (
                    <>
                      <strong className="stat-value skeleton-value short" aria-label="Loading run count" />
                      <small>Loading…</small>
                    </>
                  ) : (
                    <>
                      <strong className="stat-value">{allRuns.length}</strong>
                      <small>{overviewStats.completed} completed</small>
                    </>
                  )}
                </div>
                <div className="card stat-tile">
                  <span className="stat-label">Average readiness</span>
                  {isInitialEvaluationLoad ? (
                    <>
                      <strong className="stat-value skeleton-value" aria-label="Loading average readiness" />
                      <small>Loading…</small>
                    </>
                  ) : (
                    <>
                      <strong className="stat-value">{score(overviewStats.average)}</strong>
                      <small>Across all runs</small>
                    </>
                  )}
                </div>
                <div className="card stat-tile">
                  <span className="stat-label">Needs review</span>
                  {isInitialEvaluationLoad ? (
                    <>
                      <strong className="stat-value skeleton-value short" aria-label="Loading review count" />
                      <small>Loading…</small>
                    </>
                  ) : (
                    <>
                      <strong className="stat-value">{overviewStats.needsReview}</strong>
                      <small>Not yet Ready</small>
                    </>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="section-heading">
                  <h2 className="card-title">Recent evaluations</h2>
                </div>
                <div className="run-table" role="table" aria-label="Recent evaluations">
                  <div className="run-table-head" role="row">
                    <span>Run</span>
                    <span>Capability</span>
                    <span>Date</span>
                    <span>Score</span>
                    <span>Decision</span>
                  </div>
                  {isInitialEvaluationLoad ? (
                    <div className="run-row loading-row" role="row">
                      <span className="skeleton-line" />
                      <span className="skeleton-line" />
                      <span className="skeleton-line short" />
                      <span className="skeleton-line short" />
                      <span className="skeleton-pill" />
                    </div>
                  ) : (
                    allRuns.slice(0, 8).map((evaluation) => (
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
                        <StatusPill value={evaluation.decision} tone={decisionTone[evaluation.decision]} />
                      </button>
                    ))
                  )}
                </div>
              </div>
            </section>
          ) : view === "data" ? (
            <section className="plane">
              <div className="plane-head">
                <div>
                  <span className="eyebrow">Evidence</span>
                  <h1>Case evidence</h1>
                  <p>Per-case scores behind the readiness decision.</p>
                </div>
                <label className="search-box">
                  <Search aria-hidden="true" />
                  <input
                    placeholder="Search cases…"
                    value={dataSearch}
                    onChange={(event) => setDataSearch(event.target.value)}
                  />
                </label>
              </div>

              <div className="filter-row" role="group" aria-label="Filter by status">
                {(
                  [
                    ["all", "All", selectedEvaluation.cases.length],
                    ["Pass", "Pass", summary.passes],
                    ["Watch", "Review", summary.review],
                    ["Fail", "Blockers", summary.blockers],
                  ] as Array<[SeverityFilter, string, number]>
                ).map(([id, label, count]) => (
                  <button
                    key={id}
                    type="button"
                    className={severityFilter === id ? "filter-chip active" : "filter-chip"}
                    aria-pressed={severityFilter === id}
                    onClick={() => setSeverityFilter(id)}
                  >
                    {label}
                    <em>{count}</em>
                  </button>
                ))}
                <span className="filter-context">{runPicker}</span>
              </div>

              <div className="card table-card">
                <div className="data-table" role="table" aria-label="Evaluation evidence">
                  <div className="table-header" role="row">
                    <span>Case</span>
                    <span>Resource</span>
                    <span className="num">Faithfulness</span>
                    <span className="num">Coverage</span>
                    <span className="num">Compliance</span>
                    <span className="num">Privacy</span>
                    <span className="num">Latency</span>
                    <span>Status</span>
                  </div>
                  {filteredCases.length === 0 ? (
                    <div className="table-empty">No cases match the current filter.</div>
                  ) : (
                    filteredCases.map((caseItem) => (
                      <button
                        className="table-row"
                        type="button"
                        onClick={() => { setSelectedCaseId(caseItem.id); setEvidenceTab("summary"); }}
                        key={caseItem.id}
                      >
                        <span className="case-id">{caseItem.id}</span>
                        <span>
                          <strong>{caseItem.target}</strong>
                          <small>{caseItem.source}</small>
                        </span>
                        <span className="num">{score(caseItem.metrics.faithfulness)}</span>
                        <span className="num">{score(caseItem.metrics.coverage)}</span>
                        <span className="num">{score(caseItem.metrics.compliance)}</span>
                        <span className="num">{score(caseItem.metrics.privacy)}</span>
                        <span className="num">{compactMs(caseItem.metrics.latency)}</span>
                        <SeverityBadge severity={caseItem.severity} />
                      </button>
                    ))
                  )}
                </div>
              </div>
            </section>
          ) : (
            <section className="plane results-plane">
              <div className="plane-head">
                <div>
                  <span className="eyebrow">{selectedEvaluation.capability}</span>
                  <h1>Readiness report</h1>
                  <p>
                    {formatDate(selectedEvaluation.createdAt)} ·{" "}
                    {selectedEvaluation.outputSource === "platform-model"
                      ? "platform model"
                      : "uploaded output"}
                  </p>
                </div>
                <div className="head-actions">{runPicker}</div>
              </div>

              {selectedEvaluation.status === "RUNNING" ? (
                <div className="card progress-card">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">Live workflow</span>
                      <h2 className="card-title">{selectedEvaluation.stage.replace(/_/g, " ")}</h2>
                    </div>
                    <StatusPill value="Running" tone="neutral" />
                  </div>
                  <WorkflowProgress stage={selectedEvaluation.stage} />
                </div>
              ) : null}

              <section
                className={`result-decision tone-${decisionTone[selectedEvaluation.decision]}`}
                aria-labelledby="result-decision-title"
              >
                <div className="result-decision-copy">
                  <div className="result-decision-label">
                    <span className="result-decision-icon"><SelectedDecisionIcon aria-hidden="true" /></span>
                    <span>Deployment decision</span>
                    <StatusPill
                      value={selectedEvaluation.decision}
                      tone={decisionTone[selectedEvaluation.decision]}
                    />
                  </div>
                  <h2 id="result-decision-title">{selectedDecisionPresentation.heading}</h2>
                  <p>{selectedDecisionPresentation.summary}</p>
                  <button className="decision-action" type="button" onClick={() => setView("data")}>
                    Review evidence <ArrowRight aria-hidden="true" />
                  </button>
                </div>

                <div
                  className="result-score"
                  role="img"
                  aria-label={`Readiness score ${score(selectedEvaluation.readinessScore)} out of 100`}
                >
                  <span>Readiness score</span>
                  <strong>{score(selectedEvaluation.readinessScore)}</strong>
                  <small>out of 100</small>
                </div>

                <dl className="result-facts">
                  <div><dt>Blockers</dt><dd>{summary.blockers}</dd></div>
                  <div><dt>Review cases</dt><dd>{summary.review}</dd></div>
                  <div><dt>PHI containment</dt><dd>{score(selectedEvaluation.dimensions.privacyContainment)}</dd></div>
                </dl>
              </section>

              <div className="result-body">
                <div className="result-main-column">
                  <section className="result-section" aria-labelledby="attention-title">
                    <div className="result-section-head">
                      <div>
                        <span className="eyebrow">Priority</span>
                        <h2 id="attention-title">What needs attention</h2>
                      </div>
                      <span className="result-count">{selectedEvaluation.issues.length}</span>
                    </div>
                    {selectedEvaluation.issues.length > 0 ? (
                      <>
                        <ul className="attention-list">
                          {visibleIssues.map((item) => (
                            <li key={item}>
                              <span><AlertTriangle aria-hidden="true" /></span>
                              <p>{item}</p>
                            </li>
                          ))}
                        </ul>
                        {remainingIssues.length > 0 ? (
                          <details className="more-issues">
                            <summary>
                              <span>Show {remainingIssues.length} more</span>
                              <ChevronRight aria-hidden="true" />
                            </summary>
                            <ul className="attention-list">
                              {remainingIssues.map((item) => (
                                <li key={item}>
                                  <span><AlertTriangle aria-hidden="true" /></span>
                                  <p>{item}</p>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </>
                    ) : (
                      <div className="result-clear-state">
                        <CircleCheck aria-hidden="true" />
                        <span>No issues require attention.</span>
                      </div>
                    )}
                  </section>

                  <section className="result-section" aria-labelledby="case-review-title">
                    <div className="result-section-head">
                      <div>
                        <span className="eyebrow">Evidence</span>
                        <h2 id="case-review-title">Case review</h2>
                      </div>
                      <button type="button" className="icon-text-action" onClick={() => setView("data")}>
                        Full evidence <ArrowRight aria-hidden="true" />
                      </button>
                    </div>
                    <div className="result-finding-list">
                      {selectedEvaluation.cases.length > 0 ? (
                        selectedEvaluation.cases.map((caseItem) => (
                          <button
                            className="result-finding-row"
                            type="button"
                            onClick={() => { setSelectedCaseId(caseItem.id); setEvidenceTab("summary"); }}
                            key={caseItem.id}
                          >
                            <SeverityBadge severity={caseItem.severity} />
                            <span className="result-finding-copy">
                              <strong>{caseItem.target}</strong>
                              <span>{caseItem.finding}</span>
                              <small>{caseItem.id} · {caseItem.source}</small>
                            </span>
                            <ChevronRight aria-hidden="true" />
                          </button>
                        ))
                      ) : (
                        <div className="result-clear-state">
                          <CircleCheck aria-hidden="true" />
                          <span>No case findings were recorded.</span>
                        </div>
                      )}
                    </div>
                  </section>

                  <details className="result-disclosure result-success">
                    <summary>
                      <span><CircleCheck aria-hidden="true" /><strong>What passed</strong></span>
                      <small>{selectedEvaluation.strengths.length} strengths</small>
                      <ChevronRight aria-hidden="true" />
                    </summary>
                    <ul className="result-strength-list">
                      {selectedEvaluation.strengths.length > 0 ? (
                        selectedEvaluation.strengths.map((item) => <li key={item}>{item}</li>)
                      ) : (
                        <li>No strengths recorded yet.</li>
                      )}
                    </ul>
                  </details>
                </div>

                <aside className="result-sidebar" aria-label="Readiness details">
                  <section className="result-sidebar-section">
                    <span className="eyebrow">Readiness</span>
                    <h2>Dimension scores</h2>
                    <div className="dimension-list" aria-label="Deployment readiness dimensions">
                      {dimensionMeta.map((dimension) => (
                        <DimensionRow
                          key={dimension.key}
                          dimensionKey={dimension.key}
                          value={selectedEvaluation.dimensions[dimension.key]}
                        />
                      ))}
                    </div>
                  </section>

                  <details className="result-sidebar-disclosure">
                    <summary>
                      <span>Technical scores</span>
                      <ChevronRight aria-hidden="true" />
                    </summary>
                    <dl className="result-detail-list">
                      <div><dt>Faithfulness</dt><dd>{score(selectedEvaluation.metrics.faithfulness)}</dd></div>
                      <div><dt>Coverage</dt><dd>{score(selectedEvaluation.metrics.coverage)}</dd></div>
                      <div><dt>Compliance</dt><dd>{score(selectedEvaluation.metrics.compliance)}</dd></div>
                      <div><dt>Privacy</dt><dd>{score(selectedEvaluation.metrics.privacy)}</dd></div>
                      <div><dt>Latency</dt><dd>{selectedEvaluation.metrics.latency !== null ? `${score(selectedEvaluation.metrics.latency)}s` : "-"}</dd></div>
                    </dl>
                  </details>

                  <details className="result-sidebar-disclosure">
                    <summary>
                      <span>Run details</span>
                      <ChevronRight aria-hidden="true" />
                    </summary>
                    <dl className="result-detail-list">
                      <div><dt><Cpu aria-hidden="true" /> Candidate</dt><dd>{selectedEvaluation.modelId}</dd></div>
                      <div><dt><ShieldCheck aria-hidden="true" /> Evaluator</dt><dd>{selectedEvaluation.evaluatorModel}</dd></div>
                      <div>
                        <dt><FileText aria-hidden="true" /> Inputs</dt>
                        <dd>{selectedEvaluation.documents.length} docs · {selectedEvaluation.referenceOutputs.length} refs</dd>
                      </div>
                      <div>
                        <dt><Timer aria-hidden="true" /> Processing</dt>
                        <dd>{selectedEvaluation.processingSeconds !== null ? `${score(selectedEvaluation.processingSeconds)}s` : selectedEvaluation.stage}</dd>
                      </div>
                    </dl>
                    <button className="result-export" type="button" onClick={exportEvaluation}>
                      <Download aria-hidden="true" /> Export report
                    </button>
                  </details>
                </aside>
              </div>
            </section>
          )}
        </main>
      </div>

      {selectedCase ? (
        <EvidenceDrawer
          caseItem={selectedCase}
          tab={evidenceTab}
          onTabChange={setEvidenceTab}
          onClose={() => setSelectedCaseId(null)}
        />
      ) : null}

      {pendingDelete ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !isDeleting && setPendingDelete(null)}>
          <div
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-run-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="modal-icon"><Trash2 aria-hidden="true" /></span>
            <h2 id="delete-run-title">Delete this evaluation?</h2>
            <p>{pendingDelete.id} and its uploaded demo files will be removed from AWS.</p>
            <div>
              <button className="secondary-action" type="button" disabled={isDeleting} onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="danger-action" type="button" disabled={isDeleting} onClick={() => void confirmDelete()}>
                {isDeleting ? "Deleting…" : "Delete run"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
