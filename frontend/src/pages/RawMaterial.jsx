import React from 'react'
import { useState, useEffect } from 'react'
import { rawMaterial, stockApi } from '../api/client'
import Modal from '../components/Modal'
import PopupDialog from '../components/PopupDialog'
import usePinGate from '../hooks/usePinGate'
import arrow from "./assets/arrow.png"
import cornbag from "./assets/cornbag.png"
import potato from "./assets/potate-1.png"
import searchIcon from "./assets/icons8-search-60.png"
const LAB_PARAMS = ['protein', 'fat', 'fiber', 'ash', 'calcium', 'phosphorus', 'salt', 'moisture']
const MAIZE_EXTRA = ['fungus', 'broke', 'water_damage', 'small', 'dunkey', 'fm', 'maize_count', 'colour', 'smell']


//new 

import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import {
  formatDateTimeIST,
  parseApiDate,
  toDateInputIST,
  todayDateInputIST,
} from "../utils/datetime";

// Raw material entry, lab report, and stock management page.
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

function currentTimePartsIST() {
  return getTimePartsIST(new Date())
}

function normalizeQualityGrade(value) {
  const text = String(value || "").trim().toLowerCase()
  if (!text) return ""
  if (["good", "g", "1", "yes", "y", "true"].includes(text)) return "Good"
  if (["bad", "b", "0", "no", "n", "false"].includes(text)) return "Bad"
  return String(value || "").trim().charAt(0).toUpperCase() + String(value || "").trim().slice(1).toLowerCase()
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

  return `${dateInput}T${pad2(hour24)}:${pad2(minute)}:00+05:30`
}

const emptyEntryForm = () => {
  const time = currentTimePartsIST()
  return {
    date: todayDateInputIST(),
    hour: time.hour,
    minute: time.minute,
    meridiem: time.meridiem,
    rm_type: '',
    supplier: '',
    challan_no: '',
    vehicle_no: '',
    total_weight: '',
    remarks: '',
  }
}

const emptyLabForm = () => ({
  entry_code: "",
  protein: '',
  fat: '',
  fiber: '',
  ash: '',
  calcium: '',
  phosphorus: '',
  salt: '',
  moisture: '',
  fungus: '',
  broke: '',
  water_damage: '',
  small: '',
  dunkey: '',
  fm: '',
  maize_count: '',
  colour: '',
  smell: '',
})

const emptyLabMeta = () => ({
  created_at: null,
  last_modified_at: null,
})

export default function RawMaterial() {

  const [entries, setEntries] = useState([])
  const [rmTypes, setRmTypes] = useState([])
  const [rmStockRows, setRmStockRows] = useState([])
  const [currentMonthSummary, setCurrentMonthSummary] = useState({
    total_stock_kg: 0,
    total_received_kg: 0,
  })
  const [showAdd, setShowAdd] = useState(false)
  const [addError, setAddError] = useState('')
  const [showAddType, setShowAddType] = useState(false)
  const [newRmType, setNewRmType] = useState('')
  const [showLab, setShowLab] = useState(false)
  const [labError, setLabError] = useState('')
  const [showEdit, setShowEdit] = useState(false)
  const [editError, setEditError] = useState('')
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [editingEntry, setEditingEntry] = useState(null)
  const [popupMessage, setPopupMessage] = useState('')
  const [labMeta, setLabMeta] = useState(emptyLabMeta())
  const { requestPin, pinDialog } = usePinGate()

	  //Table
	  const [search, setSearch] = useState("");
	  const [rmTypeFilter, setRmTypeFilter] = useState("");
const [currentPage, setCurrentPage] = useState(1);
const [dateRangePreset, setDateRangePreset] = useState("today")
	
const [fromDate, setFromDate] = useState("")
const [toDate, setToDate] = useState("")
const rowsPerPage = 5;
// const rowsPerPage = 2;
const todayDate = todayDateInputIST()
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

useEffect(() => {
  if (dateRangePreset === "custom" && !fromDate && !toDate) {
    const today = todayDateInputIST()
    setFromDate(today)
    setToDate(today)
  }
}, [dateRangePreset])


const downloadPDF = () => {
  stockApi.downloadRMIndividual("pdf").then(({ data }) => {
    const url = URL.createObjectURL(new Blob([data]))
    const a = document.createElement("a")
    a.href = url
    a.download = "rm_individual_stock.pdf"
    a.click()
    URL.revokeObjectURL(url)
  }).catch(() => {
    setPopupMessage("Unable to download individual stock PDF.")
  })
};


const downloadExcel = () => {
  const worksheetData = individualStock.map(item => ({
    "RM Type": item.rm_name,
    "Current Stock": item.closing_stock,
  }));

  const worksheet = XLSX.utils.json_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, "Stock");

  const excelBuffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  });

  const file = new Blob([excelBuffer], {
    type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8",
  });

  saveAs(file, "Individual_Raw_Material_Stock.xlsx");
};

const filteredEntries = entries.filter(e => {
  return (
    (
      String(e.entry_code || '').toLowerCase().includes(search.toLowerCase()) ||
      e.rm_type.toLowerCase().includes(search.toLowerCase()) ||
      e.supplier.toLowerCase().includes(search.toLowerCase()) ||
      e.vehicle_no.toLowerCase().includes(search.toLowerCase())
	    )
	  );
});

const totalPages = Math.ceil(filteredEntries.length / rowsPerPage);

const paginatedEntries = filteredEntries.slice(
  (currentPage - 1) * rowsPerPage,
  currentPage * rowsPerPage
);

useEffect(() => {
  setCurrentPage(1)
}, [search, rmTypeFilter, dateRangePreset, fromDate, toDate])

  const [form, setForm] = useState(emptyEntryForm())
  const [editForm, setEditForm] = useState(emptyEntryForm())
  const [labForm, setLabForm] = useState(emptyLabForm())

  const load = () => {
    const period = dateRangePreset
    const rmType = rmTypeFilter || "all"
    const params = {}
    if (period === "custom") {
      if (effectiveFromDate) {
        params.from_date = toApiDateTimeFrom12HourInput(effectiveFromDate, "12", "00", "AM")
      }
      if (effectiveToDate) {
        params.to_date = toApiDateTimeFrom12HourInput(effectiveToDate, "11", "59", "PM")
      }
    }

    rawMaterial
      .listByPeriod(period, rmType, params)
      .then(({ data }) => {
        const sorted = (data || []).sort((a, b) => {
          const bDate = parseApiDate(b.date)?.getTime() ?? Number.NEGATIVE_INFINITY
          const aDate = parseApiDate(a.date)?.getTime() ?? Number.NEGATIVE_INFINITY
          if (bDate !== aDate) return bDate - aDate
          return String(b.entry_code || '').localeCompare(String(a.entry_code || ''))
        })
        setEntries(sorted)
      })
      .catch(() => setEntries([]))
  }

  const loadMeta = () => {
    rawMaterial.listTypes().then(({ data }) => setRmTypes(data)).catch(() => setRmTypes([]))
    stockApi.rm().then(({ data }) => setRmStockRows(data || [])).catch(() => setRmStockRows([]))
  }

  const loadCurrentMonthSummary = () => {
    rawMaterial.summaryByPeriod("this_month", "all")
      .then(({ data }) => {
        setCurrentMonthSummary({
          total_stock_kg: Number(data?.total_stock_kg || 0),
          total_received_kg: Number(data?.total_received_kg || 0),
        })
      })
      .catch(() =>
        setCurrentMonthSummary({
          total_stock_kg: 0,
          total_received_kg: 0,
        })
      )
  }

  useEffect(() => { load() }, [dateRangePreset, effectiveFromDate, effectiveToDate, rmTypeFilter])
  useEffect(() => {
    loadMeta()
    loadCurrentMonthSummary()
  }, [])

  const latestStockByName = rmStockRows.reduce((acc, row) => {
    const current = acc[row.rm_name]
    const rowTime = parseApiDate(row.date)?.getTime() || Number.NEGATIVE_INFINITY
    const currentTime = parseApiDate(current?.date)?.getTime() || Number.NEGATIVE_INFINITY
    if (!current || rowTime > currentTime) {
      acc[row.rm_name] = row
    }
    return acc
  }, {})
  const currentMonthLabel = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(new Date())

  // const individualStock = rmTypes
  //   .map((t) => ({
  //     rm_name: t.name,
  //     closing_stock: latestStockByName[t.name]?.closing_stock ?? 0,
  //   }))
  //   .sort((a, b) => a.rm_name.localeCompare(b.rm_name))


    const individualStock = rmTypes
  .slice()          // copy array
  .reverse()        // newest types first
  .map((t) => ({
    rm_name: t.name,
    closing_stock: latestStockByName[t.name]?.closing_stock ?? 0,
  }))
  const availableRawMaterials = individualStock
    .map((row) => ({
      rm_name: String(row.rm_name || '').trim(),
      closing_stock: Number(row.closing_stock || 0),
    }))
    .filter((row) => row.rm_name && Number.isFinite(row.closing_stock) && row.closing_stock > 0)
    .sort((a, b) => b.closing_stock - a.closing_stock)

  const totalStockWeight = Number(currentMonthSummary.total_stock_kg || 0)
  const totalInwardWeight = Number(currentMonthSummary.total_received_kg || 0)
  const toMtDisplay = (kgValue) => `${Number((Number(kgValue || 0) / 1000).toFixed(3))} MT`

  const handleAdd = async (e) => {
    e.preventDefault()
    setAddError('')
    const entryDateTime = toApiDateTimeFrom12HourInput(form.date, form.hour, form.minute, form.meridiem)
    if (!entryDateTime) {
      setAddError("Please enter a valid entry date and time.")
      return
    }

    try {
      await rawMaterial.create({
        date: entryDateTime,
        rm_type: form.rm_type,
        supplier: form.supplier,
        challan_no: form.challan_no,
        vehicle_no: form.vehicle_no,
        total_weight: parseFloat(form.total_weight),
        remarks: form.remarks,
      })
      setShowAdd(false)
      setForm(emptyEntryForm())
      setAddError('')
      setCurrentPage(1)
      load()
      loadMeta()
      loadCurrentMonthSummary()
    } catch (err) {
      const detail = err?.response?.data?.detail || 'Unable to create entry.'
      setAddError(detail)
    }
  }

  const openEdit = (entry) => {
    const time = getTimePartsIST(entry.date)
    setEditingEntry(entry)
    setEditForm({
      date: toDateInputIST(entry.date, todayDateInputIST()),
      hour: time.hour,
      minute: time.minute,
      meridiem: time.meridiem,
      rm_type: entry.rm_type || '',
      supplier: entry.supplier || '',
      challan_no: entry.challan_no || '',
      vehicle_no: entry.vehicle_no || '',
      total_weight: String(entry.total_weight ?? ''),
      remarks: entry.remarks || '',
    })
    setShowEdit(true)
  }

  const closeEdit = () => {
    setShowEdit(false)
    setEditingEntry(null)
    setEditForm(emptyEntryForm())
    setEditError('')
  }

  const handleEditSubmit = async (e) => {
    e.preventDefault()
    setEditError('')
    if (!editingEntry) return
    const entryDateTime = toApiDateTimeFrom12HourInput(
      editForm.date,
      editForm.hour,
      editForm.minute,
      editForm.meridiem
    )
    if (!entryDateTime) {
      setEditError("Please enter a valid entry date and time.")
      return
    }

    try {
      await rawMaterial.update(editingEntry.entry_code, {
        date: entryDateTime,
        rm_type: editForm.rm_type,
        supplier: editForm.supplier,
        challan_no: editForm.challan_no,
        vehicle_no: editForm.vehicle_no,
        total_weight: parseFloat(editForm.total_weight),
        remarks: editForm.remarks,
      })
      closeEdit()
      load()
      loadMeta()
      loadCurrentMonthSummary()
    } catch (err) {
      const detail = err?.response?.data?.detail || 'Unable to update RM entry.'
      setEditError(detail)
    }
  }

  const openLab = async (entry) => {
    setSelectedEntry(entry)
    try {
      const { data } = await rawMaterial.getLabReport(entry.entry_code)
      const report = data?.report || {}
      setLabMeta({
        created_at: report.created_at ?? null,
        last_modified_at: report.last_modified_at ?? null,
      })
      setLabForm({
        ...emptyLabForm(),
        entry_code: entry.entry_code,
        protein: report.protein ?? '',
        fat: report.fat ?? '',
        fiber: report.fiber ?? '',
        ash: report.ash ?? '',
        calcium: report.calcium ?? '',
        phosphorus: report.phosphorus ?? '',
        salt: report.salt ?? '',
        moisture: report.moisture ?? '',
        fungus: report.fungus ?? '',
        broke: report.broke ?? '',
        water_damage: report.water_damage ?? '',
        small: report.small ?? '',
        dunkey: report.dunkey ?? '',
        fm: report.fm ?? '',
        maize_count: report.maize_count ?? '',
        colour: normalizeQualityGrade(report.colour),
        smell: normalizeQualityGrade(report.smell),
      })
    } catch {
      setLabMeta(emptyLabMeta())
      setLabForm({
        ...emptyLabForm(),
        entry_code: entry.entry_code,
      })
    }
    setShowLab(true)
  }
const formatMt = (valueKg) => {
  const safeKg = Math.max(0, Number(valueKg) || 0);
  return Number((safeKg / 1000).toFixed(3));
};
  const handleLabSubmit = async (e) => {
    e.preventDefault()
    setLabError('')
    const payload = { ...labForm, entry_code: selectedEntry.entry_code }
    LAB_PARAMS.forEach((k) => { if (payload[k] !== '') payload[k] = parseFloat(payload[k]) || null })
    payload.colour = normalizeQualityGrade(payload.colour)
    payload.smell = normalizeQualityGrade(payload.smell)
    try {
      await rawMaterial.submitLabReport(payload)
      setShowLab(false)
      setSelectedEntry(null)
      setLabMeta(emptyLabMeta())
      setLabError('')
      load()
    } catch (err) {
      const detail = err?.response?.data?.detail || 'Unable to submit lab report.'
      setLabError(detail)
    }
  }

  const download = (format) => {
    const params = {}
    if (effectiveFromDate) {
      params.from_date = toApiDateTimeFrom12HourInput(effectiveFromDate, "12", "00", "AM")
    }
    if (effectiveToDate) {
      params.to_date = toApiDateTimeFrom12HourInput(effectiveToDate, "11", "59", "PM")
    }
    if (rmTypeFilter) {
      params.rm_type = rmTypeFilter
    }
    const query = String(search || "").trim()
    if (query) {
      params.q = query
    }

    rawMaterial.download(format, params).then(({ data }) => {
      const ext = format === 'pdf' ? 'pdf' : format === 'xlsx' || format === 'excel' ? 'xlsx' : 'csv'
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `raw_material_report.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  const downloadEntryReport = (entryCode, format) => {
    rawMaterial.downloadEntry(entryCode, format).then(({ data }) => {
      const ext = format === 'pdf' ? 'pdf' : 'xlsx'
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `raw_material_entry_${entryCode}_report.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    }).catch((err) => {
      const detail = err?.response?.data?.detail || 'Unable to download entry report.'
      setPopupMessage(detail)
    })
  }
const resetAddForm = () => {
  setForm(emptyEntryForm())
  setAddError('')
}
  return (
    <div className="space-y-6 pb-2 md:pb-28 lg:pb-0">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

  {/* Total Stock */}
<div className="relative rounded-xl overflow-hidden shadow-md h-36 sm:h-40">
  <div className="absolute top-2 right-3 z-20 text-[11px] sm:text-xs font-semibold text-[#263C2C] bg-white border border-green-900 px-2 py-0.5 rounded">
    {currentMonthLabel}
  </div>
  {/* background image */}
  <img
    src={cornbag}
    alt="Raw Material Stock"
    className="absolute inset-0 w-full h-full object-cover"
  />

  {/* overlay */}
  {/* <div className="absolute inset-0 bg-white/40"></div> */}

  {/* content */}
<div className="
  relative z-10 flex flex-col justify-center h-full px-4

  items-center text-center            /* 📱 mobile */

  md:absolute md:inset-0
  md:items-start md:text-left         /* 💻 desktop */

  md:ml-[40%]                         /* ⭐ move into empty space */
  lg:ml-[45%]
">
    <p className="text-base sm:text-xl md:text-2xl text-gray-700 font-medium">
      Total Raw Material (Stock)
    </p>

    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-[#263C2C]">
      {toMtDisplay(totalStockWeight)}
    </h2>
  </div>
</div>

  {/* Total Usage */}
<div className="relative rounded-xl shadow-md overflow-hidden h-36 sm:h-40">
  <div className="absolute top-2 right-3 z-20 text-[11px] sm:text-xs font-semibold text-[#263C2C] bg-white border border-green-900 px-2 py-0.5 rounded">
    {currentMonthLabel}
  </div>

  {/* background image */}
  <img
    src={potato}
    alt="Raw Material Usage"
    className="absolute inset-0 w-full h-full object-cover"
  />

  {/* overlay for readability */}
  {/* <div className="absolute inset-0 bg-white/30 md:bg-transparent"></div> */}

  {/* content */}
 <div className="
    relative z-10 h-full px-4
    flex flex-col justify-center

    items-center text-center        /* mobile */
    md:items-start md:text-left

    md:ml-[40%]                     /* responsive shift */
    lg:ml-[45%]
">
    <p className="text-base sm:text-xl md:text-2xl text-gray-700 font-medium">
      Total Raw Material (Received) 
    </p>

    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-[#263C2C]">
      {toMtDisplay(totalInwardWeight)}
    </h2>
  </div>
</div>

</div>  
	    <div className="
	  flex flex-col gap-3
	  sm:flex-row sm:items-start sm:justify-between
	">

  <h1 className="text-xl font-semibold text-slate-800 text-center sm:text-left">
    Raw Material
  </h1>

	  <div className="
	    flex flex-wrap justify-center sm:justify-end sm:ml-auto
	    gap-2
	  ">
	    <button
onClick={() => {
  resetAddForm()   
  setShowAdd(true)
}}	      className="px-4 py-2 rounded-lg bg-[#245658] text-primary font-medium whitespace-nowrap"
	    >
	      + Add RM Entry
	    </button>

	    <button
	      onClick={() => download('pdf')}
	      className="px-4 py-2 rounded-lg border border-gray-600 text-gray-800 hover:bg-primary-light whitespace-nowrap"
	    >
	      Download PDF
	    </button>

	    <button
	      onClick={() => download('xlsx')}
	      className="px-4 py-2 rounded-lg border border-gray-600 text-gray-800 hover:bg-primary-light whitespace-nowrap"
	    >
	      Download Excel
	    </button>

	    <button
	      onClick={() => setShowAddType(true)}
	      className="px-4 py-2 rounded-lg border border-gray-600 text-gray-800 hover:bg-primary-light whitespace-nowrap"
	    >
	      + Add RM Type
	    </button>
	  </div>
</div>
      <Modal open={showAddType} onClose={() => { setShowAddType(false); setNewRmType('') ;resetAddForm() }} title="Add RM Type">
        <p className="text-gray-900 text-sm mb-3">New RM name will be added to Raw Material report and RM stock.</p>
        <input type="text" value={newRmType} onChange={(e) => setNewRmType(e.target.value)} placeholder="e.g. MAIZE, SOYA" className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-gray-900 mb-4" />
        <div className="flex gap-2">
          <button onClick={async () => { await rawMaterial.addType(newRmType); setShowAddType(false); setNewRmType(''); loadMeta() }} className="px-4 py-2 rounded-lg bg-accent-green text-primary font-medium" disabled={!newRmType.trim()}>Add</button>
          <button onClick={() => { setShowAddType(false); setNewRmType(''); resetAddForm() }} className="px-4 py-2 rounded-lg border border-gray-600 text-gray-900">Cancel</button>
        </div>
      </Modal>

   <div className="bg-white rounded-xl shadow border overflow-hidden">

{/* 🔍 Search + Filters */}
<div className="bg-white rounded-xl shadow border border-gray-300 overflow-hidden">
  <div className="p-4 border-b border-gray-200 flex flex-wrap items-end gap-4">

    {/* Search */}
    <div className="w-full md:w-64 ">
      <label className="block text-xs text-gray-500 mb-1">Search</label>
      <div className="relative">
        <img
          src={searchIcon}
          alt="search"
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-60"
        />
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-400 rounded-lg pl-10 pr-3 py-2 text-sm w-full"
        />
      </div>
    </div>

    {/* RM Type Filter */}
    <div>
      <label className="block text-xs text-gray-500 mb-1">RM Type</label>
      <select
        value={rmTypeFilter}
        onChange={(e) => setRmTypeFilter(e.target.value)}
      className="w-full max-w-[300px] truncate whitespace-nowrap overflow-hidden text-ellipsis px-3 py-2 rounded-lg border border-gray-400 text-gray-800 text-sm bg-white min-w-[150px]"
      >
        <option value="">All</option>
        {[...new Set(entries.map(e => e.rm_type))].map(type => {
               const shortText = type.length > 25 ? type.slice(0, 25) + "..." : type;          return (
            <option key={type} value={type}>
              {shortText}
            </option>
          )
        })}
      </select>
    </div>

    {/* Date Range */}
    <div>
      <label className="block text-xs text-gray-500 mb-1">Period</label>
      <select
        value={dateRangePreset}
        onChange={(e) => setDateRangePreset(e.target.value)}
        className="border border-gray-400 rounded-lg px-3 py-2 text-sm min-w-[150px]"
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
            className="border border-gray-400 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Date To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="border border-gray-400 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </>
    )}

  </div>
</div>
  {/* Table */}
  <div className="overflow-x-auto">
<table className="min-w-full text-sm border border-gray-300">      
     <thead className="bg-[#245658] text-white border-b border-gray-300">
        <tr>
          <th className="px-4 py-3 text-left border border-gray-300">Entry Code</th>
          <th className="px-4 py-3 text-left border border-gray-300">Entry Date & Time</th>
          <th className="px-4 py-3 text-left border border-gray-300">RM Type</th>
          <th className="px-4 py-3 text-left border border-gray-300">Supplier</th>
          <th className="px-4 py-3 text-left border border-gray-300">Challan No</th>
          <th className="px-4 py-3 text-left border border-gray-300">Vehicle No</th>
	          <th className="px-4 py-3 text-left border border-gray-300">Raw Material Weight</th>
	          <th className="px-4 py-3 text-left border border-gray-300">Lab Report</th>
	          <th className="px-4 py-3 text-left border border-gray-300">Action</th>
	          <th className="px-4 py-3 text-left border border-gray-300">Download Report</th>
	          <th className="px-4 py-3 text-left border border-gray-300">Remarks</th>
        </tr>
      </thead>

      <tbody>
        {paginatedEntries.map((e) => (
          <tr key={e.entry_code} >
            <td className="px-4 py-3 border border-gray-300 font-medium">{e.entry_code}</td>
            <td className="px-4 py-3 border border-gray-300">{formatDateTimeIST(e.date)}</td>
            <td className="px-4 py-3 border border-gray-300 break-all">{e.rm_type}</td>
            <td className="px-4 py-3 border border-gray-300">{e.supplier}</td>
            <td className="px-4 py-3 border border-gray-300">{e.challan_no}</td>
            <td className="px-4 py-3 border border-gray-300">{e.vehicle_no}</td>
            <td className="px-4 py-3 border border-gray-300">{Number(e.total_weight || 0).toFixed(2)}</td>
            <td className="px-4 py-3 border border-gray-300">
              {e.has_lab_report
                ? <span className="text-green-600 font-medium">Yes</span>
                : <span className="text-gray-900">Not Filled</span>}
            </td>
	            <td className="px-4 py-3 border border-gray-300">
	              <div className="flex items-center gap-3">
	                <button
	                  onClick={() => requestPin(
	                    () => openEdit(e),
	                    {
                        title: 'PIN Required',
                        message: 'Enter PIN to edit (1234) raw material entry.',
                        pinType: 'rm_entry_edit',
                      }
	                  )}
	                  // className="text-blue-700 font-medium underline"
                       className="px-2 py-1 text-xs border rounded  bg-gray-600 text-white font-semibold hover:bg-gray-700 text-nowrap"
	                >
	                  Edit Entry
	                </button>
	                <button
	                  onClick={() => requestPin(
	                    () => openLab(e),
	                    {
                        title: 'PIN Required',
                        message: 'Enter PIN to edit (1234) lab report.',
                        pinType: 'rm_lab_edit',
                      }
	                  )}
	                  className="px-2 py-1 text-xs border rounded  bg-blue-600 text-white font-semibold hover:bg-blue-700 text-nowrap"
	                >
	                 {e.has_lab_report ? 'Edit Lab' : 'Add Lab Report'}
	                </button>
	              </div>
	            </td>
	            <td className="px-4 py-3 border border-gray-300">
	              <div className="flex items-center gap-3">
	                <button
	                  onClick={() => downloadEntryReport(e.entry_code, 'pdf')}
	                  className="px-2 py-1 text-xs border rounded  bg-red-600 text-white font-semibold hover:bg-red-500 text-nowrap"
	                >
	                  PDF
	                </button>
	                <button
	                  onClick={() => downloadEntryReport(e.entry_code, 'xlsx')}
	                  className="px-2 py-1 text-xs border rounded  bg-green-600 text-white font-semibold hover:bg-green-700 text-nowrap"
	                >
	                  Excel
	                </button>
	              </div>
	            </td>
            <td className="px-4 py-3 border border-gray-300  break-all">{e.remarks || '-'}</td>
          </tr>
        ))}
      </tbody>

    </table>
  </div>

  {/* 📄 Pagination Footer */}
  <div className="flex items-center justify-between px-4 py-3 bg-gray-50">

    <span className="text-sm text-gray-600">
      Page {currentPage} of {totalPages || 1}
    </span>

    <div className="flex gap-1">
      <button
        disabled={currentPage === 1}
        onClick={()=>setCurrentPage(p => p - 1)}
        className="px-3 py-1 border rounded disabled:opacity-40"
      >
        ◀
      </button>

 {(() => {
  let pages = [];

  if (totalPages <= 3) {
    pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else if (currentPage <= 2) {
    pages = [1, 2, 3];
  } else if (currentPage >= totalPages - 1) {
    pages = [totalPages - 2, totalPages - 1, totalPages];
  } else {
    pages = [currentPage - 1, currentPage, currentPage + 1];
  }

  return pages.map((p) => (
    <button
      key={p}
      onClick={() => setCurrentPage(p)}
      className={`px-3 py-1 border rounded ${
        currentPage === p ? "bg-green-700 text-white" : ""
      }`}
    >
      {p}
    </button>
  ));
})()}
      <button
        disabled={currentPage === totalPages}
        onClick={()=>setCurrentPage(p => p + 1)}
        className="px-3 py-1 border rounded disabled:opacity-40"
      >
        ▶
      </button>
    </div>
  </div>
</div>

      <div className="bg-white rounded-xl shadow border border-gray-300 overflow-hidden">
     <div className="px-4 py-3 border-b border-gray-200">
  <div className="flex flex-wrap justify-between items-start gap-3">
    
    <div>
      <h2 className="text-sm font-semibold text-slate-800">
        Individual Raw Material Stock
      </h2>
      <p className="text-xs text-gray-500 mt-1">
        Latest closing stock by raw material type
      </p>
    </div>

    <div className="flex flex-wrap gap-2">
      <button
        onClick={downloadPDF}
        className="px-4 py-2 rounded-lg bg-[#245658] border border-gray-600 text-white hover:bg-[#3a8a8d] hover:border-white whitespace-nowrap"
      >
        Download PDF
      </button>

      <button
        onClick={downloadExcel}
        className="px-4 py-2 rounded-lg bg-[#245658] border border-gray-600 text-white hover:bg-[#3a8a8d] hover:border-white whitespace-nowrap"
      >
        Download Excel
      </button>
    </div>

  </div>
</div>
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto ">
          <table className="min-w-full text-sm border border-gray-300">
            <thead className="bg-[#245658] text-white sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left border border-gray-300">RM Type</th>
                <th className="px-4 py-3 text-left border border-gray-300">Current Stock in (kg)</th>
                   <th className="px-4 py-3 text-left border border-gray-300">Current Stock in  (MT)</th>
              </tr>
            </thead>
                 
            <tbody >
       
              {individualStock.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-gray-500 border border-gray-300">
                    No stock data available yet.
                  </td>
                </tr>
              ) : (
                individualStock.map((row) => (
                  <tr key={row.rm_name}>
                    <td className="px-4 py-3 border border-gray-300 break-all">{row.rm_name}</td>
                    <td className="px-4 py-3 border border-gray-300 font-medium">{Number(row.closing_stock || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 border border-gray-300 font-medium">{formatMt(row.closing_stock)}</td>
                  </tr>
                ))
              )}
             
            </tbody>
      
          </table>
        </div>
      </div>

      <Modal open={showAdd} onClose={() => { 
  setShowAdd(false)
  resetAddForm()
}} title="Add RM Inward" >
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="bg-gray-100 border border-gray-300 rounded-lg p-3">
            <p className="text-sm font-semibold text-gray-700 mb-2">Available Raw Materials</p>
            {availableRawMaterials.length === 0 ? (
              <p className="text-sm text-gray-500">No available raw material stock (greater than 0 kg).</p>
            ) : (
              <div className="max-h-[136px] overflow-y-auto overflow-x-auto rounded border border-gray-300">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-200 text-gray-700">
                      <th className="px-3 py-2 text-left border-b border-gray-300">Raw Material</th>
                      <th className="px-3 py-2 text-right border-b border-gray-300">Weight Available (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableRawMaterials.map((row) => (
                      <tr key={`available-rm-${row.rm_name}`} className="bg-gray-50 text-gray-700 border-b border-gray-200 last:border-b-0">
                        <td className="px-3 py-2 break-all">{row.rm_name}</td>
                        <td className="px-3 py-2 text-right font-medium">{row.closing_stock.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {addError && (
            <div className="bg-red-100 text-red-800 px-4 py-3 rounded-lg text-sm border border-red-300">
              {addError}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_1.5fr] gap-4">
            <div>
              <label className="block text-sm text-gray-900 mb-1">Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black" required />
            </div>
            <div>
              <label className="block text-sm text-gray-900 mb-1">Entry Time</label>
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
              <label className="block text-sm text-gray-900 mb-1">RM Type (pre-defined)</label>
                <div className="relative">
              <select value={form.rm_type} onChange={(e) => setForm((f) => ({ ...f, rm_type: e.target.value }))} className="w-full px-3  py-2  rounded-lg bg-primary-light border border-gray-600 text-black appearance-none" required>
                <option value="">Select</option>
                {rmTypes.map((t) => {
                  const shortText = t.name.length > 15 ? `${t.name.substring(0, 15)}...` : t.name
                  return (
                    <option key={t.id} value={t.name}>
                      {shortText}
                    </option>
                  )
                })}
              </select>
                <img
      src={arrow}
      alt="arrow"
      className="pointer-events-none text-black absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 "
    />
  </div>
              
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-900 mb-1">Supplier</label>
            <input type="text" value={form.supplier} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black" required />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-900 mb-1">Challan No</label>
              <input type="text" value={form.challan_no} onChange={(e) => setForm((f) => ({ ...f, challan_no: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black" required />
            </div>
            <div>
              <label className="block text-sm text-gray-900 mb-1">Vehicle No</label>
              <input type="text" value={form.vehicle_no} onChange={(e) => setForm((f) => ({ ...f, vehicle_no: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black" required />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-900 mb-1">Total Weight</label>
            <input type="number" step="any" value={form.total_weight} onChange={(e) => setForm((f) => ({ ...f, total_weight: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black" required />
          </div>
          <div>
            <label className="block text-sm text-gray-900 mb-1">Remarks</label>
            <input type="text" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 rounded-lg bg-accent-green text-primary font-medium">Submit</button>
            <button type="button"   onClick={() => {
    setShowAdd(false)
    resetAddForm()
  }} className="px-4 py-2 rounded-lg border border-gray-600 text-black">Cancel</button>
          </div>
        </form>
      </Modal>

      <Modal open={showEdit} onClose={closeEdit} title="Edit RM Entry">
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div className="bg-gray-100 border border-gray-300 rounded-lg p-3">
            <p className="text-sm font-semibold text-gray-700 mb-2">Available Raw Materials</p>
            {availableRawMaterials.length === 0 ? (
              <p className="text-sm text-gray-500">No available raw material stock (greater than 0 kg).</p>
            ) : (
              <div className="max-h-[136px] overflow-y-auto overflow-x-auto rounded border border-gray-300">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-200 text-gray-700">
                      <th className="px-3 py-2 text-left border-b border-gray-300">Raw Material</th>
                      <th className="px-3 py-2 text-right border-b border-gray-300">Weight Available (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableRawMaterials.map((row) => (
                      <tr key={`available-rm-edit-${row.rm_name}`} className="bg-gray-50 text-gray-700 border-b border-gray-200 last:border-b-0">
                        <td className="px-3 py-2 break-all">{row.rm_name}</td>
                        <td className="px-3 py-2 text-right font-medium">{row.closing_stock.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {editError && (
            <div className="bg-red-100 text-red-800 px-4 py-3 rounded-lg text-sm border border-red-300">
              {editError}
            </div>
          )}
          {editingEntry && (
            <p className="text-xs text-gray-600">
              Entry Date: {formatDateTimeIST(editingEntry.date)} | Last Modified: {formatDateTimeIST(editingEntry.last_modified_at)}
            </p>
          )}
<div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_1.5fr] gap-4">
              <div>
              <label className="block text-sm text-gray-900 mb-1">Date</label>
              <input type="date" value={editForm.date} onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black" required />
            </div>
            <div>
              <label className="block text-sm text-gray-900 mb-1">Entry Time</label>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={editForm.hour}
                  onChange={(e) => setEditForm((f) => ({ ...f, hour: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black"
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
                  className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black"
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
                  className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black"
                  required
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-900 mb-1">RM Type (pre-defined)</label>
              <div className="relative">
                <select value={editForm.rm_type} onChange={(e) => setEditForm((f) => ({ ...f, rm_type: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black appearance-none" required>
                  <option value="">Select</option>
                  {rmTypes.map((t) => {
                    const shortText = t.name.length > 25 ? `${t.name.substring(0, 25)}...` : t.name
                    return (
                      <option key={t.id} value={t.name}>
                        {shortText}
                      </option>
                    )
                  })}
                </select>
                <img
                  src={arrow}
                  alt="arrow"
                  className="pointer-events-none text-black absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 "
                />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-900 mb-1">Supplier</label>
            <input type="text" value={editForm.supplier} onChange={(e) => setEditForm((f) => ({ ...f, supplier: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black" required />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-900 mb-1">Challan No</label>
              <input type="text" value={editForm.challan_no} onChange={(e) => setEditForm((f) => ({ ...f, challan_no: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black" required />
            </div>
            <div>
              <label className="block text-sm text-gray-900 mb-1">Vehicle No</label>
              <input type="text" value={editForm.vehicle_no} onChange={(e) => setEditForm((f) => ({ ...f, vehicle_no: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black" required />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-900 mb-1">Raw Material Weight</label>
            <input type="number" step="any" value={editForm.total_weight} onChange={(e) => setEditForm((f) => ({ ...f, total_weight: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black" required />
          </div>
          <div>
            <label className="block text-sm text-gray-900 mb-1">Remarks</label>
            <input type="text" value={editForm.remarks} onChange={(e) => setEditForm((f) => ({ ...f, remarks: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-black" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 rounded-lg bg-accent-green text-primary font-medium">Update</button>
            <button type="button" onClick={closeEdit} className="px-4 py-2 rounded-lg border border-gray-600 text-black">Cancel</button>
          </div>
          {editingEntry && (
            <div className="text-right text-xs text-gray-600">
              Created At: {formatDateTimeIST(editingEntry.created_at)}
            </div>
          )}
        </form>
      </Modal>

      <Modal open={showLab} onClose={() => { setShowLab(false); setSelectedEntry(null); setLabMeta(emptyLabMeta()); setLabError(''); }} title="Lab Report" >
        {selectedEntry && (
          <>
            {labError && (
              <div className="bg-red-100 text-red-800 px-4 py-3 rounded-lg text-sm border border-red-300 mb-4">
                {labError}
              </div>
            )}
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 mb-2">
              Date: {formatDateTimeIST(selectedEntry.date)} | RM Type: {selectedEntry.rm_type} | Supplier: {selectedEntry.supplier} | Challan: {selectedEntry.challan_no} | Vehicle: {selectedEntry.vehicle_no} | Weight: {selectedEntry.total_weight} | Remarks: {selectedEntry.remarks || '-'}
            </p>
            <p className="text-xs text-gray-600 mb-4">
              Lab Report Created At: {formatDateTimeIST(labMeta.created_at)} | Last Modified: {formatDateTimeIST(labMeta.last_modified_at)}
            </p>
            <form onSubmit={handleLabSubmit} className="space-y-4    md:pb-4 overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {LAB_PARAMS.map((key) => (
                  <div key={key}>
                    <label className="block text-xs text-black capitalize mb-0.5">{key} %</label>
                    <input type="number" step="any" value={labForm[key] || ''} onChange={(e) => setLabForm((f) => ({ ...f, [key]: e.target.value }))} className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm" />
                  </div>
                ))}
              </div>
              {selectedEntry.rm_type?.toLowerCase().includes('maize') && (
                <div className="pt-2 border-t border-gray-700">
                  <p className="text-xs text-black mb-2">For Maize</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {MAIZE_EXTRA.map((key) => (
                    <div key={key}>
                        <label className="block text-xs text-black capitalize mb-0.5">{key.replace('_', ' ')}   {key !== "small" && key !== "colour" && key !== "smell" ? " %" : ""}</label>
                        {key === "colour" || key === "smell" ? (
                          <select
                            value={labForm[key] || ''}
                            onChange={(e) => setLabForm((f) => ({ ...f, [key]: e.target.value }))}
                            className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm"
                          >
                            <option value="">Select</option>
                            <option value="Good">Good</option>
                            <option value="Bad">Bad</option>
                          </select>
                        ) : (
                          <input type="text" value={labForm[key] || ''} onChange={(e) => setLabForm((f) => ({ ...f, [key]: e.target.value }))} className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-4 ">
                <button type="submit" className="px-4 py-2 rounded-lg bg-accent-green text-primary font-medium">Submit</button>
                <button type="button" onClick={() => { setShowLab(false); setSelectedEntry(null); setLabMeta(emptyLabMeta()); setLabError('') }} className="px-4 py-2 rounded-lg border border-gray-600 text-gray-900">Cancel</button>
              </div>
            </form>
          </>
        )}
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
