import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type ClinicalSourceFact = {
  id: string;
  source: "CDA" | "PDF";
  kind: "patient" | "practitioner" | "organization" | "observation" | "condition" | "report" | "imaging";
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

export type PdfPageText = {
  pageNumber: number;
  lines: string[];
  text: string;
};

export type PdfOverview = {
  pages: PdfPageText[];
  rawText: string;
};

export type PdfTextBox = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type RenderedPdfPage = {
  canvas: HTMLCanvasElement;
  pageNumber: number;
  pageCount: number;
  width: number;
  height: number;
  textBoxes: PdfTextBox[];
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
  sourcePage?: number;
  matchTerms: string[];
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

const formatLongDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
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

  const author = firstElement(root, "author");
  const assignedAuthor = author ? firstElement(author, "assignedAuthor") : null;
  const practitionerId = assignedAuthor
    ? directChild(assignedAuthor, "id")?.getAttribute("extension")
    : null;
  const assignedPerson = assignedAuthor ? firstElement(assignedAuthor, "assignedPerson") : null;
  const practitionerName = assignedPerson ? firstElement(assignedPerson, "name") : null;
  const practitionerGiven = textOf(practitionerName ? firstElement(practitionerName, "given") : null);
  const practitionerFamily = textOf(practitionerName ? firstElement(practitionerName, "family") : null);

  if (practitionerId) {
    facts.push({
      id: "practitioner-id",
      source: "CDA",
      kind: "practitioner",
      label: "Author identifier",
      value: practitionerId,
      sourcePath: "author.assignedAuthor.id.extension",
    });
  }
  if (practitionerGiven || practitionerFamily) {
    facts.push({
      id: "practitioner-name",
      source: "CDA",
      kind: "practitioner",
      label: "Author name",
      value: [practitionerGiven, practitionerFamily].filter(Boolean).join(" "),
      sourcePath: "author.assignedAuthor.assignedPerson.name",
    });
  }

  const custodian = firstElement(root, "custodian");
  const custodianOrganization = custodian
    ? firstElement(custodian, "representedCustodianOrganization")
    : null;
  const organizationId = custodianOrganization
    ? directChild(custodianOrganization, "id")?.getAttribute("extension")
    : null;
  const organizationName = textOf(
    custodianOrganization ? directChild(custodianOrganization, "name") : null,
  );

  if (organizationId) {
    facts.push({
      id: "organization-id",
      source: "CDA",
      kind: "organization",
      label: "Custodian identifier",
      value: organizationId,
      sourcePath: "custodian.assignedCustodian.representedCustodianOrganization.id.extension",
    });
  }
  if (organizationName) {
    facts.push({
      id: "organization-name",
      source: "CDA",
      kind: "organization",
      label: "Custodian organization",
      value: organizationName,
      sourcePath: "custodian.assignedCustodian.representedCustodianOrganization.name",
    });
  }

  const serviceEvent = firstElement(root, "serviceEvent");
  const serviceEventId = serviceEvent
    ? directChild(serviceEvent, "id")?.getAttribute("extension")
    : null;
  const serviceEventCode = serviceEvent ? directChild(serviceEvent, "code") : null;
  const serviceEventTime = serviceEvent ? directChild(serviceEvent, "effectiveTime") : null;
  const serviceEventStart = serviceEventTime
    ? directChild(serviceEventTime, "low")?.getAttribute("value")
    : null;

  if (serviceEventId) {
    facts.push({
      id: "imaging-accession",
      source: "CDA",
      kind: "imaging",
      label: "Accession number",
      value: serviceEventId,
      sourcePath: "documentationOf.serviceEvent.id.extension",
    });
  }
  if (serviceEventCode) {
    facts.push({
      id: "imaging-procedure",
      source: "CDA",
      kind: "imaging",
      label: serviceEventCode.getAttribute("displayName") ?? "Imaging procedure",
      value: [codeSystemLabel(serviceEventCode), serviceEventCode.getAttribute("code")]
        .filter(Boolean)
        .join(" · "),
      code: serviceEventCode.getAttribute("code") ?? undefined,
      system: codeSystemLabel(serviceEventCode),
      sourcePath: "documentationOf.serviceEvent.code",
    });
  }
  if (serviceEventStart) {
    facts.push({
      id: "imaging-start",
      source: "CDA",
      kind: "imaging",
      label: "Study date",
      value: formatCdaDate(serviceEventStart),
      sourcePath: "documentationOf.serviceEvent.effectiveTime.low.value",
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

export const parsePdfDocument = async (file: File): Promise<PdfOverview> => {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await getDocument({ data }).promise;
  const pages: PdfPageText[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let currentLine: string[] = [];

    content.items.forEach((item) => {
      if (!("str" in item)) return;
      const value = item.str.trim();
      if (value) currentLine.push(value);
      if ("hasEOL" in item && item.hasEOL && currentLine.length > 0) {
        lines.push(currentLine.join(" ").replace(/\s+/g, " ").trim());
        currentLine = [];
      }
    });

    if (currentLine.length > 0) {
      lines.push(currentLine.join(" ").replace(/\s+/g, " ").trim());
    }

    const readableLines = lines.filter(Boolean);
    pages.push({
      pageNumber,
      lines: readableLines,
      text: readableLines.join("\n"),
    });
  }

  return {
    pages,
    rawText: pages.map((page) => page.text).join("\n\n"),
  };
};

export const renderPdfPage = async (
  file: File,
  requestedPage = 1,
  scale = 2,
): Promise<RenderedPdfPage> => {
  const { GlobalWorkerOptions, Util, getDocument } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data });
  const pdfDocument = await loadingTask.promise;

  try {
    const pageNumber = Math.min(Math.max(1, requestedPage), pdfDocument.numPages);
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({ canvas, viewport }).promise;
    const content = await page.getTextContent();
    const textBoxes = content.items.flatMap((item) => {
      if (!("str" in item) || !item.str.trim()) return [];
      const transform = Util.transform(viewport.transform, item.transform);
      const height = Math.max(8, Math.hypot(transform[2], transform[3]));
      return [{
        text: item.str,
        left: transform[4],
        top: transform[5] - height,
        width: Math.max(2, item.width * scale),
        height,
      }];
    });

    return {
      canvas,
      pageNumber,
      pageCount: pdfDocument.numPages,
      width: viewport.width,
      height: viewport.height,
      textBoxes,
    };
  } finally {
    await loadingTask.destroy();
  }
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

  if (resourceType === "Patient" || resourceType === "Practitioner") {
    const name = asRecord(asArray(resource.name)[0]);
    const given = asArray(name?.given).map(stringValue).filter(Boolean).join(" ");
    const family = stringValue(name?.family);
    return [given, family].filter(Boolean).join(" ") || `${resourceType} context`;
  }
  if (resourceType === "Organization") return stringValue(resource.name) || "Organization context";
  if (resourceType === "ImagingStudy") {
    const modality = asRecord(asArray(resource.modality)[0]);
    return stringValue(modality?.display) || stringValue(modality?.code) || "Imaging study";
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
  if (resourceType === "ImagingStudy") {
    const identifiers = asArray(resource.identifier).length;
    const started = stringValue(resource.started);
    return [started, `${identifiers} structured identifier${identifiers === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" · ");
  }
  if (resourceType === "Patient") {
    const identifier = asRecord(asArray(resource.identifier)[0]);
    return stringValue(identifier?.value) || "Patient resource";
  }
  if (resourceType === "Practitioner" || resourceType === "Organization") {
    const identifier = asRecord(asArray(resource.identifier)[0]);
    return stringValue(identifier?.value) || `${resourceType} resource`;
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

const normalized = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9.%/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const evidenceTerms = (fact: ClinicalSourceFact) => {
  const terms = [fact.code, fact.value, fact.label]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
  if (fact.id === "patient-birth") {
    terms.push(formatLongDate(fact.value), fact.value.replace(/-/g, ""));
  }
  if (fact.id.endsWith("-name") && (fact.kind === "patient" || fact.kind === "practitioner")) {
    terms.push(...fact.value.split(/\s+/).filter((part) => part.length > 2));
  }
  return Array.from(new Set(terms));
};

const findPdfEvidence = (fact: ClinicalSourceFact, pdf: PdfOverview) => {
  const terms = evidenceTerms(fact);
  const scored: Array<{ pageNumber: number; text: string; score: number }> = [];

  pdf.pages.forEach((page) => {
    page.lines.forEach((line, index) => {
      const window = page.lines.slice(Math.max(0, index - 1), index + 3).join(" ");
      const haystack = normalized(window);
      let score = 0;

      terms.forEach((term, termIndex) => {
        if (haystack.includes(normalized(term))) score += termIndex === 0 ? 5 : 3;
      });

      if (fact.kind === "observation" && fact.code && haystack.includes(normalized(fact.code))) {
        score += 4;
      }

      if (score >= 5) scored.push({ pageNumber: page.pageNumber, text: window, score });
    });
  });

  return scored.sort((left, right) => right.score - left.score)[0] ?? null;
};

export const buildCapabilityMappings = (
  cda: CdaOverview | null,
  resources: FhirResourceView[],
  pdf: PdfOverview | null,
): CapabilityMapping[] => {
  if (!cda || resources.length === 0) return [];
  const mappings: CapabilityMapping[] = [];
  const patient = resources.find((item) => item.resourceType === "Patient");
  const practitioner = resources.find((item) => item.resourceType === "Practitioner");
  const organization = resources.find((item) => item.resourceType === "Organization");
  const observations = resources.filter((item) => item.resourceType === "Observation");
  const conditions = resources.filter((item) => item.resourceType === "Condition");
  const report = resources.find((item) => item.resourceType === "DiagnosticReport");
  const imagingStudy = resources.find((item) => item.resourceType === "ImagingStudy");

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
    } else if (fact.kind === "practitioner") {
      target = practitioner;
      if (practitioner) {
        if (fact.id === "practitioner-id") {
          const identifier = asRecord(asArray(practitioner.resource.identifier)[0]);
          targetPath = "Practitioner.identifier[0].value";
          targetValue = stringValue(identifier?.value);
        } else {
          targetPath = "Practitioner.name[0]";
          targetValue = practitioner.label;
        }
      }
    } else if (fact.kind === "organization") {
      target = organization;
      if (organization) {
        if (fact.id === "organization-id") {
          const identifier = asRecord(asArray(organization.resource.identifier)[0]);
          targetPath = "Organization.identifier[0].value";
          targetValue = stringValue(identifier?.value);
        } else {
          targetPath = "Organization.name";
          targetValue = stringValue(organization.resource.name);
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
    } else if (fact.kind === "imaging") {
      if (fact.id === "imaging-procedure") {
        target = report;
        if (report) {
          const coding = codingFor(report.resource);
          targetPath = "DiagnosticReport.code";
          targetValue = [coding.display, coding.code].filter(Boolean).join(" · ");
        }
      } else {
        target = imagingStudy;
        if (imagingStudy && fact.id === "imaging-accession") {
          const identifier = asArray(imagingStudy.resource.identifier)
            .map(asRecord)
            .find((item) => stringValue(item?.value) === fact.value);
          targetPath = "ImagingStudy.identifier[accession].value";
          targetValue = stringValue(identifier?.value);
        } else if (imagingStudy) {
          targetPath = "ImagingStudy.started";
          targetValue = stringValue(imagingStudy.resource.started);
        }
      }
    }

    const targetResource = target ? `${target.resourceType}/${target.id}` : "No matching resource";
    const status = target && targetValue ? "Mapped" : "Review";
    mappings.push({
      id: `map-cda-${fact.id}`,
      source: fact.source,
      sourceLabel: fact.label,
      sourceValue: fact.value,
      sourcePath: fact.sourcePath,
      targetResource,
      targetPath: targetPath || "Not mapped",
      targetValue: targetValue || "Review generated output",
      status,
      matchTerms: evidenceTerms(fact),
    });

    if (pdf) {
      const pdfEvidence = findPdfEvidence(fact, pdf);
      if (pdfEvidence) {
        mappings.push({
          id: `map-pdf-${fact.id}`,
          source: "PDF",
          sourceLabel: fact.label,
          sourceValue: pdfEvidence.text,
          sourcePath: `PDF page ${pdfEvidence.pageNumber}`,
          targetResource,
          targetPath: targetPath || "Not mapped",
          targetValue: targetValue || "Review generated output",
          status,
          sourcePage: pdfEvidence.pageNumber,
          matchTerms: evidenceTerms(fact),
        });
      }
    }
  });

  if (pdf && report) {
    const conclusion = stringValue(report.resource.conclusion);
    const normalizedConclusion = normalized(conclusion);
    const narrativePage = pdf.pages.find(
      (page) => normalizedConclusion && normalized(page.text).includes(normalizedConclusion),
    ) ?? pdf.pages.find((page) => /impression|conclusion/i.test(page.text));
    const impressionIndex = narrativePage?.lines.findIndex((line) =>
      /impression|conclusion/i.test(line),
    ) ?? -1;
    const narrative = narrativePage
      ? impressionIndex >= 0
        ? narrativePage.lines.slice(impressionIndex, impressionIndex + 3).join(" ")
        : narrativePage.lines.find((line) =>
            normalizedConclusion && normalized(line).includes(normalizedConclusion),
          ) ?? ""
      : "";
    mappings.push({
      id: "map-pdf-conclusion",
      source: "PDF",
      sourceLabel: "Report impression",
      sourceValue: narrative || "Human-readable companion evidence",
      sourcePath: `PDF page ${narrativePage?.pageNumber ?? 1}`,
      targetResource: `DiagnosticReport/${report.id}`,
      targetPath: "DiagnosticReport.conclusion",
      targetValue: conclusion || "No conclusion generated",
      status: conclusion ? "Mapped" : "Review",
      sourcePage: narrativePage?.pageNumber ?? 1,
      matchTerms: ["IMPRESSION", conclusion].filter(Boolean),
    });

    const pdfLines = pdf.pages.flatMap((page) =>
      page.lines.map((line) => ({ line, pageNumber: page.pageNumber })),
    );
    const reportingOrganization = pdfLines.find(({ line }) =>
      /diagnostic imaging|medical imaging|radiology (?:practice|service|centre|center)/i.test(line),
    );
    const credentialIndex = pdfLines.findIndex(({ line }) =>
      /FRANZCR|radiologist|electronically signed/i.test(line),
    );
    const interpreterSource = credentialIndex >= 0
      ? pdfLines
          .slice(Math.max(0, credentialIndex - 1), credentialIndex + 1)
          .map(({ line }) => line)
          .join(" ")
      : "";
    const performer = asRecord(asArray(report.resource.performer)[0]);
    const interpreter = asRecord(asArray(report.resource.resultsInterpreter)[0]);
    if (reportingOrganization) {
      mappings.push({
        id: "map-pdf-report-source",
        source: "PDF",
        sourceLabel: "Reporting organisation",
        sourceValue: reportingOrganization.line,
        sourcePath: `PDF page ${reportingOrganization.pageNumber} · letterhead`,
        targetResource: `DiagnosticReport/${report.id}`,
        targetPath: "DiagnosticReport.performer",
        targetValue: stringValue(performer?.reference) || "Not structured",
        status: performer ? "Mapped" : "Review",
        sourcePage: reportingOrganization.pageNumber,
        matchTerms: [reportingOrganization.line],
      });
    }
    if (interpreterSource) {
      mappings.push({
        id: "map-pdf-interpreter",
        source: "PDF",
        sourceLabel: "Results interpreter",
        sourceValue: interpreterSource,
        sourcePath: `PDF page ${pdfLines[credentialIndex].pageNumber} · signature`,
        targetResource: `DiagnosticReport/${report.id}`,
        targetPath: "DiagnosticReport.resultsInterpreter",
        targetValue: stringValue(interpreter?.reference) || "Not structured",
        status: interpreter ? "Mapped" : "Review",
        sourcePage: pdfLines[credentialIndex].pageNumber,
        matchTerms: interpreterSource.split(/\s+/).filter((term) => term.length > 3),
      });
    }

    if (imagingStudy) {
      const identifiers = asArray(imagingStudy.resource.identifier).map(asRecord);
      const dicomIdentifier = identifiers.find((item) => item?.system === "urn:dicom:uid");
      const modality = asRecord(asArray(imagingStudy.resource.modality)[0]);
      const series = asRecord(asArray(imagingStudy.resource.series)[0]);
      const bodySite = asRecord(series?.bodySite);
      const dicomUid = pdf.rawText.match(
        /DICOM\s+(?:STUDY\s+)?UID\s*[:#-]?\s*((?:\d+\.)+\d+)/i,
      )?.[1];
      const sourceModality = pdf.rawText.match(/MODALITY\s*:\s*([A-Z0-9]+)/i)?.[1];
      const sourceBodySite = pdf.rawText.match(
        /BODY(?:\s+SITE)?\s*:\s*([A-Z][A-Z ]{1,30}?)(?=\s+(?:ACC|ACCESSION|DICOM)|\n|$)/i,
      )?.[1]?.trim();

      if (dicomUid) {
        mappings.push({
          id: "map-pdf-dicom-uid",
          source: "PDF",
          sourceLabel: "DICOM Study UID",
          sourceValue: dicomUid,
          sourcePath: "PDF page 1 · archive footer",
          targetResource: `ImagingStudy/${imagingStudy.id}`,
          targetPath: "ImagingStudy.identifier[DICOM UID]",
          targetValue: stringValue(dicomIdentifier?.value) || "Not structured",
          status: dicomIdentifier ? "Mapped" : "Review",
          sourcePage: 1,
          matchTerms: ["DICOM STUDY UID", dicomUid],
        });
      }
      if (sourceModality || sourceBodySite) {
        mappings.push({
          id: "map-pdf-imaging-context",
          source: "PDF",
          sourceLabel: "Modality and body site",
          sourceValue: [sourceModality && `MODALITY: ${sourceModality}`, sourceBodySite && `BODY: ${sourceBodySite}`]
            .filter(Boolean)
            .join("   "),
          sourcePath: "PDF page 1 · technical footer",
          targetResource: `ImagingStudy/${imagingStudy.id}`,
          targetPath: "ImagingStudy.modality / series.bodySite",
          targetValue: [stringValue(modality?.code), stringValue(bodySite?.display)]
            .filter(Boolean)
            .join(" · ") || "Not structured",
          status: modality && bodySite ? "Mapped" : "Review",
          sourcePage: 1,
          matchTerms: ["MODALITY", sourceModality, "BODY", sourceBodySite].filter(
            (term): term is string => Boolean(term),
          ),
        });
      }
    }
  }

  return mappings;
};
