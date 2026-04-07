from collections import Counter
import re

from common import (
    extract_readable_text,
    now_iso,
    to_input_file_item,
    update_evaluation_item,
    write_artifact,
)
from openai_client import (
    DEFAULT_EVALUATOR_MODEL,
    create_response,
    get_incomplete_reason,
    parse_json_output,
)


THRESHOLDS = {
    "faithfulness": 92,
    "coverage": 86,
    "compliance": 90,
    "privacy": 96,
}

METRIC_WEIGHTS = {
    "faithfulness": 0.35,
    "coverage": 0.30,
    "compliance": 0.20,
    "privacy": 0.15,
}

JUDGE_WEIGHTS = {
    "semantic": 0.70,
    "deterministic": 0.30,
}

STOPWORDS = {
    "about",
    "after",
    "again",
    "against",
    "also",
    "annual",
    "apply",
    "approved",
    "because",
    "before",
    "being",
    "between",
    "business",
    "company",
    "document",
    "employee",
    "employees",
    "entitled",
    "leave",
    "manager",
    "must",
    "other",
    "policy",
    "request",
    "requests",
    "required",
    "should",
    "their",
    "there",
    "these",
    "this",
    "through",
    "under",
    "using",
    "within",
    "year",
    "years",
}

NUMBER_WORDS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
}

MONTH_PATTERN = (
    r"january|february|march|april|may|june|july|august|september|october|"
    r"november|december"
)

CASE_EVALUATION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
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


def clamp_score(value):
    return round(max(0.0, min(100.0, value)), 2)


def weighted_metric_score(metrics):
    return round(
        sum(metrics[name] * METRIC_WEIGHTS[name] for name in METRIC_WEIGHTS),
        2,
    )


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


def get_reference_text(test_case):
    if not test_case.get("referenceOutputs"):
        return None

    try:
        return extract_readable_text(test_case["referenceOutputs"][0])
    except Exception:
        return None


def get_candidate_summary_text(test_case, resolved_output):
    if resolved_output["source"] == "platform-model":
        return resolved_output["summaryText"].strip()

    uploaded_output = test_case.get("uploadedOutput")
    if not uploaded_output:
        return "Candidate summary preview unavailable."

    try:
        extracted = extract_readable_text(uploaded_output)
    except Exception:
        extracted = None

    return extracted or "Candidate summary preview unavailable for this file type."


def get_source_text(test_case):
    try:
        return extract_readable_text(test_case["sourceDocuments"][0]) or ""
    except Exception:
        return ""


def get_policy_guidance_text(test_case, policy_text):
    parts = []
    for policy_file in test_case.get("policyFiles", []):
        try:
            extracted = extract_readable_text(policy_file)
        except Exception:
            extracted = None
        if extracted:
            parts.append(extracted)

    if policy_text:
        parts.append(policy_text)

    return "\n\n".join(parts).strip()


def tokenize_text(text):
    return re.findall(r"[a-z][a-z0-9']+", text.lower())


def extract_keyword_set(text, limit=18):
    tokens = [
        token
        for token in tokenize_text(text)
        if len(token) >= 4 and token not in STOPWORDS and not token.isdigit()
    ]
    counts = Counter(tokens)
    return {
        token
        for token, _count in counts.most_common(limit)
    }


def normalize_number_token(token):
    normalized = token.lower().strip()
    if normalized in NUMBER_WORDS:
        return str(NUMBER_WORDS[normalized])
    return normalized


def normalize_unit(unit):
    normalized = unit.lower().strip()
    replacements = {
        "business day": "business_days",
        "business days": "business_days",
        "working day": "business_days",
        "working days": "business_days",
        "calendar day": "calendar_days",
        "calendar days": "calendar_days",
        "day": "days",
        "week": "weeks",
        "month": "months",
        "year": "years",
        "hour": "hours",
        "minute": "minutes",
        "percent": "%",
    }
    return replacements.get(normalized, normalized.replace(" ", "_"))


def extract_numeric_facts(text):
    lowered = text.lower()
    facts = []
    seen = set()

    number_unit_pattern = re.compile(
        r"\b(?P<value>\d+(?:\.\d+)?|"
        + "|".join(NUMBER_WORDS.keys())
        + r")\s+(?P<unit>business days?|working days?|calendar days?|days?|weeks?|months?|years?|hours?|minutes?|percent)\b"
    )
    percent_pattern = re.compile(r"\b(?P<value>\d+(?:\.\d+)?)\s*%")
    date_pattern = re.compile(
        rf"\b(?P<day>\d{{1,2}})\s+(?P<month>{MONTH_PATTERN})\s+(?P<year>\d{{4}})\b"
    )

    for pattern in (number_unit_pattern, percent_pattern):
        for match in pattern.finditer(lowered):
            value = normalize_number_token(match.group("value"))
            unit = "%" if "%" in match.group(0) else normalize_unit(match.group("unit"))
            key = f"{value}|{unit}"
            if key in seen:
                continue
            seen.add(key)
            facts.append(
                {
                    "key": key,
                    "display": match.group(0).strip(),
                }
            )

    for match in date_pattern.finditer(lowered):
        key = f"{match.group('year')}-{match.group('month')}-{match.group('day')}"
        if key in seen:
            continue
        seen.add(key)
        facts.append(
            {
                "key": key,
                "display": match.group(0).strip(),
            }
        )

    return facts


def extract_policy_rules(policy_guidance_text):
    lowered = policy_guidance_text.lower()
    forbidden = []
    required = []

    forbidden_patterns = [
        r"(?:do not|don't|avoid|exclude|never)\s+([^.\n;]+)",
    ]
    required_patterns = [
        r"(?:must include|include|with sections for)\s+([^.\n;]+)",
    ]

    def normalize_rule_fragment(fragment):
        fragment = re.sub(r"[^a-z0-9\s/-]", " ", fragment.lower())
        tokens = [
            token
            for token in fragment.split()
            if len(token) >= 3 and token not in STOPWORDS
        ]
        return " ".join(tokens[:5]).strip()

    for pattern in forbidden_patterns:
        for match in re.finditer(pattern, lowered):
            phrase = normalize_rule_fragment(match.group(1))
            if phrase:
                forbidden.append(phrase)

    for pattern in required_patterns:
        for match in re.finditer(pattern, lowered):
            phrase = normalize_rule_fragment(match.group(1))
            if phrase:
                required.append(phrase)

    return {
        "forbidden": dedupe_ordered(forbidden, 8),
        "required": dedupe_ordered(required, 8),
    }


def detect_privacy_flags(text):
    flags = []
    patterns = {
        "email address": r"\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b",
        "phone number": r"(?:\+?\d[\d ()-]{7,}\d)",
        "url": r"\b(?:https?://|www\.)\S+\b",
        "long numeric identifier": r"\b\d{7,}\b",
    }

    for label, pattern in patterns.items():
        if re.search(pattern, text, re.IGNORECASE):
            flags.append(label)

    return flags


def build_deterministic_case_assessment(source_text, reference_text, candidate_text, policy_guidance_text):
    source_facts = extract_numeric_facts(source_text)
    reference_facts = extract_numeric_facts(reference_text)
    candidate_facts = extract_numeric_facts(candidate_text)

    source_fact_keys = {fact["key"] for fact in source_facts}
    reference_fact_keys = {fact["key"] for fact in reference_facts}
    candidate_fact_keys = {fact["key"] for fact in candidate_facts}

    matched_source_facts = [
        fact["display"] for fact in candidate_facts if fact["key"] in source_fact_keys
    ]
    unsupported_candidate_facts = [
        fact["display"] for fact in candidate_facts if fact["key"] not in source_fact_keys
    ]
    missing_reference_facts = [
        fact["display"] for fact in reference_facts if fact["key"] not in candidate_fact_keys
    ]

    reference_keywords = extract_keyword_set(reference_text)
    candidate_keywords = set(tokenize_text(candidate_text))
    matched_reference_keywords = sorted(reference_keywords & candidate_keywords)
    missing_reference_keywords = sorted(reference_keywords - candidate_keywords)

    policy_rules = extract_policy_rules(policy_guidance_text) if policy_guidance_text else {
        "required": [],
        "forbidden": [],
    }
    lowered_candidate = candidate_text.lower()
    required_rule_misses = [
        phrase for phrase in policy_rules["required"] if phrase and phrase not in lowered_candidate
    ]
    forbidden_rule_hits = [
        phrase for phrase in policy_rules["forbidden"] if phrase and phrase in lowered_candidate
    ]
    privacy_flags = detect_privacy_flags(candidate_text)

    if candidate_fact_keys:
        fact_precision = len(matched_source_facts) / max(1, len(candidate_fact_keys))
        faithfulness_score = 40 + (fact_precision * 60)
    else:
        faithfulness_score = 90

    fact_recall = (
        len(reference_fact_keys & candidate_fact_keys) / len(reference_fact_keys)
        if reference_fact_keys
        else 1.0
    )
    keyword_recall = (
        len(matched_reference_keywords) / len(reference_keywords)
        if reference_keywords
        else 1.0
    )
    coverage_score = (fact_recall * 0.55 + keyword_recall * 0.45) * 100

    if policy_rules["required"] or policy_rules["forbidden"]:
        compliance_score = 100 - (18 * len(required_rule_misses)) - (22 * len(forbidden_rule_hits))
    else:
        compliance_score = 100

    privacy_score = 100 - (24 * len(privacy_flags))

    metrics = {
        "faithfulness": clamp_score(faithfulness_score),
        "coverage": clamp_score(coverage_score),
        "compliance": clamp_score(compliance_score),
        "privacy": clamp_score(privacy_score),
    }

    return {
        "metrics": metrics,
        "checks": {
            "matchedSourceFacts": dedupe_ordered(matched_source_facts, 8),
            "unsupportedCandidateFacts": dedupe_ordered(unsupported_candidate_facts, 8),
            "missingReferenceFacts": dedupe_ordered(missing_reference_facts, 8),
            "matchedReferenceKeywords": matched_reference_keywords[:10],
            "missingReferenceKeywords": missing_reference_keywords[:10],
            "requiredRuleMisses": dedupe_ordered(required_rule_misses, 8),
            "forbiddenRuleHits": dedupe_ordered(forbidden_rule_hits, 8),
            "privacyFlags": dedupe_ordered(privacy_flags, 8),
        },
    }


def blend_metric_sets(semantic_metrics, deterministic_metrics):
    return {
        name: clamp_score(
            semantic_metrics[name] * JUDGE_WEIGHTS["semantic"]
            + deterministic_metrics[name] * JUDGE_WEIGHTS["deterministic"]
        )
        for name in METRIC_WEIGHTS
    }


def merge_usage(total_usage, usage):
    total_usage["input_tokens"] += int(usage.get("input_tokens", 0))
    total_usage["output_tokens"] += int(usage.get("output_tokens", 0))
    total_usage["total_tokens"] += int(usage.get("total_tokens", 0))


def score_case_with_retries(event, evaluator_model, test_case, resolved_output, policy_text):
    attempts = [1200, 2200, 3600]
    total_latency_seconds = 0.0
    total_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    last_error = None

    for max_output_tokens in attempts:
        response_payload, latency_seconds = create_response(
            model=evaluator_model,
            instructions=CASE_EVALUATION_INSTRUCTIONS,
            input_content=build_case_content(test_case, resolved_output, policy_text),
            response_format=CASE_EVALUATION_FORMAT,
            max_output_tokens=max_output_tokens,
            reasoning_effort="medium",
            metadata={
                "evaluation_id": event["evaluationId"],
                "case_id": test_case["caseId"],
                "phase": "evaluation",
            },
        )
        total_latency_seconds += latency_seconds
        merge_usage(total_usage, response_payload.get("usage", {}))

        try:
            evaluation = parse_json_output(response_payload)
            return evaluation, total_latency_seconds, total_usage
        except RuntimeError as error:
            last_error = error
            should_retry = (
                get_incomplete_reason(response_payload) == "max_output_tokens"
                or "invalid JSON" in str(error)
            )
            if not should_retry or max_output_tokens == attempts[-1]:
                break

    raise RuntimeError(
        f"Evaluator response could not be parsed as structured JSON after retries: {last_error}"
    )


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
    readiness_score = weighted_metric_score(metrics)

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

        source_text = get_source_text(test_case)
        reference_text = get_reference_text(test_case) or ""
        candidate_summary_text = get_candidate_summary_text(test_case, resolved_output)
        policy_guidance_text = get_policy_guidance_text(test_case, policy_text)

        evaluation, case_latency_seconds, case_usage = score_case_with_retries(
            event,
            evaluator_model,
            test_case,
            resolved_output,
            policy_text,
        )
        semantic_metrics = normalize_case_scores(evaluation["scores"])
        deterministic_assessment = build_deterministic_case_assessment(
            source_text,
            reference_text,
            candidate_summary_text,
            policy_guidance_text,
        )
        deterministic_metrics = deterministic_assessment["metrics"]
        hybrid_metrics = blend_metric_sets(semantic_metrics, deterministic_metrics)

        evaluation_latency_seconds += case_latency_seconds
        evaluation_input_tokens += int(case_usage["input_tokens"])
        evaluation_output_tokens += int(case_usage["output_tokens"])
        evaluation_total_tokens += int(case_usage["total_tokens"])

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
                "referenceText": reference_text or None,
                "candidateSummary": candidate_summary_text,
                "source": resolved_output["source"],
                "modelId": resolved_output.get("modelId"),
                "metrics": hybrid_metrics,
                "semanticMetrics": semantic_metrics,
                "deterministicMetrics": deterministic_metrics,
                "deterministicChecks": deterministic_assessment["checks"],
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

    semantic_metrics = {
        "faithfulness": average(
            [case["semanticMetrics"]["faithfulness"] for case in case_results]
        ),
        "coverage": average(
            [case["semanticMetrics"]["coverage"] for case in case_results]
        ),
        "compliance": average(
            [case["semanticMetrics"]["compliance"] for case in case_results]
        ),
        "privacy": average(
            [case["semanticMetrics"]["privacy"] for case in case_results]
        ),
    }
    deterministic_metrics = {
        "faithfulness": average(
            [case["deterministicMetrics"]["faithfulness"] for case in case_results]
        ),
        "coverage": average(
            [case["deterministicMetrics"]["coverage"] for case in case_results]
        ),
        "compliance": average(
            [case["deterministicMetrics"]["compliance"] for case in case_results]
        ),
        "privacy": average(
            [case["deterministicMetrics"]["privacy"] for case in case_results]
        ),
    }
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
    semantic_composite = weighted_metric_score(semantic_metrics)
    deterministic_composite = weighted_metric_score(deterministic_metrics)
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
        "semanticMetrics": semantic_metrics,
        "deterministicMetrics": deterministic_metrics,
        "scoreBreakdown": {
            "judgeWeights": JUDGE_WEIGHTS,
            "metricWeights": METRIC_WEIGHTS,
            "semanticComposite": semantic_composite,
            "deterministicComposite": deterministic_composite,
            "hybridComposite": readiness_score,
            "formula": (
                "hybrid_metric = 0.70 * semantic_metric + 0.30 * deterministic_metric; "
                "final_score = 0.35 * faithfulness + 0.30 * coverage + "
                "0.20 * compliance + 0.15 * privacy"
            ),
        },
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
