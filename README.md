# JM98MAX Studio

Hardware-level 10-band parametric equalizer (PEQ) and real-time DSP tuning suite for the **JCALLY JM98MAX** USB DAC.

Built on the native HTML5 WebHID API and Robert Bristow-Johnson (RBJ) biquad filter mathematics. Runs entirely in browser (Chrome, Brave, Edge, Arc) with zero external dependencies, no build steps, and no drivers required.

---

## Hardware Topology

The JCALLY JM98MAX combines a dedicated USB bridge/DSP controller with a high-performance DAC and dual operational amplifier stage:

```
[ Host: macOS / Windows / Linux / Android ]
                     │
                     ▼ (USB Audio Class 2.0 — PCM up to 768 kHz / 32-bit)
┌────────────────────────────────────────────────────────────────────────┐
│  Savitech USB Bridge Controller (WalkPlay DSP Architecture)            │
│  USB VID: 0x0666 | PID: 0x0881 | Device String: JM98MAX                │
│                                                                        │
│  ├─ Interface 0 (HID): Vendor Usage Page 0xFF01, Report ID 0x4B (75)   │
│  │     └─ 10-Band Biquad Hardware Filter Engine (96 kHz, Q30 Format)   │
│  │                                                                     │
│  ├─ Active DSP RAM (Volatile Working Registers)                        │
│  │     └─ Live coefficient latch buffer for real-time filtering        │
│  │                                                                     │
│  └─ SPI Flash (Non-Volatile Parameter Memory)                          │
│        └─ Factory preset jump table (3 profiles) & hardware button map │
└────────────────────────────────────────────────────────────────────────┘
                     │ (I2S Digital Audio Stream)
                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Cirrus Logic CS43198 Master DAC Chip                                  │
│  ├─ 32-bit Master Hi-Fi conversion stage (125 dB Dynamic Range)        │
│  └─ THD+N: 0.0003% (-115 dB)                                           │
└────────────────────────────────────────────────────────────────────────┘
                     │ (Differential Analog Audio)
                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│  SGMicro SGM8262 Dual Low-Noise Operational Amplifier                  │
│  └─ High-output drive stage (~195 mW @ 32Ω, ~0.65Ω output impedance)   │
└────────────────────────────────────────────────────────────────────────┘
                     │
                     ▼
             [ 3.5mm SE Output ]
```

> **Acoustic Note:** The Cirrus Logic CS43198 DAC chip features an on-chip 7th-order filter (3 biquads + 1 first-order). The 10-band parametric EQ operates entirely inside the **Savitech bridge DSP pipeline** prior to sending the reconstructed I2S stream to the DAC chip.

---

## Memory Architecture & Hardware Safety

### The Problem with Generic PEQ Tools
Generic WebHID controllers (such as *Audiocular-Aura*) were built for single-profile DACs. When a user clicks **"Save to Flash"** or **"Factory Reset"** in those tools, the software issues a flash overwrite opcode (`[0x01, 0x01, 0x01, 0x00, 0x00]`). 

On the JM98MAX, this command overwrites the parameter sector of the SPI flash memory, destroying:
1. The 3 factory preset lookup tables: **Original/Balanced** (Yellow LED), **Low-Frequency Boost** (Blue LED), and **High-Frequency Boost** (Cyan/White LED).
2. The hardware interrupt and state machine controlling the **physical side button and profile LED**.

Once overwritten, the physical button stops cycling profiles, and the official JCALLY firmware flasher (`odt_usb_downloader`) cannot repair it because it only rewrites the 160 KB CPU code area (`0x48000000`), leaving the corrupted DSP parameter sector untouched.

### The JM98MAX Studio Solution: RAM-First Architecture
JM98MAX Studio uses a strict **volatile RAM synchronization pipeline**:

* **How it writes:** Filter coefficients are transmitted directly into the Savitech DSP's active operational registers via Report ID `0x4B` (`75`) followed by the RAM commit latch sequence `[0x01, 0x0A, 0x04, 0x00, 0x00, 0xFF, 0xFF]` and `[0x01, 0x01, 0x00]`.
* **Zero Brick Risk:** Flash overwrite opcodes are completely excluded from the codebase. The physical button, LED indicator, and factory presets remain completely untouched.
* **Instant Verification:** Audio adjustments take effect immediately in real time while media is playing.
* **Two Ways to Reset:**
  1. **Software Reset (Instant):** Click **Flat Reset** on the interface to write `0.0 dB` neutral coefficients across all 10 bands without disconnecting.
  2. **Hardware Power Cycle:** Disconnect the USB-C cable. Because RAM is volatile, disconnecting power completely clears the custom EQ registers and returns the DAC to factory stock state.

---

## DSP Mathematics & Precision

### Biquad Filter Computation
Every band is computed using the Robert Bristow-Johnson (RBJ) Audio EQ Cookbook at a fixed hardware DSP rate of $f_s = 96,000\text{ Hz}$.

* **Filter Shapes Supported:** Peaking (`PK`), Low Shelf (`LSQ`), High Shelf (`HSQ`), and Notch (`NOTCH`).
* **Fixed-Point Encoding:** Normalized coefficients ($\frac{b_0}{a_0}, \frac{b_1}{a_0}, \frac{b_2}{a_0}, -\frac{a_1}{a_0}, -\frac{a_2}{a_0}$) are converted to **Q2.30 signed fixed-point integers** ($2^{30} = 1,073,741,824$) in little-endian format. The Savitech DSP hardware strictly requires negated feedback poles ($-a_1, -a_2$).

### Saturating Protection & Pro-Q Dynamic Range
* **$\pm 30\text{ dB}$ Dynamic Range:** Faders support continuous adjustments from $-30.0\text{ dB}$ to $+30.0\text{ dB}$ with 0.1 dB step resolution, matching FabFilter Pro-Q standards.
* **Saturating Anti-Wrap Clamp:** In Q2.30 arithmetic, values exceeding $+1.9999$ wrap around to negative numbers in 32-bit two's complement. The studio implements an internal saturating clamp (`Math.max(-2147483648, Math.min(2147483647, raw))`) to guarantee filter stability and prevent sign-flip overflow during heavy low-frequency boosts.
* **Master Headroom Preamp:** Attenuation slider adjustable down to **$-32.0\text{ dB}$** to prevent digital clipping (`0 dBFS` overshoot) in the SGM8262 analog output stage.

---

## Integrated Presets: XBEAST Master DSP Suite

The studio includes the complete **XBEAST DSP Preset Suite** (Tier 2 Universal Static Specifications), pre-configured with exact $Q = 1.00$ biquad curves and listening preamps:

### 1. In-Ear Monitors (IEMs)
*Calibrated with acoustic protective treble cuts on 4 kHz and 8 kHz to eliminate close ear-canal sibilance and fatigue:*

| Band | Frequency | Filter Shape | Q Factor | Balanced | Punchy Bass | Heavy Bass | Extreme Sub-Bass |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Preamp** | — | Headroom | — | **`-9.0 dB`** | **`-11.0 dB`** | **`-14.0 dB`** | **`-22.0 dB`** |
| **1** | **32 Hz** | Low Shelf | `1.00` | `+2.6 dB` | `+4.3 dB` | `+12.0 dB` | `+15.0 dB` |
| **2** | **64 Hz** | Peak | `1.00` | `+6.9 dB` | `+9.0 dB` | `+12.0 dB` | `+20.0 dB` |
| **3** | **125 Hz** | Peak | `1.00` | `+5.7 dB` | `+6.5 dB` | `+12.0 dB` | `+17.0 dB` |
| **4** | **250 Hz** | Peak | `1.00` | `+1.3 dB` | `+1.3 dB` | `+1.3 dB` | `+1.3 dB` |
| **5** | **500 Hz** | Peak | `1.00` | `-2.2 dB` | `-2.2 dB` | `-2.2 dB` | `-2.2 dB` |
| **6** | **1,000 Hz** | Peak | `1.00` | `-1.5 dB` | `-1.5 dB` | `-1.5 dB` | `-1.5 dB` |
| **7** | **2,000 Hz** | Peak | `1.00` | `+2.3 dB` | `+2.3 dB` | `+2.3 dB` | `+2.3 dB` |
| **8** | **4,000 Hz** | Peak | `1.00` | **`-2.6 dB`** | **`-0.7 dB`** | **`+1.3 dB`** | **`+1.9 dB`** |
| **9** | **8,000 Hz** | Peak | `1.00` | **`-0.8 dB`** | **`-0.5 dB`** | **`+1.8 dB`** | **`+3.0 dB`** |
| **10** | **16,000 Hz** | High Shelf | `1.00` | `+3.8 dB` | `+3.8 dB` | `+3.8 dB` | `+3.8 dB` |

---

### 2. Over-Ear Headphones
*Calibrated with positive presence offsets on 4 kHz and 8 kHz to account for earcup acoustic diffusion and preserve vocal clarity:*

| Band | Frequency | Filter Shape | Q Factor | Balanced | Punchy Bass | Heavy Bass | Extreme Sub-Bass |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Preamp** | — | Headroom | — | **`-9.0 dB`** | **`-11.0 dB`** | **`-14.0 dB`** | **`-22.0 dB`** |
| **1** | **32 Hz** | Low Shelf | `1.00` | `+2.6 dB` | `+4.3 dB` | `+12.0 dB` | `+15.0 dB` |
| **2** | **64 Hz** | Peak | `1.00` | `+6.9 dB` | `+9.0 dB` | `+12.0 dB` | `+20.0 dB` |
| **3** | **125 Hz** | Peak | `1.00` | `+5.7 dB` | `+6.5 dB` | `+12.0 dB` | `+17.0 dB` |
| **4** | **250 Hz** | Peak | `1.00` | `+1.3 dB` | `+1.3 dB` | `+1.3 dB` | `+1.3 dB` |
| **5** | **500 Hz** | Peak | `1.00` | `-2.2 dB` | `-2.2 dB` | `-2.2 dB` | `-2.2 dB` |
| **6** | **1,000 Hz** | Peak | `1.00` | `-1.5 dB` | `-1.5 dB` | `-1.5 dB` | `-1.5 dB` |
| **7** | **2,000 Hz** | Peak | `1.00` | `+2.3 dB` | `+2.3 dB` | `+2.3 dB` | `+2.3 dB` |
| **8** | **4,000 Hz** | Peak | `1.00` | **`+0.2 dB`** | **`+0.9 dB`** | **`+2.7 dB`** | **`+2.7 dB`** |
| **9** | **8,000 Hz** | Peak | `1.00` | **`-0.2 dB`** | **`+1.0 dB`** | **`+3.0 dB`** | **`+3.0 dB`** |
| **10** | **16,000 Hz** | High Shelf | `1.00` | `+3.8 dB` | `+3.8 dB` | `+3.8 dB` | `+3.8 dB` |

---

4. Select a preset tab (**IEMs**, **Headphones**, **Custom**, or **Reference**) and click a preset pill.
5. Use the **Headroom Profile** toggle (**LOUD** vs **SAFE**) to quickly balance volume for everyday streaming music vs. strict studio test tones.
6. If **Auto-Sync** is active, adjustments immediately flash to the active DSP RAM.

### 3. Custom Presets & Local Storage
* **Saving Profiles:** Adjust any of the 10 channel sliders or preamp gain, then click **`+ Save Preset`**. Enter a custom name to store your tuning in browser `localStorage`.
* **Instant Switching:** Open the **Custom** category tab to browse and activate your stored presets. Switching triggers live WebHID RAM synchronization with zero latency.
* **Management & Deletion:** Click the `×` button on any custom preset pill to remove it from storage.

### 4. Importing Third-Party Presets
Click **Import AutoEq** to parse standard text profiles exported from AutoEQ, Squiglink, Oratory1990, Crinacle, or Peace EQ. Supported syntax:
```text
Preamp: -4.5 dB
Filter 1: ON PK Fc 32 Hz Gain 4.5 dB Q 1.41
Filter 2: ON LSQ Fc 105 Hz Gain 3.0 dB Q 0.71
...
```

---

## File Structure

```
JM98MAX-Studio/
├── index.html     # Semantic UI layout and WebHID controls
├── styles.css     # Obsidian & champagne gold audiophile aesthetic
├── app.js         # WebHID communication, RBJ DSP math, and canvas engine
├── favicon.svg    # Audiophile biquad response curve icon
└── README.md      # Technical architecture and user guide
```

---

## License

MIT License. Open-source audio engineering tool designed for portable DAC users and the audiophile community.
