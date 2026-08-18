import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.S3_IMAGE_BUCKET!;
const SIGNED_TTL = 60 * 60; // 1 hour

// 認証情報は環境（ローカルは ~/.aws、EC2 は IAM ロール）から自動取得する。
const s3 = new S3Client({ region: process.env.AWS_REGION });

export const IMAGE_BUCKET = BUCKET;

// S3 オブジェクトキーから署名付き GET URL を生成する。キーが無ければ null。
export async function signedImageUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  try {
    return await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
      expiresIn: SIGNED_TTL,
    });
  } catch {
    return null;
  }
}

export async function createSignedImageUpload(input: {
  key: string;
  contentType: string;
  maxBytes: number;
  expiresInSeconds: number;
}): Promise<Readonly<{ url: string; fields: Readonly<Record<string, string>> }>> {
  const result = await createPresignedPost(s3, {
    Bucket: BUCKET,
    Key: input.key,
    Conditions: [
      ["content-length-range", 1, input.maxBytes],
      ["eq", "$Content-Type", input.contentType],
    ],
    Fields: {
      "Content-Type": input.contentType,
    },
    Expires: input.expiresInSeconds,
  });
  return Object.freeze({
    url: result.url,
    fields: Object.freeze({ ...result.fields }),
  });
}

export async function inspectImage(key: string): Promise<Readonly<{
  contentType: string | null;
  size: number | null;
}> | null> {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return Object.freeze({
      contentType: result.ContentType ?? null,
      size: result.ContentLength ?? null,
    });
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
}

// 画像を S3 から削除する。
export async function deleteImage(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
