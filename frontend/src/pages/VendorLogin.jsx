import React from 'react'
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { auth } from '../api/client'
import { useAuth } from '../context/AuthContext'

function getErrorMsg(err) {
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => x.msg || x.message).join(', ')
  return 'Login failed'
}

export default function VendorLogin() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [registerForm, setRegisterForm] = useState({ email: '', password: '', full_name: '', company_name: '' })
  const [registerSuccess, setRegisterSuccess] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setRegisterSuccess('')
    setLoading(true)
    try {
      const { data } = await auth.login(email, password)
      if (data.user.role !== 'vendor') {
        setError('This login is for vendors only. Use the main page for customer login.')
        setLoading(false)
        return
      }
      login(data.access_token, data.user)
      navigate('/app/vendor/customer-signup', { replace: true })
    } catch (err) {
      setError(getErrorMsg(err) + (err.response?.status === 401 ? ' Create a vendor account below if you don\'t have one.' : ''))
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')
    setRegisterSuccess('')
    setLoading(true)
    try {
      await auth.vendorSignup(registerForm)
      setRegisterSuccess('Vendor account created. You can now sign in above.')
      setShowRegister(false)
      setRegisterForm({ email: '', password: '', full_name: '', company_name: '' })
    } catch (err) {
      setError(getErrorMsg(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-primary flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Vendor Login</h1>
          <p className="text-gray-400 text-sm">Sign in to create customer accounts</p>
        </div>
        <form onSubmit={handleLogin} className="bg-primary-card border border-gray-700 rounded-xl p-6 shadow-xl">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-primary-light border border-gray-600 text-white placeholder-gray-500 focus:ring-2 focus:ring-accent-green"
              placeholder="vendor@example.com"
              required
            />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-primary-light border border-gray-600 text-white focus:ring-2 focus:ring-accent-green"
              required
            />
          </div>
          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
          {registerSuccess && <p className="text-green-400 text-sm mb-4">{registerSuccess}</p>}
          <button
            type="button"
            onClick={async () => {
              setLoading(true)
              setError('')
              try {
                const { data } = await auth.demoVendor()
                login(data.access_token, data.user)
                navigate('/app')
              } catch (e) {
                setError(e.response?.data?.detail || 'Demo login failed')
              } finally {
                setLoading(false)
              }
            }}
            disabled={loading}
            className="w-full py-3 rounded-lg bg-accent-green text-primary font-semibold hover:bg-green-400 disabled:opacity-50 mb-3"
          >
            {loading ? '...' : 'Login as Vendor (Demo)'}
          </button>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg border border-gray-600 text-gray-300 font-medium hover:bg-primary-light disabled:opacity-50"
          >
            Vendor Sign In (with email & password)
          </button>
        </form>
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => { setShowRegister(!showRegister); setError(''); setRegisterSuccess(''); }}
            className="text-sm text-accent-green hover:underline"
          >
            {showRegister ? 'Hide registration' : "Don't have an account? Register as vendor"}
          </button>
        </div>
        {showRegister && (
          <form onSubmit={handleRegister} className="mt-6 bg-primary-card border border-gray-700 rounded-xl p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-4">Register as vendor</h2>
            <div className="mb-3">
              <label className="block text-sm text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={registerForm.email}
                onChange={(e) => setRegisterForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-white"
                required
              />
            </div>
            <div className="mb-3">
              <label className="block text-sm text-gray-400 mb-1">Password</label>
              <input
                type="password"
                value={registerForm.password}
                onChange={(e) => setRegisterForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-white"
                required
              />
            </div>
            <div className="mb-3">
              <label className="block text-sm text-gray-400 mb-1">Full name</label>
              <input
                type="text"
                value={registerForm.full_name}
                onChange={(e) => setRegisterForm((f) => ({ ...f, full_name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-white"
                required
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Company name</label>
              <input
                type="text"
                value={registerForm.company_name}
                onChange={(e) => setRegisterForm((f) => ({ ...f, company_name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-white"
              />
            </div>
            <button type="submit" disabled={loading} className="w-full py-2 rounded-lg bg-accent-green text-primary font-medium disabled:opacity-50">
              Create vendor account
            </button>
          </form>
        )}
        <div className="mt-4 text-center">
          <Link to="/" className="text-sm text-gray-400 hover:text-white">← Back to Customer Login</Link>
        </div>
      </div>
    </div>
  )
}

