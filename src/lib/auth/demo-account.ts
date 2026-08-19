export const DEMO_SESSION_COOKIE = "ml_demo";

export type DemoAccountConfig = Readonly<{
  userId: string;
  email: string;
  password: string;
  sessionToken: string;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function configuredDemoUserId(): string | null {
  const userId = process.env.DEMO_USER_ID?.trim();
  return userId && UUID_PATTERN.test(userId) ? userId : null;
}

function configuredDemoEmail(): string | null {
  const email = process.env.DEMO_USER_EMAIL?.trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

export function getDemoAccountConfig(): DemoAccountConfig | null {
  const userId = configuredDemoUserId();
  const email = configuredDemoEmail();
  const password = process.env.DEMO_USER_PASSWORD;
  const sessionToken = process.env.DEMO_SESSION_TOKEN;

  if (
    !userId ||
    !email ||
    !password ||
    !sessionToken ||
    sessionToken.length < 32
  ) {
    return null;
  }

  return Object.freeze({ userId, email, password, sessionToken });
}

export function isDemoEmail(email: string): boolean {
  const configuredEmail = configuredDemoEmail();
  return (
    configuredEmail !== null &&
    email.trim().toLowerCase() === configuredEmail
  );
}

export function matchesDemoCredentials(
  email: string,
  password: string,
): boolean {
  const config = getDemoAccountConfig();
  return (
    config !== null &&
    email.trim().toLowerCase() === config.email &&
    password === config.password
  );
}

export function isDemoUserId(userId: string): boolean {
  const configuredUserId = configuredDemoUserId();
  return configuredUserId !== null && userId === configuredUserId;
}

export function isValidDemoSessionToken(token: string | undefined): boolean {
  const config = getDemoAccountConfig();
  return config !== null && token === config.sessionToken;
}
