  import React from 'react'
  import { useState, useEffect } from 'react'
  import { dispatchApi, configApi, stockApi } from '../api/client'
  import Modal from '../components/Modal'
  import PopupDialog from '../components/PopupDialog'
  import usePinGate from '../hooks/usePinGate'
  import TruckLoad from "./assets/TruckLoad.png"
  import FinishedGoods from "./assets/FinishedGoods.png"
  import chalk from "./assets/chalk.png"
  import searchIcon from "./assets/icons8-search-60.png"
  import {
    formatDateTimeIST,
    parseApiDate,
    toDateInputIST,
    todayDateInputIST,
  } from "../utils/datetime"

  // Dispatch entry, product selection, and invoice/report page.
  const EMPTY_PRODUCT = { product_type: "", num_bags: "", weight_per_bag: "" }
  const IST_TIME_ZONE = "Asia/Kolkata"
  const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
  const DEFAULT_TIME_PARTS = { hour: "12", minute: "00", meridiem: "AM" }
  const pad2 = (value) => String(value).padStart(2, "0")

  function shiftDateInput(dateInput, daysOffset) {
    if (!DATE_ONLY_RE.test(String(dateInput || ""))) return ""
    const date = new Date(`${dateInput}T00:00:00`)
    if (Number.isNaN(date.getTime())) return ""
    date.setDate(date.getDate() + Number(daysOffset || 0))
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  }

  function toApiDateTimeFromDateInputIST(dateInput, endOfDay = false) {
    if (!DATE_ONLY_RE.test(String(dateInput || ""))) return null
    return `${dateInput}T${endOfDay ? "23:59:59" : "00:00:00"}+05:30`
  }

  function getTimePartsIST(value) {
    const parsed = parseApiDate(value)
    if (!parsed) return { ...DEFAULT_TIME_PARTS }

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: IST_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(parsed)

    const out = { ...DEFAULT_TIME_PARTS }
    parts.forEach((part) => {
      if (part.type === "hour") out.hour = part.value
      if (part.type === "minute") out.minute = part.value
      if (part.type === "dayPeriod") out.meridiem = part.value.toUpperCase() === "PM" ? "PM" : "AM"
    })
    return out
  }

  function toApiDateTimeFrom12HourInput(dateInput, hourInput, minuteInput, meridiemInput) {
    if (!DATE_ONLY_RE.test(String(dateInput || ""))) return null

    const hour12 = Number(hourInput)
    const minute = Number(minuteInput)
    const meridiem = String(meridiemInput || "").toUpperCase()
    if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) return null
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null
    if (meridiem !== "AM" && meridiem !== "PM") return null

    let hour24 = hour12 % 12
    if (meridiem === "PM") hour24 += 12

    const hour = String(hour24).padStart(2, "0")
    const mins = String(minute).padStart(2, "0")
    return `${dateInput}T${hour}:${mins}:00+05:30`
  }

  function emptyDispatchForm() {
    const time = getTimePartsIST(new Date())
    return {
      date: todayDateInputIST(),
      hour: time.hour,
      minute: time.minute,
      meridiem: time.meridiem,
      party_name: '',
      party_phone: '',
      party_address: '',
      pincode: '',
      vehicle_no: '',
      products: [{ ...EMPTY_PRODUCT }],
      price: '',
    }
  }

  export default function Dispatch() {
    const [list, setList] = useState([])
    const [productTypes, setProductTypes] = useState([])
    const [availableFeedStock, setAvailableFeedStock] = useState([])
    const [stockLoading, setStockLoading] = useState(false)
    const [search, setSearch] = useState('')
    const [dateRangePreset, setDateRangePreset] = useState("today")
    const [fromDate, setFromDate] = useState("")
    const [toDate, setToDate] = useState("")
    const [monthlySummary, setMonthlySummary] = useState({
      finishedGoodsKg: 0,
      dispatchedKg: 0,
    })

    const [showAdd, setShowAdd] = useState(false)
    const [addError, setAddError] = useState('')
    const [showEdit, setShowEdit] = useState(false)
    const [editError, setEditError] = useState('')
    const [editingDispatchCode, setEditingDispatchCode] = useState(null)
    const [popupMessage, setPopupMessage] = useState('')
    const { requestPin, pinDialog } = usePinGate()

    const [filters, setFilters] = useState({ product_type: '' })
    const todayDate = todayDateInputIST()
    const monthAnchorDate = new Date(`${todayDate}T00:00:00`)
    const currentMonthLabel = new Intl.DateTimeFormat("en-IN", {
      timeZone: IST_TIME_ZONE,
      month: "long",
      year: "numeric",
    }).format(monthAnchorDate)

    const resolvedRange = (() => {
      if (dateRangePreset === "custom") {
        return {
          from: fromDate || "",
          to: toDate || "",
        }
      }
      if (dateRangePreset === "last_7") {
        return { from: shiftDateInput(todayDate, -6), to: todayDate }
      }
      if (dateRangePreset === "last_15") {
        return { from: shiftDateInput(todayDate, -14), to: todayDate }
      }
      if (dateRangePreset === "last_30") {
        return { from: shiftDateInput(todayDate, -29), to: todayDate }
      }
      return { from: todayDate, to: todayDate }
    })()
    const effectiveFromDate = resolvedRange.from
    const effectiveToDate = resolvedRange.to

    const [form, setForm] = useState(emptyDispatchForm())

    const [editForm, setEditForm] = useState(emptyDispatchForm())

    const [currentPage, setCurrentPage] = useState(1)
    const rowsPerPage = 5
useEffect(() => {
  if (dateRangePreset === "custom" && !fromDate && !toDate) {
    const today = todayDateInputIST()
    setFromDate(today)
    setToDate(today)
  }
}, [dateRangePreset])

    const filteredList = list.filter(r =>
      String(r.dispatch_code || '').toLowerCase().includes(search.toLowerCase()) ||
      r.party_name?.toLowerCase().includes(search.toLowerCase()) ||
      r.vehicle_no?.toLowerCase().includes(search.toLowerCase())
    )

    const paginatedList = filteredList.slice(
      (currentPage - 1) * rowsPerPage,
      currentPage * rowsPerPage
    )
    const editingEntry = editingDispatchCode
      ? list.find((row) => row.dispatch_code === editingDispatchCode)
      : null

    const totalPages = Math.ceil(filteredList.length / rowsPerPage)
    // const totalPages = 10

    useEffect(() => {
      setCurrentPage(1)
    }, [search, filters.product_type, dateRangePreset, fromDate, toDate])

    const load = () => {
      const period = dateRangePreset
      const productType = filters.product_type || "all"
      const params = {}
      if (period === "custom") {
        if (effectiveFromDate) params.from_date = toApiDateTimeFromDateInputIST(effectiveFromDate)
        if (effectiveToDate) params.to_date = toApiDateTimeFromDateInputIST(effectiveToDate, true)
      }

      dispatchApi.listByPeriod(period, productType, params)
        .then(({ data }) => {
          const sorted = (data || []).sort(
            (a, b) =>
              new Date(b.date) - new Date(a.date)
              || String(b.dispatch_code || '').localeCompare(String(a.dispatch_code || ''))
          )
          setList(sorted)
        })
        .catch(() => setList([]))
    }

    const loadMonthlySummary = () => {
      dispatchApi
        .summaryByPeriod("this_month", "all")
        .then(({ data }) => {
          setMonthlySummary({
            finishedGoodsKg: Number(data?.total_finished_goods_kg || 0),
            dispatchedKg: Number(data?.total_dispatched_kg || 0),
          })
        })
        .catch(() => setMonthlySummary({ finishedGoodsKg: 0, dispatchedKg: 0 }))
    }

    useEffect(() => {
      load()
      setCurrentPage(1)
    }, [filters.product_type, dateRangePreset, effectiveFromDate, effectiveToDate])

    useEffect(() => {
      loadMonthlySummary()
    }, [])

    useEffect(() => {
      configApi.productTypes().then(({ data }) => setProductTypes(Array.isArray(data) ? data : [])).catch(() => setProductTypes([]))
    }, [])

    const loadAvailableFeedStock = () => {
      setStockLoading(true)
      stockApi
        .feedSummary()
        .then(({ data }) => {
          const rows = Array.isArray(data) ? data : []
          const availableRows = rows
            .map((row) => {
              const bagWeightKg = row?.bag_weight_kg == null ? null : Number(row.bag_weight_kg)
              const quantityKg = Number(row?.quantity || 0)
              const availableBags =
                Number.isFinite(bagWeightKg) && bagWeightKg > 0
                  ? quantityKg / bagWeightKg
                  : null
              return {
                feed_type: String(row?.feed_type || '').trim(),
                feed_variant: String(row?.feed_variant || row?.feed_type || '').trim(),
                bag_weight_kg: bagWeightKg,
                quantity: quantityKg,
                available_bags: availableBags,
              }
            })
            .filter((row) => row.feed_variant && Number.isFinite(row.quantity) && row.quantity > 0)
            .sort((a, b) => b.quantity - a.quantity)
          setAvailableFeedStock(availableRows)
        })
        .catch(() => setAvailableFeedStock([]))
        .finally(() => setStockLoading(false))
    }

    useEffect(() => {
      if (!showAdd && !showEdit) return
      loadAvailableFeedStock()
    }, [showAdd, showEdit])

    const formatBagWeightOption = (value) => {
      const num = Number(value)
      if (!Number.isFinite(num) || num <= 0) return ''
      if (Number.isInteger(num)) return String(num)
      return num.toFixed(3).replace(/\.?0+$/, '')
    }

    const getBagWeightOptionsForProduct = (productType) => {
      const selectedType = String(productType || '').trim()
      if (!selectedType) return []

      const seen = new Set()
      const options = []
      availableFeedStock.forEach((row) => {
        const rowType = String(row?.feed_type || '').trim()
        const bagWeight = Number(row?.bag_weight_kg)
        if (rowType !== selectedType || !Number.isFinite(bagWeight) || bagWeight <= 0) return
        const normalizedWeight = formatBagWeightOption(bagWeight)
        if (!normalizedWeight || seen.has(normalizedWeight)) return
        seen.add(normalizedWeight)
        options.push({
          value: normalizedWeight,
          label: `${normalizedWeight} kg`,
        })
      })

      return options.sort((a, b) => Number(a.value) - Number(b.value))
    }

    const addProductRow = (isEdit = false) => {
      if (isEdit) {
        setEditForm((prev) => ({
          ...prev,
          products: [...prev.products, { ...EMPTY_PRODUCT }],
        }))
      } else {
        setForm((prev) => ({
          ...prev,
          products: [...prev.products, { ...EMPTY_PRODUCT }],
        }))
      }
    }

    const removeProductRow = (index, isEdit = false) => {
      if (isEdit) {
        setEditForm((prev) => ({
          ...prev,
          products: prev.products.length === 1
            ? [{ ...EMPTY_PRODUCT }]
            : prev.products.filter((_, i) => i !== index),
        }))
      } else {
        setForm((prev) => ({
          ...prev,
          products: prev.products.length === 1
            ? [{ ...EMPTY_PRODUCT }]
            : prev.products.filter((_, i) => i !== index),
        }))
      }
    }

    const updateProductRow = (index, field, value, isEdit = false) => {
      const applyUpdate = (prev) => ({
        ...prev,
        products: prev.products.map((row, i) => {
          if (i !== index) return row
          if (field !== "product_type") {
            return { ...row, [field]: value }
          }
          const selectedType = String(value || "")
          const options = getBagWeightOptionsForProduct(selectedType)
          const currentWeight = String(row?.weight_per_bag || "").trim()
          const keepCurrent = options.some((item) => item.value === currentWeight)
          return {
            ...row,
            product_type: selectedType,
            weight_per_bag: keepCurrent ? currentWeight : "",
          }
        }),
      })

      if (isEdit) {
        setEditForm(applyUpdate)
      } else {
        setForm(applyUpdate)
      }
    }

    const handleAdd = async (e) => {
      e.preventDefault()
      setAddError('')
      const dispatchDateTime = toApiDateTimeFrom12HourInput(form.date, form.hour, form.minute, form.meridiem)
      if (!dispatchDateTime) {
        setAddError('Please enter a valid dispatch date and time.')
        return
      }
      try {
        // Validate products
        if (!form.products || form.products.length === 0) {
          setAddError('At least one product is required')
          return
        }
        for (const prod of form.products) {
          if (!prod.product_type) {
            setAddError('Product type is required for all rows')
            return
          }
          if (!prod.num_bags || parseFloat(prod.num_bags) <= 0) {
            setAddError('Number of bags must be greater than 0')
            return
          }
          if (!prod.weight_per_bag || parseFloat(prod.weight_per_bag) <= 0) {
            setAddError('Weight per bag must be greater than 0')
            return
          }
        }

        await dispatchApi.create({
          date: dispatchDateTime,
          party_name: form.party_name,
          party_phone: form.party_phone,
          party_address: form.party_address,
          pincode: form.pincode,
          vehicle_no: form.vehicle_no,
          products: form.products.map(p => ({
            product_type: p.product_type,
            num_bags: parseFloat(p.num_bags),
            weight_per_bag: parseFloat(p.weight_per_bag),
          })),
          price: form.price ? parseFloat(form.price) : null,
        })
        setShowAdd(false)
        setForm(emptyDispatchForm())
        setAddError('')
        load()
        loadMonthlySummary()
      } catch (err) {
        const detail = err?.response?.data?.detail || 'Unable to create dispatch entry.'
        setAddError(detail)
      }
    }

    const openEdit = (row) => {
      const time = getTimePartsIST(row.date)
      setEditingDispatchCode(row.dispatch_code)
      setEditForm({
        date: toDateInputIST(row.date, todayDateInputIST()),
        hour: time.hour,
        minute: time.minute,
        meridiem: time.meridiem,
        party_name: row.party_name || '',
        party_phone: row.party_phone || '',
        party_address: row.party_address || '',
        pincode: row.pincode || '',
        vehicle_no: row.vehicle_no || '',
        products: (row.products || []).map(p => ({
          id: p.id,
          product_type: p.product_type,
          num_bags: String(p.num_bags),
          weight_per_bag: String(p.weight_per_bag),
        })),
        price: row.price != null ? String(row.price) : '',
      })
      setShowEdit(true)
    }

    const handleEdit = async (e) => {
      e.preventDefault()
      setEditError('')
      if (!editingDispatchCode) return
      const dispatchDateTime = toApiDateTimeFrom12HourInput(editForm.date, editForm.hour, editForm.minute, editForm.meridiem)
      if (!dispatchDateTime) {
        setEditError('Please enter a valid dispatch date and time.')
        return
      }
      try {
        // Validate products
        if (!editForm.products || editForm.products.length === 0) {
          setEditError('At least one product is required')
          return
        }
        for (const prod of editForm.products) {
          if (!prod.product_type) {
            setEditError('Product type is required for all rows')
            return
          }
          if (!prod.num_bags || parseFloat(prod.num_bags) <= 0) {
            setEditError('Number of bags must be greater than 0')
            return
          }
          if (!prod.weight_per_bag || parseFloat(prod.weight_per_bag) <= 0) {
            setEditError('Weight per bag must be greater than 0')
            return
          }
        }

        await dispatchApi.update(editingDispatchCode, {
          date: dispatchDateTime,
          party_name: editForm.party_name,
          party_phone: editForm.party_phone,
          party_address: editForm.party_address,
          pincode: editForm.pincode,
          vehicle_no: editForm.vehicle_no,
          products: editForm.products.map(p => ({
            id: p.id,
            product_type: p.product_type,
            num_bags: parseFloat(p.num_bags),
            weight_per_bag: parseFloat(p.weight_per_bag),
          })),
          price: editForm.price ? parseFloat(editForm.price) : null,
        })
        setShowEdit(false)
        setEditingDispatchCode(null)
        setEditError('')
        load()
        loadMonthlySummary()
      } catch (err) {
        const detail = err?.response?.data?.detail || 'Unable to update dispatch entry.'
        setEditError(detail)
      }
    }



    const download = (format) => {
      const params = {}
      if (effectiveFromDate) params.from_date = toApiDateTimeFromDateInputIST(effectiveFromDate)
      if (effectiveToDate) params.to_date = toApiDateTimeFromDateInputIST(effectiveToDate, true)
      if (filters.product_type) params.product_type = filters.product_type

      dispatchApi.download(format, params).then(({ data }) => {
        const ext = format === 'pdf' ? 'pdf' : format === 'xlsx' || format === 'excel' ? 'xlsx' : 'csv'
        const url = URL.createObjectURL(new Blob([data]))
        const a = document.createElement('a')
        a.href = url
        a.download = `dispatch_report.${ext}`
        a.click()
        URL.revokeObjectURL(url)
      })
    }

    const downloadEntry = (dispatchCode, format) => {
      dispatchApi.downloadEntry(dispatchCode, format).then(({ data }) => {
        const ext = format === 'pdf' ? 'pdf' : 'xlsx'
        const url = URL.createObjectURL(new Blob([data]))
        const a = document.createElement('a')
        a.href = url
        a.download = `dispatch_${dispatchCode}_report.${ext}`
        a.click()
        URL.revokeObjectURL(url)
      })
    }

    const downloadInvoice = (dispatchCode) => {
      dispatchApi.downloadInvoice(dispatchCode).then(({ data }) => {
        const url = URL.createObjectURL(new Blob([data]))
        const a = document.createElement('a')
        a.href = url
        a.download = `invoice_${dispatchCode}.pdf`
        a.click()
        URL.revokeObjectURL(url)
      }).catch(() => setPopupMessage('Failed to download invoice.'))
    }

    const formatMt = (valueKg) => {
      const safeKg = Math.max(0, Number(valueKg) || 0)
      return Number((safeKg / 1000).toFixed(3))
    }

    const summaryCards = [
      {
        title: "Total Finished Goods",
        value: formatMt(monthlySummary.finishedGoodsKg),
        unit: "MT",
        bg: FinishedGoods,
      },
      {
        title: "Total Dispatched",
        value: formatMt(monthlySummary.dispatchedKg),
        unit: "MT",
        bg: TruckLoad,
      },
    ]

const resetAddModal = () => {
  setShowAdd(false)
  setAddError("")
  setForm(emptyDispatchForm())
}

const resetEditModal = () => {
  setShowEdit(false)
  setEditError("")
  setEditingDispatchCode(null)
  setEditForm(emptyDispatchForm())
}
    return (
      <div className="space-y-6">
        {/* SUMMARY CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {summaryCards.map((card, i) => (
            <div key={i} className="relative rounded-xl overflow-hidden shadow-md h-36 sm:h-40">
              <img src={card.bg} alt="bg" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute top-2 right-3 z-20 text-[11px] sm:text-xs font-bold text-orange-900 bg-white border border-orange-950 px-2 py-0.5 rounded">
    {currentMonthLabel}
  </div>
              <div className="absolute top-0 left-0 w-full h-10">
                <img src={chalk} alt="texture" className="w-full h-full object-cover opacity-60" />
              </div>
              <div className="relative z-10 flex items-center h-full px-4">
                <div>
                  {/* <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-800">
                    {currentMonthLabel}
                  </p> */}
                  <div className="flex items-center gap-2 text-orange-900 font-semibold text-xl">
                    <span>{card.title}</span>
                  </div>
                  <div className="mt-2 flex items-end gap-2">
                    <span className="text-3xl sm:text-4xl font-bold text-orange-900">{card.value}</span>
                    <span className="text-lg font-semibold text-orange-800">{card.unit}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ACTION BUTTONS */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-xl font-semibold text-slate-800">Dispatch</h1>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowAdd(true)} className="px-4 py-2 rounded-lg bg-[#245658] text-white font-medium">+ New Dispatch</button>
            <button onClick={() => download('pdf')} className="px-4 py-2 rounded-lg border border-gray-600 text-gray-800 hover:bg-gray-100">Download PDF</button>
            <button onClick={() => download('xlsx')} className="px-4 py-2 rounded-lg border border-gray-600 text-gray-800 hover:bg-gray-100">Download Excel</button>
          </div>
        </div>

        {/* TABLE */}
        <div className="bg-white rounded-xl shadow border border-gray-300 overflow-hidden">
          <div className="p-4 bg-white border-b border-gray-300 flex flex-wrap  gap-4">
             <div className="w-full md:w-64">
              <label className="block text-xs text-gray-500 mb-1">Search</label>
              <div className="relative">
                <img src={searchIcon} alt="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-60" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="pl-9 pr-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm w-full"
                />
              </div>
            </div>


            <div>
              <label className="block text-xs text-gray-500 mb-1">Product Type</label>
              <select value={filters.product_type} onChange={(e) => setFilters((f) => ({ ...f, product_type: e.target.value }))}  className="w-full max-w-[300px] truncate whitespace-nowrap overflow-hidden text-ellipsis px-3 py-2 rounded-lg border border-gray-300 text-gray-800 text-sm bg-white min-w-[150px]">
                <option value="">All</option>
                {productTypes.map((t) => {
                    const shortText = t.length > 25 ? t.slice(0, 25) + "..." : t
                    return (
                    <option key={t} value={t}>
                      {shortText}
                    </option>
                  )
                })}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Period</label>
              <select
                value={dateRangePreset}
                onChange={(e) => setDateRangePreset(e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm min-w-[150px]"
              >
                <option value="today">Today</option>
                <option value="last_7">Last 7 Days</option>
                <option value="last_15">Last 15 Days</option>
                <option value="last_30">Last 30 Days</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            {dateRangePreset === "custom" && (
              <>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date From</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date To</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm"
                  />
                </div>
              </>
            )}
          
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-[#2F5D5D] text-white">
                  <th className="px-4 py-3 text-left border border-gray-300">Dispatch Code</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Date</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Party Name</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Vehicle No</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Products</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Total Bags</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Total Weight</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Price</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Action</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Download</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {paginatedList.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-4 text-gray-500 border border-gray-300">No dispatch entries found.</td>
                  </tr>
                )}
                {paginatedList.map((r) => (
                  <tr key={r.dispatch_code} className="border-b border-gray-700/50">
                    <td className="px-4 py-3 border border-gray-300 font-medium">{r.dispatch_code}</td>
                    <td className="px-4 py-3 border border-gray-300">{formatDateTimeIST(r.date)}</td>
                    <td className="px-4 py-3 border border-gray-300">{r.party_name}</td>
                    <td className="px-4 py-3 border border-gray-300">{r.vehicle_no}</td>
                    <td className="px-4 py-3 border border-gray-300 text-xs">
                      {(r.products || []).map((p, i) => (
                        <div key={i} className="mb-1 break-all">
                          {p.product_type} ({p.num_bags} bags × {p.weight_per_bag} kg)
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-3 border border-gray-300">{r.total_bags}</td>
                    <td className="px-4 py-3 border border-gray-300">{r.total_weight}</td>
                    <td className="px-4 py-3 border border-gray-300">{r.price != null ? r.price : '—'}</td>
                    <td className="px-4 py-3 border border-gray-300">
                      <button
                        onClick={() => requestPin(
                          () => openEdit(r),
                          {
                            title: 'PIN Required',
                            message: 'Enter PIN to edit (1234) dispatch entry.',
                            pinType: 'dispatch_edit',
                          }
                        )}
                        className="px-2 py-1 text-xs border rounded  bg-gray-600 text-white font-semibold hover:bg-gray-700"
                      >
                        Edit
                      </button>
                    </td>
                    <td className="px-4 py-3 border border-gray-300">
                      <div className="flex gap-2">
                        <button
                          onClick={() => downloadEntry(r.dispatch_code, 'pdf')}
                          className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                        >
                          PDF
                        </button>
                        <button
                          onClick={() => downloadEntry(r.dispatch_code, 'xlsx')}
                          className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Excel
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 border border-gray-300">
                      <button
                        onClick={() => downloadInvoice(r.dispatch_code)}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                      >
                        Invoice
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* PAGINATION */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-300">
            <span className="text-sm text-gray-600">
              Page {currentPage} of {totalPages || 1}
            </span>
            <div className="flex gap-1">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-40"
              >
                ◀
              </button>
      {(() => {
  let pages = [currentPage - 1, currentPage, currentPage + 1];

 
  if (currentPage <= 2) {
    pages = [1, 2, 3];
  }


  if (currentPage >= totalPages - 1) {
    pages = [totalPages - 2, totalPages - 1, totalPages];
  }

  return pages
    .filter((p) => p >= 1 && p <= totalPages)
    .map((p) => (
      <button
        key={p}
        onClick={() => setCurrentPage(p)}
        className={`px-3 py-1 border rounded ${
          currentPage === p
            ? "bg-[#2F5D5D] text-white"
            : "bg-white"
        }`}
      >
        {p}
      </button>
    ));
})()}
              <button
                disabled={currentPage >= (totalPages || 1)}
                onClick={() => setCurrentPage(p => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ▶
              </button>
            </div>
          </div>
        </div>

        {/* ADD MODAL */}
        <Modal open={showAdd} onClose={resetAddModal} title="New Dispatch Entry">
          <form onSubmit={handleAdd} className="space-y-4 p-2 sm:pb-4 md:pb-9">
            <div className="bg-gray-100 border border-gray-300 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-700">Available Stock (Dispatchable)</p>
                {stockLoading && <span className="text-xs text-gray-500">Loading...</span>}
              </div>
              {availableFeedStock.length === 0 ? (
                <p className="text-sm text-gray-500">No available stock (greater than 0 kg).</p>
              ) : (
                <div className="max-h-40 overflow-y-auto overflow-x-auto rounded border border-gray-300">
                  <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-200 text-gray-700">
                          <th className="px-3 py-2 text-left border-b border-gray-300">Product Variant</th>
                          <th className="px-3 py-2 text-right border-b border-gray-300">No. of Bags Available</th>
                          <th className="px-3 py-2 text-right border-b border-gray-300">Weight/Bag</th>
                          <th className="px-3 py-2 text-right border-b border-gray-300">Weight Available (kg)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {availableFeedStock.map((row) => (
                          <tr key={`available-stock-${row.feed_variant}-${row.bag_weight_kg ?? 'na'}`} className="bg-gray-50 text-gray-700 border-b border-gray-200 last:border-b-0">
                            <td className="px-3 py-2">{row.feed_variant}</td>
                            <td className="px-3 py-2 text-right">{row.available_bags == null ? 'N/A' : row.available_bags.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right">{row.bag_weight_kg == null ? 'N/A' : `${formatBagWeightOption(row.bag_weight_kg)}/bag`}</td>
                            <td className="px-3 py-2 text-right font-medium">{row.quantity.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                </div>
              )}
            </div>

            {addError && (
              <div className="bg-red-100 text-red-800 px-4 py-3 rounded-lg text-sm border border-red-300 whitespace-pre-wrap">
                {addError}
              </div>
            )}
         <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_1.5fr] gap-4">
              <div>
                <label className="block text-sm text-black mb-1">Date</label>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" required />
              </div>
              <div>
                <label className="block text-sm text-black mb-1">Entry Time</label>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={form.hour}
                    onChange={(e) => setForm((f) => ({ ...f, hour: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black"
                    required
                  >
                    {Array.from({ length: 12 }, (_, index) => {
                      const value = String(index + 1).padStart(2, "0")
                      return <option key={value} value={value}>{value}</option>
                    })}
                  </select>
                  <select
                    value={form.minute}
                    onChange={(e) => setForm((f) => ({ ...f, minute: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black"
                    required
                  >
                    {Array.from({ length: 60 }, (_, index) => {
                      const value = String(index).padStart(2, "0")
                      return <option key={value} value={value}>{value}</option>
                    })}
                  </select>
                  <select
                    value={form.meridiem}
                    onChange={(e) => setForm((f) => ({ ...f, meridiem: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black"
                    required
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </div>
              
              <div>
                <label className="block text-sm text-black mb-1">Vehicle No</label>
                <input type="text" value={form.vehicle_no} onChange={(e) => setForm((f) => ({ ...f, vehicle_no: e.target.value }))}  placeholder="Vehicle number" className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" required />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-black mb-1">Party Name</label>
                <input type="text" value={form.party_name} onChange={(e) => setForm((f) => ({ ...f, party_name: e.target.value }))} placeholder="Party name" className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" required />
              </div>
              <div>
                <label className="block text-sm text-black mb-1">Party Phone</label>
                <input type="text" value={form.party_phone} onChange={(e) => setForm((f) => ({ ...f, party_phone: e.target.value }))} placeholder="Phone number" className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" />
              </div>
              <div>
                <label className="block text-sm text-black mb-1">Party Address</label>
                <input type="text" value={form.party_address} onChange={(e) => setForm((f) => ({ ...f, party_address: e.target.value }))} placeholder="Full address" className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" />
              </div>
              <div>
                <label className="block text-sm text-black mb-1">Pincode</label>
                <input type="text" value={form.pincode} onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value }))} placeholder="Pincode" className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" />
              </div>
            </div>

            {/* PRODUCTS TABLE */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm text-black font-medium">Products</label>
                <button
                  type="button"
                  onClick={() => addProductRow()}
                  className="px-2 py-1 rounded border border-gray-600 text-sm text-black hover:bg-gray-100"
                >
                  + Add Product
                </button>
              </div>
              <div className="overflow-x-auto border border-gray-300 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100 border-b border-gray-300">
                      <th className="px-3 py-2 text-left">Product Type</th>
                      <th className="px-3 py-2 text-left">No. of Bags</th>
                      <th className="px-3 py-2 text-left">Weight/Bag (kg)</th>
                      <th className="px-3 py-2 text-left">Total Weight (kg)</th>
                      <th className="px-3 py-2 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.products.map((product, index) => {
                      const totalWeight = (parseFloat(product.num_bags) || 0) * (parseFloat(product.weight_per_bag) || 0)
                      const bagWeightOptions = getBagWeightOptionsForProduct(product.product_type)
                      const selectedBagWeight = String(product.weight_per_bag || '')
                      const bagWeightChoices = [...bagWeightOptions]
                      if (selectedBagWeight && !bagWeightChoices.some((item) => item.value === selectedBagWeight)) {
                        bagWeightChoices.unshift({
                          value: selectedBagWeight,
                          label: `${selectedBagWeight} kg (current)`,
                        })
                      }
                      return (
                        <tr key={index} className="border-b border-gray-300 hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <select
                              value={product.product_type}
                              onChange={(e) => updateProductRow(index, "product_type", e.target.value)}
                              className="w-full min-w-180 px-2 py-1 rounded border border-gray-300 text-sm"
                              required
                            >
                              <option value="">Select</option>
                              {productTypes.map((t) => {
                                const shortText = t.length > 25 ? t.slice(0, 25) + "..." : t
                                return (
                                  <option key={t} value={t}>{shortText}</option>
                                )
                              })}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder='No of Bags'
                              value={product.num_bags}
                              onChange={(e) => updateProductRow(index, "num_bags", e.target.value)}
                              className="w-full px-2 py-1 rounded border border-gray-300 text-sm"
                              required
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={selectedBagWeight}
                              onChange={(e) => updateProductRow(index, "weight_per_bag", e.target.value)}
                              className="w-full min-w-[180px]  px-2 py-1 rounded border border-gray-300 text-sm"
                              disabled={!product.product_type || bagWeightChoices.length === 0}
                              required
                            >
                              <option value="">
                                {!product.product_type
                                  ? "Select product first"
                                  : stockLoading
                                  ? "Loading bag sizes..."
                                  : bagWeightChoices.length === 0
                                  ? "No bag sizes available"
                                  : "Select bag weight"}
                              </option>
                              {bagWeightChoices.map((option) => (
                                <option key={`add-bag-weight-${index}-${option.value}`} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 bg-gray-50 text-center font-medium">
                            {isNaN(totalWeight) ? "—" : totalWeight.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => removeProductRow(index)}
                              className="px-2 py-1 text-xs rounded border border-red-300 text-red-700 hover:bg-red-50"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    {form.products.length > 0 && (
                      <tr className="bg-gray-100 border-t-2 border-gray-300">
                        <td colSpan="3" className="px-3 py-2 font-medium text-right">Total:</td>
                        <td className="px-3 py-2 font-bold text-center">
                          {form.products.reduce((sum, p) => sum + ((parseFloat(p.num_bags) || 0) * (parseFloat(p.weight_per_bag) || 0)), 0).toFixed(2)}
                        </td>
                        <td></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-black mb-1">Price (Optional)</label>
                <input type="number" step="any" placeholder="Price" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" />
              </div>
            </div>

            <p className="text-gray-500 text-sm">Dispatch is subtracted from Stock and added to Dispatch Report.</p>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#245658] text-white font-medium">Save Dispatch</button>
              <button type="button" onClick={resetAddModal} className="px-4 py-2 rounded-lg border border-gray-400 text-black">Cancel</button>
            </div>
          </form>
        </Modal>

        {/* EDIT MODAL */}
        <Modal open={showEdit} onClose={resetEditModal} title="Edit Dispatch Entry">
          <div className="relative">
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="bg-gray-100 border border-gray-300 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-gray-700">Available Stock (Dispatchable)</p>
                  {stockLoading && <span className="text-xs text-gray-500">Loading...</span>}
                </div>
                {availableFeedStock.length === 0 ? (
                  <p className="text-sm text-gray-500">No available stock (greater than 0 kg).</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto overflow-x-auto rounded border border-gray-300">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-200 text-gray-700">
                          <th className="px-3 py-2 text-left border-b border-gray-300">Product Variant</th>
                          <th className="px-3 py-2 text-right border-b border-gray-300">No. of Bags Available</th>
                          <th className="px-3 py-2 text-right border-b border-gray-300">Weight/Bag</th>
                          <th className="px-3 py-2 text-right border-b border-gray-300">Weight Available (kg)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {availableFeedStock.map((row) => (
                          <tr key={`available-stock-edit-${row.feed_variant}-${row.bag_weight_kg ?? 'na'}`} className="bg-gray-50 text-gray-700 border-b border-gray-200 last:border-b-0">
                            <td className="px-3 py-2">{row.feed_variant}</td>
                            <td className="px-3 py-2 text-right">{row.available_bags == null ? 'N/A' : row.available_bags.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right">{row.bag_weight_kg == null ? 'N/A' : `${formatBagWeightOption(row.bag_weight_kg)}/bag`}</td>
                            <td className="px-3 py-2 text-right font-medium">{row.quantity.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {editError && (
                <div className="bg-red-100 text-red-800 px-4 py-3 rounded-lg text-sm border border-red-300 whitespace-pre-wrap">
                  {editError}
                </div>
              )}
              {editingEntry && (
                <p className="text-xs text-gray-600">
                  Entry Date: {formatDateTimeIST(editingEntry.date)} | Last Modified: {formatDateTimeIST(editingEntry.last_modified_at)}
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-black mb-1">Date</label>
                <input type="date" value={editForm.date} onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" required />
              </div>
              <div>
                <label className="block text-sm text-black mb-1">Entry Time</label>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={editForm.hour}
                    onChange={(e) => setEditForm((f) => ({ ...f, hour: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800"
                    required
                  >
                    {Array.from({ length: 12 }, (_, index) => {
                      const value = String(index + 1).padStart(2, "0")
                      return <option key={value} value={value}>{value}</option>
                    })}
                  </select>
                  <select
                    value={editForm.minute}
                    onChange={(e) => setEditForm((f) => ({ ...f, minute: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800"
                    required
                  >
                    {Array.from({ length: 60 }, (_, index) => {
                      const value = String(index).padStart(2, "0")
                      return <option key={value} value={value}>{value}</option>
                    })}
                  </select>
                  <select
                    value={editForm.meridiem}
                    onChange={(e) => setEditForm((f) => ({ ...f, meridiem: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800"
                    required
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm text-black mb-1">Party Name</label>
                <input type="text" value={editForm.party_name} onChange={(e) => setEditForm((f) => ({ ...f, party_name: e.target.value }))} placeholder="Party name" className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" required />
              </div>
            
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                <label className="block text-sm text-black mb-1">Vehicle No</label>
                <input type="text" value={editForm.vehicle_no} onChange={(e) => setEditForm((f) => ({ ...f, vehicle_no: e.target.value }))} placeholder="Vehicle number" className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" required />
              </div>
              <div>
                <label className="block text-sm text-black mb-1">Party Phone</label>
                <input type="text" value={editForm.party_phone} onChange={(e) => setEditForm((f) => ({ ...f, party_phone: e.target.value }))} placeholder="Phone number" className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" />
              </div>
              <div>
                <label className="block text-sm text-black mb-1">Party Address</label>
                <input type="text" value={editForm.party_address} onChange={(e) => setEditForm((f) => ({ ...f, party_address: e.target.value }))} placeholder="Full address" className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" />
              </div>
              <div>
                <label className="block text-sm text-black mb-1">Pincode</label>
                <input type="text" value={editForm.pincode} onChange={(e) => setEditForm((f) => ({ ...f, pincode: e.target.value }))} placeholder="Pincode" className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" />
              </div>
            </div>

            {/* PRODUCTS TABLE */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm text-black font-medium">Products</label>
                <button
                  type="button"
                  onClick={() => addProductRow(true)}
                  className="px-2 py-1 rounded border border-gray-600 text-sm text-black hover:bg-gray-100"
                >
                  + Add Product
                </button>
              </div>
              <div className="overflow-x-auto border border-gray-300 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100 border-b border-gray-300">
                      <th className="px-3 py-2 text-left">Product Type</th>
                      <th className="px-3 py-2 text-left">No. of Bags</th>
                      <th className="px-3 py-2 text-left">Weight/Bag (kg)</th>
                      <th className="px-3 py-2 text-left">Total Weight (kg)</th>
                      <th className="px-3 py-2 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editForm.products.map((product, index) => {
                      const totalWeight = (parseFloat(product.num_bags) || 0) * (parseFloat(product.weight_per_bag) || 0)
                      const bagWeightOptions = getBagWeightOptionsForProduct(product.product_type)
                      const selectedBagWeight = String(product.weight_per_bag || '')
                      const bagWeightChoices = [...bagWeightOptions]
                      if (selectedBagWeight && !bagWeightChoices.some((item) => item.value === selectedBagWeight)) {
                        bagWeightChoices.unshift({
                          value: selectedBagWeight,
                          label: `${selectedBagWeight} kg (current)`,
                        })
                      }
                      return (
                        <tr key={index} className="border-b border-gray-300 ">
                          <td className="px-3 py-2">
                            <select
                              value={product.product_type}
                              onChange={(e) => updateProductRow(index, "product_type", e.target.value, true)}
                              className="w-full px-2 py-1 rounded border border-gray-300 text-sm"
                              required
                            >
                              <option value="">Select</option>
                              {productTypes.map((t) => {
                                const shortText = t.length > 25 ? `${t.substring(0, 25)}...` : t
                                return (
                                  <option key={t} value={t}>
                                    {shortText}
                                  </option>
                                )
                              })}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={product.num_bags}
                              onChange={(e) => updateProductRow(index, "num_bags", e.target.value, true)}
                              className="w-full px-2 py-1 rounded border border-gray-300 text-sm"
                              required
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={selectedBagWeight}
                              onChange={(e) => updateProductRow(index, "weight_per_bag", e.target.value, true)}
                              className="w-full min-w-[180px] px-2 py-1 rounded border border-gray-300 text-sm"
                              disabled={!product.product_type || bagWeightChoices.length === 0}
                              required
                            >
                              <option value="">
                                {!product.product_type
                                  ? "Select product first"
                                  : stockLoading
                                  ? "Loading bag sizes..."
                                  : bagWeightChoices.length === 0
                                  ? "No bag sizes available"
                                  : "Select bag weight"}
                              </option>
                              {bagWeightChoices.map((option) => (
                                <option key={`edit-bag-weight-${index}-${option.value}`} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 bg-gray-50 text-center font-medium">
                            {isNaN(totalWeight) ? "—" : totalWeight.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => removeProductRow(index, true)}
                              className="px-2 py-1 text-xs rounded border border-red-300 text-red-700 hover:bg-red-50"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    {editForm.products.length > 0 && (
                      <tr className="bg-gray-100 border-t-2 border-gray-300">
                        <td colSpan="3" className="px-3 py-2 font-medium text-right">Total:</td>
                        <td className="px-3 py-2 font-bold text-center">
                          {editForm.products.reduce((sum, p) => sum + ((parseFloat(p.num_bags) || 0) * (parseFloat(p.weight_per_bag) || 0)), 0).toFixed(2)}
                        </td>
                        <td></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-black mb-1">Price (Optional)</label>
                <input type="number" step="any" placeholder="Price" value={editForm.price} onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-slate-800" />
              </div>
            </div>

              <div className="flex gap-2">
                <button type="submit" className="px-4 py-2 rounded-lg bg-[#245658] text-white font-medium">Update Dispatch</button>
                <button type="button" onClick={resetEditModal} className="px-4 py-2 rounded-lg border border-gray-400 text-black">Cancel</button>
              </div>
              {editingEntry && (
                <div className="text-right text-xs text-gray-600">
                  Created At: {formatDateTimeIST(editingEntry.created_at)}
                </div>
              )}
            </form>
          </div>
        </Modal>

        <PopupDialog
          open={Boolean(popupMessage)}
          title="Error"
          message={popupMessage}
          onClose={() => setPopupMessage('')}
        />
        {pinDialog}
      </div>
    )
  }
