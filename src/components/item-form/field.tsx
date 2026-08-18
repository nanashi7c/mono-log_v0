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

export function FieldGroup({ label, children }: FieldProps) {
  return (
    <fieldset className={`${styles.field} ${styles.fieldGroup}`}>
      <legend className={styles.fieldLabel}>{label}</legend>
      {children}
    </fieldset>
  );
}
