import { authHeaders } from '@/utils/api'
import {
  cognitoLogin,
  cognitoLogout,
  resolveProfileEmail,
  setAccessTokenOverride,
  setIdTokenOverride,
  userPool,
} from '@/lib/cognito'
import type { CognitoUserSession } from 'amazon-cognito-identity-js'
import {
  createContext,
  useContext,
  ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react'

export interface AuthUser {
  email: string
  role: string
  name: string
}

export interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
  isAdmin: false,
})

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const BASE =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
    'http://localhost:5000/api'

  const hydrateUser = async () => {
    const headers = authHeaders()
    if (!headers.Authorization) {
      setUser(null)
      return
    }

    const data = (await fetch(BASE + '/auth/me', { headers }).then((r) =>
      r.ok ? r.json() : null,
    )) as AuthUser | null

    if (data && typeof data.email === 'string') {
      const profile = resolveProfileEmail(data.email, data.name)
      setUser({ ...data, email: profile.email, name: profile.name })
    } else {
      setUser(null)
    }
  }

  useEffect(() => {
    const u = userPool.getCurrentUser()
    if (!u) {
      setLoading(false)
      return
    }
    u.getSession(async (_err: Error | null, session: CognitoUserSession | null) => {
      if (session?.isValid()) {
        try {
          setAccessTokenOverride(session.getAccessToken().getJwtToken())
          setIdTokenOverride(session.getIdToken().getJwtToken())
        } catch {
          /* ignore */
        }
        await hydrateUser()
      } else {
        setUser(null)
      }
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = async (email: string, password: string) => {
    const session = await cognitoLogin(email, password)
    const token = session.getAccessToken().getJwtToken()
    setAccessTokenOverride(token)
    try {
      setIdTokenOverride(session.getIdToken().getJwtToken())
    } catch {
      /* ignore */
    }
    await hydrateUser()
  }

  const logout = () => {
    try {
      cognitoLogout()
    } finally {
      setUser(null)
      if (typeof window !== 'undefined') {
        window.location.hash = '#/'
      }
    }
  }

  const isAdmin = useMemo(() => user?.role === 'admin', [user?.role])

  const value = useMemo<AuthContextType>(
    () => ({ user, loading, login, logout, isAdmin }),
    [user, loading, isAdmin],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
