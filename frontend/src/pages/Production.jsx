import React, { useEffect, useRef, useState } from "react";
import { productionApi, configApi, stockApi } from "../api/client";
import Modal from "../components/Modal";
import usePinGate from "../hooks/usePinGate";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import productionBg from "./assets/production.png";
import batchwise from "./assets/batch-wise.png";
import searchIcon from "./assets/icons8-search-60.png";
import {
  APP_TIME_ZONE,
  formatDateIST,
  formatDateTimeIST,
  toApiDateTimeFromDateInput,
  toDateInputIST,
  todayDateInputIST,
} from "../utils/datetime";

// Production batch creation, HMI, and batch reporting page.
const NUTRITION_FIELDS = [
  "protein",
  "fat",
  "fiber",
  "ash",
  "calcium",
  "phosphorus",
  "salt",
];
const PHYSICAL_FIELDS = [
  "hm_retention",
  "mixer_moisture",
  "conditioner_moisture",
  "moisture_addition",
  "final_feed_moisture",
  "water_activity",
  "hardness",
  "pellet_diameter",
  "fines",
];
const EMPTY_MATERIAL_ROW = { rm_name: "", quantity: "" };
const DATE_RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "last_7", label: "Last 7 Days" },
  { value: "last_15", label: "Last 15 Days" },
  { value: "last_30", label: "Last 30 Days" },
  { value: "custom", label: "Custom" },
];

const shiftDateInput = (dateInput, days) => {
  const parsed = new Date(`${dateInput}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return dateInput;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const resolveDateRange = (rangeType) => {
  const today = todayDateInputIST();
  if (rangeType === "last_7") {
    return { fromDate: shiftDateInput(today, -6), toDate: today };
  }
  if (rangeType === "last_15") {
    return { fromDate: shiftDateInput(today, -14), toDate: today };
  }
  if (rangeType === "last_30") {
    return { fromDate: shiftDateInput(today, -29), toDate: today };
  }
  return { fromDate: today, toDate: today };
};

const initialBatchForm = () => ({
  batch_no: "",
  date: todayDateInputIST(),
  product_name: "",
  recipe_id: null,
  batch_size: "",
  mop: "",
  water: "",
  num_bags: "",
  weight_per_bag: "",
});

const initialReportForm = (batch) => ({
  batch_id: batch?.id ?? null,
  date: toDateInputIST(batch?.date, todayDateInputIST()),
  batch_no: batch?.batch_no ? String(batch.batch_no) : "",
  product_name: batch?.product_name ? String(batch.product_name) : "",
  recipe_id: batch?.recipe_id ?? null,
  batch_size: batch?.batch_size != null ? String(batch.batch_size) : "",
  mop: batch?.mop != null ? String(batch.mop) : "",
  water: batch?.water != null ? String(batch.water) : "",
  num_bags: batch?.num_bags != null ? String(batch.num_bags) : "",
  weight_per_bag:
    batch?.weight_per_bag != null ? String(batch.weight_per_bag) : "",
  output: batch?.output != null ? String(batch.output) : "",
  protein: "",
  fat: "",
  fiber: "",
  ash: "",
  calcium: "",
  phosphorus: "",
  salt: "",
  hm_retention: "",
  mixer_moisture: "",
  conditioner_moisture: "",
  moisture_addition: "",
  final_feed_moisture: "",
  water_activity: "",
  hardness: "",
  pellet_diameter: "",
  fines: "",
});

export default function Production() {
  const [batches, setBatches] = useState([]);
  const [currentMonthSummary, setCurrentMonthSummary] = useState({
    total_batches: 0,
    total_production_kg: 0,
  });
  const [productTypes, setProductTypes] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [batchDetail, setBatchDetail] = useState(null);
  const [showAddBatch, setShowAddBatch] = useState(false);
  const [batchForm, setBatchForm] = useState(initialBatchForm);
  const [batchMaterials, setBatchMaterials] = useState([
    { ...EMPTY_MATERIAL_ROW },
  ]);
  const [batchError, setBatchError] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [reportForm, setReportForm] = useState(initialReportForm());
  const [reportMaterials, setReportMaterials] = useState([
    { ...EMPTY_MATERIAL_ROW },
  ]);
  const [reportModalMode, setReportModalMode] = useState("report");
  const [reportError, setReportError] = useState("");
  const [availableRawMaterials, setAvailableRawMaterials] = useState([]);
  const [rmStockLoading, setRmStockLoading] = useState(false);
  const [showConsumptionReport, setShowConsumptionReport] = useState(false);
  const { requestPin, pinDialog } = usePinGate();
  const [dateRangeType, setDateRangeType] = useState("today");
  const [fromDate, setFromDate] = useState(todayDateInputIST());
  const [toDate, setToDate] = useState(todayDateInputIST());
  const [productFilter, setProductFilter] = useState("");
  const [search, setSearch] = useState("");
  const reportRef = useRef(null);
  const consumptionRef = useRef(null);
  const [page, setPage] = useState(1);
  // const pageSize = 1;
    const pageSize = 5;
  const [successMsg, setSuccessMsg] = useState("");
  const [markCompleteLoading, setMarkCompleteLoading] = useState(false);
  const [markCompleteEligibility, setMarkCompleteEligibility] = useState({
    loading: false,
    allowed: true,
    detail: "",
  });

  const [periodPage, setPeriodPage] = useState(1);
  const periodPageSize = 6;
  const loadBatches = () => {
    const period = dateRangeType;
    const productName = productFilter || "all";
    const params = {};
    if (period === "custom") {
      const fromDateTime = toApiDateTimeFromDateInput(normalizedFromDate);
      const toDateTime = toApiDateTimeFromDateInput(normalizedToDate, true);
      if (fromDateTime) params.from_date = fromDateTime;
      if (toDateTime) params.to_date = toDateTime;
    }

    productionApi
      .listBatchesByPeriod(period, productName, params)
      .then(({ data }) => {
        const sorted = (data || []).sort(
          (a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id,
        );
        setBatches(sorted);
      })
      .catch(() => setBatches([]));
  };

  const loadCurrentMonthSummary = () => {
    productionApi
      .summaryByPeriod("this_month", "all")
      .then(({ data }) => {
        setCurrentMonthSummary({
          total_batches: Number(data?.total_batches || 0),
          total_production_kg: Number(data?.total_production_kg || 0),
        });
      })
      .catch(() =>
        setCurrentMonthSummary({
          total_batches: 0,
          total_production_kg: 0,
        }),
      );
  };

  const loadAvailableRawMaterialStock = () => {
    setRmStockLoading(true);
    stockApi
      .rm()
      .then(({ data }) => {
        const rows = Array.isArray(data) ? data : [];
        const latestByName = rows.reduce((acc, row) => {
          const name = String(row?.rm_name || "").trim();
          if (!name) return acc;

          const rowTimeRaw = Date.parse(String(row?.date || ""));
          const rowTime = Number.isFinite(rowTimeRaw)
            ? rowTimeRaw
            : Number.NEGATIVE_INFINITY;
          const currentTimeRaw = Date.parse(String(acc[name]?.date || ""));
          const currentTime = Number.isFinite(currentTimeRaw)
            ? currentTimeRaw
            : Number.NEGATIVE_INFINITY;

          if (!acc[name] || rowTime > currentTime) {
            acc[name] = row;
          }
          return acc;
        }, {});

        const availableRows = Object.values(latestByName)
          .map((row) => ({
            rm_name: String(row?.rm_name || "").trim(),
            closing_stock: Number(row?.closing_stock || 0),
          }))
          .filter(
            (row) =>
              row.rm_name &&
              Number.isFinite(row.closing_stock) &&
              row.closing_stock > 0,
          )
          .sort((a, b) => b.closing_stock - a.closing_stock);

        setAvailableRawMaterials(availableRows);
      })
      .catch(() => setAvailableRawMaterials([]))
      .finally(() => setRmStockLoading(false));
  };

  const normalizedFromDate =
    fromDate && toDate && fromDate > toDate ? toDate : fromDate;
  const normalizedToDate =
    fromDate && toDate && fromDate > toDate ? fromDate : toDate;
  const currentMonthProductionKg = Number(
    currentMonthSummary.total_production_kg || 0,
  );
  const currentMonthBatchCount = Number(currentMonthSummary.total_batches || 0);
  const currentMonthProductionMt = currentMonthProductionKg / 1000;
  const currentMonthLabel = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(new Date());
  const currentMonthProductionDisplay = currentMonthProductionMt.toLocaleString(
    "en-IN",
    {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    },
  );
const filteredBatches = search.trim()
  ? batches.filter((b) => {
      const searchText = search.toLowerCase();  

      return (
        b.product_name?.toLowerCase().includes(searchText) ||
        String(b.batch_no || b.id).toLowerCase().includes(searchText) ||
        String(b.output).includes(searchText) ||
        String(b.num_bags ?? "").includes(searchText) ||
        String(b.weight_per_bag ?? "").includes(searchText)
      );
    })
  : batches;

  const buildDownloadParams = () => {
    const params = {};
    const fromDateTime = toApiDateTimeFromDateInput(normalizedFromDate);
    const toDateTime = toApiDateTimeFromDateInput(normalizedToDate, true);
    if (fromDateTime) params.from_date = fromDateTime;
    if (toDateTime) params.to_date = toDateTime;
    if (productFilter) params.product_name = productFilter;
    return params;
  };

  useEffect(() => {
    setPage(1);
  }, [search]);

  // useEffect(() => {
  //   loadBatches()
  // setPage(1)
  // }, [filters.from_date, filters.to_date, filters.product_name])

  useEffect(() => {
    loadBatches();
  }, [dateRangeType, normalizedFromDate, normalizedToDate, productFilter]);

  useEffect(() => {
    loadCurrentMonthSummary();
  }, []);

  useEffect(() => {
    if (dateRangeType === "custom") return;
    const range = resolveDateRange(dateRangeType);
    setFromDate(range.fromDate);
    setToDate(range.toDate);
  }, [dateRangeType]);

  useEffect(() => {
    if (!showReport || reportModalMode !== "edit") return;
    loadAvailableRawMaterialStock();
  }, [showReport, reportModalMode]);

  useEffect(() => {
    if (!showReport || reportModalMode !== "edit") {
      setMarkCompleteEligibility({ loading: false, allowed: true, detail: "" });
      return;
    }

    const candidateBatch = batchDetail?.batch || selectedBatch || null;
    const batchId = candidateBatch?.id || reportForm.batch_id;
    const runStatus = String(candidateBatch?.run_status || "").toLowerCase();
    if (!batchId || (runStatus !== "stopped" && runStatus !== "pending")) {
      setMarkCompleteEligibility({ loading: false, allowed: true, detail: "" });
      return;
    }

    let cancelled = false;
    setMarkCompleteEligibility({ loading: true, allowed: false, detail: "" });
    productionApi
      .markBatchCompleteEligibility(batchId)
      .then(({ data }) => {
        if (cancelled) return;
        setMarkCompleteEligibility({
          loading: false,
          allowed: Boolean(data?.allowed),
          detail: String(data?.detail || "").trim(),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const detail = String(
          err?.response?.data?.detail ||
            "Unable to validate stock for mark complete.",
        ).trim();
        setMarkCompleteEligibility({
          loading: false,
          allowed: false,
          detail,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    showReport,
    reportModalMode,
    batchDetail?.batch?.id,
    batchDetail?.batch?.run_status,
    selectedBatch?.id,
    selectedBatch?.run_status,
    reportForm.batch_id,
  ]);

  useEffect(() => {
    setPage(1);
  }, [fromDate, toDate, productFilter, dateRangeType]);

  const totalPages = Math.ceil(filteredBatches.length / pageSize);
  // const totalPages = 200;
  const paginatedBatches = filteredBatches.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  const periodBatches = batches;

  const totalPeriodPages = Math.ceil(periodBatches.length / periodPageSize);
  // const totalPeriodPages=100

  const paginatedPeriodBatches = periodBatches.slice(
    (periodPage - 1) * periodPageSize,
    periodPage * periodPageSize,
  );

  useEffect(() => {
    setPeriodPage(1);
  }, [fromDate, toDate, productFilter, dateRangeType]);

  const periodBatchLabel =
    dateRangeType === "today"
      ? "today"
      : dateRangeType === "last_7"
        ? "last 7 days"
        : dateRangeType === "last_15"
          ? "last 15 days"
          : dateRangeType === "last_30"
            ? "last 30 days"
            : "selected period";

  useEffect(() => {
    if (periodBatches.length === 0) {
      setSelectedBatch(null);
      setBatchDetail(null);
      setShowConsumptionReport(false);
      return;
    }

    const latestBatch = periodBatches[0];
    const selectedInPeriod =
      selectedBatch &&
      periodBatches.some((batch) => batch.id === selectedBatch.id);
    if (selectedInPeriod) return;

    setSelectedBatch(latestBatch);
    setShowConsumptionReport(false);
    productionApi
      .getBatch(latestBatch.id)
      .then(({ data }) => setBatchDetail(data))
      .catch(() => setBatchDetail(null));
  }, [periodBatches, selectedBatch]);

  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(""), 3000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  const report = batchDetail?.report;
  const chemicalChartData = report
    ? NUTRITION_FIELDS.filter((k) => report[k] != null).map((k) => ({
        name: k.replace("_", " "),
        value: Number(report[k]),
      }))
    : [];
  const physicalChartData = report
    ? PHYSICAL_FIELDS.filter((k) => report[k] != null).map((k) => ({
        name: k.replace(/_/g, " "),
        value: Number(report[k]),
      }))
    : [];
  const selectedPlannedBatchCount = Number(batchDetail?.batch?.batch_size || 0);
  const selectedCompletedBatchCount = Number(
    batchDetail?.batch?.completed_count || 0,
  );
  const selectedRunStatus = String(
    batchDetail?.batch?.run_status || "",
  ).toLowerCase();
  const selectedBatchSize =
    Number.isFinite(selectedCompletedBatchCount) &&
    selectedCompletedBatchCount > 0
      ? selectedCompletedBatchCount
      : selectedRunStatus === "completed"
        ? selectedPlannedBatchCount
        : 0;
  const selectedConsumptionRows = Array.isArray(batchDetail?.materials)
    ? batchDetail.materials.map((material) => {
        const weightPerBatch = Number(material.quantity || 0);
        const totalBatch = Number.isFinite(selectedBatchSize)
          ? selectedBatchSize
          : 0;
        const totalWeight =
          material?.total_quantity != null
            ? Number(material.total_quantity || 0)
            : weightPerBatch * totalBatch;
        return {
          rm_name: material.rm_name,
          weight_per_batch: weightPerBatch,
          total_batch: totalBatch,
          total_weight: totalWeight,
        };
      })
    : [];
  const selectedConsumptionTotal = selectedConsumptionRows.reduce(
    (acc, row) => ({
      weight_per_batch: acc.weight_per_batch + row.weight_per_batch,
      total_batch: selectedBatchSize,
      total_weight: acc.total_weight + row.total_weight,
    }),
    { weight_per_batch: 0, total_batch: 0, total_weight: 0 },
  );
  const batchRunStatus = (
    batchDetail?.batch?.run_status ||
    selectedBatch?.run_status ||
    ""
  ).toLowerCase();
  const canEditBagOutput = true;
  const canMarkBatchComplete =
    reportModalMode === "edit" &&
    (batchRunStatus === "stopped" || batchRunStatus === "pending");
  const reportModalBatch = batchDetail?.batch || selectedBatch || null;
  const reportNumBagsValue =
    String(reportForm.num_bags ?? "").trim() !== ""
      ? Number(reportForm.num_bags)
      : Number(reportModalBatch?.num_bags ?? 0);
  const reportWeightPerBagValue =
    String(reportForm.weight_per_bag ?? "").trim() !== ""
      ? Number(reportForm.weight_per_bag)
      : Number(reportModalBatch?.weight_per_bag ?? 0);
  const hasValidBagDetailsForCompletion =
    Number.isFinite(reportNumBagsValue) &&
    Number.isFinite(reportWeightPerBagValue) &&
    reportNumBagsValue > 0 &&
    reportWeightPerBagValue > 0;
  const markCompleteDisabled =
    markCompleteLoading ||
    markCompleteEligibility.loading ||
    !markCompleteEligibility.allowed ||
    !hasValidBagDetailsForCompletion;
  const reportModalEntryDate = reportModalBatch?.date || null;
  const reportModalLastModified =
    reportModalBatch?.last_modified_at || reportModalBatch?.created_at || null;
  const reportModalCreatedAt =
    reportModalMode === "edit"
      ? reportModalBatch?.created_at || null
      : batchDetail?.report?.created_at || reportModalBatch?.created_at || null;
  const selectedRecipeForEdit =
    recipes.find(
      (item) => Number(item.id) === Number(reportForm.recipe_id),
    ) || null;
  const normalizedReportMaterials = reportMaterials.map((item) => {
    const rawQty = String(item.quantity ?? "").trim();
    const quantity = Number(item.quantity);
    const parsedId = Number(item.id);
    return {
      id: Number.isFinite(parsedId) && parsedId > 0 ? parsedId : undefined,
      rm_name: (item.rm_name || "").trim(),
      rawQty,
      quantity,
    };
  });
  const invalidReportMaterialRows = normalizedReportMaterials.filter(
    (item) =>
      (item.rm_name &&
        (!item.rawQty ||
          !Number.isFinite(item.quantity) ||
          item.quantity <= 0)) ||
      (!item.rm_name && item.rawQty),
  );
  const validReportMaterials = normalizedReportMaterials.filter(
    (item) =>
      item.rm_name && Number.isFinite(item.quantity) && item.quantity > 0,
  );

  useEffect(() => {
    Promise.all([configApi.recipes(), configApi.productTypes()])
      .then(([recipesResponse, productTypesResponse]) => {
        const safeRecipes = Array.isArray(recipesResponse.data)
          ? recipesResponse.data
          : [];
        const safeProductTypes = Array.isArray(productTypesResponse.data)
          ? productTypesResponse.data
          : [];
        setRecipes(safeRecipes);
        setProductTypes(safeProductTypes);
      })
      .catch(() => {
        setRecipes([]);
        setProductTypes([]);
      });
  }, []);

  const resolveMatchingProductTypeName = (candidateName) => {
    const normalizedName = String(candidateName || "").trim();
    if (!normalizedName) {
      return "";
    }

    const matchedType = productTypes.find(
      (item) => String(item || "").trim() === normalizedName,
    );
    return matchedType ? String(matchedType).trim() : "";
  };

  const parseRecipeIdFromReference = (recipeReference) => {
    const refText = String(recipeReference ?? "").trim();
    if (!refText) {
      return null;
    }
    if (/^\d+$/.test(refText)) {
      const asNumber = Number(refText);
      return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : null;
    }
    const fallbackMatch = refText.match(/^recipe\s*#?\s*(\d+)$/i);
    if (!fallbackMatch) {
      return null;
    }
    const fallbackId = Number(fallbackMatch[1]);
    return Number.isFinite(fallbackId) && fallbackId > 0 ? fallbackId : null;
  };

  const hydrateReportForm = (batch, reportData) => {
    const next = initialReportForm(batch);
    next.product_name =
      resolveMatchingProductTypeName(batch?.product_name) ||
      resolveMatchingProductTypeName(batch?.recipe_type);
    const recipeReference = batch?.recipe_id ?? batch?.recipe_type ?? null;
    const parsedRecipeId = parseRecipeIdFromReference(recipeReference);
    const matchedRecipe = recipeReference
      ? recipes.find((item) => {
          const itemName = String(item.name || "").trim();
          const refText = String(recipeReference).trim();
          return (
            itemName === refText ||
            Number(item.id) === Number(recipeReference) ||
            (parsedRecipeId != null && Number(item.id) === parsedRecipeId)
          );
        }) || null
      : null;
    if (matchedRecipe?.id != null) {
      next.recipe_id = matchedRecipe.id;
    }
    NUTRITION_FIELDS.concat(PHYSICAL_FIELDS).forEach((key) => {
      if (reportData?.[key] != null) {
        next[key] = String(reportData[key]);
      }
    });
    return next;
  };

  const recipeForReference = (recipeReference) => {
    if (recipeReference == null || recipeReference === "") {
      return null;
    }
    const refText = String(recipeReference).trim();
    if (!refText) {
      return null;
    }
    const parsedRecipeId = parseRecipeIdFromReference(recipeReference);
    if (parsedRecipeId != null) {
      const byId =
        recipes.find((item) => Number(item.id) === Number(parsedRecipeId)) ||
        null;
      if (byId) {
        return byId;
      }
    }
    return (
      recipes.find((item) => String(item.name || "").trim() === refText) || null
    );
  };

  const recipeMaterialsForRecipeId = (recipeReference) => {
    const selectedRecipe = recipeForReference(recipeReference);
    if (
      !selectedRecipe ||
      !Array.isArray(selectedRecipe.materials) ||
      selectedRecipe.materials.length === 0
    ) {
      return [{ ...EMPTY_MATERIAL_ROW }];
    }
    return selectedRecipe.materials.map((material) => ({
      rm_name: material.rm_name || "",
      quantity: String(material.quantity ?? ""),
    }));
  };

  const hydrateReportMaterials = (batchData, fallbackRecipeId) => {
    if (Array.isArray(batchData?.materials) && batchData.materials.length > 0) {
      return batchData.materials.map((material) => ({
        id: material.id,
        rm_name: material.rm_name || "",
        quantity: String(material.quantity ?? ""),
      }));
    }
    const recipeReference =
      batchData?.batch?.recipe_type ??
      batchData?.batch?.recipe_id ??
      fallbackRecipeId ??
      null;
    return recipeMaterialsForRecipeId(recipeReference);
  };

  const selectBatch = (batch) => {
    setSelectedBatch(batch);
    setShowConsumptionReport(false);
    productionApi
      .getBatch(batch.id)
      .then(({ data }) => setBatchDetail(data))
      .catch(() => setBatchDetail(null));
  };

  const openReportModal = async (batch, mode = "report") => {
    setSelectedBatch(batch);
    setReportModalMode(mode);
    try {
      const { data } = await productionApi.getBatch(batch.id);
      const apiBatch = data?.batch || batch;
      setBatchDetail(data || null);
      setReportForm(hydrateReportForm(apiBatch, data?.report));
      setReportMaterials(
        hydrateReportMaterials(data, apiBatch?.recipe_type ?? apiBatch?.recipe_id),
      );
    } catch {
      setReportForm(hydrateReportForm(batch, null));
      setReportMaterials(
        hydrateReportMaterials(null, batch?.recipe_type ?? batch?.recipe_id),
      );
    }
    setShowReport(true);
  };

  const buildEditDetailsPayload = () => {
    const enteredDate = String(reportForm.date || "").trim();
    const originalDateTime = String(reportModalBatch?.date || "").trim();
    const originalDateInput = toDateInputIST(originalDateTime, "");
    const datePayload =
      enteredDate && originalDateTime && enteredDate === originalDateInput
        ? originalDateTime
        : toApiDateTimeFromDateInput(enteredDate) || enteredDate;

    const payload = {
      date: datePayload,
      batch_no: String(reportForm.batch_no || "").trim(),
      product_name:
        resolveMatchingProductTypeName(reportForm.product_name) ||
        resolveMatchingProductTypeName(selectedRecipeForEdit?.name) ||
        resolveMatchingProductTypeName(reportModalBatch?.product_name),
      batch_size: reportForm.batch_size,
      mop: reportForm.mop,
      water: reportForm.water,
    };

    if (!payload.date) {
      return { payload: null, error: "Date is required." };
    }
    if (!payload.batch_no) {
      return { payload: null, error: "Batch No is required." };
    }
    if (!payload.product_name) {
      return { payload: null, error: "Product Type is required." };
    }
    if (!selectedRecipeForEdit) {
      return { payload: null, error: "Select a recipe for raw material production." };
    }
    if (invalidReportMaterialRows.length > 0) {
      return {
        payload: null,
        error: "Each material row must include name and weight greater than 0.",
      };
    }
    if (validReportMaterials.length === 0) {
      return { payload: null, error: "Add at least one valid material row." };
    }

    payload.recipe_id = selectedRecipeForEdit.id;
    payload.materials = validReportMaterials.map((item) => ({
      id: item.id,
      rm_name: item.rm_name,
      quantity: item.quantity,
    }));

    const parsedBatchSize = parseFloat(payload.batch_size);
    if (!Number.isFinite(parsedBatchSize) || parsedBatchSize <= 0) {
      return { payload: null, error: "Batch Count must be greater than 0." };
    }
    payload.batch_size = parsedBatchSize;

    if (payload.mop !== "") {
      const parsedMop = parseFloat(payload.mop);
      if (!Number.isFinite(parsedMop)) {
        return { payload: null, error: "MOP must be a valid number." };
      }
      payload.mop = parsedMop;
    } else {
      payload.mop = null;
    }

    if (payload.water !== "") {
      const parsedWater = parseFloat(payload.water);
      if (!Number.isFinite(parsedWater)) {
        return { payload: null, error: "Water must be a valid number." };
      }
      payload.water = parsedWater;
    } else {
      payload.water = null;
    }

    const existingNumBagsRaw =
      reportModalBatch?.num_bags != null
        ? String(reportModalBatch.num_bags).trim()
        : "";
    const existingWeightRaw =
      reportModalBatch?.weight_per_bag != null
        ? String(reportModalBatch.weight_per_bag).trim()
        : "";

    const numBagsRaw = String(reportForm.num_bags ?? "").trim() || existingNumBagsRaw;
    const weightRaw = String(reportForm.weight_per_bag ?? "").trim() || existingWeightRaw;
    const hasBothBagFields = numBagsRaw !== "" && weightRaw !== "";
    if (hasBothBagFields) {
      const parsedNumBags = parseFloat(numBagsRaw);
      if (!Number.isFinite(parsedNumBags) || parsedNumBags <= 0) {
        return { payload: null, error: "Number of bags must be greater than 0." };
      }
      payload.num_bags = parsedNumBags;

      const parsedWeightPerBag = parseFloat(weightRaw);
      if (!Number.isFinite(parsedWeightPerBag) || parsedWeightPerBag <= 0) {
        return { payload: null, error: "Weight per bag must be greater than 0." };
      }
      payload.weight_per_bag = parsedWeightPerBag;
      payload.output = parsedNumBags * parsedWeightPerBag;
    }

    return { payload, error: "" };
  };

  const handleMarkBatchComplete = async () => {
    const batchId =
      reportModalBatch?.id || selectedBatch?.id || reportForm.batch_id;
    if (!batchId) {
      setReportError("Batch not selected.");
      return;
    }
    if (markCompleteEligibility.loading) {
      setReportError("Validating raw material stock. Please wait.");
      return;
    }
    if (!markCompleteEligibility.allowed) {
      setReportError(
        markCompleteEligibility.detail || "Insufficient raw material stock.",
      );
      return;
    }

    setReportError("");
    setMarkCompleteLoading(true);
    try {
      if (reportModalMode === "edit") {
        const { payload, error } = buildEditDetailsPayload();
        if (error) {
          setReportError(error);
          return;
        }
        await productionApi.updateBatchDetails(batchId, payload);
      }

      const { data } = await productionApi.markBatchComplete(batchId);
      const updatedBatch = data?.batch || null;
      if (updatedBatch) {
        setSelectedBatch(updatedBatch);
        setBatchDetail((prev) =>
          prev && prev.batch
            ? { ...prev, batch: { ...prev.batch, ...updatedBatch } }
            : prev,
        );
      }
      await loadBatches();
      loadCurrentMonthSummary();
      const warning = String(
        data?.warning || updatedBatch?.rm_shortage_detail || "",
      ).trim();
      if (warning) {
        setReportError(warning);
        setSuccessMsg("Batch marked as complete with stock warning.");
      } else {
        setSuccessMsg(
          "Batch marked as complete and stock ledgers updated.",
        );
      }
    } catch (err) {
      const detail =
        err?.response?.data?.detail || "Unable to mark batch as complete.";
      setReportError(detail);
    } finally {
      setMarkCompleteLoading(false);
    }
  };

  const handleReportProductChange = (value) => {
    setReportForm((prev) => ({ ...prev, product_name: value }));
  };

  const handleReportRecipeChange = (value) => {
    const recipeId = value ? Number(value) : null;
    const selectedRecipe =
      recipes.find((item) => Number(item.id) === Number(recipeId)) || null;
    const matchedProductType = resolveMatchingProductTypeName(
      selectedRecipe?.name,
    );
    setReportForm((prev) => {
      const previousRecipe =
        recipes.find((item) => Number(item.id) === Number(prev.recipe_id)) ||
        null;
      const previousRecipeName = String(previousRecipe?.name || "").trim();
      const currentProductName = String(prev.product_name || "").trim();
      const shouldClearUnmatched =
        !matchedProductType &&
        (!currentProductName || currentProductName === previousRecipeName);

      return {
        ...prev,
        recipe_id: recipeId,
        product_name:
          matchedProductType || (shouldClearUnmatched ? "" : prev.product_name),
      };
    });
    setReportMaterials(recipeMaterialsForRecipeId(recipeId));
  };

  const addReportMaterialRow = () => {
    setReportMaterials((prev) => [...prev, { ...EMPTY_MATERIAL_ROW }]);
  };

  const removeReportMaterialRow = (index) => {
    setReportMaterials((prev) =>
      prev.length === 1
        ? [{ ...EMPTY_MATERIAL_ROW }]
        : prev.filter((_, i) => i !== index),
    );
  };

  const updateReportMaterialRow = (index, field, value) => {
    setReportMaterials((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  };

  const handleRecipeChange = (value) => {
    const recipeId = value ? Number(value) : null;
    const selectedRecipe =
      recipes.find((item) => Number(item.id) === Number(recipeId)) || null;
    const matchedProductType = resolveMatchingProductTypeName(
      selectedRecipe?.name,
    );
    setBatchForm((form) => {
      const previousRecipe =
        recipes.find((item) => Number(item.id) === Number(form.recipe_id)) ||
        null;
      const previousRecipeName = String(previousRecipe?.name || "").trim();
      const currentProductName = String(form.product_name || "").trim();
      const shouldClearUnmatched =
        !matchedProductType &&
        (!currentProductName || currentProductName === previousRecipeName);

      return {
        ...form,
        recipe_id: selectedRecipe?.id ?? recipeId,
        product_name:
          matchedProductType || (shouldClearUnmatched ? "" : form.product_name),
      };
    });

    if (
      !selectedRecipe ||
      !Array.isArray(selectedRecipe.materials) ||
      selectedRecipe.materials.length === 0
    ) {
      setBatchMaterials([{ ...EMPTY_MATERIAL_ROW }]);
      return;
    }

    setBatchMaterials(
      selectedRecipe.materials.map((material) => ({
        rm_name: material.rm_name || "",
        quantity: String(material.quantity ?? ""),
      })),
    );
  };

  const addBatchMaterialRow = () => {
    setBatchMaterials((prev) => [...prev, { ...EMPTY_MATERIAL_ROW }]);
  };

  const removeBatchMaterialRow = (index) => {
    setBatchMaterials((prev) =>
      prev.length === 1
        ? [{ ...EMPTY_MATERIAL_ROW }]
        : prev.filter((_, i) => i !== index),
    );
  };

  const updateBatchMaterialRow = (index, field, value) => {
    setBatchMaterials((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  };

  const numBagsQty = Number(batchForm.num_bags);
  const weightPerBagQty = Number(batchForm.weight_per_bag);
  const outputQty = numBagsQty * weightPerBagQty;
  const normalizedMaterialRows = batchMaterials.map((item) => {
    const rawQty = String(item.quantity ?? "").trim();
    const quantity = Number(item.quantity);
    return {
      rm_name: (item.rm_name || "").trim(),
      rawQty,
      quantity,
    };
  });
  const invalidMaterialRows = normalizedMaterialRows.filter(
    (item) =>
      (item.rm_name &&
        (!item.rawQty ||
          !Number.isFinite(item.quantity) ||
          item.quantity <= 0)) ||
      (!item.rm_name && item.rawQty),
  );
  const recipeMaterials = normalizedMaterialRows.filter(
    (item) =>
      item.rm_name && Number.isFinite(item.quantity) && item.quantity > 0,
  );

  const handleBatchSubmit = async (e) => {
    e.preventDefault();
    setBatchError("");

    if (!batchForm.recipe_id) {
      setBatchError("Select a recipe for raw material production.");
      return;
    }
    if (!batchForm.product_name) {
      setBatchError("Select a product type for finished stock.");
      return;
    }
    if (!Number.isFinite(numBagsQty) || numBagsQty <= 0) {
      setBatchError("Number of bags must be greater than 0.");
      return;
    }
    if (!Number.isFinite(weightPerBagQty) || weightPerBagQty <= 0) {
      setBatchError("Weight per bag must be greater than 0.");
      return;
    }
    if (!Number.isFinite(outputQty) || outputQty <= 0) {
      setBatchError("Total output must be greater than 0.");
      return;
    }
    if (invalidMaterialRows.length > 0) {
      setBatchError(
        "Each material row must have raw material name and weight greater than 0.",
      );
      return;
    }

    if (recipeMaterials.length === 0) {
      setBatchError(
        "Selected recipe does not have valid material weight rows.",
      );
      return;
    }

    try {
      await productionApi.createBatch({
        ...batchForm,
        batch_no: String(batchForm.batch_no || "").trim() || null,
        date: toApiDateTimeFromDateInput(batchForm.date) || batchForm.date,
        batch_size: parseFloat(batchForm.batch_size),
        mop: batchForm.mop ? parseFloat(batchForm.mop) : null,
        water: batchForm.water ? parseFloat(batchForm.water) : null,
        num_bags: numBagsQty,
        weight_per_bag: weightPerBagQty,
        output: outputQty,
        materials: recipeMaterials.map((item) => ({
          rm_name: item.rm_name,
          quantity: item.quantity,
        })),
      });
      setSuccessMsg("Batch added successfully.");
      setShowAddBatch(false);
      setBatchForm(initialBatchForm());
      setBatchMaterials([{ ...EMPTY_MATERIAL_ROW }]);
      setBatchError("");
      loadBatches();
      loadCurrentMonthSummary();
    } catch (err) {
      const detail = err?.response?.data?.detail || "Unable to create batch.";
      setBatchError(detail);
    }
  };

  const handleReportSubmit = async (e) => {
    e.preventDefault();
    setReportError("");
    const batchId = selectedBatch?.id || reportForm.batch_id;
    if (!batchId) {
      setReportError("Batch not selected.");
      return;
    }

    if (reportModalMode === "edit") {
      const { payload, error } = buildEditDetailsPayload();
      if (error) {
        setReportError(error);
        return;
      }

      try {
        await productionApi.updateBatchDetails(batchId, payload);
        setShowReport(false);
        setReportError("");
        productionApi
          .getBatch(batchId)
          .then(({ data }) => setBatchDetail(data))
          .catch(() => {});
        loadBatches();
        loadCurrentMonthSummary();
        setSuccessMsg("Batch details updated successfully.");
      } catch (err) {
        const detail =
          err?.response?.data?.detail || "Unable to update batch details.";
        setReportError(detail);
      }
      return;
    }

    const payload = { batch_id: batchId };
    for (const key of NUTRITION_FIELDS.concat(PHYSICAL_FIELDS)) {
      const raw = String(reportForm[key] ?? "").trim();
      if (!raw) {
        payload[key] = "";
        continue;
      }
      const parsed = parseFloat(raw);
      if (!Number.isFinite(parsed)) {
        setReportError(`${key.replace(/_/g, " ")} must be a valid number.`);
        return;
      }
      payload[key] = parsed;
    }

    try {
      await productionApi.submitReport(payload);
      setShowReport(false);
      setReportError("");
      productionApi
        .getBatch(batchId)
        .then(({ data }) => setBatchDetail(data))
        .catch(() => {});
      loadBatches();
      loadCurrentMonthSummary();
      setSuccessMsg("Report submitted successfully.");
    } catch (err) {
      const detail = err?.response?.data?.detail || "Unable to submit report.";
      setReportError(detail);
    }
  };

  const download = (format) => {
    productionApi.download(format, buildDownloadParams()).then(({ data }) => {
      const ext =
        format === "pdf"
          ? "pdf"
          : format === "xlsx" || format === "excel"
            ? "xlsx"
            : "csv";
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `production_report.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const downloadBatchReport = (batchId, format) => {
    productionApi.downloadBatch(batchId, format).then(({ data }) => {
      const ext = format === "pdf" ? "pdf" : "xlsx";
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `batch_${batchId}_report.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const downloadConsumptionReport = (batchId, format) => {
    productionApi.downloadBatchConsumption(batchId, format).then(({ data }) => {
      const ext = format === "pdf" ? "pdf" : "xlsx";
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `batch_${batchId}_consumption_report.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const getRecipeMaterials = (productName) => {
    const recipe = recipes.find((r) => r.name === productName);
    if (!recipe || !recipe.materials) return "";

    return recipe.materials
      .map((m) => `${m.rm_name} (${m.quantity}kg)`)
      .join(" • ");
  };

  const getRecipeName = (recipeId) => {
    const recipe = recipes.find((item) => Number(item.id) === Number(recipeId));
    return recipe?.name || "";
  };

  return (
    <div className="space-y-6 pb-2 md:pb-28 lg:pb-0" >    {/* Image in card  */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Production Card */}
        <div
          className="relative rounded-2xl overflow-hidden shadow-md h-40 flex items-center"
          style={{
            backgroundImage: `url(${productionBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="absolute inset-0 bg-white/20"></div>
          {/* <div className="relative rounded-xl shadow-md overflow-hidden h-36 sm:h-40"> */}

          {/* ✅ ADD THIS (top-right label like design) */}
          <div className="absolute top-2 right-3 z-20 text-[11px] sm:text-xs font-bold border border-orange-950 text-[#7a2e0e] bg-white px-2 py-0.5 rounded">
            {currentMonthLabel}
          </div>

          {/* content */}
          <div className="relative z-10 px-6  h-full flex flex-col justify-center text-center">
            {/* <p className="text-sm font-medium text-[#7a2e0e]/90">
        {currentMonthLabel}
      </p> */}
            <p className="text-2xl font-semibold text-[#7a2e0e]">
              Total Production
            </p>
            <p className="text-3xl font-bold text-[#7a2e0e]">
              {Number(currentMonthProductionDisplay)}{" "}
              <span className="text-base font-medium">MT</span>
            </p>
            {/* </div> */}
          </div>
        </div>

        <div
          className="relative rounded-2xl overflow-hidden shadow-md h-40 flex items-center"
          style={{
            backgroundImage: `url(${batchwise})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="absolute inset-0 bg-white/20"></div>
          {/* <div className="relative rounded-xl shadow-md overflow-hidden h-36 sm:h-40"> */}

          {/* ✅ ADD THIS (top-right label like design) */}
          <div className="absolute top-2 right-3 z-20 text-[11px] sm:text-xs font-bold border border-orange-950 text-[#7a2e0e] bg-white px-2 py-0.5 rounded">
            {currentMonthLabel}
          </div>

          {/* content */}
          <div className="relative z-10 px-6  h-full flex flex-col justify-center text-center">
            {/* <p className="text-sm font-medium text-[#7a2e0e]/90">
        {currentMonthLabe
      </p> */}
            <p className="text-2xl font-semibold text-[#7a2e0e]">Total Batch</p>
            <p className="text-3xl font-bold text-[#7a2e0e]">
              {currentMonthBatchCount}
              <span className="text-base font-medium"> batches</span>
            </p>
            {/* </div> */}
          </div>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl font-semibold text-slate-800">Production</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => download("pdf")}
            className="px-4 py-2 rounded-lg border border-gray-600 text-gray-800 hover:bg-primary-light"
          >
            Download PDF
          </button>
          <button
            onClick={() => download("xlsx")}
            className="px-4 py-2 rounded-lg border border-gray-600 text-gray-800 hover:bg-primary-light"
          >
            Download Excel
          </button>
        </div>
      </div>
      {successMsg && (
        <div className="bg-green-100 text-green-800 px-4 py-2 rounded-lg">
          {successMsg}
        </div>
      )}
      <Modal
        open={showAddBatch}
        onClose={() => {
          setShowAddBatch(false);
          setBatchError("");
        }}
        title="Add Production Batch"
      >
        <form onSubmit={handleBatchSubmit} className="space-y-4">
          {batchError && (
            <div className="bg-red-100 text-red-800 px-4 py-3 rounded-lg text-sm border border-red-300">
              {batchError}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-black mb-1">Date</label>
              <input
                type="date"
                value={batchForm.date}
                onChange={(e) =>
                  setBatchForm((f) => ({ ...f, date: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-slate-800"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-black mb-1">
                Recipe
              </label>
              <select
                value={batchForm.recipe_id || ""}
                onChange={(e) => handleRecipeChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-slate-800"
                required
              >
                <option value="">Select</option>
                {recipes.map((item) => {
                  const shortText =
                    item.name.length > 25
                      ? `${item.name.substring(0, 25)}...`
                      : item.name;
                  return (
                    <option key={`batch-recipe-${item.id}`} value={item.id}>
                      {shortText}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-sm text-black mb-1">
                Product Type
              </label>
              <select
                value={batchForm.product_name}
                onChange={(e) =>
                  setBatchForm((f) => ({
                    ...f,
                    product_name: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-slate-800"
                required
              >
                <option value="">Select</option>
                {productTypes.map((type) => {
                  const shortText =
                    type.length > 25 ? `${type.substring(0, 25)}...` : type;
                  return (
                    <option key={`batch-product-${type}`} value={type}>
                      {shortText}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm text-black mb-1">Batch No</label>
              <input
                type="text"
                value={batchForm.batch_no}
                onChange={(e) =>
                  setBatchForm((f) => ({ ...f, batch_no: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-slate-800"
                placeholder="Auto if empty"
              />
            </div>
            <div>
              <label className="block text-sm text-black mb-1">
                Batch count
              </label>
              <input
                type="number"
                step="any"
                value={batchForm.batch_size}
                onChange={(e) =>
                  setBatchForm((f) => ({ ...f, batch_size: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-slate-800"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-black mb-1">MOP</label>
              <input
                type="number"
                step="any"
                value={batchForm.mop}
                onChange={(e) =>
                  setBatchForm((f) => ({ ...f, mop: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-slate-800"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-black mb-1">Water</label>
              <input
                type="number"
                step="any"
                value={batchForm.water}
                onChange={(e) =>
                  setBatchForm((f) => ({ ...f, water: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-slate-800"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-black mb-1">
                No. of Bags
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={batchForm.num_bags}
                onChange={(e) =>
                  setBatchForm((f) => ({ ...f, num_bags: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-slate-800"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-black mb-1">
                Weight/Bag (kg)
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={batchForm.weight_per_bag}
                onChange={(e) =>
                  setBatchForm((f) => ({
                    ...f,
                    weight_per_bag: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 rounded-lg bg-primary-light border border-gray-600 text-slate-800"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-black mb-1">
                Total Output (kg)
              </label>
              <input
                type="number"
                step="any"
                value={Number.isFinite(outputQty) ? outputQty.toFixed(2) : ""}
                className="w-full px-3 py-2 rounded-lg bg-gray-100 border border-gray-400 text-slate-800"
                readOnly
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm text-black">
                Recipe Material Split
              </label>
              <button
                type="button"
                onClick={addBatchMaterialRow}
                className="px-2 py-1 rounded border border-gray-600 text-sm text-black"
              >
                + Add Material
              </button>
            </div>
            {batchForm.recipe_id ? (
              // <p className="text-xs text-gray-600">Materials are auto-filled from recipe. You can edit and add rows.</p>
              <p className="text-xs text-gray-600">
                Select recipe to auto-fill raw material split.
              </p>
            ) : (
              <p className="text-xs text-gray-600">
                Select recipe to auto-fill raw material split.
              </p>
            )}
            <div className="space-y-2">
              {batchMaterials.map((material, index) => (
                <div
                  key={`batch-material-${index}`}
                  className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end"
                >
                  <div className="md:col-span-7">
                    <label className="block text-xs text-black mb-1">
                      Raw Material
                    </label>
                    {/* <input
                      type="text"
                      value={material.rm_name}
                      onChange={(e) => updateBatchMaterialRow(index, 'rm_name', e.target.value)}
                      className="w-full px-3 py-2 rounded border border-gray-300"
                      placeholder="Enter raw material"
                    /> */}

                    <input
                      type="text"
                      value={material.rm_name}
                      disabled
                      className="w-full px-3 py-2 rounded bg-gray-100 border border-gray-300 cursor-not-allowed"
                    />
                  </div>
                  <div className="md:col-span-5">
                    <label className="block text-xs text-black mb-1">
                      Weight (kg)
                    </label>
                    {/* <input
                      type="number"
                      step="any"
                      min="0"
                      value={material.quantity}
                      onChange={(e) => updateBatchMaterialRow(index, 'quantity', e.target.value)}
                      className="w-full px-3 py-2 rounded border border-gray-300"
                      placeholder="0"
                    /> */}

                    <input
                      type="number"
                      value={material.quantity}
                      disabled
                      className="w-full px-3 py-2 rounded bg-gray-100 border border-gray-300 cursor-not-allowed"
                    />
                  </div>
                  <div className="md:col-span-1">
                    <button
                      type="button"
                      onClick={() => removeBatchMaterialRow(index)}
                      className="w-full px-2 py-2 rounded border border-gray-600 text-black text-sm"
                    >
                      X
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {recipeMaterials.length > 0 && (
              <p className="text-xs text-gray-600">
                Total Recipe Weight:{" "}
                {recipeMaterials
                  .reduce((sum, item) => sum + item.quantity, 0)
                  .toFixed(2)}{" "}
                kg
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-accent-green text-primary font-medium"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowAddBatch(false)}
              className="px-4 py-2 rounded-lg border border-gray-600 text-black"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>
      <div className="bg-primary-card border border-gray-300 rounded-xl overflow-hidden">
        {/* <h2 className="text-sm font-medium text-gray-900 px-4 py-3 border-b border-gray-700">Production report (batch-wise)</h2> */}
      
          <div className="bg-primary-card border border-gray-300 rounded-xl ">
            <div className="p-4 bg-white border-b border-gray-100 flex flex-wrap gap-4 items-end">
               <div className="w-full md:w-64">
                <label className="block text-xs text-gray-500 mb-1">
                  Search
                </label>
                <div className="relative">
                  <img
                    src={searchIcon}
                    alt="search"
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-60"
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="pl-9  w-full pr-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm  focus:ring-2 focus:ring-[#2F5D5D]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Product Type
                </label>
                <select
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm min-w-[150px]"
                >
                  <option value="">All</option>
                  {productTypes.map((type) => {
                    const shortText =
                      type.length > 25 ? type.slice(0, 25) + "..." : type;
                    return (
                      <option key={type} value={type}>
                        {shortText}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Period
                </label>
                <select
                  value={dateRangeType}
                  onChange={(e) => setDateRangeType(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm min-w-[150px]"
                >
                  {DATE_RANGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {dateRangeType === "custom" && (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      From
                    </label>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      To
                    </label>
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
          </div>
  <div className="overflow-x-auto">
          <table className="w-full text-left  text-sm">
            <thead>
              <tr className="bg-[#2F5D5D] text-white text-center">
                <th colSpan={6} className="px-4 py-2 border">
                  Machine Data
                </th>
                <th colSpan={6} className="px-4 py-2 border">
                  Manual Entry Data
                </th>
              </tr>
              <tr className="bg-[#2F5D5D] text-white">
                <th className="px-4 py-3 border">Date</th>
                <th className="px-4 py-3 text-left border border-gray-300">
                  Batch #
                </th>
                <th className="px-4 py-3 text-left border border-gray-300">
                  Recipe
                </th>
                <th className="px-4 py-3 text-left border border-gray-300">
                  Batch Count Assigned
                </th>
                <th className="px-4 py-3 text-left border border-gray-300">
                  Batch Count Utilized
                </th>
                <th className="px-4 py-3 text-left border border-gray-300">
                  Status
                </th>
                <th className="px-4 py-3 text-left border border-gray-300">
                  Product Type
                </th>
                <th className="px-4 py-3 text-left border border-gray-300">
                  No. of Bags
                </th>
                <th className="px-4 py-3 text-left border border-gray-300">
                  Weight/Bag
                </th>
                <th className="px-4 py-3 text-left border border-gray-300">
                  Total Output
                </th>
                <th className="px-4 py-3 text-left border border-gray-300">
                  Report
                </th>
                <th className="px-4 py-3 text-left border border-gray-300">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredBatches.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-4 text-gray-500">
                    No batches available. Create and run batches from HMI.
                  </td>
                </tr>
              )}
              {paginatedBatches.map((b) => (
                <tr
                  key={b.id}
                  className="border-b border-gray-700/50 hover:bg-primary-light/30"
                >
                  <td className="px-4 py-3 border">{formatDateIST(b.date)}</td>
                  <td className="px-4 py-3 border border-gray-300 break-all">
                    {b.batch_no || b.id}
                  </td>
                  {/* <td className="px-4 py-3 border border-gray-300">{b.product_name || '—'}</td> */}
                  <td className="px-4 py-3 border border-gray-300">
                    <div className="flex flex-col">
                      <span className="font-normal text-gray-900 break-all">
                        {b.recipe_type ||
                          getRecipeName(b.recipe_id) ||
                          `Recipe #${b.recipe_id || "—"}`}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 border border-gray-300">
                    {b.batch_size}
                  </td>
                  <td className="px-4 py-3 border border-gray-300">
                    {b.completed_count || "—"}
                  </td>
                  <td className="px-4 py-3 border border-gray-300 capitalize">
                    {b.run_status || "pending"}
                  </td>
                  <td className="px-4 py-3 border border-gray-300">
                    <div className="flex flex-col">
                      <span className="font-normal text-gray-900 break-all">
                    {resolveMatchingProductTypeName(b.product_name) ||
                      resolveMatchingProductTypeName(b.recipe_type) ||
                      "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 border border-gray-300">
                    {b.num_bags ?? "—"}
                  </td>
                  <td className="px-4 py-3 border border-gray-300">
                    {b.weight_per_bag ?? "—"}
                  </td>
                  <td className="px-4 py-3 border border-gray-300">
                    {b.output > 0 ? b.output : "—"}
                  </td>
                  <td className="px-4 py-3 border border-gray-300">
                    {b.has_report &&
                    b.num_bags &&
                    b.weight_per_bag &&
                    b.output ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => downloadBatchReport(b.id, "pdf")}
                          className="px-2 py-1 text-xs bg-red-500 text-white rounded"
                        >
                          PDF
                        </button>

                        <button
                          onClick={() => downloadBatchReport(b.id, "xlsx")}
                          className="px-2 py-1 text-xs bg-green-600 text-white rounded"
                        >
                          Excel
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-500">Not Filled</span>
                    )}
                  </td>

                  <td className="px-4 py-3 border border-gray-300">
                    <div className="flex whitespace-nowrap gap-2">
                      <button
                        onClick={() =>
                          requestPin(() => openReportModal(b, "edit"), {
                            title: "PIN Required",
                            message: "Enter PIN to edit (1234) batch details.",
                            pinType: "production_details_edit",
                          })
                        }
                        className={`px-2 py-1 text-xs border rounded hover:bg-gray-100 ${
                          b.mop != null && b.water != null
                            ? "border-gray-500 text-gray-900 bg-white"
                            : "bg-green-600 text-white font-semibold hover:bg-green-700"
                        }`}
                      >
                        {b.mop != null && b.water != null
                          ? "Edit Details"
                          : "Add Details"}
                      </button>
                      <button
                        onClick={() =>
                          requestPin(() => openReportModal(b, "report"), {
                            title: "PIN Required",
                            message: "Enter PIN to add/edit batch report.",
                            pinType: "production_report_access",
                          })
                        }
                        className={`px-2 py-1 text-xs rounded text-white ${
                          b.has_report
                            ? "bg-indigo-600 hover:bg-indigo-700"
                            : "bg-blue-600 hover:bg-blue-700"
                        }`}
                      >
                        {b.has_report ? "Edit Report" : "Add Report"}
                      </button>
                      <button
                        onClick={() => {
                          selectBatch(b);
                          setTimeout(() => {
                            reportRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }, 100);
                        }}
                        className="px-2 py-1 text-xs bg-slate-600 hover:bg-slate-700 text-white rounded"
                      >
                        View Report
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-300">
            <span className="text-sm text-gray-600">
              Page {page} of {totalPages || 1}
            </span>

            <div className="flex gap-1">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-40"
              >
                ◀
              </button>

    {(() => {
  let pages = [page - 1, page, page + 1];

  if (page <= 2) {
    pages = [1, 2, 3];
  }

  if (page >= totalPages - 1) {
    pages = [totalPages - 2, totalPages - 1, totalPages];
  }

  return pages
    .filter((p) => p >= 1 && p <= totalPages)
    .map((p) => (
      <button
        key={p}
        onClick={() => setPage(p)}
        className={`px-3 py-1 border rounded ${
          page === p ? "bg-[#2F5D5D] text-white" : "bg-white"
        }`}
      >
        {p}
      </button>
    ));
})()}



              <button
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-40"
              >
                ▶
              </button>
            </div>
          </div>
      
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div ref={reportRef}>
          <div>
            <h2 className="text-sm font-medium text-gray-900 mb-3">
              Batches for {periodBatchLabel} (select to view)
            </h2>

            <div className="flex items-center justify-between mt-4 mb-2">
              {/* LEFT SIDE - PAGE TEXT */}
              <span className="text-sm text-gray-600">
                Page {periodPage} of {totalPeriodPages || 1}
              </span>

              {/* RIGHT SIDE - PAGINATION */}
              <div className="flex items-center gap-2">
                {/* Prev */}
                <button
                  disabled={periodPage === 1}
                  onClick={() => setPeriodPage((p) => p - 1)}
                  className="w-8 h-8 flex items-center justify-center border rounded 
                 bg-white text-gray-700 
                 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ◀
                </button>

                {/* Current Page */}
                <span
                  className="w-7 h-7 flex items-center justify-center rounded 
                     bg-[#245658] text-white text-sm font-semibold"
                >
                  {periodPage}
                </span>

                {/* Next */}
                <button
                  disabled={periodPage === totalPeriodPages}
                  onClick={() => setPeriodPage((p) => p + 1)}
                  className="w-8 h-8 flex items-center justify-center border rounded 
                 bg-white text-gray-700 
                 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ▶
                </button>
              </div>
            </div>

            {/* newly added  */}
            <div className="space-y-2">
              {periodBatches.length === 0 && (
                <p className="text-gray-900 text-sm">
                  No batches for selected period.
                </p>
              )}
              {paginatedPeriodBatches.map((b) => (
                <button
                  key={b.id}
                  onClick={() => selectBatch(b)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    selectedBatch?.id === b.id
                      ? "border-accent-green bg-accent-green/5 text-white"
                      : "border-gray-700 bg-primary-card text-gray-300 hover:border-gray-600"
                  }`}
                >
                  {/* <span className="font-medium text-gray-900">Batch #{b.batch_no || b.id}</span>
                
                <span className="block text-sm opacity-80 text-gray-900">
                  {b.progress_label || '—'} • {(b.run_status || 'pending').toUpperCase()} • {b.product_name || 'Product pending'}
                </span> */}

                  <div className="flex flex-col gap-1">
                    {/* Batch */}
                    <span className="text-base font-bold text-gray-900">
                      Batch #{b.batch_no || b.id}
                    </span>

                    <span className="text-lg font-extrabold text-[#245658] py-0.5 rounded w-fit break-all">
                      {resolveMatchingProductTypeName(b.product_name) ||
                        resolveMatchingProductTypeName(b.recipe_type) ||
                        "Product pending"}
                    </span>

                    {/* Status Row */}
                    <div className="flex items-center gap-2 text-xs font-bold">
                      {/* Progress */}
                      <span className="text-gray-700">
                        {b.progress_label || "—"}
                      </span>

                      <span className="text-gray-400">•</span>

                      {/* Status Color */}
                      <span
                        className={`px-2 py-0.5 rounded 
        ${
          (b.run_status || "pending").toLowerCase() === "completed"
            ? "bg-green-100 text-green-700 border border-green-700"
            : (b.run_status || "pending").toLowerCase() === "running"
              ? "bg-blue-100 text-blue-700 border border-blue-700"
              : "bg-yellow-100 text-yellow-800 border border-yellow-700"
        }`}
                      >
                        {(b.run_status || "pending").toUpperCase()}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="lg:col-span-2 pb-2 sm:pb-5">
          <h2 className="text-sm font-medium text-gray-900 mb-3 ">
            Batch-wise Report
          </h2>
          {!selectedBatch && periodBatches.length === 0 && (
            <p className="text-gray-800 text-sm">
              No batches available for selected period.
            </p>
          )}
          {selectedBatch && batchDetail && (
            <div className="bg-primary-card border border-gray-700 rounded-xl p-4 space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-gray-500">Batch No</p>
                  <p className="text-gray-900 font-medium">
                    {batchDetail.batch?.batch_no || batchDetail.batch?.id}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Recipe</p>
                  <p className="text-gray-900 font-medium break-all">
                    {batchDetail.batch?.recipe_type ||
                      getRecipeName(batchDetail.batch?.recipe_id) ||
                      `Recipe #${batchDetail.batch?.recipe_id || "—"}`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Product Type</p>
                  <p className="text-gray-900 font-medium break-all">
                    {resolveMatchingProductTypeName(
                      batchDetail.batch?.product_name,
                    ) ||
                      resolveMatchingProductTypeName(
                        batchDetail.batch?.recipe_type,
                      ) ||
                      "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Batch Count Assigned</p>
                  <p className="text-gray-900">
                    {batchDetail.batch?.batch_size}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Batch Count Utilized</p>
                  <p className="text-gray-900">
                    {batchDetail.batch?.completed_count || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Run Status</p>
                  <p className="text-gray-900 capitalize">
                    {batchDetail.batch?.run_status || "pending"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">MOP</p>
                  <p className="text-gray-900">
                    {batchDetail.batch?.mop ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Water</p>
                  <p className="text-gray-900">
                    {batchDetail.batch?.water ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">No. of Bags</p>
                  <p className="text-gray-900">
                    {batchDetail.batch?.num_bags ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Weight/Bag</p>
                  <p className="text-gray-900">
                    {batchDetail.batch?.weight_per_bag ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total Output</p>
                  <p className="text-accent-green font-medium">
                    {batchDetail.batch?.output}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Last Modified</p>
                  <p className="text-gray-900">
                    {formatDateTimeIST(
                      batchDetail.batch?.last_modified_at,
                      "—",
                    )}
                  </p>
                </div>
              </div>
              <div className="border-t border-gray-700 pt-4">
                <p className="text-sm font-medium text-gray-900 mb-2">
                  Raw Materials Consumed
                </p>
                {Array.isArray(batchDetail.materials) &&
                batchDetail.materials.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-300">
                          <th className="py-2 pr-2">Material</th>
                          <th className="py-2 pr-2">Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchDetail.materials.map((material) => (
                          <tr
                            key={
                              material.id ||
                              `${material.rm_name}-${material.quantity}`
                            }
                            className="border-b border-gray-200"
                          >
                            <td className="py-2 pr-2 text-gray-900 max-w-[100px] break-all">
                              {material.rm_name}
                            </td>
                            <td className="py-2 pr-2 text-gray-900 max-w-[100px] break-all">
                              {material.quantity}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    No raw material data for this batch.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full">
                <button
                  onClick={() =>
                    requestPin(() => openReportModal(selectedBatch, "report"), {
                      title: "PIN Required",
                      message:
                        "Enter PIN to edit (1234) chemical and physical report values.",
                      pinType: "production_report_access",
                    })
                  }
                  className="px-4 py-2 rounded-lg bg-[#245658] text-primary font-medium"
                >
                  Add / Edit Chemical & Physical
                </button>
                <button
                  onClick={() => downloadBatchReport(selectedBatch.id, "pdf")}
                  className="px-4 py-2 rounded-lg border border-gray-600 text-gray-900 hover:bg-gray-100"
                >
                  Download Batch Report (PDF)
                </button>

                <button
                  onClick={() => downloadBatchReport(selectedBatch.id, "xlsx")}
                  className="px-4 py-2 rounded-lg border border-gray-600 text-gray-900 hover:bg-gray-100"
                >
                  Download Batch Report (Excel)
                </button>
                <button
                  onClick={() => {
                    setShowConsumptionReport((prev) => !prev);
                    setTimeout(() => {
                      consumptionRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }, 100);
                  }}
                  className="px-4 py-2 rounded-lg border border-gray-600 text-gray-900 hover:bg-gray-100"
                >
                  Consumption Report
                </button>
              </div>
              {showConsumptionReport && (
                <div
                  ref={consumptionRef}
                  className="border-t border-gray-700 pt-4 space-y-3"
                >
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-medium text-gray-900">
                      CONSUMPTION REPORT
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() =>
                          downloadConsumptionReport(selectedBatch.id, "pdf")
                        }
                        className="px-3 py-1.5 text-xs bg-red-500 text-white rounded"
                      >
                        <span className="hidden sm:inline">Download PDF</span>
                        <span className="sm:hidden">PDF</span>
                      </button>
                      <button
                        onClick={() =>
                          downloadConsumptionReport(selectedBatch.id, "xlsx")
                        }
                        className="px-3 py-1.5 text-xs bg-green-600 text-white rounded"
                      >
                        <span className="hidden sm:inline">Download Excel</span>
                        <span className="sm:hidden">Excel</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-900">
                    Consumption calculated on basis of total Batch Count * total
                    weight of that batch.
                  </p>
                  <p className="text-sm text-gray-900">
                    All RM materials used in this batch are shown below.
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-gray-400">
                      <thead>
                        <tr className="text-left text-[#245658]">
                          <th className="px-3 py-2 border border-gray-400">
                            RM NAME
                          </th>
                          <th className="px-3 py-2 border border-gray-400">
                            WEIGHT/BATCH
                          </th>
                          <th className="px-3 py-2 border border-gray-400">
                            TOTAL BATCH
                          </th>
                          <th className="px-3 py-2 border border-gray-400">
                            TOTAL WEIGH
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedConsumptionRows.map((row, idx) => (
                          <tr key={`${row.rm_name}-${idx}`}>
                            <td className="px-3 py-1.5 border border-gray-300 text-gray-900 break-all min-w-[100px]">
                              {row.rm_name}
                            </td>
                            <td className="px-3 py-1.5 border border-gray-300 text-gray-900">
                              {row.weight_per_batch.toFixed(2)}
                            </td>
                            <td className="px-3 py-1.5 border border-gray-300 text-gray-900">
                              {row.total_batch.toFixed(2)}
                            </td>
                            <td className="px-3 py-1.5 border border-gray-300 text-gray-900">
                              {row.total_weight.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                        <tr className="font-semibold">
                          <td className="px-3 py-1.5 border border-gray-300 text-gray-900">
                            TOTAL
                          </td>
                          <td className="px-3 py-1.5 border border-gray-300 text-gray-900">
                            {selectedConsumptionTotal.weight_per_batch.toFixed(
                              2,
                            )}
                          </td>
                          <td className="px-3 py-1.5 border border-gray-300 text-gray-900">
                            {selectedConsumptionTotal.total_batch.toFixed(2)}
                          </td>
                          <td className="px-3 py-1.5 border border-gray-300 text-gray-900">
                            {selectedConsumptionTotal.total_weight.toFixed(2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-sm text-gray-950">
                    In this batch, consumption is calculated by weight and
                    formula based on batch run.
                  </p>
                </div>
              )}
              {report && (
                <>
                  <div className="border-t border-gray-700 pt-4">
                    <p className="text-sm font-medium text-gray-900 mb-3">
                      Chemical (Nutritional) - Batch #
                      {batchDetail.batch?.batch_no || selectedBatch.id}
                    </p>
                    {chemicalChartData.length > 0 ? (
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chemicalChartData} layout="vertical">
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="#374151"
                            />
                            <XAxis
                              type="number"
                              stroke="#9ca3af"
                              fontSize={10}
                              label={{
                                value: "Quantity (%)",
                                position: "insideBottom",
                                offset: 1,
                                style: { fontSize: 11, fill: "#475569" },
                              }}
                            />
                            <YAxis
                              type="category"
                              dataKey="name"
                              stroke="#556D7C"
                              fontSize={10}
                              width={70}
                              label={{
                                value: "Chemical Parameters",
                                angle: -90,
                                position: "insideLeft",
                                style: {
                                  textAnchor: "middle",
                                  fontSize: 11,
                                  fill: "#475569",
                                },
                              }}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#1a222d",
                                border: "1px solid #374151",
                              }}
                            />
                            <Bar
                              dataKey="value"
                              fill="#00c853"
                              name="Value (%)"
                              radius={[0, 4, 4, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-gray-900 text-sm">
                        No chemical data yet. Use &quot;Add / Edit Chemical &
                        Physical&quot;.
                      </p>
                    )}
                  </div>
                  <div className="border-t border-gray-700 pt-4">
                    <p className="text-sm font-medium text-gray-900 mb-3">
                      Physical parameters - Batch #
                      {batchDetail.batch?.batch_no || selectedBatch.id}
                    </p>
                    {physicalChartData.length > 0 ? (
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={physicalChartData} layout="vertical">
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="#374151"
                            />
                            <XAxis
                              type="number"
                              stroke="#9ca3af"
                              fontSize={10}
                              label={{
                                value: "Quantity (%)",
                                position: "insideBottom",
                                offset: 1,
                                style: { fontSize: 11, fill: "#475569" },
                              }}
                            />
                            <YAxis
                              type="category"
                              dataKey="name"
                              stroke="#556D7C"
                              fontSize={10}
                              width={85}
                              label={{
                                value: "Physical Parameters",
                                angle: -90,
                                position: "insideLeft",
                                style: {
                                  textAnchor: "middle",
                                  fontSize: 11,
                                  fill: "#475569",
                                },
                              }}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#1a222d",
                                border: "1px solid #374151",
                              }}
                            />
                            <Bar
                              dataKey="value"
                              fill="#ffab00"
                              name="Value"
                              radius={[0, 4, 4, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">
                        No physical data yet. Use &quot;Add / Edit Chemical &
                        Physical&quot;.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>{" "}
      <Modal
        open={showReport}
        onClose={() => {
          setShowReport(false);
          setReportError("");
          setReportMaterials([{ ...EMPTY_MATERIAL_ROW }]);
        }}
        title={
          reportModalMode === "edit"
            ? "Edit Batch Details"
            : "Production Report (Chemical & Physical)"
        }
      >
        <form onSubmit={handleReportSubmit} className="space-y-4">
          {reportError && (
            <div className="bg-red-100 text-red-800 px-4 py-3 rounded-lg text-sm border border-red-300">
              {reportError}
            </div>
          )}
          {reportModalBatch && reportModalMode !== "edit" && (
            <p className="text-xs text-gray-600">
              Entry Date: {formatDateTimeIST(reportModalEntryDate)} | Last
              Modified: {formatDateTimeIST(reportModalLastModified, "N/A")}
            </p>
          )}
          <p className="text-black text-sm">
            {reportModalMode === "edit"
              ? "Edit batch details only."
              : "Add chemical and physical report values for this batch."}
          </p>
          {reportModalMode === "edit" && (
            <div>
              {canMarkBatchComplete && (
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={handleMarkBatchComplete}
                    disabled={markCompleteDisabled}
                    className="px-3 py-2 rounded-lg bg-[#245658] text-white text-xs font-semibold disabled:opacity-60 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {markCompleteLoading
                      ? "Marking..."
                      : markCompleteEligibility.loading
                        ? "Checking RM..."
                        : "Mark As Complete"}
                  </button>
                  <p className="text-xs text-gray-600 mt-1">
                    Current utilized count (
                    {reportModalBatch?.completed_count ?? 0}) will be kept.
                  </p>
                  {!hasValidBagDetailsForCompletion && (
                    <p className="text-xs text-amber-700 mt-1">
                      Enter non-zero Number of Bags and Weight per Bag to enable Mark As Complete.
                    </p>
                  )}
                  {!markCompleteEligibility.allowed && (
                    <p className="text-xs text-amber-700 mt-1 whitespace-pre-line">
                      {markCompleteEligibility.detail ||
                        "Raw material stock is insufficient."}
                    </p>
                  )}
                </div>
              )}
              <div className="bg-gray-100 border border-gray-300 rounded-lg p-3 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-700">
                    Available Raw Materials
                  </p>
                  {rmStockLoading && (
                    <span className="text-xs text-gray-500">Loading...</span>
                  )}
                </div>
                {availableRawMaterials.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    No available raw material stock (greater than 0 kg).
                  </p>
                ) : (
                  <div className="max-h-[136px] overflow-y-auto overflow-x-auto rounded border border-gray-300">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-200 text-gray-700">
                          <th className="px-3 py-2 text-left border-b border-gray-300">
                            Raw Material
                          </th>
                          <th className="px-3 py-2 text-right border-b border-gray-300">
                            Weight Available (kg)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {availableRawMaterials.map((row) => (
                          <tr
                            key={`production-rm-stock-${row.rm_name}`}
                            className="bg-gray-50 text-gray-700 border-b border-gray-200 last:border-b-0"
                          >
                            <td className="px-3 py-2">{row.rm_name}</td>
                            <td className="px-3 py-2 text-right font-medium">
                              {row.closing_stock.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {reportModalBatch && (
                <p className="text-xs text-gray-600 mb-2">
                  Entry Date: {formatDateTimeIST(reportModalEntryDate)} | Last
                  Modified: {formatDateTimeIST(reportModalLastModified, "N/A")}
                </p>
              )}
              <p className="text-xs text-black mb-2">Batch Details</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="disabled pointer-events-none">
                  <label className="block text-xs text-black mb-0.5">
                    Date
                  </label>
                  <input
                    type="date"
                    value={reportForm.date || ""}
                    onChange={(e) =>
                      setReportForm((f) => ({ ...f, date: e.target.value }))
                    }
                    className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm disabled:bg-gray-100 pointer-events-none"
                    disabled  
                  />
                </div>
                <div>
                  <label className="block text-xs text-black mb-0.5">
                    Batch No
                  </label>
                  <input
                    type="text"
                    value={reportForm.batch_no || ""}
                    onChange={(e) =>
                      setReportForm((f) => ({ ...f, batch_no: e.target.value }))
                    }
                    className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm"
                    required
                  />
                </div>
             
                <div>
                  <label className="block text-xs text-black mb-0.5">
                    Batch Count
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={reportForm.batch_size || ""}
                    onChange={(e) =>
                      setReportForm((f) => ({
                        ...f,
                        batch_size: e.target.value,
                      }))
                    }
                    className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm"
                    required
                  />
                </div>
                   <div>
                  <label className="block text-xs text-black mb-0.5">
                    Recipe
                  </label>
                  <select
                    value={reportForm.recipe_id || ""}
                    onChange={(e) => handleReportRecipeChange(e.target.value)}
                    className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm"
                    required
                  >
                    <option value="">Select</option>
                    {recipes.map((item) => {
                      const shortText =
                        item.name.length > 20
                          ? `${item.name.substring(0, 20)}...`
                          : item.name;
                      return (
                        <option
                          key={`report-recipe-option-${item.id}`}
                          value={item.id}
                        >
                          {shortText}
                        </option>
                      );
                    })}
                  </select>
                </div>
           
                <div>
                  <label className="block text-xs text-black mb-0.5">MOP</label>
                  <input
                    type="number"
                    step="any"
                    value={reportForm.mop || ""}
                    onChange={(e) =>
                      setReportForm((f) => ({ ...f, mop: e.target.value }))
                    }
                    className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-black mb-0.5">
                    Water
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={reportForm.water || ""}  
                    onChange={(e) =>
                      setReportForm((f) => ({ ...f, water: e.target.value }))
                    }
                    className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm"
                  />
                </div>
                 </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-5">
                     <div>
                  <label className="block text-xs text-black mb-0.5">
                    Product Type
                  </label>
                  <select
                    value={
                      resolveMatchingProductTypeName(reportForm.product_name) ||
                      resolveMatchingProductTypeName(selectedRecipeForEdit?.name)
                    }
                    onChange={(e) => handleReportProductChange(e.target.value)}
                    className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm"
                    required
                  >
                    <option value="">Select</option>
                    {productTypes.map((type) => {
                      const shortText =
                        type.length > 20 ? `${type.substring(0, 20)}...` : type;
                      return (
                        <option key={`report-product-${type}`} value={type}>
                          {shortText}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-black mb-0.5">
                    No. of Bags
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={reportForm.num_bags || ""}
                    onChange={(e) =>
                      setReportForm((f) => ({ ...f, num_bags: e.target.value }))
                    }
                    className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm disabled:bg-gray-100"
                    disabled={!canEditBagOutput}
                  />
                </div>
                <div>
                  <label className="block text-xs text-black mb-0.5">
                    Weight/Bag (kg)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={reportForm.weight_per_bag || ""}
                    onChange={(e) =>
                      setReportForm((f) => ({
                        ...f,
                        weight_per_bag: e.target.value,
                      }))
                    }
                    className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm disabled:bg-gray-100"
                    disabled={!canEditBagOutput}
                  />
                </div>
                <div>
                  <label className="block text-xs text-black mb-0.5">
                    Total Output (kg)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={
                      Number.isFinite(Number(reportForm.num_bags)) &&
                      Number.isFinite(Number(reportForm.weight_per_bag))
                        ? (
                            Number(reportForm.num_bags) *
                            Number(reportForm.weight_per_bag)
                          ).toFixed(2)
                        : ""
                    }
                    className="w-full px-2 py-1.5 rounded bg-gray-100 border border-gray-400 text-black text-sm"
                    readOnly
                  />
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-black">Recipe Materials</p>
                  {/* <button
                  type="button"
                  onClick={addReportMaterialRow}
                  className="px-2 py-1 rounded border border-gray-600 text-xs text-black"
                >
                  + Add Material
                </button> */}
                </div>
                {reportForm.recipe_id ? (
                  <p className="text-xs text-gray-600">
                    Select recipe to auto-fill raw material split.
                  </p>
                ) : (
                  <p className="text-xs text-gray-600">
                    Select recipe to auto-fill raw material split.
                  </p>
                )}
                <div className="space-y-2">
                  {reportMaterials.map((material, index) => (
                    <div
                      key={`report-material-${index}`}
                      className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end"
                    >
                      <div className="md:col-span-7">
                        <label className="block text-xs text-black mb-1">
                          Raw Material
                        </label>
                        {/* <input
                        type="text"
                        value={material.rm_name}
                        onChange={(e) => updateReportMaterialRow(index, 'rm_name', e.target.value)}
                        className="w-full px-3 py-2 rounded border border-gray-300 text-sm"
                        placeholder="Enter raw material"
                      /> */}
                        <input
                          type="text"
                          value={material.rm_name}
                          disabled
                          className="w-full px-3 py-2 rounded bg-gray-100 border border-gray-300 cursor-not-allowed"
                        />
                      </div>
                      <div className="md:col-span-5">
                        <label className="block text-xs text-black mb-1">
                          Weight (kg)
                        </label>
                        {/* <input
                        type="number"
                        step="any"
                        min="0"
                        value={material.quantity}
                        onChange={(e) => updateReportMaterialRow(index, 'quantity', e.target.value)}
                        className="w-full px-3 py-2 rounded border border-gray-300 text-sm"
                        placeholder="0"
                      /> */}

                        <input
                          type="number"
                          value={material.quantity}
                          disabled
                          className="w-full px-3 py-2 rounded bg-gray-100 border border-gray-300 cursor-not-allowed"
                        />
                      </div>
                      {/* <div className="md:col-span-1">
                      <button
                        type="button"
                        onClick={() => removeReportMaterialRow(index)}
                        className="w-full px-2 py-2 rounded border border-gray-600 text-black text-sm"
                      >
                        X
                      </button>
                    </div> */}
                    </div>
                  ))}
                </div>
                {validReportMaterials.length > 0 && (
                  <p className="text-xs text-gray-600">
                    Total Recipe Weight:{" "}
                    {validReportMaterials
                      .reduce((sum, item) => sum + item.quantity, 0)
                      .toFixed(2)}{" "}
                    kg
                  </p>
                )}
              </div>
              {!canEditBagOutput && (
                <p className="text-xs text-amber-700 mt-2">
                  Mark this stopped/pending batch as complete, then enter bag
                  count and weight.
                </p>
              )}
            </div>
          )}
          {reportModalMode !== "edit" && (
            <>
              <div>
                <p className="text-xs text-black mb-2">Nutritional</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {NUTRITION_FIELDS.map((key) => (
                    <div key={key}>
                      <label className="block text-xs text-black capitalize mb-0.5">
                        {key.replace("_", " ")} %
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={reportForm[key] || ""}
                        onChange={(e) =>
                          setReportForm((f) => ({
                            ...f,
                            [key]: e.target.value,
                          }))
                        }
                        className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-black mb-2">
                  Physical (HM Retention, Mixer Moisture, Conditioner Moisture,
                  Moisture Addition, Final Feed Moisture, Water Activity,
                  Hardness, Pellet Diameter, Fines)
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {PHYSICAL_FIELDS.map((key) => (
                    <div key={key}>
                      <label className="block text-xs text-black mb-0.5">
                        {key.replace(/_/g, " ")} %
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={reportForm[key] || ""}
                        onChange={(e) =>
                          setReportForm((f) => ({
                            ...f,
                            [key]: e.target.value,
                          }))
                        }
                        className="w-full px-2 py-1.5 rounded bg-primary-light border border-gray-600 text-black text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-accent-green text-primary font-medium"
            >
              Submit
            </button>
            <button
              type="button"
              onClick={() => {
                setShowReport(false);
                setReportError("");
                setReportMaterials([{ ...EMPTY_MATERIAL_ROW }]);
              }}
              className="px-4 py-2 rounded-lg border border-gray-600 text-gray-900"
            >
              Cancel
            </button>
          </div>
          {reportModalBatch && (
            <div className="text-right text-xs text-gray-600">
              Created At: {formatDateTimeIST(reportModalCreatedAt, "N/A")}
            </div>
          )}
        </form>
      </Modal>
      {pinDialog}
    </div>
  );
}
