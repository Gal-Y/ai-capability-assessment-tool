"""Generate the three synthetic pathology demo upload packs.

The source CDA, companion PDF and approved FHIR reference are intentionally
identical across all three packs. Only the candidate FHIR changes so the demo
isolates three different readiness outcomes.
"""

from copy import deepcopy
import json
from pathlib import Path
import shutil

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
DEMO_ROOT = ROOT / "public" / "demo"
GENERATED_PDF = ROOT / "tmp" / "pathology-demo-report.pdf"

PATIENT_REF = "urn:uuid:11111111-1111-4111-8111-111111111111"
ORGANIZATION_REF = "urn:uuid:22222222-2222-4222-8222-222222222222"
PRACTITIONER_REF = "urn:uuid:33333333-3333-4333-8333-333333333333"
SERUM_SPECIMEN_REF = "urn:uuid:44444444-4444-4444-8444-444444444441"
EDTA_SPECIMEN_REF = "urn:uuid:44444444-4444-4444-8444-444444444442"
POTASSIUM_REF = "urn:uuid:55555555-5555-4555-8555-555555555555"
HBA1C_REF = "urn:uuid:66666666-6666-4666-8666-666666666666"
GLUCOSE_REF = "urn:uuid:77777777-7777-4777-8777-777777777777"
EGFR_REF = "urn:uuid:88888888-8888-4888-8888-888888888888"
REPORT_REF = "urn:uuid:99999999-9999-4999-8999-999999999999"

FHIR_CATEGORY = {
    "coding": [
        {
            "system": "http://terminology.hl7.org/CodeSystem/observation-category",
            "code": "laboratory",
            "display": "Laboratory",
        }
    ]
}

INTERPRETATION_SYSTEM = (
    "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation"
)

RESULTS = [
    {
        "id": "potassium",
        "full_url": POTASSIUM_REF,
        "label": "Potassium",
        "loinc": "2823-3",
        "value": 6.2,
        "unit": "mmol/L",
        "unit_code": "mmol/L",
        "range_low": 3.5,
        "range_high": 5.2,
        "range_text": "3.5 - 5.2",
        "interpretation": "HH",
        "interpretation_display": "Critical high",
        "specimen": SERUM_SPECIMEN_REF,
    },
    {
        "id": "hba1c",
        "full_url": HBA1C_REF,
        "label": "Haemoglobin A1c",
        "loinc": "4548-4",
        "value": 7.8,
        "unit": "%",
        "unit_code": "%",
        "range_low": 4.0,
        "range_high": 6.0,
        "range_text": "4.0 - 6.0",
        "interpretation": "H",
        "interpretation_display": "High",
        "specimen": EDTA_SPECIMEN_REF,
    },
    {
        "id": "glucose",
        "full_url": GLUCOSE_REF,
        "label": "Glucose",
        "loinc": "14749-6",
        "value": 8.6,
        "unit": "mmol/L",
        "unit_code": "mmol/L",
        "range_low": 3.9,
        "range_high": 5.5,
        "range_text": "3.9 - 5.5",
        "interpretation": "H",
        "interpretation_display": "High",
        "specimen": SERUM_SPECIMEN_REF,
    },
    {
        "id": "egfr",
        "full_url": EGFR_REF,
        "label": "eGFR (CKD-EPI 2021)",
        "loinc": "98979-8",
        "value": 82,
        "unit": "mL/min/1.73 m2",
        "unit_code": "mL/min/{1.73_m2}",
        "range_low": 60,
        "range_high": None,
        "range_text": ">= 60",
        "interpretation": "N",
        "interpretation_display": "Normal",
        "specimen": SERUM_SPECIMEN_REF,
    },
]


def observation_resource(result):
    reference_range = {"text": result["range_text"]}
    if result["range_low"] is not None:
        reference_range["low"] = {
            "value": result["range_low"],
            "unit": result["unit"],
            "system": "http://unitsofmeasure.org",
            "code": result["unit_code"],
        }
    if result["range_high"] is not None:
        reference_range["high"] = {
            "value": result["range_high"],
            "unit": result["unit"],
            "system": "http://unitsofmeasure.org",
            "code": result["unit_code"],
        }

    return {
        "resourceType": "Observation",
        "id": f"obs-{result['id']}",
        "status": "final",
        "category": [deepcopy(FHIR_CATEGORY)],
        "code": {
            "coding": [
                {
                    "system": "http://loinc.org",
                    "code": result["loinc"],
                    "display": result["label"],
                }
            ],
            "text": result["label"],
        },
        "subject": {"reference": PATIENT_REF},
        "effectiveDateTime": "2026-08-11T08:40:00+10:00",
        "issued": "2026-08-11T10:16:00+10:00",
        "performer": [{"reference": ORGANIZATION_REF}],
        "specimen": {"reference": result["specimen"]},
        "valueQuantity": {
            "value": result["value"],
            "unit": result["unit"],
            "system": "http://unitsofmeasure.org",
            "code": result["unit_code"],
        },
        "referenceRange": [reference_range],
        "interpretation": [
            {
                "coding": [
                    {
                        "system": INTERPRETATION_SYSTEM,
                        "code": result["interpretation"],
                        "display": result["interpretation_display"],
                    }
                ],
                "text": result["interpretation_display"],
            }
        ],
    }


def reference_bundle():
    entries = [
        {
            "fullUrl": PATIENT_REF,
            "resource": {
                "resourceType": "Patient",
                "id": "patient-syn-path-001",
                "identifier": [
                    {
                        "system": "https://synthetic.southerncross.example/mrn",
                        "value": "SYN-PATH-001",
                    }
                ],
                "name": [{"use": "official", "family": "Sample", "given": ["Alex"]}],
                "gender": "unknown",
                "birthDate": "1982-03-14",
            },
        },
        {
            "fullUrl": ORGANIZATION_REF,
            "resource": {
                "resourceType": "Organization",
                "id": "org-southern-cross-pathology",
                "identifier": [
                    {
                        "system": "https://synthetic.southerncross.example/lab-id",
                        "value": "SCP-001",
                    }
                ],
                "name": "Southern Cross Pathology - Synthetic",
            },
        },
        {
            "fullUrl": PRACTITIONER_REF,
            "resource": {
                "resourceType": "Practitioner",
                "id": "practitioner-rivera",
                "name": [{"prefix": ["Dr"], "family": "Rivera", "given": ["Morgan"]}],
            },
        },
        {
            "fullUrl": SERUM_SPECIMEN_REF,
            "resource": {
                "resourceType": "Specimen",
                "id": "specimen-serum",
                "identifier": [
                    {
                        "system": "https://synthetic.southerncross.example/specimen",
                        "value": "SYN-SER-260811-17",
                    }
                ],
                "status": "available",
                "type": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/v2-0487",
                            "code": "SER",
                            "display": "Serum",
                        }
                    ],
                    "text": "Serum",
                },
                "subject": {"reference": PATIENT_REF},
                "collection": {"collectedDateTime": "2026-08-11T08:40:00+10:00"},
                "receivedTime": "2026-08-11T09:12:00+10:00",
            },
        },
        {
            "fullUrl": EDTA_SPECIMEN_REF,
            "resource": {
                "resourceType": "Specimen",
                "id": "specimen-edta-blood",
                "identifier": [
                    {
                        "system": "https://synthetic.southerncross.example/specimen",
                        "value": "SYN-EDTA-260811-17",
                    }
                ],
                "status": "available",
                "type": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/v2-0487",
                            "code": "BLD",
                            "display": "Whole blood",
                        }
                    ],
                    "text": "EDTA whole blood",
                },
                "subject": {"reference": PATIENT_REF},
                "collection": {"collectedDateTime": "2026-08-11T08:40:00+10:00"},
                "receivedTime": "2026-08-11T09:12:00+10:00",
            },
        },
    ]

    for result in RESULTS:
        entries.append(
            {"fullUrl": result["full_url"], "resource": observation_resource(result)}
        )

    entries.append(
        {
            "fullUrl": REPORT_REF,
            "resource": {
                "resourceType": "DiagnosticReport",
                "id": "diagnostic-report-pathology",
                "identifier": [
                    {
                        "system": "https://synthetic.southerncross.example/accession",
                        "value": "SYN-LAB-260811-17",
                    }
                ],
                "status": "final",
                "category": [deepcopy(FHIR_CATEGORY)],
                "code": {
                    "coding": [
                        {
                            "system": "http://loinc.org",
                            "code": "11502-2",
                            "display": "Laboratory report",
                        }
                    ],
                    "text": "Integrated pathology report",
                },
                "subject": {"reference": PATIENT_REF},
                "effectiveDateTime": "2026-08-11T08:40:00+10:00",
                "issued": "2026-08-11T10:16:00+10:00",
                "performer": [{"reference": ORGANIZATION_REF}],
                "resultsInterpreter": [{"reference": PRACTITIONER_REF}],
                "specimen": [
                    {"reference": SERUM_SPECIMEN_REF},
                    {"reference": EDTA_SPECIMEN_REF},
                ],
                "result": [
                    {"reference": POTASSIUM_REF},
                    {"reference": HBA1C_REF},
                    {"reference": GLUCOSE_REF},
                    {"reference": EGFR_REF},
                ],
                "conclusion": (
                    "Critical hyperkalaemia (potassium 6.2 mmol/L). "
                    "HbA1c and glucose are above the stated laboratory ranges. "
                    "Urgent clinical review is recommended."
                ),
                "presentedForm": [
                    {
                        "contentType": "application/pdf",
                        "title": "Synthetic integrated pathology report",
                        "url": "https://synthetic.southerncross.example/reports/SYN-LAB-260811-17.pdf",
                    }
                ],
            },
        }
    )

    return {
        "resourceType": "Bundle",
        "id": "bundle-synthetic-pathology",
        "type": "collection",
        "timestamp": "2026-08-11T10:16:00+10:00",
        "entry": entries,
    }


def conditional_candidate(reference):
    candidate = deepcopy(reference)
    local_codes = {
        "obs-potassium": "CHEM-K",
        "obs-hba1c": "DIAB-A1C",
        "obs-glucose": "CHEM-GLU",
        "obs-egfr": "RENAL-EGFR",
    }
    for entry in candidate["entry"]:
        resource = entry["resource"]
        if resource.get("resourceType") != "Observation":
            continue
        coding = resource["code"]["coding"][0]
        coding["system"] = (
            "https://synthetic.southerncross.example/fhir/CodeSystem/lab-tests"
        )
        coding["code"] = local_codes[resource["id"]]
    return candidate


def not_ready_candidate(reference):
    candidate = deepcopy(reference)
    for entry in candidate["entry"]:
        resource = entry["resource"]
        if resource.get("id") == "obs-potassium":
            resource["valueQuantity"]["value"] = 4.2
            resource["interpretation"] = [
                {
                    "coding": [
                        {
                            "system": INTERPRETATION_SYSTEM,
                            "code": "N",
                            "display": "Normal",
                        }
                    ],
                    "text": "Normal",
                }
            ]
        if resource.get("id") == "diagnostic-report-pathology":
            resource["conclusion"] = (
                "Potassium is within the stated laboratory range. HbA1c and glucose "
                "are above the stated laboratory ranges. Routine clinical review is recommended."
            )
    return candidate


def source_cda():
    return """<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <realmCode code="AU"/>
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <id root="2.16.840.1.113883.19.5" extension="SYN-LAB-260811-17"/>
  <code code="11502-2" codeSystem="2.16.840.1.113883.6.1" displayName="Laboratory report"/>
  <title>Integrated Pathology Report</title>
  <effectiveTime value="20260811101600+1000"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <languageCode code="en-AU"/>

  <recordTarget>
    <patientRole>
      <id root="2.16.840.1.113883.19.5" extension="SYN-PATH-001"/>
      <patient>
        <name><given>Alex</given><family>Sample</family></name>
        <administrativeGenderCode code="UN"/>
        <birthTime value="19820314"/>
      </patient>
    </patientRole>
  </recordTarget>

  <author>
    <time value="20260811101600+1000"/>
    <assignedAuthor>
      <id root="2.16.840.1.113883.19.5" extension="SCP-001"/>
      <representedOrganization><name>Southern Cross Pathology - Synthetic</name></representedOrganization>
    </assignedAuthor>
  </author>

  <documentationOf>
    <serviceEvent classCode="ACT" moodCode="EVN">
      <effectiveTime><low value="20260811084000+1000"/><high value="20260811101600+1000"/></effectiveTime>
      <performer typeCode="PRF">
        <assignedEntity>
          <id root="2.16.840.1.113883.19.5" extension="SCP-001"/>
          <representedOrganization><name>Southern Cross Pathology - Synthetic</name></representedOrganization>
        </assignedEntity>
      </performer>
    </serviceEvent>
  </documentationOf>

  <component>
    <structuredBody>
      <component>
        <section>
          <code code="48767-8" codeSystem="2.16.840.1.113883.6.1" displayName="Annotation comment"/>
          <title>Report context</title>
          <text>
            <paragraph>Accession: SYN-LAB-260811-17</paragraph>
            <paragraph>Requested by: Dr Taylor</paragraph>
            <paragraph>Status: Final</paragraph>
            <paragraph>Detailed analytical results and reference ranges are supplied in the companion PDF report.</paragraph>
          </text>
        </section>
      </component>
      <component>
        <section>
          <code code="59773-2" codeSystem="2.16.840.1.113883.6.1" displayName="Specimen information"/>
          <title>Specimens</title>
          <text>
            <table>
              <thead><tr><th>Specimen ID</th><th>Type</th><th>Collected</th></tr></thead>
              <tbody>
                <tr><td>SYN-SER-260811-17</td><td>Serum</td><td>11 Aug 2026 08:40</td></tr>
                <tr><td>SYN-EDTA-260811-17</td><td>EDTA whole blood</td><td>11 Aug 2026 08:40</td></tr>
              </tbody>
            </table>
          </text>
        </section>
      </component>
    </structuredBody>
  </component>
</ClinicalDocument>
"""


def wrapped_lines(text, font_name, font_size, max_width):
    words = text.split()
    lines = []
    current = []
    for word in words:
        candidate = " ".join([*current, word])
        if current and stringWidth(candidate, font_name, font_size) > max_width:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return lines


def draw_wrapped(pdf, text, x, y, width, font="Helvetica", size=9, leading=12):
    pdf.setFont(font, size)
    for line in wrapped_lines(text, font, size, width):
        pdf.drawString(x, y, line)
        y -= leading
    return y


def build_pdf(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    page_width, page_height = A4
    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1, invariant=1)
    pdf.setTitle("Synthetic Integrated Pathology Report")
    pdf.setAuthor("UNSW Thesis Demo")
    pdf.setSubject("Synthetic pathology companion PDF for CDA-to-FHIR evaluation")

    navy = colors.HexColor("#102A43")
    teal = colors.HexColor("#0F766E")
    dark = colors.HexColor("#172B4D")
    muted = colors.HexColor("#5E6C84")
    line = colors.HexColor("#D9E2EC")
    soft = colors.HexColor("#F4F7FA")
    amber = colors.HexColor("#9A6700")
    amber_soft = colors.HexColor("#FFF4CE")
    teal_soft = colors.HexColor("#E7F6F3")

    pdf.setFillColor(colors.white)
    pdf.rect(0, 0, page_width, page_height, fill=1, stroke=0)
    pdf.setFillColor(navy)
    pdf.rect(0, page_height - 35 * mm, page_width, 35 * mm, fill=1, stroke=0)

    left = 17 * mm
    right = page_width - 17 * mm
    width = right - left

    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 19)
    pdf.drawString(left, page_height - 17 * mm, "SOUTHERN CROSS PATHOLOGY")
    pdf.setFont("Helvetica", 8)
    pdf.drawString(left, page_height - 24 * mm, "INTEGRATED PATHOLOGY REPORT  |  FINAL")

    badge_width = 46 * mm
    pdf.setFillColor(colors.HexColor("#D8F3EC"))
    pdf.roundRect(right - badge_width, page_height - 24 * mm, badge_width, 10 * mm, 2 * mm, fill=1, stroke=0)
    pdf.setFillColor(teal)
    pdf.setFont("Helvetica-Bold", 7.3)
    pdf.drawCentredString(right - badge_width / 2, page_height - 20.2 * mm, "SYNTHETIC DEMO RECORD")
    pdf.setFont("Helvetica", 6.5)
    pdf.drawCentredString(right - badge_width / 2, page_height - 23.3 * mm, "NOT FOR CLINICAL USE")

    card_top = page_height - 44 * mm
    card_height = 31 * mm
    pdf.setFillColor(soft)
    pdf.roundRect(left, card_top - card_height, width, card_height, 2 * mm, fill=1, stroke=0)
    pdf.setStrokeColor(line)
    pdf.roundRect(left, card_top - card_height, width, card_height, 2 * mm, fill=0, stroke=1)

    labels = [
        ("PATIENT", "Alex Sample", left + 6 * mm, card_top - 8 * mm),
        ("DOB", "14 Mar 1982", left + 64 * mm, card_top - 8 * mm),
        ("MRN", "SYN-PATH-001", left + 118 * mm, card_top - 8 * mm),
        ("ACCESSION", "SYN-LAB-260811-17", left + 6 * mm, card_top - 22 * mm),
        ("COLLECTED", "11 Aug 2026 08:40", left + 72 * mm, card_top - 22 * mm),
        ("REQUESTED BY", "Dr Taylor", left + 136 * mm, card_top - 22 * mm),
    ]
    for label, value, x, y in labels:
        pdf.setFillColor(muted)
        pdf.setFont("Helvetica-Bold", 6.5)
        pdf.drawString(x, y, label)
        pdf.setFillColor(dark)
        pdf.setFont("Helvetica", 9)
        pdf.drawString(x, y - 4.2 * mm, value)

    specimen_y = card_top - card_height - 10 * mm
    pdf.setFillColor(dark)
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(left, specimen_y, "SPECIMENS")
    pdf.setFillColor(muted)
    pdf.setFont("Helvetica", 8.2)
    pdf.drawString(left + 30 * mm, specimen_y, "Serum: SYN-SER-260811-17")
    pdf.drawString(left + 98 * mm, specimen_y, "EDTA blood: SYN-EDTA-260811-17")

    table_top = specimen_y - 9 * mm
    row_height = 14 * mm
    columns = [0, 54, 82, 117, 150, 176]
    pdf.setFillColor(navy)
    pdf.rect(left, table_top - 9 * mm, width, 9 * mm, fill=1, stroke=0)
    headings = ["TEST", "RESULT", "UNIT", "REFERENCE", "FLAG"]
    for index, heading in enumerate(headings):
        pdf.setFillColor(colors.white)
        pdf.setFont("Helvetica-Bold", 7)
        pdf.drawString(left + columns[index] * mm + 3 * mm, table_top - 5.8 * mm, heading)

    y = table_top - 9 * mm
    for index, result in enumerate(RESULTS):
        row_top = y - index * row_height
        is_critical = result["interpretation"] == "HH"
        pdf.setFillColor(amber_soft if is_critical else colors.white)
        pdf.rect(left, row_top - row_height, width, row_height, fill=1, stroke=0)
        pdf.setStrokeColor(line)
        pdf.line(left, row_top - row_height, right, row_top - row_height)

        values = [
            result["label"],
            str(result["value"]),
            result["unit"],
            result["range_text"],
            result["interpretation_display"].upper(),
        ]
        for column_index, value in enumerate(values):
            pdf.setFillColor(amber if is_critical and column_index in {1, 4} else dark)
            pdf.setFont(
                "Helvetica-Bold" if column_index in {0, 1, 4} else "Helvetica",
                8.5 if column_index != 4 else 7.3,
            )
            pdf.drawString(
                left + columns[column_index] * mm + 3 * mm,
                row_top - 8.5 * mm,
                value,
            )

    conclusion_top = table_top - 9 * mm - len(RESULTS) * row_height - 10 * mm
    pdf.setFillColor(teal_soft)
    pdf.roundRect(left, conclusion_top - 31 * mm, width, 31 * mm, 2 * mm, fill=1, stroke=0)
    pdf.setFillColor(teal)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(left + 5 * mm, conclusion_top - 7 * mm, "PATHOLOGIST INTERPRETATION")
    pdf.setFillColor(dark)
    interpretation = (
        "Critical hyperkalaemia (potassium 6.2 mmol/L). HbA1c and glucose are above "
        "the stated laboratory ranges. Urgent clinical review is recommended."
    )
    draw_wrapped(
        pdf,
        interpretation,
        left + 5 * mm,
        conclusion_top - 15 * mm,
        width - 10 * mm,
        font="Helvetica-Bold",
        size=9.5,
        leading=13,
    )

    signature_y = conclusion_top - 43 * mm
    pdf.setFillColor(dark)
    pdf.setFont("Helvetica-Oblique", 11)
    pdf.drawString(left + 2 * mm, signature_y, "Morgan Rivera")
    pdf.setFillColor(muted)
    pdf.setFont("Helvetica", 7.2)
    pdf.drawString(left + 2 * mm, signature_y - 5 * mm, "Dr Morgan Rivera  |  Pathologist  |  Electronically verified 10:16")

    pdf.setFillColor(navy)
    pdf.rect(0, 0, page_width, 16 * mm, fill=1, stroke=0)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 7)
    pdf.drawCentredString(page_width / 2, 9.5 * mm, "SYNTHETIC DEMO DATA - NOT FOR CLINICAL USE")
    pdf.setFont("Helvetica", 6.5)
    pdf.drawCentredString(page_width / 2, 5.5 * mm, "Companion PDF for CDA-to-FHIR capability assessment")

    pdf.showPage()
    pdf.save()


def write_json(path, payload):
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_demo_pack(folder_name, candidate_name, candidate):
    folder = DEMO_ROOT / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "1-source-pathology-cda.xml").write_text(source_cda(), encoding="utf-8")
    shutil.copyfile(GENERATED_PDF, folder / "2-source-pathology-report.pdf")
    write_json(folder / "3-reference-fhir.json", reference_bundle())
    write_json(folder / candidate_name, candidate)


def write_manifest():
    manifest = {
        "defaultScenario": "conditional",
        "scenarios": {
            "ready": {
                "label": "Ready",
                "files": {
                    "clinicalBundle": [
                        "/demo/01-ready/1-source-pathology-cda.xml",
                        "/demo/01-ready/2-source-pathology-report.pdf",
                    ],
                    "reference": ["/demo/01-ready/3-reference-fhir.json"],
                    "candidate": "/demo/01-ready/4-candidate-ready-fhir.json",
                },
            },
            "conditional": {
                "label": "Conditional",
                "files": {
                    "clinicalBundle": [
                        "/demo/02-conditional/1-source-pathology-cda.xml",
                        "/demo/02-conditional/2-source-pathology-report.pdf",
                    ],
                    "reference": ["/demo/02-conditional/3-reference-fhir.json"],
                    "candidate": "/demo/02-conditional/4-candidate-conditional-fhir.json",
                },
            },
            "notReady": {
                "label": "Not Ready",
                "files": {
                    "clinicalBundle": [
                        "/demo/03-not-ready/1-source-pathology-cda.xml",
                        "/demo/03-not-ready/2-source-pathology-report.pdf",
                    ],
                    "reference": ["/demo/03-not-ready/3-reference-fhir.json"],
                    "candidate": "/demo/03-not-ready/4-candidate-not-ready-fhir.json",
                },
            },
        },
    }
    write_json(DEMO_ROOT / "manifest.json", manifest)


def write_guide():
    guide = """# Pathology demo upload packs

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
"""
    (DEMO_ROOT / "DEMO-GUIDE.md").write_text(guide, encoding="utf-8")


def main():
    DEMO_ROOT.mkdir(parents=True, exist_ok=True)
    build_pdf(GENERATED_PDF)
    reference = reference_bundle()
    write_demo_pack(
        "01-ready",
        "4-candidate-ready-fhir.json",
        deepcopy(reference),
    )
    write_demo_pack(
        "02-conditional",
        "4-candidate-conditional-fhir.json",
        conditional_candidate(reference),
    )
    write_demo_pack(
        "03-not-ready",
        "4-candidate-not-ready-fhir.json",
        not_ready_candidate(reference),
    )
    write_manifest()
    write_guide()
    print(f"Generated pathology demo packs in {DEMO_ROOT}")


if __name__ == "__main__":
    main()
