export type VeyraDependencyName =
  | "database"
  | "openai"
  | "photo-provider"
  | "visual-storage";

export interface VeyraDependencyHealth {
  name: VeyraDependencyName;
  requiredForBoot: boolean;
  available: boolean;
  message?: string;
}

export interface VeyraRuntimeHealth {
  ok: boolean;
  degraded: boolean;
  dependencies: VeyraDependencyHealth[];
}

export function runtimeHealth(
  dependencies: VeyraDependencyHealth[]
): VeyraRuntimeHealth {
  const bootFailure = dependencies.some(
    dependency =>
      dependency.requiredForBoot &&
      !dependency.available
  );

  const degraded = dependencies.some(
    dependency => !dependency.available
  );

  return {
    ok: !bootFailure,
    degraded,
    dependencies
  };
}

export async function probeOptionalDependency(
  name: VeyraDependencyName,
  probe: () => Promise<void>
): Promise<VeyraDependencyHealth> {
  try {
    await probe();

    return {
      name,
      requiredForBoot: false,
      available: true
    };
  } catch (error) {
    return {
      name,
      requiredForBoot: false,
      available: false,
      message:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

export function unavailableOptionalDependency(
  name: VeyraDependencyName,
  message: string
): VeyraDependencyHealth {
  return {
    name,
    requiredForBoot: false,
    available: false,
    message
  };
}

export function availableOptionalDependency(
  name: VeyraDependencyName
): VeyraDependencyHealth {
  return {
    name,
    requiredForBoot: false,
    available: true
  };
}
