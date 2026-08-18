import Image from "next/image";
import { useState } from "react";
import { Field } from "@/components/item-form/field";
import styles from "@/components/item-form.module.css";

type ItemImageFieldProps = Readonly<{
  imageUrl?: string | null;
}>;

export function ItemImageField({ imageUrl }: ItemImageFieldProps) {
  const [shouldDeleteImage, setShouldDeleteImage] = useState(false);

  return (
    <Field label="画像">
      {imageUrl && !shouldDeleteImage ? (
        <div className={styles.imagePreview}>
          <div className={styles.imageBox}>
            <Image src={imageUrl} alt="" fill sizes="96px" className={styles.imageBoxImg} />
          </div>
          <label className={styles.deleteImageLabel}>
            <input
              type="checkbox"
              checked={shouldDeleteImage}
              onChange={(event) => setShouldDeleteImage(event.target.checked)}
            />
            画像を削除
          </label>
          <input type="hidden" name="delete_image" value={shouldDeleteImage ? "1" : "0"} />
        </div>
      ) : null}
      <input name="image" type="file" accept="image/*" className={styles.fileInput} />
      {imageUrl && shouldDeleteImage ? (
        <input type="hidden" name="delete_image" value="1" />
      ) : null}
    </Field>
  );
}
