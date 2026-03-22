import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message || body.error || message;
    } catch {
      const text = await res.text();
      if (text) message = text;
    }

    if (res.status === 401) {
      const isAuthPage = window.location.pathname === "/login" || window.location.pathname === "/signup";
      if (!isAuthPage) {
        window.location.href = "/login";
        throw new Error("Your session has expired. Please sign in again.");
      }
      throw new Error(message || "Invalid credentials. Please check your username and password.");
    }
    if (res.status === 403) {
      throw new Error(message || "You don't have permission to perform this action.");
    }

    throw new Error(message);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = await res.json();
        message = body.message || body.error || message;
      } catch {
        try {
          const text = await res.text();
          if (text) message = text;
        } catch {}
      }

      if (res.status === 401) {
        const isAuthPage = window.location.pathname === "/login" || window.location.pathname === "/signup";
        if (!isAuthPage) {
          window.location.href = "/login";
        }
        throw new Error(message || "Your session has expired. Please sign in again.");
      }
      if (res.status === 403) {
        throw new Error(message || "You don't have permission to access this resource.");
      }
      throw new Error(message);
    }

    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
