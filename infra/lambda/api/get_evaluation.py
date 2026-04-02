import os

import boto3

from common import response, to_jsonable

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["EVALUATIONS_TABLE"])


def handler(event, _context):
    evaluation_id = event.get("pathParameters", {}).get("evaluationId")

    if not evaluation_id:
        return response(400, {"message": "evaluationId is required"})

    item = table.get_item(Key={"evaluationId": evaluation_id}).get("Item")

    if not item:
        return response(404, {"message": "Evaluation not found"})

    return response(200, {"evaluation": to_jsonable(item)})
