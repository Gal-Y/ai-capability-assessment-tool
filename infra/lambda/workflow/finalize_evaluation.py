from common import now_iso, to_dynamodb, update_evaluation_item, write_artifact


def handler(event, _context):
    result = event.get("result", {})
    completion_time = now_iso()
    report_payload = {
        "evaluationId": event["evaluationId"],
        "completedAt": completion_time,
        "capability": event.get("capability"),
        "outputSource": event.get("outputSource"),
        "documents": event.get("documents", []),
        "referenceOutputs": event.get("referenceOutputs", []),
        "policyFiles": event.get("policyFiles", []),
        "aiOutputs": event.get("aiOutputs", []),
        "config": event.get("config", {}),
        "result": result,
    }
    report_key = write_artifact(event, "reports/final-report.json", report_payload)

    update_evaluation_item(
        event["evaluationId"],
        {
            "status": "COMPLETED",
            "workflowStage": "COMPLETED",
            "updatedAt": completion_time,
            "documentCount": len(event.get("documents", [])),
            "referenceCount": len(event.get("referenceOutputs", [])),
            "policyCount": len(event.get("policyFiles", [])),
            "outputCount": len(event.get("aiOutputs", []))
            if event.get("outputSource") == "uploaded-outputs"
            else len(event.get("documents", [])),
            "result": to_dynamodb(result),
            "resultArtifactKey": report_key,
        },
    )

    return {
        **event,
        "completedAt": completion_time,
        "reportKey": report_key,
        "status": "COMPLETED",
    }
