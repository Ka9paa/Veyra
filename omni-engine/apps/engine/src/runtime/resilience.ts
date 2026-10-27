export interface DependencyState {
  name: string;
  requiredForRequest: boolean;
  available: boolean;
  detail?: string;
}

export class OptionalDependencyUnavailableError
  extends Error {
  constructor(
    public dependency: string,
    message: string
  ) {
    super(message);
    this.name =
      "OptionalDependencyUnavailableError";
  }
}

export async function optionalDependency<T>(
  dependency: string,
  work: () => Promise<T>,
  fallback: T,
  onFailure?: (error: unknown) => void
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    onFailure?.(error);
    return fallback;
  }
}

export function dependencyHealth(
  states: DependencyState[]
): {
  ok: boolean;
  degraded: boolean;
  dependencies: DependencyState[];
} {
  const requiredFailure =
    states.some(
      state =>
        state.requiredForRequest &&
        !state.available
    );

  const optionalFailure =
    states.some(
      state =>
        !state.requiredForRequest &&
        !state.available
    );

  return {
    ok: !requiredFailure,
    degraded:
      !requiredFailure &&
      optionalFailure,
    dependencies: states
  };
}

export async function lazyDependency<T>(
  factory: () => Promise<T>
): Promise<() => Promise<T>> {
  let resolved: T | undefined;
  let pending: Promise<T> | undefined;

  return async () => {
    if (resolved !== undefined) {
      return resolved;
    }

    if (!pending) {
      pending = factory();
    }

    try {
      resolved = await pending;
      return resolved;
    } catch (error) {
      pending = undefined;
      throw error;
    }
  };
}

/*
VEYRA RELIABILITY RULES

Do not connect to optional databases or external
services at module-import time.

Initialize a dependency lazily inside the request
path that actually needs it.

Static pages, static assets, public marketing pages,
health endpoints, and unrelated routes must remain
available when an optional dependency is degraded.

A database quota failure must not make the entire
application impossible to import or boot.

Health reporting should expose degraded dependencies
without converting optional dependency failure into
global application failure.
*/
