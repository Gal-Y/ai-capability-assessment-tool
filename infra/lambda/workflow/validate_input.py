from common import now_iso, write_artifact


def handler(event, _context):
    output_source = event.get("outputSource")
    documents = event.get("documents", [])
    reference_outputs = event.get("referenceOutputs", [])

    if output_source not in {"platform-model", "uploaded-outputs"}:
        raise ValueError("Unsupported outputSource")

    if not documents:
        raise ValueError("At least one document is required")

    if not reference_outputs:
        raise ValueError("At least one reference output is required")

    if output_source == "uploaded-outputs" and not event.get("aiOutputs"):
        raise ValueError("Uploaded output mode requires aiOutputs")

    validation = {
        "validatedAt": now_iso(),
        "documentCount": len(documents),
        "referenceCount": len(reference_outputs),
        "policyCount": len(event.get("policyFiles", [])),
    }
    validation_key = write_artifact(event, "workflow/validation.json", validation)

    return {
        **event,
        "validation": validation,
        "validationArtifactKey": validation_key,
    }
