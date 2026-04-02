from common import now_iso, write_artifact


def handler(event, _context):
    outputs = []

    for test_case in event.get("testCases", []):
        outputs.append(
            {
                "caseId": test_case["caseId"],
                "source": "uploaded-outputs",
                "uploadedOutput": test_case.get("uploadedOutput"),
                "status": "loaded",
            }
        )

    payload = {
        "loadedAt": now_iso(),
        "outputs": outputs,
    }
    output_key = write_artifact(event, "workflow/uploaded-outputs.json", payload)

    return {
        **event,
        "resolvedOutputs": outputs,
        "resolvedOutputArtifactKey": output_key,
    }
