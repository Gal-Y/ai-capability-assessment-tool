import importlib.util
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[2]


def load_scoring_module():
    common = types.ModuleType("common")
    for name in (
        "extract_readable_text",
        "now_iso",
        "to_input_file_item",
        "update_evaluation_item",
        "write_artifact",
    ):
        setattr(common, name, lambda *_args, **_kwargs: None)
    sys.modules["common"] = common

    openai_client = types.ModuleType("openai_client")
    openai_client.DEFAULT_EVALUATOR_MODEL = "test-evaluator"
    for name in ("create_response", "get_incomplete_reason", "parse_json_output"):
        setattr(openai_client, name, lambda *_args, **_kwargs: None)
    sys.modules["openai_client"] = openai_client

    path = ROOT / "infra/lambda/workflow/score_evaluation.py"
    spec = importlib.util.spec_from_file_location("workflow_scoring", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SCORING = load_scoring_module()


def candidate():
    return (
        ROOT / "public/demo/candidates/controlled-radiology-fhir-bundle.json"
    ).read_text()


def reference():
    return (
        ROOT / "public/demo/reference/expected-radiology-fhir-bundle.json"
    ).read_text()


class FhirValidationTests(unittest.TestCase):
    def test_controlled_candidate_is_structurally_valid(self):
        result = SCORING.validate_fhir_candidate(candidate())

        self.assertTrue(result["parsed"])
        self.assertTrue(result["valid"])
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["resourceCount"], 5)
        self.assertEqual(
            result["resourceTypes"],
            [
                "DiagnosticReport",
                "ImagingStudy",
                "Organization",
                "Patient",
                "Practitioner",
            ],
        )
        self.assertEqual(result["unresolvedReferences"], [])

    def test_complete_reference_is_structurally_valid(self):
        result = SCORING.validate_fhir_candidate(reference())

        self.assertTrue(result["valid"])
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["resourceCount"], 5)
        self.assertEqual(result["unresolvedReferences"], [])

    def test_readiness_decision_uses_all_five_dimension_gates(self):
        ready = {
            "taskReliability": 94,
            "privacyContainment": 99,
            "securityRobustness": 95,
            "constraintPerformance": 91,
            "valueUtility": 93,
        }
        blocked = dict(ready, privacyContainment=70)

        self.assertEqual(SCORING.build_decision(ready)[0], "Ready")
        self.assertEqual(
            SCORING.build_decision(ready, review_finding_count=1)[0],
            "Conditional",
        )
        self.assertEqual(SCORING.build_decision(blocked)[0], "Not Ready")

    def test_same_candidate_has_profile_specific_deployment_decisions(self):
        dimensions = {
            "taskReliability": 94,
            "privacyContainment": 99,
            "securityRobustness": 95,
            "constraintPerformance": 91,
            "valueUtility": 93,
        }
        expected = {
            "hospital": "Ready",
            "gp-clinic": "Conditional",
            "radiology-practice": "Not Ready",
        }

        for profile_id, expected_decision in expected.items():
            with self.subTest(profile_id=profile_id):
                assessment = SCORING.evaluate_deployment_profile(
                    candidate(), profile_id
                )
                decision, _score = SCORING.build_decision(
                    dimensions,
                    review_finding_count=assessment["reviewCount"],
                    blocking_finding_count=assessment["blockingCount"],
                )
                self.assertEqual(decision, expected_decision)

    def test_profile_findings_point_to_specific_fhir_fields(self):
        gp_assessment = SCORING.evaluate_deployment_profile(
            candidate(), "gp-clinic"
        )
        radiology_assessment = SCORING.evaluate_deployment_profile(
            candidate(), "radiology-practice"
        )

        gp_report_source = next(
            item
            for item in gp_assessment["requirements"]
            if item["id"] == "structured-report-source"
        )
        radiology_identifiers = next(
            item
            for item in radiology_assessment["requirements"]
            if item["id"] == "imaging-identifiers"
        )
        radiology_context = next(
            item
            for item in radiology_assessment["requirements"]
            if item["id"] == "imaging-context"
        )

        self.assertEqual(gp_report_source["status"], "review")
        self.assertIn("DiagnosticReport.performer", gp_report_source["evidencePath"])
        self.assertEqual(radiology_identifiers["status"], "block")
        self.assertIn("ImagingStudy.identifier", radiology_identifiers["evidencePath"])
        self.assertEqual(radiology_context["status"], "block")
        self.assertIn("ImagingStudy.modality", radiology_context["evidencePath"])

    def test_hospital_accepts_the_controlled_candidate_with_advisories_only(self):
        assessment = SCORING.evaluate_deployment_profile(candidate(), "hospital")

        self.assertEqual(assessment["reviewCount"], 0)
        self.assertEqual(assessment["blockingCount"], 0)
        self.assertEqual(assessment["advisoryCount"], 2)

    def test_fhir_dates_and_terminology_urls_are_not_phi(self):
        items = SCORING.extract_sensitive_items(
            '"effectiveDateTime":"2026-07-30T09:00:00+10:00",'
            '"system":"http://loinc.org",'
            '"div":"<div xmlns=\\"http://www.w3.org/1999/xhtml\\"><p>Report</p></div>"'
        )

        self.assertFalse(any(item["label"] == "phone number" for item in items))
        self.assertFalse(any(item["label"] == "url" for item in items))

    def test_synthetic_source_supported_identifiers_receive_privacy_floor(self):
        assessment = {
            "metrics": {"privacy": 100},
            "checks": {"privacyFlags": []},
        }

        self.assertEqual(
            SCORING.get_synthetic_privacy_score_floor(
                "SYNTHETIC - NOT FOR CLINICAL USE", assessment
            ),
            98,
        )

if __name__ == "__main__":
    unittest.main()
