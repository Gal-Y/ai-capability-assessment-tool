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

    for index, document in enumerate(event.get("documents", []), start=1):
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
