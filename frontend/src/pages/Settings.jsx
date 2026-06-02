import React from 'react'
import { useState, useEffect } from "react"
import { rawMaterial, configApi, auth } from "../api/client"
import Modal from "../components/Modal"
import PopupDialog from "../components/PopupDialog"
import usePinGate from "../hooks/usePinGate"
import { formatDateTimeIST } from "../utils/datetime"
import eyeoff from "../pages/assets/eye.png"
import eye from "../pages/assets/eye-off.png"
import { Clock, Trash2, IdCard, Database } from "lucide-react";
// Settings page for master data, recipes, and access PIN management.
const EMPTY_RECIPE_MATERIAL = { rm_name: "", quantity: "" }
const MAX_RECIPE_ID = 20

const initialRecipeForm = () => ({
  recipe_id: "",
  name: "",
  add_to_product_type: false,
  materials: [{ ...EMPTY_RECIPE_MATERIAL }],
})

const PIN_SCOPE_OPTIONS = [
  { value: "rm_entry_edit", label: "RM Entry Edit PIN" },
  { value: "rm_lab_edit", label: "RM Lab Edit PIN" },
  { value: "dispatch_edit", label: "Dispatch Edit PIN" },
  { value: "production_details_edit", label: "Production Details PIN" },
  { value: "production_report_access", label: "Production Report PIN" },
  { value: "recipe_access", label: "Recipe Access PIN" },
]

export default function Settings() {
  const { requestPin, pinDialog } = usePinGate()
  const [showPinModal, setShowPinModal] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [rmTypes, setRmTypes] = useState([])
  const [productTypes, setProductTypes] = useState([])
  const [recipes, setRecipes] = useState([])
  const [newRmType, setNewRmType] = useState("")
  const [showEditRmType, setShowEditRmType] = useState(false)
  const [rmTypeError, setRmTypeError] = useState('')
  const [editingRmType, setEditingRmType] = useState(null)
  const [rmTypeFormName, setRmTypeFormName] = useState("")
  const [showEditProductType, setShowEditProductType] = useState(false)
  const [showAddProductType, setShowAddProductType] = useState(false)
  const [productTypeError, setProductTypeError] = useState('')
  const [productTypeAddError, setProductTypeAddError] = useState('')
  const [editingProductType, setEditingProductType] = useState(null)
  const [productTypeFormName, setProductTypeFormName] = useState("")
  const [newProductType, setNewProductType] = useState("")
  const [showAddRecipe, setShowAddRecipe] = useState(false)
  const [recipeError, setRecipeError] = useState('')
  const [editingRecipeId, setEditingRecipeId] = useState(null)
  const [viewingRecipe, setViewingRecipe] = useState(null)
  const [recipeForm, setRecipeForm] = useState(initialRecipeForm)
  const [popupMessage, setPopupMessage] = useState('')
  const [rmTypeToDelete, setRmTypeToDelete] = useState(null)
  const [productTypeToDelete, setProductTypeToDelete] = useState(null)
  const [recipeToDelete, setRecipeToDelete] = useState(null)
  const [pinForm, setPinForm] = useState({
    pin_type: PIN_SCOPE_OPTIONS[0].value,
    current_pin: '',
    new_pin: '',
    confirm_pin: '',
  })
  const [pinError, setPinError] = useState('')
  const [pinSuccess, setPinSuccess] = useState('')
  const [pinSaving, setPinSaving] = useState(false)
const [showRmPopup, setShowRmPopup] = useState(false)
const [showError, setShowError] = useState(false)
  const load = () => {
    rawMaterial.listTypes().then(({ data }) => setRmTypes(Array.isArray(data) ? data : []))
    configApi.productTypesManage().then(({ data }) => setProductTypes(Array.isArray(data) ? data : []))
    configApi.recipes().then(({ data }) => setRecipes(Array.isArray(data) ? data : []))
  }

  const usedRecipeIds = new Set(
    recipes
      .map((recipe) => Number(recipe?.id))
      .filter((value) => Number.isInteger(value) && value > 0)
  )
  const recipeIdOptions = Array.from({ length: MAX_RECIPE_ID }, (_, index) => index + 1)
    .filter((id) => !usedRecipeIds.has(id) || id === Number(recipeForm.recipe_id))
  const availableRecipeIds = Array.from({ length: MAX_RECIPE_ID }, (_, index) => index + 1)
    .filter((id) => !usedRecipeIds.has(id))

  useEffect(() => { load() }, [])

  const addRmType = async () => {
    if (!newRmType.trim()) return
    await rawMaterial.addType(newRmType)
    setNewRmType("")
    load()
  }
const handleClosePopup = () => {
  setShowRmPopup(false)
  setNewRmType("")     
  setShowError(false) 
}
  const openEditRmTypeModal = (type) => {
    setEditingRmType(type)
    setRmTypeFormName(type?.name || "")
    setShowEditRmType(true)
  }

  const closeEditRmTypeModal = () => {
    setShowEditRmType(false)
    setEditingRmType(null)
    setRmTypeFormName("")
    setRmTypeError('')
  }

  const saveRmTypeEdit = async (e) => {
    e.preventDefault()
    setRmTypeError('')
    if (!editingRmType) return
    const value = rmTypeFormName.trim()
    if (!value || value === editingRmType.name) {
      closeEditRmTypeModal()
      return
    }
    try {
      await rawMaterial.updateType(editingRmType.id, value)
      closeEditRmTypeModal()
      load()
    } catch (err) {
      const detail = err?.response?.data?.detail || "Unable to update raw material type."
      setRmTypeError(detail)
    }
  }

  const deleteRmType = async (type) => {
    setRmTypeToDelete(type)
  }

  const confirmDeleteRmType = async () => {
    if (!rmTypeToDelete) return
    try {
      await rawMaterial.deleteType(rmTypeToDelete.id)
      setRmTypeToDelete(null)
      load()
    } catch (err) {
      const detail = err?.response?.data?.detail || "Unable to delete raw material type."
      setRmTypeToDelete(null)
      setPopupMessage(detail)
    }
  }

  const openEditProductTypeModal = (type) => {
    setEditingProductType(type)
    setProductTypeFormName(type?.name || "")
    setProductTypeError('')
    setShowEditProductType(true)
  }

  const closeEditProductTypeModal = () => {
    setShowEditProductType(false)
    setEditingProductType(null)
    setProductTypeFormName("")
    setProductTypeError('')
  }

  const openAddProductTypeModal = () => {
    setNewProductType("")
    setProductTypeAddError("")
    setShowAddProductType(true)
  }

  const closeAddProductTypeModal = () => {
    setShowAddProductType(false)
    setNewProductType("")
    setProductTypeAddError("")
  }

  const saveProductTypeAdd = async (e) => {
    e.preventDefault()
    setProductTypeAddError('')
    const value = newProductType.trim()
    if (!value) {
      setProductTypeAddError("Product type name is required.")
      return
    }
    try {
      await configApi.addProductType(value)
      closeAddProductTypeModal()
      load()
    } catch (err) {
      const detail = err?.response?.data?.detail || "Unable to add product type."
      setProductTypeAddError(detail)
    }
  }

  const saveProductTypeEdit = async (e) => {
    e.preventDefault()
    setProductTypeError('')
    if (!editingProductType) return
    const value = productTypeFormName.trim()
    if (!value || value === editingProductType.name) {
      closeEditProductTypeModal()
      return
    }
    try {
      await configApi.updateProductType(editingProductType.id, value)
      closeEditProductTypeModal()
      load()
    } catch (err) {
      const detail = err?.response?.data?.detail || "Unable to update product type."
      setProductTypeError(detail)
    }
  }

  const deleteProductType = async (type) => {
    setProductTypeToDelete(type)
  }

  const confirmDeleteProductType = async () => {
    if (!productTypeToDelete) return
    try {
      await configApi.deleteProductType(productTypeToDelete.id)
      setProductTypeToDelete(null)
      load()
    } catch (err) {
      const detail = err?.response?.data?.detail || "Unable to delete product type."
      setProductTypeToDelete(null)
      setPopupMessage(detail)
    }
  }

  const addRecipeRow = () => {
    setRecipeForm((prev) => ({
      ...prev,
      materials: [...prev.materials, { ...EMPTY_RECIPE_MATERIAL }],
    }))
  }

  const removeRecipeRow = (index) => {
    setRecipeForm((prev) => ({
      ...prev,
      materials: prev.materials.length === 1
        ? [{ ...EMPTY_RECIPE_MATERIAL }]
        : prev.materials.filter((_, i) => i !== index),
    }))
  }

  const updateRecipeRow = (index, field, value) => {
    setRecipeForm((prev) => ({
      ...prev,
      materials: prev.materials.map((row, i) => (
        i === index ? { ...row, [field]: value } : row
      )),
    }))
  }

  const closeRecipeModal = () => {
    setShowAddRecipe(false)
    setEditingRecipeId(null)
    setRecipeForm(initialRecipeForm())
    setRecipeError('')
  }

  const openAddRecipeModal = () => {
    setEditingRecipeId(null)
    setRecipeForm({
      ...initialRecipeForm(),
      recipe_id: availableRecipeIds[0] ? String(availableRecipeIds[0]) : "",
    })
    setRecipeError('')
    setShowAddRecipe(true)
  }

  const openEditRecipeModal = (recipe) => {
    const materials = Array.isArray(recipe?.materials) && recipe.materials.length > 0
      ? recipe.materials.map((item) => ({
          rm_name: item.rm_name || "",
          quantity: String(item.quantity ?? ""),
        }))
      : [{ ...EMPTY_RECIPE_MATERIAL }]

    setEditingRecipeId(recipe?.id ?? null)
    setRecipeForm({
      recipe_id: recipe?.id ? String(recipe.id) : "",
      name: recipe?.name || "",
      add_to_product_type: productTypes.some((item) => item.name === recipe?.name),
      materials,
      created_at: recipe?.created_at || null,
    })
    setRecipeError('')
    setShowAddRecipe(true)
  }

  const handleSaveRecipe = async (e) => {
    e.preventDefault()
    setRecipeError('')

    const materials = recipeForm.materials
      .map((item) => ({
        rm_name: (item.rm_name || "").trim(),
        quantity: item.quantity === "" ? NaN : parseFloat(item.quantity),
      }))
      .filter((item) => item.rm_name !== "" || !Number.isNaN(item.quantity))

    if (!recipeForm.name.trim()) {
      setRecipeError("Recipe name is required.")
      return
    }
    if (materials.length === 0) {
      setRecipeError("Add at least one raw material.")
      return
    }
    if (materials.some((item) => !item.rm_name || Number.isNaN(item.quantity) || item.quantity <= 0)) {
      setRecipeError("Each row must include raw material and weight greater than 0.")
      return
    }
    const recipeId = Number(recipeForm.recipe_id)
    if (!Number.isInteger(recipeId) || recipeId < 1 || recipeId > MAX_RECIPE_ID) {
      setRecipeError(`Recipe ID must be between 1 and ${MAX_RECIPE_ID}.`)
      return
    }
    if (editingRecipeId) {
      if (recipeId !== editingRecipeId && usedRecipeIds.has(recipeId)) {
        setRecipeError(`Recipe ID ${recipeId} is already in use.`)
        return
      }
    } else if (usedRecipeIds.has(recipeId)) {
      setRecipeError(`Recipe ID ${recipeId} is already in use.`)
      return
    }

    try {
      if (editingRecipeId) {
        await configApi.updateRecipe(editingRecipeId, {
          recipe_id: recipeId,
          name: recipeForm.name.trim(),
          add_to_product_type: Boolean(recipeForm.add_to_product_type),
          materials,
        })
      } else {
        await configApi.addRecipe({
          recipe_id: Number(recipeForm.recipe_id),
          name: recipeForm.name.trim(),
          add_to_product_type: Boolean(recipeForm.add_to_product_type),
          materials,
        })
      }
      closeRecipeModal()
      load()
    } catch (err) {
      const detail = err?.response?.data?.detail || `Unable to ${editingRecipeId ? "update" : "add"} recipe.`
      setRecipeError(detail)
    }
  }

  const deleteRecipe = async (recipe) => {
    setRecipeToDelete(recipe)
  }

  const openViewRecipeModal = (recipe) => {
    setViewingRecipe(recipe || null)
  }

  const closeViewRecipeModal = () => {
    setViewingRecipe(null)
  }

  const confirmDeleteRecipe = async () => {
    if (!recipeToDelete) return
    try {
      await configApi.deleteRecipe(recipeToDelete.id)
      setRecipeToDelete(null)
        closeRecipeModal()   
      load()
    } catch (err) {
      const detail = err?.response?.data?.detail || "Unable to delete recipe."
      setRecipeToDelete(null)
      setPopupMessage(detail)
    }
  }
const handleClosePinModal = () => {
  setShowPinModal(false);

  // Reset form fields
  setPinForm({
    pin_type: PIN_SCOPE_OPTIONS[0].value,
    current_pin: "",
    new_pin: "",
    confirm_pin: "",
  });

  // Clear messages
  setPinError("");
  setPinSuccess("");

  // Reset eye toggle (optional but clean)
  setShowNewPin(false);
  setShowConfirmPin(false);
};

  const changePin = async (e) => {
    e.preventDefault()
    setPinError('')
    setPinSuccess('')

    if (!/^\d{4}$/.test(pinForm.current_pin) || !/^\d{4}$/.test(pinForm.new_pin)) {
      setPinError('PIN must be exactly 4 digits.')
      return
    }
    if (pinForm.new_pin !== pinForm.confirm_pin) {
      setPinError('New PIN and confirm PIN do not match.')
      return
    }
    if (pinForm.current_pin === pinForm.new_pin) {
      setPinError('New PIN must be different from current PIN.')
      return
    }

    try {
      setPinSaving(true)
      await auth.changePin(pinForm.current_pin, pinForm.new_pin, pinForm.pin_type)
      const selectedScope = PIN_SCOPE_OPTIONS.find((item) => item.value === pinForm.pin_type)
      setPinSuccess(`${selectedScope?.label || 'Selected'} updated successfully.`)
      setPinForm({
  pin_type: pinForm.pin_type,
  current_pin: "",
  new_pin: "",
  confirm_pin: "",
});
     
    } catch (err) {
      setPinError(err?.response?.data?.detail || 'Unable to update PIN.')
    } finally {
      setPinSaving(false)
    }
  }

  return (
    <div className="pb-2 md:pb-28 lg:pb-0">
      <div className='flex items-center justify-between '>
      <h1 className="text-xl font-semibold mb-8">Settings</h1>
       <div>
  <button
    onClick={() => setShowPinModal(true)}
    className="bg-[#245658] hover:bg-[#1d4446] text-white px-3 md:px-6 py-2 rounded-lg shadow-md transition mb-5 text-wrap"
  >
    Change Access Pin
  </button>
</div>

{/* Modal */}
{showPinModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
    
    {/* Modal Box */}
    <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl p-3 lg:p-6 relative animate-fadeIn m-4">
      
      {/* Close Button */}
      <button
       onClick={handleClosePinModal}
        className="absolute top-3 right-3 text-gray-500 hover:text-black text-lg font-bold"
      >
        ✕
      </button>

      <h2 className="text-lg font-semibold mb-5 text-gray-800">
        Update Access PIN
      </h2>

      <form onSubmit={changePin} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">
            PIN Type
          </label>
          <select
            value={pinForm.pin_type}
            onChange={(e) =>
              setPinForm((f) => ({
                ...f,
                pin_type: e.target.value,
              }))
            }
            className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:ring-2 focus:ring-[#245658] focus:outline-none"
          >
            {PIN_SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Current PIN */}
        <div>
          <label className="block text-sm text-gray-600 mb-1">
            Current PIN
          </label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pinForm.current_pin}
            onChange={(e) =>
              setPinForm((f) => ({
                ...f,
                current_pin: e.target.value.replace(/\D/g, "").slice(0, 4),
              }))
            }
            className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:ring-2 focus:ring-[#245658] focus:outline-none"
            placeholder="1234"
            required
          />
        </div>

        {/* New PIN */}
        <div className="relative">
          <label className="block text-sm text-gray-600 mb-1">
            New PIN
          </label>
          <input
            type={showNewPin ? "text" : "password"}
            inputMode="numeric"
            maxLength={4}
            value={pinForm.new_pin}
            onChange={(e) =>
              setPinForm((f) => ({
                ...f,
                new_pin: e.target.value.replace(/\D/g, "").slice(0, 4),
              }))
            }
            className="w-full border border-gray-300 px-3 py-2 pr-10 rounded-lg focus:ring-2 focus:ring-[#245658] focus:outline-none"
            placeholder="New 4-digit PIN"
            required
          />

          {/* Eye Icon */}
          <img
            src={showNewPin ? eyeoff : eye}
            alt="toggle"
            onClick={() => setShowNewPin(!showNewPin)}
            className="absolute right-3 top-9 w-5 h-5 cursor-pointer"
          />
        </div>

        {/* Confirm PIN */}
        <div className="relative">
          <label className="block text-sm text-gray-600 mb-1">
            Confirm PIN
          </label>
          <input
            type={showConfirmPin ? "text" : "password"}
            inputMode="numeric"
            maxLength={4}
            value={pinForm.confirm_pin}
            onChange={(e) =>
              setPinForm((f) => ({
                ...f,
                confirm_pin: e.target.value.replace(/\D/g, "").slice(0, 4),
              }))
            }
            className="w-full border border-gray-300 px-3 py-2 pr-10 rounded-lg focus:ring-2 focus:ring-[#245658] focus:outline-none"
            placeholder="Re-enter new PIN"
            required
          />

          {/* Eye Icon */}
          <img
            src={showConfirmPin ? eyeoff : eye}
            alt="toggle"
            onClick={() => setShowConfirmPin(!showConfirmPin)}
            className="absolute right-3 top-9 w-5 h-5 cursor-pointer"
          />
        </div>

        <button
          type="submit"
          disabled={pinSaving}
          className="w-full bg-[#245658] hover:bg-[#1d4446] text-white py-2 rounded-lg transition disabled:opacity-60"
        >
          {pinSaving ? "Updating..." : "Update PIN"}
        </button>

        {pinError && (
          <div className="bg-red-100 text-red-800 px-3 py-2 rounded text-sm border border-red-300">
            {pinError}
          </div>
        )}

        {pinSuccess && (
          <div className="bg-green-100 text-green-800 px-3 py-2 rounded text-sm border border-green-300">
            {pinSuccess}
          </div>
        )}
      </form>
    </div>
  </div>
)}
</div>
      <div className="grid grid-cols-1 xl:grid-cols-10 gap-8">
        {/* RM TYPES - LEFT COLUMN */}
        <div className="border border-gray-400 rounded-lg p-4 col-span-4 xl:col-span-3 ">
          <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium mb-3">Raw Material Types</h2>
          <button
  onClick={() => setShowRmPopup(true)}
  className="px-2 py-2 bg-[#245658] text-white rounded"
>
 + Add RM Type
</button>
          </div>
          {showRmPopup && (
  <div
    className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 "
    onClick={handleClosePopup} 
  >

    <div
      className="bg-white w-[400px] rounded-xl shadow-lg sm:m-1 m-4"
      onClick={(e) => e.stopPropagation()}
    >

      {/* HEADER */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="text-lg font-semibold">Add Raw Material Type</h2>

        <button
          onClick={handleClosePopup}
          className="text-gray-700 hover:text-black text-lg"
        >
          ✕
        </button>
      </div>

      {/* BODY */}
      <div className="p-4 space-y-2">
     <label className="block text-sm text-black mb-1">Enter Raw Material Type</label>
        <input
          value={newRmType}
          onChange={(e) => {
            setNewRmType(e.target.value)
            if (e.target.value.trim()) setShowError(false) // ✅ remove error while typing
          }}
          placeholder="Enter RM Type"
          className={`w-full border border-gray-600 px-3 py-2 rounded ${
            showError ? "border-red-400" : "border-gray-300"
          }`}
        />

        {/* ERROR ONLY AFTER CLICK */}
        {showError && (
          <p className="text-xs text-red-500">
            Raw Material is required
          </p>
        )}

      </div>

      {/* FOOTER */}
      <div className="flex justify-end gap-2 px-4 py-3 border-t">

        <button
          onClick={handleClosePopup}
          className="px-4 py-2 border border-gray-600 rounded"
        >
          Cancel
        </button>

        <button
          onClick={() => {
            if (!newRmType.trim()) {
              setShowError(true)
              return
            }

            addRmType()
            handleClosePopup() 
          }}
          className="px-4 py-2 bg-[#245658] text-white rounded"
        >
          Add RM Type
        </button>

      </div>

    </div>
  </div>
)}
      {/* <div className="flex gap-2 mb-3">
            <input
              value={newRmType}
              onChange={(e)=>setNewRmType(e.target.value)}
              placeholder="Enter RM Type"
              className="border px-3 py-2 rounded flex-1"
            />
            <button
              onClick={addRmType}
              className="bg-[#245658] text-white px-4 py-2 rounded"
            >
              Add
            </button>
          </div> */}

         <div className="mt-4 rounded-md p-3 bg-slate-50 ">
            <p className="text-sm font-medium text-slate-700 mb-2">
              Available Raw Material Types ({rmTypes.length})
            </p>
            <div className='max-h-[1000px] overflow-y-auto'>
            {rmTypes.length === 0 ? (
              <p className="text-sm text-slate-500">No raw material types found.</p>
            ) : (
              <ul className="space-y-2 text-slate-700">
                {rmTypes.map((t) => (
                  <li key={t.id} className="flex flex-col  justify-between gap-2 border border-slate-200 rounded-md bg-white px-3 py-2  shadow-md">
                                        <div className="flex justify-between items-start gap-2 p-2">

                                  <div className="flex-1 min-w-0">
                                                  <span className="font-medium break-all line-clamp-3">{t.name}</span>
                    </div>
                    {/* <div className="flex flex-col items-end gap-2"> */}
                     
                      <div className="flex gap-2 sm:flex-row flex-col">
                        <button
                          type="button"
                          onClick={() => requestPin(
                            () => openEditRmTypeModal(t),
                            { title: 'PIN Required', message: 'Enter PIN to edit (1234) raw material type.' }
                          )}
                          className="px-3 py-1 rounded border border-gray-400 text-xs text-gray-800 hover:bg-gray-100"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => requestPin(
                            () => deleteRmType(t),
                            { title: 'PIN Required', message: 'Enter PIN to delete raw material type.' }
                          )}
                          className="px-3 py-1 rounded border border-red-300 text-xs text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>

    </div>

                      <div className="border-t border-dashed border-gray-300"></div>

                         <div className='flex my-1 justify-start items-center gap-1'>

                                            <Clock size={15} className="text-gray-500" />

                       <p className="text-xs text-slate-500">
                        Last Modified: {t.last_modified_at 
                          ? formatDateTimeIST(t.last_modified_at) 
                          : "N/A"} </p>
                          </div>
                  
                  </li>
                ))}
              </ul>
            )}
            </div>
          </div>
        </div>

        {/* RECIPES - RIGHT COLUMN */}
      
        <div className="col-span-4 border  border-gray-400 rounded-lg p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">Recipes</h2>
            <button
              type="button"
              onClick={openAddRecipeModal}
              className="bg-[#245658] text-white px-4 py-2 rounded"
            >
              + Add Recipe
            </button>
          </div>

<div className="mt-4 rounded-md p-3 bg-slate-50 ">        
      <p className="text-sm font-medium text-slate-700 mb-2">
              Available Recipes ({recipes.length})
            </p>
            <div className='max-h-[1000px] overflow-y-auto'>
            {recipes.length === 0 ? (
              <p className="text-sm text-slate-500">No recipes found.</p>
            ) : (
              <div className="space-y-4">
                {recipes.map((recipe) => (
                  
                  <div key={recipe.id}      className="bg-[#ffff] border border-gray-200 rounded-2xl p-5 shadow-md transition-all">
                <div className="flex justify-between items-start gap-3 ">
                       <div>
                    <h3 className="text-lg text-wrap break-all font-semibold text-[#1f3d3d]  max-w-[250px]  lg:max-w-[410px] "> {recipe.name} </h3>                          
                       <div className="mt-3 inline-flex items-center gap-3 bg-gray-200 px-3 py-1 rounded-lg text-[0.7rem] text-gray-600  sm:flex-row flex-col">
                            <div className='flex items-center gap-1 '> 
                              <IdCard size={14} className="text-gray-600" />
                                <p className="text-[0.7rem] text-slate-500 ">
                              Recipe ID: {recipe.id ?? "—"}
                            </p>
                          </div>
                                  
                            <div className='flex items-center gap-1'> 
                                    <Database size={12} className="text-gray-600" /> Materials : {""}
                                      {Array.isArray(recipe.materials) ? recipe.materials.length : 0} 
                                    </div>
                                    </div>
                           </div>
 </div>

                            <div className="my-4   border-t border-dashed border-gray-300"></div>
                           <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <p className="text-[0.7rem] text-gray-500 flex items-center gap-1">
                                    <Clock size={15} className="text-gray-500" />
                              Last Modified: {
  recipe?.last_modified_at
    ? formatDateTimeIST(recipe.last_modified_at)
    : "N/A"
}
                                </p>
                                        <div className="flex gap-2 ">
                                          <button
                                            type="button"
                                            onClick={() => openViewRecipeModal(recipe)}
                            className="px-3 py-1  rounded-md border border-blue-700 text-blue-700 hover:bg-gray-100 text-xs"
                                          >
                                            View
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => requestPin(
                                              () => openEditRecipeModal(recipe),
                                              { title: 'PIN Required', message: 'Enter PIN to edit (1234) recipe.', pinType: 'recipe_access' }
                                            )}
                            className="px-4 py-1 rounded-md bg-[#245658] text-white hover:bg-[#1d4446] text-xs flex items-center gap-1"
                                          >
                                            Edit
                                          </button>
                                    
                                        </div>
                         </div>
                    </div>

                ))}
             
              </div>
            )}   
             </div>
          </div>
        </div>

              <div className=" col-span-4 xl:col-span-3 border border-gray-400 rounded-lg p-4 ">
        <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium mb-3">Product Types</h2>
          <button
            type="button"
            onClick={openAddProductTypeModal}
            className="px-2 py-2 bg-[#245658] text-white rounded"
          >
            + Add Product Type
          </button>
        </div>

<div className="mt-4 rounded-md p-3 bg-slate-50 ">
            <p className="text-sm font-medium text-slate-700 mb-2">
            Available Product Types ({productTypes.length})
          </p>
          <div className='max-h-[1000px] overflow-y-auto'>
          {productTypes.length === 0 ? (
            <p className="text-sm text-slate-500">No product types found.</p>
          ) : (
            <ul className="space-y-2 text-slate-700">
              {productTypes.map((t) => (
                <li key={t.id} className="flex flex-col  justify-between gap-2 border border-slate-200 rounded-md bg-white px-3 py-2 shadow-md">
                                    <div className="flex items-start  justify-between gap-2 p-2">

                    <div className="flex-1 min-w-0">
                     <span className="font-medium break-all line-clamp-3">

                      {t.name}</span>
                  </div>

                    <div className="flex gap-2 sm:flex-row flex-col">
                      <button
                        type="button"
                        onClick={() => requestPin(
                          () => openEditProductTypeModal(t),
                          { title: 'PIN Required', message: 'Enter PIN to edit (1234) product type.', pinType: 'recipe_access' }
                        )}
                        className="px-3 py-1 rounded border border-gray-400 text-xs text-gray-800 hover:bg-gray-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => requestPin(
                          () => deleteProductType(t),
                          { title: 'PIN Required', message: 'Enter PIN to delete product type.', pinType: 'recipe_access' }
                        )}
                        className="px-3 py-1 rounded border border-red-300 text-xs text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                
   </div>
      </div>
{/* copied */}
<div>
 <div className="border-t border-dashed border-gray-300"></div>
                    <div className='flex my-1 justify-start items-center gap-1'>
                      <Clock size={15} className="text-gray-500" />
                       <p className="text-xs text-slate-500 break-words">
                           
                      Last Modified: {t.last_modified_at ? formatDateTimeIST(t.last_modified_at) : "N/A"}
                    </p>
                    </div>

                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        </div>  
      </div>
    



      <Modal open={showAddRecipe} onClose={closeRecipeModal} title={editingRecipeId ? "Edit Recipe" : "Add Recipe"}>
        <form onSubmit={handleSaveRecipe} className="space-y-3 relative pt-2 pb-16 md:pb-0">
             {editingRecipeId && (
  <button
    type="button"
    onClick={() =>
      requestPin(
        () => setRecipeToDelete({ id: editingRecipeId, name: recipeForm.name }),
        { title: 'PIN Required', message: 'Enter PIN to delete recipe.', pinType: 'recipe_access' }
      )
    }
    className="absolute top-0 right-1 px-2 py-1 rounded-md hover:text-red-800 bg-red-600 "
  >
    <div className='flex items-center gap-2  text-white'>  
    <Trash2 size={18} className='w-5 h-5' /> 
    <h5 className='hidden md:block'>Delete Recipe</h5>
    </div>
  
  </button>
)}
     
          {recipeError && (
            <div className="bg-red-100 text-red-800 px-4 py-3 rounded-lg text-sm border border-red-300">
              {recipeError}
            </div>
          )}
          <div>
            <div className="mb-3">
              <label className="block text-sm text-black mb-1">Recipe ID</label>
              <select
                value={recipeForm.recipe_id}
                onChange={(e) => setRecipeForm((prev) => ({ ...prev, recipe_id: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-gray-300"
                required
              >
                <option value="">Select Recipe ID</option>
                {recipeIdOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              {!editingRecipeId && availableRecipeIds.length === 0 && (
                <p className="mt-1 text-xs text-red-600">All recipe IDs from 1 to 20 are already used.</p>
              )}
            </div>
            <label className="block text-sm text-black mb-1">Recipe Name</label>
            <input
              type="text"
              value={recipeForm.name}
              onChange={(e) => setRecipeForm((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 rounded border border-gray-300"
              placeholder="Enter recipe name"
              required
            />
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(recipeForm.add_to_product_type)}
              onChange={(e) =>
                setRecipeForm((prev) => ({
                  ...prev,
                  add_to_product_type: e.target.checked,
                }))
              }
              className="h-4 w-4 rounded border-gray-300 text-[#245658] focus:ring-[#245658]"
            />
            Add this recipe name to Product Types
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm text-black">Raw Materials</label>
              <button
                type="button"
                onClick={addRecipeRow}
                className="px-2 py-1 rounded border border-gray-600 text-sm text-black"
              >
                + Add Material
              </button>
            </div>

            {recipeForm.materials.map((material, index) => (
              <div key={`recipe-material-${index}`} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                <div className="md:col-span-7">
                  <label className="block text-xs text-black mb-1">Raw Material</label>
                  <select
                    value={material.rm_name}
                    onChange={(e) => updateRecipeRow(index, "rm_name", e.target.value)}
                    className="w-full px-3 py-2 rounded border border-gray-300"
                    required
                  >
                    <option value="">Select</option>
                    {rmTypes.map((rm) => {
                        const shortText = rm.name.length > 25 ? rm.name.slice(0, 25) + "..." : rm.name;
                   return (
                      <option key={`recipe-rm-${rm.id || rm.name}`} value={rm.name}>
                        {shortText}
                      </option>
                    )})}
                  </select>
                </div>
                <div className="md:col-span-5">
                  <label className="block text-xs text-black mb-1">Weight (kg)</label>
                   <div className='flex items-center justify-center gap-2'>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={material.quantity}
                    onChange={(e) => updateRecipeRow(index, "quantity", e.target.value)}
                    className="w-full px-3 py-2 rounded border border-gray-300"
                    required
                  />
                    <button
                    type="button"
                    onClick={() => removeRecipeRow(index)}
                    className="w-1/4 px-3 py-2 rounded border border-gray-600 text-black text-sm "
                  >
                    X
                  </button>
                </div>
                 </div>
              </div>
            ))}
          </div>

          {editingRecipeId && recipeForm.created_at && (
            <div className="absolute bottom-4 right-4 text-xs text-slate-500 max-w-[120px] sm:max-w-[200px] break-words">          
              Created: {formatDateTimeIST(recipeForm.created_at)}
            </div>
          )}

          <div className="flex gap-2 mt-8">
            <button type="submit" className="px-4 py-2 rounded bg-[#245658] text-white">
              {editingRecipeId ? "Update Recipe" : "Save Recipe"}
            </button>
            <button type="button" onClick={closeRecipeModal} className="px-4 py-2 rounded border border-gray-400">
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(viewingRecipe)} onClose={closeViewRecipeModal} title="Recipe Details">
        {viewingRecipe && (
          <div className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
              <p className="text-sm font-semibold text-slate-800  break-words line-clamp-3">{viewingRecipe.name}</p>
              <p className="text-xs text-slate-500 mt-1">
                Recipe ID: {viewingRecipe.id ?? "—"}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Last Modified: {viewingRecipe.last_modified_at ? formatDateTimeIST(viewingRecipe.last_modified_at) : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">
                Materials ({Array.isArray(viewingRecipe.materials) ? viewingRecipe.materials.length : 0})
              </p>
              {Array.isArray(viewingRecipe.materials) && viewingRecipe.materials.length > 0 ? (
                <div className="max-h-[260px] overflow-y-auto overflow-x-auto rounded border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-3 py-2 text-left border-b border-slate-200">Raw Material</th>
                        <th className="px-3 py-2 text-right border-b border-slate-200">Weight (kg)</th>
                        <th className="px-3 py-2 text-left border-b border-slate-200">Last Modified</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewingRecipe.materials.map((item, idx) => (
                        <tr key={`view-recipe-${viewingRecipe.id || viewingRecipe.name}-${idx}`} className="border-b border-slate-100 last:border-b-0">
                          <td className="px-3 py-2 text-slate-700">{item.rm_name}</td>
                          <td className="px-3 py-2 text-right text-slate-700">{item.quantity}</td>
                          <td className="px-3 py-2 text-slate-600">
                            {item.last_modified_at ? formatDateTimeIST(item.last_modified_at) : "N/A"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No materials added.</p>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={closeViewRecipeModal}
                className="px-4 py-2 rounded border border-gray-400 text-sm text-gray-800 hover:bg-gray-100"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={showEditRmType} onClose={closeEditRmTypeModal} title="Edit Raw Material Type">
        <form onSubmit={saveRmTypeEdit}  className="space-y-4 relative pb-16 sm:pb-0">
          {rmTypeError && (
            <div className="bg-red-100 text-red-800 px-4 py-3 rounded-lg text-sm border border-red-300">
              {rmTypeError}
            </div>
          )}
          <div>
            <label className="block text-sm text-black mb-1">Raw Material Type Name</label>
            <input
              type="text"
              value={rmTypeFormName}
              onChange={(e) => setRmTypeFormName(e.target.value)}
              className="w-full px-3 py-2 rounded border border-gray-300"
              placeholder="Enter RM type name"
              required
            />
          </div>
          {editingRmType && (
            <div className="absolute bottom-4 right-4 text-xs text-slate-500 max-w-[120px] sm:max-w-[200px] break-words">
              Created : {formatDateTimeIST(editingRmType.created_at)}
            </div>
          )}
          <div className="flex gap-2 mt-8">
            <button type="submit" className="px-4 py-2 rounded bg-[#245658] text-white">
              Update
            </button>
            <button type="button" onClick={closeEditRmTypeModal} className="px-4 py-2 rounded border border-gray-400">
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={showAddProductType} onClose={closeAddProductTypeModal} title="Add Product Type">
        <form onSubmit={saveProductTypeAdd} className="space-y-4">
          {productTypeAddError && (
            <div className="bg-red-100 text-red-800 px-4 py-3 rounded-lg text-sm border border-red-300">
              {productTypeAddError}
            </div>
          )}
          <div>
            <label className="block text-sm text-black mb-1">Product Type Name</label>
            <input
              type="text"
              value={newProductType}
              onChange={(e) => setNewProductType(e.target.value)}
              className="w-full px-3 py-2 rounded border border-gray-300"
              placeholder="Enter product type name"
              required
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 rounded bg-[#245658] text-white">
              Add Product Type
            </button>
            <button type="button" onClick={closeAddProductTypeModal} className="px-4 py-2 rounded border border-gray-400">
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={showEditProductType} onClose={closeEditProductTypeModal} title="Edit Product Type">
        <form onSubmit={saveProductTypeEdit} className="space-y-4 relative pb-16 md:pb-0">
          {productTypeError && (
            <div className="bg-red-100 text-red-800 px-4 py-3 rounded-lg text-sm border border-red-300">
              {productTypeError}
            </div>
          )}
          <div>
            <label className="block text-sm text-black mb-1">Product Type Name</label>
            <input
              type="text"
              value={productTypeFormName}
              onChange={(e) => setProductTypeFormName(e.target.value)}
              className="w-full px-3 py-2 rounded border border-gray-300"
              placeholder="Enter product type name"
              required
            />
          </div>
          {editingProductType && (
            <div className="absolute bottom-4 right-4 text-xs text-slate-500">
              Created : {editingProductType.created_at ? formatDateTimeIST(editingProductType.created_at) : "N/A"}
            </div>
          )}
          <div className="flex gap-2 mt-8">
            <button type="submit" className="px-4 py-2 rounded bg-[#245658] text-white">
              Update
            </button>
            <button type="button" onClick={closeEditProductTypeModal} className="px-4 py-2 rounded border border-gray-400">
              Cancel
            </button>
          </div>
        </form>
      </Modal>
{/* password */}

{/* Change PIN Button */}

      <PopupDialog
        open={Boolean(rmTypeToDelete)}
        title="Delete Raw Material Type"
        message={rmTypeToDelete ? `Delete raw material type "${rmTypeToDelete.name}"?` : ""}
        onClose={() => setRmTypeToDelete(null)}
        onConfirm={confirmDeleteRmType}
        confirmText="Delete"
        danger
      />

      <PopupDialog
        open={Boolean(productTypeToDelete)}
        title="Delete Product Type"
        message={productTypeToDelete ? `Delete product type "${productTypeToDelete.name}"?` : ""}
        onClose={() => setProductTypeToDelete(null)}
        onConfirm={confirmDeleteProductType}
        confirmText="Delete"
        danger
      />

      <PopupDialog
        open={Boolean(recipeToDelete)}
        title="Delete Recipe"
        message={recipeToDelete ? `Delete recipe "${recipeToDelete.name}"?` : ""}
        onClose={() => setRecipeToDelete(null)}
        onConfirm={confirmDeleteRecipe}
        confirmText="Delete"
        danger
      />

      <PopupDialog
        open={Boolean(popupMessage)}
        title="Error"
        message={popupMessage}
        onClose={() => setPopupMessage('')}
      />
      {pinDialog}
    </div>
     </div>
  )
}
