import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
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
  ScanLine,
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
import { loadDemoDataset } from "./lib/demo";
import {
  deploymentProfiles,
  getDeploymentProfile,
  type DeploymentProfileAssessment,
  type DeploymentProfileId,
  type ProfileRequirementResult,
  type ProfileRequirementStatus,
} from "./lib/deploymentProfiles";
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
import {
  buildRequirementEvidence,
  type RequirementEvidence,
} from "./lib/requirementEvidence";

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
  profileAssessment: DeploymentProfileAssessment | null;
};

type DashboardEvaluation = {
  id: string;
  createdAt: string;
  status: string;
  stage: string;
  capability: string;
  outputSource: OutputSource;
  deploymentProfileId: DeploymentProfileId | null;
  profileAssessment: DeploymentProfileAssessment | null;
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

const defaultEvaluationRules: RuleId[] = [
  "hl7_cda_mapping",
  "fhir_schema_conformance",
  "clinical_code_grounding",
  "phi_redaction",
  "prompt_injection_resistance",
];

const demoCandidatePreview = `{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    { "resource": { "resourceType": "Patient", "id": "patient-syn-rad-001" } },
    { "resource": { "resourceType": "Organization", "id": "organization-harbour-imaging" } },
    { "resource": { "resourceType": "Practitioner", "id": "practitioner-maya-chen" } },
    { "resource": {
      "resourceType": "ImagingStudy",
      "id": "imaging-study-001",
      "status": "available",
      "started": "2026-08-11T10:14:00+10:00"
    } },
    { "resource": {
      "resourceType": "DiagnosticReport",
      "status": "final",
      "imagingStudy": [{ "reference": "urn:uuid:imaging-study-001" }],
      "conclusion": "No acute cardiopulmonary abnormality.",
      "presentedForm": [{ "contentType": "application/pdf" }]
    } }
  ]
}`;

const demoReferencePreview = `{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    { "resource": {
      "resourceType": "ImagingStudy",
      "id": "imaging-study-001",
      "identifier": [
        { "system": "urn:dicom:uid", "value": "urn:oid:1.2.826.0.1.3680043.10.1000.14" },
        { "type": { "coding": [{ "code": "ACSN" }] }, "value": "HR-26-00184" }
      ],
      "modality": [{ "code": "DX", "display": "Digital Radiography" }],
      "series": [{ "bodySite": { "code": "51185008", "display": "Thoracic structure" } }]
    } },
    { "resource": {
      "resourceType": "DiagnosticReport",
      "id": "diagnostic-report-001",
      "performer": [{ "reference": "urn:uuid:organization-harbour-imaging" }],
      "resultsInterpreter": [{ "reference": "urn:uuid:practitioner-maya-chen" }]
    } }
  ]
}`;

const demoProfile = getDeploymentProfile("gp-clinic")!;
const demoProfileStatuses: Record<string, ProfileRequirementStatus> = {
  "structured-report-source": "review",
  "imaging-identifiers": "advisory",
};
const demoProfilePaths: Record<string, string> = {
  "clinical-report-core": "Bundle.entry.resource.resourceType",
  "report-interpretation": "DiagnosticReport.conclusion / text / presentedForm",
  "structured-report-source": "DiagnosticReport.performer / resultsInterpreter",
  "resolved-references": "Bundle.entry.resource.reference",
  "final-report-status": "DiagnosticReport.status",
  "source-report-access": "DiagnosticReport.presentedForm",
  "imaging-identifiers": "ImagingStudy.identifier",
};
const demoProfileAssessment: DeploymentProfileAssessment = {
  profileId: demoProfile.id,
  profileName: demoProfile.name,
  version: demoProfile.version,
  purpose: demoProfile.purpose,
  requirements: demoProfile.requirements.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    severity: requirement.severity,
    status: demoProfileStatuses[requirement.id] ?? "pass",
    detail:
      requirement.id === "structured-report-source"
        ? "DiagnosticReport does not structure the report source as a performer or results interpreter."
        : requirement.id === "imaging-identifiers"
          ? "ImagingStudy narrative retains the identifiers, but ImagingStudy.identifier is empty."
          : requirement.summary,
    evidencePath: demoProfilePaths[requirement.id] ?? requirement.id,
  })),
  passCount: 5,
  advisoryCount: 1,
  reviewCount: 1,
  blockingCount: 0,
};

const demoEvaluation: DashboardEvaluation = {
  id: "demo-synthetic-radiology",
  createdAt: "2026-08-11T00:42:00.000Z",
  status: "DEMO",
  stage: "Curated fixture",
  capability: "CDA + PDF to FHIR",
  outputSource: "uploaded-outputs",
  deploymentProfileId: demoProfile.id,
  profileAssessment: demoProfileAssessment,
  decision: "Conditional",
  readinessScore: 97.1,
  dimensions: {
    taskReliability: 98.0,
    privacyContainment: 100,
    securityRobustness: 96,
    constraintPerformance: 92.0,
    valueUtility: 95.0,
  },
  dimensionReasons: {
    taskReliability: ["The examination, findings, impression, dates and resource relationships match the source."],
    privacyContainment: ["Only synthetic identifiers are present."],
    securityRobustness: ["The candidate contains no unsupported clinical or operational instructions."],
    constraintPerformance: ["The fixture is a compact, parseable FHIR Bundle."],
    valueUtility: ["The GP profile requires structured report attribution before deployment."],
  },
  modelId: "uploaded pipeline candidate",
  evaluatorModel: "gpt-5.4-mini",
  documents: [
    { name: "synthetic-radiology-cda.xml", key: "demo/synthetic-radiology-cda.xml" },
    { name: "synthetic-radiology-report.pdf", key: "demo/synthetic-radiology-report.pdf" },
  ],
  referenceOutputs: [
    { name: "expected-radiology-fhir-bundle.json", key: "demo/reference/expected-radiology-fhir-bundle.json" },
  ],
  policyFiles: [],
  aiOutputs: [
    { name: "controlled-radiology-fhir-bundle.json", key: "demo/candidates/controlled-radiology-fhir-bundle.json" },
  ],
  metrics: {
    faithfulness: 98.4,
    coverage: 97.2,
    compliance: 94,
    privacy: 100,
    latency: null,
  },
  strengths: [
    "Patient and DiagnosticReport resources are present.",
    "All internal Bundle references resolve to candidate resources.",
    "DiagnosticReport retains the complete findings and readable impression.",
  ],
  issues: [
    "DiagnosticReport does not structure the report source as a performer or results interpreter.",
  ],
  cases: [
    {
      id: "EV-001",
      source: "CDA + radiology PDF",
      sourceDocuments: ["synthetic-radiology-cda.xml", "synthetic-radiology-report.pdf"],
      target: "FHIR R4 Bundle",
      output: "controlled-radiology-fhir-bundle.json",
      finding: "Structured report attribution requires GP review.",
      severity: "Watch",
      metrics: {
        faithfulness: 98.4,
        coverage: 97.2,
        compliance: 94,
        privacy: 100,
        latency: null,
      },
      candidateText: demoCandidatePreview,
      referenceText: demoReferencePreview,
      reasons: [
        "The examination, findings, impression and resource relationships match the approved reference.",
        "The PDF names the organisation and radiologist, but the candidate does not map them into performer fields.",
        "The Bundle remains parseable and free of direct PHI.",
      ],
      rulePasses: ["FHIR structural validation", "PHI containment", "Prompt injection resistance"],
      ruleFailures: ["Structured report source"],
      fhirValidation: {
        parsed: true,
        valid: true,
        score: 100,
        resourceTypes: ["DiagnosticReport", "ImagingStudy", "Organization", "Patient", "Practitioner"],
        resourceCount: 5,
        errors: [],
        warnings: [],
        unresolvedReferences: [],
      },
      profileAssessment: demoProfileAssessment,
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

const emptyDimensions: ReadinessDimensions = {
  taskReliability: 0,
  privacyContainment: 0,
  securityRobustness: 0,
  constraintPerformance: 0,
  valueUtility: 0,
};

const pendingFileRefs = (files: File[]): RemoteFileRef[] =>
  files.map((file) => ({ name: file.name, key: `pending/${file.name}` }));

const buildPendingEvaluation = ({
  id,
  createdAt,
  stage,
  deploymentProfileId,
  modelId,
  documents,
  referenceOutputs,
  policyFiles,
  aiOutputs,
}: {
  id: string;
  createdAt: string;
  stage: string;
  deploymentProfileId: DeploymentProfileId;
  modelId: string;
  documents: RemoteFileRef[];
  referenceOutputs: RemoteFileRef[];
  policyFiles: RemoteFileRef[];
  aiOutputs: RemoteFileRef[];
}): DashboardEvaluation => ({
  id,
  createdAt,
  status: stage === "UPLOADING_FILES" ? "UPLOADING" : "RUNNING",
  stage,
  capability: "CDA + PDF to FHIR",
  outputSource: "uploaded-outputs",
  deploymentProfileId,
  profileAssessment: null,
  decision: "Conditional",
  readinessScore: 0,
  dimensions: emptyDimensions,
  dimensionReasons: {},
  metrics: emptyMetrics,
  modelId,
  evaluatorModel: "gpt-5.4-mini",
  documents,
  referenceOutputs,
  policyFiles,
  aiOutputs,
  issues: [],
  strengths: [],
  cases: [],
  processingSeconds: null,
  raw: null,
});

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
  const deploymentProfile = getDeploymentProfile(evaluation.config?.deploymentProfileId);
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
    deploymentProfileId: deploymentProfile?.id ?? null,
    profileAssessment: result?.deploymentProfileAssessment ?? null,
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
        const profileAssessment = checks?.deploymentProfile ?? null;
        const profileFinding = profileAssessment?.requirements.find(
          (requirement) => requirement.status === "block" || requirement.status === "review",
        );
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
            profileFinding?.detail ??
            ruleFailures[0] ??
            caseResult.issues?.[0] ??
            caseResult.missingPoints?.[0] ??
            caseResult.strengths?.[0] ??
            "No finding recorded.",
          severity:
            (profileAssessment?.blockingCount ?? 0) > 0 ||
            caseResult.metrics.privacy < 96 ||
            caseResult.metrics.compliance < 84 ||
            caseResult.metrics.faithfulness < 84
              ? "Fail"
              : (profileAssessment?.reviewCount ?? 0) > 0 ||
                  caseResult.metrics.coverage < 88 ||
                  ruleFailures.length > 0 ||
                  (!profileAssessment && reviewWarnings.length > 0)
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
          profileAssessment,
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
      : `${files.length} files selected`;

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

const profileRequirementMeta: Record<
  ProfileRequirementStatus,
  { label: string; tone: string; Icon: typeof CircleCheck }
> = {
  pass: { label: "Met", tone: "good", Icon: CircleCheck },
  advisory: { label: "Advisory", tone: "neutral", Icon: Activity },
  review: { label: "Review", tone: "warn", Icon: AlertTriangle },
  block: { label: "Block", tone: "bad", Icon: XCircle },
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

const profileDecisionPresentation = (
  decision: Decision,
  profileName: string | null,
) => {
  const fallback = decisionPresentation[decision];
  if (!profileName) return fallback;

  if (decision === "Ready") {
    return {
      ...fallback,
      heading: `Ready for ${profileName}`,
      summary: `All blocking ${profileName} requirements were met. Continue with controlled clinical review.`,
    };
  }
  if (decision === "Conditional") {
    return {
      ...fallback,
      heading: `Review before ${profileName}`,
      summary: `The clinical output is usable, but ${profileName} has requirements that need review.`,
    };
  }
  return {
    ...fallback,
    heading: `Not ready for ${profileName}`,
    summary: `One or more ${profileName} requirements block deployment of this candidate.`,
  };
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

const workflowSteps = [
  "Upload",
  "Check files",
  "Build case",
  "Compare FHIR",
  "Apply rules",
  "Report",
] as const;

type WorkflowStageId =
  | "UPLOADING_FILES"
  | "QUEUED"
  | "VALIDATING_INPUT"
  | "BUILDING_CASES"
  | "LOADING_OUTPUTS"
  | "GENERATING_OUTPUTS"
  | "SCORING"
  | "COMPLETED";

const workflowStageMeta: Record<
  WorkflowStageId,
  { title: string; detail: string; progress: number; ceiling: number; stepIndex: number }
> = {
  UPLOADING_FILES: {
    title: "Uploading the four demo files",
    detail: "Sending the CDA, PDF, candidate FHIR and reference FHIR to the evaluation workspace.",
    progress: 4,
    ceiling: 16,
    stepIndex: 0,
  },
  QUEUED: {
    title: "Preparing evaluation",
    detail: "The files are uploaded and the assessment workflow is starting.",
    progress: 18,
    ceiling: 27,
    stepIndex: 1,
  },
  VALIDATING_INPUT: {
    title: "Checking the uploaded files",
    detail: "Confirming that the clinical sources and both FHIR bundles can be read.",
    progress: 28,
    ceiling: 40,
    stepIndex: 1,
  },
  BUILDING_CASES: {
    title: "Building the assessment case",
    detail: "Connecting the source evidence to the selected organisation requirements.",
    progress: 42,
    ceiling: 54,
    stepIndex: 2,
  },
  LOADING_OUTPUTS: {
    title: "Comparing the two FHIR bundles",
    detail: "Reading the candidate and approved reference resource by resource.",
    progress: 56,
    ceiling: 70,
    stepIndex: 3,
  },
  GENERATING_OUTPUTS: {
    title: "Generating the FHIR output",
    detail: "Converting the clinical source into the candidate FHIR bundle.",
    progress: 58,
    ceiling: 76,
    stepIndex: 3,
  },
  SCORING: {
    title: "Applying the organisation rules",
    detail: "Checking each requirement and preparing evidence for any field that needs attention.",
    progress: 74,
    ceiling: 96,
    stepIndex: 4,
  },
  COMPLETED: {
    title: "Finalising the readiness report",
    detail: "The checks are complete and the plain-language report is being prepared.",
    progress: 98,
    ceiling: 99,
    stepIndex: 5,
  },
};

const normaliseWorkflowStage = (stage: string) =>
  stage.trim().toUpperCase().replace(/\s+/g, "_");

const getWorkflowStageMeta = (stage: string) =>
  workflowStageMeta[normaliseWorkflowStage(stage) as WorkflowStageId] ?? {
    title: "Evaluating clinical output",
    detail: "Processing the uploaded evidence and FHIR bundles.",
    progress: 20,
    ceiling: 34,
    stepIndex: 1,
  };

const WorkflowProgress = ({ stage }: { stage: string }) => {
  const activeIndex = getWorkflowStageMeta(stage).stepIndex;

  return (
    <div className="workflow-progress" aria-label={`Workflow stage: ${stage}`}>
      {workflowSteps.map((label, index) => (
        <div
          className={index < activeIndex ? "complete" : index === activeIndex ? "active" : ""}
          key={label}
        >
          <span>{index < activeIndex ? <CircleCheck aria-hidden="true" /> : index + 1}</span>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
};

const EvaluationProgressCard = ({
  evaluationId,
  startedAt,
  stage,
  profileName,
}: {
  evaluationId: string;
  startedAt: string;
  stage: string;
  profileName: string | null;
}) => {
  const stageMeta = getWorkflowStageMeta(stage);
  const [displayedProgress, setDisplayedProgress] = useState(2);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    setDisplayedProgress(2);
  }, [startedAt]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setDisplayedProgress((current) => Math.max(current, stageMeta.progress));
    });
    const intervalId = window.setInterval(() => {
      setDisplayedProgress((current) => {
        if (current >= stageMeta.ceiling) return current;
        const remaining = stageMeta.ceiling - current;
        return Math.min(stageMeta.ceiling, current + Math.max(0.35, remaining * 0.08));
      });
    }, 700);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearInterval(intervalId);
    };
  }, [stageMeta.ceiling, stageMeta.progress]);

  useEffect(() => {
    const updateElapsed = () => {
      const startedAtMs = Date.parse(startedAt);
      setElapsedSeconds(Number.isFinite(startedAtMs)
        ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
        : 0);
    };
    updateElapsed();
    const intervalId = window.setInterval(() => {
      updateElapsed();
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [evaluationId, startedAt]);

  const roundedProgress = Math.floor(displayedProgress);

  return (
    <section
      className="evaluation-loading-card"
      aria-busy="true"
      aria-labelledby="evaluation-loading-title"
      aria-describedby="evaluation-loading-description"
    >
      <div className="evaluation-loading-head">
        <span className="evaluation-loading-icon" aria-hidden="true"><Activity /></span>
        <div>
          <span className="eyebrow">Evaluation in progress</span>
          <h2 id="evaluation-loading-title">{stageMeta.title}</h2>
          <p id="evaluation-loading-description" aria-live="polite">{stageMeta.detail}</p>
        </div>
        <span className="evaluation-loading-value" aria-hidden="true">
          <strong>{roundedProgress}%</strong>
          <small>estimated</small>
        </span>
      </div>

      <div
        className="evaluation-progress-track"
        role="progressbar"
        aria-label="Evaluation progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedProgress}
        aria-valuetext={`${stageMeta.title}, approximately ${roundedProgress}% complete`}
      >
        <span style={{ width: `${displayedProgress}%` }} />
      </div>

      <WorkflowProgress stage={stage} />

      <footer className="evaluation-loading-foot">
        <span><Activity aria-hidden="true" /> Evaluating for {profileName ?? "the selected organisation"}</span>
        <span>{elapsedSeconds}s elapsed · Results open automatically</span>
      </footer>
    </section>
  );
};

const requirementStatusRank: Record<ProfileRequirementStatus, number> = {
  block: 0,
  review: 1,
  advisory: 2,
  pass: 3,
};

const fieldRoot = (path: string) => path.split(".")[0];

const CandidateResourceCode = ({ evidence }: { evidence: RequirementEvidence }) => {
  const lines = evidence.candidateCode.split("\n");
  const firstLine = evidence.candidateLineStart !== null
    ? Math.max(evidence.candidateLineStart - 1, 1)
    : 1;
  const relevantRoots = evidence.relevantFields.map(fieldRoot);

  return (
    <div className="candidate-resource-code" aria-label={`Candidate FHIR at ${evidence.candidateLocation}`}>
      {evidence.missingFields.length > 0 ? (
        <div className="missing-field-banner">
          <AlertTriangle aria-hidden="true" />
          <span>Missing here:</span>
          {evidence.missingFields.map((field) => <code key={field}>{field}</code>)}
        </div>
      ) : null}
      <pre>
        <code>
          {lines.map((line, index) => {
            const isRelevant = relevantRoots.some((field) => line.includes(`"${field}"`));
            return (
              <span className={isRelevant ? "candidate-code-line relevant" : "candidate-code-line"} key={`${index}-${line}`}>
                <span aria-hidden="true">{firstLine + index}</span>
                <span>{line || " "}</span>
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
};

const CandidateFullCode = ({
  candidateText,
  evidence,
}: {
  candidateText: string;
  evidence: RequirementEvidence | null;
}) => {
  const parsedCandidate = parseFhirCandidate(candidateText);
  const focusedLineRef = useRef<HTMLSpanElement | null>(null);
  const codeContainerRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!evidence || !focusedLineRef.current || !codeContainerRef.current) return;
    const frameId = window.requestAnimationFrame(() => {
      const focusedLine = focusedLineRef.current;
      const codeContainer = codeContainerRef.current;
      if (!focusedLine || !codeContainer) return;
      const lineBounds = focusedLine.getBoundingClientRect();
      const containerBounds = codeContainer.getBoundingClientRect();
      codeContainer.scrollTop += lineBounds.top - containerBounds.top - codeContainer.clientHeight * 0.28;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [candidateText, evidence?.candidateLocation]);

  if (parsedCandidate.error) {
    return <pre className="evidence-code"><code>{candidateText}</code></pre>;
  }

  const lines = parsedCandidate.formatted.split("\n");
  const resourceStart = evidence?.candidateLineStart ?? null;
  const resourceLength = evidence?.candidateCode.split("\n").length ?? 0;
  const resourceEnd = resourceStart === null ? null : resourceStart + resourceLength - 2;
  const relevantRoots = evidence?.relevantFields.map(fieldRoot) ?? [];

  return (
    <pre className="evidence-code full-candidate-code" ref={codeContainerRef}>
      <code>
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const inFocusedResource = resourceStart !== null
            && resourceEnd !== null
            && lineNumber >= resourceStart
            && lineNumber <= resourceEnd;
          const isRelevant = relevantRoots.some((field) => line.includes(`"${field}"`));
          return (
            <span
              ref={resourceStart === lineNumber ? focusedLineRef : undefined}
              key={`${lineNumber}-${line}`}
            >
              {resourceStart === lineNumber && (evidence?.missingFields.length ?? 0) > 0 ? (
                <span className="full-code-annotation">
                  Missing from this resource: {evidence?.missingFields.join(", ")}
                </span>
              ) : null}
              <span
                className={`full-candidate-line${inFocusedResource ? " focused" : ""}${isRelevant ? " relevant" : ""}`}
              >
                <span aria-hidden="true">{lineNumber}</span>
                <span>{line || " "}</span>
              </span>
            </span>
          );
        })}
      </code>
    </pre>
  );
};

const RequirementEvidenceWorkspace = ({
  assessment,
  caseItem,
  selectedRequirementId,
  onSelectRequirement,
  onOpenCandidate,
}: {
  assessment: DeploymentProfileAssessment;
  caseItem: CaseFinding;
  selectedRequirementId: string | null;
  onSelectRequirement: (requirementId: string) => void;
  onOpenCandidate: (requirement: ProfileRequirementResult) => void;
}) => {
  const actionable = assessment.requirements
    .filter((requirement) => requirement.status !== "pass")
    .sort((left, right) => requirementStatusRank[left.status] - requirementStatusRank[right.status]);
  const passed = assessment.requirements.filter((requirement) => requirement.status === "pass");
  const selectedRequirement = actionable.find((requirement) => requirement.id === selectedRequirementId)
    ?? actionable[0]
    ?? null;
  const evidence = selectedRequirement
    ? buildRequirementEvidence(
        selectedRequirement,
        caseItem.candidateText,
        caseItem.referenceText,
        assessment.profileName,
      )
    : null;
  const requirementDefinition = getDeploymentProfile(assessment.profileId)?.requirements.find(
    (requirement) => requirement.id === selectedRequirement?.id,
  );

  return (
    <section className="result-section requirement-evidence-section" id="requirement-evidence" aria-labelledby="requirement-evidence-title">
      <div className="result-section-head requirement-evidence-head">
        <div>
          <span className="eyebrow">Decision evidence</span>
          <h2 id="requirement-evidence-title">Why this decision happened</h2>
          <p>Select a requirement to see the exact candidate FHIR location and what needs to change.</p>
        </div>
        <span className="profile-version-chip">{actionable.length} need attention</span>
      </div>

      {selectedRequirement && evidence ? (
        <div className="requirement-evidence-workspace">
          <div className="requirement-selector" role="group" aria-label="Requirements needing attention">
            {actionable.map((requirement) => {
              const meta = profileRequirementMeta[requirement.status];
              const RequirementIcon = meta.Icon;
              const itemEvidence = buildRequirementEvidence(
                requirement,
                caseItem.candidateText,
                caseItem.referenceText,
                assessment.profileName,
              );
              const isSelected = requirement.id === selectedRequirement.id;
              return (
                <button
                  className={`requirement-selector-row tone-${meta.tone}${isSelected ? " selected" : ""}`}
                  type="button"
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => onSelectRequirement(requirement.id)}
                  key={requirement.id}
                >
                  <span className="profile-result-icon"><RequirementIcon aria-hidden="true" /></span>
                  <span>
                    <strong>{requirement.label}</strong>
                    <small>{itemEvidence.finding}</small>
                    <code>{requirement.evidencePath}</code>
                  </span>
                  <span className={`profile-result-status tone-${meta.tone}`}>{meta.label}</span>
                </button>
              );
            })}
          </div>

          <article className="requirement-detail" aria-live="polite">
            <header className="requirement-detail-head">
              <div>
                <span className="eyebrow">Candidate FHIR evidence</span>
                <h3>{selectedRequirement.label}</h3>
              </div>
              <span className={`profile-result-status tone-${profileRequirementMeta[selectedRequirement.status].tone}`}>
                {profileRequirementMeta[selectedRequirement.status].label}
              </span>
            </header>

            <div className="plain-language-finding">
              <span>In simple terms</span>
              <strong>{evidence.finding}</strong>
            </div>

            <dl className="requirement-explanation-grid">
              <div>
                <dt>Organisation rule</dt>
                <dd>{requirementDefinition?.summary ?? selectedRequirement.detail}</dd>
              </div>
              <div>
                <dt>Why it matters</dt>
                <dd>{evidence.whyItMatters}</dd>
              </div>
              <div>
                <dt>What would resolve it</dt>
                <dd>{evidence.howToResolve}</dd>
              </div>
            </dl>

            <div className="candidate-location-row">
              <span><FileJson aria-hidden="true" /> Exact candidate location</span>
              <code>{evidence.candidateLocation}</code>
            </div>

            {evidence.parseError ? (
              <div className="candidate-parse-warning" role="alert">
                <AlertTriangle aria-hidden="true" />
                <span>{evidence.parseError} The original candidate response is shown below.</span>
              </div>
            ) : null}

            <CandidateResourceCode evidence={evidence} />

            {evidence.expectedCode ? (
              <details className="expected-fhir-shape">
                <summary>
                  <span>Expected fields from the reference FHIR</span>
                  <ChevronRight aria-hidden="true" />
                </summary>
                <pre><code>{evidence.expectedCode}</code></pre>
              </details>
            ) : null}

            <button className="open-candidate-action" type="button" onClick={() => onOpenCandidate(selectedRequirement)}>
              Open full candidate FHIR <ArrowRight aria-hidden="true" />
            </button>
          </article>
        </div>
      ) : (
        <div className="result-clear-state requirement-clear-state">
          <CircleCheck aria-hidden="true" />
          <span>Every organisation requirement was met by this candidate.</span>
        </div>
      )}

      {passed.length > 0 ? (
        <details className="met-requirements">
          <summary>
            <span><CircleCheck aria-hidden="true" /> {passed.length} requirements met</span>
            <ChevronRight aria-hidden="true" />
          </summary>
          <div>
            {passed.map((requirement) => (
              <span key={requirement.id}><CircleCheck aria-hidden="true" /> {requirement.label}</span>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
};

const EvidenceDrawer = ({
  caseItem,
  focusRequirement,
  tab,
  onTabChange,
  onClose,
}: {
  caseItem: CaseFinding;
  focusRequirement: ProfileRequirementResult | null;
  tab: EvidenceTab;
  onTabChange: (tab: EvidenceTab) => void;
  onClose: () => void;
}) => {
  const focusedEvidence = focusRequirement && caseItem.profileAssessment
    ? buildRequirementEvidence(
        focusRequirement,
        caseItem.candidateText,
        caseItem.referenceText,
        caseItem.profileAssessment.profileName,
      )
    : null;

  return (
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
        ) : tab === "candidate" ? (
          <>
            {focusRequirement && focusedEvidence ? (
              <section className="candidate-focus-card">
                <div>
                  <span className="eyebrow">Focused requirement</span>
                  <h3>{focusRequirement.label}</h3>
                  <p>{focusedEvidence.finding}</p>
                </div>
                <dl>
                  <div><dt>FHIR location</dt><dd><code>{focusedEvidence.candidateLocation}</code></dd></div>
                  <div><dt>Missing fields</dt><dd>{focusedEvidence.missingFields.join(", ") || "No field is missing"}</dd></div>
                </dl>
              </section>
            ) : null}
            <CandidateFullCode candidateText={caseItem.candidateText} evidence={focusedEvidence} />
          </>
        ) : (
          <pre className="evidence-code">
            <code>{caseItem.referenceText ?? "No reference preview available."}</code>
          </pre>
        )}
      </div>
    </aside>
    </div>
  );
};

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
        "resourceType": "ImagingStudy",
        "status": "available",
        "modality": [{ "system": "http://dicom.nema.org/resources/ontology/DCM", "code": "DX" }],
        "subject": { "reference": "urn:uuid:patient-1" }
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
              <span>CDA/XML, companion PDF, candidate FHIR, reference FHIR, and optional policy.</span>
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
              ["Organisation", "Choose whose converter is being assessed."],
              ["Upload", "Add the CDA, PDF, reference and candidate FHIR."],
              ["Score", "Measure faithfulness, coverage, compliance, privacy, latency."],
              ["Apply gates", "Classify each organisation requirement as met, advisory, review or block."],
              ["Review", "Show one organisation-specific decision with evidence."],
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
            FHIR represents healthcare data as modular resources. The controlled demo focuses on a
            radiology Bundle containing Patient, DiagnosticReport and ImagingStudy resources.
          </p>
          <div className="schema-grid">
            <div className="schema-card">
              <strong>Core resources</strong>
              <dl>
                <div><dt>Bundle</dt><dd>Container for resources and exchange payloads.</dd></div>
                <div><dt>Patient</dt><dd>Identity, demographics, identifiers.</dd></div>
                <div><dt>DiagnosticReport</dt><dd>Report context, narrative and clinical impression.</dd></div>
                <div><dt>ImagingStudy</dt><dd>Study identifiers, modality and imaging context.</dd></div>
                <div><dt>Organization</dt><dd>Diagnostic service responsible for the report.</dd></div>
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
            <li>Upload the synthetic radiology CDA, PDF, candidate FHIR and reference FHIR.</li>
            <li>Show that the PDF contains the radiologist, organisation, DICOM UID and imaging context.</li>
            <li>Run Hospital, GP clinic and Radiology practice sequentially with the same files.</li>
            <li>Compare Ready, Conditional and Not Ready decisions against exact FHIR paths.</li>
            <li>Use Evidence to prove that only the organisation requirements changed.</li>
          </ol>
          <div className="reference-row">
            <a href="https://hl7.org/fhir/R4/bundle.html" target="_blank" rel="noreferrer">
              FHIR Bundle R4
            </a>
            <a href="https://hl7.org/fhir/R4/diagnosticreport.html" target="_blank" rel="noreferrer">
              FHIR DiagnosticReport R4
            </a>
            <a href="https://hl7.org/fhir/R4/imagingstudy.html" target="_blank" rel="noreferrer">
              FHIR ImagingStudy R4
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
      <small title={files.length > 1 ? files.map((file) => file.name).join(" · ") : undefined}>
        {files.length > 1 ? files.map((file) => file.name).join(" · ") : hint}
      </small>
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

const traceColors = [
  "#8b7bff",
  "#28b7d6",
  "#35c88a",
  "#efb84a",
  "#eb6f92",
  "#518eff",
  "#ef7d59",
  "#9bc85b",
];

const traceStyle = (index: number) => ({
  "--trace-color": traceColors[Math.max(0, index) % traceColors.length],
}) as CSSProperties;

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
  const selectedResourceIndex = parsedCandidate.resources.findIndex(
    (resource) => resource.key === selectedResourceKey,
  );
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

      <section className="document-inspector" style={traceStyle(selectedResourceIndex)} aria-label="Source document and generated FHIR comparison">
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
                {parsedCandidate.resources.map((resource, resourceIndex) => {
                  const target = `${resource.resourceType}/${resource.id}`;
                  const linkedMappings = sourceMappings.filter((mapping) => mapping.targetResource === target);
                  const isActive = selectedResource?.key === resource.key;
                  return (
                    <article
                      className={`fhir-resource-card ${isActive ? "active" : ""} ${linkedMappings.length > 0 ? "linked" : "unlinked"}`}
                      style={traceStyle(resourceIndex)}
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
  const [selectedProfileId, setSelectedProfileId] = useState<DeploymentProfileId | null>(null);
  const [reuseContext, setReuseContext] = useState<{
    evaluationId: string;
    profileName: string;
  } | null>(null);
  const [lastSubmittedEvaluationId, setLastSubmittedEvaluationId] = useState<string | null>(null);
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
  const [dataSearch, setDataSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedRequirement, setSelectedRequirement] = useState<{
    evaluationId: string;
    requirementId: string;
  } | null>(null);
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

          setEvaluations(dashboardEvaluations);
          if (dashboardEvaluations.length > 0) {
            setSelectedId((current) =>
              current === demoEvaluation.id ? dashboardEvaluations[0].id : current,
            );
          }
        }
      } catch {
        if (!cancelled) {
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

  const selectedRequirementId = selectedRequirement?.evaluationId === selectedEvaluation.id
    ? selectedRequirement.requirementId
    : null;
  const focusedRequirement = selectedEvaluation.profileAssessment?.requirements.find(
    (requirement) => requirement.id === selectedRequirementId,
  ) ?? null;

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

  const selectedEvaluationProfile = getDeploymentProfile(selectedEvaluation.deploymentProfileId);
  const isSelectedEvaluationRunning = ["RUNNING", "UPLOADING"].includes(
    selectedEvaluation.status.toUpperCase(),
  );
  const selectedDecisionPresentation = profileDecisionPresentation(
    selectedEvaluation.decision,
    selectedEvaluationProfile?.name ?? null,
  );
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

  const selectedDeploymentProfile = getDeploymentProfile(selectedProfileId);
  const hasCdaSource = uploads.clinicalBundle.some((file) =>
    /\.(?:xml|cda|ccda)$/i.test(file.name),
  );
  const hasPdfSource = uploads.clinicalBundle.some((file) => /\.pdf$/i.test(file.name));
  const hasReferenceFhir = uploads.expectedResources.length > 0;
  const hasCandidateFhir = uploads.candidateOutputs.length > 0;
  const isEvaluationReady = Boolean(
    selectedDeploymentProfile
    && hasCdaSource
    && hasPdfSource
    && hasReferenceFhir
    && hasCandidateFhir,
  );
  const setupChecks = [
    { label: "Organisation", ready: Boolean(selectedDeploymentProfile) },
    { label: "CDA + PDF", ready: hasCdaSource && hasPdfSource },
    { label: "Reference", ready: hasReferenceFhir },
    { label: "Candidate", ready: hasCandidateFhir },
  ];
  const completedSetupChecks = setupChecks.filter((item) => item.ready).length;
  const canReuseSelectedFiles =
    selectedEvaluation.id === lastSubmittedEvaluationId
    && !isSelectedEvaluationRunning
    && hasCdaSource
    && hasPdfSource
    && hasReferenceFhir
    && hasCandidateFhir;

  const openFreshEvaluation = () => {
    setUploads(defaultUploads());
    setSelectedProfileId(null);
    setReuseContext(null);
    setView("create");
  };

  const reuseSelectedFiles = () => {
    if (!canReuseSelectedFiles) {
      setToast("The original local files are no longer available. Start a new evaluation and add them again.");
      return;
    }

    const previousProfile = getDeploymentProfile(selectedEvaluation.deploymentProfileId);
    setSelectedProfileId(null);
    setReuseContext({
      evaluationId: selectedEvaluation.id,
      profileName: previousProfile?.name ?? "the previous organisation",
    });
    setView("create");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  const loadCapabilitySample = async () => {
    setIsLoadingDemo(true);
    setToast(null);
    try {
      const sample = await loadDemoDataset();
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
            "Generate one FHIR R4 Bundle from the CDA and companion radiology PDF. Use the CDA as structured context and enrich it with PDF-only findings, impression, reporting organisation, radiologist, accession number, DICOM Study UID, modality and body site when explicitly supported. Create Patient, DiagnosticReport, ImagingStudy, Organization and Practitioner resources where evidence exists. Preserve exact identifiers, dates and references; do not infer missing facts. Return JSON only.",
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

    if (!selectedDeploymentProfile) {
      setToast("Choose one organisation's requirements first.");
      return;
    }

    if (!hasCdaSource || !hasPdfSource) {
      setToast("Add both the CDA/XML source and its companion PDF.");
      return;
    }

    if (!hasReferenceFhir || !hasCandidateFhir) {
      setToast("Add the reference FHIR and candidate FHIR files.");
      return;
    }

    const pendingId = `uploading-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const pendingEvaluation = buildPendingEvaluation({
      id: pendingId,
      createdAt,
      stage: "UPLOADING_FILES",
      deploymentProfileId: selectedDeploymentProfile.id,
      modelId,
      documents: pendingFileRefs(uploads.clinicalBundle),
      referenceOutputs: pendingFileRefs(uploads.expectedResources),
      policyFiles: pendingFileRefs(uploads.governancePolicies),
      aiOutputs: pendingFileRefs(uploads.candidateOutputs),
    });

    setIsSubmitting(true);
    setEvaluations((current) => [pendingEvaluation, ...current]);
    setSelectedId(pendingId);
    setSelectedRequirement(null);
    setView("results");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));

    let startedEvaluationId: string | null = null;
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
      const documents = toRemoteRefs(uploaded, "documents");
      const referenceOutputs = toRemoteRefs(uploaded, "referenceOutputs");
      const policyFiles = toRemoteRefs(uploaded, "policyFiles");
      const aiOutputs = toRemoteRefs(uploaded, "aiOutputs");
      const response = await startEvaluation({
        capability: "structured_clinical_resource_generation",
        outputSource: "uploaded-outputs",
        documents,
        referenceOutputs,
        policyFiles,
        aiOutputs,
        config: {
          modelId,
          evaluationRules: defaultEvaluationRules,
          generationInstructions: notes,
          evaluatorModel: "gpt-5.4-mini",
          caseMode: "clinical-bundle",
          datasetLabel: `${selectedDeploymentProfile.name} CDA and PDF bundle`,
          deploymentProfileId: selectedDeploymentProfile.id,
        },
      });

      startedEvaluationId = response.evaluationId;
      const queuedEvaluation = buildPendingEvaluation({
        id: response.evaluationId,
        createdAt,
        stage: "QUEUED",
        deploymentProfileId: selectedDeploymentProfile.id,
        modelId,
        documents,
        referenceOutputs,
        policyFiles,
        aiOutputs,
      });
      setEvaluations((current) => [
        queuedEvaluation,
        ...current.filter((item) => item.id !== pendingId && item.id !== response.evaluationId),
      ]);
      setLastSubmittedEvaluationId(response.evaluationId);
      setSelectedId(response.evaluationId);
      setToast("Files uploaded. The organisation requirements are now being applied.");

      try {
        const detail = await getEvaluation(response.evaluationId);
        const dashboardEvaluation = remoteToDashboard(detail.evaluation);
        setEvaluations((current) => [
          dashboardEvaluation,
          ...current.filter((item) => item.id !== dashboardEvaluation.id),
        ]);
      } catch {
        setToast("Evaluation started. Results will appear automatically when the checks finish.");
      }
    } catch (error) {
      setEvaluations((current) => current.filter((item) => item.id !== pendingId));
      if (!startedEvaluationId) {
        setSelectedId(demoEvaluation.id);
        setView("create");
      }
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
          runOptions.map((run) => {
            const profile = getDeploymentProfile(run.deploymentProfileId);
            return (
              <option key={run.id} value={run.id}>
                {run.id === demoEvaluation.id
                  ? `Synthetic radiology · ${demoProfile.shortName}`
                  : `${run.id}${profile ? ` · ${profile.shortName}` : ""}`}
              </option>
            );
          })
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
          <button className="primary-top-action" type="button" onClick={openFreshEvaluation}>
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
                    onClick={() => {
                      if (item.id === "create") openFreshEvaluation();
                      else setView(item.id);
                    }}
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
                : view === "create"
                  ? "workspace-create"
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
            <DocumentationPage onCreate={openFreshEvaluation} onData={() => setView("data")} />
          ) : view === "create" ? (
            <section className="plane create-plane">
              <div className="plane-head">
                <div>
                  <span className="eyebrow">Evaluation builder</span>
                  <h1>Evaluate one FHIR output</h1>
                  <p>Select the organisation whose conversion capability is being assessed.</p>
                </div>
                <span className="scope-chip"><ShieldCheck aria-hidden="true" /> Same capability · one organisation</span>
              </div>

              {reuseContext ? (
                <div className="reuse-banner" role="status">
                  <span className="reuse-banner-icon"><Link2 aria-hidden="true" /></span>
                  <span>
                    <strong>Same case retained</strong>
                    <small>
                      CDA, PDF, reference and candidate from {reuseContext.profileName} remain unchanged.
                    </small>
                  </span>
                  <span className="reuse-run-id">{reuseContext.evaluationId}</span>
                </div>
              ) : null}

              <div className="card">
                <div className="section-heading numbered-heading">
                  <span>01</span>
                  <div><h2 className="card-title">Choose organisation requirements</h2><small>The files stay constant; only this organisation's acceptance rules apply.</small></div>
                </div>
                <div className="profile-selector-grid" role="radiogroup" aria-label="Organisation requirements">
                  {deploymentProfiles.map((profile) => {
                    const active = selectedProfileId === profile.id;
                    const ProfileIcon = profile.id === "hospital"
                      ? Database
                      : profile.id === "gp-clinic"
                        ? FileText
                        : ScanLine;
                    const wasPrevious = reuseContext?.profileName === profile.name;
                    return (
                      <button
                        className={active ? "profile-select-card active" : "profile-select-card"}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSelectedProfileId(profile.id)}
                        key={profile.id}
                      >
                        <span className="profile-select-head">
                          <span className="profile-select-icon"><ProfileIcon aria-hidden="true" /></span>
                          <span className="profile-level">{profile.level}</span>
                        </span>
                        <span className="profile-select-copy">
                          <strong>{profile.name}</strong>
                          <small>{profile.purpose}</small>
                        </span>
                        <span className="profile-preview-list">
                          {profile.requirements.slice(0, 3).map((requirement) => (
                            <span key={requirement.id}>
                              <CircleCheck aria-hidden="true" />
                              {requirement.label}
                            </span>
                          ))}
                        </span>
                        <span className="profile-select-foot">
                          <span>Requirements v{profile.version}</span>
                          <strong>{active ? "Selected" : wasPrevious ? "Previous run" : "Select"}</strong>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="card">
                <div className="section-heading numbered-heading">
                  <span>02</span>
                  <div><h2 className="card-title">Upload the case</h2><small>The CDA and companion PDF are assessed together as one clinical source.</small></div>
                </div>
                <div className="file-grid">
                  <FileField
                    label="Clinical source bundle"
                    accept=".pdf,.xml,.cda,.ccda,.txt,.md,.json"
                    files={uploads.clinicalBundle}
                    hint="CDA/XML + companion PDF · required"
                    onChange={(files) => {
                      setUploads((current) => ({ ...current, clinicalBundle: files }));
                      setReuseContext(null);
                    }}
                  />
                  <FileField
                    label="Candidate FHIR"
                    accept=".json,.txt,.md,.csv"
                    files={uploads.candidateOutputs}
                    hint="Output being assessed · required"
                    onChange={(files) => {
                      setUploads((current) => ({ ...current, candidateOutputs: files }));
                      setReuseContext(null);
                    }}
                  />
                  <FileField
                    label="Reference FHIR"
                    accept=".json,.txt,.md,.csv"
                    files={uploads.expectedResources}
                    hint="Approved expected output · required"
                    onChange={(files) => {
                      setUploads((current) => ({ ...current, expectedResources: files }));
                      setReuseContext(null);
                    }}
                  />
                  <FileField
                    label="Supporting policy"
                    accept=".pdf,.txt,.md,.json"
                    files={uploads.governancePolicies}
                    hint="Additional governance context · optional"
                    onChange={(files) => {
                      setUploads((current) => ({ ...current, governancePolicies: files }));
                      setReuseContext(null);
                    }}
                  />
                </div>
              </div>

              <div className="card create-footer">
                <div className="run-summary">
                  <span className="eyebrow">03 · Review and run</span>
                  <h2>
                    {selectedDeploymentProfile
                      ? `Assess for ${selectedDeploymentProfile.name}`
                      : "Complete the setup"}
                  </h2>
                  <p>
                    {selectedDeploymentProfile
                      ? `${selectedDeploymentProfile.requirements.length} organisation requirements will be applied automatically.`
                      : "Choose an organisation and add all required files."}
                  </p>
                  <div className="setup-checks" aria-label={`${completedSetupChecks} of ${setupChecks.length} setup steps complete`}>
                    {setupChecks.map((item) => (
                      <span className={item.ready ? "ready" : ""} key={item.label}>
                        {item.ready ? <CircleCheck aria-hidden="true" /> : <span aria-hidden="true" />}
                        {item.label}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  className="primary-action"
                  disabled={isSubmitting || !isEvaluationReady}
                  type="button"
                  onClick={() => void submitEvaluation()}
                >
                  <Play aria-hidden="true" />
                  {isSubmitting ? "Uploading and starting…" : "Run readiness evaluation"}
                </button>
                <details className="advanced-settings">
                  <summary>
                    <span>Advanced settings</span>
                    <small>Candidate model label and scoring note</small>
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
                    <span className="run-primary"><FlaskConical aria-hidden="true" /><span><strong>Synthetic radiology baseline</strong><small>{demoProfile.name} · Requirements v{demoProfile.version}</small></span></span>
                    <span>{formatDate(demoEvaluation.createdAt)}</span>
                    <strong>{score(demoEvaluation.readinessScore)}</strong>
                    <StatusPill value={demoEvaluation.decision} tone="warn" />
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
                {evaluations.map((evaluation) => (
                  <div className="run-registry-row" key={evaluation.id}>
                    <button type="button" onClick={() => { setSelectedId(evaluation.id); setView("results"); }}>
                      <span className="run-primary"><Activity aria-hidden="true" /><span><strong>{evaluation.id}</strong><small>{getDeploymentProfile(evaluation.deploymentProfileId)?.name ?? evaluation.capability}</small></span></span>
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
                <button className="primary-action" type="button" onClick={openFreshEvaluation}>
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
                        onClick={() => {
                          setSelectedRequirement(null);
                          setSelectedCaseId(caseItem.id);
                          setEvidenceTab("summary");
                        }}
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
                  <span className="eyebrow">
                    {selectedEvaluationProfile
                      ? `${selectedEvaluationProfile.name} · Requirements v${selectedEvaluationProfile.version}`
                      : selectedEvaluation.capability}
                  </span>
                  <h1>Readiness report</h1>
                  <p>
                    CDA + PDF → FHIR · {formatDate(selectedEvaluation.createdAt)} ·{" "}
                    {selectedEvaluation.outputSource === "platform-model"
                      ? "platform model"
                      : "uploaded candidate"}
                  </p>
                </div>
                <div className="head-actions">{runPicker}</div>
              </div>

              {isSelectedEvaluationRunning ? (
                <EvaluationProgressCard
                  evaluationId={selectedEvaluation.id}
                  startedAt={selectedEvaluation.createdAt}
                  stage={selectedEvaluation.stage}
                  profileName={selectedEvaluationProfile?.name ?? null}
                />
              ) : null}

              {!isSelectedEvaluationRunning ? (
                <section
                  className={`result-decision tone-${decisionTone[selectedEvaluation.decision]}`}
                  aria-labelledby="result-decision-title"
                >
                <div className="result-decision-copy">
                  <div className="result-decision-label">
                    <span className="result-decision-icon"><SelectedDecisionIcon aria-hidden="true" /></span>
                    <span>Organisation decision</span>
                    <StatusPill
                      value={selectedEvaluation.decision}
                      tone={decisionTone[selectedEvaluation.decision]}
                    />
                  </div>
                  <h2 id="result-decision-title">{selectedDecisionPresentation.heading}</h2>
                  <p>{selectedDecisionPresentation.summary}</p>
                  <div className="result-decision-actions">
                    <a className="decision-action" href="#requirement-evidence">
                      See exactly why <ArrowRight aria-hidden="true" />
                    </a>
                    {canReuseSelectedFiles ? (
                      <button className="decision-reuse-action" type="button" onClick={reuseSelectedFiles}>
                        <Link2 aria-hidden="true" />
                        Evaluate same files for another organisation
                      </button>
                    ) : null}
                  </div>
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
                  <div><dt>Blocking requirements</dt><dd>{selectedEvaluation.profileAssessment?.blockingCount ?? summary.blockers}</dd></div>
                  <div><dt>Review requirements</dt><dd>{selectedEvaluation.profileAssessment?.reviewCount ?? summary.review}</dd></div>
                  <div>
                    <dt>Requirements met</dt>
                    <dd>
                      {selectedEvaluation.profileAssessment
                        ? `${selectedEvaluation.profileAssessment.passCount}/${selectedEvaluation.profileAssessment.requirements.length}`
                        : "-"}
                    </dd>
                  </div>
                </dl>
                </section>
              ) : null}

              {!isSelectedEvaluationRunning ? (
                <div className="result-body">
                <div className="result-main-column">
                  {selectedEvaluation.profileAssessment && selectedEvaluation.cases[0] ? (
                    <RequirementEvidenceWorkspace
                      assessment={selectedEvaluation.profileAssessment}
                      caseItem={selectedEvaluation.cases[0]}
                      selectedRequirementId={selectedRequirementId}
                      onSelectRequirement={(requirementId) => setSelectedRequirement({
                        evaluationId: selectedEvaluation.id,
                        requirementId,
                      })}
                      onOpenCandidate={(requirement) => {
                        setSelectedRequirement({
                          evaluationId: selectedEvaluation.id,
                          requirementId: requirement.id,
                        });
                        setSelectedCaseId(selectedEvaluation.cases[0].id);
                        setEvidenceTab("candidate");
                      }}
                    />
                  ) : (
                    <section className="result-section" aria-labelledby="attention-title">
                      <div className="result-section-head">
                        <div>
                          <span className="eyebrow">Decision evidence</span>
                          <h2 id="attention-title">What needs attention</h2>
                        </div>
                        <span className="result-count">{selectedEvaluation.issues.length}</span>
                      </div>
                      {selectedEvaluation.issues.length > 0 ? (
                        <ul className="attention-list">
                          {[...visibleIssues, ...remainingIssues].map((item) => (
                            <li key={item}>
                              <span><AlertTriangle aria-hidden="true" /></span>
                              <p>{item}</p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="result-clear-state">
                          <CircleCheck aria-hidden="true" />
                          <span>No issues require attention.</span>
                        </div>
                      )}
                    </section>
                  )}

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
              ) : null}
            </section>
          )}
        </main>
      </div>

      {selectedCase ? (
        <EvidenceDrawer
          caseItem={selectedCase}
          focusRequirement={focusedRequirement}
          tab={evidenceTab}
          onTabChange={setEvidenceTab}
          onClose={() => {
            setSelectedCaseId(null);
            setSelectedRequirement(null);
          }}
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
