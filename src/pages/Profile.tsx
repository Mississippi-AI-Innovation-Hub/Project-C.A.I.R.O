import { Link } from 'react-router-dom'
import { ArrowLeft, Mail, Shield, User } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { isOpaqueCognitoUsername } from '@/lib/cognito'

export default function Profile() {
  const { user } = useAuth()
  if (!user) return null

  const email =
    user.email?.includes('@') && !isOpaqueCognitoUsername(user.email)
      ? user.email.trim()
      : ''
  const displayName =
    (user.name?.trim() && !isOpaqueCognitoUsername(user.name)
      ? user.name.trim()
      : '') || email || 'User'

  return (
    <div className="min-h-screen bg-gray-950 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <Button
          variant="ghost"
          className="mb-6 -ml-2 text-gray-400 hover:bg-transparent hover:text-white"
          asChild
        >
          <Link to="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to dashboard
          </Link>
        </Button>

        <Card className="border-gray-800 bg-gray-900">
          <CardHeader>
            <CardTitle className="text-white">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/50 p-4">
              <User className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Display name
                </p>
                <p className="truncate text-sm text-white">{displayName}</p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/50 p-4">
              <Mail className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Email
                </p>
                <p className="truncate text-sm text-white">
                  {email || '—'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/50 p-4">
              <Shield className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Role
                </p>
                <div className="mt-1">
                  <Badge
                    className={
                      user.role === 'admin'
                        ? 'border border-blue-500/30 bg-blue-600/20 text-blue-300'
                        : 'border border-gray-500/30 bg-gray-600/20 text-gray-300'
                    }
                  >
                    {user.role}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
