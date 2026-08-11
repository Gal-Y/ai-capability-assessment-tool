export type DeploymentProfileId =
  | "hospital-network"
  | "gp-shared-care"
  | "pathology-analytics";

export type ProfileRequirementSeverity = "advisory" | "review" | "block";
export type ProfileRequirementStatus = "pass" | ProfileRequirementSeverity;

export type ProfileRequirementDefinition = {
  id: string;
  label: string;
  summary: string;
  severity: ProfileRequirementSeverity;
};

export type DeploymentProfile = {
  id: DeploymentProfileId;
  name: string;
  shortName: string;
  version: string;
  purpose: string;
  level: string;
  requirements: ProfileRequirementDefinition[];
};

export type ProfileRequirementResult = {
  id: string;
  label: string;
  severity: ProfileRequirementSeverity;
  status: ProfileRequirementStatus;
  detail: string;
  evidencePath: string;
};

export type DeploymentProfileAssessment = {
  profileId: DeploymentProfileId;
  profileName: string;
  version: string;
  purpose: string;
  requirements: ProfileRequirementResult[];
  passCount: number;
  advisoryCount: number;
  reviewCount: number;
  blockingCount: number;
};

export const deploymentProfiles: DeploymentProfile[] = [
  {
    id: "hospital-network",
    name: "Hospital network",
    shortName: "Hospital",
    version: "1.0",
    purpose: "Internal clinical record ingestion",
    level: "Base ingestion",
    requirements: [
      {
        id: "core-resources",
        label: "Core clinical resources",
        summary: "Patient, Observation and DiagnosticReport are required.",
        severity: "block",
      },
      {
        id: "resolved-references",
        label: "Resolved bundle references",
        summary: "Every internal FHIR reference must resolve.",
        severity: "block",
      },
      {
        id: "final-statuses",
        label: "Final clinical status",
        summary: "Observations and the report must be final.",
        severity: "review",
      },
      {
        id: "complete-ucum",
        label: "Complete UCUM coding",
        summary: "Incomplete unit coding is recorded as an advisory.",
        severity: "advisory",
      },
    ],
  },
  {
    id: "gp-shared-care",
    name: "GP shared care",
    shortName: "Shared care",
    version: "1.0",
    purpose: "Inter-provider clinical handover",
    level: "Provenance focused",
    requirements: [
      {
        id: "core-resources",
        label: "Core clinical resources",
        summary: "Patient, Observation and DiagnosticReport are required.",
        severity: "block",
      },
      {
        id: "resolved-references",
        label: "Resolved bundle references",
        summary: "Every internal FHIR reference must resolve.",
        severity: "block",
      },
      {
        id: "report-interpretation",
        label: "Report interpretation",
        summary: "The DiagnosticReport must retain a readable conclusion.",
        severity: "review",
      },
      {
        id: "care-provenance",
        label: "Care-provider provenance",
        summary: "A Practitioner or Organization must identify the report source.",
        severity: "review",
      },
      {
        id: "complete-ucum",
        label: "Complete UCUM coding",
        summary: "Incomplete unit coding is recorded as an advisory.",
        severity: "advisory",
      },
    ],
  },
  {
    id: "pathology-analytics",
    name: "Pathology analytics",
    shortName: "Pathology",
    version: "1.0",
    purpose: "Structured querying and population analytics",
    level: "Strict coding",
    requirements: [
      {
        id: "core-resources",
        label: "Core clinical resources",
        summary: "Patient, Observation and DiagnosticReport are required.",
        severity: "block",
      },
      {
        id: "resolved-references",
        label: "Resolved bundle references",
        summary: "Every internal FHIR reference must resolve.",
        severity: "block",
      },
      {
        id: "loinc-observations",
        label: "LOINC-coded observations",
        summary: "Every Observation requires a LOINC code.",
        severity: "block",
      },
      {
        id: "complete-ucum",
        label: "Complete UCUM coding",
        summary: "Every quantity requires a UCUM system and code.",
        severity: "block",
      },
      {
        id: "effective-dates",
        label: "Effective dates",
        summary: "Every Observation requires a structured effective date.",
        severity: "block",
      },
      {
        id: "final-statuses",
        label: "Final clinical status",
        summary: "Observations and the report must be final.",
        severity: "block",
      },
    ],
  },
];

export const isDeploymentProfileId = (value: unknown): value is DeploymentProfileId =>
  deploymentProfiles.some((profile) => profile.id === value);

export const getDeploymentProfile = (value: unknown): DeploymentProfile | null =>
  isDeploymentProfileId(value)
    ? deploymentProfiles.find((profile) => profile.id === value) ?? null
    : null;
