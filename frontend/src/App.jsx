import React from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import RawMaterial from './pages/RawMaterial'
import Dispatch from './pages/Dispatch'
import Production from './pages/Production'
import Stock from './pages/Stock'
import Settings from './pages/Settings'
import ClientLogin from './pages/ClientLogin'
import { backendStatus } from './api/client'

function ServerMaintenanceOverlay() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl text-center">
        <div className="mx-auto mb-4 h-10 w-10 rounded-full border-4 border-slate-200 border-t-[#245658] animate-spin" />
        <h2 className="text-xl font-semibold text-slate-800">Server Under Maintenance</h2>
        <p className="mt-2 text-sm text-slate-600">
          Backend service is currently unavailable. This screen will close automatically once the server is back online.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const location = useLocation()
  const shouldMonitorBackend = location.pathname.startsWith('/layout')
  const [isBackendReachable, setIsBackendReachable] = React.useState(backendStatus.get())

  React.useEffect(() => {
    if (!shouldMonitorBackend) {
      setIsBackendReachable(true)
      return
    }

    const unsubscribe = backendStatus.subscribe(setIsBackendReachable)
    const probeBackend = () => {
      backendStatus.ping().catch(() => {})
    }

    probeBackend()
    const timer = setInterval(probeBackend, 5000)

    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [shouldMonitorBackend])

  React.useEffect(() => {
    const originalOverflow = document.body.style.overflow
    if (shouldMonitorBackend && !isBackendReachable) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = originalOverflow || ''
    }

    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isBackendReachable, shouldMonitorBackend])

  return (
    <AuthProvider>
      <AppRoutes
        isBackendReachable={isBackendReachable}
        shouldMonitorBackend={shouldMonitorBackend}
      />
    </AuthProvider>
  )
}

function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/" replace />
  return children
}

function PublicOnly({ children }) {
  const { isAuthenticated } = useAuth()
  if (isAuthenticated) return <Navigate to="/layout" replace />
  return children
}

function AppRoutes({ isBackendReachable, shouldMonitorBackend }) {
  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={(
            <PublicOnly>
              <ClientLogin />
            </PublicOnly>
          )}
        />
        <Route
          path="/layout"
          element={(
            <RequireAuth>
              <Layout />
            </RequireAuth>
          )}
        >
          <Route index element={<Dashboard />} />
          <Route path="raw-material" element={<RawMaterial />} />
          <Route path="dispatch" element={<Dispatch />} />
          <Route path="production" element={<Production />} />
          <Route path="stock" element={<Stock />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {/* {shouldMonitorBackend && !isBackendReachable && <ServerMaintenanceOverlay />} */}
    </>
  )
}
