// Explicit public pages; unknown and future application routes are protected.
export function isPublicPath(path: string) {
  return ["/login", "/overview", "/auth/google", "/auth/callback", "/auth/signout"].includes(path.replace(/\/$/, "") || "/");
}
export function isGoogleUser(user: { app_metadata?: { provider?: string }; is_anonymous?: boolean } | null) {
  return !!user && !user.is_anonymous && user.app_metadata?.provider === "google";
}
export function isSameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

export function isAuthUnavailable(error: { name?: string; status?: number } | null | undefined) {
  return !!error && (error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status ?? 0) >= 500);
}
