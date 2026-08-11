import { parseFhirCandidate, type FhirResourceView } from "./capability";
import type { ProfileRequirementResult } from "./deploymentProfiles";

type RequirementGuidance = {
  resourceType: string | null;
  fields: string[];
  finding: (context: EvidenceContext) => string;
  why: (context: EvidenceContext) => string;
  fix: string;
};

type EvidenceContext = {
  profileName: string;
  candidateText: string;
  resourceTypes: string[];
};

export type RequirementEvidence = {
  finding: string;
  whyItMatters: string;
  howToResolve: string;
  candidateLocation: string;
  candidateResourceLabel: string;
  candidateCode: string;
  candidateLineStart: number | null;
  relevantFields: string[];
  missingFields: string[];
  expectedCode: string | null;
  parseError: string | null;
};

const hasNarrativeImagingIdentifiers = (candidateText: string) =>
  /(?:accession|study uid|dicom)/i.test(candidateText);

const hasNarrativeImagingContext = (candidateText: string) =>
  /(?:modality|body site|chest|radiograph)/i.test(candidateText);

const requirementGuidance: Record<string, RequirementGuidance> = {
  "clinical-report-core": {
    resourceType: null,
    fields: ["entry.resource.resourceType"],
    finding: () => "The candidate is missing a Patient or DiagnosticReport resource.",
    why: ({ profileName }) =>
      `${profileName} cannot safely use the bundle without both the patient context and the clinical report.`,
    fix: "Add the missing Patient or DiagnosticReport resource to Bundle.entry.",
  },
  "radiology-core-resources": {
    resourceType: null,
    fields: ["entry.resource.resourceType"],
    finding: () => "The candidate is missing one of the core radiology resources.",
    why: ({ profileName }) =>
      `${profileName} needs Patient, DiagnosticReport and ImagingStudy resources to keep the report connected to the imaging study.`,
    fix: "Add the missing Patient, DiagnosticReport or ImagingStudy resource to Bundle.entry.",
  },
  "resolved-references": {
    resourceType: null,
    fields: ["reference"],
    finding: () => "At least one FHIR reference points to a resource that is not in this bundle.",
    why: ({ profileName }) =>
      `${profileName} would receive a broken link, so software could not reliably join the report to its related resource.`,
    fix: "Add the referenced resource or correct the reference so it matches a Bundle fullUrl or resource id.",
  },
  "final-report-status": {
    resourceType: "DiagnosticReport",
    fields: ["status"],
    finding: () => "The DiagnosticReport is not marked as a final clinical report.",
    why: ({ profileName }) =>
      `${profileName} must be able to distinguish a finished report from a preliminary or incomplete one.`,
    fix: "Set DiagnosticReport.status to a supported final state when the source report is final.",
  },
  "report-interpretation": {
    resourceType: "DiagnosticReport",
    fields: ["conclusion", "text", "presentedForm"],
    finding: () => "The DiagnosticReport does not retain a readable result or report narrative.",
    why: ({ profileName }) =>
      `${profileName} needs a clinician-readable interpretation, not only codes and resource links.`,
    fix: "Retain the conclusion, a narrative text block, or the issued report through presentedForm.",
  },
  "structured-report-source": {
    resourceType: "DiagnosticReport",
    fields: ["performer", "resultsInterpreter"],
    finding: ({ resourceTypes }) =>
      resourceTypes.includes("Organization") || resourceTypes.includes("Practitioner")
        ? "The candidate creates the organisation or clinician, but the DiagnosticReport does not link to them."
        : "The DiagnosticReport does not identify the organisation or clinician responsible for the report.",
    why: ({ profileName }) =>
      `A person may read a name in the report text, but ${profileName} software cannot reliably identify who issued or interpreted it without a structured reference.`,
    fix: "Link DiagnosticReport.performer to the reporting organisation and resultsInterpreter to the interpreting clinician.",
  },
  "source-report-access": {
    resourceType: "DiagnosticReport",
    fields: ["presentedForm"],
    finding: () => "The candidate does not keep a link or attachment for the issued PDF report.",
    why: ({ profileName }) =>
      `${profileName} needs access to the original report when a clinician wants to verify the structured data.`,
    fix: "Add the issued report as a DiagnosticReport.presentedForm attachment or URL.",
  },
  "imaging-study-link": {
    resourceType: "DiagnosticReport",
    fields: ["imagingStudy"],
    finding: () => "The DiagnosticReport is not linked to its ImagingStudy resource.",
    why: ({ profileName }) =>
      `${profileName} cannot reliably connect the written result to the corresponding imaging study without this reference.`,
    fix: "Add DiagnosticReport.imagingStudy with a reference to the matching ImagingStudy resource.",
  },
  "imaging-identifiers": {
    resourceType: "ImagingStudy",
    fields: ["identifier"],
    finding: ({ candidateText }) =>
      hasNarrativeImagingIdentifiers(candidateText)
        ? "The accession number and DICOM Study UID appear in report text, but ImagingStudy.identifier does not structure them."
        : "ImagingStudy.identifier does not contain both the accession number and DICOM Study UID.",
    why: ({ profileName }) =>
      `${profileName} uses these identifiers to match the FHIR record to the correct imaging order and DICOM study. Narrative text is not a reliable system key.`,
    fix: "Add typed accession and DICOM UID entries to ImagingStudy.identifier.",
  },
  "imaging-context": {
    resourceType: "ImagingStudy",
    fields: ["modality", "series.bodySite"],
    finding: ({ candidateText }) =>
      hasNarrativeImagingContext(candidateText)
        ? "The report describes the examination, but ImagingStudy does not structure both modality and body site."
        : "ImagingStudy does not contain structured modality and body-site data.",
    why: ({ profileName }) =>
      `${profileName} needs structured imaging context for routing, search and downstream workflow rules.`,
    fix: "Add ImagingStudy.modality and ImagingStudy.series.bodySite using supported coding systems.",
  },
};

const fallbackGuidance = (requirement: ProfileRequirementResult): RequirementGuidance => ({
  resourceType: null,
  fields: [requirement.evidencePath],
  finding: () => requirement.detail,
  why: ({ profileName }) =>
    `${profileName} marked this requirement for attention before the candidate can be used in its workflow.`,
  fix: `Update the candidate at ${requirement.evidencePath} and run the assessment again.`,
});

const valuesAtPath = (value: unknown, path: string[]): unknown[] => {
  if (path.length === 0) return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => valuesAtPath(item, path));
  }
  if (!value || typeof value !== "object") return [];
  const [head, ...tail] = path;
  return valuesAtPath((value as Record<string, unknown>)[head], tail);
};

const hasValueAtPath = (resource: Record<string, unknown>, path: string) =>
  valuesAtPath(resource, path.split(".")).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim().length > 0;
    return value !== null && value !== undefined;
  });

const findTargetResource = (
  resources: FhirResourceView[],
  resourceType: string | null,
) => resourceType ? resources.find((resource) => resource.resourceType === resourceType) ?? null : null;

const resourceLineStart = (formatted: string, resource: FhirResourceView | null) => {
  if (!resource) return null;
  const lines = formatted.split("\n");
  const typeNeedle = `"resourceType": "${resource.resourceType}"`;
  const idNeedle = `"id": "${resource.id}"`;

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes(typeNeedle)) continue;
    const nearby = lines.slice(index, index + 5).join("\n");
    if (nearby.includes(idNeedle)) return Math.max(index, 0) + 1;
  }
  return null;
};

const pickExpectedFields = (
  resource: Record<string, unknown> | null,
  fields: string[],
) => {
  if (!resource) return null;
  const expected: Record<string, unknown> = {};

  fields.forEach((field) => {
    const root = field.split(".")[0];
    if (resource[root] !== undefined) expected[root] = resource[root];
  });

  return Object.keys(expected).length > 0 ? JSON.stringify(expected, null, 2) : null;
};

const bundleSummary = (resources: FhirResourceView[]) =>
  JSON.stringify(
    {
      resourceType: "Bundle",
      resources: resources.map((resource) => `${resource.resourceType}/${resource.id}`),
    },
    null,
    2,
  );

export const buildRequirementEvidence = (
  requirement: ProfileRequirementResult,
  candidateText: string,
  referenceText: string | null,
  profileName: string,
): RequirementEvidence => {
  const guidance = requirementGuidance[requirement.id] ?? fallbackGuidance(requirement);
  const candidate = parseFhirCandidate(candidateText);
  const reference = referenceText ? parseFhirCandidate(referenceText) : null;
  const target = findTargetResource(candidate.resources, guidance.resourceType);
  const targetIndex = target
    ? candidate.resources.findIndex((resource) => resource.key === target.key)
    : -1;
  const referenceTarget = findTargetResource(reference?.resources ?? [], guidance.resourceType);
  const context: EvidenceContext = {
    profileName,
    candidateText,
    resourceTypes: candidate.resources.map((resource) => resource.resourceType),
  };
  const missingFields = target
    ? guidance.fields.filter((field) => !hasValueAtPath(target.resource, field))
    : guidance.fields;
  const candidateLocation = target
    ? `Bundle.entry[${targetIndex}].resource (${target.resourceType}/${target.id})`
    : "Bundle.entry[].resource";

  return {
    finding: guidance.finding(context),
    whyItMatters: guidance.why(context),
    howToResolve: guidance.fix,
    candidateLocation: candidate.error ? "Candidate FHIR JSON" : candidateLocation,
    candidateResourceLabel: target
      ? `${target.resourceType}/${target.id}`
      : guidance.resourceType
        ? `${guidance.resourceType} resource not found`
        : "FHIR Bundle",
    candidateCode: candidate.error
      ? candidate.formatted
      : target
        ? JSON.stringify(target.resource, null, 2)
        : bundleSummary(candidate.resources),
    candidateLineStart: resourceLineStart(candidate.formatted, target),
    relevantFields: guidance.fields,
    missingFields,
    expectedCode: pickExpectedFields(referenceTarget?.resource ?? null, guidance.fields),
    parseError: candidate.error,
  };
};
