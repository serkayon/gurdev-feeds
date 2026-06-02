import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  clearAuthSession,
  getAuthToken,
  getAuthTokenExpiryMs,
  getAuthUser,
  setAuthSession,
} from '../api/client'

const AuthContext = createContext(null)

const readAuthState = () => {
  const token = getAuthToken()
  const user = getAuthUser()
  return {
    user: token && user ? user : null,
    isAuthenticated: Boolean(token && user),
  }
}

export function AuthProvider({ children }) {
  const [authState, setAuthState] = useState(readAuthState)

  const login = (token, nextUser) => {
    const resolvedUser = nextUser && typeof nextUser === 'object' ? nextUser : null
    setAuthSession(token, resolvedUser)
    setAuthState(readAuthState())
  }

  const logout = () => {
    clearAuthSession()
    setAuthState({ user: null, isAuthenticated: false })
  }

  useEffect(() => {
    if (!authState.isAuthenticated) return undefined
    const expiryMs = getAuthTokenExpiryMs()
    if (!expiryMs || Date.now() >= expiryMs) {
      clearAuthSession()
      setAuthState({ user: null, isAuthenticated: false })
      return undefined
    }

    const timeoutMs = Math.max(expiryMs - Date.now(), 0)
    const timer = window.setTimeout(() => {
      clearAuthSession()
      setAuthState({ user: null, isAuthenticated: false })
    }, timeoutMs)

    return () => window.clearTimeout(timer)
  }, [authState.isAuthenticated])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const syncFromStorage = () => {
      setAuthState(readAuthState())
    }
    window.addEventListener('storage', syncFromStorage)
    return () => window.removeEventListener('storage', syncFromStorage)
  }, [])

  const value = useMemo(
    () => ({ user: authState.user, isAuthenticated: authState.isAuthenticated, loading: false, login, logout }),
    [authState]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
