import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCapabilityMappings,
  dateEvidenceTerms,
  findPdfEvidenceForTerms,
  interpretationText,
  referenceRangeText,
  type CdaOverview,
  type FhirResourceView,
  type PdfOverview,
} from "./capability";


const pdf: PdfOverview = {
  pages: [
    {
      pageNumber: 1,
      lines: [
        "SOUTHERN CROSS PATHOLOGY",
        "Alex Sample 14 Mar 1982 SYN-PATH-001",
        "SPECIMENS Serum: SYN-SER-260811-17 EDTA blood: SYN-EDTA-260811-17",
        "Potassium 6.2 mmol/L 3.5 - 5.2 CRITICAL HIGH",
        "Haemoglobin A1c 7.8 % 4.0 - 6.0 HIGH",
        "PATHOLOGIST INTERPRETATION",
        "Critical hyperkalaemia (potassium 6.2 mmol/L). Urgent clinical review is recommended.",
        "Morgan Rivera Dr Morgan Rivera | Pathologist | Electronically verified 10:16",
      ],
      text: "",
    },
  ],
  rawText: "",
};
pdf.pages[0].text = pdf.pages[0].lines.join("\n");
pdf.rawText = pdf.pages[0].text;

const cda: CdaOverview = {
  title: "Integrated Pathology Report",
  documentId: "SYN-LAB-260811-17",
  raw: "<ClinicalDocument />",
  facts: [
    {
      id: "patient-id",
      source: "CDA",
      kind: "patient",
      label: "Patient identifier",
      value: "SYN-PATH-001",
      sourcePath: "recordTarget.patientRole.id.extension",
    },
    {
      id: "specimen-0-identifier",
      source: "CDA",
      kind: "specimen",
      label: "Specimen identifier",
      value: "SYN-SER-260811-17",
      code: "SYN-SER-260811-17",
      sourcePath: "structuredBody.section.specimenTable.row[0].identifier",
    },
    {
      id: "specimen-0-type",
      source: "CDA",
      kind: "specimen",
      label: "Specimen type",
      value: "Serum",
      code: "SYN-SER-260811-17",
      sourcePath: "structuredBody.section.specimenTable.row[0].type",
    },
  ],
};

const resource = (
  resourceType: string,
  id: string,
  value: Record<string, unknown>,
  label: string,
): FhirResourceView => ({
  key: `${resourceType}-${id}`,
  resourceType,
  id,
  label,
  detail: label,
  resource: { resourceType, id, ...value },
});

const resources: FhirResourceView[] = [
  resource("Patient", "patient-1", {
    identifier: [{ value: "SYN-PATH-001" }],
    name: [{ given: ["Alex"], family: "Sample" }],
    birthDate: "1982-03-14",
  }, "Alex Sample"),
  resource("Practitioner", "practitioner-1", {
    name: [{ given: ["Morgan"], family: "Rivera" }],
  }, "Morgan Rivera"),
  resource("Organization", "organization-1", {
    name: "Southern Cross Pathology - Synthetic",
  }, "Southern Cross Pathology - Synthetic"),
  resource("Specimen", "specimen-1", {
    identifier: [{ value: "SYN-SER-260811-17" }],
    type: { text: "Serum" },
    collection: { collectedDateTime: "2026-08-11T08:40:00+10:00" },
  }, "Serum specimen"),
  resource("Observation", "potassium-1", {
    code: { text: "Potassium", coding: [{ code: "2823-3", display: "Potassium" }] },
    valueQuantity: { value: 6.2, unit: "mmol/L" },
    referenceRange: [{ low: { value: 3.5 }, high: { value: 5.2 }, text: "3.5 - 5.2" }],
    interpretation: [{ text: "CRITICAL HIGH" }],
  }, "Potassium"),
  resource("DiagnosticReport", "report-1", {
    code: { coding: [{ code: "11502-2", display: "Laboratory report" }] },
    performer: [{ reference: "urn:uuid:organization-1" }],
    resultsInterpreter: [{ reference: "urn:uuid:practitioner-1" }],
    conclusion: [
      "Critical hyperkalaemia (potassium 6.2 mmol/L). Urgent clinical review is recommended.",
    ],
  }, "Laboratory report"),
];

test("pathology resources receive direct PDF field mappings", () => {
  const mappings = buildCapabilityMappings(cda, resources, pdf);
  const pdfMappings = mappings.filter((mapping) => mapping.source === "PDF");

  const specimenPaths = pdfMappings
    .filter((mapping) => mapping.targetResource === "Specimen/specimen-1")
    .map((mapping) => mapping.targetPath);
  const observationPaths = pdfMappings
    .filter((mapping) => mapping.targetResource === "Observation/potassium-1")
    .map((mapping) => mapping.targetPath);
  const reportPaths = pdfMappings
    .filter((mapping) => mapping.targetResource === "DiagnosticReport/report-1")
    .map((mapping) => mapping.targetPath);

  assert.ok(specimenPaths.includes("Specimen.identifier[0].value"));
  assert.ok(specimenPaths.includes("Specimen.type.text"));
  assert.deepEqual(
    observationPaths.sort(),
    [
      "Observation.code",
      "Observation.interpretation",
      "Observation.referenceRange",
      "Observation.valueQuantity",
    ].sort(),
  );
  assert.ok(reportPaths.includes("DiagnosticReport.conclusion"));
  assert.ok(reportPaths.includes("DiagnosticReport.performer"));
  assert.ok(reportPaths.includes("DiagnosticReport.resultsInterpreter"));
});

test("CDA narrative specimen rows trace to the matching Specimen resource", () => {
  const mappings = buildCapabilityMappings(cda, resources, pdf);
  const cdaSpecimenPaths = mappings
    .filter((mapping) => mapping.source === "CDA" && mapping.targetResource === "Specimen/specimen-1")
    .map((mapping) => mapping.targetPath);

  assert.deepEqual(
    cdaSpecimenPaths.sort(),
    ["Specimen.identifier[0].value", "Specimen.type.text"].sort(),
  );
});

test("PDF matches use short terms that are visible on the page", () => {
  const match = findPdfEvidenceForTerms(
    pdf,
    ["Potassium"],
    ["6.2", "mmol/L", "3.5 - 5.2", "CRITICAL HIGH"],
  );

  assert.equal(match?.pageNumber, 1);
  assert.deepEqual(
    match?.matchTerms,
    ["Potassium", "6.2", "mmol/L", "3.5 - 5.2", "CRITICAL HIGH"],
  );
});

test("FHIR field helpers preserve pathology evidence values", () => {
  const observation = resources.find((item) => item.resourceType === "Observation")!.resource;
  assert.equal(referenceRangeText(observation), "3.5 - 5.2");
  assert.equal(interpretationText(observation), "CRITICAL HIGH");
  const dateTerms = dateEvidenceTerms("2026-08-11T08:40:00+10:00");
  assert.ok(dateTerms.includes("11 August 2026 08:40"));
  assert.ok(dateTerms.includes("11 Aug 2026 08:40"));
});
