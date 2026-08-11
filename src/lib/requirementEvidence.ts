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
  requirement: ProfileRequirementResult;
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

const requirementGuidance: Record<string, RequirementGuidance> = {
  "pathology-core-resources": {
    resourceType: null,
    fields: ["entry.resource.resourceType"],
    finding: ({ requirement }) => requirement.detail,
    why: () =>
      "Pathology results cannot be safely interpreted without the patient, tested specimen, report and individual result resources.",
    fix: "Add the missing Patient, Specimen, DiagnosticReport or Observation resource to Bundle.entry.",
  },
  "pathology-result-coverage": {
    resourceType: "DiagnosticReport",
    fields: ["result"],
    finding: ({ requirement }) => requirement.detail,
    why: () =>
      "A structurally valid bundle can still be clinically incomplete if even one result from the source report is absent.",
    fix: "Add an Observation for every benchmark result and reference each one from DiagnosticReport.result.",
  },
  "pathology-clinical-truth": {
    resourceType: "Observation",
    fields: ["valueQuantity", "interpretation"],
    finding: ({ requirement }) => requirement.detail,
    why: () =>
      "A changed pathology value can reverse its clinical meaning even when the FHIR is complete and structurally valid.",
    fix: "Correct the highlighted value and interpretation so they exactly match the source report and approved reference.",
  },
  "standard-pathology-terminology": {
    resourceType: "Observation",
    fields: ["code.coding", "valueQuantity.system"],
    finding: ({ requirement }) => requirement.detail,
    why: () =>
      "Local codes may work inside one laboratory, but another system cannot reliably recognise the tests without standard terminology.",
    fix: "Map each local test code to its approved LOINC code while preserving the existing clinical values and UCUM units.",
  },
  "specimen-traceability": {
    resourceType: "Specimen",
    fields: ["subject", "type"],
    finding: ({ requirement }) => requirement.detail,
    why: () =>
      "Results must remain connected to the patient and specimen that were actually tested.",
    fix: "Link the Specimen to the patient, then link every Observation and the DiagnosticReport to that specimen.",
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
};

const fallbackGuidance = (requirement: ProfileRequirementResult): RequirementGuidance => ({
  resourceType: null,
  fields: [requirement.evidencePath],
  finding: () => requirement.detail,
  why: () =>
    "The pathology benchmark marked this requirement for attention before the candidate can be used downstream.",
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
    requirement,
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
