import { randomUUID } from "node:crypto";
import type { ItemImageStore } from "@/features/items/application/item-write-ports";
import { deleteImage, putImage } from "@/lib/image";

export const s3ItemImageStore: ItemImageStore = {
  async upload(userId, file) {
    const extension = (file.name.split(".").pop() ?? "bin").toLowerCase();
    const key = `${userId}/items/${randomUUID()}.${extension}`;
    const body = Buffer.from(await file.arrayBuffer());
    await putImage(key, body, file.type || undefined);
    return key;
  },

  async remove(key) {
    await deleteImage(key);
  },
};
