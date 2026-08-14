// v1/lib/server/authCache.ts
import {
  fetchSupabaseAuthUser,
  fetchSupabaseRoleBinding,
  SupabaseAnonConfig,
  SupabaseAuthUser,
  SupabaseBoundRole,
} from "@/lib/security/requestAuth";

type CachedEntry<T> = {
  data: T;
  expiresAt: number;
};

const USER_CACHE_TTL_MS = 30 * 1000; // 30초
const ROLE_CACHE_TTL_MS = 30 * 1000; // 30초
const MAX_CACHE_ENTRIES = 500;

const userCache = new Map<string, CachedEntry<SupabaseAuthUser | null>>();
const roleCache = new Map<string, CachedEntry<SupabaseBoundRole | null>>();

function cleanupCache<T>(cache: Map<string, CachedEntry<T>>) {
  if (cache.size > MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (entry.expiresAt <= now) {
        cache.delete(key);
      }
    }
    // 여전히 크기가 크면 가장 오래된 절반 삭제
    if (cache.size > MAX_CACHE_ENTRIES) {
      let count = 0;
      for (const key of cache.keys()) {
        cache.delete(key);
        count++;
        if (count >= MAX_CACHE_ENTRIES / 2) break;
      }
    }
  }
}

/**
 * Supabase Auth 유저 정보 인메모리 캐시 조회 (30초 TTL)
 */
export async function fetchSupabaseAuthUserCached(args: {
  cfg: SupabaseAnonConfig;
  accessToken: string;
}): Promise<SupabaseAuthUser | null> {
  const { cfg, accessToken } = args;
  if (!accessToken) return null;

  const now = Date.now();
  const cached = userCache.get(accessToken);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const user = await fetchSupabaseAuthUser({ cfg, accessToken });
  cleanupCache(userCache);
  userCache.set(accessToken, {
    data: user,
    expiresAt: now + USER_CACHE_TTL_MS,
  });

  return user;
}

/**
 * Supabase 역할 바인딩 인메모리 캐시 조회 (30초 TTL)
 */
export async function fetchRoleBindingCached(args: {
  cfg: SupabaseAnonConfig;
  accessToken: string;
  email: string;
}): Promise<SupabaseBoundRole | null> {
  const { cfg, accessToken, email } = args;
  if (!accessToken || !email) return null;

  const cacheKey = `${email}:${accessToken}`;
  const now = Date.now();
  const cached = roleCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const role = await fetchSupabaseRoleBinding({ cfg, accessToken, email });
  cleanupCache(roleCache);
  roleCache.set(cacheKey, {
    data: role,
    expiresAt: now + ROLE_CACHE_TTL_MS,
  });

  return role;
}
