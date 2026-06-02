import React from 'react'
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { auth } from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function Welcome() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await auth.login(email, password)
      login(data.access_token, data.user)
      navigate('/app')
    } catch (err) {
      const d = err.response?.data?.detail
      const msg = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg || x.message).join(', ') : 'Login failed'
      setError(msg + (err.response?.status === 401 ? ' If you are a customer, ask your vendor to create your account first.' : ''))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-primary flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Poultry ERP</h1>
          <p className="text-gray-400 text-sm">Customer Login</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-primary-card border border-gray-700 rounded-xl p-6 shadow-xl">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">Login ID / Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-primary-light border border-gray-600 text-white placeholder-gray-500 focus:ring-2 focus:ring-accent-green focus:border-transparent"
              placeholder="your@email.com"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-primary-light border border-gray-600 text-white placeholder-gray-500 focus:ring-2 focus:ring-accent-green focus:border-transparent"
              placeholder="••••••••"
              required
            />
          </div>
          <div className="mb-4 text-right">
            <a
              href="mailto:vendor@example.com?subject=Forgot%20Password%20Request"
              className="text-sm text-accent-green hover:underline"
            >
              Forgot password?
            </a>
            <span className="text-gray-500 text-xs ml-1">(sends to vendor mail)</span>
          </div>
          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
          <button
            type="button"
            onClick={async () => {
              setLoading(true)
              setError('')
              try {
                const { data } = await auth.demoCustomer()
                login(data.access_token, data.user)
                navigate('/app')
              } catch (e) {
                setError(e.response?.data?.detail || 'Demo login failed')
              } finally {
                setLoading(false)
              }
            }}
            disabled={loading}
            className="w-full py-3 rounded-lg bg-accent-green text-primary font-semibold hover:bg-green-400 transition-colors disabled:opacity-50 mb-3"
          >
            {loading ? '...' : 'Login as Customer (Demo)'}
          </button>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg border border-gray-600 text-gray-300 font-medium hover:bg-primary-light transition-colors disabled:opacity-50"
          >
            Sign In (with email & password)
          </button>
        </form>
        <div className="mt-4 flex justify-between items-center">
          <Link to="/vendor-login" className="text-sm text-gray-400 hover:text-accent-green transition-colors">
            Vendor Login →
          </Link>
        </div>
      </div>
    </div>
  )
}

