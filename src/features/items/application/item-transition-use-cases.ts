import type {
  ItemTransitionRepository,
  ItemTransitionResult,
} from "@/features/items/application/item-transition-ports";
import {
  getItemTransitionPlan,
  type ItemTransitionAction,
} from "@/features/items/domain/item-transition";

export type ItemTransitionDependencies = Readonly<{
  repository: ItemTransitionRepository;
  now?: () => Date;
}>;

export type TransitionItemCommand = Readonly<{
  userId: string;
  itemId: number;
  action: ItemTransitionAction;
}>;

function currentTime(): Date {
  return new Date();
}

export async function transitionItemUseCase(
  dependencies: ItemTransitionDependencies,
  command: TransitionItemCommand,
): Promise<ItemTransitionResult> {
  const plan = getItemTransitionPlan(command.action);
  const transitionedAt = plan.markDeleted
    ? (dependencies.now ?? currentTime)()
    : null;

  return dependencies.repository.transition(
    command.userId,
    command.itemId,
    plan,
    transitionedAt,
  );
}
