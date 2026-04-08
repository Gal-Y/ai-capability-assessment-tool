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

EVALUATION_RULES = {
    "include_key_numeric_facts": {
        "label": "Include key numeric facts",
        "evaluation_instruction": (
            "The summary should preserve the material numeric facts, entitlements, limits, "
            "and response times from the source/reference."
        ),
        "type": "numeric_coverage",
    },
    "redact_contact_details": {
        "label": "Redact contact details",
        "evaluation_instruction": (
            "The summary must not include direct contact details such as email addresses, "
            "phone numbers, URLs, or similar contact endpoints."
        ),
        "type": "redact_contact_details",
    },
    "use_required_sections": {
        "label": "Use required sections",
        "evaluation_instruction": (
            "The summary should include clear sections for Key points, Notice requirements, "
            "Approval process, and Escalation."
        ),
        "type": "required_sections",
        "sections": [
            {"label": "Key points", "keywords": ["key points", "key takeaways"]},
            {"label": "Notice requirements", "keywords": ["notice requirements", "notice"]},
            {"label": "Approval process", "keywords": ["approval process", "approvals"]},
            {"label": "Escalation", "keywords": ["escalation", "escalate"]},
        ],
    },
}

SENSITIVE_PATTERNS = {
    "email address": r"\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b",
    "phone number": r"(?:\+?\d[\d ()-]{7,}\d)",
    "url": r"\b(?:https?://|www\.)\S+\b",
    "long numeric identifier": r"\b\d{7,}\b",
}

CONTACT_DETAIL_LABELS = {"email address", "phone number", "url"}

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
        "metricReasons": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "faithfulness": {
                    "type": "array",
                    "items": {"type": "string"},
                    "maxItems": 3,
                },
                "coverage": {
                    "type": "array",
                    "items": {"type": "string"},
                    "maxItems": 3,
                },
                "compliance": {
                    "type": "array",
                    "items": {"type": "string"},
                    "maxItems": 3,
                },
                "privacy": {
                    "type": "array",
                    "items": {"type": "string"},
                    "maxItems": 3,
                },
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
        "metricReasons",
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
- Score exactly four metrics: faithfulness, coverage, compliance, and privacy.
- For each metric, return 1 to 3 short reason bullets in metricReasons explaining why that score was assigned.
- Use the source document as the ground truth for faithfulness.
- Use the reference output to understand what a strong summary should cover, but do not require exact wording.
- Use any supplied policy files and structured evaluation rules as extra compliance/privacy constraints.
- The candidate summary may be provided as plain text or as an attached file. If it is a file, read it first and evaluate the readable summary text it contains.
- Be strict about hallucinations, contradictions, and misleading omissions.
- Do not infer privacy violations unless the candidate summary actually contains or clearly implies disallowed details. Mentions of roles, teams, or systems without a direct email, phone number, URL, identifier, or equivalent contact detail should not by themselves count as privacy violations.
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


def get_selected_evaluation_rules(config):
    raw_rules = config.get("evaluationRules", [])

    if not isinstance(raw_rules, list):
        return []

    seen = set()
    ordered = []

    for item in raw_rules:
        rule_id = str(item).strip()
        if not rule_id or rule_id in seen or rule_id not in EVALUATION_RULES:
            continue
        seen.add(rule_id)
        ordered.append(rule_id)

    return ordered


def build_evaluation_rule_guidance(rule_ids):
    if not rule_ids:
        return None

    return "Structured evaluation rules:\n" + "\n".join(
        f"- {EVALUATION_RULES[rule_id]['evaluation_instruction']}"
        for rule_id in rule_ids
    )


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


def normalize_sensitive_value(label, value):
    cleaned = value.strip().rstrip(".,;:")

    if label == "email address":
        return cleaned.lower()
    if label == "phone number":
        return re.sub(r"\D", "", cleaned)
    if label == "url":
        normalized = cleaned.lower()
        normalized = re.sub(r"^https?://", "", normalized)
        normalized = re.sub(r"^www\.", "", normalized)
        return normalized.rstrip("/")
    if label == "long numeric identifier":
        return re.sub(r"\D", "", cleaned)

    return cleaned.lower()


def extract_sensitive_items(text):
    items = []
    seen = set()

    for label, pattern in SENSITIVE_PATTERNS.items():
        for match in re.finditer(pattern, text, re.IGNORECASE):
            display = match.group(0).strip().rstrip(".,;:")
            normalized_value = normalize_sensitive_value(label, display)
            if not normalized_value:
                continue

            key = f"{label}|{normalized_value}"
            if key in seen:
                continue

            seen.add(key)
            items.append(
                {
                    "label": label,
                    "display": display,
                    "key": key,
                }
            )

    return items


def find_section_matches(candidate_text, rule_definition):
    lowered_candidate = candidate_text.lower()
    matched = []
    missing = []

    for section in rule_definition.get("sections", []):
        if any(keyword in lowered_candidate for keyword in section["keywords"]):
            matched.append(section["label"])
        else:
            missing.append(section["label"])

    return matched, missing


def build_deterministic_case_assessment(
    source_text,
    reference_text,
    candidate_text,
    evaluation_rule_ids,
):
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

    source_sensitive_items = extract_sensitive_items(source_text)
    reference_sensitive_items = extract_sensitive_items(reference_text)
    candidate_sensitive_items = extract_sensitive_items(candidate_text)

    allowed_sensitive_keys = {
        item["key"] for item in source_sensitive_items + reference_sensitive_items
    }
    redact_contact_details = "redact_contact_details" in evaluation_rule_ids

    privacy_violations = []
    for item in candidate_sensitive_items:
        if item["label"] == "long numeric identifier":
            privacy_violations.append(item)
            continue

        if item["label"] in CONTACT_DETAIL_LABELS:
            if redact_contact_details or item["key"] not in allowed_sensitive_keys:
                privacy_violations.append(item)

    privacy_flags = dedupe_ordered(
        [f"{item['label']}: {item['display']}" for item in privacy_violations],
        8,
    )

    rule_passes = []
    required_rule_misses = []
    forbidden_rule_hits = []

    if "include_key_numeric_facts" in evaluation_rule_ids:
        required_numeric_facts = reference_facts or source_facts
        missing_numeric_rule_facts = [
            fact["display"]
            for fact in required_numeric_facts
            if fact["key"] not in candidate_fact_keys
        ]
        matched_numeric_rule_facts = [
            fact["display"]
            for fact in required_numeric_facts
            if fact["key"] in candidate_fact_keys
        ]

        if missing_numeric_rule_facts:
            required_rule_misses.append(
                "Include key numeric facts: "
                + ", ".join(dedupe_ordered(missing_numeric_rule_facts, 4))
            )
        else:
            rule_passes.append(
                "Include key numeric facts"
                + (
                    f" ({len(dedupe_ordered(matched_numeric_rule_facts, 12))} matched)"
                    if matched_numeric_rule_facts
                    else ""
                )
            )

    if "use_required_sections" in evaluation_rule_ids:
        matched_sections, missing_sections = find_section_matches(
            candidate_text, EVALUATION_RULES["use_required_sections"]
        )
        if missing_sections:
            required_rule_misses.append(
                "Use required sections: " + ", ".join(missing_sections)
            )
        else:
            rule_passes.append(
                "Use required sections"
                + (f" ({', '.join(matched_sections)})" if matched_sections else "")
            )

    if redact_contact_details:
        if privacy_flags:
            forbidden_rule_hits.extend(
                [f"Redact contact details: {flag}" for flag in privacy_flags]
            )
        else:
            rule_passes.append("Redact contact details")

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

    compliance_score = 100.0

    if "include_key_numeric_facts" in evaluation_rule_ids:
        required_numeric_facts = reference_facts or source_facts
        if required_numeric_facts:
            matched_required_numeric = len(
                {fact["key"] for fact in required_numeric_facts} & candidate_fact_keys
            )
            numeric_recall = matched_required_numeric / max(1, len({fact["key"] for fact in required_numeric_facts}))
            compliance_score -= (1 - numeric_recall) * 26

    if "use_required_sections" in evaluation_rule_ids:
        total_sections = len(EVALUATION_RULES["use_required_sections"]["sections"])
        matched_sections, _missing_sections = find_section_matches(
            candidate_text, EVALUATION_RULES["use_required_sections"]
        )
        section_recall = len(matched_sections) / max(1, total_sections)
        compliance_score -= (1 - section_recall) * 22

    if redact_contact_details and privacy_flags:
        compliance_score -= min(36, 18 * len(privacy_flags))

    privacy_score = 100 - (24 * len(privacy_flags))

    metrics = {
        "faithfulness": clamp_score(faithfulness_score),
        "coverage": clamp_score(coverage_score),
        "compliance": clamp_score(compliance_score),
        "privacy": clamp_score(privacy_score),
    }

    metric_reasons = {
        "faithfulness": dedupe_ordered(
            [
                (
                    f"Exact fact support: {len(matched_source_facts)} of "
                    f"{len(candidate_fact_keys)} extracted candidate facts matched the source."
                    if candidate_fact_keys
                    else "No numeric/date fact claims were extracted from the candidate summary."
                ),
                (
                    "Unverified exact facts: "
                    + ", ".join(dedupe_ordered(unsupported_candidate_facts, 3))
                    if unsupported_candidate_facts
                    else "No unsupported numeric/date facts were detected."
                ),
            ],
            3,
        ),
        "coverage": dedupe_ordered(
            [
                (
                    f"Reference fact recall: {len(reference_fact_keys & candidate_fact_keys)} "
                    f"of {len(reference_fact_keys)} extracted benchmark facts matched."
                    if reference_fact_keys
                    else "No exact benchmark facts were extracted from the reference output."
                ),
                (
                    f"Reference term recall: {len(matched_reference_keywords)} of "
                    f"{len(reference_keywords)} benchmark terms matched."
                    if reference_keywords
                    else "No benchmark keywords were extracted from the reference output."
                ),
                (
                    "Missing benchmark facts: "
                    + ", ".join(dedupe_ordered(missing_reference_facts, 3))
                    if missing_reference_facts
                    else "No benchmark fact misses were detected."
                ),
            ],
            3,
        ),
        "compliance": dedupe_ordered(
            [
                (
                    f"Configured rule passes: {len(rule_passes)}; rule misses: "
                    f"{len(required_rule_misses)}; rule violations: {len(forbidden_rule_hits)}."
                    if evaluation_rule_ids
                    else "No structured evaluation rules were configured for deterministic compliance."
                ),
                (
                    "Rule misses: "
                    + "; ".join(dedupe_ordered(required_rule_misses, 3))
                    if required_rule_misses
                    else (
                        "Rule passes: " + "; ".join(dedupe_ordered(rule_passes, 3))
                        if rule_passes
                        else "No rule misses were detected."
                    )
                ),
                (
                    "Rule violations: "
                    + "; ".join(dedupe_ordered(forbidden_rule_hits, 3))
                    if forbidden_rule_hits
                    else "No rule violations were detected."
                ),
            ],
            3,
        ),
        "privacy": dedupe_ordered(
            [
                (
                    "Detected privacy-sensitive patterns: "
                    + ", ".join(dedupe_ordered(privacy_flags, 4))
                    if privacy_flags
                    else (
                        "No disallowed emails, phone numbers, URLs, or long numeric identifiers were detected."
                    )
                ),
                (
                    "Direct contact details are only penalized when a redaction rule is active "
                    "or the detail was not supported by the source/reference."
                ),
            ],
            3,
        ),
    }

    return {
        "metrics": metrics,
        "metricReasons": metric_reasons,
        "checks": {
            "matchedSourceFacts": dedupe_ordered(matched_source_facts, 8),
            "unsupportedCandidateFacts": dedupe_ordered(unsupported_candidate_facts, 8),
            "missingReferenceFacts": dedupe_ordered(missing_reference_facts, 8),
            "matchedReferenceKeywords": matched_reference_keywords[:10],
            "missingReferenceKeywords": missing_reference_keywords[:10],
            "rulePasses": dedupe_ordered(rule_passes, 8),
            "requiredRuleMisses": dedupe_ordered(required_rule_misses, 8),
            "forbiddenRuleHits": dedupe_ordered(forbidden_rule_hits, 8),
            "privacyFlags": privacy_flags,
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


def score_case_with_retries(
    event,
    evaluator_model,
    test_case,
    resolved_output,
    evaluation_rule_ids,
    legacy_policy_text,
):
    attempts = [1200, 2200, 3600]
    total_latency_seconds = 0.0
    total_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    last_error = None

    for max_output_tokens in attempts:
        response_payload, latency_seconds = create_response(
            model=evaluator_model,
            instructions=CASE_EVALUATION_INSTRUCTIONS,
            input_content=build_case_content(
                test_case,
                resolved_output,
                evaluation_rule_ids,
                legacy_policy_text,
            ),
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


def build_case_content(
    test_case,
    resolved_output,
    evaluation_rule_ids,
    legacy_policy_text,
):
    content = [
        {
            "type": "input_text",
            "text": (
                "Evaluate the candidate summary against the source document, the approved "
                "reference output, and any configured rules or supporting policy context."
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

    rule_guidance = build_evaluation_rule_guidance(evaluation_rule_ids)
    typed_legacy_guidance = legacy_policy_text.strip() if legacy_policy_text else ""

    if test_case.get("policyFiles") or rule_guidance or typed_legacy_guidance:
        content.append(
            {
                "type": "input_text",
                "text": (
                    "Optional organisational constraints follow. Use uploaded policy files as "
                    "supporting context and apply any structured evaluation rules as "
                    "compliance/privacy constraints; they do not replace the source document."
                ),
            }
        )

    for policy_file in test_case.get("policyFiles", []):
        content.append(to_input_file_item(policy_file))

    if rule_guidance:
        content.append(
            {
                "type": "input_text",
                "text": rule_guidance,
            }
        )

    if typed_legacy_guidance and not evaluation_rule_ids:
        content.append(
            {
                "type": "input_text",
                "text": f"Legacy typed guidance:\n{typed_legacy_guidance}",
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


def aggregate_metric_reason_sets(case_results, field_name):
    aggregated = {}

    for metric_name in METRIC_WEIGHTS:
        reasons = []
        for case_result in case_results:
            reasons.extend(case_result.get(field_name, {}).get(metric_name, []))
        aggregated[metric_name] = dedupe_ordered(reasons, 5)

    return aggregated


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
    evaluation_rule_ids = get_selected_evaluation_rules(config)
    legacy_policy_text = str(config.get("policyText", "")).strip()
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
        evaluation, case_latency_seconds, case_usage = score_case_with_retries(
            event,
            evaluator_model,
            test_case,
            resolved_output,
            evaluation_rule_ids,
            legacy_policy_text,
        )
        semantic_metrics = normalize_case_scores(evaluation["scores"])
        deterministic_assessment = build_deterministic_case_assessment(
            source_text,
            reference_text,
            candidate_summary_text,
            evaluation_rule_ids,
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
                "semanticMetricReasons": {
                    metric_name: dedupe_ordered(
                        evaluation["metricReasons"].get(metric_name, []), 3
                    )
                    for metric_name in METRIC_WEIGHTS
                },
                "deterministicMetrics": deterministic_metrics,
                "deterministicMetricReasons": deterministic_assessment["metricReasons"],
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
    semantic_metric_reasons = aggregate_metric_reason_sets(
        case_results, "semanticMetricReasons"
    )
    deterministic_metric_reasons = aggregate_metric_reason_sets(
        case_results, "deterministicMetricReasons"
    )
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
        "semanticMetricReasons": semantic_metric_reasons,
        "deterministicMetrics": deterministic_metrics,
        "deterministicMetricReasons": deterministic_metric_reasons,
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
