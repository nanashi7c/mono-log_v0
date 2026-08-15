import { NextResponse, type NextRequest } from "next/server";
import { exportItemsUseCase } from "@/features/items/application/item-export-use-cases";
import { prismaItemExportRepository } from "@/features/items/infrastructure/prisma-item-export-repository";
import { getApiUser, unauthorized, dbErrorResponse } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

const itemExportDependencies = {
  repository: prismaItemExportRepository,
};

// GET /api/v1/export … 自分の全データ(カテゴリ＋アイテム)を JSON で返す。
export async function GET(req: NextRequest) {
  const user = await getApiUser(req);
  if (!user) return unauthorized();

  try {
    const backup = await exportItemsUseCase(itemExportDependencies, {
      userId: user.sub,
    });
    return NextResponse.json(backup);
  } catch (error) {
    return dbErrorResponse(error);
  }
}
