"use client"

import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { api, ApiError, setStoredToken, type ApiUser } from "@/lib/api"

interface AuthContextType {
  user: ApiUser | null
  permissions: string[]
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.getMe()
      setUser(data.user)
      setPermissions(data.permissions ?? [])
    } catch (err) {
      // Only a rejected session signs you out; a network blip keeps the current state.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setUser(null)
        setPermissions([])
        setStoredToken(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial session check
    refreshUser()
  }, [refreshUser])

  // Re-check the session when the tab regains focus, so role or permission changes
  // (and deactivation) apply without signing out.
  useEffect(() => {
    if (!user) return
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshUser()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [user, refreshUser])

  useEffect(() => {
    if (loading) return
    const isAuthPage = pathname === "/login"
    if (!user && !isAuthPage) router.replace("/login")
    else if (user && isAuthPage) router.replace("/")
  }, [user, loading, pathname, router])

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password)
      setUser(res.user)
      setPermissions(res.permissions ?? [])
      router.replace("/")
    },
    [router]
  )

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // The local session is cleared either way.
    } finally {
      setUser(null)
      setPermissions([])
      router.replace("/login")
    }
  }, [router])

  return (
    <AuthContext.Provider value={{ user, permissions, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider")
  return context
}
