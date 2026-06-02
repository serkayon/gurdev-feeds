import React from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  ClipboardList,
  Truck,
  Factory,
  Boxes,
  Settings,
  Menu,
  X,
  BellRing,
  AlertTriangle,
  LogOut,
} from "lucide-react";
import { auth, getAuthToken, getAuthUser, productionApi, setAuthSession } from "../api/client";

// Primary application shell with navigation and batch notifications.
const nav = [
  { to: "/layout", label: "Dashboard", icon: LayoutDashboard },
  { to: "production", label: "Production ", icon: Factory },
  { to: "raw-material", label: "Raw Material", icon: ClipboardList },
  { to: "dispatch", label: "Dispatch ", icon: Truck },
  { to: "stock", label: "Stock Reports", icon: Boxes },
  { to: "settings", label: "Settings", icon: Settings },
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [batchNotifications, setBatchNotifications] = useState([]);
  const knownBatchIdsRef = useRef(new Set());
  const completedReminderIdsRef = useRef(new Set());
  const shortageReminderIdsRef = useRef(new Set());
  const initializedRef = useRef(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showCompanyPopup, setShowCompanyPopup] = useState(false);
  const [showLogoutPopup, setShowLogoutPopup] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [companyInfo, setCompanyInfo] = useState({
    fullName: "",
    companyName: "",
    phone: "",
    email: "",
    address: "",
  });
  const mainRef = useRef(null);
  const navigate = useNavigate();
  const handleLogout = () => {
    setShowLogoutPopup(false);

    localStorage.removeItem("poultry_auth_token");
    localStorage.removeItem("poultry_auth_user");

    sessionStorage.clear();

    setTimeout(() => {
      navigate("/", { replace: true });
    }, 10);
  };

  useEffect(() => {
    const cachedUser = getAuthUser();
    if (cachedUser) {
      setCompanyInfo({
        fullName: cachedUser.full_name || "",
        companyName: cachedUser.company_name || "",
        phone: cachedUser.phone || "",
        email: cachedUser.email || "",
        address: cachedUser.address || "",
      });
    }
  }, []);

  useEffect(() => {
    let active = true;
    const loadProfile = async () => {
      try {
        const { data } = await auth.profile();
        if (!active || !data) return;
        setCompanyInfo({
          fullName: data.full_name || "",
          companyName: data.company_name || "",
          phone: data.phone || "",
          email: data.email || "",
          address: data.address || "",
        });
        const token = getAuthToken();
        if (token) {
          setAuthSession(token, data);
        }
      } catch {
        // Ignore profile fetch failures and keep cached auth user values.
      }
    };
    loadProfile();
    return () => {
      active = false;
    };
  }, []);

  const handleProfileSave = async () => {
    if (isSavingProfile) return;
    setIsSavingProfile(true);
    try {
      const payload = {
        full_name: companyInfo.fullName.trim(),
        company_name: companyInfo.companyName.trim(),
        phone: companyInfo.phone.trim(),
        email: companyInfo.email.trim().toLowerCase(),
        address: companyInfo.address.trim(),
      };
      const { data } = await auth.updateProfile(payload);
      setCompanyInfo({
        fullName: data.full_name || "",
        companyName: data.company_name || "",
        phone: data.phone || "",
        email: data.email || "",
        address: data.address || "",
      });
      const token = getAuthToken();
      if (token) {
        setAuthSession(token, data);
      }
      setShowCompanyPopup(false);
    } catch {
      // Keep popup open so user can retry if update fails.
    } finally {
      setIsSavingProfile(false);
    }
  };

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const handleScroll = () => {
      if (el.scrollTop > 50) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const dismissBatchNotification = (id) => {
    setBatchNotifications((prev) => prev.filter((item) => item.id !== id));
  };

  useEffect(() => {
    let alive = true;

    const pushNotification = (message, type = "info") => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setBatchNotifications((prev) =>
        [{ id, message, type }, ...prev].slice(0, 5),
      );
    };

    const checkBatchUpdates = async () => {
      try {
        const { data } = await productionApi.listBatches();
        if (!alive || !Array.isArray(data)) return;

        const currentIds = new Set(data.map((b) => b.id));
        if (!initializedRef.current) {
          knownBatchIdsRef.current = currentIds;
          completedReminderIdsRef.current = new Set(
            data
              .filter((b) => (b.run_status || "").toLowerCase() === "completed")
              .map((b) => b.id),
          );
          shortageReminderIdsRef.current = new Set(
            data
              .filter(
                (b) =>
                  ["running", "completed", "stopped"].includes(
                    (b.run_status || "").toLowerCase(),
                  ) && Boolean(b.rm_shortage_flag),
              )
              .map((b) => b.id),
          );
          initializedRef.current = true;
          return;
        }

        data.forEach((batch) => {
          const batchId = batch?.id;
          if (batchId == null) return;
          const batchNo = batch?.batch_no || batchId;
          const productName = String(batch?.product_name || "").trim();
          const runStatus = String(batch?.run_status || "").toLowerCase();
          const hasShortage = Boolean(batch?.rm_shortage_flag);
          const shortageDetail = String(batch?.rm_shortage_detail || "")
            .replace(/\s+/g, " ")
            .trim();
          const needsDetails = !productName || !batch?.has_report;

          if (!knownBatchIdsRef.current.has(batchId)) {
            if (!productName) {
              pushNotification(
                `New batch ${batchNo} added from HMI. Please add batch details in Production.`,
              );
            }
            knownBatchIdsRef.current.add(batchId);
          }

          if (
            runStatus === "completed" &&
            needsDetails &&
            !completedReminderIdsRef.current.has(batchId)
          ) {
            pushNotification(
              `Batch ${batchNo} completed. Please update missing batch details/report.`,
              "warning",
            );
            completedReminderIdsRef.current.add(batchId);
          }

          if (
            ["running", "completed", "stopped"].includes(runStatus) &&
            hasShortage &&
            !shortageReminderIdsRef.current.has(batchId)
          ) {
            const statusLabel = runStatus || "running";
            pushNotification(
              shortageDetail
                ? `Batch ${batchNo} is ${statusLabel} with RM shortage. ${shortageDetail}`
                : `Batch ${batchNo} is ${statusLabel} with insufficient raw material stock.`,
              "warning",
            );
            shortageReminderIdsRef.current.add(batchId);
          } else if (!hasShortage) {
            shortageReminderIdsRef.current.delete(batchId);
          }
        });
      } catch {
        // Ignore polling errors for non-blocking UI notifications.
      }
    };

    checkBatchUpdates();
    const interval = setInterval(checkBatchUpdates, 10000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden overflow-x-hidden">
      {/* 🔷 FULL WIDTH BANNER */}
      {/* <div className="relative w-full h-[200px] md:h-[170px] sm:h-[120px] bg-slate-100 overflow-hidden">

  <img
    src="/poultry-banner.png"
    alt="banner"
    className="w-full h-full object-fill"
  />

 
  <div className="absolute inset-0 flex flex-col items-center justify-start">
    <h1 className="text-xl mt-20 sm:text-xl md:text-3xl font-semibold text-gray-800 sm:mt-8">
      
      PRODUCTION TRACKING SYSTEM
    </h1>
  </div>


  <div className="absolute right-6 top-4 flex items-center gap-3">
    <div className="text-right text-xs sm:text-sm">
      <p className="text-sm font-medium">FEED MILL INTELLIGENCE</p>
      <p className="text-xs text-gray-500">+91 98765 43210</p>
    </div>
    <img
      src="/profile.png"
      className="w-12 h-12 rounded-full border border-slate-700 border-3"
      alt="profile"
    />
  </div>

</div> */}
      <div
        className={`sticky top-0 z-50 w-full transition-all duration-500
  ${isScrolled ? "h-[60px] bg-[#2F6A6B] shadow-md" : "h-[200px] md:h-[170px] sm:h-[120px] bg-slate-100"}
  overflow-hidden`}
        style={{
          backgroundImage: "url('/textures/chalk.png')",
          backgroundBlendMode: "overlay",
        }}
      >
        {/* Banner Image */}
        <img
          src="/poultry-banner.png"
          alt="banner"
          className={`w-full h-full object-fill transition-opacity duration-500
    ${isScrolled ? "opacity-0" : "opacity-100"}`}
        />

        {/* Title */}
        <div className="absolute inset-0 flex items-center justify-center px-3 sm:px-6">
          {/* LEFT: ICON + TITLE */}
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardList
              className={`transition-all duration-500 flex-shrink-0
      ${
        isScrolled
          ? "w-4 h-4 sm:w-5 sm:h-5 text-gray-100 sm:block hidden"
          : "hidden  w-5 h-5 text-gray-800"
      }`}
            />

            <h1
              className={`font-semibold transition-all duration-500 tracking-wider text-center
  ${
    isScrolled
      ? "text-sm  sm:text-lg text-gray-100 "
      : "text-lg mt-5 sm:mt-0 sm:text-xl md:text-3xl text-gray-800"
  }`}
            >
              <span className={`${isScrolled ? "block sm:inline" : "inline"}`}>
                PRODUCTION TRACKING
              </span>{" "}
              <span className={`${isScrolled ? "block sm:inline" : "inline"}`}>
                SYSTEM
              </span>
            </h1>
          </div>
        </div>

        {/* PROFILE */}
        <div
          className={`absolute right-3 sm:right-6 flex items-center gap-2 sm:gap-3 transition-all duration-500
  ${isScrolled ? "top-2" : "top-3 sm:top-4"}`}
        >
          {/* TOP ROW */}

          {/* TEXT (HIDE IN MOBILE) */}
          <div
            onClick={() => setShowCompanyPopup(true)}
            className="text-right text-xs sm:text-sm hidden lg:block cursor-pointer"
          >
            <p
              className={`text-sm md:text-md font-medium transition-colors duration-500
      ${isScrolled ? "text-gray-100" : "text-gray-800"}`}
            >
              {companyInfo.companyName || companyInfo.fullName || "Company"}
            </p>

            {!isScrolled && (
              <p className="text-xs text-gray-500">{companyInfo.phone || "-"}</p>
            )}
          </div>

          {/* PROFILE IMAGE */}
          <img
            src="/profile.jpeg"
            onClick={() => setShowCompanyPopup(true)}
            className={`rounded-full border border-slate-700 transition-all duration-500 block cursor-pointer hover:scale-105
  ${
    isScrolled
      ? "w-8 h-8 sm:w-9 sm:h-9 hidden md:block sm:mr-24 "
      : "w-9 h-9 sm:w-12 sm:h-12 ml-0"
  }`}
            alt="profile"
          />
          <div
            className={`absolute transition-all duration-500
  ${
    isScrolled
      ? "top-1/2 -translate-y-1/2 right-0 sm:right-0 md:right-0"
      : "top-full mt-2 right-0"
  }`}
          >
            <button
              onClick={() => setShowLogoutPopup(true)}
              className={`
      flex items-center gap-1
      px-2 sm:px-3
      py-1
      rounded-md
      shadow-md
      transition-all duration-300
      hover:scale-105
      ${
        isScrolled
          ? "bg-red-500 mt-10 md:mt-0 hover:bg-red-600 text-white text-[10px] sm:text-xs"
          : "bg-red-500 hover:bg-red-600 text-white text-[10px] sm:text-xs"
      }
    `}
            >
              <LogOut size={14} />
              <span className={`${isScrolled ? "hidden sm:block" : "block"}`}>
                Logout
              </span>
            </button>
          </div>
        </div>
        {/* LOGOUT BUTTON BELOW PROFILE */}
        {/* <button
    onClick={() => {
      localStorage.clear();
      window.location.href = "/";
    }}
    className={`mt-2 flex items-center gap-1 px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm
    transition-all duration-300
    ${
      isScrolled
        ? "bg-red-500 hover:bg-red-600 text-white"
        : "bg-red-100 hover:bg-red-200 text-red-700"
    }`}
  >
    Logout
  </button> */}
        {/* </div> */}
      </div>

      {/* 🔷 SIDEBAR + CONTENT */}
      <div className="flex flex-1 overflow-hidden w-full">
        {/* MOBILE MENU BUTTON */}
        {/* <button
          onClick={() => setOpen(true)}
          className="lg:hidden fixed top-3 left-3 z-50 bg-white p-2 rounded-lg shadow"
        >
          <Menu size={22} />
        </button> */}

        {/* SIDEBAR */}
        <aside
          className={`fixed lg:static z-40 w-56 h-full flex flex-col bg-[#DCE4EE] border-r shadow transition-transform duration-300
          ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
        >
          <div className="lg:hidden flex justify-end p-3">
            <X onClick={() => setOpen(false)} className="cursor-pointer" />
          </div>

          <nav className="px-2 pt-2 flex-1">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/layout"}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-md mb-1 text-md font-medium transition
                  ${
                    isActive
                      ? "bg-[#245658] text-gray-100 border-l-4 border-green-950"
                      : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto relative">
            <img
              src="/farm-bg.png"
              alt="farm"
              className="w-full object-cover"
            />

            <div className="absolute inset-0 flex flex-col items-center justify-end pb-3 bg-gradient-to-t from-black/30 via-black/20 to-transparent">
              <span className="text-[10px] text-slate-200 tracking-wide">
                Powered by
              </span>

              <span
                className="text-sm font-semibold tracking-[0.25em]
                 text-transparent bg-clip-text
                 bg-gradient-to-r from-gray-300 via-white to-gray-400
                 bg-[length:200px_auto]
                 animate-shine"
              >
                SERKAYON
              </span>
            </div>
          </div>
        </aside>

        {/* MAIN AREA */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* ONLY SCROLLABLE AREA */}
          {/* <main className="flex-1 pb-24 p-4 md:p-6 overflow-y-auto min-w-0 "> */}
          <main
            ref={mainRef}
            className={`flex-1 pb-24 p-4 md:p-6 overflow-y-auto min-w-0 transition-all duration-500
  ${isScrolled ? "mt-2" : "mt-0"}`}
          >
            <Outlet />
          </main>
        </div>
      </div>

      {/* MOBILE BOTTOM NAV */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-md 
                flex justify-around items-center 
                py-2 pb-safe z-50 lg:hidden"
      >
        <NavLink to="" end className="flex flex-col items-center">
          {({ isActive }) => (
            <>
              <div
                className={`flex items-center justify-center rounded-full transition
          ${isActive ? "bg-[#D7E6E6] w-11 h-11" : "w-11 h-11"}`}
              >
                <LayoutDashboard
                  size={22}
                  color={isActive ? "black" : "#475569"}
                />
              </div>

              <span
                className="text-[10px] sm:text-xs md:text-sm mt-1  font-extrabold"
                style={{ color: isActive ? "#245658" : "#475569" }}
              >
                Dashboard
              </span>
            </>
          )}
        </NavLink>

        <NavLink to="production" className="flex flex-col items-center">
          {({ isActive }) => (
            <>
              <div
                className={`flex items-center justify-center rounded-full transition
          ${isActive ? "bg-[#D7E6E6] w-11 h-11" : "w-11 h-11"}`}
              >
                <Factory size={22} color={isActive ? "black" : "#475569"} />
              </div>

              <span
                className="text-[10px] mt-1  font-extrabold"
                style={{ color: isActive ? "#245658" : "#475569" }}
              >
                Production
              </span>
            </>
          )}
        </NavLink>
        <NavLink to="raw-material" className="flex flex-col items-center">
          {({ isActive }) => (
            <>
              <div
                className={`flex items-center justify-center rounded-full transition
          ${isActive ? "bg-[#D7E6E6] w-11 h-11" : "w-11 h-11"}`}
              >
                <ClipboardList
                  size={22}
                  color={isActive ? "black" : "#475569"}
                />
              </div>

              <span
                className="text-[10px] mt-1 font-extrabold"
                style={{ color: isActive ? "#245658" : "#475569" }}
              >
                RM
              </span>
            </>
          )}
        </NavLink>

        <NavLink to="dispatch" className="flex flex-col items-center">
          {({ isActive }) => (
            <>
              <div
                className={`flex items-center justify-center rounded-full transition
          ${isActive ? "bg-[#D7E6E6] w-11 h-11" : "w-11 h-11"}`}
              >
                <Truck size={22} color={isActive ? "black" : "#475569"} />
              </div>

              <span
                className="text-[10px] mt-1  font-extrabold"
                style={{ color: isActive ? "#245658" : "#475569" }}
              >
                Dispatch
              </span>
            </>
          )}
        </NavLink>

        <NavLink to="stock" className="flex flex-col items-center">
          {({ isActive }) => (
            <>
              <div
                className={`flex items-center justify-center rounded-full transition
          ${isActive ? "bg-[#D7E6E6] w-11 h-11" : "w-11 h-11"}`}
              >
                <Boxes size={22} color={isActive ? "black" : "#475569"} />
              </div>

              <span
                className="text-[10px] mt-1  font-extrabold"
                style={{ color: isActive ? "#245658" : "#475569" }}
              >
                Stocks
              </span>
            </>
          )}
        </NavLink>

        <NavLink to="settings" className="flex flex-col items-center">
          {({ isActive }) => (
            <>
              <div
                className={`flex items-center justify-center rounded-full transition
          ${isActive ? "bg-[#D7E6E6] w-11 h-11" : "w-11 h-11"}`}
              >
                <Settings size={22} color={isActive ? "black" : "#475569"} />
              </div>

              <span
                className="text-[10px] mt-1 font-extrabold"
                style={{ color: isActive ? "#245658" : "#475569" }}
              >
                Settings
              </span>
            </>
          )}
        </NavLink>
      </div>
      {/* LOGOUT CONFIRM POPUP */}
      {showLogoutPopup && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 px-3">
          <div className="relative bg-white w-full max-w-sm rounded-2xl shadow-2xl p-5 sm:p-6 animate-in fade-in zoom-in duration-300">
            {/* CLOSE BUTTON */}
            <button
              onClick={() => setShowLogoutPopup(false)}
              className="absolute top-3 right-3 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 transition"
            >
              <X size={18} />
            </button>

            {/* ICON */}
            <div className="flex justify-center">
              <div className="bg-red-100 p-4 rounded-full">
                <LogOut className="text-red-600" size={30} />
              </div>
            </div>

            {/* TITLE */}
            <h2 className="text-center text-lg sm:text-xl font-bold text-slate-800 mt-4">
              Confirm Logout
            </h2>

            {/* MESSAGE */}
            <p className="text-center text-sm text-slate-500 mt-2">
              Are you sure you want to logout?
            </p>

            {/* BUTTONS */}
            <div className="flex flex-col sm:flex-row gap-3 mt-6">
              {/* CANCEL */}
              <button
                onClick={() => setShowLogoutPopup(false)}
                className="flex-1 border border-slate-300 hover:bg-slate-100 text-slate-700 py-2.5 rounded-lg font-semibold transition-all duration-300"
              >
                Cancel
              </button>

              {/* YES LOGOUT */}
              <button
                onClick={handleLogout}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-lg font-semibold transition-all duration-300"
              >
                Yes Logout
              </button>
            </div>
          </div>
        </div>
      )}
      {/* COMPANY POPUP */}
      {showCompanyPopup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-3">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-4 sm:p-6 relative animate-in fade-in zoom-in duration-300">
            {/* CLOSE BUTTON */}
            <button
              onClick={() => setShowCompanyPopup(false)}
              className="absolute top-3 right-3 bg-red-500 hover:bg-red-600 text-white rounded-full p-1"
            >
              <X size={18} />
            </button>

            {/* LOGO */}
            <div className="flex flex-col items-center mb-5">
              <img
                src="/profile.jpeg"
                alt="company"
                className="w-20 h-20 rounded-full border-4 border-[#245658] object-cover"
              />

              <h2 className="mt-3 text-lg sm:text-xl font-bold text-[#245658] text-center">
                Company Information
              </h2>
            </div>

            {/* FORM */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Name
                </label>

                <input
                  type="text"
                  value={companyInfo.fullName}
                  onChange={(e) =>
                    setCompanyInfo({
                      ...companyInfo,
                      fullName: e.target.value,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#245658]"
                />
              </div>

              {/* COMPANY NAME */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Company Name
                </label>

                <input
                  type="text"
                  value={companyInfo.companyName}
                  onChange={(e) =>
                    setCompanyInfo({
                      ...companyInfo,
                      companyName: e.target.value,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#245658]"
                />
              </div>

              {/* PHONE */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Phone Number
                </label>

                <input
                  type="text"
                  value={companyInfo.phone}
                  onChange={(e) =>
                    setCompanyInfo({
                      ...companyInfo,
                      phone: e.target.value,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#245658]"
                />
              </div>

              {/* EMAIL */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Email Address
                </label>

                <input
                  type="email"
                  value={companyInfo.email}
                  onChange={(e) =>
                    setCompanyInfo({
                      ...companyInfo,
                      email: e.target.value,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#245658]"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Address
                </label>

                <textarea
                  value={companyInfo.address}
                  onChange={(e) =>
                    setCompanyInfo({
                      ...companyInfo,
                      address: e.target.value,
                    })
                  }
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#245658]"
                />
              </div>

              {/* SAVE BUTTON */}
              <button
                type="button"
                onClick={handleProfileSave}
                disabled={isSavingProfile}
                className="w-full bg-[#245658] hover:bg-[#1c4547] text-white font-semibold py-2.5 rounded-lg transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSavingProfile ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
      {batchNotifications.length > 0 && (
        <div className="fixed right-4 bottom-20 md:bottom-4 z-[80] w-[360px] max-w-[calc(100vw-1.5rem)] space-y-3">
          {batchNotifications.map((item) => (
            <div
              key={item.id}
              className={`relative overflow-hidden rounded-xl border-2 shadow-[0_14px_30px_rgba(15,23,42,0.28)] ${
                item.type === "warning"
                  ? "bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 border-amber-300 text-amber-950"
                  : "bg-gradient-to-br from-cyan-50 via-white to-blue-50 border-cyan-300 text-slate-900"
              }`}
            >
              <div
                className={`absolute left-0 top-0 h-full w-1.5 ${
                  item.type === "warning" ? "bg-amber-500" : "bg-cyan-500"
                }`}
              />
              <div className="absolute right-10 top-2 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-slate-700">
                NEW
              </div>
              <div className="px-3 py-3 pl-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 rounded-full p-2 ${
                      item.type === "warning"
                        ? "bg-amber-200 text-amber-900 animate-pulse"
                        : "bg-cyan-100 text-cyan-800"
                    }`}
                  >
                    {item.type === "warning" ? (
                      <AlertTriangle size={16} />
                    ) : (
                      <BellRing size={16} />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-700">
                      {item.type === "warning"
                        ? "Action Needed"
                        : "Batch Alert"}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold leading-5 break-all">
                      {item.message}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      Go to Production and complete batch details.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissBatchNotification(item.id)}
                    className="rounded-md border border-black/10 bg-white/80 p-1 text-slate-600 hover:bg-white"
                    aria-label="Close notification"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
