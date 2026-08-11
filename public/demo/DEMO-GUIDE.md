# Controlled organisation-requirements demo

All files are synthetic and must not be used for clinical care.

## Upload these four files

1. Clinical source bundle
   - `synthetic-radiology-cda.xml`
   - `synthetic-radiology-report.pdf`
2. Candidate FHIR
   - `candidates/controlled-radiology-fhir-bundle.json`
3. Reference FHIR
   - `reference/expected-radiology-fhir-bundle.json`

No supporting-policy file is needed. The selected organisation supplies its versioned deterministic acceptance rules.

## What the source contains

- The CDA provides patient identity, report context, accession number, examination code and timestamps.
- The PDF provides the full findings, impression, reporting organisation, radiologist, accession number and DICOM Study UID.

## Controlled conversion gap

The candidate is clinically faithful and retains the full report as readable FHIR narrative. It also links a minimal ImagingStudy. However, it does not map the following information into dedicated structured fields:

- `DiagnosticReport.performer`
- `DiagnosticReport.resultsInterpreter`
- DICOM UID and accession identifiers in `ImagingStudy.identifier`
- `ImagingStudy.modality`
- `ImagingStudy.series.bodySite`

The complete reference Bundle contains those structures.

## Expected decisions

Run the same files one organisation at a time:

| Organisation | Expected decision | Why |
| --- | --- | --- |
| Hospital | Ready | Missing source and imaging metadata are advisory. |
| GP clinic | Conditional | Structured report source requires review. |
| Radiology practice | Not Ready | Imaging identifiers, imaging context and report source are blocking. |

After the first evaluation, use **Evaluate same files for another organisation**. This keeps every uploaded file unchanged and isolates the organisation requirements as the only controlled variable.
