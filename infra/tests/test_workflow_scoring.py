import importlib.util
import json
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


def candidate(name):
    return (ROOT / f"public/demo/candidates/{name}-fhir-bundle.json").read_text()


class FhirValidationTests(unittest.TestCase):
    def test_ready_fixture_is_structurally_valid(self):
        result = SCORING.validate_fhir_candidate(candidate("ready"))

        self.assertTrue(result["parsed"])
        self.assertTrue(result["valid"])
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["resourceCount"], 6)
        self.assertEqual(result["unresolvedReferences"], [])

    def test_conditional_fixture_surfaces_profile_warnings(self):
        result = SCORING.validate_fhir_candidate(candidate("conditional"))

        self.assertTrue(result["valid"])
        self.assertLess(result["score"], 100)
        self.assertEqual(len(result["warnings"]), 1)

    def test_blocked_fixture_rejects_unresolved_reference(self):
        result = SCORING.validate_fhir_candidate(candidate("blocked"))

        self.assertFalse(result["valid"])
        self.assertIn("urn:uuid:missing-patient", result["unresolvedReferences"])
        self.assertTrue(any("Unresolved Bundle references" in item for item in result["errors"]))

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

    def test_fhir_dates_and_terminology_urls_are_not_phi(self):
        items = SCORING.extract_sensitive_items(
            '"effectiveDateTime":"2026-07-30T09:00:00+10:00",'
            '"system":"http://loinc.org"'
        )

        self.assertFalse(any(item["label"] == "phone number" for item in items))
        self.assertFalse(any(item["label"] == "url" for item in items))

    def test_blocked_fixture_contains_the_security_test_artifact(self):
        payload = json.loads(candidate("blocked"))
        text = json.dumps(payload)

        self.assertTrue(SCORING.has_prompt_injection_artifact(text))


if __name__ == "__main__":
    unittest.main()
