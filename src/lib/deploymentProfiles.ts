export type DeploymentProfileId = "pathology-report";

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

export const pathologyProfile: DeploymentProfile = {
  id: "pathology-report",
  name: "Pathology report",
  shortName: "Pathology",
  version: "3.0",
  purpose: "CDA/PDF-to-FHIR capability benchmark",
  level: "Clinical truth and interoperability",
  requirements: [
    {
      id: "pathology-core-resources",
      label: "Core pathology resources",
      summary: "Patient, Specimen, DiagnosticReport and Observation resources are required.",
      severity: "block",
    },
    {
      id: "pathology-result-coverage",
      label: "Complete result panel",
      summary: "Every benchmark pathology result must be represented in FHIR.",
      severity: "block",
    },
    {
      id: "pathology-clinical-truth",
      label: "Exact clinical values",
      summary: "Values, units and patient identity must match the approved benchmark.",
      severity: "block",
    },
    {
      id: "standard-pathology-terminology",
      label: "Standard terminology",
      summary: "Pathology tests should use LOINC and quantities should use UCUM.",
      severity: "review",
    },
    {
      id: "specimen-traceability",
      label: "Specimen traceability",
      summary: "Results must stay linked to the correct patient and specimen.",
      severity: "block",
    },
    {
      id: "resolved-references",
      label: "Resolved references",
      summary: "Every internal FHIR reference must resolve.",
      severity: "block",
    },
    {
      id: "final-report-status",
      label: "Final report status",
      summary: "The issued DiagnosticReport must be final.",
      severity: "block",
    },
    {
      id: "report-interpretation",
      label: "Readable interpretation",
      summary: "The report must retain a readable clinical conclusion.",
      severity: "block",
    },
  ],
};

export const deploymentProfiles: DeploymentProfile[] = [pathologyProfile];

export const isDeploymentProfileId = (value: unknown): value is DeploymentProfileId =>
  value === pathologyProfile.id;

export const getDeploymentProfile = (value: unknown): DeploymentProfile | null =>
  isDeploymentProfileId(value) ? pathologyProfile : null;
