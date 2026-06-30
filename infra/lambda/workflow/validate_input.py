from common import now_iso, update_evaluation_item, write_artifact


def classify_file(file_ref):
    name = str(file_ref.get("name", "")).lower()
    key = str(file_ref.get("key", "")).lower()
    value = f"{name} {key}"

    if name.endswith((".cda", ".ccda")) or "cda" in value or "ccda" in value:
        return "HL7_CDA"
    if name.endswith(".xml"):
        return "HL7_CDA_OR_XML"
    if name.endswith(".pdf"):
        return "CLINICAL_PDF"
    if name.endswith(".json"):
        return "FHIR_JSON"
    if name.endswith((".txt", ".md", ".csv")):
        return "TEXT"

    return "UNKNOWN"


def build_input_profile(event):
    documents = event.get("documents", [])
    reference_outputs = event.get("referenceOutputs", [])
    ai_outputs = event.get("aiOutputs", [])

    document_formats = [classify_file(file_ref) for file_ref in documents]
    reference_formats = [classify_file(file_ref) for file_ref in reference_outputs]
    output_formats = [classify_file(file_ref) for file_ref in ai_outputs]

    has_hl7_cda = any(format_name.startswith("HL7_CDA") for format_name in document_formats)
    has_fhir_reference = "FHIR_JSON" in reference_formats
    has_fhir_candidate = "FHIR_JSON" in output_formats

    return {
        "scope": "HL7_CDA_TO_FHIR_EVALUATION",
        "documentFormats": document_formats,
        "referenceFormats": reference_formats,
        "candidateOutputFormats": output_formats,
        "hasHl7CdaInput": has_hl7_cda,
        "hasFhirReference": has_fhir_reference,
        "hasFhirCandidateOutput": has_fhir_candidate,
        "expectedTargetStandard": "HL7 FHIR R4 JSON",
    }


def handler(event, _context):
    update_evaluation_item(
        event["evaluationId"],
        {
            "status": "RUNNING",
            "workflowStage": "VALIDATING_INPUT",
            "updatedAt": now_iso(),
        },
    )

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

    input_profile = build_input_profile(event)

    validation = {
        "validatedAt": now_iso(),
        "documentCount": len(documents),
        "referenceCount": len(reference_outputs),
        "policyCount": len(event.get("policyFiles", [])),
        "outputCount": len(event.get("aiOutputs", [])),
        "modelId": config.get("modelId"),
        "inputProfile": input_profile,
    }
    validation_key = write_artifact(event, "workflow/validation.json", validation)

    return {
        **event,
        "inputProfile": input_profile,
        "validation": validation,
        "validationArtifactKey": validation_key,
    }
