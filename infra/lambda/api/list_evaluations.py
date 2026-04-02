import os

import boto3

from common import response, to_jsonable

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["EVALUATIONS_TABLE"])


def handler(_event, _context):
    items = table.scan().get("Items", [])
    items = sorted(items, key=lambda item: item.get("createdAt", ""), reverse=True)
    return response(200, {"evaluations": to_jsonable(items)})
