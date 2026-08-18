import { describe, expect, it, vi } from "vitest";
import { uploadItemImageToS3 } from "@/features/items/adapters/upload-item-image-to-s3";

describe("uploadItemImageToS3", () => {
  it("署名フィールドと画像をmultipart/form-dataでS3へ直接送信する", async () => {
    const file = new File(["image"], "item.png", { type: "image/png" });
    const uploadFetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => ({ ok: true }),
    );

    await uploadItemImageToS3(
      {
        url: "https://bucket.example.test",
        fields: { key: "user/items/image.png", policy: "signed-policy" },
      },
      file,
      uploadFetch,
    );

    expect(uploadFetch).toHaveBeenCalledOnce();
    const [url, init] = uploadFetch.mock.calls[0];
    expect(url).toBe("https://bucket.example.test");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    const body = init?.body as FormData;
    expect(body.get("key")).toBe("user/items/image.png");
    expect(body.get("policy")).toBe("signed-policy");
    expect(body.get("file")).toBe(file);
  });

  it("S3が拒否した場合は保存を続行できるエラーに変換する", async () => {
    const file = new File(["image"], "item.png", { type: "image/png" });

    await expect(
      uploadItemImageToS3(
        { url: "https://bucket.example.test", fields: {} },
        file,
        vi.fn(async () => ({ ok: false })),
      ),
    ).rejects.toThrow("画像をS3へ送信できませんでした");
  });
});
