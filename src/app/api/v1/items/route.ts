import { NextResponse, type NextRequest } from "next/server";
import {
  isItemStatus,
  type ItemStatus,
} from "@/features/items/domain/status";
import { parseItemApiBody } from "@/features/items/adapters/parse-item-api-body";
import { createApiItemUseCase } from "@/features/items/application/item-api-command-use-cases";
import { loadApiItemsUseCase } from "@/features/items/application/item-api-query-use-cases";
import { prismaItemApiCommandRepository } from "@/features/items/infrastructure/prisma-item-api-command-repository";
import { prismaItemApiQueryRepository } from "@/features/items/infrastructure/prisma-item-api-query-repository";
import { getApiUser, unauthorized, badRequest, dbErrorResponse } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

const itemApiQueryDependencies = Object.freeze({
  repository: prismaItemApiQueryRepository,
});
const itemApiCommandDependencies = Object.freeze({
  repository: prismaItemApiCommandRepository,
});

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
    const items = await loadApiItemsUseCase(itemApiQueryDependencies, {
      userId: user.sub,
      status,
    });
    return NextResponse.json({ items });
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

  try {
    const item = await createApiItemUseCase(itemApiCommandDependencies, {
      actor: { userId: user.sub, email: user.email },
      input: parsed.value,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
