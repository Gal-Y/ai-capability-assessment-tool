from common import now_iso, write_artifact


def handler(event, _context):
    output_source = event.get("outputSource")
    documents = event.get("documents", [])
    reference_outputs = event.get("referenceOutputs", [])
    config = event.get("config", {})

    if output_source not in {"platform-model", "uploaded-outputs"}:
        raise ValueError("Unsupported outputSource")

    if not documents:
        raise ValueError("At least one document is required")

    if not reference_outputs:
        raise ValueError("At least one reference output is required")

    if output_source == "platform-model" and not str(config.get("modelId", "")).strip():
        raise ValueError("Platform-model mode requires config.modelId")

    if output_source == "uploaded-outputs":
        ai_outputs = event.get("aiOutputs", [])

        if not ai_outputs:
            raise ValueError("Uploaded output mode requires aiOutputs")
        if len(ai_outputs) != len(documents):
            raise ValueError("Upload exactly one AI output for each source document")

    validation = {
        "validatedAt": now_iso(),
        "documentCount": len(documents),
        "referenceCount": len(reference_outputs),
        "policyCount": len(event.get("policyFiles", [])),
        "outputCount": len(event.get("aiOutputs", [])),
        "modelId": config.get("modelId"),
    }
    validation_key = write_artifact(event, "workflow/validation.json", validation)

    return {
        **event,
        "validation": validation,
        "validationArtifactKey": validation_key,
    }
