from common import clamp, now_iso, stable_noise, write_artifact

THRESHOLDS = {
    "faithfulness": 92,
    "coverage": 86,
    "compliance": 90,
    "privacy": 96,
    "latency": 6,
}

MODEL_PROFILES = {
    "GPT-4.1 Mini": {"quality": 1.2, "latency": 2.4, "cost_per_document": 0.014},
    "GPT-4.1": {"quality": 3.1, "latency": 3.1, "cost_per_document": 0.032},
    "Claude 3.7 Sonnet": {"quality": 2.7, "latency": 3.6, "cost_per_document": 0.029},
}


def handler(event, _context):
    config = event.get("config", {})
    output_source = event.get("outputSource")
    seed = ":".join(
        [
            event["evaluationId"],
            output_source,
            str(len(event.get("documents", []))),
            str(len(event.get("referenceOutputs", []))),
            str(len(event.get("policyFiles", []))),
            config.get("modelId", "none"),
            config.get("promptPreset", "none"),
            config.get("audience", ""),
        ]
    )

    doc_boost = min(len(event.get("documents", [])) * 2.4, 10)
    reference_boost = min(len(event.get("referenceOutputs", [])) * 3.1, 9.3)
    policy_boost = min(len(event.get("policyFiles", [])) * 1.8, 4.5)
    output_coverage_ratio = (
        min(1, len(event.get("aiOutputs", [])) / max(1, len(event.get("documents", []))))
        if output_source == "uploaded-outputs"
        else 1
    )

    risk_level = config.get("riskLevel", "High")
    risk_penalty = 4.6 if risk_level == "High" else 2.1 if risk_level == "Medium" else 0
    output_style = config.get("outputStyle", "Executive brief")
    style_boost = (
        2.8
        if output_style == "Board-ready briefing"
        else 2.4
        if output_style == "Executive brief"
        else 2.1
        if output_style == "Structured bullet summary"
        else 1.5
    )
    audience_boost = 1.1 if config.get("audience") else 0
    model_profile = MODEL_PROFILES.get(config.get("modelId"), {"quality": 1.6, "latency": 2.8, "cost_per_document": 0.02})
    prompt_preset = config.get("promptPreset", "Balanced")
    prompt_boost = 1.8 if prompt_preset == "Strict" else 1.4 if prompt_preset == "Evidence-led" else 0.8

    faithfulness = clamp(
        81 + doc_boost * 0.45 + reference_boost * 1.05 + policy_boost * 0.35 + model_profile["quality"] + output_coverage_ratio * 2.6 - risk_penalty * 0.32 + stable_noise(seed, 1),
        70,
        99,
    )
    coverage = clamp(
        79 + doc_boost * 0.88 + reference_boost * 0.52 + output_coverage_ratio * 6 - (4.2 if config.get("maxWords", 220) < 140 else 0) + stable_noise(seed, 2),
        68,
        99,
    )
    compliance = clamp(
        84 + style_boost * 1.05 + policy_boost * 0.72 + prompt_boost + audience_boost - risk_penalty * 0.15 + stable_noise(seed, 3),
        70,
        99,
    )
    privacy = clamp(
        87 + reference_boost * 0.35 + policy_boost * 1.15 + model_profile["quality"] * 0.4 - risk_penalty * 0.48 + stable_noise(seed, 4),
        75,
        99,
    )
    latency = (
        clamp(
            model_profile["latency"] + len(event.get("documents", [])) * 0.52 + len(event.get("referenceOutputs", [])) * 0.12,
            1.8,
            8.2,
        )
        if output_source == "platform-model"
        else float(config["providedLatencySeconds"])
        if config.get("providedLatencySeconds")
        else None
    )

    cost_per_document = (
        round(model_profile["cost_per_document"] * (1 + len(event.get("documents", [])) * 0.06), 3)
        if output_source == "platform-model"
        else float(config["providedCostPerDocument"])
        if config.get("providedCostPerDocument")
        else None
    )

    readiness_score = (
        faithfulness * 0.31
        + coverage * 0.25
        + compliance * 0.2
        + privacy * 0.19
        + ((82 if latency is None else max(0, 100 - latency * 10)) * 0.05)
    )

    issues = []
    if faithfulness < THRESHOLDS["faithfulness"]:
        issues.append("Strengthen alignment against the source of truth.")
    if coverage < THRESHOLDS["coverage"]:
        issues.append("Increase document coverage or reduce output compression.")
    if compliance < THRESHOLDS["compliance"]:
        issues.append("Tighten the output instructions and response format.")
    if privacy < THRESHOLDS["privacy"]:
        issues.append("Add stronger handling for sensitive enterprise content.")
    if output_source == "uploaded-outputs" and len(event.get("aiOutputs", [])) != len(event.get("documents", [])):
        issues.append("Match one uploaded AI output to each source document.")
    if latency is not None and latency > THRESHOLDS["latency"]:
        issues.append("Latency is above the current operational threshold.")

    quality_pass = (
        faithfulness >= THRESHOLDS["faithfulness"]
        and coverage >= THRESHOLDS["coverage"]
        and compliance >= THRESHOLDS["compliance"]
        and privacy >= THRESHOLDS["privacy"]
    )
    latency_pass = latency is None or latency <= THRESHOLDS["latency"]

    decision = "Not Ready"
    if quality_pass and latency_pass:
        decision = "Ready"
    elif len(issues) <= 3 and privacy >= THRESHOLDS["privacy"] - 2:
        decision = "Conditional"

    result = {
        "scoredAt": now_iso(),
        "decision": decision,
        "readinessScore": round(readiness_score, 2),
        "metrics": {
            "faithfulness": round(faithfulness, 2),
            "coverage": round(coverage, 2),
            "compliance": round(compliance, 2),
            "privacy": round(privacy, 2),
            "latency": round(latency, 2) if latency is not None else None,
        },
        "costPerDocument": cost_per_document,
        "issues": issues[:4],
    }
    result_key = write_artifact(event, "workflow/result-summary.json", result)

    return {
        **event,
        "result": result,
        "resultArtifactKey": result_key,
    }
