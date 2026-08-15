import type { ItemImportInput } from "@/features/items/application/item-import-input";
import type {
  ItemImportRepository,
  ItemImportResult,
} from "@/features/items/application/item-import-ports";

export type ItemImportDependencies = Readonly<{
  repository: ItemImportRepository;
}>;

export type ImportItemsCommand = Readonly<{
  userId: string;
  input: ItemImportInput;
}>;

export async function importItemsUseCase(
  dependencies: ItemImportDependencies,
  command: ImportItemsCommand,
): Promise<ItemImportResult> {
  return dependencies.repository.import(command.userId, command.input);
}
