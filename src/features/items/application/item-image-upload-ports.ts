export type PendingItemImageUpload = Readonly<{
  id: string;
  objectKey: string;
  contentType: string;
  expiresAtEpochMs: number;
}>;

export interface PendingItemImageUploadRepository {
  reserve(
    userId: string,
    upload: PendingItemImageUpload,
  ): Promise<void>;
  findById(
    userId: string,
    uploadId: string,
  ): Promise<PendingItemImageUpload | null>;
  findExpired(
    userId: string,
    expiredBeforeEpochMs: number,
    limit: number,
  ): Promise<readonly PendingItemImageUpload[]>;
  remove(userId: string, uploadId: string): Promise<void>;
}

export type ItemImageUploadPolicy = Readonly<{
  key: string;
  contentType: string;
  maxBytes: number;
  expiresInSeconds: number;
}>;

export type SignedItemImageUpload = Readonly<{
  url: string;
  fields: Readonly<Record<string, string>>;
}>;

export interface ItemImageUploadSigner {
  sign(policy: ItemImageUploadPolicy): Promise<SignedItemImageUpload>;
}

export interface ItemImageObjectStore {
  inspect(key: string): Promise<Readonly<{
    contentType: string | null;
    size: number | null;
  }> | null>;
  remove(key: string): Promise<void>;
}
