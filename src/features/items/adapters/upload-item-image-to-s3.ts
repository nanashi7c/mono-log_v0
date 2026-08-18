import type { SignedItemImageUpload } from "@/features/items/application/item-image-upload-ports";

type UploadFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Pick<Response, "ok">>;

export async function uploadItemImageToS3(
  upload: SignedItemImageUpload,
  file: File,
  uploadFetch: UploadFetch = fetch,
): Promise<void> {
  const body = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) {
    body.set(name, value);
  }
  body.set("file", file);

  const response = await uploadFetch(upload.url, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    throw new Error("画像をS3へ送信できませんでした。もう一度お試しください。");
  }
}
