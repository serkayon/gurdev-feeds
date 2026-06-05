import { useState, useEffect, useCallback, useRef } from "react";
import mqtt from "mqtt";
import toast, { Toaster } from "react-hot-toast";

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MQTT_HOST = import.meta.env.VITE_N720_EMQX_HOST;
const MQTT_PORT = import.meta.env.VITE_N720_EMQX_PORT;
const MQTT_TOPIC = import.meta.env.VITE_N720_EMQX_TOPIC;
const MQTT_USERNAME = import.meta.env.VITE_N720_EMQX_USERNAME;
const MQTT_PASSWORD = import.meta.env.VITE_N720_EMQX_PASSWORD;
const MQTT_KEEPALIVE = toNumber(import.meta.env.VITE_N720_EMQX_KEEPALIVE_SECONDS, 60);
const MQTT_TRANSPORT = import.meta.env.VITE_N720_EMQX_TRANSPORT;
const MQTT_WS_PATH = import.meta.env.VITE_N720_EMQX_WS_PATH;
const MQTT_PUBLISH_INTERVAL_MS = toNumber(import.meta.env.VITE_PUBLISH_INTERVAL_MS, 5000);
const MQTT_AUTO_PUBLISH = String(import.meta.env.VITE_AUTO_PUBLISH || "false").toLowerCase() === "true";
const APP_TIME_ZONE = import.meta.env.VITE_APP_TIMEZONE || "Asia/Kolkata";
const DEVICES = [
  "Process_Sensor_System",
  "Process_Sensor_System_Demo",
  "Process_Sensor_System_Sample",
];

const SENSOR_KEYS = [
  { key: "conditioner_temp", label: "Conditioner Temperature", unit: "C", max: 250 },
  { key: "bagging_temp", label: "Bagging Temperature", unit: "C", max: 250 },
  { key: "cooler_room_temp", label: "Cooler Room Temperature", unit: "C", max: 100 },
  { key: "pressure_before", label: "Pressure Before", unit: "bar", max: 20 },
  { key: "pressure_after", label: "Pressure After", unit: "bar", max: 20 },
  { key: "motor_speed", label: "Motor Speed", unit: "RPM", max: 1500 },
  { key: "motor_current", label: "Motor Current", unit: "A", max: 300 },
  { key: "room_temp", label: "Room Temperature", unit: "C", max: 100 },
  { key: "humidity", label: "Humidity", unit: "%", max: 100 },
];

const TOGGLE_KEYS = [
  { key: "process_activation_hmi", label: "Process Activation HMI" },
  { key: "process_switch", label: "Process Switch" },
  { key: "batch_switch", label: "Batch Switch" },
  { key: "batch_status", label: "Batch Status" },
];

const BATCH_KEYS = [
  { key: "current_batch", label: "Current Batch" },
  { key: "set_batch", label: "Set Batch" },
  { key: "bag_count", label: "Bag Count" },
  { key: "recipe_number", label: "Recipe No." },
  { key: "Batch_Product", label: "Batch Product" },
  { key: "Process_Product", label: "Process Product" },
];

const SENSOR_SCALE = {
  conditioner_temp: 100,
  bagging_temp: 10,
  cooler_room_temp: 10,
  pressure_before: 10,
  pressure_after: 10,
  motor_speed: 10,
  motor_current: 10,
  room_temp: 10,
  humidity: 10,
};

function getNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day},${values.hour}:${values.minute}:${values.second}`;
}

const INITIAL = {
  from: "N720",
  device: "Process_Sensor_System",
  conditioner_temp: 48,
  bagging_temp: 41,
  cooler_room_temp: 32,
  pressure_before: 16,
  pressure_after: 8,
  motor_speed: 1200,
  motor_current: 22,
  room_temp: 30,
  humidity: 68,
  alarm_timer: 0,
  process_activation_hmi: 0,
  process_switch: 0,
  batch_switch: 0,
  batch_status: 0,
  current_batch: 0,
  set_batch: 0,
  bag_count: 0,
  recipe_number: 0,
  Batch_Product: 0,
  Process_Product: 0,
  time: getNow(),
};

function buildN720Payload(source) {
  const payload = { ...source };
  Object.entries(SENSOR_SCALE).forEach(([key, scale]) => {
    const value = Number(source[key]);
    payload[key] = Number.isFinite(value) ? Math.round(value * scale) : 0;
  });
  return payload;
}

console.log("Initial data:", MQTT_WS_PATH);
function SensorGauge({ label, unit, value, max, onChange }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = pct > 80 ? "#b91c1c" : pct > 60 ? "#b45309" : "#0f766e";
  return (
    <div style={styles.sensorCard}>
      <div style={styles.sensorHeader}>
        <span style={styles.sensorLabel}>{label}</span>
        <span style={{ ...styles.sensorValue, color }}>
          {Number(value).toFixed(1)}
          <span style={styles.sensorUnit}>{unit ? " " + unit : ""}</span>
        </span>
      </div>
      <div style={styles.trackWrap}>
        <div style={{ ...styles.trackFill, width: `${pct}%`, background: color }} />
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={styles.rangeInput}
      />
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  const on = value === 1;
  return (
    <div style={styles.toggleRow}>
      <span style={styles.toggleLabel}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...styles.toggleStatus, color: on ? "#0f766e" : "#b91c1c" }}>
          {on ? "ON" : "OFF"}
        </span>
        <button
          onClick={() => onChange(on ? 0 : 1)}
          style={{ ...styles.toggleBtn, background: on ? "#0d9488" : "#cbd5e1" }}
          aria-label={`Toggle ${label}`}
        >
          <div
            style={{
              ...styles.toggleThumb,
              transform: on ? "translateX(22px)" : "translateX(2px)",
              background: "#ffffff",
            }}
          />
        </button>
      </div>
    </div>
  );
}

export default function HMISimulator() {
  const clientRef = useRef(null);
  const publishIntervalRef = useRef(null);
  const shouldStayConnectedRef = useRef(true);
  const [clientId] = useState(() => `n720-sim-${Math.random().toString(16).slice(2, 10)}`);
  const [data, setData] = useState({ ...INITIAL, time: getNow() });
  const [publishedData, setPublishedData] = useState(() =>
    buildN720Payload({ ...INITIAL, time: getNow() })
  );
  const [postStatus, setPostStatus] = useState("idle");
  const [isConnected, setIsConnected] = useState(false);
  const dataRef = useRef(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const stopPublishInterval = useCallback(() => {
    if (publishIntervalRef.current) {
      clearInterval(publishIntervalRef.current);
      publishIntervalRef.current = null;
    }
  }, []);

  const connectMqtt = useCallback(() => {
    if (clientRef.current) return;
    shouldStayConnectedRef.current = true;

  const brokerUrl =
    `${MQTT_TRANSPORT}://${MQTT_HOST}:${MQTT_PORT}${MQTT_WS_PATH}`;
  console.log("Connecting to MQTT broker at", brokerUrl);
  const client = mqtt.connect(brokerUrl, {
    clientId,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    keepalive: MQTT_KEEPALIVE,
    clean: true,
    connectTimeout: 30_000,
    resubscribe: true,
    reconnectPeriod: 3000,
    protocolVersion: 5,
  });

  clientRef.current = client;

  client.on("connect", () => {
    console.log("Connected to EMQX");
    toast.success("MQTT Connected Successfully");
    setPostStatus("ok");
    setIsConnected(true);

    stopPublishInterval();

    const publishOnce = () => {
      if (client.connected) {
        setPostStatus("sending");
        const payload = buildN720Payload(dataRef.current);

        client.publish(
          MQTT_TOPIC,
          JSON.stringify(payload),
          { qos: 1 },
          (err) => {
            if (err) {
              console.log("Publish error", err);
              setPostStatus("err");
            } else {
              console.log("Published");
              setPublishedData(payload);
              setPostStatus("ok");
            }
          }
        );
      }
    };

    if (MQTT_AUTO_PUBLISH) {
      publishOnce();
      const publishInterval = setInterval(publishOnce, MQTT_PUBLISH_INTERVAL_MS);
      publishIntervalRef.current = publishInterval;
    }
  });
  client.on("close", () => {
    console.log("MQTT Disconnected");
    stopPublishInterval();
    setIsConnected(false);
    setPostStatus("err");
  });
  client.on("reconnect", () => {
    console.log("MQTT Reconnecting...");
    setPostStatus("sending");
  });
  client.on("offline", () => {
    console.log("MQTT Offline");
    setPostStatus("err");
  });

  client.on("error", (err) => {
    console.log("MQTT Error", err);
    toast.error("MQTT Connection Error");
    stopPublishInterval();

    setPostStatus("err");
  });
  }, [clientId, stopPublishInterval]);

  const disconnectMqtt = useCallback(() => {
    shouldStayConnectedRef.current = false;
    stopPublishInterval();
    const client = clientRef.current;
    if (!client) {
      setIsConnected(false);
      setPostStatus("idle");
      return;
    }
    client.end(true);
    clientRef.current = null;
    setIsConnected(false);
    setPostStatus("idle");
  }, [stopPublishInterval]);

  useEffect(() => {
    const tick = setInterval(() => {
      setData((d) => ({ ...d, time: getNow() }));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    return () => {
      shouldStayConnectedRef.current = false;
      disconnectMqtt();
    };
}, [connectMqtt, disconnectMqtt]);

  const set = useCallback((key, val) => {
    setData((d) => ({ ...d, [key]: val }));
  }, []);

  const statusDot = { idle: "#64748b", sending: "#b45309", ok: "#0f766e", err: "#b91c1c" }[postStatus];
  const statusTxt = { idle: "Standby", sending: "Sending...", ok: "Connected", err: "Disconnected" }[postStatus];

  return (
      <>
    <Toaster
      position="top-right"
      reverseOrder={false}
    />

    <div style={styles.root}>
      <div style={styles.overlay} />
      <div style={styles.left}>
        <div style={styles.hmiHeader}>
          <div>
            <div style={styles.hmiTitle}>Process HMI Console</div>
            <div style={styles.hmiSub}>Industrial Sensor Monitoring System - Node {data.from}</div>
          </div>
          <div style={styles.statusCluster}>
            <div style={styles.statusBar}>
              <div style={{ ...styles.statusDot, background: statusDot }} />
              <span style={styles.statusTxt}>{statusTxt}</span>
            </div>
            <button
              onClick={isConnected ? disconnectMqtt : connectMqtt}
              style={{
                ...styles.connBtn,
                background: isConnected ? "#fee2e2" : "#dcfce7",
                borderColor: isConnected ? "#fecaca" : "#bbf7d0",
                color: isConnected ? "#991b1b" : "#166534",
              }}
            >
              {isConnected ? "Disconnect" : "Connect"}
            </button>
          </div>
        </div>

        {/* FROM field */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Source Node</div>
          <input
            type="text"
            value={data.from}
            onChange={(e) => set("from", e.target.value)}
            style={styles.textInput}
          />
        </div>

        {/* Device Selector */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Device</div>
          <select
            value={data.device}
            onChange={(e) => set("device", e.target.value)}
            style={styles.select}
          >
            {DEVICES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {/* Sensors — includes humidity after room_temp */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Sensor Readings</div>
          <div style={styles.sensorGrid}>
            {SENSOR_KEYS.map(({ key, label, unit, max }) => (
              <SensorGauge
                key={key}
                label={label}
                unit={unit}
                max={max}
                value={data[key]}
                onChange={(v) => set(key, v)}
              />
            ))}
          </div>
        </div>

        {/* Alarm only */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Parameters</div>
          <div style={styles.paramGrid}>
            <div style={styles.paramField}>
              <label style={styles.paramLabel}>Alarm Timer (s)</label>
              <input
                type="number"
                value={data.alarm_timer=== 0 ? "" : data.alarm_timer}
                onChange={(e) => set("alarm_timer", Number(e.target.value))}
                style={styles.numInput}
                placeholder="0"
              />
            </div>
          </div>
        </div>

        {/* Toggles */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Process Controls</div>
          <div style={styles.toggleGrid}>
            {TOGGLE_KEYS.map(({ key, label }) => (
              <Toggle
                key={key}
                label={label}
                value={data[key]}
                onChange={(v) => set(key, v)}
              />
            ))}
          </div>
        </div>

        {/* Batch */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Batch Inputs</div>
          <div style={styles.batchGrid}>
            {BATCH_KEYS.map(({ key, label }) => (
              <div key={key} style={styles.paramField}>
                <label style={styles.paramLabel}>{label}</label>
                <input
                  type="number"
                 value={data[key] === 0 ? "" : data[key]}
                  onChange={(e) =>
                    set(key, e.target.value === "" ? 0 : Number(e.target.value))
                  }
                  style={styles.numInput}
                  placeholder="0"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Timestamp */}
        <div style={styles.timestampBar}>
          <span style={styles.tsLabel}>Last Data Timestamp</span>
          <span style={styles.tsValue}>{data.time}</span>
        </div>
      </div>

      {/* RIGHT JSON PANEL */}
      <div style={styles.right}>
        <div style={styles.jsonHeader}>
          <span style={styles.jsonTitle}>Live JSON Payload</span>
          <span style={styles.jsonBadge}>Topic: {MQTT_TOPIC} | {MQTT_AUTO_PUBLISH ? `${MQTT_PUBLISH_INTERVAL_MS / 1000}s auto-send` : "manual"}</span>
        </div>
        <pre style={styles.jsonPre}>{JSON.stringify(publishedData, null, 2)}</pre>
      </div>
    </div>
  </>
  );
}

const styles = {
  root: {
    display: "flex",
    minHeight: "100vh",
    background: "linear-gradient(135deg, #e6eef8 0%, #f7fbff 45%, #eef6ff 100%)",
    fontFamily: "'Segoe UI', 'Trebuchet MS', sans-serif",
    color: "#0b1f33",
    flexWrap: "wrap",
    position: "relative",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background:
      "radial-gradient(circle at 8% 10%, rgba(37,99,235,0.14), transparent 35%), radial-gradient(circle at 90% 85%, rgba(14,116,144,0.12), transparent 40%)",
    pointerEvents: "none",
    zIndex: 0,
  },
  left: {
    flex: "0 0 70%",
    minWidth: 320,
    padding: "26px 28px",
    boxSizing: "border-box",
    borderRight: "1px solid rgba(148,163,184,0.35)",
    overflowY: "auto",
    position: "relative",
    zIndex: 1,
  },
  right: {
    flex: "0 0 30%",
    minWidth: 280,
    background: "rgba(255,255,255,0.86)",
    backdropFilter: "blur(10px)",
    display: "flex",
    flexDirection: "column",
    position: "sticky",
    top: 0,
    height: "100vh",
    boxSizing: "border-box",
    borderLeft: "1px solid rgba(148,163,184,0.35)",
    zIndex: 1,
  },
  hmiHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 22,
    borderBottom: "1px solid rgba(148,163,184,0.35)",
    paddingBottom: 16,
    flexWrap: "wrap",
    gap: 10,
  },
  hmiTitle: {
    fontSize: 24,
    fontWeight: 700,
    color: "#0f3f66",
    letterSpacing: 0.2,
    textTransform: "none",
  },
  hmiSub: {
    fontSize: 13,
    color: "#486581",
    marginTop: 3,
    letterSpacing: 0.2,
  },
  statusCluster: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  statusBar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#ffffff",
    border: "1px solid rgba(148,163,184,0.45)",
    borderRadius: 999,
    padding: "6px 12px",
    boxShadow: "0 6px 18px rgba(15,23,42,0.08)",
  },
  connBtn: {
    border: "1px solid",
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    transition: "background 0.3s",
  },
  statusTxt: { fontSize: 12, color: "#334155", letterSpacing: 0.2, fontWeight: 600 },
  section: {
    marginBottom: 14,
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(148,163,184,0.35)",
    borderRadius: 12,
    padding: "14px 18px",
    boxShadow: "0 10px 26px rgba(15,23,42,0.08)",
  },
  sectionTitle: {
    fontSize: 13,
    color: "#164e63",
    letterSpacing: 0.3,
    marginBottom: 10,
    fontWeight: 700,
    textAlign: "left",
  },
  select: {
    width: "100%",
    background: "#f8fbff",
    color: "#0b1f33",
    border: "1px solid #b8c6d8",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 13,
    fontFamily: "inherit",
    cursor: "pointer",
    outline: "none",
  },
  textInput: {
    width: "100%",
    background: "#f8fbff",
    color: "#0b1f33",
    border: "1px solid #b8c6d8",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  },
  sensorGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: 10,
  },
  sensorCard: {
    background: "#f8fbff",
    border: "1px solid #d8e3f0",
    borderRadius: 10,
    padding: "12px",
  },
  sensorHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 6,
  },
  sensorLabel: { fontSize: 11, color: "#334155", letterSpacing: 0.2 },
  sensorValue: { fontSize: 15, fontWeight: 700, letterSpacing: 1 },
  sensorUnit: { fontSize: 10, color: "#475569" },
  trackWrap: {
    height: 6,
    background: "#dbe7f5",
    borderRadius: 2,
    marginBottom: 6,
    overflow: "hidden",
  },
  trackFill: {
    height: "100%",
    borderRadius: 2,
    transition: "width 0.1s, background 0.3s",
  },
  rangeInput: {
    width: "100%",
    accentColor: "#0d9488",
    cursor: "pointer",
    height: 18,
  },
  paramGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 12,
  },
  batchGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
    gap: 10,
  },
  paramField: { display: "flex", flexDirection: "column", gap: 4 },
  paramLabel: { fontSize: 11, color: "#334155", letterSpacing: 0.5, fontWeight: 600 },
  numInput: {
    background: "#f8fbff",
    color: "#0b1f33",
    border: "1px solid #b8c6d8",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  toggleGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: 8,
  },
  toggleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#f8fbff",
    border: "1px solid #d8e3f0",
    borderRadius: 8,
    padding: "9px 12px",
  },
  toggleLabel: { fontSize: 11, color: "#1e293b", letterSpacing: 0.5, fontWeight: 600 },
  toggleStatus: { fontSize: 11, fontWeight: 700, minWidth: 24 },
  toggleBtn: {
    width: 48,
    height: 24,
    borderRadius: 12,
    border: "1px solid #9fb3cc",
    cursor: "pointer",
    position: "relative",
    transition: "background 0.25s",
    padding: 0,
  },
  toggleThumb: {
    position: "absolute",
    top: 2,
    width: 18,
    height: 18,
    borderRadius: "50%",
    transition: "transform 0.2s",
    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
  },
  timestampBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "rgba(255,255,255,0.95)",
    border: "1px solid rgba(148,163,184,0.35)",
    borderRadius: 12,
    padding: "10px 16px",
    marginTop: 4,
    flexWrap: "wrap",
    gap: 8,
    boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
  },
  tsLabel: { fontSize: 12, color: "#0f4c45", letterSpacing: 0.2, fontWeight: 700 },
  tsValue: { fontSize: 13, color: "#92400e", letterSpacing: 1, fontWeight: 700 },
  jsonHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 16px 10px",
    borderBottom: "1px solid rgba(148,163,184,0.35)",
    flexShrink: 0,
    background: "rgba(255,255,255,0.72)",
  },
  jsonTitle: {
    fontSize: 13,
    color: "#0f4c45",
    letterSpacing: 0.3,
    fontWeight: 700,
    textAlign: "left",
  },
  jsonBadge: {
    fontSize: 11,
    color: "#92400e",
    background: "#ecfeff",
    border: "1px solid #67e8f9",
    borderRadius: 999,
    padding: "4px 10px",
    letterSpacing: 0.2,
    fontWeight: 700,
  },
  jsonPre: {
    flex: 1,
    overflow: "auto",
    margin: 0,
    padding: "14px 16px",
    fontSize: 11.5,
    color: "#18324f",
    lineHeight: 1.7,
    background: "rgba(248,251,255,0.85)",
    fontFamily: "'Consolas', 'Courier New', monospace",
  },
};
