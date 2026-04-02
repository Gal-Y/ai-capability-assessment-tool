from common import now_iso, write_artifact


def handler(event, _context):
    extracted_documents = []

    for index, document in enumerate(event.get("documents", []), start=1):
        extracted_documents.append(
            {
                "documentId": f"doc-{index:03d}",
                "name": document.get("name"),
                "sourceKey": document.get("key"),
                "artifactKey": f"{event['artifactPrefix']}/extracted/{index:03d}.json",
                "status": "queued",
            }
        )

    manifest = {
        "extractedAt": now_iso(),
        "documents": extracted_documents,
    }
    extraction_key = write_artifact(event, "workflow/extracted-assets.json", manifest)

    return {
        **event,
        "extractedDocuments": extracted_documents,
        "extractionArtifactKey": extraction_key,
    }
