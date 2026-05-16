/**
 * Legacy /auth route — redirects to dashboard login
 * No login needed in mock mode.
 */
import { Navigate } from 'react-router-dom';
export default function Auth() {
  return <Navigate to="/" replace />;
}
