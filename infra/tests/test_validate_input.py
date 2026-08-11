import importlib.util
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[2]


def load_validation_module():
    common = types.ModuleType("common")
    common.now_iso = lambda: "2026-08-08T00:00:00Z"
    common.update_evaluation_item = lambda *_args, **_kwargs: None
    common.write_artifact = lambda *_args, **_kwargs: "workflow/validation.json"
    sys.modules["common"] = common

    path = ROOT / "infra/lambda/workflow/validate_input.py"
    spec = importlib.util.spec_from_file_location("workflow_validation", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


VALIDATION = load_validation_module()


def base_event(output_source):
    return {
        "evaluationId": "eval-test",
        "outputSource": output_source,
        "documents": [
            {"name": "source-pathology-cda.xml", "key": "documents/cda.xml"},
            {"name": "source-pathology-report.pdf", "key": "documents/report.pdf"},
        ],
        "referenceOutputs": [],
        "policyFiles": [],
        "aiOutputs": [],
        "config": {"modelId": "gpt-5.4-mini", "caseMode": "clinical-bundle"},
    }


class ValidationModeTests(unittest.TestCase):
    def test_platform_generation_accepts_source_bundle_without_reference(self):
        result = VALIDATION.handler(base_event("platform-model"), None)

        self.assertEqual(result["validation"]["documentCount"], 2)
        self.assertFalse(result["inputProfile"]["hasFhirReference"])
        self.assertEqual(result["validation"]["caseMode"], "clinical-bundle")

    def test_uploaded_candidate_still_requires_reference(self):
        event = base_event("uploaded-outputs")
        event["aiOutputs"] = [{"name": "candidate.json", "key": "outputs/candidate.json"}]

        with self.assertRaisesRegex(ValueError, "requires at least one reference output"):
            VALIDATION.handler(event, None)


if __name__ == "__main__":
    unittest.main()
