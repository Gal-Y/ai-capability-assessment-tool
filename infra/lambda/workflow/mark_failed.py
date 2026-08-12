import json

from common import now_iso, update_evaluation_item, write_artifact


def get_failure_message(workflow_error):
    cause = workflow_error.get("Cause")

    if isinstance(cause, str) and cause.strip():
        try:
            cause_payload = json.loads(cause)
        except json.JSONDecodeError:
            return cause

        if isinstance(cause_payload, dict):
            return (
                cause_payload.get("errorMessage")
                or cause_payload.get("message")
                or cause
            )

    return workflow_error.get("Error") or "Workflow failed"


def handler(event, _context):
    failure_time = now_iso()
    workflow_error = event.get("workflowError", {})
    message = get_failure_message(workflow_error)

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
            "workflowStage": "FAILED",
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
