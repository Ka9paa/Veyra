export type VeyraCostStage =
  | "reference"
  | "directions"
  | "design"
  | "composition"
  | "assets"
  | "builder"
  | "repair"
  | "visual"
  | "photo-search";

export interface VeyraCostBudget {
  maxModelCalls: number;
  maxRepairCalls: number;
  maxGeneratedVisuals: number;
  maxPhotoSearches: number;
}

export interface VeyraCostUsage {
  modelCalls: number;
  repairCalls: number;
  generatedVisuals: number;
  photoSearches: number;
  stages: Partial<Record<VeyraCostStage, number>>;
}

export const DEFAULT_VEYRA_COST_BUDGET: VeyraCostBudget = {
  maxModelCalls: 12,
  maxRepairCalls: 4,
  maxGeneratedVisuals: 2,
  maxPhotoSearches: 4
};

export class VeyraCostGuard {
  readonly budget: VeyraCostBudget;

  readonly usage: VeyraCostUsage = {
    modelCalls: 0,
    repairCalls: 0,
    generatedVisuals: 0,
    photoSearches: 0,
    stages: {}
  };

  constructor(
    budget: Partial<VeyraCostBudget> = {}
  ) {
    this.budget = {
      ...DEFAULT_VEYRA_COST_BUDGET,
      ...budget
    };
  }

  private bump(stage: VeyraCostStage): void {
    this.usage.stages[stage] =
      (this.usage.stages[stage] ?? 0) + 1;
  }

  model(stage: VeyraCostStage): void {
    if (
      this.usage.modelCalls >=
      this.budget.maxModelCalls
    ) {
      throw new Error(
        `Veyra cost guard blocked another model call after ${this.usage.modelCalls} calls.`
      );
    }

    if (
      stage === "repair" &&
      this.usage.repairCalls >=
        this.budget.maxRepairCalls
    ) {
      throw new Error(
        `Veyra cost guard blocked another repair call after ${this.usage.repairCalls} repairs.`
      );
    }

    this.usage.modelCalls += 1;

    if (stage === "repair") {
      this.usage.repairCalls += 1;
    }

    this.bump(stage);
  }

  generatedVisual(): void {
    if (
      this.usage.generatedVisuals >=
      this.budget.maxGeneratedVisuals
    ) {
      throw new Error(
        `Veyra cost guard blocked another generated visual after ${this.usage.generatedVisuals} visuals.`
      );
    }

    this.usage.generatedVisuals += 1;
    this.bump("visual");
  }

  photoSearch(): void {
    if (
      this.usage.photoSearches >=
      this.budget.maxPhotoSearches
    ) {
      throw new Error(
        `Veyra cost guard blocked another photography search after ${this.usage.photoSearches} searches.`
      );
    }

    this.usage.photoSearches += 1;
    this.bump("photo-search");
  }

  remaining() {
    return {
      modelCalls: Math.max(
        0,
        this.budget.maxModelCalls -
          this.usage.modelCalls
      ),

      repairCalls: Math.max(
        0,
        this.budget.maxRepairCalls -
          this.usage.repairCalls
      ),

      generatedVisuals: Math.max(
        0,
        this.budget.maxGeneratedVisuals -
          this.usage.generatedVisuals
      ),

      photoSearches: Math.max(
        0,
        this.budget.maxPhotoSearches -
          this.usage.photoSearches
      )
    };
  }

  snapshot(): VeyraCostUsage {
    return {
      modelCalls: this.usage.modelCalls,
      repairCalls: this.usage.repairCalls,
      generatedVisuals:
        this.usage.generatedVisuals,
      photoSearches:
        this.usage.photoSearches,
      stages: {
        ...this.usage.stages
      }
    };
  }
}

export function createVeyraCostGuard(
  budget?: Partial<VeyraCostBudget>
): VeyraCostGuard {
  return new VeyraCostGuard(budget);
}


/* VEYRA_RUNTIME_COST_GUARD_V1
 *
 * Shared runtime guard for actual provider calls.
 *
 * Every external model/photo/image call must reserve budget
 * BEFORE contacting its provider.
 */

const runtimeCostGuard = createVeyraCostGuard();

export function getVeyraRuntimeCostGuard(): VeyraCostGuard {
  return runtimeCostGuard;
}

export function guardModelCall(
  stage: VeyraCostStage
): void {
  runtimeCostGuard.model(stage);
}

export function guardGeneratedVisual(): void {
  runtimeCostGuard.generatedVisual();
}

export function guardPhotoSearch(): void {
  runtimeCostGuard.photoSearch();
}

export function runtimeCostSnapshot() {
  return {
    usage: runtimeCostGuard.snapshot(),
    remaining: runtimeCostGuard.remaining(),
    budget: {
      ...runtimeCostGuard.budget
    }
  };
}

/* END VEYRA_RUNTIME_COST_GUARD_V1 */
