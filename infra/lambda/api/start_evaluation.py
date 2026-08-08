import json
import os
from datetime import datetime, timezone
from uuid import uuid4

import boto3

from common import parse_body, response

dynamodb = boto3.resource("dynamodb")
stepfunctions = boto3.client("stepfunctions")
table = dynamodb.Table(os.environ["EVALUATIONS_TABLE"])
workflow_arn = os.environ["EVALUATION_WORKFLOW_ARN"]


def handler(event, _context):
    payload = parse_body(event)

    capability = payload.get("capability") or "document_summarisation"
    output_source = payload.get("outputSource")
    documents = payload.get("documents", [])
    reference_outputs = payload.get("referenceOutputs", [])
    policy_files = payload.get("policyFiles", [])
    ai_outputs = payload.get("aiOutputs", [])
    config = payload.get("config", {})

    if output_source not in {"platform-model", "uploaded-outputs"}:
        return response(400, {"message": "outputSource must be provided"})

    if not documents:
        return response(400, {"message": "At least one document is required"})

    if output_source == "uploaded-outputs" and not reference_outputs:
        return response(
            400,
            {"message": "Uploaded-output mode requires at least one reference output"},
        )

    if output_source == "uploaded-outputs" and not ai_outputs:
        return response(400, {"message": "Uploaded AI outputs are required"})

    evaluation_id = payload.get("evaluationId") or f"eval-{uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    item = {
        "evaluationId": evaluation_id,
        "createdAt": now,
        "updatedAt": now,
        "status": "RUNNING",
        "workflowStage": "QUEUED",
        "capability": capability,
        "outputSource": output_source,
        "documents": documents,
        "referenceOutputs": reference_outputs,
        "policyFiles": policy_files,
        "aiOutputs": ai_outputs,
        "config": config,
    }

    table.put_item(Item=item)

    workflow_input = {
        "evaluationId": evaluation_id,
        "createdAt": now,
        "capability": capability,
        "outputSource": output_source,
        "documents": documents,
        "referenceOutputs": reference_outputs,
        "policyFiles": policy_files,
        "aiOutputs": ai_outputs,
        "config": config,
        "artifactPrefix": f"evaluations/{evaluation_id}",
    }

    stepfunctions.start_execution(
        stateMachineArn=workflow_arn,
        name=f"{evaluation_id}-{uuid4().hex[:8]}",
        input=json.dumps(workflow_input),
    )

    return response(
        202,
        {
            "evaluationId": evaluation_id,
            "status": "RUNNING",
            "workflowStage": "QUEUED",
        },
    )
