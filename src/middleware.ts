import { NextResponse, type NextRequest } from "next/server";
import {
  CLOUDFRONT_ORIGIN_VERIFY_HEADER,
  isOriginRequestAllowed,
} from "@/lib/origin-verification";

// 認証不要のパス（ランディング・認証系）
const PUBLIC_PREFIXES = ["/", "/login", "/signup", "/confirm"];

const SESSION_COOKIES = ["ml_id", "ml_access", "ml_refresh"];

const SESSION_AUTH_EXEMPT_PREFIXES = ["/api", "/_next"];
const PUBLIC_ASSET_PATH = /\.(?:svg|png|jpg|jpeg|gif|webp)$/;

const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

// JWT の exp を署名検証せずに読む（Edge ランタイムで動くよう atob のみ）。
function decodeExp(token: string | undefined): number | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function isExpired(token: string | undefined): boolean {
  const exp = decodeExp(token);
  return exp == null || exp * 1000 <= Date.now();
}

// Cognito の REFRESH_TOKEN_AUTH を fetch で実行（Edge 対応・AWS 認証情報不要の公開クライアント）。
async function refreshTokens(
  refreshToken: string,
): Promise<{ idToken: string; accessToken: string } | null> {
  const region = process.env.AWS_REGION;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!region || !clientId) return null;
  try {
    const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: clientId,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      AuthenticationResult?: { IdToken?: string; AccessToken?: string };
    };
    const r = data.AuthenticationResult;
    if (!r?.IdToken || !r.AccessToken) return null;
    return { idToken: r.IdToken, accessToken: r.AccessToken };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const presentedOriginSecret = request.headers.get(
    CLOUDFRONT_ORIGIN_VERIFY_HEADER,
  );
  if (
    !isOriginRequestAllowed(
      presentedOriginSecret,
      process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET,
    )
  ) {
    return new NextResponse(null, { status: 403 });
  }

  const path = request.nextUrl.pathname;
  const skipsSessionAuthentication =
    SESSION_AUTH_EXEMPT_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    ) ||
    path === "/favicon.ico" ||
    PUBLIC_ASSET_PATH.test(path);
  if (skipsSessionAuthentication) return NextResponse.next();

  const idToken = request.cookies.get("ml_id")?.value;
  const refreshToken = request.cookies.get("ml_refresh")?.value;
  const isPublic = PUBLIC_PREFIXES.some(
    (p) => path === p || (p !== "/" && path.startsWith(`${p}/`)),
  );

  let loggedIn = !isExpired(idToken);
  let refreshed: { idToken: string; accessToken: string } | null = null;

  // ID トークンが失効していてもリフレッシュトークンがあれば自動更新を試みる。
  if (!loggedIn && refreshToken) {
    refreshed = await refreshTokens(refreshToken);
    if (refreshed) {
      loggedIn = true;
      // 同一リクエストの Server Component が新トークンを読めるよう request 側も更新する。
      request.cookies.set("ml_id", refreshed.idToken);
      request.cookies.set("ml_access", refreshed.accessToken);
    }
  }

  // 新トークンをブラウザにも反映するヘルパ。
  function applyRefreshed(res: NextResponse): NextResponse {
    if (refreshed) {
      res.cookies.set("ml_id", refreshed.idToken, cookieOpts);
      res.cookies.set("ml_access", refreshed.accessToken, cookieOpts);
    }
    return res;
  }

  // 未ログイン（更新も不可）で保護ルート → /login。失効 Cookie は破棄し、ループを防ぐ。
  if (!loggedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", path);
    const res = NextResponse.redirect(url);
    if (idToken || refreshToken) for (const c of SESSION_COOKIES) res.cookies.delete(c);
    return res;
  }

  // ログイン済み（有効 or 更新済み）で /login・/signup → /items
  if (loggedIn && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/items";
    return applyRefreshed(NextResponse.redirect(url));
  }

  return applyRefreshed(NextResponse.next({ request }));
}
