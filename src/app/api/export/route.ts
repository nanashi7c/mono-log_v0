import { NextResponse } from "next/server";
import {
  itemBackupCsvFilename,
  serializeItemBackupCsv,
} from "@/features/items/adapters/item-backup-csv";
import { exportItemsUseCase } from "@/features/items/application/item-export-use-cases";
import { prismaItemExportRepository } from "@/features/items/infrastructure/prisma-item-export-repository";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const itemExportDependencies = {
  repository: prismaItemExportRepository,
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const backup = await exportItemsUseCase(itemExportDependencies, {
    userId: user.sub,
  });
  return new NextResponse(serializeItemBackupCsv(backup), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${itemBackupCsvFilename(backup)}"`,
    },
  });
}
