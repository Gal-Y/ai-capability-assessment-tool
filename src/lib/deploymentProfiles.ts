export type DeploymentProfileId =
  | "hospital"
  | "gp-clinic"
  | "radiology-practice";

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
    id: "hospital",
    name: "Hospital",
    shortName: "Hospital",
    version: "2.0",
    purpose: "Own CDA/PDF-to-FHIR conversion",
    level: "Balanced acceptance",
    requirements: [
      {
        id: "clinical-report-core",
        label: "Core report resources",
        summary: "Patient and DiagnosticReport are required.",
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
        summary: "The DiagnosticReport must be final.",
        severity: "block",
      },
      {
        id: "report-interpretation",
        label: "Readable impression",
        summary: "The report must retain a readable conclusion or narrative.",
        severity: "block",
      },
      {
        id: "structured-report-source",
        label: "Structured report source",
        summary: "Missing performer or interpreter references are advisory.",
        severity: "advisory",
      },
      {
        id: "imaging-identifiers",
        label: "Structured imaging identifiers",
        summary: "Missing DICOM or accession identifiers are advisory.",
        severity: "advisory",
      },
    ],
  },
  {
    id: "gp-clinic",
    name: "GP clinic",
    shortName: "GP",
    version: "2.0",
    purpose: "Own CDA/PDF-to-FHIR conversion",
    level: "Traceability required",
    requirements: [
      {
        id: "clinical-report-core",
        label: "Core report resources",
        summary: "Patient and DiagnosticReport are required.",
        severity: "block",
      },
      {
        id: "report-interpretation",
        label: "Readable impression",
        summary: "The DiagnosticReport must retain a readable conclusion.",
        severity: "block",
      },
      {
        id: "structured-report-source",
        label: "Structured report source",
        summary: "A performer or results interpreter must identify the report source.",
        severity: "review",
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
        summary: "The DiagnosticReport must be final.",
        severity: "block",
      },
      {
        id: "source-report-access",
        label: "Original report access",
        summary: "The issued PDF or equivalent report attachment must remain accessible.",
        severity: "review",
      },
      {
        id: "imaging-identifiers",
        label: "Structured imaging identifiers",
        summary: "Missing DICOM or accession identifiers are advisory.",
        severity: "advisory",
      },
    ],
  },
  {
    id: "radiology-practice",
    name: "Radiology practice",
    shortName: "Radiology",
    version: "2.0",
    purpose: "Own CDA/PDF-to-FHIR conversion",
    level: "Imaging metadata required",
    requirements: [
      {
        id: "radiology-core-resources",
        label: "Radiology resources",
        summary: "Patient, DiagnosticReport and ImagingStudy are required.",
        severity: "block",
      },
      {
        id: "imaging-study-link",
        label: "Linked imaging study",
        summary: "The report must reference the corresponding ImagingStudy.",
        severity: "block",
      },
      {
        id: "imaging-identifiers",
        label: "DICOM and accession IDs",
        summary: "The ImagingStudy must retain a DICOM UID and accession number.",
        severity: "block",
      },
      {
        id: "imaging-context",
        label: "Modality and body site",
        summary: "Structured modality and body-site data are required.",
        severity: "block",
      },
      {
        id: "structured-report-source",
        label: "Structured report source",
        summary: "Performer and interpreter references must identify report responsibility.",
        severity: "block",
      },
      {
        id: "report-interpretation",
        label: "Readable impression",
        summary: "The DiagnosticReport must retain a readable conclusion.",
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
        summary: "The DiagnosticReport must be final.",
        severity: "block",
      },
      {
        id: "source-report-access",
        label: "Original report access",
        summary: "The issued PDF or equivalent report attachment must remain accessible.",
        severity: "review",
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
