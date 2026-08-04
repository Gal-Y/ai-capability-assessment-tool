from common import now_iso, update_evaluation_item, write_artifact


def handler(event, _context):
    update_evaluation_item(
        event["evaluationId"],
        {
            "status": "RUNNING",
            "workflowStage": "BUILDING_CASES",
            "updatedAt": now_iso(),
        },
    )

    test_cases = []
    reference_outputs = event.get("referenceOutputs", [])
    policy_files = event.get("policyFiles", [])
    ai_outputs = event.get("aiOutputs", [])
    input_profile = event.get("inputProfile", {})
    document_formats = input_profile.get("documentFormats", [])
    reference_formats = input_profile.get("referenceFormats", [])
    candidate_output_formats = input_profile.get("candidateOutputFormats", [])
    config = event.get("config", {})
    documents = event.get("documents", [])
    bundle_mode = (
        config.get("caseMode") == "clinical-bundle"
        or (len(documents) > 1 and len(ai_outputs) <= 1)
    )

    if bundle_mode:
        source_formats = [
            document_formats[index] if index < len(document_formats) else "UNKNOWN"
            for index, _document in enumerate(documents)
        ]
        test_cases.append(
            {
                "caseId": "case-001",
                "sourceDocuments": documents,
                "referenceOutputs": reference_outputs,
                "policyFiles": policy_files,
                "uploadedOutput": ai_outputs[0] if ai_outputs else None,
                "inputProfile": {
                    "scope": input_profile.get(
                        "scope", "HL7_CDA_TO_FHIR_EVALUATION"
                    ),
                    "caseMode": "clinical-bundle",
                    "sourceFormat": " + ".join(source_formats),
                    "sourceFormats": source_formats,
                    "referenceFormat": (
                        " + ".join(reference_formats)
                        if reference_formats
                        else "UNKNOWN"
                    ),
                    "candidateOutputFormat": (
                        candidate_output_formats[0]
                        if candidate_output_formats
                        else "PLATFORM_GENERATED_FHIR_JSON"
                    ),
                    "expectedTargetStandard": input_profile.get(
                        "expectedTargetStandard",
                        "HL7 FHIR R4 JSON",
                    ),
                },
            }
        )

    for index, document in enumerate([] if bundle_mode else documents, start=1):
        mapped_output = ai_outputs[index - 1] if index - 1 < len(ai_outputs) else None
        reference_output = (
            reference_outputs[index - 1]
            if index - 1 < len(reference_outputs)
            else reference_outputs[0]
        )
        test_cases.append(
            {
                "caseId": f"case-{index:03d}",
                "sourceDocuments": [document],
                "referenceOutputs": [reference_output] if reference_output else [],
                "policyFiles": policy_files,
                "uploadedOutput": mapped_output,
                "inputProfile": {
                    "scope": input_profile.get("scope", "HL7_CDA_TO_FHIR_EVALUATION"),
                    "sourceFormat": (
                        document_formats[index - 1]
                        if index - 1 < len(document_formats)
                        else "UNKNOWN"
                    ),
                    "referenceFormat": (
                        reference_formats[index - 1]
                        if index - 1 < len(reference_formats)
                        else (
                            reference_formats[0]
                            if reference_formats
                            else "UNKNOWN"
                        )
                    ),
                    "candidateOutputFormat": (
                        candidate_output_formats[index - 1]
                        if index - 1 < len(candidate_output_formats)
                        else "UNKNOWN"
                    ),
                    "expectedTargetStandard": input_profile.get(
                        "expectedTargetStandard",
                        "HL7 FHIR R4 JSON",
                    ),
                },
            }
        )

    payload = {
        "builtAt": now_iso(),
        "testCaseCount": len(test_cases),
        "testCases": test_cases,
    }
    test_case_key = write_artifact(event, "workflow/test-cases.json", payload)

    return {
        **event,
        "testCases": test_cases,
        "testCaseArtifactKey": test_case_key,
    }
