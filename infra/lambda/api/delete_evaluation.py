import os

import boto3

from common import response, to_jsonable

dynamodb = boto3.resource("dynamodb")
s3_client = boto3.client("s3")
table = dynamodb.Table(os.environ["EVALUATIONS_TABLE"])
ARTIFACTS_BUCKET = os.environ.get("ARTIFACTS_BUCKET")


def delete_artifacts(prefix):
    if not ARTIFACTS_BUCKET:
        return

    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=ARTIFACTS_BUCKET, Prefix=prefix):
        objects = page.get("Contents", [])
        if not objects:
            continue

        s3_client.delete_objects(
            Bucket=ARTIFACTS_BUCKET,
            Delete={
                "Objects": [{"Key": obj["Key"]} for obj in objects],
                "Quiet": True,
            },
        )


def handler(event, _context):
    evaluation_id = event.get("pathParameters", {}).get("evaluationId")

    if not evaluation_id:
        return response(400, {"message": "evaluationId is required"})

    item = table.get_item(Key={"evaluationId": evaluation_id}).get("Item")

    if not item:
        return response(404, {"message": "Evaluation not found"})

    if item.get("status") == "RUNNING":
        return response(
            409,
            {"message": "Running evaluations cannot be deleted"},
        )

    table.delete_item(Key={"evaluationId": evaluation_id})
    delete_artifacts(f"evaluations/{evaluation_id}/")

    return response(
        200,
        {"status": "DELETED", "evaluation": to_jsonable(item)},
    )
