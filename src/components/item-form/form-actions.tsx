import type { Item } from "@/types/item";
import styles from "@/components/item-form.module.css";

type FormActionsProps = Readonly<{
  mode: "create" | "edit";
  item?: Readonly<Pick<Item, "name">>;
  onDelete?: (formData: FormData) => void;
}>;

export function FormActions({ mode, item, onDelete }: FormActionsProps) {
  return (
    <div className={styles.actions}>
      <button type="submit" className={styles.submit}>
        {mode === "create" ? "追加" : "保存"}
      </button>
      {onDelete && item ? (
        <button
          type="submit"
          formAction={onDelete}
          formNoValidate
          onClick={(event) => {
            if (!confirm(`「${item.name}」を削除しますか？`)) event.preventDefault();
          }}
          className={styles.delete}
        >
          削除
        </button>
      ) : null}
    </div>
  );
}
