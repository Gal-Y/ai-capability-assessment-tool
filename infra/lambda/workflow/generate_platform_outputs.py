from common import now_iso, to_input_file_item, update_evaluation_item, write_artifact
from openai_client import create_response, extract_output_text


GENERATION_INSTRUCTIONS = """You generate concise enterprise-ready summaries from source documents.

Use only information supported by the source document and any supplied policy guidance.
Do not invent facts, hedge with unsupported claims, or mention the evaluation setup.
Return the final summary text only, with no markdown code fences or extra commentary."""


def build_generation_content(test_case, policy_text):
    content = [
        {
            "type": "input_text",
            "text": (
                "Summarise the attached source document for an enterprise user. "
                "Keep the summary concise, factual, and decision-useful."
            ),
        },
        {
            "type": "input_text",
            "text": "Source document:",
        },
        to_input_file_item(test_case["sourceDocuments"][0]),
    ]

    if test_case.get("policyFiles") or policy_text:
        content.append(
            {
                "type": "input_text",
                "text": (
                    "Additional policy guidance is attached below. Follow it when producing "
                    "the summary, but never add claims that are not supported by the source document."
                ),
            }
        )

    for policy_file in test_case.get("policyFiles", []):
        content.append(to_input_file_item(policy_file))

    if policy_text:
        content.append(
            {
                "type": "input_text",
                "text": f"Typed policy guidance:\n{policy_text}",
            }
        )

    return content


def handler(event, _context):
    update_evaluation_item(
        event["evaluationId"],
        {
            "status": "RUNNING",
            "workflowStage": "GENERATING_OUTPUTS",
            "updatedAt": now_iso(),
        },
    )

    config = event.get("config", {})
    policy_text = str(config.get("policyText", "")).strip()
    model_id = config.get("modelId", "gpt-5.4-mini")
    outputs = []
    total_generation_latency = 0.0
    total_input_tokens = 0
    total_output_tokens = 0
    total_tokens = 0

    for test_case in event.get("testCases", []):
        response_payload, latency_seconds = create_response(
            model=model_id,
            instructions=GENERATION_INSTRUCTIONS,
            input_content=build_generation_content(test_case, policy_text),
            max_output_tokens=1200,
            reasoning_effort="low",
            verbosity="low",
            metadata={
                "evaluation_id": event["evaluationId"],
                "case_id": test_case["caseId"],
                "phase": "generation",
            },
        )
        summary_text = extract_output_text(response_payload).strip()
        usage = response_payload.get("usage", {})

        total_generation_latency += latency_seconds
        total_input_tokens += int(usage.get("input_tokens", 0))
        total_output_tokens += int(usage.get("output_tokens", 0))
        total_tokens += int(usage.get("total_tokens", 0))

        outputs.append(
            {
                "caseId": test_case["caseId"],
                "source": "platform-model",
                "modelId": model_id,
                "summaryText": summary_text,
                "latencySeconds": round(latency_seconds, 3),
                "usage": {
                    "inputTokens": int(usage.get("input_tokens", 0)),
                    "outputTokens": int(usage.get("output_tokens", 0)),
                    "totalTokens": int(usage.get("total_tokens", 0)),
                },
                "status": "generated",
            }
        )

    payload = {
        "generatedAt": now_iso(),
        "modelId": model_id,
        "generationLatencySeconds": round(total_generation_latency, 3),
        "usage": {
            "inputTokens": total_input_tokens,
            "outputTokens": total_output_tokens,
            "totalTokens": total_tokens,
        },
        "outputs": outputs,
    }
    output_key = write_artifact(event, "workflow/platform-outputs.json", payload)

    return {
        **event,
        "resolvedOutputs": outputs,
        "resolvedOutputArtifactKey": output_key,
    }
