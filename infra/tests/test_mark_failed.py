import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[2]


def load_failure_module():
    common = types.ModuleType("common")
    common.now_iso = lambda: "2026-08-12T00:00:00Z"
    common.update_evaluation_item = lambda *_args, **_kwargs: None
    common.write_artifact = lambda *_args, **_kwargs: "workflow/failure.json"
    sys.modules["common"] = common

    path = ROOT / "infra/lambda/workflow/mark_failed.py"
    spec = importlib.util.spec_from_file_location("workflow_failure", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FAILURE = load_failure_module()


class FailureMessageTests(unittest.TestCase):
    def test_lambda_cause_returns_human_readable_error_message(self):
        cause = json.dumps(
            {
                "errorMessage": (
                    "FHIR generation failed: the model did not return a valid "
                    "FHIR Bundle after 2 attempts. Generate again."
                ),
                "errorType": "RuntimeError",
            }
        )

        self.assertEqual(
            FAILURE.get_failure_message({"Cause": cause, "Error": "RuntimeError"}),
            (
                "FHIR generation failed: the model did not return a valid "
                "FHIR Bundle after 2 attempts. Generate again."
            ),
        )

    def test_plain_workflow_cause_is_preserved(self):
        self.assertEqual(
            FAILURE.get_failure_message({"Cause": "Plain failure"}),
            "Plain failure",
        )


if __name__ == "__main__":
    unittest.main()
