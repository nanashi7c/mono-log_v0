import { NextResponse, type NextRequest } from "next/server";
import { withUser } from "@/db/client";
import { toItem } from "@/db/serialize";
import {
  isItemStatus,
  type ItemStatus,
} from "@/features/items/domain/status";
import { parseItemApiBody } from "@/features/items/adapters/parse-item-api-body";
import { getApiUser, unauthorized, badRequest, dbErrorResponse } from "@/lib/auth/api";
import { categoryIdsByItem } from "@/lib/api/items";

export const dynamic = "force-dynamic";

// GET /api/v1/items?status=owned … 自分のアイテム一覧（RLS で自分の行のみ）。
export async function GET(req: NextRequest) {
  const user = await getApiUser(req);
  if (!user) return unauthorized();

  const statusParam = req.nextUrl.searchParams.get("status");
  let status: ItemStatus | null = null;
  if (statusParam !== null) {
    if (!isItemStatus(statusParam)) {
      return badRequest(`invalid status: ${statusParam}`);
    }
    status = statusParam;
  }

  try {
    const result = await withUser(user.sub, async (tx) => {
      const rows = await tx.item.findMany({
        where: { deletedAt: null, ...(status ? { status } : {}) },
      });
      const linkMap = await categoryIdsByItem(tx, rows.map((r) => Number(r.id)));
      return rows.map((r) => ({ ...toItem(r), category_ids: linkMap.get(Number(r.id)) ?? [] }));
    });
    return NextResponse.json({ items: result });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

// POST /api/v1/items … アイテムを新規作成（画像・plan・listing は v1 では非対応）。
export async function POST(req: NextRequest) {
  const user = await getApiUser(req);
  if (!user) return unauthorized();

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
    const created = await withUser(user.sub, async (tx) => {
      // FK(items.user_id → users.id)のため users 行を保証してから挿入する。
      await tx.user.upsert({
        where: { id: user.sub },
        update: {},
        create: { id: user.sub, email: user.email, username: user.email.split("@")[0] },
      });

      const row = await tx.item.create({
        data: {
          userId: user.sub,
          status: v.status,
          name: v.name,
          janCode: v.janCode,
          quantity: v.quantity,
          notes: v.notes,
          actualPrice: v.actualPrice,
          purchasedAt: v.purchasedAt ? new Date(v.purchasedAt) : null,
        },
      });

      if (v.categoryIds.length > 0) {
        await tx.itemCategory.createMany({
          data: v.categoryIds.map((cid) => ({ itemId: row.id, categoryId: cid })),
        });
      }
      return { ...toItem(row), category_ids: v.categoryIds };
    });
    return NextResponse.json({ item: created }, { status: 201 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
