import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js'

let _accessTokenOverride: string | null = null
let _idTokenOverride: string | null = null

const poolData = {
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
  ClientId: import.meta.env.VITE_COGNITO_APP_CLIENT_ID || '',
}

export const userPool = new CognitoUserPool(poolData)

export function setAccessTokenOverride(token: string | null) {
  _accessTokenOverride = token
}

export function setIdTokenOverride(token: string | null) {
  _idTokenOverride = token
}

export function cognitoLogin(
  email: string,
  password: string,
): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool })
    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    })
    user.authenticateUser(authDetails, {
      onSuccess: (session) => {
        try {
          setAccessTokenOverride(session.getAccessToken().getJwtToken())
          setIdTokenOverride(session.getIdToken().getJwtToken())
        } catch {
          /* ignore */
        }
        resolve(session)
      },
      onFailure: reject,
      newPasswordRequired: () => {
        const err = new Error('NEW_PASSWORD_REQUIRED')
        ;(err as unknown as { cognitoUser: CognitoUser }).cognitoUser = user
        reject(err)
      },
    })
  })
}

export function cognitoLogout() {
  setAccessTokenOverride(null)
  setIdTokenOverride(null)
  const user = userPool.getCurrentUser()
  if (user) user.signOut()
}

export function getAccessToken(): string | null {
  if (_accessTokenOverride) return _accessTokenOverride
  const user = userPool.getCurrentUser()
  if (!user) return null
  const session = user.getSignInUserSession()
  if (!session || !session.isValid()) return null
  return session.getAccessToken().getJwtToken()
}

export function getIdToken(): string | null {
  if (_idTokenOverride) return _idTokenOverride
  const user = userPool.getCurrentUser()
  if (!user) return null
  const session = user.getSignInUserSession()
  if (!session || !session.isValid()) return null
  return session.getIdToken().getJwtToken()
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isOpaqueCognitoUsername(value: string): boolean {
  const v = value.trim()
  return UUID_RE.test(v) || (!v.includes('@') && v.length >= 20)
}

export type IdTokenProfileClaims = {
  email?: string
  name?: string
  preferred_username?: string
}

export function getIdTokenProfileClaims(): IdTokenProfileClaims | null {
  const raw = getIdToken()
  if (!raw) return null
  try {
    const payload = raw.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json) as IdTokenProfileClaims
  } catch {
    return null
  }
}

/** Prefer a real email over Cognito's opaque username (UUID) from access-token-only hydration. */
export function resolveProfileEmail(
  email: string,
  name?: string,
): { email: string; name: string } {
  const trimmedEmail = email.trim()
  const trimmedName = (name ?? '').trim()
  const claims = getIdTokenProfileClaims()
  const candidates = [
    claims?.email,
    claims?.preferred_username,
    trimmedEmail,
    trimmedName,
  ]
  const resolvedEmail =
    candidates.find((v) => typeof v === 'string' && v.includes('@'))?.trim() ??
    (isOpaqueCognitoUsername(trimmedEmail) ? '' : trimmedEmail)

  const resolvedName =
    [claims?.name, claims?.email, claims?.preferred_username, resolvedEmail, trimmedName].find(
      (v) => typeof v === 'string' && v.trim() && !isOpaqueCognitoUsername(v),
    )?.trim() ||
    resolvedEmail ||
    'User'

  return {
    email: resolvedEmail || trimmedEmail,
    name: resolvedName,
  }
}

