from collections import Counter

from common import now_iso, to_input_file_item, update_evaluation_item, write_artifact
from openai_client import DEFAULT_EVALUATOR_MODEL, create_response, parse_json_output


THRESHOLDS = {
    "faithfulness": 92,
    "coverage": 86,
    "compliance": 90,
    "privacy": 96,
}

CASE_EVALUATION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "candidateSummary": {"type": "string"},
        "scores": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "faithfulness": {"type": "integer", "minimum": 0, "maximum": 100},
                "coverage": {"type": "integer", "minimum": 0, "maximum": 100},
                "compliance": {"type": "integer", "minimum": 0, "maximum": 100},
                "privacy": {"type": "integer", "minimum": 0, "maximum": 100},
            },
            "required": ["faithfulness", "coverage", "compliance", "privacy"],
        },
        "strengths": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 3,
        },
        "missingPoints": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5,
        },
        "issues": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5,
        },
        "policyFindings": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5,
        },
    },
    "required": [
        "candidateSummary",
        "scores",
        "strengths",
        "missingPoints",
        "issues",
        "policyFindings",
    ],
}

CASE_EVALUATION_FORMAT = {
    "type": "json_schema",
    "name": "document_summary_case_evaluation",
    "strict": True,
    "schema": CASE_EVALUATION_SCHEMA,
}

CASE_EVALUATION_INSTRUCTIONS = """You grade enterprise document summaries.

Scoring rules:
- Use the source document as the ground truth for faithfulness.
- Use the reference output to understand what a strong summary should cover, but do not require exact wording.
- Use any supplied policy files or typed policy guidance as extra compliance constraints.
- The candidate summary may be provided as plain text or as an attached file. If it is a file, read it first and evaluate the readable summary text it contains.
- Be strict about hallucinations, contradictions, and misleading omissions.
- Return integer scores on a 0 to 100 scale, where 100 is best. Do not use a 1 to 10 scale.
- Keep findings short and concrete.

Return valid JSON only."""


def average(values):
    return round(sum(values) / len(values), 2) if values else 0.0


def dedupe_ordered(items, limit):
    seen = set()
    ordered = []

    for item in items:
        normalized = item.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
        if len(ordered) >= limit:
            break

    return ordered


def normalize_case_scores(raw_scores):
    scores = {
        "faithfulness": int(raw_scores["faithfulness"]),
        "coverage": int(raw_scores["coverage"]),
        "compliance": int(raw_scores["compliance"]),
        "privacy": int(raw_scores["privacy"]),
    }

    if scores and max(scores.values()) <= 10:
        scores = {name: value * 10 for name, value in scores.items()}

    return {
        name: max(0, min(100, value))
        for name, value in scores.items()
    }


def build_case_content(test_case, resolved_output, policy_text):
    content = [
        {
            "type": "input_text",
            "text": (
                "Evaluate the candidate summary against the source document, the approved "
                "reference output, and any optional policy guidance."
            ),
        },
        {
            "type": "input_text",
            "text": "Source document:",
        },
        to_input_file_item(test_case["sourceDocuments"][0]),
    ]

    if test_case.get("referenceOutputs"):
        content.append(
            {
                "type": "input_text",
                "text": "Approved reference output:",
            }
        )
        for reference_output in test_case["referenceOutputs"]:
            content.append(to_input_file_item(reference_output))

    if test_case.get("policyFiles") or policy_text:
        content.append(
            {
                "type": "input_text",
                "text": (
                    "Optional policy guidance follows. Use it only as additional constraints "
                    "for compliance/privacy; it does not replace the source document."
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

    if resolved_output["source"] == "platform-model":
        content.append(
            {
                "type": "input_text",
                "text": f"Candidate summary:\n{resolved_output['summaryText']}",
            }
        )
    else:
        uploaded_output = test_case.get("uploadedOutput")
        if not uploaded_output:
            raise ValueError(
                f"Uploaded output is missing for test case {test_case['caseId']}"
            )
        content.append(
            {
                "type": "input_text",
                "text": "Candidate summary file:",
            }
        )
        content.append(to_input_file_item(uploaded_output))

    return content


def top_case_findings(case_results):
    issue_counts = Counter()
    strength_counts = Counter()

    for case_result in case_results:
        for issue in case_result["issues"]:
            issue_counts[issue] += 1
        for missing_point in case_result["missingPoints"]:
            issue_counts[f"Missing: {missing_point}"] += 1
        for policy_finding in case_result["policyFindings"]:
            issue_counts[f"Policy: {policy_finding}"] += 1
        for strength in case_result["strengths"]:
            strength_counts[strength] += 1

    ordered_issues = [item for item, _count in issue_counts.most_common()]
    ordered_strengths = [item for item, _count in strength_counts.most_common()]
    return ordered_issues[:5], ordered_strengths[:5]


def build_decision(metrics):
    readiness_score = round(
        metrics["faithfulness"] * 0.35
        + metrics["coverage"] * 0.3
        + metrics["compliance"] * 0.2
        + metrics["privacy"] * 0.15,
        2,
    )

    passes = all(metrics[name] >= THRESHOLDS[name] for name in THRESHOLDS)
    near_pass = all(metrics[name] >= THRESHOLDS[name] - 4 for name in THRESHOLDS)

    if passes:
        decision = "Ready"
    elif near_pass:
        decision = "Conditional"
    else:
        decision = "Not Ready"

    return decision, readiness_score


def handler(event, _context):
    update_evaluation_item(
        event["evaluationId"],
        {
            "status": "RUNNING",
            "workflowStage": "SCORING",
            "updatedAt": now_iso(),
        },
    )

    config = event.get("config", {})
    policy_text = str(config.get("policyText", "")).strip()
    evaluator_model = config.get("evaluatorModel") or DEFAULT_EVALUATOR_MODEL
    resolved_outputs = {
        output["caseId"]: output for output in event.get("resolvedOutputs", [])
    }
    case_results = []
    evaluation_input_tokens = 0
    evaluation_output_tokens = 0
    evaluation_total_tokens = 0
    evaluation_latency_seconds = 0.0
    generation_latency_seconds = 0.0
    generation_input_tokens = 0
    generation_output_tokens = 0
    generation_total_tokens = 0

    for test_case in event.get("testCases", []):
        resolved_output = resolved_outputs.get(test_case["caseId"])
        if not resolved_output:
            raise ValueError(f"No resolved output found for {test_case['caseId']}")

        response_payload, case_latency_seconds = create_response(
            model=evaluator_model,
            instructions=CASE_EVALUATION_INSTRUCTIONS,
            input_content=build_case_content(test_case, resolved_output, policy_text),
            response_format=CASE_EVALUATION_FORMAT,
            max_output_tokens=1800,
            reasoning_effort="medium",
            metadata={
                "evaluation_id": event["evaluationId"],
                "case_id": test_case["caseId"],
                "phase": "evaluation",
            },
        )
        evaluation = parse_json_output(response_payload)
        normalized_scores = normalize_case_scores(evaluation["scores"])
        usage = response_payload.get("usage", {})

        evaluation_latency_seconds += case_latency_seconds
        evaluation_input_tokens += int(usage.get("input_tokens", 0))
        evaluation_output_tokens += int(usage.get("output_tokens", 0))
        evaluation_total_tokens += int(usage.get("total_tokens", 0))

        if resolved_output["source"] == "platform-model":
            generation_latency_seconds += float(resolved_output.get("latencySeconds", 0))
            generation_usage = resolved_output.get("usage", {})
            generation_input_tokens += int(generation_usage.get("inputTokens", 0))
            generation_output_tokens += int(generation_usage.get("outputTokens", 0))
            generation_total_tokens += int(generation_usage.get("totalTokens", 0))

        case_results.append(
            {
                "caseId": test_case["caseId"],
                "sourceDocument": test_case["sourceDocuments"][0]["name"],
                "referenceOutput": (
                    test_case["referenceOutputs"][0]["name"]
                    if test_case.get("referenceOutputs")
                    else None
                ),
                "candidateSummary": evaluation["candidateSummary"].strip(),
                "source": resolved_output["source"],
                "modelId": resolved_output.get("modelId"),
                "metrics": normalized_scores,
                "strengths": dedupe_ordered(evaluation["strengths"], 3),
                "missingPoints": dedupe_ordered(evaluation["missingPoints"], 5),
                "issues": dedupe_ordered(evaluation["issues"], 5),
                "policyFindings": dedupe_ordered(evaluation["policyFindings"], 5),
                "generationLatencySeconds": (
                    round(float(resolved_output.get("latencySeconds", 0)), 3)
                    if resolved_output["source"] == "platform-model"
                    else None
                ),
                "evaluationLatencySeconds": round(case_latency_seconds, 3),
            }
        )

    metrics = {
        "faithfulness": average(
            [case["metrics"]["faithfulness"] for case in case_results]
        ),
        "coverage": average([case["metrics"]["coverage"] for case in case_results]),
        "compliance": average([case["metrics"]["compliance"] for case in case_results]),
        "privacy": average([case["metrics"]["privacy"] for case in case_results]),
        "latency": (
            round(generation_latency_seconds / len(case_results), 2)
            if event.get("outputSource") == "platform-model" and case_results
            else None
        ),
    }
    decision, readiness_score = build_decision(metrics)
    issues, strengths = top_case_findings(case_results)

    if metrics["faithfulness"] < THRESHOLDS["faithfulness"]:
        issues.insert(
            0,
            "Candidate summaries are not consistently faithful to the source documents.",
        )
    if metrics["coverage"] < THRESHOLDS["coverage"]:
        issues.insert(
            0,
            "Candidate summaries are missing important points from the benchmark outputs.",
        )
    if metrics["compliance"] < THRESHOLDS["compliance"]:
        issues.insert(
            0,
            "Candidate summaries do not consistently follow the requested constraints.",
        )
    if metrics["privacy"] < THRESHOLDS["privacy"]:
        issues.insert(
            0,
            "Candidate summaries need stronger handling of sensitive or identifying details.",
        )

    result = {
        "scoredAt": now_iso(),
        "decision": decision,
        "readinessScore": readiness_score,
        "metrics": metrics,
        "issues": dedupe_ordered(issues, 6),
        "strengths": dedupe_ordered(strengths, 5),
        "evaluatorModel": evaluator_model,
        "processingSeconds": round(
            generation_latency_seconds + evaluation_latency_seconds, 3
        ),
        "tokenUsage": {
            "generation": {
                "inputTokens": generation_input_tokens,
                "outputTokens": generation_output_tokens,
                "totalTokens": generation_total_tokens,
            },
            "evaluation": {
                "inputTokens": evaluation_input_tokens,
                "outputTokens": evaluation_output_tokens,
                "totalTokens": evaluation_total_tokens,
            },
            "total": {
                "inputTokens": generation_input_tokens + evaluation_input_tokens,
                "outputTokens": generation_output_tokens + evaluation_output_tokens,
                "totalTokens": generation_total_tokens + evaluation_total_tokens,
            },
        },
        "caseResults": case_results,
    }
    result_key = write_artifact(event, "workflow/result-summary.json", result)

    return {
        **event,
        "result": result,
        "resultArtifactKey": result_key,
    }
