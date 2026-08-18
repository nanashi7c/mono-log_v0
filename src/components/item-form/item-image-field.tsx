import Image from "next/image";
import { useRef, useState, type ChangeEvent } from "react";
import { FieldGroup } from "@/components/item-form/field";
import { uploadItemImageToS3 } from "@/features/items/adapters/upload-item-image-to-s3";
import type { PrepareItemImageUploadResult } from "@/features/items/application/item-image-upload-use-cases";
import styles from "@/components/item-form.module.css";

type ItemImageFieldProps = Readonly<{
  imageUrl?: string | null;
  prepareImageUpload: (input: Readonly<{
    contentType: string;
    size: number;
  }>) => Promise<PrepareItemImageUploadResult>;
  onUploadingChange: (isUploading: boolean) => void;
}>;

export function ItemImageField({
  imageUrl,
  prepareImageUpload,
  onUploadingChange,
}: ItemImageFieldProps) {
  const [shouldDeleteImage, setShouldDeleteImage] = useState(false);
  const [pendingUploadId, setPendingUploadId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const requestId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const currentRequestId = ++requestId.current;
    setPendingUploadId(null);
    setUploadError(null);

    if (!file) {
      setIsUploading(false);
      onUploadingChange(false);
      return;
    }

    setShouldDeleteImage(false);
    setIsUploading(true);
    onUploadingChange(true);

    try {
      const prepared = await prepareImageUpload({
        contentType: file.type,
        size: file.size,
      });
      if (requestId.current !== currentRequestId) return;
      if (!prepared.ok) throw new Error(prepared.error);

      await uploadItemImageToS3(prepared.value, file);
      if (requestId.current !== currentRequestId) return;

      setPendingUploadId(prepared.value.uploadId);
    } catch (error) {
      if (requestId.current !== currentRequestId) return;
      input.value = "";
      setUploadError(
        error instanceof Error
          ? error.message
          : "画像をアップロードできませんでした。",
      );
    } finally {
      if (requestId.current === currentRequestId) {
        setIsUploading(false);
        onUploadingChange(false);
      }
    }
  }

  function handleDeleteImageChange(checked: boolean) {
    setShouldDeleteImage(checked);
    if (!checked) return;

    requestId.current += 1;
    setPendingUploadId(null);
    setUploadError(null);
    setIsUploading(false);
    onUploadingChange(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <FieldGroup label="画像">
      {imageUrl && !shouldDeleteImage ? (
        <div className={styles.imagePreview}>
          <div className={styles.imageBox}>
            <Image src={imageUrl} alt="" fill sizes="96px" className={styles.imageBoxImg} />
          </div>
          <label className={styles.deleteImageLabel}>
            <input
              type="checkbox"
              checked={shouldDeleteImage}
              onChange={(event) => handleDeleteImageChange(event.target.checked)}
            />
            画像を削除
          </label>
          <input type="hidden" name="delete_image" value={shouldDeleteImage ? "1" : "0"} />
        </div>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className={styles.fileInput}
        onChange={handleFileChange}
      />
      <p className={styles.note}>JPEG・PNG・GIF・WebP、10MBまで</p>
      {pendingUploadId ? (
        <input type="hidden" name="image_upload_id" value={pendingUploadId} />
      ) : null}
      <p
        className={uploadError ? styles.imageUploadError : styles.imageUploadStatus}
        aria-live="polite"
      >
        {isUploading
          ? "画像を送信しています…"
          : uploadError ?? (pendingUploadId ? "画像を送信しました。" : "")}
      </p>
      {imageUrl && shouldDeleteImage ? (
        <input type="hidden" name="delete_image" value="1" />
      ) : null}
    </FieldGroup>
  );
}
