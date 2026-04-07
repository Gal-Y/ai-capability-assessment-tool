from common import now_iso, update_evaluation_item, write_artifact


def handler(event, _context):
    failure_time = now_iso()
    workflow_error = event.get("workflowError", {})
    message = workflow_error.get("Cause") or workflow_error.get("Error") or "Workflow failed"

    failure_payload = {
        "failedAt": failure_time,
        "evaluationId": event.get("evaluationId"),
        "message": message,
        "workflowError": workflow_error,
    }
    failure_key = write_artifact(event, "workflow/failure.json", failure_payload)

    update_evaluation_item(
        event["evaluationId"],
        {
            "status": "FAILED",
            "updatedAt": failure_time,
            "error": message,
            "resultArtifactKey": failure_key,
        },
    )

    return {
        **event,
        "status": "FAILED",
        "failedAt": failure_time,
        "error": message,
        "resultArtifactKey": failure_key,
    }
