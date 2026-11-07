/**
 * JM98MAX Studio — Hardware DSP & 10-Band PEQ Engine
 * Dedicated controller for JCALLY JM98MAX (CS43198 DAC + Savitech USB Bridge)
 * 
 * Safely interacts with volatile DSP RAM buffer via WebHID (Report ID 0x4B / 75).
 * Calibrated with XBEAST Master DSP Presets (Tier 2 Static Specifications).
 */

// --- Default Frequency & Rack Configuration (XBEAST Reference Frequencies) ---
const DEFAULT_BANDS = [
  { index: 0, freq: 32,    gain: 0, q: 1.00, type: "LSQ", enabled: true, label: "Sub-Bass" },
  { index: 1, freq: 64,    gain: 0, q: 1.00, type: "PK",  enabled: true, label: "Bass Core" },
  { index: 2, freq: 125,   gain: 0, q: 1.00, type: "PK",  enabled: true, label: "Upper Bass" },
  { index: 3, freq: 250,   gain: 0, q: 1.00, type: "PK",  enabled: true, label: "Low-Mids" },
  { index: 4, freq: 500,   gain: 0, q: 1.00, type: "PK",  enabled: true, label: "Mud Scoop" },
  { index: 5, freq: 1000,  gain: 0, q: 1.00, type: "PK",  enabled: true, label: "Core Mids" },
  { index: 6, freq: 2000,  gain: 0, q: 1.00, type: "PK",  enabled: true, label: "Upper Mids" },
  { index: 7, freq: 4000,  gain: 0, q: 1.00, type: "PK",  enabled: true, label: "Lower Treble" },
  { index: 8, freq: 8000,  gain: 0, q: 1.00, type: "PK",  enabled: true, label: "Upper Treble" },
  { index: 9, freq: 16000, gain: 0, q: 1.00, type: "HSQ", enabled: true, label: "Air" }
];

// Savitech Hardware Protocol Constants
const SAVI_CONSTANTS = {
  REPORT_ID: 75,       // 0x4B
  REPORT_ID_ALT: 1,    // 0x01
  CMD_WRITE: 0x01,
  CMD_PEQ: 0x09,
  CMD_GAIN: 0x03,
  CMD_COMMIT: 0x0a,
  PAYLOAD_LEN: 0x18,   // 24 bytes
  SAMPLE_RATE: 96000,  // Hardware DSP operates at 96 kHz
  SCALE_Q30: 1073741824 // 2^30
};

// Target Vendor & Product IDs
const USB_TARGET_FILTERS = [
  { vendorId: 0x0666, productId: 0x0881 }, // JCALLY JM98MAX (Primary)
  { vendorId: 0x0666 },                     // JCALLY products
  { vendorId: 0x0661 },                     // Savitech / OEM Bridge
  { vendorId: 0x262a }                      // Savitech official
];

// --- XBEAST DSP Master Presets Suite ---
const XBEAST_PRESETS = {
  // --- In-Ear Monitors (IEMs) ---
  "iem-balanced": {
    name: "Balanced",
    category: "iems",
    preamp: -9.0,
    dynamicPreamp: -4.5,
    gains: [2.6, 6.9, 5.7, 1.3, -2.2, -1.5, 2.3, -2.6, -0.8, 3.8]
  },
  "iem-punchy": {
    name: "Punchy Bass",
    category: "iems",
    preamp: -11.0,
    dynamicPreamp: -5.5,
    gains: [4.3, 9.0, 6.5, 1.3, -2.2, -1.5, 2.3, -0.7, -0.5, 3.8]
  },
  "iem-heavy": {
    name: "Heavy Bass",
    category: "iems",
    preamp: -14.0,
    dynamicPreamp: -7.0,
    gains: [12.0, 12.0, 12.0, 1.3, -2.2, -1.5, 2.3, 1.3, 1.8, 3.8]
  },
  "iem-extreme": {
    name: "Extreme Sub-Bass",
    category: "iems",
    preamp: -22.0,
    dynamicPreamp: -11.0,
    gains: [15.0, 20.0, 17.0, 1.3, -2.2, -1.5, 2.3, 1.9, 3.0, 3.8]
  },

  // --- Over-Ear Headphones ---
  "hp-balanced": {
    name: "Balanced",
    category: "headphones",
    preamp: -9.0,
    dynamicPreamp: -4.5,
    gains: [2.6, 6.9, 5.7, 1.3, -2.2, -1.5, 2.3, 0.2, -0.2, 3.8]
  },
  "hp-punchy": {
    name: "Punchy Bass",
    category: "headphones",
    preamp: -11.0,
    dynamicPreamp: -5.5,
    gains: [4.3, 9.0, 6.5, 1.3, -2.2, -1.5, 2.3, 0.9, 1.0, 3.8]
  },
  "hp-heavy": {
    name: "Heavy Bass",
    category: "headphones",
    preamp: -14.0,
    dynamicPreamp: -7.0,
    gains: [12.0, 12.0, 12.0, 1.3, -2.2, -1.5, 2.3, 2.7, 3.0, 3.8]
  },
  "hp-extreme": {
    name: "Extreme Sub-Bass",
    category: "headphones",
    preamp: -22.0,
    dynamicPreamp: -11.0,
    gains: [15.0, 20.0, 17.0, 1.3, -2.2, -1.5, 2.3, 2.7, 3.0, 3.8]
  },

  // --- Reference ---
  "flat": {
    name: "Flat (0 dB)",
    category: "ref",
    preamp: 0.0,
    dynamicPreamp: 0.0,
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  }
};

// --- Application State ---
let currentBands = JSON.parse(JSON.stringify(DEFAULT_BANDS));
let preampGain = -5.5; // Default to Streaming Loud (-5.5 dB)
let activeDevice = null;
let autoSyncEnabled = true;
let syncDebounceTimer = null;
let draggingNodeIndex = null;
let activeCategory = "iems";
let activePresetKey = "iem-punchy";
let headroomMode = localStorage.getItem("jm98max_headroom_mode") || "dynamic"; // "dynamic" (Loud) or "strict" (Safe)
let antiSleepEnabled = localStorage.getItem("jm98max_anti_sleep") === "true";

// --- DOM References ---
const btnConnect = document.getElementById("btnConnect");
const btnConnectText = document.getElementById("btnConnectText");
const deviceStatusPill = document.getElementById("deviceStatusPill");
const statusState = document.getElementById("statusState");
const statusDetails = document.getElementById("statusDetails");

const eqCanvas = document.getElementById("eqCanvas");
const canvasTooltip = document.getElementById("canvasTooltip");
const preampSlider = document.getElementById("preampSlider");
const preampVal = document.getElementById("preampVal");
const btnHeadroomDynamic = document.getElementById("btnHeadroomDynamic");
const btnHeadroomStrict = document.getElementById("btnHeadroomStrict");
const headroomDynamicVal = document.getElementById("headroomDynamicVal");
const headroomStrictVal = document.getElementById("headroomStrictVal");
const autoSyncCheck = document.getElementById("autoSyncCheck");
const antiSleepCheck = document.getElementById("antiSleepCheck");
const btnSyncRam = document.getElementById("btnSyncRam");
const btnResetCurve = document.getElementById("btnResetCurve");
const channelsContainer = document.getElementById("channelsContainer");
const categoryTabs = document.getElementById("categoryTabs");
const presetPillsContainer = document.getElementById("presetPillsContainer");

// Modal Elements
const btnAutoEqImport = document.getElementById("btnAutoEqImport");
const btnExportJson = document.getElementById("btnExportJson");
const importModal = document.getElementById("importModal");
const btnCloseModal = document.getElementById("btnCloseModal");
const btnCancelModal = document.getElementById("btnCancelModal");
const btnApplyImport = document.getElementById("btnApplyImport");
const importTextArea = document.getElementById("importTextArea");

// Save Custom Preset Modal Elements
const btnOpenSaveModal = document.getElementById("btnOpenSaveModal");
const savePresetModal = document.getElementById("savePresetModal");
const btnCloseSaveModal = document.getElementById("btnCloseSaveModal");
const btnCancelSaveModal = document.getElementById("btnCancelSaveModal");
const btnConfirmSavePreset = document.getElementById("btnConfirmSavePreset");
const savePresetNameInput = document.getElementById("savePresetNameInput");
const saveModalPreampVal = document.getElementById("saveModalPreampVal");

// ==========================================================================
// 1. DSP Math: Robert Bristow-Johnson (RBJ) Biquad Calculator
// ==========================================================================

function calculateRBJBiquad(type, freq, gainDb, q, fs = SAVI_CONSTANTS.SAMPLE_RATE) {
  const w0 = (2 * Math.PI * freq) / fs;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * Math.max(0.01, q));
  const A = Math.pow(10, gainDb / 40);

  let b0, b1, b2, a0, a1, a2;

  switch (type) {
    case "LSQ": { // Low Shelf
      const sa = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cosw + sa);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
      b2 = A * ((A + 1) - (A - 1) * cosw - sa);
      a0 = (A + 1) + (A - 1) * cosw + sa;
      a1 = -2 * ((A - 1) + (A + 1) * cosw);
      a2 = (A + 1) + (A - 1) * cosw - sa;
      break;
    }
    case "HSQ": { // High Shelf
      const sb = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cosw + sb);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
      b2 = A * ((A + 1) - (A - 1) * cosw - sb);
      a0 = (A + 1) - (A - 1) * cosw + sb;
      a1 = 2 * ((A - 1) - (A + 1) * cosw);
      a2 = (A + 1) - (A - 1) * cosw - sb;
      break;
    }
    case "NOTCH": {
      b0 = 1;
      b1 = -2 * cosw;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    }
    case "PK": // Peaking EQ
    default: {
      b0 = 1 + alpha * A;
      b1 = -2 * cosw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosw;
      a2 = 1 - alpha / A;
      break;
    }
  }

  const invA0 = 1 / a0;
  return {
    b0: b0 * invA0,
    b1: b1 * invA0,
    b2: b2 * invA0,
    a1: a1 * invA0,
    a2: a2 * invA0
  };
}

function encodeSavitechQ30(coeffs) {
  const s = SAVI_CONSTANTS.SCALE_Q30;
  // Saturating clamp to prevent 32-bit signed integer overflow on extreme boosts up to +30 dB
  const toQ30 = (val) => {
    const raw = Math.round(val * s);
    return Math.max(-2147483648, Math.min(2147483647, raw));
  };

  const raw32 = [
    toQ30(coeffs.b0),
    toQ30(coeffs.b1),
    toQ30(coeffs.b2),
    toQ30(-coeffs.a1), // Savitech expects -a1
    toQ30(-coeffs.a2)  // Savitech expects -a2
  ];

  const bytes = [];
  for (const val of raw32) {
    bytes.push(val & 0xff);
    bytes.push((val >> 8) & 0xff);
    bytes.push((val >> 16) & 0xff);
    bytes.push((val >> 24) & 0xff);
  }
  return bytes;
}

function evaluateBiquadDb(coeffs, f, fs = SAVI_CONSTANTS.SAMPLE_RATE) {
  const w = (2 * Math.PI * f) / fs;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);

  const numReal = coeffs.b0 + coeffs.b1 * cos1 + coeffs.b2 * cos2;
  const numImag = -coeffs.b1 * sin1 - coeffs.b2 * sin2;

  const denReal = 1.0 + coeffs.a1 * cos1 + coeffs.a2 * cos2;
  const denImag = -coeffs.a1 * sin1 - coeffs.a2 * sin2;

  const numMagSq = numReal * numReal + numImag * numImag;
  const denMagSq = denReal * denReal + denImag * denImag;

  if (denMagSq < 1e-12) return 0;
  return 10 * Math.log10(numMagSq / denMagSq);
}

// ==========================================================================
// 2. WebHID Communication & Safe Savitech DSP Protocol
// ==========================================================================

async function sendSavitechPacket(device, bytes) {
  if (!device || !device.opened) return false;

  const padded = new Uint8Array(36);
  for (let i = 0; i < Math.min(bytes.length, 36); i++) {
    padded[i] = bytes[i];
  }

  try {
    await device.sendReport(SAVI_CONSTANTS.REPORT_ID, padded);
    return true;
  } catch (err) {
    try {
      await device.sendFeatureReport(SAVI_CONSTANTS.REPORT_ID, padded);
      return true;
    } catch (featErr) {
      try {
        await device.sendReport(0, padded);
        return true;
      } catch (e3) {
        console.warn("[JM98MAX] HID write failed:", e3);
        return false;
      }
    }
  }
}

function buildSavitechBandPacket(band, globalPreamp) {
  const effectiveGain = band.enabled ? band.gain : 0.0;
  const coeffs = calculateRBJBiquad(band.type, band.freq, effectiveGain, band.q);
  const q30Bytes = encodeSavitechQ30(coeffs);

  const freqInt = Math.round(band.freq);
  const qInt = Math.round(band.q * 256);
  const gainInt = Math.round(effectiveGain * 256);

  let gPreampByte = Math.round(globalPreamp);
  if (gPreampByte > 127) gPreampByte = 127;
  if (gPreampByte < -128) gPreampByte = -128;
  if (gPreampByte < 0) gPreampByte = 256 + gPreampByte;

  const typeMap = { LSQ: 1, PK: 2, HSQ: 3, NOTCH: 0 };
  const typeCode = typeMap[band.type] || 2;

  return [
    SAVI_CONSTANTS.CMD_WRITE,      // 0: 0x01
    SAVI_CONSTANTS.CMD_PEQ,        // 1: 0x09
    SAVI_CONSTANTS.PAYLOAD_LEN,    // 2: 0x18 (24 bytes)
    0x00,                          // 3
    band.index,                    // 4: Band 0-9
    0x00,                          // 5
    0x00,                          // 6
    ...q30Bytes,                   // 7-26: 20 bytes Q30 coeffs
    freqInt & 0xff,                // 27
    (freqInt >> 8) & 0xff,         // 28
    qInt & 0xff,                   // 29
    (qInt >> 8) & 0xff,            // 30
    gainInt & 0xff,                // 31
    (gainInt >> 8) & 0xff,         // 32
    typeCode,                      // 33: Filter Type
    gPreampByte,                   // 34: Global Preamp Gain
    0x00                           // 35: Target Slot (0x00 for volatile DSP RAM)
  ];
}

async function syncAllBandsToDacRam() {
  if (!activeDevice) {
    showStatusAlert("DAC disconnected. Connect your JM98MAX first.", "warning");
    return;
  }

  btnSyncRam.classList.add("syncing");
  try {
    // 1. Write Preamp Gain
    let gVal = Math.round(preampGain);
    if (gVal < 0) gVal = 256 + gVal;
    await sendSavitechPacket(activeDevice, [
      SAVI_CONSTANTS.CMD_WRITE,
      SAVI_CONSTANTS.CMD_GAIN,
      0x02,
      0x00,
      gVal
    ]);
    await new Promise((r) => setTimeout(r, 20));

    // 2. Write all 10 bands sequentially
    for (const band of currentBands) {
      const packet = buildSavitechBandPacket(band, preampGain);
      await sendSavitechPacket(activeDevice, packet);
      await new Promise((r) => setTimeout(r, 25));
    }

    // 3. Commit / Latch to volatile DSP RAM
    await sendSavitechPacket(activeDevice, [0x01, 0x0a, 0x04, 0x00, 0x00, 0xff, 0xff]);
    await new Promise((r) => setTimeout(r, 20));

    // 4. Send refresh latch
    await sendSavitechPacket(activeDevice, [0x01, 0x01, 0x00]);

    showStatusAlert("10-Band PEQ latched to Hardware RAM", "success");
  } catch (err) {
    console.error("[JM98MAX] Sync failed:", err);
    showStatusAlert("Sync error: " + err.message, "error");
  } finally {
    btnSyncRam.classList.remove("syncing");
  }
}

function triggerAutoSync() {
  if (!autoSyncEnabled || !activeDevice) return;
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);

  syncDebounceTimer = setTimeout(() => {
    syncAllBandsToDacRam();
  }, 120);
}

// ==========================================================================
// 3. Interactive Frequency Curve Canvas
// ==========================================================================

function drawFrequencyResponse() {
  const ctx = eqCanvas.getContext("2d");
  const width = eqCanvas.width;
  const height = eqCanvas.height;

  // Clear background
  ctx.fillStyle = "#09090c";
  ctx.fillRect(0, 0, width, height);

  const minFreq = 20;
  const maxFreq = 20000;
  const minDb = -32;
  const maxDb = 32;

  const freqToX = (f) => {
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    return ((Math.log10(f) - logMin) / (logMax - logMin)) * width;
  };

  const xToFreq = (x) => {
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    return Math.pow(10, logMin + (x / width) * (logMax - logMin));
  };

  const dbToY = (db) => {
    return height - ((db - minDb) / (maxDb - minDb)) * height;
  };

  const yToDb = (y) => {
    return minDb + ((height - y) / height) * (maxDb - minDb);
  };

  // --- Grid Lines ---
  ctx.lineWidth = 1;
  const dbSteps = [-24, -18, -12, -6, 0, 6, 12, 18, 24];
  for (const db of dbSteps) {
    const y = dbToY(db);
    ctx.strokeStyle = db === 0 ? "rgba(245, 245, 247, 0.22)" : "rgba(255, 255, 255, 0.04)";
    if (db === 0) ctx.setLineDash([4, 4]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    ctx.fillStyle = db === 0 ? "#a8a8b3" : "#656570";
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${db > 0 ? "+" : ""}${db} dB`, 10, y - 4);
  }
  ctx.setLineDash([]);

  // Vertical Frequency grid (logarithmic)
  const freqGrid = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  for (const f of freqGrid) {
    const x = freqToX(f);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    ctx.fillStyle = "#656570";
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
    ctx.fillText(label, x, height - 8);
  }

  // Pre-calculate biquad coefficients for enabled bands
  const activeCoeffs = currentBands
    .filter((b) => b.enabled)
    .map((b) => calculateRBJBiquad(b.type, b.freq, b.gain, b.q));

  // --- Draw Master Curve ---
  const points = [];
  const steps = 300;

  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width;
    const f = xToFreq(x);

    let totalGain = preampGain;
    for (const c of activeCoeffs) {
      totalGain += evaluateBiquadDb(c, f);
    }
    const y = dbToY(totalGain);
    points.push({ x, y });
  }

  // Gradient fill under curve
  ctx.beginPath();
  ctx.moveTo(0, dbToY(0));
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(width, dbToY(0));
  ctx.closePath();

  const fillGradient = ctx.createLinearGradient(0, 0, 0, height);
  fillGradient.addColorStop(0, "rgba(212, 175, 55, 0.18)");
  fillGradient.addColorStop(0.5, "rgba(212, 175, 55, 0.05)");
  fillGradient.addColorStop(1, "rgba(212, 175, 55, 0.0)");
  ctx.fillStyle = fillGradient;
  ctx.fill();

  // Draw Glowing Champagne Gold Stroke
  ctx.shadowColor = "rgba(212, 175, 55, 0.6)";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = "#d4af37";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    if (i === 0) ctx.moveTo(points[i].x, points[i].y);
    else ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // --- Draw Draggable Band Handles ---
  currentBands.forEach((band, idx) => {
    const x = freqToX(band.freq);
    const y = dbToY(band.gain + preampGain);

    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = band.enabled ? "#f5f5f7" : "#555560";
    ctx.fill();
    ctx.strokeStyle = band.enabled ? "#d4af37" : "#333340";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#a8a8b3";
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${idx + 1}`, x, y - 10);
  });
}

// Canvas Mouse Interactions
eqCanvas.addEventListener("mousemove", (e) => {
  const rect = eqCanvas.getBoundingClientRect();
  const scaleX = eqCanvas.width / rect.width;
  const scaleY = eqCanvas.height / rect.height;
  const mouseX = (e.clientX - rect.left) * scaleX;
  const mouseY = (e.clientY - rect.top) * scaleY;

  const minFreq = 20, maxFreq = 20000, minDb = -32, maxDb = 32;
  const xToFreq = (x) => {
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    return Math.pow(10, logMin + (x / eqCanvas.width) * (logMax - logMin));
  };
  const yToDb = (y) => minDb + ((eqCanvas.height - y) / eqCanvas.height) * (maxDb - minDb);

  const freq = Math.round(xToFreq(mouseX));
  const db = (yToDb(mouseY) - preampGain).toFixed(1);

  if (draggingNodeIndex !== null) {
    const band = currentBands[draggingNodeIndex];
    band.gain = Math.max(-30, Math.min(30, parseFloat(db)));
    band.freq = Math.max(20, Math.min(20000, freq));

    updateBandUI(draggingNodeIndex);
    drawFrequencyResponse();
    triggerAutoSync();
  }

  canvasTooltip.style.display = "block";
  canvasTooltip.style.left = `${e.clientX - rect.left}px`;
  canvasTooltip.style.top = `${e.clientY - rect.top}px`;
  canvasTooltip.textContent = `${freq >= 1000 ? (freq / 1000).toFixed(1) + "k" : freq} Hz | ${db > 0 ? "+" : ""}${db} dB`;
});

eqCanvas.addEventListener("mouseleave", () => {
  canvasTooltip.style.display = "none";
  draggingNodeIndex = null;
});

eqCanvas.addEventListener("mousedown", (e) => {
  const rect = eqCanvas.getBoundingClientRect();
  const scaleX = eqCanvas.width / rect.width;
  const scaleY = eqCanvas.height / rect.height;
  const mouseX = (e.clientX - rect.left) * scaleX;
  const mouseY = (e.clientY - rect.top) * scaleY;

  const minFreq = 20, maxFreq = 20000, minDb = -32, maxDb = 32;
  const freqToX = (f) => {
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    return ((Math.log10(f) - logMin) / (logMax - logMin)) * eqCanvas.width;
  };
  const dbToY = (db) => eqCanvas.height - ((db - minDb) / (maxDb - minDb)) * eqCanvas.height;

  for (let i = 0; i < currentBands.length; i++) {
    const b = currentBands[i];
    const bx = freqToX(b.freq);
    const by = dbToY(b.gain + preampGain);
    const dist = Math.hypot(bx - mouseX, by - mouseY);
    if (dist < 16) {
      draggingNodeIndex = i;
      break;
    }
  }
});

window.addEventListener("mouseup", () => {
  draggingNodeIndex = null;
});

// ==========================================================================
// 4. Physical 10-Channel Rack UI Generator
// ==========================================================================

function renderChannelsGrid() {
  channelsContainer.innerHTML = "";

  currentBands.forEach((band, idx) => {
    const strip = document.createElement("div");
    strip.className = `channel-strip ${band.enabled ? "" : "disabled"}`;
    strip.id = `channelStrip_${idx}`;

    const freqDisplay = band.freq >= 1000 ? `${band.freq / 1000}k` : `${band.freq}`;

    strip.innerHTML = `
      <div class="channel-header">
        <span class="channel-index">CH ${idx + 1} &bull; ${band.label || ""}</span>
        <span class="channel-freq" id="freqLabel_${idx}">${freqDisplay} Hz</span>
        <select class="channel-type-select" id="typeSelect_${idx}">
          <option value="PK" ${band.type === "PK" ? "selected" : ""}>PK</option>
          <option value="LSQ" ${band.type === "LSQ" ? "selected" : ""}>LSQ</option>
          <option value="HSQ" ${band.type === "HSQ" ? "selected" : ""}>HSQ</option>
        </select>
      </div>

      <div class="slider-vertical-track-wrap">
        <input 
          type="range" 
          orient="vertical" 
          class="v-slider" 
          id="gainSlider_${idx}" 
          min="-30" 
          max="30" 
          step="0.1" 
          value="${band.gain}"
          title="Gain (double-click to zero)"
        />
      </div>

      <span class="channel-gain-val" id="gainVal_${idx}">${band.gain > 0 ? "+" : ""}${band.gain.toFixed(1)} dB</span>

      <div class="channel-q-row">
        <span class="channel-q-label">Q:</span>
        <input 
          type="number" 
          class="channel-q-input" 
          id="qInput_${idx}" 
          min="0.1" 
          max="10.0" 
          step="0.05" 
          value="${band.q.toFixed(2)}"
        />
      </div>

      <button class="btn-channel-mute" id="muteBtn_${idx}">
        ${band.enabled ? "ACTIVE" : "BYPASS"}
      </button>
    `;

    channelsContainer.appendChild(strip);

    const slider = strip.querySelector(`#gainSlider_${idx}`);
    const qInput = strip.querySelector(`#qInput_${idx}`);
    const typeSelect = strip.querySelector(`#typeSelect_${idx}`);
    const muteBtn = strip.querySelector(`#muteBtn_${idx}`);

    slider.addEventListener("input", (e) => {
      band.gain = parseFloat(e.target.value);
      updateBandUI(idx);
      drawFrequencyResponse();
      triggerAutoSync();
    });

    slider.addEventListener("dblclick", () => {
      band.gain = 0;
      slider.value = 0;
      updateBandUI(idx);
      drawFrequencyResponse();
      triggerAutoSync();
    });

    qInput.addEventListener("change", (e) => {
      band.q = Math.max(0.1, Math.min(10.0, parseFloat(e.target.value) || 1.00));
      drawFrequencyResponse();
      triggerAutoSync();
    });

    typeSelect.addEventListener("change", (e) => {
      band.type = e.target.value;
      drawFrequencyResponse();
      triggerAutoSync();
    });

    muteBtn.addEventListener("click", () => {
      band.enabled = !band.enabled;
      strip.classList.toggle("disabled", !band.enabled);
      muteBtn.textContent = band.enabled ? "ACTIVE" : "BYPASS";
      drawFrequencyResponse();
      triggerAutoSync();
    });
  });
}

function updateBandUI(idx) {
  const band = currentBands[idx];
  const slider = document.getElementById(`gainSlider_${idx}`);
  const gainVal = document.getElementById(`gainVal_${idx}`);
  const freqLabel = document.getElementById(`freqLabel_${idx}`);
  const qInput = document.getElementById(`qInput_${idx}`);
  const typeSelect = document.getElementById(`typeSelect_${idx}`);

  if (slider) slider.value = band.gain;
  if (gainVal) gainVal.textContent = `${band.gain > 0 ? "+" : ""}${band.gain.toFixed(1)} dB`;
  if (freqLabel) freqLabel.textContent = `${band.freq >= 1000 ? (band.freq / 1000).toFixed(1) + "k" : band.freq} Hz`;
  if (qInput) qInput.value = band.q.toFixed(2);
  if (typeSelect) typeSelect.value = band.type;
}

function updateAllBandsUI() {
  for (let i = 0; i < currentBands.length; i++) {
    updateBandUI(i);
  }
}

// ==========================================================================
// 5. Presets, Categories & Import / Export
// ==========================================================================

// --- Custom Presets Engine (localStorage) ---
const CUSTOM_STORAGE_KEY = "jm98max_custom_presets";

function loadCustomPresets() {
  try {
    const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[JM98MAX] Corrupted custom presets in localStorage, falling back to empty:", err);
    return [];
  }
}

function saveCustomPreset(name, bands, preamp) {
  const trimmedName = (name || "").trim().slice(0, 24);
  if (!trimmedName) return null;

  const presets = loadCustomPresets();
  const id = "custom_" + Date.now();

  const bandSnapshot = bands.map((b) => ({
    index: b.index,
    freq: b.freq,
    gain: b.gain,
    q: b.q,
    type: b.type,
    enabled: b.enabled !== false
  }));

  // If the user saved while in LOUD mode, the current preamp slider is already the half value.
  // The safe preamp ceiling is preamp * 2. If in SAFE mode, preamp is already the safe ceiling.
  const safePreamp = headroomMode === "dynamic" ? Math.round((preamp * 2) * 2) / 2 : preamp;
  const loudPreamp = Math.round((safePreamp / 2) * 2) / 2;

  const existingIdx = presets.findIndex((p) => p.name.toLowerCase() === trimmedName.toLowerCase());
  const newPreset = {
    id: existingIdx >= 0 ? presets[existingIdx].id : id,
    name: trimmedName,
    category: "custom",
    preamp: safePreamp,
    dynamicPreamp: loudPreamp,
    createdAt: Date.now(),
    bands: bandSnapshot
  };

  if (existingIdx >= 0) {
    presets[existingIdx] = newPreset;
  } else {
    if (presets.length >= 50) presets.shift(); // Cap at 50 profiles
    presets.push(newPreset);
  }

  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(presets));
  } catch (err) {
    console.error("[JM98MAX] Could not save preset to localStorage:", err);
    return null;
  }

  return newPreset;
}

function deleteCustomPreset(id) {
  const presets = loadCustomPresets();
  const filtered = presets.filter((p) => p.id !== id);
  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error("[JM98MAX] Could not delete preset from localStorage:", err);
  }
  return filtered;
}

function openSaveModal() {
  if (!savePresetModal) return;
  if (saveModalPreampVal) {
    saveModalPreampVal.textContent = `${preampGain > 0 ? "+" : ""}${preampGain.toFixed(1)} dB`;
  }
  if (savePresetNameInput) {
    savePresetNameInput.value = "";
  }
  savePresetModal.style.display = "flex";
  setTimeout(() => savePresetNameInput && savePresetNameInput.focus(), 60);
}

function closeSaveModal() {
  if (!savePresetModal) return;
  savePresetModal.style.display = "none";
}

function handleConfirmSave() {
  if (!savePresetNameInput) return;
  const name = savePresetNameInput.value.trim();
  if (!name) {
    savePresetNameInput.focus();
    return;
  }

  const saved = saveCustomPreset(name, currentBands, preampGain);
  if (saved) {
    closeSaveModal();
    activeCategory = "custom";
    applyPreset(saved.id);
    showStatusAlert(`Saved preset "${saved.name}" to storage`, "success");
  }
}

function renderPresetPills(category) {
  presetPillsContainer.innerHTML = "";

  if (category === "custom") {
    const customPresets = loadCustomPresets();
    if (customPresets.length === 0) {
      const hint = document.createElement("span");
      hint.className = "empty-preset-hint";
      hint.textContent = "No custom presets yet. Tune your EQ and click \"+ Save Preset\".";
      presetPillsContainer.appendChild(hint);
      return;
    }

    customPresets.forEach((preset) => {
      const pill = document.createElement("button");
      pill.className = `pill-btn custom-pill ${preset.id === activePresetKey ? "active" : ""}`;
      pill.dataset.preset = preset.id;

      const label = document.createElement("span");
      label.className = "pill-label";
      label.textContent = preset.name;
      pill.appendChild(label);

      const delBtn = document.createElement("span");
      delBtn.className = "pill-del-btn";
      delBtn.innerHTML = `<svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="2" y1="2" x2="8" y2="8"></line><line x1="8" y1="2" x2="2" y2="8"></line></svg>`;
      delBtn.title = `Delete "${preset.name}"`;
      delBtn.dataset.delId = preset.id;
      delBtn.setAttribute("role", "button");
      delBtn.setAttribute("aria-label", `Delete ${preset.name}`);
      pill.appendChild(delBtn);

      presetPillsContainer.appendChild(pill);
    });
    return;
  }

  Object.entries(XBEAST_PRESETS).forEach(([key, preset]) => {
    if (preset.category !== category) return;

    const pill = document.createElement("button");
    pill.className = `pill-btn ${key === activePresetKey ? "active" : ""}`;
    pill.dataset.preset = key;
    pill.textContent = preset.name;
    presetPillsContainer.appendChild(pill);
  });
}

function updateHeadroomButtonsUI() {
  if (!btnHeadroomDynamic || !btnHeadroomStrict) return;
  btnHeadroomDynamic.classList.toggle("active", headroomMode === "dynamic");
  btnHeadroomStrict.classList.toggle("active", headroomMode === "strict");
}

function getPresetPreamp(preset, mode = headroomMode) {
  if (!preset) return preampGain;
  const safeDb = typeof preset.preamp === "number" ? preset.preamp : 0.0;
  if (mode === "strict") return safeDb;
  // LOUD mode: exactly half of safe preamp dB (e.g. -11 dB -> -5.5 dB)
  return Math.round((safeDb / 2) * 2) / 2;
}

function updateHeadroomLabels() {
  let preset = null;
  if (activePresetKey && activePresetKey.startsWith("custom_")) {
    const customList = loadCustomPresets();
    preset = customList.find((p) => p.id === activePresetKey);
  } else if (activePresetKey) {
    preset = XBEAST_PRESETS[activePresetKey];
  }

  const str = preset && typeof preset.preamp === "number"
    ? preset.preamp
    : (headroomMode === "strict" ? preampGain : Math.round((preampGain * 2) * 2) / 2);
  const dyn = Math.round((str / 2) * 2) / 2;

  if (headroomDynamicVal) headroomDynamicVal.textContent = `${dyn > 0 ? "+" : ""}${dyn.toFixed(1)} dB`;
  if (headroomStrictVal) headroomStrictVal.textContent = `${str > 0 ? "+" : ""}${str.toFixed(1)} dB`;
}

function setHeadroomMode(mode) {
  headroomMode = mode;
  localStorage.setItem("jm98max_headroom_mode", mode);
  updateHeadroomButtonsUI();

  let preset = null;
  if (activePresetKey && activePresetKey.startsWith("custom_")) {
    const customList = loadCustomPresets();
    preset = customList.find((p) => p.id === activePresetKey);
  } else if (activePresetKey) {
    preset = XBEAST_PRESETS[activePresetKey];
  }

  if (preset) {
    preampGain = getPresetPreamp(preset, mode);
  } else {
    // If no preset active, halve or double based on direction
    if (mode === "dynamic") {
      preampGain = Math.round((preampGain / 2) * 2) / 2;
    } else {
      preampGain = Math.round((preampGain * 2) * 2) / 2;
    }
  }

  preampSlider.value = preampGain;
  preampVal.textContent = `${preampGain > 0 ? "+" : ""}${preampGain.toFixed(1)} dB`;
  updateHeadroomLabels();
  drawFrequencyResponse();
  triggerAutoSync();
}

function applyPreset(presetKey) {
  let preset = null;
  let isCustom = false;

  if (presetKey.startsWith("custom_")) {
    const customList = loadCustomPresets();
    preset = customList.find((p) => p.id === presetKey);
    isCustom = true;
  } else {
    preset = XBEAST_PRESETS[presetKey];
  }

  if (!preset) return;

  activePresetKey = presetKey;
  activeCategory = isCustom ? "custom" : preset.category;

  if (isCustom && preset.bands) {
    preset.bands.forEach((b, i) => {
      if (currentBands[i]) {
        currentBands[i].freq = b.freq;
        currentBands[i].type = b.type;
        currentBands[i].q = b.q;
        currentBands[i].gain = b.gain;
        currentBands[i].enabled = b.enabled !== false;
      }
    });
    preampGain = getPresetPreamp(preset, headroomMode);
    renderChannelsGrid();
  } else {
    // Apply factory frequencies, Q, shapes, and gains
    currentBands.forEach((b, i) => {
      b.freq = DEFAULT_BANDS[i].freq;
      b.type = DEFAULT_BANDS[i].type;
      b.q = 1.00;
      b.gain = preset.gains[i] ?? 0;
      b.enabled = true;
    });

    // Apply listening preamp headroom based on active headroomMode (exact half in LOUD)
    preampGain = getPresetPreamp(preset, headroomMode);
    updateAllBandsUI();
  }

  preampSlider.value = preampGain;
  preampVal.textContent = `${preampGain > 0 ? "+" : ""}${preampGain.toFixed(1)} dB`;

  updateHeadroomLabels();
  updateHeadroomButtonsUI();

  drawFrequencyResponse();
  triggerAutoSync();

  // Update pills and category tabs
  renderPresetPills(activeCategory);
  document.querySelectorAll(".cat-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.cat === activeCategory);
  });
}

function parseAutoEqText(text) {
  const lines = text.split("\n");
  let newPreamp = preampGain;
  const parsedFilters = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const preampMatch = trimmed.match(/Preamp:\s*([+-]?\d+(?:\.\d+)?)\s*dB/i);
    if (preampMatch) {
      newPreamp = parseFloat(preampMatch[1]);
      continue;
    }

    const filterMatch = trimmed.match(/Filter\s*\d+:\s*(ON|OFF)\s*(PK|LSQ|HSQ|LS|HS)\s*Fc\s*(\d+(?:\.\d+)?)\s*Hz\s*Gain\s*([+-]?\d+(?:\.\d+)?)\s*dB\s*Q\s*(\d+(?:\.\d+)?)/i);
    if (filterMatch) {
      const enabled = filterMatch[1].toUpperCase() === "ON";
      let type = filterMatch[2].toUpperCase();
      if (type === "LS") type = "LSQ";
      if (type === "HS") type = "HSQ";
      const freq = parseFloat(filterMatch[3]);
      const gain = parseFloat(filterMatch[4]);
      const q = parseFloat(filterMatch[5]);

      parsedFilters.push({ enabled, type, freq, gain, q });
    }
  }

  if (parsedFilters.length === 0) {
    alert("Could not find any standard parametric filters in the pasted text.");
    return;
  }

  for (let i = 0; i < Math.min(10, parsedFilters.length); i++) {
    currentBands[i].freq = parsedFilters[i].freq;
    currentBands[i].gain = Math.max(-30, Math.min(30, parsedFilters[i].gain));
    currentBands[i].q = parsedFilters[i].q;
    currentBands[i].type = parsedFilters[i].type;
    currentBands[i].enabled = parsedFilters[i].enabled;
  }

  const importedSafe = Math.max(-32, Math.min(15, newPreamp));
  preampGain = headroomMode === "dynamic" ? Math.round((importedSafe / 2) * 2) / 2 : importedSafe;
  preampSlider.value = preampGain;
  preampVal.textContent = `${preampGain > 0 ? "+" : ""}${preampGain.toFixed(1)} dB`;
  activePresetKey = null;
  updateHeadroomLabels();

  renderChannelsGrid();
  drawFrequencyResponse();
  triggerAutoSync();
  closeImportModal();
}

function exportConfigJson() {
  const data = {
    model: "JCALLY JM98MAX",
    dacChip: "Cirrus Logic CS43198",
    preampGain: preampGain,
    bands: currentBands
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `JM98MAX_PEQ_Profile_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==========================================================================
// 6. Device Connection (WebHID)
// ==========================================================================

async function connectDac() {
  if (!navigator.hid) {
    alert("WebHID is not supported in this browser. Please use Chrome, Brave, Edge, or Arc.");
    return;
  }

  try {
    const devices = await navigator.hid.requestDevice({
      filters: USB_TARGET_FILTERS
    });

    if (devices.length === 0) return;

    let chosenDevice = devices[0];
    for (const d of devices) {
      if (d.collections && d.collections.some(c => c.usagePage === 0xff01 || c.reportIds?.includes(SAVI_CONSTANTS.REPORT_ID))) {
        chosenDevice = d;
        break;
      }
    }

    if (!chosenDevice.opened) {
      await chosenDevice.open();
    }

    activeDevice = chosenDevice;
    setDeviceStatus(true, chosenDevice);
    showStatusAlert("Connected: " + (chosenDevice.productName || "JM98MAX"), "success");

    syncAllBandsToDacRam();
  } catch (err) {
    console.error("[JM98MAX] Connection error:", err);
    showStatusAlert("Connection error: " + err.message, "error");
  }
}

function setDeviceStatus(connected, device = null) {
  if (connected && device) {
    deviceStatusPill.classList.add("connected");
    statusState.textContent = (device.productName || "JM98MAX").toUpperCase();
    statusDetails.textContent = `VID 0x${device.vendorId.toString(16).padStart(4, "0")} &bull; PID 0x${device.productId.toString(16).padStart(4, "0")}`;
    btnConnectText.textContent = "Disconnect";
  } else {
    deviceStatusPill.classList.remove("connected");
    statusState.textContent = "DISCONNECTED";
    statusDetails.textContent = "VID 0x0666 &bull; PID 0x0881";
    btnConnectText.textContent = "Connect DAC";
    activeDevice = null;
  }
}

function showStatusAlert(msg, type = "info") {
  console.log(`[JM98MAX] [${type}] ${msg}`);
}

function openImportModal() { importModal.style.display = "flex"; }
function closeImportModal() { importModal.style.display = "none"; }

// ==========================================================================
// 6. Anti-Sleep Keep-Alive Engine (0ms Instant Playback)
// ==========================================================================

let antiSleepCtx = null;
let antiSleepSource = null;

function enableAntiSleep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    if (!antiSleepCtx) {
      antiSleepCtx = new AudioCtx();
    }
    if (antiSleepCtx.state === "suspended") {
      antiSleepCtx.resume();
    }
    if (antiSleepSource) {
      try { antiSleepSource.stop(); antiSleepSource.disconnect(); } catch (e) {}
      antiSleepSource = null;
    }

    // 1-second looping buffer of alternating sub-LSB impulses (-114 dBFS at Nyquist).
    // Physically inaudible to human ears on any IEM, but continuously provides non-zero samples
    // to the Cirrus Logic CS43198 Zero-Detect Auto-Mute circuit. Keeps the analog stage 100% active
    // and eliminates the half-second delay or soft-ramp fade-in when starting audio.
    const sampleRate = antiSleepCtx.sampleRate || 48000;
    const buffer = antiSleepCtx.createBuffer(1, sampleRate, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleRate; i++) {
      data[i] = (i % 2 === 0 ? 1 : -1) * 0.000002;
    }

    antiSleepSource = antiSleepCtx.createBufferSource();
    antiSleepSource.buffer = buffer;
    antiSleepSource.loop = true;
    antiSleepSource.connect(antiSleepCtx.destination);
    antiSleepSource.start();
    showStatusAlert("Anti-Sleep active: DAC output stage will stay awake with 0ms instant playback", "info");
  } catch (err) {
    console.warn("[JM98MAX] Anti-Sleep initialization error:", err);
  }
}

function disableAntiSleep() {
  if (antiSleepSource) {
    try {
      antiSleepSource.stop();
      antiSleepSource.disconnect();
    } catch (e) {}
    antiSleepSource = null;
  }
  if (antiSleepCtx && antiSleepCtx.state === "running") {
    try {
      antiSleepCtx.suspend();
    } catch (e) {}
  }
  showStatusAlert("Anti-Sleep disabled", "info");
}

function setAntiSleep(enabled) {
  antiSleepEnabled = enabled;
  localStorage.setItem("jm98max_anti_sleep", enabled ? "true" : "false");
  if (antiSleepCheck) antiSleepCheck.checked = enabled;

  if (enabled) {
    enableAntiSleep();
  } else {
    disableAntiSleep();
  }
}

// ==========================================================================
// 7. Initialization & Event Wire-Up
// ==========================================================================

function initApp() {
  renderChannelsGrid();
  renderPresetPills(activeCategory);
  applyPreset(activePresetKey);

  // Initialize Headroom Selector
  updateHeadroomLabels();
  updateHeadroomButtonsUI();

  if (btnHeadroomDynamic) {
    btnHeadroomDynamic.addEventListener("click", () => setHeadroomMode("dynamic"));
  }
  if (btnHeadroomStrict) {
    btnHeadroomStrict.addEventListener("click", () => setHeadroomMode("strict"));
  }

  // Connect Button
  btnConnect.addEventListener("click", () => {
    if (antiSleepEnabled) enableAntiSleep();
    if (activeDevice) {
      activeDevice.close();
      setDeviceStatus(false);
    } else {
      connectDac();
    }
  });

  // Anti-Sleep Toggle & Keep-Alive event wiring
  if (antiSleepCheck) {
    antiSleepCheck.checked = antiSleepEnabled;
    antiSleepCheck.addEventListener("change", (e) => {
      setAntiSleep(e.target.checked);
    });
  }

  // Resume Web Audio Keep-Alive on first user interaction if enabled
  window.addEventListener("click", () => {
    if (antiSleepEnabled && (!antiSleepCtx || antiSleepCtx.state !== "running")) {
      enableAntiSleep();
    }
  }, { once: true });

  // Preamp slider
  preampSlider.addEventListener("input", (e) => {
    preampGain = parseFloat(e.target.value);
    preampVal.textContent = `${preampGain > 0 ? "+" : ""}${preampGain.toFixed(1)} dB`;
    drawFrequencyResponse();
    triggerAutoSync();
  });

  // Auto-sync toggle
  autoSyncCheck.addEventListener("change", (e) => {
    autoSyncEnabled = e.target.checked;
  });

  // Sync to RAM button
  btnSyncRam.addEventListener("click", () => {
    syncAllBandsToDacRam();
  });

  // Reset Flat button
  btnResetCurve.addEventListener("click", () => {
    applyPreset("flat");
  });

  // Category Tabs click
  categoryTabs.addEventListener("click", (e) => {
    const tab = e.target.closest(".cat-tab");
    if (!tab) return;
    activeCategory = tab.dataset.cat;
    document.querySelectorAll(".cat-tab").forEach(t => t.classList.toggle("active", t === tab));
    renderPresetPills(activeCategory);
  });

  // Preset Pills click & deletion handling
  presetPillsContainer.addEventListener("click", (e) => {
    const delBtn = e.target.closest(".pill-del-btn");
    if (delBtn) {
      e.stopPropagation();
      const id = delBtn.dataset.delId;
      const customPresets = loadCustomPresets();
      const targetPreset = customPresets.find(p => p.id === id);
      const name = targetPreset ? targetPreset.name : "this preset";
      if (confirm(`Delete custom preset "${name}"?`)) {
        deleteCustomPreset(id);
        if (activePresetKey === id) {
          applyPreset("iem-punchy");
        } else {
          renderPresetPills("custom");
        }
        showStatusAlert(`Deleted preset "${name}"`, "info");
      }
      return;
    }

    const pill = e.target.closest(".pill-btn");
    if (pill && pill.dataset.preset) {
      applyPreset(pill.dataset.preset);
    }
  });

  // Modal Handlers (Import & Export)
  btnAutoEqImport.addEventListener("click", openImportModal);
  btnCloseModal.addEventListener("click", closeImportModal);
  btnCancelModal.addEventListener("click", closeImportModal);
  btnApplyImport.addEventListener("click", () => {
    parseAutoEqText(importTextArea.value);
  });
  btnExportJson.addEventListener("click", exportConfigJson);

  // Save Custom Preset Modal Handlers
  if (btnOpenSaveModal) btnOpenSaveModal.addEventListener("click", openSaveModal);
  if (btnCloseSaveModal) btnCloseSaveModal.addEventListener("click", closeSaveModal);
  if (btnCancelSaveModal) btnCancelSaveModal.addEventListener("click", closeSaveModal);
  if (btnConfirmSavePreset) btnConfirmSavePreset.addEventListener("click", handleConfirmSave);
  if (savePresetNameInput) {
    savePresetNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirmSave();
      }
    });
  }

  // Keyboard Escape listener for modals
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeImportModal();
      closeSaveModal();
    }
  });

  // Resize listener
  window.addEventListener("resize", () => {
    drawFrequencyResponse();
  });

  // WebHID auto-detect
  if (navigator.hid) {
    navigator.hid.getDevices().then((devices) => {
      const match = devices.find(d => 
        (d.vendorId === 0x0666 && d.productId === 0x0881) || 
        d.vendorId === 0x0661 || 
        d.vendorId === 0x0666
      );
      if (match) {
        match.open().then(() => {
          activeDevice = match;
          setDeviceStatus(true, match);
        }).catch(() => {});
      }
    });

    navigator.hid.addEventListener("disconnect", (e) => {
      if (activeDevice && e.device === activeDevice) {
        setDeviceStatus(false);
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", initApp);
