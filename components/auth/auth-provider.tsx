"use client"

import { useUser } from '@clerk/nextjs'
import { useEffect } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import type { User as SupabaseUser } from '@/lib/supabase'

interface AuthProviderProps {
  children: React.ReactNode
}

type MeResponse = {
  user?: SupabaseUser
  permissions?: string[]
  error?: string
  /** Present on 403 when the account is awaiting approval or was denied. */
  status?: 'pending' | 'denied' | 'disaffiliated' | 'pnm'
}

const SETUP_ERROR_MESSAGE =
  "We couldn't finish setting up your portal account. Please try again, and contact an administrator if the issue continues."

export function AuthProvider({ children }: AuthProviderProps) {
  const { user: clerkUser, isLoaded } = useUser()
  const {
    setUser,
    setAuthorized,
    setLoading,
    setPermissions,
    setAuthError,
    reset,
  } =
    useAuthStore()

  useEffect(() => {
    const controller = new AbortController()

    async function checkUserAuthorization() {
      if (!isLoaded) return

      setLoading(true)

      if (!clerkUser) {
        setPermissions([])
        reset()
        return
      }

      // Abort if the server takes too long so the UI is not stuck loading.
      const timeout = setTimeout(() => controller.abort(), 10000)

      try {
        // The server verifies the Clerk session, links it to the Supabase
        // profile (users.clerk_user_id) and returns the profile + permissions.
        const response = await fetch('/api/auth/me', {
          cache: 'no-store',
          signal: controller.signal,
        })

        const body = (await response.json().catch(() => ({}))) as MeResponse

        if (!response.ok || !body.user) {
          const accessStatus =
            response.status === 403 && (body.status === 'pending' ||
              body.status === 'denied' ||
              body.status === 'disaffiliated' ||
              body.status === 'pnm')
              ? body.status
              : null
          if (!accessStatus) {
            console.error('Failed to resolve app user:', body.error ?? response.status)
          }
          setAuthError(
            response.status === 403 && body.error ? body.error : SETUP_ERROR_MESSAGE,
            accessStatus ?? 'error'
          )
          setAuthorized(false)
          setPermissions([])
          setUser(null)
          return
        }

        setAuthError(null)
        setAuthorized(true)
        setUser(body.user)
        setPermissions(body.permissions ?? [])
      } catch (error) {
        if (controller.signal.aborted && !isLoaded) return
        console.error('Error checking user authorization:', error)
        setAuthError(SETUP_ERROR_MESSAGE)
        setAuthorized(false)
        setPermissions([])
        setUser(null)
      } finally {
        clearTimeout(timeout)
        setLoading(false)
      }
    }

    checkUserAuthorization()

    return () => controller.abort()
  }, [
    clerkUser,
    isLoaded,
    reset,
    setAuthorized,
    setAuthError,
    setLoading,
    setPermissions,
    setUser,
  ])

  return <>{children}</>
} 
