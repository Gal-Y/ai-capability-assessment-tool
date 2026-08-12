import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[2]


def response_payload(output_text, *, usage=None, incomplete_reason=None):
    payload = {
        "output_text": output_text,
        "usage": usage
        or {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
    }
    if incomplete_reason:
        payload["incomplete_details"] = {"reason": incomplete_reason}
    return payload


def load_generation_module(responses):
    common = types.ModuleType("common")
    common.now_iso = lambda: "2026-08-12T00:00:00Z"
    common.to_input_file_item = lambda file_ref: {
        "type": "input_file",
        "filename": file_ref["name"],
        "file_data": "data:text/plain;base64,ZmFrZQ==",
    }
    common.update_evaluation_item = lambda *_args, **_kwargs: None
    common.write_artifact = lambda *_args, **_kwargs: "workflow/platform-outputs.json"
    sys.modules["common"] = common

    openai_client = types.ModuleType("openai_client")
    calls = []

    def create_response(**kwargs):
        calls.append(kwargs)
        return responses.pop(0), 0.25

    def extract_output_text(payload):
        return payload["output_text"]

    def parse_json_output(payload):
        try:
            return json.loads(extract_output_text(payload))
        except json.JSONDecodeError as error:
            incomplete_reason = (payload.get("incomplete_details") or {}).get("reason")
            if incomplete_reason == "max_output_tokens":
                raise RuntimeError(
                    "OpenAI response was truncated after hitting max_output_tokens"
                ) from error
            raise RuntimeError(f"OpenAI returned invalid JSON: {error.msg}") from error

    openai_client.create_response = create_response
    openai_client.get_incomplete_reason = lambda payload: (
        payload.get("incomplete_details") or {}
    ).get("reason")
    openai_client.parse_json_output = parse_json_output
    sys.modules["openai_client"] = openai_client

    path = ROOT / "infra/lambda/workflow/generate_platform_outputs.py"
    spec = importlib.util.spec_from_file_location("workflow_generation", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, calls


def bundle(resource_id="patient-1"):
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [
            {
                "resource": {
                    "resourceType": "Patient",
                    "id": resource_id,
                }
            }
        ],
    }


def generation_args():
    return {
        "event": {"evaluationId": "eval-test"},
        "test_case": {"caseId": "case-1"},
        "model_id": "gpt-5.4-mini",
        "input_content": [{"type": "input_text", "text": "Synthetic case"}],
    }


class PlatformGenerationTests(unittest.TestCase):
    def test_generation_enforces_json_output_and_returns_canonical_bundle(self):
        module, calls = load_generation_module(
            [response_payload(json.dumps(bundle()))]
        )

        summary, latency, usage, attempts = module.generate_fhir_bundle_with_retry(
            **generation_args()
        )

        self.assertEqual(json.loads(summary), bundle())
        self.assertEqual(latency, 0.25)
        self.assertEqual(
            usage,
            {"inputTokens": 10, "outputTokens": 20, "totalTokens": 30},
        )
        self.assertEqual(attempts, 1)
        self.assertEqual(calls[0]["response_format"], {"type": "json_object"})
        self.assertEqual(calls[0]["max_output_tokens"], 3600)

    def test_missing_brace_retries_before_accepting_valid_bundle(self):
        malformed = (
            '{"resourceType":"Bundle","type":"collection","entry":['
            '{"resource":{"resourceType":"Specimen","id":"specimen-1"},'
            '{"resource":{"resourceType":"Patient","id":"patient-1"}}]}'
        )
        module, calls = load_generation_module(
            [
                response_payload(malformed),
                response_payload(
                    json.dumps(bundle("patient-retry")),
                    usage={"input_tokens": 11, "output_tokens": 21, "total_tokens": 32},
                ),
            ]
        )

        summary, latency, usage, attempts = module.generate_fhir_bundle_with_retry(
            **generation_args()
        )

        self.assertEqual(json.loads(summary), bundle("patient-retry"))
        self.assertEqual(attempts, 2)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]["max_output_tokens"], 6000)
        self.assertEqual(calls[1]["metadata"]["attempt"], "2")
        self.assertEqual(latency, 0.5)
        self.assertEqual(
            usage,
            {"inputTokens": 21, "outputTokens": 41, "totalTokens": 62},
        )

    def test_two_invalid_responses_fail_before_semantic_scoring(self):
        module, _calls = load_generation_module(
            [response_payload("{"), response_payload("{")]
        )

        with self.assertRaisesRegex(
            RuntimeError,
            "did not return a valid FHIR Bundle after 2 attempts",
        ):
            module.generate_fhir_bundle_with_retry(**generation_args())

    def test_non_bundle_json_is_retried(self):
        module, calls = load_generation_module(
            [
                response_payload('{"resourceType":"Patient","id":"patient-1"}'),
                response_payload(json.dumps(bundle())),
            ]
        )

        _summary, _latency, _usage, attempts = module.generate_fhir_bundle_with_retry(
            **generation_args()
        )

        self.assertEqual(attempts, 2)
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
