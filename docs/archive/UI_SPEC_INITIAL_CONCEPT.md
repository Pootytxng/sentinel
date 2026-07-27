> **Historical initial concept — not authoritative for the live app.** Its React, Tailwind,
> Lucide, Zustand, Framer Motion, Recharts stack and its proposed layout are preserved for
> historical context only.

---

# Frontend UI/UX Specification: PC Optimizer Desktop App

## 1. Tech Stack & Core Libraries
* **Framework:** React 18+ with TypeScript (running within Tauri 2).
* **Styling:** Tailwind CSS (configured for an aggressive dark-mode-only setup).
* **UI Components:** `shadcn/ui` (Radix UI primitives).
* **Icons:** `lucide-react`.
* **State Management:** Zustand (for lightweight global state, hardware telemetry polling, and rule toggles).
* **Animations:** `framer-motion` (for page transitions, micro-interactions, and hardware telemetry value ticks).
* **Charts/Graphs:** `recharts` (for CPU, GPU, frametime, and FPS telemetry visualization).

## 2. Design System & Theming
The app must feel like a premium, system-level tool. It should look like a cross between a Vercel analytics dashboard and high-end enthusiast gaming software. No bulky "antivirus" aesthetics.

* **Color Palette:**
    * **App Background:** `bg-zinc-950` (#09090b)
    * **Surface/Card Background:** `bg-zinc-900` (#18181b) with a subtle `border-zinc-800` outline.
    * **Primary Accent:** `text-emerald-500` (for safe, positive actions/metrics) and `text-blue-500` (for active optimization states).
    * **Warning/Rollback Accent:** `text-amber-500` (for manual mutations, warnings, or reverting changes).
    * **Text (Primary):** `text-zinc-50` (white/off-white).
    * **Text (Muted):** `text-zinc-400` (for secondary labels and telemetry axes).
* **Typography:** * **UI Elements:** Inter, Geist Sans, or system-ui. 
    * **Telemetry:** Monospace (JetBrains Mono or Geist Mono) is STRICTLY REQUIRED for all hardware values (FPS, temperatures, RAM timings, ping) to prevent layout shifting when numbers update rapidly.
* **Window Behavior:** Custom frameless window. The top navigation bar must include the Tauri `data-tauri-drag-region` attribute so the user can drag the window naturally.

## 3. Global Layout Architecture
A three-pane layout designed for dense, scannable information without visual clutter.

* **Left Sidebar (Navigation):** Fixed width (e.g., `w-64`), border-r `border-zinc-800`. Minimalist icon + text links. Uses a subtle background glow or left-border highlight to indicate the active route.
* **Top Bar (Global Status):** * Contains the custom window controls (minimize, maximize, close).
    * A global "System Status" indicator badge (e.g., "Elevated / UAC Active" or "Standard Mode").
    * A persistent, quick-action "Global Rollback / Safety Revert" button in the top right.
* **Main Content Area:** A scrollable container holding the active view, utilizing a responsive CSS grid (`grid-cols-12`) for card layouts to maintain alignment across different window sizes.

## 4. Core Views & Module Specifications

### A. Dashboard / Monitoring (The Landing Page)
* **Hero Section:** A sleek visual indicator of current system health and the active optimization profile.
* **Telemetry Grid (Live Data):**
    * **FPS & Frametime:** Large typography cards highlighting 1% lows and average FPS.
    * **Hardware Sensors:** CPU and GPU usage, temperature, and clock speeds visualized using minimal area charts (`recharts`) with smooth bezier curves and gradient fills fading into the background.
    * **System/Network:** Live ping, input latency metrics, and memory allocation bars.

### B. Optimizer / Recommendations (The Core Engine)
* **Layout:** A masonry grid or a structured master-detail list of optimization rules (e.g., Windows tweaks, CPU affinity/priority overrides, registry mutations).
* **Rule Cards:** Each actionable item must be contained in a card featuring:
    * Title and a concise technical description.
    * Status badge (Active, Inactive, Pending Verification).
    * **Crucial Mechanics:** A distinct "Apply" and "Rollback" button structure. The UI must heavily emphasize safety—modifications must look easily reversible.
* **Action Drawer:** Clicking a complex rule opens a sliding right-hand drawer (using shadcn `Sheet`) detailing the exact technical execution (e.g., which specific registry keys, services, or configurations are being mutated).

### C. Diagnostics & Hardware
* **System Profiler:** A highly structured, data-dense table displaying current motherboard, BIOS version, CPU, GPU, and memory configurations.
* **Deep Scan Action:** A prominent button that triggers a system-wide diagnostic fetch. When clicked, replace the table with a loading skeleton and scanning text (e.g., "Verifying rule states...", "Checking remote signatures...", "Polling hardware sensors...").

### D. History & Ledger
* **Event Timeline:** A vertical timeline (using a `framer-motion` staggered list) of every mutation and optimization applied to the system.
* **Ledger Entries:** Each item must show the timestamp, the specific module/rule affected, and include an explicit "Undo/Rollback" button directly next to historical actions.

## 5. Micro-Interactions & Polish
* **Hover States:** Subtle `bg-zinc-800` transitions on rule cards. Primary action buttons should have a 1px border glow (`box-shadow`) inheriting the accent color on hover.
* **Loading States:** Use `animate-pulse` on dark gray skeleton blocks while waiting for native Rust/hardware fetches on initial load. No infinite spinners.
* **Toasts:** Use shadcn `Toast` notifications anchored to the bottom right for background task completions (e.g., "Successfully elevated process," "Rollback completed", "Telemetry captured").
