# Capability Deployment Readiness Tool

Thesis prototype for evaluating whether AI-powered structured clinical resource generation is ready for deployment in a healthcare workflow.

The product is no longer framed as a generic enterprise AI assessment tool. It is scoped to healthcare capabilities such as:

- evaluating HL7 CDA or C-CDA clinical documents before they are converted into HL7 FHIR resources
- converting supporting unstructured clinical notes into HL7 FHIR resources
- mapping clinical text to ICD-10, SNOMED CT, and LOINC concepts
- evaluating candidate JSON bundles before they are written to systems such as AWS HealthLake
- producing a deployment-readiness decision for a healthcare organisation

## Product Focus

This is an evaluation tool, not the production converter itself.

A production pipeline might ingest PDF/CDA clinical bundles, use AI to emit FHIR JSON, store resources in AWS HealthLake, and then query longitudinal pathology trends for recommendations. This prototype wraps that kind of pipeline with a readiness layer:

1. upload synthetic HL7 CDA/PDF clinical inputs and expected FHIR outputs
2. generate or upload candidate AI outputs
3. score the output against healthcare-specific readiness dimensions
4. surface case-level evidence and mitigation gaps
5. categorise the capability as `Ready`, `Conditional`, or `Not Ready`

## Readiness Dimensions

The current implementation maps the backend's hybrid metrics to the Thesis A framework:

- `Task reliability`: source-grounded CDA/PDF clinical facts, FHIR shape, values, dates, and units
- `Clinical coverage`: expected resources, code mappings, and required fields
- `Security and governance`: prompt-injection resistance and configured deployment constraints
- `Privacy containment`: PHI, identifiers, contact details, and sensitive leakage
- `Operational constraints`: latency and workflow usability, shown in run metadata

## HL7 Scope

The narrowed implementation treats HL7 as a concrete standards boundary rather than a broad healthcare interoperability label:

- source standard: HL7 CDA or C-CDA XML, with optional supporting clinical PDF/text files
- target standard: HL7 FHIR R4 JSON resources suitable for AWS HealthLake-style ingestion review
- evaluation focus: whether CDA clinical content is preserved as appropriate FHIR resources and whether candidate resources are safe enough for controlled ingestion review

The workflow now records an `inputProfile` during validation. The profile classifies source files as `HL7_CDA`, `HL7_CDA_OR_XML`, `CLINICAL_PDF`, `FHIR_JSON`, `TEXT`, or `UNKNOWN`; records whether FHIR JSON references or candidate outputs are present; and passes this context to each test case. Generation and scoring prompts use that profile so the evaluator knows the expected source and target standards.

## Current Prototype

The app includes:

- a redesigned dark healthcare operator console
- a thesis-ready demo evaluation for a HealthLake-style PDF/CDA to FHIR pipeline
- a guided evaluation setup flow
- uploads for clinical bundles, expected structured outputs, governance policies, and candidate AI outputs
- platform-model or uploaded-output modes
- healthcare-specific rule presets for FHIR conformance, clinical code grounding, PHI containment, prompt-injection resistance, and operational constraints
- an HL7 CDA mapping rule that checks whether CDA-style source content is represented as FHIR resources such as Patient, Observation, Condition, DiagnosticReport, MedicationRequest, AllergyIntolerance, Encounter, or Procedure
- case-level evidence cards and mitigation queue
- AWS-backed evaluation jobs through the existing API, Step Functions, Lambda, S3, and DynamoDB stack

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## AWS MVP Infrastructure

The CDK stack keeps the original serverless shape:

- `S3` upload bucket for clinical inputs, expected outputs, policy files, and candidate outputs
- `S3` artifact bucket for workflow artifacts and final reports
- `S3 + CloudFront` frontend hosting
- `DynamoDB` table for evaluation metadata and status
- `API Gateway` HTTP API for uploads and evaluation jobs
- `Step Functions` workflow for validation, case building, output resolution, scoring, and finalisation
- `Lambda` functions in Python for API handlers and workflow compute

### Workflow

1. User uploads synthetic clinical files through presigned S3 URLs.
2. User starts an evaluation through the API.
3. Step Functions runs the pipeline:
   - validate input manifest
   - classify uploaded files and persist the HL7 CDA-to-FHIR `inputProfile`
   - build one clinical test case per source document
   - generate platform output or load uploaded candidate output
   - score each case against source, reference FHIR output, HL7/FHIR rules, and policy context
   - persist final readiness report and status

### API Endpoints

- `POST /uploads/presign`
- `POST /evaluations`
- `GET /evaluations`
- `GET /evaluations/{evaluationId}`
- `DELETE /evaluations/{evaluationId}`

## Infrastructure Commands

```bash
npm install
npm run build
npm run infra:synth
```

Bootstrap once per account/region:

```bash
npm run infra:bootstrap -- aws://ACCOUNT_ID/REGION
```

Deploy:

```bash
npm run infra:deploy
```

## OpenAI Setup

The workflow Lambdas expect an `OPENAI_API_KEY` environment variable at deploy time.

```bash
export OPENAI_API_KEY=your_key_here
npm run infra:deploy
```

Optional:

```bash
export OPENAI_EVALUATOR_MODEL=gpt-5.4-mini
```

## Notes

- The UI includes local demo data so the prototype remains presentable even without a live backend response.
- The backend still stores some legacy field names such as `summaryText` and `candidateSummary`; these now represent candidate structured clinical output text.
- The workflow uses permissive CORS for MVP convenience. Tighten this before any real production use.
- Use synthetic or de-identified clinical data only.
