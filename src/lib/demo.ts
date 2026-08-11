export type DemoUploadState = {
  clinicalBundle: File[];
  expectedResources: File[];
  governancePolicies: File[];
  candidateOutputs: File[];
};

export type DemoScenarioId = "ready" | "conditional" | "notReady";

type DemoScenario = {
  label: string;
  files: {
    clinicalBundle: string[];
    reference: string[];
    candidate: string;
  };
};

type DemoManifest = {
  defaultScenario: DemoScenarioId;
  scenarios: Record<DemoScenarioId, DemoScenario>;
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

export const loadDemoDataset = async (
  scenarioId?: DemoScenarioId,
): Promise<DemoUploadState> => {
  const response = await fetch("/demo/manifest.json");
  if (!response.ok) {
    throw new Error("Demo manifest is unavailable");
  }

  const manifest = (await response.json()) as DemoManifest;
  const scenario = manifest.scenarios[scenarioId ?? manifest.defaultScenario];
  if (!scenario) {
    throw new Error("Demo scenario is unavailable");
  }

  const [clinicalBundle, expectedResources, governancePolicies, candidateOutputs] =
    await Promise.all([
      Promise.all(scenario.files.clinicalBundle.map(fetchAsFile)),
      Promise.all(scenario.files.reference.map(fetchAsFile)),
      Promise.resolve([]),
      Promise.all([fetchAsFile(scenario.files.candidate)]),
    ]);

  return {
    clinicalBundle,
    expectedResources,
    governancePolicies,
    candidateOutputs,
  };
};
