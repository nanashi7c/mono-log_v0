import { NextResponse, type NextRequest } from "next/server";
import { withUser } from "@/db/client";
import { toItem } from "@/db/serialize";
import { parseItemApiBody } from "@/features/items/adapters/parse-item-api-body";
import { deleteImage } from "@/lib/image";
import { getApiUser, unauthorized, badRequest, jsonError, dbErrorResponse } from "@/lib/auth/api";
import { categoryIdsByItem } from "@/lib/api/items";

export const dynamic = "force-dynamic";

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
    const result = await withUser(user.sub, async (tx) => {
      const row = await tx.item.findFirst({ where: { id: BigInt(id) } });
      if (!row) return null;
      const linkMap = await categoryIdsByItem(tx, [id]);
      return { ...toItem(row), category_ids: linkMap.get(id) ?? [] };
    });
    if (!result) return jsonError(404, "not found");
    return NextResponse.json({ item: result });
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
  const v = parsed.value;

  try {
    const result = await withUser(user.sub, async (tx) => {
      // RLS で他人の行は見えない。存在確認してから更新する。
      const exists = await tx.item.findFirst({ where: { id: BigInt(id) }, select: { id: true } });
      if (!exists) return null;

      const row = await tx.item.update({
        where: { id: BigInt(id) },
        data: {
          status: v.status,
          name: v.name,
          janCode: v.janCode,
          quantity: v.quantity,
          notes: v.notes,
          actualPrice: v.actualPrice,
          purchasedAt: v.purchasedAt ? new Date(v.purchasedAt) : null,
        },
      });

      // カテゴリは置換方式（現行を削除して入れ直す）。
      await tx.itemCategory.deleteMany({ where: { itemId: BigInt(id) } });
      if (v.categoryIds.length > 0) {
        await tx.itemCategory.createMany({
          data: v.categoryIds.map((cid) => ({ itemId: BigInt(id), categoryId: cid })),
        });
      }
      return { ...toItem(row), category_ids: v.categoryIds };
    });
    if (!result) return jsonError(404, "not found");
    return NextResponse.json({ item: result });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

// DELETE /api/v1/items/:id … アイテムを削除（画像も S3 から削除）。無ければ 404。
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return unauthorized();
  const id = parseId((await ctx.params).id);
  if (id == null) return badRequest("invalid id");

  try {
    const deleted = await withUser(user.sub, async (tx) => {
      const row = await tx.item.findFirst({
        where: { id: BigInt(id) },
        select: { imageUrl: true },
      });
      if (!row) return false;
      if (row.imageUrl) await deleteImage(row.imageUrl);
      await tx.item.deleteMany({ where: { id: BigInt(id) } });
      return true;
    });
    if (!deleted) return jsonError(404, "not found");
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
