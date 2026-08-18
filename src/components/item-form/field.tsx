import type { ReactNode } from "react";
import styles from "@/components/item-form.module.css";

type FieldProps = Readonly<{
  label: string;
  children: ReactNode;
}>;

export function Field({ label, children }: FieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}
