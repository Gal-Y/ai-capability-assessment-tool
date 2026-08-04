export type DemoScenario = "ready" | "conditional" | "blocked";

export type DemoUploadState = {
  clinicalBundle: File[];
  expectedResources: File[];
  governancePolicies: File[];
  candidateOutputs: File[];
};

type DemoManifest = {
  files: {
    clinicalBundle: string[];
    reference: string[];
    policy: string[];
    candidates: Record<DemoScenario, string>;
  };
};

const fileNameFromPath = (path: string) => {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "fixture";
};

const fetchAsFile = async (path: string): Promise<File> => {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${fileNameFromPath(path)}`);
  }

  const blob = await response.blob();
  return new File([blob], fileNameFromPath(path), {
    type: blob.type || "application/octet-stream",
  });
};

export const loadDemoDataset = async (scenario: DemoScenario): Promise<DemoUploadState> => {
  const response = await fetch("/demo/manifest.json");
  if (!response.ok) {
    throw new Error("Demo manifest is unavailable");
  }

  const manifest = (await response.json()) as DemoManifest;
  const [clinicalBundle, expectedResources, governancePolicies, candidateOutputs] =
    await Promise.all([
      Promise.all(manifest.files.clinicalBundle.map(fetchAsFile)),
      Promise.all(manifest.files.reference.map(fetchAsFile)),
      Promise.all(manifest.files.policy.map(fetchAsFile)),
      Promise.all([fetchAsFile(manifest.files.candidates[scenario])]),
    ]);

  return {
    clinicalBundle,
    expectedResources,
    governancePolicies,
    candidateOutputs,
  };
};
