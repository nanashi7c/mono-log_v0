import { NextResponse, type NextRequest } from "next/server";
import { verifyIdToken } from "./cognito";
import { isDemoUserId } from "./demo-account";

const CLIENT_INPUT_DATABASE_ERROR_CODES = new Set([
  "P2000",
  "P2002",
  "P2003",
  "P2004",
  "P2006",
  "P2007",
  "P2011",
  "P2014",
  "P2019",
  "P2020",
  "P2033",
]);

function databaseErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

// REST API 用の認証ユーザ（Cognito の sub と email）。
export type ApiUser = { sub: string; email: string };

// Authorization: Bearer <Cognito ID トークン> を検証してユーザを返す。失敗時は null。
// 外部クライアント（モバイル/サードパーティ）は Cognito で取得した ID トークンを付与する。
export async function getApiUser(req: NextRequest): Promise<ApiUser | null> {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  try {
    const payload = await verifyIdToken(token);
    if (isDemoUserId(payload.sub)) return null;
    return { sub: payload.sub, email: payload.email as string };
  } catch {
    return null; // 署名不正・期限切れ等
  }
}

// 一貫した JSON エラー応答を作るヘルパー群。
export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
export function unauthorized(): NextResponse {
  return jsonError(401, "unauthorized");
}
export function badRequest(message: string): NextResponse {
  return jsonError(400, message);
}

// DB 例外の詳細はサーバーにだけ記録し、公開レスポンスは固定メッセージにする。
export function dbErrorResponse(error: unknown): NextResponse {
  console.error("REST APIのデータ処理に失敗しました。", error);

  const code = databaseErrorCode(error);
  if (code && CLIENT_INPUT_DATABASE_ERROR_CODES.has(code)) {
    return jsonError(400, "invalid request");
  }
  return jsonError(500, "internal error");
}
