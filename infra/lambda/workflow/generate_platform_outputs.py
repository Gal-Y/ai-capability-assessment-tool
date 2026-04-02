from common import now_iso, write_artifact


def handler(event, _context):
    config = event.get("config", {})
    outputs = []

    for test_case in event.get("testCases", []):
        outputs.append(
            {
                "caseId": test_case["caseId"],
                "source": "platform-model",
                "modelId": config.get("modelId", "GPT-4.1 Mini"),
                "promptPreset": config.get("promptPreset", "Balanced"),
                "status": "generated",
            }
        )

    payload = {
        "generatedAt": now_iso(),
        "outputs": outputs,
    }
    output_key = write_artifact(event, "workflow/platform-outputs.json", payload)

    return {
        **event,
        "resolvedOutputs": outputs,
        "resolvedOutputArtifactKey": output_key,
    }
