import React from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function VendorCustomerSignup() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [form, setForm] = useState({ email: '', password: '', full_name: '', company_name: '', address: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  if (user?.role !== 'vendor') {
    navigate('/app')
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      await auth.vendorCreateCustomer(form)
      setSuccess('Customer account created. They can now log in from the main page.')
      setForm({ email: '', password: '', full_name: '', company_name: '', address: '' })
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create customer')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold text-white mb-2">Create Customer Account</h1>
      <p className="text-gray-400 text-sm mb-6">Only vendors can create customer accounts. After creation, the customer can log in from the welcome page.</p>
      <form onSubmit={handleSubmit} className="bg-primary-card border border-gray-700 rounded-xl p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email *</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password *</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-white"
              required
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">Full Name *</label>
          <input
            type="text"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-white"
            required
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">Company Name</label>
          <input
            type="text"
            value={form.company_name}
            onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-white"
          />
        </div>
        <div className="mb-6">
          <label className="block text-sm text-gray-400 mb-1">Address</label>
          <input
            type="text"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-white"
          />
        </div>
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        {success && <p className="text-accent-green text-sm mb-4">{success}</p>}
        <div className="flex gap-3">
          <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg bg-accent-green text-primary font-medium disabled:opacity-50">
            Create Customer
          </button>
          <button type="button" onClick={() => navigate('/app')} className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-primary-light">
            Back to App
          </button>
        </div>
      </form>
    </div>
  )
}

