type OutputSource = "platform-model" | "uploaded-outputs";
type UploadCategory = "documents" | "referenceOutputs" | "policyFiles" | "aiOutputs";

type ApiErrorPayload = {
  message?: string;
};

type PresignUploadResponse = {
  draftId: string;
  uploads: Array<{
    fileName: string;
    category: UploadCategory;
    contentType: string;
    objectKey: string;
    uploadUrl: string;
  }>;
};

export type RemoteFileRef = {
  name: string;
  key: string;
};

export type RemoteEvaluation = {
  evaluationId: string;
  createdAt: string;
  updatedAt?: string;
  status: string;
  capability: string;
  outputSource: OutputSource;
  documentCount?: number;
  referenceCount?: number;
  policyCount?: number;
  outputCount?: number;
  documents: RemoteFileRef[];
  referenceOutputs: RemoteFileRef[];
  policyFiles: RemoteFileRef[];
  aiOutputs: RemoteFileRef[];
  config?: {
    audience?: string;
    outputStyle?: string;
    maxWords?: number;
    riskLevel?: string;
    modelId?: string;
    promptPreset?: string;
    providedLatencySeconds?: string;
    providedCostPerDocument?: string;
    requiredSections?: string[];
    excludedContent?: string[];
    policyText?: string;
    redactSensitiveContent?: boolean;
  };
  result?: {
    scoredAt: string;
    readinessScore: number;
    costPerDocument: number | null;
    decision: "Ready" | "Conditional" | "Not Ready";
    metrics: {
      faithfulness: number;
      coverage: number;
      compliance: number;
      privacy: number;
      latency: number | null;
    };
    issues: string[];
  };
};

type StartEvaluationPayload = {
  capability: string;
  outputSource: OutputSource;
  documents: RemoteFileRef[];
  referenceOutputs: RemoteFileRef[];
  policyFiles: RemoteFileRef[];
  aiOutputs: RemoteFileRef[];
  config: Record<string, unknown>;
};

export type UploadedFileResult = {
  category: UploadCategory;
  name: string;
  key: string;
};

const viteEnv = (import.meta as ImportMeta & {
  env?: { VITE_API_BASE_URL?: string };
}).env;

export const API_BASE_URL = (
  viteEnv?.VITE_API_BASE_URL?.trim() ||
  "https://lmeetloanl.execute-api.ap-southeast-2.amazonaws.com"
).replace(/\/$/, "");

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const payload = (await response.json()) as ApiErrorPayload;

      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // Ignore parse errors and fall back to the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
};

export const listEvaluations = () =>
  requestJson<{ evaluations: RemoteEvaluation[] }>("/evaluations");

export const getEvaluation = (evaluationId: string) =>
  requestJson<{ evaluation: RemoteEvaluation }>(`/evaluations/${evaluationId}`);

export const startEvaluation = (payload: StartEvaluationPayload) =>
  requestJson<{ evaluationId: string; status: string }>("/evaluations", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const uploadLocalFiles = async (
  files: Array<{ category: UploadCategory; file: File }>,
  draftId?: string,
) => {
  if (files.length === 0) {
    return {
      draftId: draftId ?? null,
      uploadedFiles: [] as UploadedFileResult[],
    };
  }

  const presigned = await requestJson<PresignUploadResponse>("/uploads/presign", {
    method: "POST",
    body: JSON.stringify({
      draftId,
      files: files.map(({ category, file }) => ({
        fileName: file.name,
        category,
        contentType: file.type || "application/octet-stream",
      })),
    }),
  });

  await Promise.all(
    presigned.uploads.map(async (upload, index) => {
      const source = files[index];
      const response = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": upload.contentType,
        },
        body: source.file,
      });

      if (!response.ok) {
        throw new Error(`Upload failed for ${source.file.name}`);
      }
    }),
  );

  return {
    draftId: presigned.draftId,
    uploadedFiles: presigned.uploads.map((upload, index) => ({
      category: upload.category,
      key: upload.objectKey,
      name: files[index].file.name,
    })),
  };
};
