  import React from 'react'
  import { useState, useEffect } from 'react'
  import { rawMaterial, stockApi } from '../api/client'
  import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
  import {
    formatDateIST,
    toApiDateTimeFromDateInput,
    todayDateInputIST,
  } from "../utils/datetime";

  // Stock summary, ledger, and downloadable report page.
  const STOCK_RANGE_OPTIONS = [
    { value: 'today', label: 'Today' },
    { value: 'last_7_days', label: 'Last 7 Days' },
    { value: 'last_15_days', label: 'Last 15 Days' },
    { value: 'last_30_days', label: 'Last 30 Days' },
    { value: 'custom', label: 'Custom' },
  ]

  const shiftDateInput = (dateInput, days) => {
    const parsed = new Date(`${dateInput}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime())) return dateInput
    parsed.setUTCDate(parsed.getUTCDate() + days)
    return parsed.toISOString().slice(0, 10)
  }

  export default function Stock() {
    const [rmStock, setRmStock] = useState([])
    const [feedStock, setFeedStock] = useState([])
    const [rmSummaryStock, setRmSummaryStock] = useState([])
    const [feedSummaryStock, setFeedSummaryStock] = useState([])
    const [rmTypes, setRmTypes] = useState([])
    const [rmRange, setRmRange] = useState('today')
    const [feedRange, setFeedRange] = useState('today')
    const [rmFromDate, setRmFromDate] = useState(todayDateInputIST())
    const [rmToDate, setRmToDate] = useState(todayDateInputIST())
    const [feedFromDate, setFeedFromDate] = useState(todayDateInputIST())
    const [feedToDate, setFeedToDate] = useState(todayDateInputIST())

    useEffect(() => {
      rawMaterial.listTypes().then(({ data }) => setRmTypes(data || [])).catch(() => setRmTypes([]))
      stockApi.rmSummary().then(({ data }) => setRmSummaryStock(data || [])).catch(() => setRmSummaryStock([]))
      stockApi.feedSummary().then(({ data }) => setFeedSummaryStock(data || [])).catch(() => setFeedSummaryStock([]))
    }, [])

    const formatQty = (value) => {
      const num = Number(value)
      if (Number.isNaN(num)) return '0'
      if (Number.isInteger(num)) return String(num)
      return num.toFixed(2)
    }

    const buildBagMix = (bagStockByWeight) => {
      const entries = Object.entries(bagStockByWeight || {})
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([bagWeight, stockKg]) => {
          const weight = Number(bagWeight)
          const stock = Number(stockKg)
          if (!Number.isFinite(weight) || weight <= 0) return null
          const bags = Number.isFinite(stock) ? stock / weight : 0
          return {
            key: `${bagWeight}-${stockKg}`,
            weightLabel: `${formatQty(weight)} kg`,
            bagsLabel: `${formatQty(bags)} bags`,
            stockLabel: `${formatQty(stock)} kg`,
          }
        })
        .filter(Boolean)

      return entries
    }

    const renderBagMix = (items) => {
      if (!Array.isArray(items) || items.length === 0) {
        return <span className="text-gray-500">N/A</span>
      }
      const formatYAxis = (value) => {
  if (value >= 10000000) return (value / 10000000).toFixed(1) + "Cr"
  if (value >= 100000) return (value / 100000).toFixed(1) + "L"
  if (value >= 1000) return (value / 1000).toFixed(1) + "K"
  return value
}
      return (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span
              key={item.key}
              title={`Stock: ${item.stockLabel}`}
              className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
            >
              <span className="font-medium">{item.weightLabel}</span>
              <span className="mx-1 text-slate-400">•</span>
              <span>{item.bagsLabel}</span>
            </span>
          ))}
        </div>
      )
    }

    const normalizeFeedType = (value) => String(value || '').trim()
    const normalizeBagWeight = (value) => {
      const num = Number(value)
      return Number.isFinite(num) && num > 0 ? num : null
    }
    const formatMt = (valueKg) => {
      const safeKg = Math.max(0, Number(valueKg) || 0)
      return Number((safeKg / 1000).toFixed(3))
    }

    const feedAvailableStock = Object.values(feedSummaryStock.reduce((acc, row) => {
        const feedType = normalizeFeedType(row?.feed_type)
        if (!feedType) return acc
        if (!acc[feedType]) {
          acc[feedType] = {
            name: feedType,
            closing: 0,
            bagStockByWeight: {},
          }
        }
        const closingKg = Number(row?.quantity) || 0
        acc[feedType].closing += closingKg
        const bagWeight = normalizeBagWeight(row?.bag_weight_kg)
        if (bagWeight != null) {
          const weightKey = formatQty(bagWeight)
          acc[feedType].bagStockByWeight[weightKey] = (acc[feedType].bagStockByWeight[weightKey] || 0) + closingKg
        }
        return acc
      }, {}))
    const feedAvailableStockRows = Object.values(feedAvailableStock)
      .map((row) => ({
        name: row.name,
        closing: row.closing,
        bagMix: buildBagMix(row.bagStockByWeight),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const rmSummaryByName = (rmSummaryStock || []).reduce((acc, row) => {
      const name = String(row?.rm_name || '').trim()
      if (!name) return acc
      acc[name] = Number(row?.quantity || 0)
      return acc
    }, {})

    const rmAvailableStock = (rmTypes.length ? rmTypes.map((item) => item.name) : Object.keys(rmSummaryByName))
      .map((name) => ({
        name,
        closing: Number(rmSummaryByName[name]) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const feedChartData = feedAvailableStockRows.map(({ name, closing }) => ({ name, closing }))
    const rmChartData = rmAvailableStock.map(({ name, closing }) => ({ name,   closing: closing === 0 ? 0 : closing }))

    const toApiPeriod = (rangeKey) => {
      if (rangeKey === 'last_7_days') return 'last_7'
      if (rangeKey === 'last_15_days') return 'last_15'
      if (rangeKey === 'last_30_days') return 'last_30'
      return rangeKey || 'today'
    }

    const resolveRangeDates = (rangeKey, customFrom, customTo) => {
      const today = todayDateInputIST()
      if (rangeKey === 'today') {
        return { from: today, to: today }
      }

      if (rangeKey === 'last_7_days') {
        return { from: shiftDateInput(today, -6), to: today }
      }

      if (rangeKey === 'last_15_days') {
        return { from: shiftDateInput(today, -14), to: today }
      }
      if (rangeKey === 'last_30_days') {
        return { from: shiftDateInput(today, -29), to: today }
      }

      const from = String(customFrom || '').trim()
      const to = String(customTo || '').trim()
      if (!from && !to) {
        return { from: '', to: '' }
      }
      if (!from) {
        return { from: to, to }
      }
      if (!to) {
        return { from, to: from }
      }
      return from <= to ? { from, to } : { from: to, to: from }
    }

    const buildPeriodFetchParams = (rangeKey, customFrom, customTo) => {
      if (toApiPeriod(rangeKey) !== 'custom') return {}

      let { from, to } = resolveRangeDates(rangeKey, customFrom, customTo)
      const today = todayDateInputIST()
      if (!from && !to) {
        from = today
        to = today
      } else if (!from) {
        from = to
      } else if (!to) {
        to = from
      }

      const params = {}
      const fromDate = toApiDateTimeFromDateInput(from)
      const toDate = toApiDateTimeFromDateInput(to, true)
      if (fromDate) params.from_date = fromDate
      if (toDate) params.to_date = toDate
      return params
    }

    useEffect(() => {
      const period = toApiPeriod(rmRange)
      stockApi
        .rmByPeriod(period, buildPeriodFetchParams(rmRange, rmFromDate, rmToDate))
        .then(({ data }) => setRmStock(Array.isArray(data) ? data : []))
        .catch(() => setRmStock([]))
    }, [rmRange, rmFromDate, rmToDate])

    useEffect(() => {
      const period = toApiPeriod(feedRange)
      stockApi
        .feedByPeriod(period, buildPeriodFetchParams(feedRange, feedFromDate, feedToDate))
        .then(({ data }) => setFeedStock(Array.isArray(data) ? data : []))
        .catch(() => setFeedStock([]))
    }, [feedRange, feedFromDate, feedToDate])

    const buildDownloadRangeParams = (rangeKey, customFrom, customTo) => {
      const { from, to } = resolveRangeDates(rangeKey, customFrom, customTo)
      const params = {}
      const fromDate = toApiDateTimeFromDateInput(from)
      const toDate = toApiDateTimeFromDateInput(to, true)
      if (fromDate) params.from_date = fromDate
      if (toDate) params.to_date = toDate
      return params
    }

    const downloadRm = (format, rangeKey = rmRange) => {
      stockApi.downloadRM(
        format,
        buildDownloadRangeParams(rangeKey, rmFromDate, rmToDate)
      ).then(({ data }) => {
        const ext = format === 'pdf' ? 'pdf' : 'xlsx'
        const url = URL.createObjectURL(new Blob([data]))
        const a = document.createElement('a')
        a.href = url
        a.download = `rm_stock.${ext}`
        a.click()
        URL.revokeObjectURL(url)
      })
    }

    const downloadRmIndividual = (format) => {
      stockApi.downloadRMIndividual(format).then(({ data }) => {
        const ext = format === 'pdf' ? 'pdf' : 'xlsx'
        const url = URL.createObjectURL(new Blob([data]))
        const a = document.createElement('a')
        a.href = url
        a.download = `rm_individual_stock.${ext}`
        a.click()
        URL.revokeObjectURL(url)
      })
    }

    const downloadFeed = (format, rangeKey = feedRange) => {
      stockApi.downloadFeed(
        format,
        buildDownloadRangeParams(rangeKey, feedFromDate, feedToDate)
      ).then(({ data }) => {
        const ext = format === 'pdf' ? 'pdf' : 'xlsx'
        const url = URL.createObjectURL(new Blob([data]))
        const a = document.createElement('a')
        a.href = url
        a.download = `feed_stock.${ext}`
        a.click()
        URL.revokeObjectURL(url)
      })
    }

    const downloadFeedIndividual = (format) => {
      stockApi.downloadFeedIndividual(format).then(({ data }) => {
        const ext = format === 'pdf' ? 'pdf' : 'xlsx'
        const url = URL.createObjectURL(new Blob([data]))
        const a = document.createElement('a')
        a.href = url
        a.download = `feed_individual_stock.${ext}`
        a.click()
        URL.revokeObjectURL(url)
      })
    }

    const downloadOverall = (format) => {
      stockApi.downloadOverall(format).then(({ data }) => {
        const ext = format === 'pdf' ? 'pdf' : 'xlsx'
        const url = URL.createObjectURL(new Blob([data]))
        const a = document.createElement('a')
        a.href = url
        a.download = `overall_stock_report.${ext}`
        a.click()
        URL.revokeObjectURL(url)
      })
    }

    const feedStockGrouped = Object.values(
      feedStock.reduce((acc, row) => {
        const feedType = normalizeFeedType(row?.feed_type)
        if (!feedType || !row?.date) return acc
        const key = `${row.date}__${feedType}`
        if (!acc[key]) {
          acc[key] = {
            date: row.date,
            feed_type: feedType,
            opening_stock: 0,
            produced: 0,
            dispatched: 0,
            closing_stock: 0,
            bagStockByWeight: {},
          }
        }
        acc[key].opening_stock += Number(row?.opening_stock) || 0
        acc[key].produced += Number(row?.produced) || 0
        acc[key].dispatched += Number(row?.dispatched) || 0
        const closingKg = Number(row?.closing_stock) || 0
        acc[key].closing_stock += closingKg
        const bagWeight = normalizeBagWeight(row?.bag_weight_kg)
        if (bagWeight != null) {
          const weightKey = formatQty(bagWeight)
          acc[key].bagStockByWeight[weightKey] = (acc[key].bagStockByWeight[weightKey] || 0) + closingKg
        }
        return acc
      }, {})
    )
      .map((row) => ({
        ...row,
        bagMix: buildBagMix(row.bagStockByWeight),
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date) || a.feed_type.localeCompare(b.feed_type))
    const ITEMS_PER_PAGE = 10;
      const [rmPage, setRmPage] = useState(1);
  const rmTotalPages = Math.ceil(rmStock.length / ITEMS_PER_PAGE);

  const rmPaginatedData = rmStock.slice(
    (rmPage - 1) * ITEMS_PER_PAGE,
    rmPage * ITEMS_PER_PAGE
  );
const formatYAxis = (value) => {
  if (value >= 10000000) return (value / 10000000).toFixed(1) + "Cr"
  if (value >= 100000) return (value / 100000).toFixed(1) + "L"
  if (value >= 1000) return (value / 1000).toFixed(1) + "K"
  return value
}
const renderCustomizedTick = (props) => {
  const { x, y, payload, index } = props

  const interval = window.innerWidth < 640 ? 2 : 0   

 
  if (interval !== 0 && index % interval !== 0) {
    return null
  }

  let text = payload?.value ? String(payload.value) : ""

  // truncate
  if (text.length > 8) {
    text = text.substring(0, 5) + "..."
  }

  return (
    <g transform={`translate(${x},${y + 15})`}>
      <text textAnchor="middle" fill="#1f2937" fontSize={10}>
        {text}
      </text>
    </g>
  )
}
  // Feed pagination
  const [feedPage, setFeedPage] = useState(1);
  const feedTotalPages = Math.ceil(feedStockGrouped.length / ITEMS_PER_PAGE);

  const feedPaginatedData = feedStockGrouped.slice(
    (feedPage - 1) * ITEMS_PER_PAGE,
    feedPage * ITEMS_PER_PAGE
  );
    useEffect(() => {
    setRmPage(1);
  }, [rmStock]);
  useEffect(() => {
    setFeedPage(1);
  }, [feedStockGrouped]);
    return (
      <div className="space-y-6 pb-2 md:pb-28 lg:pb-0">
        <h1 className="text-xl font-semibold text-slate-800">Stock Report</h1>
        {/* <p className="text-gray-400 text-sm">Opening + Received - Consumption = Closing (RM). Opening + Produced - Dispatched = Closing (Feed).</p> */}

        <div className="bg-primary-card border border-gray-700 rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-slate-800">Overall Stock Downloads</h2>
              <p className="text-xs text-gray-500 mt-1">Download both Raw Material and Feed reports together.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => downloadOverall('pdf')} className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm hover:bg-primary-light">Download RM + Feed PDF</button>
              <button onClick={() => downloadOverall('xlsx')} className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm hover:bg-primary-light">Download RM + Feed Excel</button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-primary-card border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 flex items-start justify-between gap-3 lg:flex-row flex-col">
              <div>
                <h2 className="text-sm font-medium text-slate-800">Individual Raw Material Available Stock</h2>
                <p className="text-xs text-gray-500 mt-1">Latest closing stock by RM type</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => downloadRmIndividual('pdf')} className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm hover:bg-primary-light">Download PDF</button>
                <button onClick={() => downloadRmIndividual('xlsx')} className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm hover:bg-primary-light">Download Excel</button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[#245658] text-white border-b border-gray-300 z-20">
                  <tr>
                    <th className="px-4 py-3 text-left border border-gray-300 ">RM Type</th>
                    <th className="px-4 py-3 text-left border border-gray-300">Available Stock in (Kg)</th>
                    <th className="px-4 py-3 text-left border border-gray-300">
                        Available Stock in (MT) 
                      </th>
                  </tr>
                </thead>
                <tbody>
                  {rmAvailableStock.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-gray-500 border border-gray-300">
                        No RM stock data available.
                      </td>
                    </tr>
                  ) : (
                    rmAvailableStock.map((row) => (
                      <tr key={row.name} className="border-b border-gray-700/50 hover:bg-primary-light/30">
                        <td className="max-w-[250px] px-4 py-3  border border-gray-300 text-slate-800 break-words whitespace-normal">{row.name}</td>
                        <td className="px-4 py-3  border border-gray-300 text-accent-green font-medium">{formatQty(row.closing)}</td>
                        <td className="px-4 py-3 border border-gray-300 text-accent-green font-medium">
                          {formatMt(row.closing)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-primary-card border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 flex items-start justify-between gap-3  lg:flex-row flex-col">
              <div>
                <h2 className="text-sm font-medium text-slate-800">Individual Feed Available Stock</h2>
                <p className="text-xs text-gray-500 mt-1">Latest closing stock by feed type (all bag sizes combined)</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => downloadFeedIndividual('pdf')} className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm hover:bg-primary-light">Download PDF</button>
                <button onClick={() => downloadFeedIndividual('xlsx')} className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm hover:bg-primary-light">Download Excel</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[#245658] text-white border-b border-gray-300 z-20">
                  <tr>
                    <th className="px-4 py-3 text-left border border-gray-300">Feed Type</th>
                    <th className="px-4 py-3 text-left border border-gray-300">Bag Size Mix</th>
                    <th className="px-4 py-3 text-left border border-gray-300">Available Stock (Kg)</th>
                      <th className="px-4 py-3 text-left border border-gray-300">Available Stock in (MT)</th>
                  </tr>
                </thead>
                <tbody>
                  {feedAvailableStockRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-gray-500 border border-gray-300">
                        No feed stock data available.
                      </td>
                    </tr>
                  ) : (
                    feedAvailableStockRows.map((row) => (
                      <tr key={row.name} className="border-b border-gray-700/50 hover:bg-primary-light/30">
                        <td className="px-4 py-3 border border-gray-300  text-slate-800">{row.name}</td>
                        <td className="px-4 py-3 border border-gray-300  text-slate-800">{renderBagMix(row.bagMix)}</td>
                        <td className="px-4 py-3 border border-gray-300  text-accent-green font-medium">{formatQty(row.closing)}</td>
                          <td className="px-4 py-3 border border-gray-300  text-accent-green font-medium">{formatMt(row.closing)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      
        <div className="bg-primary-card border border-gray-700 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <h2 className="font-medium text-slate-800">Raw Material Stock</h2>
            <div className="flex flex-wrap items-center gap-2">
                <div>
                <label className="block text-xs text-gray-500 mb-1">Period</label>
              <select
                value={rmRange}
                onChange={(e) => {
                  const next = e.target.value
                  setRmRange(next)
                  if (next === 'custom' && !rmFromDate && !rmToDate) {
                    const today = todayDateInputIST()
                    setRmFromDate(today)
                    setRmToDate(today)
                  }
                }}
                className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm bg-white"
              >
                {STOCK_RANGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
                  </div>
              {rmRange === 'custom' && (
                <>
                  <div>   
                  <label className="block text-xs text-gray-500 mb-1">Date From</label>
                  <input
                    type="date"
                    value={rmFromDate}
                    onChange={(e) => setRmFromDate(e.target.value)}
                    className="px-2 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm bg-white"
                  />
                  </div>
                    <div>
                    <label className="block text-xs text-gray-500 mb-1">Date To</label>
                  <input
                    type="date"
                    value={rmToDate}
                    onChange={(e) => setRmToDate(e.target.value)}
                    className="px-2 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm bg-white"
                  />
                    </div>
                </>
              )}
              <button onClick={() => downloadRm('pdf')} className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm hover:bg-primary-light mt-5">PDF</button>
              <button onClick={() => downloadRm('xlsx')} className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm hover:bg-primary-light mt-5">Excel</button>
            </div>
          </div>
          {/* <div className="max-h-[340px] overflow-y-auto overflow-x-auto"> */}
              <div className="overflow-x-auto">
  <table className="w-full text-left border border-gray-300 border-collapse">
                <thead className="bg-[#245658] text-white border-b border-gray-300">
                <tr>
                  <th className="px-4 py-3 text-left border border-gray-300">Date</th>
                  <th className="px-4 py-3 text-left border border-gray-300">RM Name</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Opening</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Received</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Consumption</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Closing</th>
                </tr>
              </thead>
              <tbody>
                {rmStock.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-3 text-gray-500 border border-gray-300">
                      No raw material stock rows for selected range.
                    </td>
                  </tr>
                ) : (
                  rmPaginatedData.map((r, i) => (
                    <tr key={i} className="border-b border-gray-700/50 hover:bg-primary-light/30">
                      <td className="px-4 py-3  border border-gray-300 text-gray-800">{formatDateIST(r.date)}</td>
                      <td className="px-4 py-3  border border-gray-300 text-slate-800 max-w-[200px] break-words">{r.rm_name}</td>
                      <td className="px-4 py-3  border border-gray-300 text-gray-800">{r.opening_stock}</td>
                      <td className="px-4 py-3  border border-gray-300 text-gray-800">{r.received}</td>
                      <td className="px-4 py-3  border border-gray-300 text-gray-800">{r.consumption}</td>
                      <td className="px-4 py-3  border border-gray-300 text-accent-green font-medium">{r.closing_stock}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
               </div>
              <div className="flex justify-end items-center gap-2 p-3">
    <button
      onClick={() => setRmPage((p) => Math.max(p - 1, 1))}
      disabled={rmPage === 1}
      className="px-3 py-1 border rounded  disabled:opacity-40 
              disabled:cursor-not-allowed"
    >
          ◀
    </button>

    <span className="text-sm">
      Page {rmPage} of {rmTotalPages || 1}
    </span>

    <button
      onClick={() => setRmPage((p) => Math.min(p + 1, rmTotalPages))}
      disabled={rmPage === rmTotalPages}
      className="px-3 py-1 border rounded  disabled:opacity-40 
              disabled:cursor-not-allowed"
    >
  ▶
    </button>
  </div>
       
        </div>

        <div className="bg-primary-card border border-gray-700 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <h2 className="font-medium text-slate-800">Feed Stock</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div>
              <label className="block text-xs text-gray-500 mb-1">Period</label>
              <select
                value={feedRange}
                onChange={(e) => {
                  const next = e.target.value
                  setFeedRange(next)
                  if (next === 'custom' && !feedFromDate && !feedToDate) {
                    const today = todayDateInputIST()
                    setFeedFromDate(today)
                    setFeedToDate(today)
                  }
                }}
                className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm bg-white"
              >
                {STOCK_RANGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
                </div>
              {feedRange === 'custom' && (
                <>
                <div>
                      <label className="block text-xs text-gray-500 mb-1">Date From</label>
                  <input
                    type="date"
                    value={feedFromDate}
                    onChange={(e) => setFeedFromDate(e.target.value)}
                    className="px-2 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm bg-white"
                  />
                  </div>
                      <div>
                      <label className="block text-xs text-gray-500 mb-1">Date To</label>
                  <input
                    type="date"
                    value={feedToDate}
                    onChange={(e) => setFeedToDate(e.target.value)}
                    className="px-2 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm bg-white"
                  />
                    </div>
                </>
              )}
              <button onClick={() => downloadFeed('pdf')} className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm hover:bg-primary-light mt-5">PDF</button>
              <button onClick={() => downloadFeed('xlsx')} className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-800 text-sm hover:bg-primary-light mt-5">Excel</button>
            </div>
          </div>
          {/* <div className="max-h-[340px] overflow-y-auto overflow-x-auto"> */}
            <div className="overflow-x-auto">
            <table className="w-full text-left border border-gray-300 border-collapse">
              <thead className="bg-[#245658] text-white border-b border-gray-300">
                <tr>
                  <th className="px-4 py-3 text-left border border-gray-300">Date</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Feed Type</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Bag Size Mix</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Opening</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Produced</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Dispatched</th>
                  <th className="px-4 py-3 text-left border border-gray-300">Closing</th>
                </tr>
              </thead>
              <tbody>
                {feedStockGrouped.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-3 text-gray-500 border border-gray-300">
                      No feed stock rows for selected range.
                    </td>
                  </tr>
                ) : (
                  feedPaginatedData.map((r, i) => (
                    <tr key={i} className="border-b border-gray-700/50 hover:bg-primary-light/30">
                      <td className="px-4 py-3  border border-gray-300 text-gray-800">{formatDateIST(r.date)}</td>
                      <td className="px-4 py-3  border border-gray-300 text-slate-800 max-w-[200px] break-all">{r.feed_type}</td>
                      <td className="px-4 py-3 border border-gray-300 text-slate-800">{renderBagMix(r.bagMix)}</td>
                      <td className="px-4 py-3  border border-gray-300 text-gray-800">{r.opening_stock}</td>
                      <td className="px-4 py-3  border border-gray-300 text-gray-800">{r.produced}</td>
                      <td className="px-4 py-3  border border-gray-300 text-gray-800">{r.dispatched}</td>
                      <td className="px-4 py-3  border border-gray-300 text-accent-green font-medium">{r.closing_stock}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
               </div>
                <div className="flex justify-end items-center gap-2 p-3">
    <button
      onClick={() => setFeedPage((p) => Math.max(p - 1, 1))}
      disabled={feedPage === 1}
      className="px-3 py-1 border rounded  disabled:opacity-40 
              disabled:cursor-not-allowed"
    >
    ◀
    </button>

    <span className="text-sm">
      Page {feedPage} of {feedTotalPages || 1}
    </span>

    <button
      onClick={() => setFeedPage((p) => Math.min(p + 1, feedTotalPages))}
      disabled={feedPage === feedTotalPages}
      className="px-3 py-1 border rounded  disabled:opacity-40 
              disabled:cursor-not-allowed"
    >
      ▶
    </button>
  </div>
       

          
        </div>
        {/* stopped here  */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-primary-card border border-gray-700 rounded-xl p-4">
            <h2 className="text-sm font-medium text-gray-900 mb-3">RM stock summary (latest closing by type)</h2>
            {rmChartData.length > 0 ? (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                 <BarChart
  data={rmChartData}
  margin={{ top: 10, right: 10, left: 0, bottom: 10 }}  
>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" stroke="#9ca3af" 
                    interval={0}
                      fontSize={10}  tick={renderCustomizedTick} label={{
              value: "RM Type",
              position: "insideBottom",
              offset: -5,
              style: { fontSize: 10 }
    }}/>
          
          <YAxis stroke="#9ca3af" fontSize={10}   width={window.innerWidth < 640 ? 35 : 40}  tick={{ fill: "#1f2937", fontSize: 10 }} tickFormatter={formatYAxis} label={{
      value: "Quantity",
      angle: -90,
      position: "insideLeft",
      style: { textAnchor: "middle", fontSize: 10 }
    }}/>
  <Tooltip
    content={({ payload }) => {
      if (!payload || !payload.length) return null

      const data = payload[0].payload

      return (
        <div style={{
          background: "#1a222d",
          padding: "8px",
          border: "1px solid #374151",
          color: "white",
          maxWidth: "150px",
          wordBreak: "break-all"
        }}>
          <p>{data.name}</p>
          <p>Closing: {data.closing}</p>
        </div>
      )
    }}
  />                  <Bar dataKey="closing" fill="#ffab00" name="Closing"   minPointSize={(value) => (value > 0 ? 3 : 0)}    radius={[4, 4, 0, 0]}     />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-48">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={[{ name: "", closing: 0 }]}   fill="transparent" minPointSize={5}  radius={[4, 4, 0, 0]}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        
        <XAxis
          dataKey="name"
          stroke="#9ca3af"
          fontSize={10}
          tick={{ fill: "#1f2937", fontSize: 10 }}
          label={{
            value: "RM Type",
            position: "insideBottom",
            offset: -1,
            style: { fontSize: 10 }
          }}
        />

        <YAxis
          stroke="#9ca3af"
          fontSize={10}
          domain={[0, 4]}   // ✅ FIXED SCALE
          tick={{ fill: "#1f2937", fontSize: 10 }}
          label={{
            value: "Quantity",
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle", fontSize: 10 }
          }}
        />

        <Tooltip
          cursor={false}
          content={() => (
            <div className="bg-[#1a222d] border border-gray-600 px-2 py-1 text-xs text-white">
              No Data
            </div>
          )}
        />

      </BarChart>
    </ResponsiveContainer>
  </div>
            )}
          </div>

          {/* //feed start  */}
          <div className="bg-primary-card border border-gray-700 rounded-xl p-4">
            <h2 className="text-sm font-medium text-gray-900 mb-3">Feed stock summary (latest closing by feed type)</h2>
            {feedChartData.length > 0 ? (
<div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={feedChartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} interval={0}
tick={renderCustomizedTick}
label={{
      value: "Product",
      position: "insideBottom",
      offset: -5,
      style: { fontSize: 10 }
    }} 
    
    />
                    <YAxis stroke="#9ca3af"  tick={{ fill: "#1f2937", fontSize: 10 }} fontSize={10} width={window.innerWidth < 640 ? 40: 45}
tickFormatter={formatYAxis} 
 label={{
      value: "Quantity",
      angle: -90,
      position: "insideLeft",
      style: { textAnchor: "middle", fontSize: 10 }
    }}/>
                    <Tooltip content={({ payload }) => {
      if (!payload || !payload.length) return null

      const data = payload[0].payload

      return (
        <div style={{
          background: "#1a222d",
          padding: "8px",
          border: "1px solid #1a222d",
          color: "white",
          maxWidth: "150px",
          wordBreak: "break-all"
        }}>
          <p>{data.name}</p>
          <p>Closing: {data.closing}</p>
        </div>
      )
    }} />
                    <Bar dataKey="closing" fill="#00c853" name="Closing" minPointSize={(value) => (value > 0 ? 3 : 0)} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
          <div className="h-48">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={[{ name: "", closing: 0 }]}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        
        <XAxis
          dataKey="name"
          stroke="#9ca3af"
          fontSize={10}
          tick={{ fill: "#1f2937", fontSize: 10 }}
          label={{
            value: "Product",
            position: "insideBottom",
            offset: -5,
            style: { fontSize: 10 }
          }}
        />

        <YAxis
          stroke="#9ca3af"
          fontSize={10}
          domain={[0, 4]}   
          tick={{ fill: "#1f2937", fontSize: 10 }}
          label={{
            value: "Quantity",
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle", fontSize: 10 }
          }}
        />

        <Tooltip
        cursor={false}
          content={() => (
            <div className="bg-[#1a222d] border border-gray-600 px-2 py-1 text-xs text-white">
              No Data
            </div>
          )}
        />

      
      </BarChart>
    </ResponsiveContainer>
  </div>          )}
          </div>
  
        </div>

      </div>
    )
  }
