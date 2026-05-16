import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export const ProtectedRoute = ({
  children,
  roles,
}: {
  children: ReactNode
  roles?: string[]
}) => {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    )
  }

  if (!user) return <Navigate to="/" replace />

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6">
        <div className="max-w-md w-full bg-gray-800 border border-gray-700 rounded-xl p-6 text-center">
          <h2 className="text-white text-lg font-semibold">403 Access denied</h2>
          <p className="text-gray-400 text-sm mt-2">
            You don&apos;t have permission to access this page.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
