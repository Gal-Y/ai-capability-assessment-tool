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
  deleteEvaluation,
  getEvaluation,
  listEvaluations,
  startEvaluation,
  uploadLocalFiles,
  type RemoteEvaluation,
  type RemoteFileRef,
  type UploadedFileResult,
} from "./lib/api";

type ViewId = "home" | "new-evaluation" | "results" | "guide-index" | "guide-detail";
type StepId = 1 | 2 | 3 | 4 | 5;
type Decision = "Ready" | "Conditional" | "Not Ready";
type EvaluationStatus = "RUNNING" | "COMPLETED" | "FAILED";
type Tone = "good" | "warn" | "bad" | "neutral";
type OutputSource = "platform-model" | "uploaded-outputs";
type UploadFieldKey = "documents" | "referenceOutputs" | "policyFiles" | "aiOutputs";
type SubmissionPhase = "uploading" | "starting" | null;
type GuideCapabilityId = "document-summarisation";

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
  referenceText?: string | null;
  candidateSummary: string;
  source: OutputSource;
  modelId: string | null;
  metrics: {
    faithfulness: number;
    coverage: number;
    compliance: number;
    privacy: number;
  };
  semanticMetrics: {
    faithfulness: number;
    coverage: number;
    compliance: number;
    privacy: number;
  };
  deterministicMetrics: {
    faithfulness: number;
    coverage: number;
    compliance: number;
    privacy: number;
  };
  deterministicChecks: {
    matchedSourceFacts: string[];
    unsupportedCandidateFacts: string[];
    missingReferenceFacts: string[];
    matchedReferenceKeywords: string[];
    missingReferenceKeywords: string[];
    requiredRuleMisses: string[];
    forbiddenRuleHits: string[];
    privacyFlags: string[];
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
  workflowStage: string;
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
  semanticMetrics: {
    faithfulness: number | null;
    coverage: number | null;
    compliance: number | null;
    privacy: number | null;
  };
  deterministicMetrics: {
    faithfulness: number | null;
    coverage: number | null;
    compliance: number | null;
    privacy: number | null;
  };
  scoreBreakdown: {
    judgeWeights: {
      semantic: number;
      deterministic: number;
    };
    metricWeights: {
      faithfulness: number;
      coverage: number;
      compliance: number;
      privacy: number;
    };
    semanticComposite: number | null;
    deterministicComposite: number | null;
    hybridComposite: number | null;
    formula: string | null;
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

const judgeWeightDefaults = {
  semantic: 0.7,
  deterministic: 0.3,
};

const metricWeightDefaults = {
  faithfulness: 0.35,
  coverage: 0.3,
  compliance: 0.2,
  privacy: 0.15,
};

const metricDefinitions = [
  {
    key: "faithfulness",
    label: "Faithfulness",
    description: "Accuracy relative to the source document",
  },
  {
    key: "coverage",
    label: "Coverage",
    description: "Completeness vs. the reference benchmark",
  },
  {
    key: "compliance",
    label: "Compliance",
    description: "Adherence to policy guidance",
  },
  {
    key: "privacy",
    label: "Privacy",
    description: "Avoidance of sensitive content",
  },
] as const;

const availableModels = [
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
] as const;

const defaultModelId = "gpt-5.4-mini";

const workflowStages = [
  { id: "QUEUED", label: "Queued", description: "Waiting for the AWS workflow to begin." },
  { id: "VALIDATING_INPUT", label: "Validate inputs", description: "Checking the uploaded files and required inputs." },
  { id: "BUILDING_CASES", label: "Build cases", description: "Pairing each source document with its benchmark summary." },
  { id: "GENERATING_OUTPUTS", label: "Generate outputs", description: "Using the selected platform model to create candidate summaries." },
  { id: "LOADING_OUTPUTS", label: "Load outputs", description: "Loading uploaded AI summaries for scoring." },
  { id: "SCORING", label: "Score with evaluator", description: "Comparing each candidate against the source document, reference output, and policy guidance." },
  { id: "COMPLETED", label: "Final report", description: "Writing the completed evaluation report and results." },
] as const;

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

const capabilityGuides: Record<
  GuideCapabilityId,
  {
    title: string;
    summary: string;
    sections: Array<{
      title: string;
      paragraphs: string[];
      bullets?: string[];
    }>;
  }
> = {
  "document-summarisation": {
    title: "Document summarisation",
    summary:
      "This guide describes the actual backend pipeline for document summarisation: what the workflow does, what each model call receives, how findings are produced, and how the final score is calculated.",
    sections: [
      {
        title: "Runtime overview",
        paragraphs: [
          "A document-summarisation run is an AWS Step Functions workflow with a small set of Lambda stages. The workflow does not currently build a separate expected-answer rubric JSON before scoring.",
          "Instead, each case is scored in a single evaluator call that sees the source document, the reference output, any optional policy guidance, and the candidate summary together.",
        ],
      },
      {
        title: "What the backend treats as inputs",
        paragraphs: [
          "The source document is the ground truth for factual accuracy. The reference output is the benchmark for what strong coverage should include. Optional policy guidance is treated as extra compliance or privacy constraints.",
          "The candidate summary comes from one of two places: either the platform model generates it during the workflow, or the user uploads it directly and the workflow reads it as the candidate output.",
        ],
        bullets: [
          "Source document: truth source for faithfulness.",
          "Reference output: benchmark for coverage and usefulness.",
          "Policy guidance: optional extra constraints only.",
          "Candidate output: generated by the platform model or loaded from uploaded AI outputs.",
        ],
      },
      {
        title: "Stage 1. validate_input",
        paragraphs: [
          "The `validate_input` Lambda checks that the workflow has at least one source document, at least one reference output, and a coherent output mode.",
          "In uploaded-output mode it also requires one uploaded candidate output per source document. In platform-model mode it requires a model ID.",
        ],
      },
      {
        title: "Stage 2. build_test_cases",
        paragraphs: [
          "The `build_test_cases` Lambda creates one test case per source document.",
          "Each case contains the source document, one reference output, the optional policy files, and an uploaded candidate output if the run is using uploaded-output mode. If there are fewer reference outputs than source documents, the workflow reuses an available reference so every case can still be scored.",
        ],
      },
      {
        title: "Stage 3. resolve candidate output",
        paragraphs: [
          "In platform-model mode, `generate_platform_outputs` calls the selected OpenAI model with the system instruction `summarise this document`, the attached source document, and any optional policy guidance. The response text becomes the candidate summary for that case.",
          "In uploaded-output mode, `load_uploaded_outputs` skips generation and marks the uploaded candidate file as the resolved output for scoring.",
        ],
      },
      {
        title: "Stage 4. score_evaluation",
        paragraphs: [
          "For each case, `score_evaluation` runs two scoring paths in parallel. The semantic path sends the source document, the reference output, optional policy guidance, and the candidate summary to the evaluator model in one structured scoring call.",
          "The deterministic path extracts exact numeric/date facts, benchmark keywords, policy-rule fragments, and privacy patterns from the files directly in Python. It then scores fact support, benchmark coverage, policy-rule hits, and privacy flags without another model call.",
          "The backend stores both score sets, blends them into the final hybrid metrics, and also stores readable preview text for the reference output when it can extract it.",
        ],
      },
      {
        title: "How the score is calculated",
        paragraphs: [
          "Each case produces two score sets for `faithfulness`, `coverage`, `compliance`, and `privacy`: one from the LLM judge and one from deterministic checks. The backend blends each metric with `0.70 * semantic + 0.30 * deterministic` to produce the final hybrid metric for that case.",
          "The backend then averages those hybrid metrics across all cases. The composite readiness score is calculated with a deterministic weighted formula: `0.35 * faithfulness + 0.30 * coverage + 0.20 * compliance + 0.15 * privacy`.",
          "The decision is `Ready` if every metric passes its threshold, `Conditional` if every metric is within four points of its threshold, and `Not Ready` otherwise.",
        ],
        bullets: [
          "Faithfulness threshold: 92",
          "Coverage threshold: 86",
          "Compliance threshold: 90",
          "Privacy threshold: 96",
        ],
      },
      {
        title: "What gets written to storage",
        paragraphs: [
          "The workflow writes intermediate artifacts such as validation output, built test cases, resolved platform outputs, and the final report into the artifacts bucket.",
          "The DynamoDB evaluation record stores the final aggregated result, per-case findings, token usage, processing time, and workflow stage. The results page reads from that saved evaluation record.",
        ],
      },
      {
        title: "Current implementation notes",
        paragraphs: [
          "The current evaluator is stricter about source-based omissions than reference-only omissions because the source document is treated as ground truth. That means a finding can appear even when the reference summary also missed the same detail.",
          "This guide currently covers document summarisation only. Additional capability guides can be added later in the same backend-oriented format.",
        ],
      },
    ],
  },
};

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

const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

const getDecisionFromMetrics = (metrics: {
  faithfulness: number;
  coverage: number;
  compliance: number;
  privacy: number;
}): Decision => {
  const passes = (
    Object.entries(thresholds) as Array<[keyof typeof thresholds, number]>
  ).every(([name, threshold]) => metrics[name] >= threshold);
  const nearPass = (
    Object.entries(thresholds) as Array<[keyof typeof thresholds, number]>
  ).every(([name, threshold]) => metrics[name] >= threshold - 4);

  if (passes) {
    return "Ready";
  }

  return nearPass ? "Conditional" : "Not Ready";
};

const getCompositeFromMetrics = (metrics: {
  faithfulness: number;
  coverage: number;
  compliance: number;
  privacy: number;
}) =>
  Math.round(
    (
      metrics.faithfulness * metricWeightDefaults.faithfulness +
      metrics.coverage * metricWeightDefaults.coverage +
      metrics.compliance * metricWeightDefaults.compliance +
      metrics.privacy * metricWeightDefaults.privacy
    ) * 10,
  ) / 10;

const buildMetricBlendFormula = (
  semanticValue: number | null | undefined,
  deterministicValue: number | null | undefined,
  finalValue: number | null | undefined,
  judgeWeights: { semantic: number; deterministic: number } = judgeWeightDefaults,
) => {
  if (
    !isFiniteNumber(semanticValue) ||
    !isFiniteNumber(deterministicValue) ||
    !isFiniteNumber(finalValue)
  ) {
    return null;
  }

  return `${judgeWeights.semantic.toFixed(2)} × ${semanticValue.toFixed(1)} + ${judgeWeights.deterministic.toFixed(2)} × ${deterministicValue.toFixed(1)} = ${finalValue.toFixed(1)}`;
};

const buildCompositeFormula = (
  metrics: {
    faithfulness: number | null;
    coverage: number | null;
    compliance: number | null;
    privacy: number | null;
  },
  metricWeights: {
    faithfulness: number;
    coverage: number;
    compliance: number;
    privacy: number;
  } = metricWeightDefaults,
  finalValue?: number | null,
) => {
  const values = [
    metrics.faithfulness,
    metrics.coverage,
    metrics.compliance,
    metrics.privacy,
  ];

  if (!values.every((value) => isFiniteNumber(value))) {
    return null;
  }

  const resolvedFinalValue =
    finalValue ?? getCompositeFromMetrics({
      faithfulness: metrics.faithfulness as number,
      coverage: metrics.coverage as number,
      compliance: metrics.compliance as number,
      privacy: metrics.privacy as number,
    });

  return `${metricWeights.faithfulness.toFixed(2)} × ${(metrics.faithfulness as number).toFixed(1)} + ${metricWeights.coverage.toFixed(2)} × ${(metrics.coverage as number).toFixed(1)} + ${metricWeights.compliance.toFixed(2)} × ${(metrics.compliance as number).toFixed(1)} + ${metricWeights.privacy.toFixed(2)} × ${(metrics.privacy as number).toFixed(1)} = ${resolvedFinalValue.toFixed(1)}`;
};

const scaleMetricSet = <T extends {
  faithfulness: number;
  coverage: number;
  compliance: number;
  privacy: number;
}>(metrics: T): T => ({
  ...metrics,
  faithfulness: metrics.faithfulness * 10,
  coverage: metrics.coverage * 10,
  compliance: metrics.compliance * 10,
  privacy: metrics.privacy * 10,
});

const normalizeLegacyResultScale = (evaluation: RemoteEvaluation) => {
  const metrics = evaluation.result?.metrics;
  const caseResults = evaluation.result?.caseResults ?? [];
  const metricValues = [
    metrics?.faithfulness,
    metrics?.coverage,
    metrics?.compliance,
    metrics?.privacy,
    ...caseResults.flatMap((caseResult) => [
      caseResult.metrics.faithfulness,
      caseResult.metrics.coverage,
      caseResult.metrics.compliance,
      caseResult.metrics.privacy,
    ]),
  ].filter(isFiniteNumber);

  const isLegacyTenPointScale =
    metricValues.length > 0 &&
    metricValues.every((value) => value >= 0 && value <= 10) &&
    (!isFiniteNumber(evaluation.result?.readinessScore) ||
      evaluation.result!.readinessScore <= 10);

  if (!isLegacyTenPointScale) {
    return {
      readinessScore: evaluation.result?.readinessScore ?? null,
      decision: evaluation.result?.decision ?? null,
      metrics: metrics ?? null,
      semanticMetrics: evaluation.result?.semanticMetrics ?? null,
      deterministicMetrics: evaluation.result?.deterministicMetrics ?? null,
      scoreBreakdown: evaluation.result?.scoreBreakdown ?? null,
      caseResults,
    };
  }

  const normalizedMetrics = metrics
    ? {
        ...scaleMetricSet(metrics),
        latency: metrics.latency,
      }
    : null;

  return {
    readinessScore:
      evaluation.result?.readinessScore === undefined ||
      evaluation.result?.readinessScore === null
        ? null
        : evaluation.result.readinessScore * 10,
    decision:
      normalizedMetrics === null
        ? evaluation.result?.decision ?? null
        : getDecisionFromMetrics(normalizedMetrics),
    metrics: normalizedMetrics,
    semanticMetrics: evaluation.result?.semanticMetrics
      ? scaleMetricSet(evaluation.result.semanticMetrics)
      : normalizedMetrics
        ? {
            faithfulness: normalizedMetrics.faithfulness,
            coverage: normalizedMetrics.coverage,
            compliance: normalizedMetrics.compliance,
            privacy: normalizedMetrics.privacy,
          }
        : null,
    deterministicMetrics: evaluation.result?.deterministicMetrics
      ? scaleMetricSet(evaluation.result.deterministicMetrics)
      : null,
    scoreBreakdown: evaluation.result?.scoreBreakdown
      ? {
          ...evaluation.result.scoreBreakdown,
          semanticComposite:
            evaluation.result.scoreBreakdown.semanticComposite * 10,
          deterministicComposite:
            evaluation.result.scoreBreakdown.deterministicComposite * 10,
          hybridComposite: evaluation.result.scoreBreakdown.hybridComposite * 10,
        }
      : null,
    caseResults: caseResults.map((caseResult) => ({
      ...caseResult,
      metrics: scaleMetricSet(caseResult.metrics),
      semanticMetrics: caseResult.semanticMetrics
        ? scaleMetricSet(caseResult.semanticMetrics)
        : scaleMetricSet(caseResult.metrics),
      deterministicMetrics: caseResult.deterministicMetrics
        ? scaleMetricSet(caseResult.deterministicMetrics)
        : scaleMetricSet(caseResult.metrics),
    })),
  };
};

const mapRemoteEvaluation = (evaluation: RemoteEvaluation): EvaluationRecord => {
  const normalizedResult = normalizeLegacyResultScale(evaluation);

  return {
    id: evaluation.evaluationId,
    createdAt: evaluation.createdAt,
    status: toEvaluationStatus(evaluation.status),
    workflowStage:
      evaluation.workflowStage ?? (evaluation.status === "FAILED" ? "FAILED" : "QUEUED"),
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
    readinessScore: normalizedResult.readinessScore,
    decision: normalizedResult.decision,
    metrics: {
      faithfulness: normalizedResult.metrics?.faithfulness ?? null,
      coverage: normalizedResult.metrics?.coverage ?? null,
      compliance: normalizedResult.metrics?.compliance ?? null,
      privacy: normalizedResult.metrics?.privacy ?? null,
      latency: normalizedResult.metrics?.latency ?? null,
    },
    semanticMetrics: {
      faithfulness: normalizedResult.semanticMetrics?.faithfulness ?? null,
      coverage: normalizedResult.semanticMetrics?.coverage ?? null,
      compliance: normalizedResult.semanticMetrics?.compliance ?? null,
      privacy: normalizedResult.semanticMetrics?.privacy ?? null,
    },
    deterministicMetrics: {
      faithfulness: normalizedResult.deterministicMetrics?.faithfulness ?? null,
      coverage: normalizedResult.deterministicMetrics?.coverage ?? null,
      compliance: normalizedResult.deterministicMetrics?.compliance ?? null,
      privacy: normalizedResult.deterministicMetrics?.privacy ?? null,
    },
    scoreBreakdown: {
      judgeWeights: normalizedResult.scoreBreakdown?.judgeWeights ?? judgeWeightDefaults,
      metricWeights:
        normalizedResult.scoreBreakdown?.metricWeights ?? metricWeightDefaults,
      semanticComposite: normalizedResult.scoreBreakdown?.semanticComposite ?? null,
      deterministicComposite: normalizedResult.scoreBreakdown?.deterministicComposite ?? null,
      hybridComposite: normalizedResult.scoreBreakdown?.hybridComposite ?? normalizedResult.readinessScore,
      formula: normalizedResult.scoreBreakdown?.formula ?? null,
    },
    issues: evaluation.result?.issues ?? (evaluation.error ? [evaluation.error] : []),
    strengths: evaluation.result?.strengths ?? [],
    caseResults: normalizedResult.caseResults.map((caseResult) => ({
      caseId: caseResult.caseId,
      sourceDocument: caseResult.sourceDocument,
      referenceOutput: caseResult.referenceOutput ?? null,
      referenceText: caseResult.referenceText ?? null,
      candidateSummary: caseResult.candidateSummary,
      source: caseResult.source,
      modelId: caseResult.modelId ?? null,
      metrics: caseResult.metrics,
      semanticMetrics: caseResult.semanticMetrics ?? caseResult.metrics,
      deterministicMetrics: caseResult.deterministicMetrics ?? caseResult.metrics,
      deterministicChecks: {
        matchedSourceFacts: caseResult.deterministicChecks?.matchedSourceFacts ?? [],
        unsupportedCandidateFacts:
          caseResult.deterministicChecks?.unsupportedCandidateFacts ?? [],
        missingReferenceFacts:
          caseResult.deterministicChecks?.missingReferenceFacts ?? [],
        matchedReferenceKeywords:
          caseResult.deterministicChecks?.matchedReferenceKeywords ?? [],
        missingReferenceKeywords:
          caseResult.deterministicChecks?.missingReferenceKeywords ?? [],
        requiredRuleMisses:
          caseResult.deterministicChecks?.requiredRuleMisses ?? [],
        forbiddenRuleHits:
          caseResult.deterministicChecks?.forbiddenRuleHits ?? [],
        privacyFlags: caseResult.deterministicChecks?.privacyFlags ?? [],
      },
      strengths: caseResult.strengths ?? [],
      missingPoints: caseResult.missingPoints ?? [],
      issues: caseResult.issues ?? [],
      policyFindings: caseResult.policyFindings ?? [],
      generationLatencySeconds: caseResult.generationLatencySeconds ?? null,
      evaluationLatencySeconds: caseResult.evaluationLatencySeconds,
    })),
    documents: evaluation.documents.map(mapRemoteFile),
    referenceOutputs: evaluation.referenceOutputs.map(mapRemoteFile),
    policyFiles: evaluation.policyFiles.map(mapRemoteFile),
    aiOutputs: evaluation.aiOutputs.map(mapRemoteFile),
  };
};

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

const getWorkflowStageMeta = (stage: string, outputSource: OutputSource) => {
  const normalizedStage =
    stage === "GENERATING_OUTPUTS" && outputSource === "uploaded-outputs"
      ? "LOADING_OUTPUTS"
      : stage;

  return (
    workflowStages.find((item) => item.id === normalizedStage) ?? {
      id: normalizedStage,
      label: toTitleCase(normalizedStage),
      description: "Workflow stage update received from AWS.",
    }
  );
};

const getWorkflowStageSequence = (outputSource: OutputSource) =>
  outputSource === "platform-model"
    ? ["QUEUED", "VALIDATING_INPUT", "BUILDING_CASES", "GENERATING_OUTPUTS", "SCORING"]
    : ["QUEUED", "VALIDATING_INPUT", "BUILDING_CASES", "LOADING_OUTPUTS", "SCORING"];

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
    workflowStage: "QUEUED",
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
    semanticMetrics: {
      faithfulness: null,
      coverage: null,
      compliance: null,
      privacy: null,
    },
    deterministicMetrics: {
      faithfulness: null,
      coverage: null,
      compliance: null,
      privacy: null,
    },
    scoreBreakdown: {
      judgeWeights: judgeWeightDefaults,
      metricWeights: metricWeightDefaults,
      semanticComposite: null,
      deterministicComposite: null,
      hybridComposite: null,
      formula: null,
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

const RunningWorkflowPanel = ({
  heading,
  summary,
  stages,
}: {
  heading: string;
  summary: string;
  stages: Array<{
    id: string;
    label: string;
    description: string;
    state: "complete" | "active" | "pending";
  }>;
}) => {
  const completedCount = stages.filter((stage) => stage.state === "complete").length;
  const activeCount = stages.filter((stage) => stage.state === "active").length;
  const progress = Math.round(
    ((completedCount + activeCount * 0.5) / Math.max(1, stages.length)) * 100,
  );

  return (
    <article className="panel workflow-panel">
      <div className="panel-header">
        <span className="panel-title">{heading}</span>
        <span className="workflow-live">
          <span className="workflow-live__dot" /> Live
        </span>
      </div>

      <p className="workflow-summary">{summary}</p>

      <div className="workflow-progress">
        <div className="workflow-progress__bar">
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="workflow-progress__label">{progress}% complete</span>
      </div>

      <div className="workflow-list">
        {stages.map((stage, index) => (
          <div
            className={`workflow-step workflow-step--${stage.state}`}
            key={`${stage.id}-${index}`}
          >
            <div className="workflow-step__marker">
              <span>
                {stage.state === "complete" ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2.5 6.5L5 9l4.5-5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </span>
            </div>
            <div className="workflow-step__body">
              <strong>{stage.label}</strong>
              <span>{stage.description}</span>
            </div>
          </div>
        ))}
      </div>
    </article>
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

const CaseFindingGroup = ({
  label,
  items,
  emptyLabel,
}: {
  label: string;
  items: string[];
  emptyLabel: string;
}) => (
  <div className="case-finding-group">
    <span className="detail-label">{label}</span>
    {items.length > 0 ? (
      <div className="case-finding-list">
        {items.map((item) => (
          <div key={`${label}-${item}`} className="case-finding-item">
            {item}
          </div>
        ))}
      </div>
    ) : (
      <div className="case-finding-empty">{emptyLabel}</div>
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
  const [isDashboardNavOpen, setIsDashboardNavOpen] = useState(true);
  const [selectedGuideCapability, setSelectedGuideCapability] =
    useState<GuideCapabilityId>("document-summarisation");
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
  const [submissionPhase, setSubmissionPhase] = useState<SubmissionPhase>(null);
  const [pollingEvaluationId, setPollingEvaluationId] = useState<string | null>(null);
  const [workflowClock, setWorkflowClock] = useState(() => Date.now());
  const isPollingRef = useRef(false);
  const [isDeletingEvaluation, setIsDeletingEvaluation] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);

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

  const openDashboardView = (nextView: "home" | "results") => {
    setIsDashboardNavOpen(true);
    setStatusMessage(null);
    setView(nextView);
  };

  const openGuideIndex = () => {
    setStatusMessage(null);
    setView("guide-index");
  };

  const openGuideDetail = (capability: GuideCapabilityId) => {
    setSelectedGuideCapability(capability);
    setStatusMessage(null);
    setView("guide-detail");
  };

  useEffect(() => {
    if (view === "home" || view === "results") {
      setIsDashboardNavOpen(true);
    }
  }, [view]);

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
    if (isPollingRef.current) {
      return;
    }
    isPollingRef.current = true;
    setPollingEvaluationId(evaluationId);

    try {
      const response = await getEvaluation(evaluationId);
      const nextEvaluation = mapRemoteEvaluation(response.evaluation);
      setEvaluations((current) => upsertEvaluation(current, nextEvaluation));
      setSelectedEvaluationId(evaluationId);
    } catch {
      // Swallow polling errors silently — the interval will retry shortly.
    } finally {
      isPollingRef.current = false;
      setPollingEvaluationId((current) => (current === evaluationId ? null : current));
    }
  };

  // Continuous polling via setInterval so stage transitions are always visible.
  // We use a ref for the evaluation ID so the interval callback never captures
  // a stale closure while the React state updates asynchronously.
  const runningEvaluationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastEvaluation?.status === "RUNNING") {
      runningEvaluationIdRef.current = lastEvaluation.id;
    } else {
      runningEvaluationIdRef.current = null;
    }
  }, [lastEvaluation]);

  useEffect(() => {
    // Poll every 800 ms. The callback reads from the ref so it always targets
    // the current running evaluation even after re-renders.
    const interval = window.setInterval(() => {
      const id = runningEvaluationIdRef.current;
      if (id) {
        void pollEvaluation(id);
      }
    }, 350);

    return () => {
      window.clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (lastEvaluation?.status !== "RUNNING") {
      return;
    }

    const interval = window.setInterval(() => {
      setWorkflowClock(Date.now());
    }, 450);

    return () => {
      window.clearInterval(interval);
    };
  }, [lastEvaluation?.id, lastEvaluation?.status]);

  const handleDeleteEvaluation = async (evaluation: EvaluationRecord) => {
    if (evaluation.status === "RUNNING") {
      setStatusMessage("Running evaluations cannot be deleted.");
      return;
    }

    const confirmed = window.confirm(
      `Delete evaluation ${evaluation.id}? This removes the saved result and report metadata.`,
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingEvaluation(true);
    setStatusMessage(null);

    try {
      await deleteEvaluation(evaluation.id);
      const nextEvaluations = evaluations.filter((item) => item.id !== evaluation.id);
      setEvaluations(nextEvaluations);
      if (selectedEvaluationId === evaluation.id) {
        setSelectedEvaluationId(nextEvaluations[0]?.id ?? null);
      }

      setStatusMessage("Evaluation deleted.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to delete the evaluation.",
      );
    } finally {
      setIsDeletingEvaluation(false);
    }
  };

  const runEvaluation = async () => {
    if (draft.outputSource === null) {
      return;
    }

    setIsSubmittingEvaluation(true);
    setSubmissionPhase("uploading");
    setStatusMessage(null);

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
      setSubmissionPhase("starting");
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
      setView("results");
      void pollEvaluation(evaluationResponse.evaluationId);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to start the evaluation.",
      );
    } finally {
      setIsSubmittingEvaluation(false);
      setSubmissionPhase(null);
    }
  };

  const getWorkflowStagesForEvaluation = (evaluation: EvaluationRecord) => {
    const stageSequence = getWorkflowStageSequence(evaluation.outputSource);
    const stages = workflowStages.filter((stage) => stageSequence.includes(stage.id));
    const actualStage = getWorkflowStageMeta(
      evaluation.workflowStage,
      evaluation.outputSource,
    ).id;
    const elapsedMs = Math.max(
      0,
      workflowClock - new Date(evaluation.createdAt).getTime(),
    );
    const syntheticStage =
      elapsedMs >= 6200
        ? stageSequence[stageSequence.length - 1]
        : elapsedMs >= 3000
          ? stageSequence[3]
          : elapsedMs >= 1800
            ? stageSequence[2]
            : elapsedMs >= 900
              ? stageSequence[1]
              : stageSequence[0];
    const actualIndex = stageSequence.indexOf(actualStage);
    const syntheticIndex = stageSequence.indexOf(syntheticStage);
    const currentStageId =
      actualIndex === -1
        ? syntheticStage
        : stageSequence[Math.max(actualIndex, syntheticIndex)] ?? actualStage;
    const currentIndex = stages.findIndex((stage) => stage.id === currentStageId);

    return stages.map((stage, index) => ({
      ...stage,
      state:
        currentIndex === -1
          ? "pending"
          : index < currentIndex
            ? "complete"
            : index === currentIndex
              ? "active"
              : "pending",
    })) as Array<{
      id: string;
      label: string;
      description: string;
      state: "complete" | "active" | "pending";
    }>;
  };

  const renderHome = () => (
    <>
      <header className="screen-header hero-header">
        <div>
          <span className="screen-label">Dashboard</span>
          <h1>Welcome back</h1>
          <p className="hero-subtitle">
            Evaluate AI capabilities with deterministic, real-world workflows. Spin up an
            assessment in minutes.
          </p>
        </div>
        <div className="header-actions">
          <button className="primary-button" onClick={openNewEvaluation} type="button">
            + New evaluation
          </button>
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
              <div
                key={evaluation.id}
                className="table__row table__row--interactive"
                onClick={() => {
                  setSelectedEvaluationId(evaluation.id);
                  setView("results");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedEvaluationId(evaluation.id);
                    setView("results");
                  }
                }}
                role="button"
                tabIndex={0}
              >
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

      {isSubmittingEvaluation ? (
        <article className="panel submission-panel">
          <div className="submission-panel__pulse" aria-hidden="true" />
          <div className="submission-panel__body">
            <span className="panel-label">Launching</span>
            <strong>
              {submissionPhase === "uploading"
                ? "Uploading files to AWS S3..."
                : "Starting the evaluation workflow..."}
            </strong>
            <span>
              Hang tight — we&rsquo;re preparing your evaluation. The live workflow will appear in
              a moment.
            </span>
          </div>
        </article>
      ) : null}

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
            {isSubmittingEvaluation
              ? submissionPhase === "uploading"
                ? "Uploading files..."
                : "Starting workflow..."
              : "Run evaluation"}
          </button>
        )}
      </section>
    </>
  );

  const renderResults = () => {
    const tone = lastEvaluation
      ? getTone(lastEvaluation.decision, lastEvaluation.status)
      : "neutral";

    return (
      <>
        {/* ── Page header ─────────────────────────────────────── */}
        <header className="screen-header">
          <div>
            <span className="screen-label">Results</span>
            <h1>
              {lastEvaluation?.status === "RUNNING"
                ? "Evaluation in progress"
                : lastEvaluation?.status === "COMPLETED"
                  ? "Evaluation report"
                  : lastEvaluation?.status === "FAILED"
                    ? "Evaluation failed"
                    : "Latest result"}
            </h1>
          </div>
          <div className="header-actions">
            {lastEvaluation && lastEvaluation.status !== "RUNNING" ? (
              <button
                className="ghost-button danger-button"
                disabled={isDeletingEvaluation}
                onClick={() => void handleDeleteEvaluation(lastEvaluation)}
                type="button"
              >
                {isDeletingEvaluation ? "Deleting…" : "Delete"}
              </button>
            ) : null}
            <button className="primary-button" onClick={openNewEvaluation} type="button">
              + New evaluation
            </button>
          </div>
        </header>

        {statusMessage ? <div className="status-banner">{statusMessage}</div> : null}

        {/* ── No evaluation yet ───────────────────────────────── */}
        {!lastEvaluation ? (
          <article className="panel results-empty-hero">
            <div className="results-empty-hero__icon" aria-hidden="true">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <rect x="6" y="6" width="28" height="28" rx="6" stroke="currentColor" strokeWidth="1.8" />
                <path d="M13 20h14M13 14h14M13 26h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <strong>No evaluations yet</strong>
            <span>Run your first evaluation to see the report here.</span>
            <button className="primary-button" onClick={openNewEvaluation} type="button">
              Start evaluation
            </button>
          </article>
        ) : lastEvaluation.status === "RUNNING" ? (

          /* ── Running ──────────────────────────────────────── */
          <>
            {/* Live status strip */}
            <div className="running-strip">
              <div className="running-strip__left">
                <span className="running-strip__pill">
                  <span className="running-strip__dot" />
                  Live
                </span>
                <div>
                  <p className="running-strip__stage">
                    {getWorkflowStageMeta(lastEvaluation.workflowStage, lastEvaluation.outputSource).label}
                  </p>
                  <p className="running-strip__desc">
                    {getWorkflowStageMeta(lastEvaluation.workflowStage, lastEvaluation.outputSource).description}
                  </p>
                </div>
              </div>
              <div className="running-strip__right">
                <div className="running-strip__meta">
                  <span className="panel-label">Started</span>
                  <strong>
                    {new Intl.DateTimeFormat("en-AU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(lastEvaluation.createdAt))}
                  </strong>
                </div>
                <div className="running-strip__meta">
                  <span className="panel-label">Source docs</span>
                  <strong>{lastEvaluation.documentCount}</strong>
                </div>
                <div className="running-strip__meta">
                  <span className="panel-label">Output</span>
                  <strong>
                    {lastEvaluation.outputSource === "platform-model"
                      ? getModelLabel(lastEvaluation.modelId)
                      : "Uploaded"}
                  </strong>
                </div>
              </div>
            </div>

            {/* Workflow tracker + setup side-by-side */}
            <section className="running-body">
              <RunningWorkflowPanel
                heading="Workflow progress"
                stages={getWorkflowStagesForEvaluation(lastEvaluation)}
                summary={getWorkflowStageMeta(lastEvaluation.workflowStage, lastEvaluation.outputSource).description}
              />

              <article className="panel running-setup-panel">
                <div className="panel-header">
                  <span className="panel-title">Evaluation setup</span>
                </div>
                <div className="running-setup-grid">
                  <div>
                    <span className="detail-label">Capability</span>
                    <strong>{lastEvaluation.capability}</strong>
                  </div>
                  <div>
                    <span className="detail-label">Output mode</span>
                    <strong>
                      {lastEvaluation.outputSource === "platform-model"
                        ? "Platform model"
                        : "Uploaded AI outputs"}
                    </strong>
                  </div>
                  <div>
                    <span className="detail-label">Source documents</span>
                    <strong>{lastEvaluation.documentCount}</strong>
                  </div>
                  <div>
                    <span className="detail-label">Reference outputs</span>
                    <strong>{lastEvaluation.referenceCount}</strong>
                  </div>
                  <div>
                    <span className="detail-label">Policy files</span>
                    <strong>{lastEvaluation.policyCount}</strong>
                  </div>
                  <div>
                    <span className="detail-label">
                      {lastEvaluation.outputSource === "platform-model" ? "Model" : "AI outputs"}
                    </span>
                    <strong>
                      {lastEvaluation.outputSource === "platform-model"
                        ? getModelLabel(lastEvaluation.modelId)
                        : `${lastEvaluation.outputCount} files`}
                    </strong>
                  </div>
                </div>
                <div className="running-id">
                  <span className="panel-label">Evaluation ID</span>
                  <code>{lastEvaluation.id}</code>
                </div>
              </article>
            </section>
          </>

        ) : lastEvaluation.status === "FAILED" ? (

          /* ── Failed ───────────────────────────────────────── */
          <article className="panel results-empty-hero results-empty-hero--danger">
            <div className="results-empty-hero__icon" aria-hidden="true">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="1.8" />
                <path d="M15 15l10 10M25 15L15 25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <strong>Evaluation failed</strong>
            <span>
              {lastEvaluation.issues[0] ??
                "The workflow failed before a completed score could be written."}
            </span>
          </article>

        ) : (

          /* ── Completed ────────────────────────────────────── */
          <>
            {/* Hero verdict banner */}
            <div className={`results-hero results-hero--${tone}`}>
              <div className="results-hero__left">
                <span className="results-hero__label">Overall verdict</span>
                <h2 className="results-hero__decision">
                  {lastEvaluation.decision ?? "Completed"}
                </h2>
                <div className="results-hero__meta">
                  <span>{lastEvaluation.capability}</span>
                  <span className="results-hero__dot" aria-hidden="true" />
                  <span>
                    {lastEvaluation.outputSource === "platform-model"
                      ? getModelLabel(lastEvaluation.modelId)
                      : "Uploaded outputs"}
                  </span>
                  <span className="results-hero__dot" aria-hidden="true" />
                  <span>
                    {new Intl.DateTimeFormat("en-AU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(lastEvaluation.createdAt))}
                  </span>
                </div>
              </div>
              <div className="results-hero__right">
                <div className="results-score-dial">
                  <svg className="results-score-dial__ring" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
                    <circle
                      cx="60"
                      cy="60"
                      r="52"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 52}`}
                      strokeDashoffset={`${2 * Math.PI * 52 * (1 - (lastEvaluation.readinessScore ?? 0) / 100)}`}
                      transform="rotate(-90 60 60)"
                    />
                  </svg>
                  <div className="results-score-dial__inner">
                    <strong>{lastEvaluation.readinessScore?.toFixed(1) ?? "—"}</strong>
                    <span>/ 100</span>
                  </div>
                </div>
                <p className="results-score-label">Readiness score</p>
              </div>
            </div>

            {/* Quick-stat strip */}
            <div className="results-stat-strip">
              <div className="results-stat">
                <span className="panel-label">Runtime</span>
                <strong>{formatSeconds(lastEvaluation.processingSeconds)}</strong>
              </div>
              <div className="results-stat">
                <span className="panel-label">Tokens used</span>
                <strong>{formatTokenCount(lastEvaluation.tokenUsage?.totalTokens ?? null)}</strong>
              </div>
              <div className="results-stat">
                <span className="panel-label">Cases evaluated</span>
                <strong>{lastEvaluation.caseResults.length || lastEvaluation.documentCount}</strong>
              </div>
              <div className="results-stat">
                <span className="panel-label">Evaluator</span>
                <strong>{getModelLabel(lastEvaluation.evaluatorModel)}</strong>
              </div>
              <div className="results-stat">
                <span className="panel-label">Avg latency</span>
                <strong>{formatLatency(lastEvaluation.metrics.latency)}</strong>
              </div>
            </div>

            <section className="results-score-grid">
              <article className="panel results-score-panel">
                <div className="panel-header">
                  <span className="panel-title">Score calculation</span>
                  <DecisionPill
                    label={getDecisionLabel(lastEvaluation)}
                    tone={tone}
                  />
                </div>

                <div className="score-calc-grid">
                  <div className="score-calc-card">
                    <span className="panel-label">Semantic judge</span>
                    <strong>
                      {lastEvaluation.scoreBreakdown.semanticComposite?.toFixed(1) ?? "—"}
                    </strong>
                    <span>LLM-based semantic scoring</span>
                  </div>
                  <div className="score-calc-card">
                    <span className="panel-label">Deterministic</span>
                    <strong>
                      {lastEvaluation.scoreBreakdown.deterministicComposite?.toFixed(1) ?? "—"}
                    </strong>
                    <span>Exact facts, keyword coverage, rules, privacy</span>
                  </div>
                  <div className="score-calc-card score-calc-card--accent">
                    <span className="panel-label">Final hybrid</span>
                    <strong>
                      {lastEvaluation.scoreBreakdown.hybridComposite?.toFixed(1) ??
                        lastEvaluation.readinessScore?.toFixed(1) ??
                        "—"}
                    </strong>
                    <span>
                      {`${Math.round(lastEvaluation.scoreBreakdown.judgeWeights.semantic * 100)}% semantic + ${Math.round(lastEvaluation.scoreBreakdown.judgeWeights.deterministic * 100)}% deterministic`}
                    </span>
                  </div>
                </div>

                <div className="score-formula-strip">
                  <span className="panel-label">Hybrid metric formula</span>
                  <div className="score-formula-list">
                    {metricDefinitions.map((metric) => {
                      const formula = buildMetricBlendFormula(
                        lastEvaluation.semanticMetrics[metric.key],
                        lastEvaluation.deterministicMetrics[metric.key],
                        lastEvaluation.metrics[metric.key],
                        lastEvaluation.scoreBreakdown.judgeWeights,
                      );

                      return formula ? (
                        <div className="score-formula-row" key={metric.key}>
                          <strong>{metric.label}</strong>
                          <code>{formula}</code>
                        </div>
                      ) : null;
                    })}
                  </div>
                </div>

                <div className="score-formula-strip score-formula-strip--accent">
                  <span className="panel-label">Final readiness formula</span>
                  <code>
                    {buildCompositeFormula(
                      lastEvaluation.metrics,
                      lastEvaluation.scoreBreakdown.metricWeights,
                      lastEvaluation.scoreBreakdown.hybridComposite ??
                        lastEvaluation.readinessScore,
                    ) ??
                      lastEvaluation.scoreBreakdown.formula ??
                      "final_score = 0.35 × faithfulness + 0.30 × coverage + 0.20 × compliance + 0.15 × privacy"}
                  </code>
                </div>
              </article>

              <article className="panel results-metrics-panel">
                <div className="panel-header">
                  <span className="panel-title">Metric breakdown</span>
                </div>

                {lastEvaluation.metrics.faithfulness !== null &&
                lastEvaluation.metrics.coverage !== null &&
                lastEvaluation.metrics.compliance !== null &&
                lastEvaluation.metrics.privacy !== null ? (
                  <div className="metric-compare-table">
                    <div className="metric-compare-table__head">
                      <span>Metric</span>
                      <span>LLM judge</span>
                      <span>Deterministic</span>
                      <span>Final hybrid</span>
                      <span>Target</span>
                    </div>

                    {metricDefinitions.map((metric) => {
                      const finalValue = lastEvaluation.metrics[metric.key];
                      const semanticValue = lastEvaluation.semanticMetrics[metric.key];
                      const deterministicValue = lastEvaluation.deterministicMetrics[metric.key];
                      const target = thresholds[metric.key];
                      const finalTone = (finalValue ?? 0) >= target ? "good" : "bad";

                      return (
                        <div className="metric-compare-table__row" key={metric.key}>
                          <div className="metric-compare-table__metric">
                            <strong>{metric.label}</strong>
                            <span>{metric.description}</span>
                          </div>
                          <span>{semanticValue?.toFixed(1) ?? "—"}</span>
                          <span>{deterministicValue?.toFixed(1) ?? "—"}</span>
                          <span className={`metric-compare-table__final metric-compare-table__final--${finalTone}`}>
                            {finalValue?.toFixed(1) ?? "—"}
                          </span>
                          <span>{target}%</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="results-no-metrics">Metric scores have not been written yet.</p>
                )}
              </article>
            </section>

            {/* Findings row — strengths + issues */}
            <section className="results-findings-row">
              {/* Strengths */}
              <article className="panel results-finding-panel results-finding-panel--good">
                <div className="panel-header">
                  <span className="panel-title">Strengths</span>
                  {lastEvaluation.strengths.length > 0 ? (
                    <span className="results-finding-count results-finding-count--good">
                      {lastEvaluation.strengths.length}
                    </span>
                  ) : null}
                </div>
                {lastEvaluation.strengths.length > 0 ? (
                  <ul className="results-finding-list">
                    {lastEvaluation.strengths.map((s, i) => (
                      <li key={i} className="results-finding-item results-finding-item--good">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                          <path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {s}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="results-finding-empty">No strengths recorded for this run.</p>
                )}
              </article>

              {/* Issues */}
              <article className="panel results-finding-panel results-finding-panel--bad">
                <div className="panel-header">
                  <span className="panel-title">Issues</span>
                  {lastEvaluation.issues.length > 0 ? (
                    <span className="results-finding-count results-finding-count--bad">
                      {lastEvaluation.issues.length}
                    </span>
                  ) : null}
                </div>
                {lastEvaluation.issues.length > 0 ? (
                  <ul className="results-finding-list">
                    {lastEvaluation.issues.map((s, i) => (
                      <li key={i} className="results-finding-item results-finding-item--bad">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                          <path d="M7 4.5v3M7 9.5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                        {s}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="results-finding-empty">No blocking issues detected.</p>
                )}
              </article>
            </section>

            {/* Case results accordion */}
            {lastEvaluation.caseResults.length > 0 ? (
              <article className="panel results-cases-panel">
                <div className="panel-header">
                  <span className="panel-title">Case breakdown</span>
                  <span className="panel-meta">
                    {lastEvaluation.caseResults.length} case{lastEvaluation.caseResults.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="results-accordion">
                  {lastEvaluation.caseResults.map((cr) => {
                    const isOpen = expandedCaseId === cr.caseId;
                    const caseScore = getCompositeFromMetrics(cr.metrics);
                    const caseTone =
                      caseScore >= 88 ? "good" : caseScore >= 70 ? "warn" : "bad";

                    return (
                      <div key={cr.caseId} className={`accordion-item ${isOpen ? "accordion-item--open" : ""}`}>
                        <button
                          className="accordion-trigger"
                          onClick={() => setExpandedCaseId(isOpen ? null : cr.caseId)}
                          type="button"
                          aria-expanded={isOpen}
                        >
                          <div className="accordion-trigger__left">
                            <span className={`accordion-trigger__indicator accordion-trigger__indicator--${caseTone}`} />
                            <div className="accordion-trigger__info">
                              <strong>{cr.sourceDocument}</strong>
                              <span>{cr.caseId}</span>
                            </div>
                          </div>
                          <div className="accordion-trigger__right">
                            <div className="accordion-badges">
                              {(
                                [
                                  { k: "F", v: cr.metrics.faithfulness, t: thresholds.faithfulness },
                                  { k: "C", v: cr.metrics.coverage, t: thresholds.coverage },
                                  { k: "Co", v: cr.metrics.compliance, t: thresholds.compliance },
                                  { k: "P", v: cr.metrics.privacy, t: thresholds.privacy },
                                ] as const
                              ).map((m) => (
                                <span
                                  key={m.k}
                                  className={`accordion-badge accordion-badge--${m.v >= m.t ? "good" : "bad"}`}
                                  title={`${m.k}: ${m.v}%`}
                                >
                                  {m.k} {m.v}%
                                </span>
                              ))}
                            </div>
                            <span className={`accordion-score accordion-score--${caseTone}`}>
                              {caseScore.toFixed(1)}
                            </span>
                            <svg
                              className={`accordion-chevron ${isOpen ? "accordion-chevron--open" : ""}`}
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M4 6l4 4 4-4"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </div>
                        </button>

                        {isOpen ? (
                          <div className="accordion-body">
                            {/* Case meta */}
                            <div className="accordion-meta-strip">
                              <div>
                                <span className="panel-label">Reference</span>
                                <span>{cr.referenceOutput ?? "Not attached"}</span>
                              </div>
                              <div>
                                <span className="panel-label">Candidate</span>
                                <span>
                                  {cr.source === "platform-model"
                                    ? `${getModelLabel(cr.modelId)}`
                                    : "Uploaded AI output"}
                                </span>
                              </div>
                              <div>
                                <span className="panel-label">Eval latency</span>
                                <span>{formatSeconds(cr.evaluationLatencySeconds)}</span>
                              </div>
                              {cr.generationLatencySeconds !== null ? (
                                <div>
                                  <span className="panel-label">Gen latency</span>
                                  <span>{formatSeconds(cr.generationLatencySeconds)}</span>
                                </div>
                              ) : null}
                            </div>

                            <div className="accordion-score-grid">
                              <div className="accordion-score-card">
                                <span className="panel-label">Semantic judge</span>
                                <strong>{getCompositeFromMetrics(cr.semanticMetrics).toFixed(1)}</strong>
                                <span>LLM-based semantic scoring</span>
                              </div>
                              <div className="accordion-score-card">
                                <span className="panel-label">Deterministic</span>
                                <strong>{getCompositeFromMetrics(cr.deterministicMetrics).toFixed(1)}</strong>
                                <span>Exact facts, benchmark terms, rules, privacy</span>
                              </div>
                              <div className="accordion-score-card accordion-score-card--accent">
                                <span className="panel-label">Final hybrid</span>
                                <strong>{caseScore.toFixed(1)}</strong>
                                <span>70% semantic + 30% deterministic</span>
                              </div>
                            </div>

                            <div className="accordion-metric-table">
                              <div className="accordion-metric-table__head">
                                <span>Metric</span>
                                <span>LLM</span>
                                <span>Det</span>
                                <span>Final</span>
                              </div>
                              {metricDefinitions.map((metric) => (
                                <div className="accordion-metric-table__row" key={metric.key}>
                                  <span>{metric.label}</span>
                                  <span>{cr.semanticMetrics[metric.key].toFixed(1)}</span>
                                  <span>{cr.deterministicMetrics[metric.key].toFixed(1)}</span>
                                  <span>{cr.metrics[metric.key].toFixed(1)}</span>
                                </div>
                              ))}
                            </div>

                            <div className="accordion-formula-strip">
                              <span className="panel-label">Case score formula</span>
                              <code>
                                {buildCompositeFormula(cr.metrics, metricWeightDefaults, caseScore) ??
                                  "0.35 × faithfulness + 0.30 × coverage + 0.20 × compliance + 0.15 × privacy"}
                              </code>
                            </div>

                            {/* Text comparison */}
                            <div className="accordion-compare">
                              <div className="accordion-pane">
                                <div className="accordion-pane__label">
                                  <span className="panel-label">Reference output</span>
                                </div>
                                <div className="accordion-pane__text">
                                  {cr.referenceText?.trim() ? (
                                    <pre>{cr.referenceText}</pre>
                                  ) : (
                                    <p className="accordion-pane__empty">
                                      Reference text not available. Re-run the evaluation after
                                      redeploying the backend to populate this field.
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="accordion-pane">
                                <div className="accordion-pane__label">
                                  <span className="panel-label">Candidate summary</span>
                                  <span>
                                    {cr.source === "platform-model"
                                      ? getModelLabel(cr.modelId)
                                      : "Uploaded"}
                                  </span>
                                </div>
                                <div className="accordion-pane__text">
                                  <pre>{cr.candidateSummary}</pre>
                                </div>
                              </div>
                            </div>

                            {/* Findings */}
                            <div className="accordion-section-heading">
                              <span className="panel-label">LLM judge findings</span>
                            </div>
                            <div className="accordion-findings">
                              {(
                                [
                                  {
                                    label: "Strengths",
                                    items: cr.strengths,
                                    tone: "good",
                                    icon: (
                                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                                        <path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    ),
                                  },
                                  {
                                    label: "Missing points",
                                    items: cr.missingPoints,
                                    tone: "warn",
                                    icon: (
                                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                                        <path d="M7 2v6M7 10v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                      </svg>
                                    ),
                                  },
                                  {
                                    label: "Issues",
                                    items: cr.issues,
                                    tone: "bad",
                                    icon: (
                                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                                        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                                        <path d="M7 4.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                                      </svg>
                                    ),
                                  },
                                  {
                                    label: "Policy findings",
                                    items: cr.policyFindings,
                                    tone: "neutral",
                                    icon: (
                                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                                        <rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
                                        <path d="M4.5 7h5M4.5 4.5h5M4.5 9.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                                      </svg>
                                    ),
                                  },
                                ] as const
                              )
                                .filter((g) => g.items.length > 0)
                                .map((g) => (
                                  <div key={g.label} className={`accordion-finding-group accordion-finding-group--${g.tone}`}>
                                    <span className="panel-label">{g.label}</span>
                                    <ul>
                                      {g.items.map((item, i) => (
                                        <li key={i}>
                                          <span className="accordion-finding-icon" aria-hidden="true">
                                            {g.icon}
                                          </span>
                                          {item}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                            </div>

                            {[
                              {
                                label: "Verified exact facts",
                                items: cr.deterministicChecks.matchedSourceFacts,
                              },
                              {
                                label: "Exact fact mismatches",
                                items: cr.deterministicChecks.unsupportedCandidateFacts,
                              },
                              {
                                label: "Missing benchmark facts",
                                items: cr.deterministicChecks.missingReferenceFacts,
                              },
                              {
                                label: "Missing benchmark terms",
                                items: cr.deterministicChecks.missingReferenceKeywords,
                              },
                              {
                                label: "Policy rule misses",
                                items: [
                                  ...cr.deterministicChecks.requiredRuleMisses,
                                  ...cr.deterministicChecks.forbiddenRuleHits,
                                ],
                              },
                              {
                                label: "Privacy flags",
                                items: cr.deterministicChecks.privacyFlags,
                              },
                            ].some((group) => group.items.length > 0) ? (
                              <>
                                <div className="accordion-section-heading accordion-section-heading--det">
                                  <span className="panel-label">Deterministic checks</span>
                                </div>
                                <div className="accordion-det-grid">
                                {[
                                  {
                                    label: "Verified exact facts",
                                    items: cr.deterministicChecks.matchedSourceFacts,
                                  },
                                  {
                                    label: "Exact fact mismatches",
                                    items: cr.deterministicChecks.unsupportedCandidateFacts,
                                  },
                                  {
                                    label: "Missing benchmark facts",
                                    items: cr.deterministicChecks.missingReferenceFacts,
                                  },
                                  {
                                    label: "Missing benchmark terms",
                                    items: cr.deterministicChecks.missingReferenceKeywords,
                                  },
                                  {
                                    label: "Policy rule misses",
                                    items: [
                                      ...cr.deterministicChecks.requiredRuleMisses,
                                      ...cr.deterministicChecks.forbiddenRuleHits,
                                    ],
                                  },
                                  {
                                    label: "Privacy flags",
                                    items: cr.deterministicChecks.privacyFlags,
                                  },
                                ]
                                  .filter((group) => group.items.length > 0)
                                  .map((group) => (
                                    <div key={group.label} className="accordion-det-card">
                                      <span className="panel-label">{group.label}</span>
                                      <ul>
                                        {group.items.map((item, index) => (
                                          <li key={`${group.label}-${index}`}>{item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </article>
            ) : null}

            {/* Evaluation setup & files */}
            <section className="results-setup-row">
              <article className="panel">
                <div className="panel-header">
                  <span className="panel-title">Evaluation setup</span>
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
                <div className="running-id" style={{ marginTop: 16 }}>
                  <span className="panel-label">Evaluation ID</span>
                  <code>{lastEvaluation.id}</code>
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <span className="panel-title">Files used</span>
                </div>
                <div className="file-columns">
                  <FileListColumn label="Documents" files={lastEvaluation.documents} />
                  <FileListColumn label="Reference outputs" files={lastEvaluation.referenceOutputs} />
                  <FileListColumn label="Rules / policies" files={lastEvaluation.policyFiles} />
                  {lastEvaluation.outputSource === "uploaded-outputs" ? (
                    <FileListColumn label="AI outputs" files={lastEvaluation.aiOutputs} />
                  ) : null}
                </div>
              </article>
            </section>
          </>
        )}
      </>
    );
  };

  const renderGuideIndex = () => (
    <>
      <header className="screen-header">
        <div>
          <span className="screen-label">Guides</span>
          <h1>Capability guides</h1>
        </div>
      </header>

      <section className="guide-index-stack">
        <article className="panel guide-intro-panel">
          <span className="panel-label">Capability library</span>
          <h2>Open a capability guide</h2>
          <p>
            Choose a capability below to inspect how the backend evaluator actually works. Each
            guide documents the runtime pipeline, model calls, findings generation, and score
            calculation for that capability.
          </p>

          <div className="guide-intro-stats">
            <div className="guide-intro-stat">
              <span>Available now</span>
              <strong>1 guide</strong>
            </div>
            <div className="guide-intro-stat">
              <span>Current scope</span>
              <strong>Document summaries</strong>
            </div>
          </div>
        </article>

        <article className="panel guide-directory">
          <div className="guide-directory__intro">
            <span className="panel-label">Available guides</span>
            <strong>Browse capabilities</strong>
          </div>

          <div className="guide-directory__list" role="list">
            <button
              className="guide-row"
              onClick={() => openGuideDetail("document-summarisation")}
              type="button"
            >
              <div className="guide-row__main">
                <strong>Document summarisation</strong>
                <span>
                  Source document, reference output, optional policy guidance, candidate summary,
                  and evaluator scoring.
                </span>
              </div>
              <span className="guide-row__status">Active</span>
              <span className="guide-row__arrow" aria-hidden="true">
                Open →
              </span>
            </button>
          </div>
        </article>
      </section>
    </>
  );

  const renderGuideDetail = () => {
    const guide = capabilityGuides[selectedGuideCapability];

    return (
      <div className="guide-detail-wrapper">
        <header className="screen-header guide-detail-header">
          <div>
            <span className="screen-label">Guide</span>
            <h1>{guide.title}</h1>
          </div>
          <div className="header-actions">
            <button className="ghost-button" onClick={openGuideIndex} type="button">
              ← Back to guides
            </button>
          </div>
        </header>

        <article className="panel guide-doc">
          <header className="guide-doc__header">
            <span className="guide-doc__eyebrow">Capability guide</span>
            <p className="guide-doc__lede">{guide.summary}</p>
          </header>

          <div className="guide-doc__body">
            {guide.sections.map((section) => (
              <section className="guide-doc__section" key={section.title}>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets ? (
                  <ul>
                    {section.bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </article>
      </div>
    );
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L3 7v10l9 5 9-5V7l-9-5z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M3 7l9 5 9-5M12 12v10"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <span className="brand-label">Thesis MVP</span>
            <strong>AI Capability Tool</strong>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <span className="sidebar-section__label">Dashboard</span>
            <button
              className={`sidebar-group__trigger ${
                view === "home" || view === "results" ? "sidebar-group__trigger--active" : ""
              }`}
              onClick={() => setIsDashboardNavOpen((current) => !current)}
              type="button"
            >
              <span className="sidebar-link__inner">
                <svg
                  className="sidebar-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                  <rect x="14" y="3" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                  <rect x="14" y="12" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                  <rect x="3" y="16" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                </svg>
                Dashboard
              </span>
              <span
                className={`sidebar-group__chevron ${
                  isDashboardNavOpen ? "sidebar-group__chevron--open" : ""
                }`}
                aria-hidden="true"
              >
                ▾
              </span>
            </button>

            {isDashboardNavOpen ? (
              <div className="sidebar-subnav">
                <button
                  className={`sidebar-sublink ${view === "home" ? "sidebar-sublink--active" : ""}`}
                  onClick={() => openDashboardView("home")}
                  type="button"
                >
                  Home
                </button>
                <button
                  className={`sidebar-sublink ${
                    view === "results" ? "sidebar-sublink--active" : ""
                  }`}
                  onClick={() => openDashboardView("results")}
                  type="button"
                >
                  Results
                </button>
              </div>
            ) : null}
          </div>

          <div className="sidebar-section">
            <span className="sidebar-section__label">Evaluate</span>
            <button className="sidebar-primary" onClick={openNewEvaluation} type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 5v14M5 12h14"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
              Start evaluation
            </button>
          </div>

          <div className="sidebar-section">
            <span className="sidebar-section__label">Information</span>
            <button
              className={`sidebar-link ${
                view === "guide-index" || view === "guide-detail" ? "sidebar-link--active" : ""
              }`}
              onClick={openGuideIndex}
              type="button"
            >
              <span className="sidebar-link__inner">
                <svg
                  className="sidebar-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M4 4h11a4 4 0 014 4v12H8a4 4 0 01-4-4V4z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M8 8h7M8 12h7M8 16h4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                Capability guides
              </span>
            </button>
          </div>
        </nav>

        <div className="sidebar-panel">
          <div className="sidebar-panel__pulse" aria-hidden="true">
            <span />
          </div>
          <span className="panel-label">Capability live</span>
          <strong>Document summarisation</strong>
          <span className="sidebar-panel__meta">Real OpenAI generation & evaluator scoring</span>
        </div>
      </aside>

      <main className="workspace">
        {view === "home" && renderHome()}
        {view === "new-evaluation" && renderNewEvaluation()}
        {view === "results" && renderResults()}
        {view === "guide-index" && renderGuideIndex()}
        {view === "guide-detail" && renderGuideDetail()}
      </main>
    </div>
  );
}

export default App;
