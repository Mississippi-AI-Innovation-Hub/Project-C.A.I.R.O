import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import type { CognitoUser } from 'amazon-cognito-identity-js'
import { userPool } from '@/lib/cognito'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsNewPassword, setNeedsNewPassword] = useState(false)
  const [pendingUser, setPendingUser] = useState<CognitoUser | null>(null)

  const canSubmit = useMemo(() => {
    if (!email.trim()) return false
    if (!password) return false
    if (needsNewPassword && !newPassword) return false
    return true
  }, [email, password, needsNewPassword, newPassword])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      if (needsNewPassword) {
        const u = pendingUser ?? userPool.getCurrentUser()
        if (!u) throw new Error('Missing Cognito user for password change')
        await new Promise<void>((resolve, reject) => {
          u.completeNewPasswordChallenge(
            newPassword,
            {},
            {
              onSuccess: () => resolve(),
              onFailure: (err) => reject(err),
            },
          )
        })
        await login(email, newPassword)
        navigate('/', { replace: true })
        return
      }

      await login(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Login failed'
      if (msg === 'NEW_PASSWORD_REQUIRED') {
        setNeedsNewPassword(true)
        const u = (err as unknown as { cognitoUser?: CognitoUser }).cognitoUser
        if (u) setPendingUser(u)
        setError('Password reset required. Please set a new password to continue.')
      } else {
        setError(msg || 'Login failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <Card className="w-full max-w-md bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white">Sign in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-300">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-gray-800 border-gray-700 text-white"
                placeholder="admin@its.ms.gov"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-300">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete={needsNewPassword ? 'current-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            {needsNewPassword && (
              <div className="space-y-2">
                <Label htmlFor="newPassword" className="text-gray-300">
                  Set new password
                </Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="bg-gray-800 border-gray-700 text-white"
                />
              </div>
            )}

            {error && (
              <div className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting || !canSubmit}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Signing in…
                </>
              ) : needsNewPassword ? (
                'Set new password'
              ) : (
                'Sign in'
              )}
            </Button>
          </form>

          <div className="text-xs text-gray-400 bg-gray-800/40 border border-gray-800 rounded-md px-3 py-2">
            <div className="text-gray-300 font-medium mb-1">Demo credentials</div>
            <div>Admin: <span className="font-mono text-gray-200">admin@its.ms.gov</span></div>
            <div>Operator: <span className="font-mono text-gray-200">operator@its.ms.gov</span></div>
            <div className="mt-1 text-gray-500">Password hint: check with your ITS admin</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

