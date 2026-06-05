//! AMD FreeSync (VRR) on/off read via hand-written ADLX display-side FFI.
//!
//! The `adlx` crate binds the System vtable (including `GetDisplaysServices`) but leaves
//! `IADLXDisplayServices` / `IADLXDisplayFreeSync` opaque. This module hand-defines just those
//! two display-side vtables — layouts taken verbatim from AMD's open-source ADLX header
//! `SDK/Include/IDisplays.h`. The display *list* is a plain `IADLXList`, so we reuse the crate's
//! binding for `Size` and the derived `At_DisplayList`.
//!
//! Read-only: no mutation, no elevation, no network — the same class of vendor-SDK read as every
//! other GPU sensor. (`SetEnabled` is deliberately NOT bound — a write would be a mutation feature
//! with its own consent + rollback contract.)
//!
//! # Safety / crash risk
//! A wrong vtable offset is undefined behaviour (an access violation). Mitigations:
//! 1. Offsets are taken verbatim from the ADLX header's method declaration order (the C++ pure-
//!    virtual order IS the vtable order). The `IADLXDisplayServices` order is: GetNumberOfDisplays,
//!    GetDisplays, Get3DLUT, GetGamut, GetGamma, **GetDisplayChangedHandling**, GetFreeSync — so
//!    GetFreeSync is slot [9] (after 3 base methods), not [8]. (That off-by-one method was the
//!    original crash: calling slot [8] — a one-out-param getter — wrote into the display pointer.)
//! 2. A **canary**: `GetNumberOfDisplays` (slot [3]) must return `ADLX_OK` with a sane count first.
//! 3. Every step fails soft to `None`, so the VRR readiness row falls back to the honest Phase-1
//!    advisory rather than fabricating a value.
//! 4. ADLX is single-threaded: this MUST run on the existing `amd_poller` thread, reusing that
//!    thread's `System` (never a second `AdlxHelper` — its `Drop` calls `ADLXTerminate`).

use adlx::ffi::{self, adlx_bool, adlx_uint, ADLX_RESULT};
use adlx::System;
use std::os::raw::c_void;

const ADLX_OK: ADLX_RESULT = ffi::ADLX_RESULT_ADLX_OK;
/// A real system has a handful of displays; a wildly large count means the vtable is misaligned.
const MAX_SANE_DISPLAYS: adlx_uint = 64;

// ── Hand-defined display-side interfaces ─────────────────────────────────────
// ADLX objects are COM-like: the first member is `*const Vtbl`, and every vtable begins with the
// three base methods Acquire[0] / Release[1] / QueryInterface[2] (matching the crate's
// IADLXInterfaceVtbl / IADLXListVtbl ordering), then the interface-specific methods. Slots we never
// call are typed as raw pointers so the layout (offsets) stays exact without binding them.

#[repr(C)]
struct DisplayServices {
    vtbl: *const DisplayServicesVtbl,
}

#[repr(C)]
struct DisplayServicesVtbl {
    _acquire: *const c_void,         // [0]
    _release: *const c_void,         // [1]
    _query_interface: *const c_void, // [2]
    get_number_of_displays:
        Option<unsafe extern "C" fn(*mut DisplayServices, *mut adlx_uint) -> ADLX_RESULT>, // [3]
    get_displays:
        Option<unsafe extern "C" fn(*mut DisplayServices, *mut *mut DisplayList) -> ADLX_RESULT>, // [4]
    _get_3dlut: *const c_void,                  // [5]
    _get_gamut: *const c_void,                  // [6]
    _get_gamma: *const c_void,                  // [7]
    _get_display_changed_handling: *const c_void, // [8] (one out-param — NOT FreeSync)
    // [9] GetFreeSync(IADLXDisplay*, IADLXDisplayFreeSync**) — the display ptr is the
    // IADLXInterface* handed back by At_DisplayList (same object).
    get_free_sync: Option<
        unsafe extern "C" fn(
            *mut DisplayServices,
            *mut ffi::IADLXInterface,
            *mut *mut DisplayFreeSync,
        ) -> ADLX_RESULT,
    >,
}

// IADLXDisplayList derives IADLXList. The base `At` (returning a generic `IADLXInterface**`) is
// rejected with ADLX_UNKNOWN_INTERFACE for typed lists, so we use the derived `At_DisplayList`
// (slot [11], returning `IADLXDisplay**`) — exactly how the `adlx` crate's GpuList uses At_GPUList.
#[repr(C)]
struct DisplayList {
    vtbl: *const DisplayListVtbl,
}

#[repr(C)]
struct DisplayListVtbl {
    _acquire: *const c_void,         // [0]
    _release: *const c_void,         // [1]
    _query_interface: *const c_void, // [2]
    size: Option<unsafe extern "C" fn(*mut DisplayList) -> adlx_uint>, // [3]
    _empty: *const c_void,           // [4]
    _begin: *const c_void,           // [5]
    _end: *const c_void,             // [6]
    _at_base: *const c_void,         // [7] base At — rejects typed access
    _clear: *const c_void,           // [8]
    _remove_back: *const c_void,     // [9]
    _add_back: *const c_void,        // [10]
    // [11] At_DisplayList(location, IADLXDisplay**). The display ptr doubles as an IADLXInterface*.
    at_display_list: Option<
        unsafe extern "C" fn(*mut DisplayList, adlx_uint, *mut *mut ffi::IADLXInterface) -> ADLX_RESULT,
    >,
}

#[repr(C)]
struct DisplayFreeSync {
    vtbl: *const DisplayFreeSyncVtbl,
}

#[repr(C)]
struct DisplayFreeSyncVtbl {
    _acquire: *const c_void,         // [0]
    _release: *const c_void,         // [1]
    _query_interface: *const c_void, // [2]
    is_supported: Option<unsafe extern "C" fn(*mut DisplayFreeSync, *mut adlx_bool) -> ADLX_RESULT>, // [3]
    is_enabled: Option<unsafe extern "C" fn(*mut DisplayFreeSync, *mut adlx_bool) -> ADLX_RESULT>, // [4]
    // SetEnabled [5] — intentionally unbound (write = mutation).
}

/// Release any ADLX object (Release is at vtable[1] for every interface — identical base layout).
unsafe fn release(obj: *mut ffi::IADLXInterface) {
    if obj.is_null() {
        return;
    }
    let vtbl = (*obj).pVtbl;
    if vtbl.is_null() {
        return;
    }
    if let Some(rel) = (*vtbl).Release {
        rel(obj);
    }
}

/// Read aggregate FreeSync state across all displays.
///
/// `Some(true)` = FreeSync enabled on at least one display; `Some(false)` = supported but off on at
/// least one display; `None` = couldn't determine (no support, an ADLX error, or the canary tripped)
/// → the readiness row falls back to the honest Phase-1 advisory.
///
/// Must be called on the `amd_poller` thread with that thread's `System`.
pub(crate) fn read_freesync(system: &System) -> Option<bool> {
    // `System` is `#[repr(transparent)]` over `*mut ffi::IADLXSystem`; pull the raw pointer out.
    let sys_raw: *mut ffi::IADLXSystem = unsafe { std::mem::transmute_copy(system) };
    if sys_raw.is_null() {
        return None;
    }
    unsafe {
        let sys_vtbl = (*sys_raw).pVtbl;
        if sys_vtbl.is_null() {
            return None;
        }
        let get_disp_services = (*sys_vtbl).GetDisplaysServices?;
        let mut services: *mut ffi::IADLXDisplayServices = std::ptr::null_mut();
        if get_disp_services(sys_raw, &mut services) != ADLX_OK || services.is_null() {
            return None;
        }
        let services = services as *mut DisplayServices;
        let result = read_from_services(services);
        release(services as *mut ffi::IADLXInterface);
        result
    }
}

/// Inner read once the display-services interface is held (caller releases it).
unsafe fn read_from_services(services: *mut DisplayServices) -> Option<bool> {
    let vtbl = (*services).vtbl;
    if vtbl.is_null() {
        return None;
    }
    let dsv = &*vtbl;

    // Canary: GetNumberOfDisplays must succeed with a sane count before we touch GetFreeSync.
    let get_n = dsv.get_number_of_displays?;
    let mut n: adlx_uint = 0;
    if get_n(services, &mut n) != ADLX_OK || n == 0 || n > MAX_SANE_DISPLAYS {
        return None;
    }

    let get_displays = dsv.get_displays?;
    let mut list: *mut DisplayList = std::ptr::null_mut();
    if get_displays(services, &mut list) != ADLX_OK || list.is_null() {
        return None;
    }
    let result = aggregate(services, dsv, list);
    release(list as *mut ffi::IADLXInterface);
    result
}

/// Walk the display list, query FreeSync per display, and aggregate (caller releases the list).
unsafe fn aggregate(
    services: *mut DisplayServices,
    dsv: &DisplayServicesVtbl,
    list: *mut DisplayList,
) -> Option<bool> {
    let list_vtbl = (*list).vtbl;
    if list_vtbl.is_null() {
        return None;
    }
    let lv = &*list_vtbl;
    let size = (lv.size?)(list);
    let at = lv.at_display_list?;
    let get_free_sync = dsv.get_free_sync?;

    let mut any_enabled = false;
    let mut any_supported = false;
    for i in 0..size {
        let mut item: *mut ffi::IADLXInterface = std::ptr::null_mut();
        if at(list, i, &mut item) != ADLX_OK || item.is_null() {
            continue;
        }
        // `item` IS the IADLXDisplay (same pointer, base interface).
        let mut fs: *mut DisplayFreeSync = std::ptr::null_mut();
        if get_free_sync(services, item, &mut fs) == ADLX_OK && !fs.is_null() {
            let fvtbl = (*fs).vtbl;
            if !fvtbl.is_null() {
                let fv = &*fvtbl;
                if let Some(is_supported) = fv.is_supported {
                    let mut b: adlx_bool = 0;
                    if is_supported(fs, &mut b) == ADLX_OK && b != 0 {
                        any_supported = true;
                    }
                }
                if let Some(is_enabled) = fv.is_enabled {
                    let mut b: adlx_bool = 0;
                    if is_enabled(fs, &mut b) == ADLX_OK && b != 0 {
                        any_enabled = true;
                    }
                }
            }
            release(fs as *mut ffi::IADLXInterface);
        }
        release(item);
    }

    if any_enabled {
        Some(true)
    } else if any_supported {
        Some(false)
    } else {
        None
    }
}

#[cfg(test)]
mod freesync_tests {
    use super::*;

    // Hardware probe: requires an AMD GPU + Adrenalin driver (ADLX present). Exercises the real FFI
    // path on the live GPU — the point is a correct, non-crashing read; the value depends on the
    // attached monitor. Run explicitly on the AMD box:
    //   cargo test -p compy --lib amd_freesync -- --ignored --nocapture
    #[test]
    #[ignore = "hardware: AMD GPU + ADLX required"]
    fn freesync_live_probe() {
        let Ok(helper) = adlx::helper::AdlxHelper::new() else {
            eprintln!("ADLX init failed (no AMD driver?) — skipping");
            return;
        };
        let state = read_freesync(helper.system());
        eprintln!("FreeSync state: {state:?}");
    }
}
