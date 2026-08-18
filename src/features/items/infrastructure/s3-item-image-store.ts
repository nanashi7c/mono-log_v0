import type {
  ItemImageObjectStore,
  ItemImageUploadSigner,
} from "@/features/items/application/item-image-upload-ports";
import { createSignedImageUpload, deleteImage, inspectImage } from "@/lib/image";

export const s3ItemImageUploadSigner: ItemImageUploadSigner = {
  async sign(policy) {
    return createSignedImageUpload(policy);
  },
};

export const s3ItemImageStore: ItemImageObjectStore = {
  async inspect(key) {
    return inspectImage(key);
  },
  async remove(key) {
    await deleteImage(key);
  },
};
