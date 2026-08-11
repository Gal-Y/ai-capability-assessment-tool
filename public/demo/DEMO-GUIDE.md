# Pathology demo upload packs

Use one folder at a time. Each folder is a complete upload pack with files numbered in the order they appear in the evaluation form:

1. Upload `1-source-pathology-cda.xml` and `2-source-pathology-report.pdf` as the source evidence.
2. Upload `3-reference-fhir.json` as the approved reference output.
3. Upload the file beginning with `4-candidate-` as the candidate FHIR output.
4. Run the evaluation. The Pathology report benchmark is applied automatically.

## The three demonstrations

- `01-ready`: every result is present, clinically exact and encoded with LOINC and UCUM. Expected decision: **Ready**.
- `02-conditional`: every clinical fact is present and correct, but the four tests use local laboratory codes instead of LOINC. Expected decision: **Conditional**.
- `03-not-ready`: the FHIR is complete and structurally valid, but potassium is changed from the critical source value of 6.2 mmol/L to 4.2 mmol/L. Expected decision: **Not Ready**.

The CDA, PDF and approved reference are intentionally the same in all three folders. Only the candidate changes, so each decision has one clear cause.
