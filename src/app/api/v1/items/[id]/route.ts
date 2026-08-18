import { NextResponse, type NextRequest } from "next/server";
import { parseItemApiBody } from "@/features/items/adapters/parse-item-api-body";
import { updateApiItemUseCase } from "@/features/items/application/item-api-command-use-cases";
import { loadApiItemUseCase } from "@/features/items/application/item-api-query-use-cases";
import { deleteItemUseCase } from "@/features/items/application/item-delete-use-case";
import { prismaItemApiCommandRepository } from "@/features/items/infrastructure/prisma-item-api-command-repository";
import { prismaItemApiQueryRepository } from "@/features/items/infrastructure/prisma-item-api-query-repository";
import { prismaItemDeleteRepository } from "@/features/items/infrastructure/prisma-item-delete-repository";
import { s3ItemImageStore } from "@/features/items/infrastructure/s3-item-image-store";
import { getApiUser, unauthorized, badRequest, jsonError, dbErrorResponse } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

const itemApiQueryDependencies = Object.freeze({
  repository: prismaItemApiQueryRepository,
});
const itemApiCommandDependencies = Object.freeze({
  repository: prismaItemApiCommandRepository,
});
const itemDeleteDependencies = Object.freeze({
  repository: prismaItemDeleteRepository,
  imageRemover: s3ItemImageStore,
  onCleanupError(error: unknown) {
    console.error("アイテム削除後の画像削除に失敗しました。", error);
  },
});

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/v1/items/:id … 単一アイテム取得（RLS で自分の行のみ。無ければ 404）。
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return unauthorized();
  const id = parseId((await ctx.params).id);
  if (id == null) return badRequest("invalid id");

  try {
    const item = await loadApiItemUseCase(itemApiQueryDependencies, {
      userId: user.sub,
      itemId: id,
    });
    if (!item) return jsonError(404, "not found");
    return NextResponse.json({ item });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

// PUT /api/v1/items/:id … アイテムを更新（コア項目＋カテゴリの置換）。無ければ 404。
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return unauthorized();
  const id = parseId((await ctx.params).id);
  if (id == null) return badRequest("invalid id");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const parsed = parseItemApiBody(body);
  if (!parsed.ok) return badRequest(parsed.error);

  try {
    const result = await updateApiItemUseCase(itemApiCommandDependencies, {
      userId: user.sub,
      itemId: id,
      input: parsed.value,
    });
    if (result.status === "not_found") {
      return jsonError(404, "not found");
    }
    if (result.status === "invalid_categories") {
      return badRequest("invalid category_ids");
    }
    return NextResponse.json({ item: result.item });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

// DELETE /api/v1/items/:id … アイテムを削除後、画像をベストエフォートで削除。無ければ 404。
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return unauthorized();
  const id = parseId((await ctx.params).id);
  if (id == null) return badRequest("invalid id");

  try {
    const result = await deleteItemUseCase(itemDeleteDependencies, {
      userId: user.sub,
      itemId: id,
    });
    if (result.type === "not_found") return jsonError(404, "not found");
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
