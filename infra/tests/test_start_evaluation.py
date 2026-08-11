import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[2]


class FakeTable:
    def __init__(self):
        self.items = []

    def put_item(self, Item):
        self.items.append(Item)


class FakeStepFunctions:
    def __init__(self):
        self.executions = []

    def start_execution(self, **kwargs):
        self.executions.append(kwargs)


def load_start_module():
    fake_table = FakeTable()
    fake_step_functions = FakeStepFunctions()

    boto3 = types.ModuleType("boto3")
    boto3.resource = lambda _name: types.SimpleNamespace(Table=lambda _table_name: fake_table)
    boto3.client = lambda _name: fake_step_functions
    sys.modules["boto3"] = boto3

    common = types.ModuleType("common")
    common.parse_body = lambda event: json.loads(event.get("body", "{}"))
    common.response = lambda status, body: {"statusCode": status, "body": json.dumps(body)}
    sys.modules["common"] = common

    os.environ["EVALUATIONS_TABLE"] = "test-evaluations"
    os.environ["EVALUATION_WORKFLOW_ARN"] = "arn:aws:states:test:workflow"

    path = ROOT / "infra/lambda/api/start_evaluation.py"
    spec = importlib.util.spec_from_file_location("start_evaluation_api", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, fake_table, fake_step_functions


START, TABLE, STEP_FUNCTIONS = load_start_module()


def request(output_source, reference_outputs=None, ai_outputs=None):
    return {
        "body": json.dumps(
            {
                "capability": "structured_clinical_resource_generation",
                "outputSource": output_source,
                "documents": [{"name": "source.xml", "key": "documents/source.xml"}],
                "referenceOutputs": reference_outputs or [],
                "aiOutputs": ai_outputs or [],
                "config": {"modelId": "gpt-5.4-mini"},
            }
        )
    }


class StartEvaluationApiTests(unittest.TestCase):
    def setUp(self):
        TABLE.items.clear()
        STEP_FUNCTIONS.executions.clear()

    def test_platform_generation_starts_without_reference(self):
        result = START.handler(request("platform-model"), None)

        self.assertEqual(result["statusCode"], 202)
        self.assertEqual(len(TABLE.items), 1)
        self.assertEqual(len(STEP_FUNCTIONS.executions), 1)

    def test_uploaded_candidate_requires_reference(self):
        result = START.handler(
            request(
                "uploaded-outputs",
                ai_outputs=[{"name": "candidate.json", "key": "outputs/candidate.json"}],
            ),
            None,
        )

        self.assertEqual(result["statusCode"], 400)
        self.assertIn("requires at least one reference output", result["body"])

    def test_unknown_deployment_profile_is_rejected(self):
        event = request(
            "uploaded-outputs",
            reference_outputs=[{"name": "reference.json", "key": "reference/reference.json"}],
            ai_outputs=[{"name": "candidate.json", "key": "outputs/candidate.json"}],
        )
        payload = json.loads(event["body"])
        payload["config"]["deploymentProfileId"] = "unknown-profile"
        event["body"] = json.dumps(payload)

        result = START.handler(event, None)

        self.assertEqual(result["statusCode"], 400)
        self.assertIn("Unsupported deployment profile", result["body"])

    def test_pathology_benchmark_is_accepted(self):
        event = request(
            "uploaded-outputs",
            reference_outputs=[
                {"name": "reference.json", "key": "reference/reference.json"}
            ],
            ai_outputs=[
                {"name": "candidate.json", "key": "outputs/candidate.json"}
            ],
        )
        payload = json.loads(event["body"])
        payload["config"]["deploymentProfileId"] = "pathology-report"
        event["body"] = json.dumps(payload)

        result = START.handler(event, None)

        self.assertEqual(result["statusCode"], 202)


if __name__ == "__main__":
    unittest.main()
