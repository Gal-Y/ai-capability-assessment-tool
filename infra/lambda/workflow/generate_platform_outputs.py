from common import now_iso, to_input_file_item, update_evaluation_item, write_artifact
from openai_client import create_response, extract_output_text


GENERATION_INSTRUCTIONS = "summarise this document"

EVALUATION_RULE_PROMPTS = {
    "include_key_numeric_facts": "Include the key numeric facts, entitlements, limits, and response times when they are material to the summary.",
    "redact_contact_details": "Do not include direct contact details such as email addresses, phone numbers, URLs, or similar contact endpoints.",
    "use_required_sections": "Structure the summary with clear sections labelled Key points, Notice requirements, Approval process, and Escalation.",
}


def get_evaluation_rules(config):
    raw_rules = config.get("evaluationRules", [])

    if not isinstance(raw_rules, list):
        return []

    seen = set()
    ordered = []

    for item in raw_rules:
        rule_id = str(item).strip()
        if not rule_id or rule_id in seen or rule_id not in EVALUATION_RULE_PROMPTS:
            continue
        seen.add(rule_id)
        ordered.append(rule_id)

    return ordered


def build_generation_content(test_case, evaluation_rules, generation_instructions):
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

    if test_case.get("policyFiles") or evaluation_rules or generation_instructions:
        content.append(
            {
                "type": "input_text",
                "text": (
                    "Additional constraints and guidance follow. Apply any selected evaluation "
                    "rules when generating the summary, but never add claims that are not "
                    "supported by the source document."
                ),
            }
        )

    for policy_file in test_case.get("policyFiles", []):
        content.append(to_input_file_item(policy_file))

    if evaluation_rules:
        content.append(
            {
                "type": "input_text",
                "text": "Evaluation rules to satisfy:\n"
                + "\n".join(
                    f"- {EVALUATION_RULE_PROMPTS[rule_id]}"
                    for rule_id in evaluation_rules
                ),
            }
        )

    if generation_instructions:
        content.append(
            {
                "type": "input_text",
                "text": f"Additional generation instructions:\n{generation_instructions}",
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
    evaluation_rules = get_evaluation_rules(config)
    legacy_policy_text = str(config.get("policyText", "")).strip()
    generation_instructions = str(
        config.get("generationInstructions") or legacy_policy_text
    ).strip()
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
            input_content=build_generation_content(
                test_case, evaluation_rules, generation_instructions
            ),
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
