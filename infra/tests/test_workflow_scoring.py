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


def candidate(scenario="ready"):
    paths = {
        "ready": ROOT / "public/demo/01-ready/4-candidate-ready-fhir.json",
        "conditional": ROOT
        / "public/demo/02-conditional/4-candidate-conditional-fhir.json",
        "not-ready": ROOT
        / "public/demo/03-not-ready/4-candidate-not-ready-fhir.json",
    }
    return paths[scenario].read_text()


def reference():
    return (ROOT / "public/demo/01-ready/3-reference-fhir.json").read_text()


class FhirValidationTests(unittest.TestCase):
    def test_ready_candidate_is_structurally_valid(self):
        result = SCORING.validate_fhir_candidate(candidate())

        self.assertTrue(result["parsed"])
        self.assertTrue(result["valid"])
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["resourceCount"], 10)
        self.assertEqual(
            result["resourceTypes"],
            [
                "DiagnosticReport",
                "Observation",
                "Organization",
                "Patient",
                "Practitioner",
                "Specimen",
            ],
        )
        self.assertEqual(result["unresolvedReferences"], [])

    def test_complete_reference_is_structurally_valid(self):
        result = SCORING.validate_fhir_candidate(reference())

        self.assertTrue(result["valid"])
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["resourceCount"], 10)
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

    def test_three_complete_candidates_produce_distinct_readiness_decisions(self):
        dimensions = {
            "taskReliability": 94,
            "privacyContainment": 99,
            "securityRobustness": 95,
            "constraintPerformance": 91,
            "valueUtility": 93,
        }
        expected = {"ready": "Ready", "conditional": "Conditional", "not-ready": "Not Ready"}

        for scenario, expected_decision in expected.items():
            with self.subTest(scenario=scenario):
                assessment = SCORING.evaluate_deployment_profile(
                    candidate(scenario), "pathology-report", reference()
                )
                coverage = next(
                    item
                    for item in assessment["requirements"]
                    if item["id"] == "pathology-result-coverage"
                )
                decision, _score = SCORING.build_decision(
                    dimensions,
                    review_finding_count=assessment["reviewCount"],
                    blocking_finding_count=assessment["blockingCount"],
                )
                self.assertEqual(coverage["status"], "pass")
                self.assertEqual(decision, expected_decision)

    def test_profile_findings_point_to_specific_fhir_fields(self):
        conditional_assessment = SCORING.evaluate_deployment_profile(
            candidate("conditional"), "pathology-report", reference()
        )
        not_ready_assessment = SCORING.evaluate_deployment_profile(
            candidate("not-ready"), "pathology-report", reference()
        )

        terminology = next(
            item
            for item in conditional_assessment["requirements"]
            if item["id"] == "standard-pathology-terminology"
        )
        conditional_truth = next(
            item
            for item in conditional_assessment["requirements"]
            if item["id"] == "pathology-clinical-truth"
        )
        clinical_truth = next(
            item
            for item in not_ready_assessment["requirements"]
            if item["id"] == "pathology-clinical-truth"
        )

        self.assertEqual(terminology["status"], "review")
        self.assertIn("Observation.code.coding.system", terminology["evidencePath"])
        self.assertEqual(conditional_truth["status"], "pass")
        self.assertEqual(clinical_truth["status"], "block")
        self.assertIn("expected 6.2", clinical_truth["detail"])
        self.assertIn("candidate has 4.2", clinical_truth["detail"])
        self.assertIn("Observation.valueQuantity.value", clinical_truth["evidencePath"])

    def test_ready_candidate_meets_the_entire_pathology_benchmark(self):
        assessment = SCORING.evaluate_deployment_profile(
            candidate(), "pathology-report", reference()
        )

        self.assertEqual(assessment["reviewCount"], 0)
        self.assertEqual(assessment["blockingCount"], 0)
        self.assertEqual(assessment["advisoryCount"], 0)
        self.assertEqual(assessment["passCount"], 8)

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
