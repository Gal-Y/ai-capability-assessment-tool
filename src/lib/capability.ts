export type ClinicalSourceFact = {
  id: string;
  source: "CDA" | "PDF";
  kind: "patient" | "observation" | "condition" | "report";
  label: string;
  value: string;
  code?: string;
  system?: string;
  sourcePath: string;
};

export type CdaOverview = {
  title: string;
  documentId: string;
  facts: ClinicalSourceFact[];
  raw: string;
};

export type FhirResourceView = {
  key: string;
  resourceType: string;
  id: string;
  label: string;
  detail: string;
  resource: Record<string, unknown>;
};

export type CapabilityMapping = {
  id: string;
  source: "CDA" | "PDF";
  sourceLabel: string;
  sourceValue: string;
  sourcePath: string;
  targetResource: string;
  targetPath: string;
  targetValue: string;
  status: "Mapped" | "Review";
};

export type ParsedFhirCandidate = {
  bundle: Record<string, unknown> | null;
  formatted: string;
  resources: FhirResourceView[];
  error: string | null;
};

const elements = (root: Document | Element, name: string) =>
  Array.from(root.getElementsByTagNameNS("*", name));

const firstElement = (root: Document | Element, name: string) =>
  elements(root, name)[0] ?? null;

const directChild = (root: Element, name: string) =>
  Array.from(root.children).find((child) => child.localName === name) ?? null;

const textOf = (element: Element | null) => element?.textContent?.trim() ?? "";

const formatCdaDate = (value: string) => {
  if (!/^\d{8}/.test(value)) return value;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
};

const codeSystemLabel = (element: Element | null) => {
  const declared = element?.getAttribute("codeSystemName")?.trim();
  if (declared) return declared;
  const oid = element?.getAttribute("codeSystem")?.trim();
  if (oid === "2.16.840.1.113883.6.1") return "LOINC";
  if (oid === "2.16.840.1.113883.6.96") return "SNOMED CT";
  return oid || undefined;
};

export const parseCdaDocument = async (file: File): Promise<CdaOverview> => {
  const raw = await file.text();
  const document = new DOMParser().parseFromString(raw, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) throw new Error("The selected file is not valid CDA/XML.");

  const root = document.documentElement;
  if (root.localName !== "ClinicalDocument") {
    throw new Error("The XML does not contain an HL7 ClinicalDocument root.");
  }

  const facts: ClinicalSourceFact[] = [];
  const title = textOf(directChild(root, "title")) || "HL7 ClinicalDocument";
  const documentId = directChild(root, "id")?.getAttribute("extension") ?? "Not declared";
  const patientRole = firstElement(root, "patientRole");
  const patient = patientRole ? firstElement(patientRole, "patient") : null;
  const patientId = patientRole ? directChild(patientRole, "id")?.getAttribute("extension") : null;
  const patientName = patient ? firstElement(patient, "name") : null;
  const given = textOf(patientName ? firstElement(patientName, "given") : null);
  const family = textOf(patientName ? firstElement(patientName, "family") : null);
  const birthDate = patient ? firstElement(patient, "birthTime")?.getAttribute("value") : null;

  if (patientId) {
    facts.push({
      id: "patient-id",
      source: "CDA",
      kind: "patient",
      label: "Patient identifier",
      value: patientId,
      sourcePath: "recordTarget.patientRole.id.extension",
    });
  }
  if (given || family) {
    facts.push({
      id: "patient-name",
      source: "CDA",
      kind: "patient",
      label: "Patient name",
      value: [given, family].filter(Boolean).join(" "),
      sourcePath: "recordTarget.patientRole.patient.name",
    });
  }
  if (birthDate) {
    facts.push({
      id: "patient-birth",
      source: "CDA",
      kind: "patient",
      label: "Birth date",
      value: formatCdaDate(birthDate),
      sourcePath: "recordTarget.patientRole.patient.birthTime.value",
    });
  }

  elements(root, "observation").forEach((observation, index) => {
    const codeElement = directChild(observation, "code");
    const valueElement = directChild(observation, "value");
    const code = codeElement?.getAttribute("code") ?? undefined;
    const label = codeElement?.getAttribute("displayName") ?? code ?? `Clinical statement ${index + 1}`;
    const value = valueElement?.getAttribute("value");
    const unit = valueElement?.getAttribute("unit")?.trim();
    const system = codeSystemLabel(codeElement);

    if (value) {
      facts.push({
        id: `observation-${code ?? index}`,
        source: "CDA",
        kind: "observation",
        label,
        value: `${value}${unit ? ` ${unit}` : ""}`,
        code,
        system,
        sourcePath: `structuredBody.section.entry.observation[${code ?? index}].value`,
      });
    } else if (code) {
      facts.push({
        id: `condition-${code}`,
        source: "CDA",
        kind: "condition",
        label,
        value: [system, code].filter(Boolean).join(" · "),
        code,
        system,
        sourcePath: `structuredBody.section.entry.observation[${code}].code`,
      });
    }
  });

  const reportCode = directChild(root, "code");
  if (reportCode) {
    facts.push({
      id: "report-code",
      source: "CDA",
      kind: "report",
      label: reportCode.getAttribute("displayName") ?? "Clinical document",
      value: [codeSystemLabel(reportCode), reportCode.getAttribute("code")]
        .filter(Boolean)
        .join(" · "),
      code: reportCode.getAttribute("code") ?? undefined,
      system: codeSystemLabel(reportCode),
      sourcePath: "ClinicalDocument.code",
    });
  }

  return { title, documentId, facts, raw };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

const stringValue = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

const codingFor = (resource: Record<string, unknown>) => {
  const code = asRecord(resource.code);
  const firstCoding = asRecord(asArray(code?.coding)[0]);
  return {
    code: stringValue(firstCoding?.code),
    display: stringValue(firstCoding?.display) || stringValue(code?.text),
    system: stringValue(firstCoding?.system),
  };
};

const quantityFor = (resource: Record<string, unknown>) => {
  const quantity = asRecord(resource.valueQuantity);
  if (!quantity) return "";
  return [stringValue(quantity.value), stringValue(quantity.unit || quantity.code)]
    .filter(Boolean)
    .join(" ");
};

const resourceLabel = (resource: Record<string, unknown>) => {
  const resourceType = stringValue(resource.resourceType) || "Resource";
  const coding = codingFor(resource);

  if (resourceType === "Patient") {
    const name = asRecord(asArray(resource.name)[0]);
    const given = asArray(name?.given).map(stringValue).filter(Boolean).join(" ");
    const family = stringValue(name?.family);
    return [given, family].filter(Boolean).join(" ") || "Patient context";
  }
  return coding.display || coding.code || stringValue(resource.id) || resourceType;
};

const resourceDetail = (resource: Record<string, unknown>) => {
  const resourceType = stringValue(resource.resourceType);
  if (resourceType === "Observation") return quantityFor(resource) || "Clinical observation";
  if (resourceType === "Condition") return "Clinical condition";
  if (resourceType === "DiagnosticReport") {
    const results = asArray(resource.result).length;
    return `${results} linked observation${results === 1 ? "" : "s"}`;
  }
  if (resourceType === "Patient") {
    const identifier = asRecord(asArray(resource.identifier)[0]);
    return stringValue(identifier?.value) || "Patient resource";
  }
  return stringValue(resource.id) || "FHIR resource";
};

export const parseFhirCandidate = (raw: string): ParsedFhirCandidate => {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const jsonText = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const bundle = asRecord(parsed);
    if (!bundle || bundle.resourceType !== "Bundle") {
      return { bundle, formatted: jsonText, resources: [], error: "Generated output is not a FHIR Bundle." };
    }

    const resources = asArray(bundle.entry)
      .map((entry, index) => {
        const entryRecord = asRecord(entry);
        const resource = asRecord(entryRecord?.resource);
        if (!resource) return null;
        const resourceType = stringValue(resource.resourceType) || "Resource";
        const id = stringValue(resource.id) || `entry-${index + 1}`;
        return {
          key: `${resourceType}-${id}-${index}`,
          resourceType,
          id,
          label: resourceLabel(resource),
          detail: resourceDetail(resource),
          resource,
        } satisfies FhirResourceView;
      })
      .filter((resource): resource is FhirResourceView => resource !== null);

    return {
      bundle,
      formatted: JSON.stringify(bundle, null, 2),
      resources,
      error: null,
    };
  } catch {
    return {
      bundle: null,
      formatted: raw,
      resources: [],
      error: "The model response could not be parsed as JSON.",
    };
  }
};

const includesValue = (candidate: string, expected: string) =>
  candidate.toLowerCase().includes(expected.toLowerCase());

export const buildCapabilityMappings = (
  cda: CdaOverview | null,
  resources: FhirResourceView[],
  hasPdf: boolean,
): CapabilityMapping[] => {
  if (!cda || resources.length === 0) return [];
  const mappings: CapabilityMapping[] = [];
  const patient = resources.find((item) => item.resourceType === "Patient");
  const observations = resources.filter((item) => item.resourceType === "Observation");
  const conditions = resources.filter((item) => item.resourceType === "Condition");
  const report = resources.find((item) => item.resourceType === "DiagnosticReport");

  cda.facts.forEach((fact) => {
    let target: FhirResourceView | undefined;
    let targetPath = "";
    let targetValue = "";

    if (fact.kind === "patient") {
      target = patient;
      if (patient) {
        if (fact.id === "patient-id") {
          const identifier = asRecord(asArray(patient.resource.identifier)[0]);
          targetPath = "Patient.identifier[0].value";
          targetValue = stringValue(identifier?.value);
        } else if (fact.id === "patient-name") {
          targetPath = "Patient.name[0]";
          targetValue = patient.label;
        } else {
          targetPath = "Patient.birthDate";
          targetValue = stringValue(patient.resource.birthDate);
        }
      }
    } else if (fact.kind === "observation") {
      target = observations.find((item) => {
        const coding = codingFor(item.resource);
        return coding.code === fact.code || includesValue(coding.display, fact.label);
      });
      if (target) {
        targetPath = `${target.resourceType}.valueQuantity`;
        targetValue = quantityFor(target.resource);
      }
    } else if (fact.kind === "condition") {
      target = conditions.find((item) => codingFor(item.resource).code === fact.code);
      if (target) {
        targetPath = "Condition.code.coding[0]";
        const coding = codingFor(target.resource);
        targetValue = [coding.display, coding.code].filter(Boolean).join(" · ");
      }
    } else if (fact.kind === "report") {
      target = report;
      if (target) {
        targetPath = "DiagnosticReport.code.coding[0]";
        const coding = codingFor(target.resource);
        targetValue = [coding.display, coding.code].filter(Boolean).join(" · ");
      }
    }

    mappings.push({
      id: `map-${fact.id}`,
      source: fact.source,
      sourceLabel: fact.label,
      sourceValue: fact.value,
      sourcePath: fact.sourcePath,
      targetResource: target ? `${target.resourceType}/${target.id}` : "No matching resource",
      targetPath: targetPath || "Not mapped",
      targetValue: targetValue || "Review generated output",
      status: target && targetValue ? "Mapped" : "Review",
    });
  });

  if (hasPdf && report) {
    const conclusion = stringValue(report.resource.conclusion);
    mappings.push({
      id: "map-pdf-conclusion",
      source: "PDF",
      sourceLabel: "Pathology narrative",
      sourceValue: "Human-readable companion evidence",
      sourcePath: "PDF report body",
      targetResource: `DiagnosticReport/${report.id}`,
      targetPath: "DiagnosticReport.conclusion",
      targetValue: conclusion || "No conclusion generated",
      status: conclusion ? "Mapped" : "Review",
    });
  }

  return mappings;
};
