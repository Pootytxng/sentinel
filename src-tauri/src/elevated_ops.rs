//! A8 (plan `_train/a5-closed-elevated-set-plan-v4.md`, Slice 1): the CLOSED set of typed elevated operations.
//!
//! What the administrator helper may be asked to do, as data: an [`ElevatedRequest`] of [`ElevatedOp`]s, each a
//! fixed operation with typed, grammar-checked fields. There is no variant and no field that carries script
//! text; every string newtype validates inside `Deserialize`, so the HELPER re-checks whatever arrives.
//! [`ElevatedOp::script`] composes each operation by CALLING today's builders in actions.rs (the mutation
//! boundary), so the bytes that run are the ones the A8 goldens pin. The one new script is EEE's, which sets the
//! ONE exact advanced-property object instead of matching adapter names (plan v4 §2, review C1).
//!
//! Slice 1: no caller moves and no surface is removed. The helper entry that reads a request (`helper_argv`) is
//! reachable only from lib.rs's `run_elevated_op_argv` and main.rs's arm, which are compiled only with the
//! `elevated-op-entry` cargo feature that no normal, release or installer build enables. This module itself is
//! compiled in every build (so CI's `cargo test` runs its tests and the mutation-boundary guard scans it), and is
//! unreachable without that feature: hence the dead-code allowance below, which Slice 2 removes with the feature.
#![cfg_attr(not(feature = "elevated-op-entry"), allow(dead_code))]

use serde::{Deserialize, Deserializer, Serialize};
use std::io::Write as _;

use crate::actions::{self, KnownBloatTask, KnownService};

/// Why the helper refused (nothing ran for what was refused).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Refused {
    /// The request is malformed: it can never be one Compy sent (`HELPER_REQUEST_REFUSED`).
    Request,
    /// A well-formed op whose target no longer matches this PC, or whose helper-side read did not finish
    /// (`HELPER_SAVED_VALUE_NO_MATCH` for a single request; that item's own `fail` line inside a batch).
    NoMatch,
}

/// The request format version this helper reads.
pub(crate) const REQUEST_VERSION: u32 = 1;
/// The most items one request may carry (a Fix batch is at most the appliable catalog; Gaming Mode fewer).
pub(crate) const MAX_ITEMS: usize = 32;
/// The most ops one item may carry.
pub(crate) const MAX_OPS_PER_ITEM: usize = 8;
/// The most targets inside one EEE or Nagle op.
pub(crate) const MAX_TARGETS: usize = 8;
/// The longest hex argument (the app's own 30,000-character argv cap), so at most 15,000 bytes of JSON.
pub(crate) const MAX_HEX_LEN: usize = 30_000;
/// The Gaming Mode elevated-tier item ids that are not service names (gaming_orchestrator.rs `ElevatedItem`).
pub(crate) const GAMING_TIER_IDS: [&str; 2] = ["adv-usb", "adv-pcie"];
/// The most output a helper-side read may produce before it is refused unread.
pub(crate) const MAX_READ_BYTES: usize = 1024 * 1024;
/// The most rows a helper-side EEE read may list.
pub(crate) const MAX_READ_ROWS: usize = 4096;

// ── Grammar checks (pure) ───────────────────────────────────────────────────────────────────────────

fn plan_guid_ok(s: &str) -> bool {
    actions::guid_exact(s).is_ok()
}

fn nic_key_ok(s: &str) -> bool {
    actions::braced_guid_exact(s).is_ok()
}

fn nonce_ok(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// `r0` .. `r31`: the ids Gaming Mode's restore batch gives its items (`format!("r{i}")`), no leading zero.
fn restore_id_ok(s: &str) -> bool {
    let Some(n) = s.strip_prefix('r') else {
        return false;
    };
    let canonical = n == "0" || (!n.is_empty() && !n.starts_with('0'));
    canonical && n.len() <= 2 && n.bytes().all(|b| b.is_ascii_digit()) && n.parse::<usize>().is_ok_and(|v| v < MAX_ITEMS)
}

/// The closed union of item ids (plan v4 §2, [v2r M2]).
fn item_id_ok(s: &str) -> bool {
    crate::history::APPLIABLE_REC_IDS.contains(&s)
        || GAMING_TIER_IDS.contains(&s)
        || KnownService::ALL.iter().any(|svc| svc.name() == s)
        || restore_id_ok(s)
}

/// Saved EEE text: DATA compared in Rust, never put into a script. 1..=256 characters, no control character.
fn saved_text_ok(s: &str) -> bool {
    let n = s.chars().count();
    (1..=256).contains(&n) && !s.chars().any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
}

macro_rules! checked_string {
    ($(#[$meta:meta])* $name:ident, $check:path) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
        #[serde(transparent)]
        pub(crate) struct $name(String);

        impl $name {
            pub(crate) fn parse(s: &str) -> Result<Self, Refused> {
                if $check(s) {
                    Ok(Self(s.to_string()))
                } else {
                    Err(Refused::Request)
                }
            }
            pub(crate) fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let s = String::deserialize(d)?;
                Self::parse(&s).map_err(|_| serde::de::Error::custom(concat!("not a valid ", stringify!($name))))
            }
        }
    };
}

checked_string!(
    /// A power plan, subgroup or setting id: exactly `8-4-4-4-12` hex (`guid_exact`).
    PlanGuid,
    plan_guid_ok
);
checked_string!(
    /// A network interface key: a braced GUID `{8-4-4-4-12}` (plan v4 §2; the §5 census decides old rows).
    NicKey,
    nic_key_ok
);
checked_string!(
    /// The request's results key: exactly 32 lower-case hex digits.
    Nonce,
    nonce_ok
);
checked_string!(
    /// A batch item's receipt id, from the closed union of item ids.
    ItemId,
    item_id_ok
);
checked_string!(
    /// A saved EEE adapter name, property name or prior value: compared in Rust, never put into a script.
    SavedText,
    saved_text_ok
);

macro_rules! bounded_u32 {
    ($(#[$meta:meta])* $name:ident, $lo:expr, $hi:expr) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
        #[serde(transparent)]
        pub(crate) struct $name(u32);

        impl $name {
            pub(crate) fn parse(v: u32) -> Result<Self, Refused> {
                if ($lo..=$hi).contains(&v) {
                    Ok(Self(v))
                } else {
                    Err(Refused::Request)
                }
            }
            pub(crate) fn get(self) -> u32 {
                self.0
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let v = u32::deserialize(d)?;
                Self::parse(v).map_err(|_| serde::de::Error::custom(concat!("out of range for ", stringify!($name))))
            }
        }
    };
}

bounded_u32!(
    /// A core-parking minimum-cores value: a percent, 0..=100.
    Percent,
    0,
    100
);
bounded_u32!(
    /// A fixed pagefile size in MB: 1..=1,048,576 (1 TiB).
    PagefileMb,
    1,
    1_048_576
);

/// A pagefile's drive: one ASCII letter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub(crate) struct DriveLetter(char);

impl DriveLetter {
    pub(crate) fn parse(c: char) -> Result<Self, Refused> {
        if c.is_ascii_alphabetic() {
            Ok(Self(c))
        } else {
            Err(Refused::Request)
        }
    }
    pub(crate) fn get(self) -> char {
        self.0
    }
}

impl<'de> Deserialize<'de> for DriveLetter {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let c = char::deserialize(d)?;
        Self::parse(c).map_err(|_| serde::de::Error::custom("not a drive letter"))
    }
}

// ── Closed enums ────────────────────────────────────────────────────────────────────────────────────

/// A service startup type: exactly the three words `ps_service_startup_for_mode` produces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum StartupKind {
    Automatic,
    Manual,
    Disabled,
}

impl StartupKind {
    pub(crate) fn word(self) -> &'static str {
        match self {
            StartupKind::Automatic => "Automatic",
            StartupKind::Manual => "Manual",
            StartupKind::Disabled => "Disabled",
        }
    }
}

/// The power-plan settings the AC-off apply writes (each mapped to today's constants).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum PowerSetting {
    UsbSelectiveSuspend,
    PcieAspm,
}

impl PowerSetting {
    fn ids(self) -> (&'static str, &'static str) {
        match self {
            PowerSetting::UsbSelectiveSuspend => (actions::PWR_SUBGROUP_USB, actions::PWR_SETTING_USB_SELECTIVE_SUSPEND),
            PowerSetting::PcieAspm => (actions::PWR_SUBGROUP_PCIE, actions::PWR_SETTING_PCIE_ASPM),
        }
    }
}

/// How a power-setting undo re-commits, decided by the APP's read of the active plan (plan v4 §1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Recommit {
    /// The recorded plan is the active one: re-commit it.
    Plan,
    /// Another plan is active: write the saved values only.
    No,
    /// The active plan could not be read: re-commit whichever plan is live (`SCHEME_CURRENT`), as today.
    Current,
}

/// Where a core-parking undo writes (decided app-side, plan v4 §1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum CoreParkingTarget {
    /// A row written before the plan was recorded: today's SCHEME_CURRENT undo.
    Current {},
    /// The recorded plan; `reactivate` when it is the active one.
    Plan { plan: PlanGuid, reactivate: bool },
}

/// An EEE property to turn off: the adapter and property names the app recorded (compared byte for byte).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EeeTarget {
    pub(crate) adapter: SavedText,
    pub(crate) property: SavedText,
}

/// An EEE property to put back: the recorded names and the prior DisplayValue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EeeSaved {
    pub(crate) adapter: SavedText,
    pub(crate) property: SavedText,
    pub(crate) prior: SavedText,
}

/// A Nagle interface to put back: its key and the recorded priors (absent = remove the value).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NagleSaved {
    pub(crate) key: NicKey,
    pub(crate) ack: Option<u32>,
    pub(crate) nodelay: Option<u32>,
}

// ── The closed set ──────────────────────────────────────────────────────────────────────────────────

/// One elevated operation (plan v4 §1 rows 1-22; an apply and an undo variant where the scripts differ). No
/// variant holds script text. Integer priors are plain `u32` and NOT narrowed (the undo restores the user's own
/// value, [v2r M4]); only the core-parking percent and the pagefile sizes are bounded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum ElevatedOp {
    // Rows 1-4.
    ServiceDisable { service: KnownService },
    ServiceRestore { service: KnownService, startup: StartupKind, start: bool },
    ServiceSuspend { service: KnownService },
    ServiceResume { service: KnownService },
    // Row 5 (the name is resolved in the helper).
    TaskDisable { task: KnownBloatTask },
    TaskEnable { task: KnownBloatTask },
    // Rows 6-7.
    UltimatePlanApply {},
    UltimatePlanUndo { prior: PlanGuid },
    // Row 8.
    ReservedStorageOff {},
    ReservedStorageRestore { enabled: bool },
    // Rows 9-10.
    PowerSettingOff { plan: PlanGuid, setting: PowerSetting, prior_ac: u32 },
    PowerSettingRestore { plan: PlanGuid, subgroup: PlanGuid, setting: PlanGuid, ac: u32, dc: u32, recommit: Recommit },
    // Row 11 (matched and set helper-side).
    EeeDisable { targets: Vec<EeeTarget> },
    EeeRestore { targets: Vec<EeeSaved> },
    // Rows 12-13.
    FastStartupOff {},
    FastStartupRestore { prior: Option<u32> },
    HagsEnable {},
    HagsRestore { prior: Option<u32> },
    // Rows 14-15.
    MemoryCompression { enabled: bool },
    MemoryCompressionCombined {},
    // Rows 16-18.
    MmcssDefaults { prior_sr: Option<u32> },
    MmcssRestore { sr: Option<u32>, nti: Option<u32> },
    PrioritySeparationDefault {},
    PrioritySeparationRestore { prior: Option<u32> },
    /// The MPO default (`value` absent: OverlayTestMode removed) and its undo (the recorded value).
    Mpo { value: Option<u32> },
    // Row 19.
    CoreParkingDefault { plan: PlanGuid, prior_ac: Percent, prior_dc: Option<Percent> },
    CoreParkingRestore { ac: Percent, dc: Percent, target: CoreParkingTarget },
    // Rows 20-22.
    PagefileAutomatic {},
    PagefileRestore { letter: DriveLetter, init_mb: PagefileMb, max_mb: PagefileMb },
    TcpAutotuning { disabled: bool },
    NagleDisable { interfaces: Vec<NicKey> },
    NagleRestore { interfaces: Vec<NagleSaved> },
}

/// A helper-side read (new elevated code, plan v4 §1 [v2r M5]): a CONSTANT read-only script and its output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReadKind {
    TaskListing,
    EeeListing,
}

/// The helper's reads. Production spawns PowerShell with the helper's cleared, pinned environment; tests answer
/// with fixed listings and count each read.
pub(crate) trait HelperReads {
    /// Run the constant read-only `script` and return its output, or `None` when it did not finish.
    fn read(&mut self, kind: ReadKind, script: &str) -> Option<std::process::Output>;
}

impl ElevatedOp {
    /// Whether this op may ride a batch. The Ultimate apply exits with its own codes ([v2r S4]) and the
    /// combined memory-compression script writes its own nonce lines, so both run alone.
    pub(crate) fn is_batchable(&self) -> bool {
        !matches!(self, ElevatedOp::UltimatePlanApply {} | ElevatedOp::MemoryCompressionCombined {})
    }

    /// Whether this op's output must reach the app (it reports over the results pipe).
    pub(crate) fn needs_pipe(&self) -> bool {
        matches!(self, ElevatedOp::MemoryCompressionCombined {})
    }

    /// Shape checks a field's own grammar cannot express (counts, init <= max). Malformed = `Refused::Request`.
    pub(crate) fn validate(&self) -> Result<(), Refused> {
        let count_ok = |n: usize| (1..=MAX_TARGETS).contains(&n);
        let ok = match self {
            ElevatedOp::EeeDisable { targets } => count_ok(targets.len()),
            ElevatedOp::EeeRestore { targets } => count_ok(targets.len()),
            ElevatedOp::NagleDisable { interfaces } => count_ok(interfaces.len()),
            ElevatedOp::NagleRestore { interfaces } => count_ok(interfaces.len()),
            ElevatedOp::PagefileRestore { init_mb, max_mb, .. } => init_mb.get() <= max_mb.get(),
            _ => true,
        };
        if ok {
            Ok(())
        } else {
            Err(Refused::Request)
        }
    }

    /// The PowerShell this op runs, composed by today's builders (byte-identical to what the existing callers
    /// run, pinned by the A8 goldens). Ops that need a helper-side read take it from `reads` here, so every read
    /// finishes while composing, before the one mutating spawn.
    pub(crate) fn script<R: HelperReads + ?Sized>(&self, nonce: &Nonce, reads: &mut R) -> Result<String, Refused> {
        use ElevatedOp as Op;
        let built = |r: Result<String, String>| r.map_err(|_| Refused::Request);
        Ok(match self {
            Op::ServiceDisable { service } => actions::service_disable_script(service),
            Op::ServiceRestore { service, startup, start } => actions::service_restore_script(service, startup.word(), *start),
            Op::ServiceSuspend { service } => actions::service_suspend_script(service),
            Op::ServiceResume { service } => actions::service_resume_script(service),
            Op::TaskDisable { task } => {
                let (path, name) = resolve_task(task, reads)?;
                actions::task_disable_script(path, &name)
            }
            Op::TaskEnable { task } => {
                let (path, name) = resolve_task(task, reads)?;
                actions::task_enable_script(path, &name)
            }
            Op::UltimatePlanApply {} => actions::ULTIMATE_APPLY_SCRIPT.to_string(),
            Op::UltimatePlanUndo { prior } => actions::ultimate_undo_script(prior.as_str()),
            Op::ReservedStorageOff {} => actions::RESERVED_STORAGE_OFF_SCRIPT.to_string(),
            Op::ReservedStorageRestore { enabled } => actions::reserved_storage_restore_script(*enabled),
            Op::PowerSettingOff { plan, setting, prior_ac } => {
                let (subgroup, id) = setting.ids();
                actions::power_setting_apply_script(plan.as_str(), subgroup, id, *prior_ac)
            }
            Op::PowerSettingRestore { plan, subgroup, setting, ac, dc, recommit } => {
                let (p, g, s) = (plan.as_str(), subgroup.as_str(), setting.as_str());
                match recommit {
                    Recommit::Plan => actions::build_power_setting_restore_cmd(p, g, s, *ac, *dc, true),
                    Recommit::No => actions::build_power_setting_restore_cmd(p, g, s, *ac, *dc, false),
                    Recommit::Current => actions::power_setting_restore_script(p, g, s, *ac, *dc, None),
                }
            }
            Op::EeeDisable { targets } => {
                let listing = read_eee(reads)?;
                let mut set = Vec::with_capacity(targets.len());
                for t in targets {
                    set.push(eee_pick_disable(&listing, t)?);
                }
                eee_script(&set)?
            }
            Op::EeeRestore { targets } => {
                let listing = read_eee(reads)?;
                let mut set = Vec::with_capacity(targets.len());
                for t in targets {
                    set.push(eee_pick_restore(&listing, t)?);
                }
                eee_script(&set)?
            }
            Op::FastStartupOff {} => actions::FAST_STARTUP_OFF_SCRIPT.to_string(),
            Op::FastStartupRestore { prior } => actions::fast_startup_restore_script(*prior),
            Op::HagsEnable {} => actions::HAGS_ENABLE_SCRIPT.to_string(),
            Op::HagsRestore { prior } => actions::hags_restore_script(*prior),
            Op::MemoryCompression { enabled: true } => actions::MEMCOMPRESS_ENABLE_SCRIPT.to_string(),
            Op::MemoryCompression { enabled: false } => actions::MEMCOMPRESS_DISABLE_SCRIPT.to_string(),
            Op::MemoryCompressionCombined {} => built(actions::memcompress_combined_restore_script(nonce.as_str()))?,
            Op::MmcssDefaults { prior_sr } => actions::mmcss_apply_script(*prior_sr),
            Op::MmcssRestore { sr, nti } => actions::mmcss_rollback_script(*sr, *nti),
            Op::PrioritySeparationDefault {} => actions::priority_separation_restore_script(),
            Op::PrioritySeparationRestore { prior } => actions::priority_separation_rollback_script(*prior),
            Op::Mpo { value } => actions::mpo_rollback_script(*value),
            Op::CoreParkingDefault { plan, prior_ac, prior_dc } => {
                actions::core_parking_apply_script(plan.as_str(), prior_ac.get(), prior_dc.map(Percent::get))
            }
            Op::CoreParkingRestore { ac, dc, target } => match target {
                CoreParkingTarget::Current {} => actions::core_parking_script(ac.get(), dc.get()),
                CoreParkingTarget::Plan { plan, reactivate } => {
                    actions::core_parking_plan_script(plan.as_str(), ac.get(), dc.get(), *reactivate)
                }
            },
            Op::PagefileAutomatic {} => actions::PAGEFILE_RESTORE_SCRIPT.to_string(),
            Op::PagefileRestore { letter, init_mb, max_mb } => {
                built(actions::pagefile_rollback_script(letter.get(), init_mb.get(), max_mb.get()))?
            }
            Op::TcpAutotuning { disabled } => actions::tcp_autotuning_script(*disabled).to_string(),
            Op::NagleDisable { interfaces } => {
                let keys: Vec<&str> = interfaces.iter().map(NicKey::as_str).collect();
                built(actions::nagle_apply_script(&keys))?
            }
            Op::NagleRestore { interfaces } => {
                let snaps: Vec<actions::NagleInterfaceSnapshot> = interfaces
                    .iter()
                    .map(|n| actions::NagleInterfaceSnapshot {
                        interface: n.key.as_str().to_string(),
                        prior_ack: n.ack,
                        prior_nodelay: n.nodelay,
                    })
                    .collect();
                built(actions::nagle_rollback_script(&snaps))?
            }
        })
    }
}

// ── Helper-side reads: the task name and the EEE match (new elevated code, parsed in Rust) ───────────

/// The task's `(constant path, resolved name)`: the helper lists the constant folder itself and resolves the
/// name by the SAME pure `task_name_from_read` build-drift rule as the app, then re-guards it. Absent, refused,
/// or a read that did not finish: `NoMatch`.
fn resolve_task<R: HelperReads + ?Sized>(task: &KnownBloatTask, reads: &mut R) -> Result<(&'static str, String), Refused> {
    let (path, base) = task.path_and_name();
    if actions::ps_safe_squoted(path).is_err() || actions::ps_safe_squoted(base).is_err() {
        return Err(Refused::NoMatch);
    }
    let out = reads.read(ReadKind::TaskListing, &actions::task_listing_script(path));
    let bounded = out.filter(|o| o.stdout.len() <= MAX_READ_BYTES);
    match actions::task_name_from_read(bounded.as_ref(), base) {
        Ok(Some(name)) if actions::ps_safe_squoted(&name).is_ok() => Ok((path, name)),
        _ => Err(Refused::NoMatch),
    }
}

/// One adapter as the helper's EEE read lists it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub(crate) struct EeeAdapterRow {
    #[serde(default, deserialize_with = "text")]
    pub(crate) g: String,
    #[serde(default, deserialize_with = "text")]
    pub(crate) n: String,
    #[serde(default, deserialize_with = "text")]
    pub(crate) s: String,
    #[serde(default, deserialize_with = "text")]
    pub(crate) m: String,
}

/// One advanced property as the helper's EEE read lists it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub(crate) struct EeePropRow {
    #[serde(default, deserialize_with = "text")]
    pub(crate) i: String,
    #[serde(default, deserialize_with = "text")]
    pub(crate) n: String,
    #[serde(default, deserialize_with = "text")]
    pub(crate) d: String,
    #[serde(default, deserialize_with = "text")]
    pub(crate) k: String,
    #[serde(default, deserialize_with = "text")]
    pub(crate) v: String,
    #[serde(default, deserialize_with = "texts")]
    pub(crate) dv: Vec<String>,
    #[serde(default, deserialize_with = "texts")]
    pub(crate) rv: Vec<String>,
}

/// The whole EEE read.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub(crate) struct EeeListing {
    #[serde(default, deserialize_with = "rows")]
    pub(crate) a: Vec<EeeAdapterRow>,
    #[serde(default, deserialize_with = "rows")]
    pub(crate) p: Vec<EeePropRow>,
}

/// A JSON string, or null as empty (PowerShell writes `null` for an absent value).
fn text<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(d)?.unwrap_or_default())
}

/// A list of strings, a single string (PowerShell 5.1 can unwrap a one-element array), or null as empty.
fn texts<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        Many(Vec<Option<String>>),
        One(String),
    }
    Ok(match Option::<OneOrMany>::deserialize(d)? {
        None => Vec::new(),
        Some(OneOrMany::One(s)) => vec![s],
        Some(OneOrMany::Many(v)) => v.into_iter().map(Option::unwrap_or_default).collect(),
    })
}

/// A list of rows, a single row, or null as empty.
fn rows<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Vec<T>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany<T> {
        Many(Vec<T>),
        One(T),
    }
    Ok(match Option::<OneOrMany<T>>::deserialize(d)? {
        None => Vec::new(),
        Some(OneOrMany::One(t)) => vec![t],
        Some(OneOrMany::Many(v)) => v,
    })
}

/// PURE: parse the helper's EEE read. A read that did not finish, failed, is too large, is not one JSON document
/// of the expected shape, or lists too many rows: `NoMatch` (nothing is guessed). Never panics on any bytes.
pub(crate) fn parse_eee_listing(read: Option<&std::process::Output>) -> Result<EeeListing, Refused> {
    let out = read.ok_or(Refused::NoMatch)?;
    if !out.status.success() || out.stdout.len() > MAX_READ_BYTES {
        return Err(Refused::NoMatch);
    }
    let text = std::str::from_utf8(&out.stdout).map_err(|_| Refused::NoMatch)?;
    let text = text.trim_start_matches('\u{feff}').trim();
    let listing: EeeListing = serde_json::from_str(text).map_err(|_| Refused::NoMatch)?;
    if listing.a.len() > MAX_READ_ROWS || listing.p.len() > MAX_READ_ROWS {
        return Err(Refused::NoMatch);
    }
    Ok(listing)
}

fn read_eee<R: HelperReads + ?Sized>(reads: &mut R) -> Result<EeeListing, Refused> {
    parse_eee_listing(reads.read(ReadKind::EeeListing, actions::EEE_LISTING_SCRIPT).as_ref())
}

/// `{GUID}::<keyword>` split into its two parts, when the GUID is braced and exact and the keyword is in the
/// closed list. Anything else is not an EEE property the typed set will touch.
pub(crate) fn eee_instance_parts(instance: &str) -> Option<(&str, &str)> {
    let (guid, keyword) = instance.split_once("::")?;
    (actions::braced_guid_exact(guid).is_ok() && actions::EEE_KEYWORDS.contains(&keyword)).then_some((guid, keyword))
}

/// The ONE property for `(adapter, property)`: byte-equal names, a closed-list keyword equal to the one in its
/// InstanceID, and an InstanceID GUID that is a listed adapter's InterfaceGuid. Zero or several: `NoMatch`.
fn eee_find<'a>(listing: &'a EeeListing, adapter: &str, property: &str) -> Result<(&'a EeePropRow, &'a EeeAdapterRow, &'a str), Refused> {
    let mut found = listing.p.iter().filter_map(|p| {
        if p.n != adapter || p.d != property {
            return None;
        }
        let (guid, keyword) = eee_instance_parts(&p.i)?;
        if keyword != p.k {
            return None;
        }
        let a = listing.a.iter().find(|a| a.g.eq_ignore_ascii_case(guid))?;
        Some((p, a, guid))
    });
    match (found.next(), found.next()) {
        (Some(one), None) => Ok(one),
        _ => Err(Refused::NoMatch),
    }
}

/// The registry value at index `i` of a property's parallel lists (lists of the same, non-zero length; an integer
/// value). Anything else: `NoMatch`. The VM proves the two lists are index-parallel (plan v4 §6).
fn eee_value_at(p: &EeePropRow, i: usize) -> Result<String, Refused> {
    if p.dv.is_empty() || p.dv.len() != p.rv.len() || i >= p.rv.len() {
        return Err(Refused::NoMatch);
    }
    let value = p.rv[i].trim().to_string();
    if actions::eee_registry_value_ok(&value) {
        Ok(value)
    } else {
        Err(Refused::NoMatch)
    }
}

/// The undo's target: the property the row names, and the registry value at the index of its saved prior
/// DisplayValue (exactly one byte-equal entry). Anything else: `NoMatch`.
pub(crate) fn eee_pick_restore(listing: &EeeListing, saved: &EeeSaved) -> Result<(String, String, String), Refused> {
    let (p, _, guid) = eee_find(listing, saved.adapter.as_str(), saved.property.as_str())?;
    let hits: Vec<usize> =
        p.dv.iter().enumerate().filter(|(_, d)| d.as_str() == saved.prior.as_str()).map(|(i, _)| i).collect();
    let [i] = hits[..] else {
        return Err(Refused::NoMatch);
    };
    Ok((guid.to_string(), p.k.clone(), eee_value_at(p, i)?))
}

/// The apply's target: the property the app recorded, on an Up, wired (802.3) adapter, and the registry value at
/// the index of the disabled display value chosen in Rust as today (`pick_disabled_value`, first in list order).
pub(crate) fn eee_pick_disable(listing: &EeeListing, t: &EeeTarget) -> Result<(String, String, String), Refused> {
    let (p, a, guid) = eee_find(listing, t.adapter.as_str(), t.property.as_str())?;
    if a.s != "Up" || a.m != "802.3" {
        return Err(Refused::NoMatch);
    }
    let off = actions::pick_disabled_value(&p.dv).ok_or(Refused::NoMatch)?;
    let i = p.dv.iter().position(|d| d.trim() == off).ok_or(Refused::NoMatch)?;
    Ok((guid.to_string(), p.k.clone(), eee_value_at(p, i)?))
}

fn eee_script(set: &[(String, String, String)]) -> Result<String, Refused> {
    let targets: Vec<(&str, &str, &str)> = set.iter().map(|(g, k, v)| (g.as_str(), k.as_str(), v.as_str())).collect();
    actions::build_eee_set_by_instance_script(&targets).map_err(|_| Refused::NoMatch)
}

// ── The request and the helper entry (plan v4 §2-§3) ────────────────────────────────────────────────

/// How the helper wraps the request's ops: one op run alone (today's `run_elevated_powershell`), or a batch of
/// items each with its own receipt line (today's `compose_batch_script` over the results pipe).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Wrapper {
    Single,
    Batch,
}

/// One item of a request: its receipt id (a batch item has one; a single op has none) and its ops.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RequestItem {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) id: Option<ItemId>,
    pub(crate) ops: Vec<ElevatedOp>,
}

/// What the app asks the helper to do. Travels hex-encoded JSON in argv; checked whole before anything runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ElevatedRequest {
    pub(crate) v: u32,
    pub(crate) nonce: Nonce,
    pub(crate) wrapper: Wrapper,
    pub(crate) items: Vec<RequestItem>,
}

impl ElevatedRequest {
    /// The request-level shape (everything a field's own grammar cannot say). Malformed = `Refused::Request`.
    pub(crate) fn validate(&self) -> Result<(), Refused> {
        let shape_ok = self.v == REQUEST_VERSION
            && (1..=MAX_ITEMS).contains(&self.items.len())
            && self.items.iter().all(|i| (1..=MAX_OPS_PER_ITEM).contains(&i.ops.len()));
        if !shape_ok {
            return Err(Refused::Request);
        }
        // A batch item carries its receipt id; a single op carries none.
        let ids_present = match self.wrapper {
            Wrapper::Single => self.items.iter().all(|i| i.id.is_none()),
            Wrapper::Batch => self.items.iter().all(|i| i.id.is_some()),
        };
        let mut ids: Vec<&str> = self.items.iter().filter_map(|i| i.id.as_ref().map(ItemId::as_str)).collect();
        let given = ids.len();
        ids.sort_unstable();
        ids.dedup();
        if !ids_present || ids.len() != given {
            return Err(Refused::Request); // two items with one id would share a receipt
        }
        for op in self.items.iter().flat_map(|i| &i.ops) {
            op.validate()?;
        }
        match self.wrapper {
            Wrapper::Single if self.items.len() == 1 && self.items[0].ops.len() == 1 => Ok(()),
            Wrapper::Batch if self.items.iter().flat_map(|i| &i.ops).all(ElevatedOp::is_batchable) => Ok(()),
            _ => Err(Refused::Request),
        }
    }

    /// Whether the helper must have the app's results pipe to run this request.
    pub(crate) fn needs_pipe(&self) -> bool {
        self.wrapper == Wrapper::Batch || self.items.iter().flat_map(|i| &i.ops).any(ElevatedOp::needs_pipe)
    }
}

/// PURE: the argv hex -> a validated request. Every failure is `Refused::Request`; never panics on any input.
pub(crate) fn parse_request_hex(hex: &str) -> Result<ElevatedRequest, Refused> {
    if hex.is_empty() || hex.len() > MAX_HEX_LEN {
        return Err(Refused::Request);
    }
    let bytes = actions::from_hex(hex).ok_or(Refused::Request)?;
    let text = String::from_utf8(bytes).map_err(|_| Refused::Request)?;
    let req: ElevatedRequest = serde_json::from_str(&text).map_err(|_| Refused::Request)?;
    req.validate()?;
    Ok(req)
}

/// Where the helper writes its own lines and PowerShell's relayed output: the app's results pipe.
pub(crate) type PipeOut = Box<dyn std::io::Write + Send>;

/// The helper's effects: its reads (above) and the ONE mutating PowerShell run of a request.
pub(crate) trait HelperEffects: HelperReads {
    /// Run `script` elevated (the helper's existing runner: cleared environment, output relayed to `pipe`) and
    /// return the helper's exit code.
    fn run(&mut self, script: &str, pipe: Option<PipeOut>) -> i32;
}

/// Production effects: reads through `sys_exe::elevated_command` (the helper's cleared, pinned environment, never
/// the user's), bounded by `QUERY_READ_LIMIT`; the run through lib.rs's `run_helper_script`.
pub(crate) struct LiveEffects;

impl HelperReads for LiveEffects {
    fn read(&mut self, _kind: ReadKind, script: &str) -> Option<std::process::Output> {
        let mut cmd = crate::sys_exe::elevated_command(crate::sys_exe::SysTool::PowerShell);
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
        actions::output_within(cmd, actions::QUERY_READ_LIMIT)
    }
}

impl HelperEffects for LiveEffects {
    fn run(&mut self, script: &str, pipe: Option<PipeOut>) -> i32 {
        crate::run_helper_script(script, pipe)
    }
}

/// Run a validated request: compose every op (each helper-side read finishes here), then the ONE mutating run.
/// Single: a refused op exits with its sentinel and nothing runs. Batch: a refused item writes its own
/// `<nonce>:<id>:fail` line (nothing was changed for it) and the other items run; if none is left, the helper
/// writes `<nonce>:end` and starts no PowerShell. A malformed request never gets here.
pub(crate) fn run_request(req: &ElevatedRequest, pipe: Option<PipeOut>, fx: &mut dyn HelperEffects) -> i32 {
    let refused = |r: Refused| match r {
        Refused::Request => actions::HELPER_REQUEST_REFUSED,
        Refused::NoMatch => actions::HELPER_SAVED_VALUE_NO_MATCH,
    };
    if req.needs_pipe() && pipe.is_none() {
        return actions::HELPER_REQUEST_REFUSED;
    }
    match req.wrapper {
        Wrapper::Single => {
            let Some(op) = req.items.first().and_then(|i| i.ops.first()) else {
                return actions::HELPER_REQUEST_REFUSED;
            };
            match op.script(&req.nonce, &mut *fx) {
                Ok(script) => fx.run(&actions::with_error_action_stop(&script), pipe),
                Err(r) => refused(r),
            }
        }
        Wrapper::Batch => {
            let Some(mut pipe) = pipe else {
                return actions::HELPER_REQUEST_REFUSED;
            };
            let mut runnable: Vec<(String, Vec<String>)> = Vec::new();
            let mut failed: Vec<&str> = Vec::new();
            for item in &req.items {
                let Some(id) = &item.id else {
                    return actions::HELPER_REQUEST_REFUSED;
                };
                let mut scripts = Vec::with_capacity(item.ops.len());
                let mut no_match = false;
                for op in &item.ops {
                    match op.script(&req.nonce, &mut *fx) {
                        Ok(s) => scripts.push(s),
                        Err(Refused::NoMatch) => {
                            no_match = true;
                            break;
                        }
                        Err(Refused::Request) => return actions::HELPER_REQUEST_REFUSED,
                    }
                }
                if no_match {
                    failed.push(id.as_str());
                } else {
                    runnable.push((id.as_str().to_string(), scripts));
                }
            }
            // Composed (and refused) whole before a line is written or anything runs.
            let script = if runnable.is_empty() {
                None
            } else {
                match actions::compose_batch_script(&runnable, req.nonce.as_str()) {
                    Ok(s) => Some(s),
                    Err(_) => return actions::HELPER_REQUEST_REFUSED,
                }
            };
            let nonce = req.nonce.as_str();
            for id in failed {
                let _ = writeln!(pipe, "{nonce}:{id}:fail");
            }
            match script {
                Some(s) => fx.run(&actions::with_error_action_stop(&s), Some(pipe)),
                None => {
                    let _ = writeln!(pipe, "{nonce}:end");
                    0
                }
            }
        }
    }
}

/// The typed helper entry's argument forms (everything after its flag): `<hex>`, or
/// `<hex> --pipe <name> --parent-pid <pid>`. Order: parse and check the whole request (pure), then connect the
/// results pipe, then compose (reads) and run. Anything malformed refuses with `HELPER_REQUEST_REFUSED` before any
/// read, any pipe and any PowerShell; a pipe that cannot be confirmed refuses with `HELPER_CHANNEL_REFUSED`.
pub(crate) fn helper_argv(rest: &[String]) -> i32 {
    helper_argv_with(rest, &mut LiveEffects, &|name, parent| {
        crate::fps_pipe::connect_to_parent(name, parent).map(|f| Box::new(f) as PipeOut).map_err(|_| ())
    })
}

/// [`helper_argv`] with its effects and its pipe connection passed in (tests pass fakes).
pub(crate) fn helper_argv_with(
    rest: &[String],
    fx: &mut dyn HelperEffects,
    connect: &dyn Fn(&str, u32) -> Result<PipeOut, ()>,
) -> i32 {
    let (hex, channel) = match rest {
        [hex] => (hex, None),
        [hex, p, name, q, pid] if p == "--pipe" && q == "--parent-pid" => match pid.parse::<u32>() {
            Ok(pid) => (hex, Some((name.as_str(), pid))),
            Err(_) => return actions::HELPER_REQUEST_REFUSED,
        },
        _ => return actions::HELPER_REQUEST_REFUSED,
    };
    let Ok(req) = parse_request_hex(hex) else {
        return actions::HELPER_REQUEST_REFUSED;
    };
    if req.needs_pipe() && channel.is_none() {
        return actions::HELPER_REQUEST_REFUSED;
    }
    let pipe = match channel {
        Some((name, parent)) => match connect(name, parent) {
            Ok(p) => Some(p),
            Err(()) => return actions::HELPER_CHANNEL_REFUSED,
        },
        None => None,
    };
    run_request(&req, pipe, fx)
}

#[cfg(test)]
mod tests {
    //! A8 Slice 1 tests. Each test names its break check (the one-line change that must make it fail); the list
    //! is also in `_train/a8-breaks.json`. UNRUN until the coordinator lets builds resume.
    use super::*;
    use crate::fuzz_support::{hostile_string, mutate_text, Rng, SEEDS};
    use std::io::Write as _;
    use std::os::windows::process::ExitStatusExt;
    use std::sync::{Arc, Mutex};

    const N: &str = "0123456789abcdef0123456789abcdef";
    const GUID_A: &str = "{AAAAAAAA-1111-2222-3333-444444444444}";
    const GUID_B: &str = "{BBBBBBBB-1111-2222-3333-444444444444}";

    fn out(code: u32, stdout: &str) -> std::process::Output {
        std::process::Output { status: std::process::ExitStatus::from_raw(code), stdout: stdout.as_bytes().to_vec(), stderr: Vec::new() }
    }

    /// The test effects: fixed answers for each read, and a log of every read and run in the order they happened.
    #[derive(Default)]
    struct Fake {
        task: Option<std::process::Output>,
        eee: Option<std::process::Output>,
        events: Vec<String>,
        read_scripts: Vec<String>,
        code: i32,
    }

    impl HelperReads for Fake {
        fn read(&mut self, kind: ReadKind, script: &str) -> Option<std::process::Output> {
            self.events.push(format!("read:{kind:?}"));
            self.read_scripts.push(script.to_string());
            match kind {
                ReadKind::TaskListing => self.task.clone(),
                ReadKind::EeeListing => self.eee.clone(),
            }
        }
    }

    impl HelperEffects for Fake {
        fn run(&mut self, script: &str, pipe: Option<PipeOut>) -> i32 {
            self.events.push(format!("run:{script}"));
            if let Some(mut p) = pipe {
                let _ = p.write_all(b"<powershell output>\n");
            }
            self.code
        }
    }

    impl Fake {
        fn reads(&self) -> usize {
            self.events.iter().filter(|e| e.starts_with("read:")).count()
        }
        fn runs(&self) -> usize {
            self.events.iter().filter(|e| e.starts_with("run:")).count()
        }
    }

    /// A pipe the test can read back.
    #[derive(Clone, Default)]
    struct SharedBuf(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for SharedBuf {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.0.lock().map_err(|_| std::io::Error::other("poisoned"))?.extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl SharedBuf {
        fn text(&self) -> String {
            String::from_utf8_lossy(&self.0.lock().map(|v| v.clone()).unwrap_or_default()).into_owned()
        }
    }

    fn request_json(wrapper: &str, items: &str) -> String {
        format!(r#"{{"v":1,"nonce":"{N}","wrapper":"{wrapper}","items":[{items}]}}"#)
    }

    fn hex(s: &str) -> String {
        actions::to_hex(s.as_bytes())
    }

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    fn eee_listing(props: &str) -> String {
        format!(
            r#"{{"a":[{{"g":"{GUID_A}","n":"Ethernet [2]","s":"Up","m":"802.3"}},{{"g":"{GUID_B}","n":"Ethernet 2","s":"Up","m":"802.3"}}],"p":[{props}]}}"#
        )
    }

    fn eee_prop(guid: &str, adapter: &str, keyword: &str, dv: &str, rv: &str) -> String {
        format!(r#"{{"i":"{guid}::{keyword}","n":"{adapter}","d":"Energy Efficient Ethernet","k":"{keyword}","v":"Enabled","dv":{dv},"rv":{rv}}}"#)
    }

    fn two_adapters() -> String {
        eee_listing(&format!(
            "{},{}",
            eee_prop(GUID_A, "Ethernet [2]", "*EEE", r#"["Disabled","Enabled"]"#, r#"["0","1"]"#),
            eee_prop(GUID_B, "Ethernet 2", "*EEE", r#"["Disabled","Enabled"]"#, r#"["0","1"]"#)
        ))
    }

    fn saved(adapter: &str, prior: &str) -> EeeSaved {
        EeeSaved {
            adapter: SavedText::parse(adapter).expect("adapter"),
            property: SavedText::parse("Energy Efficient Ethernet").expect("property"),
            prior: SavedText::parse(prior).expect("prior"),
        }
    }

    fn listing_of(json: &str) -> EeeListing {
        parse_eee_listing(Some(&out(0, json))).expect("a well-formed listing")
    }

    /// The one-target EEE set script, written out (review C1: the exact object, by InstanceID, as -InputObject).
    const GOLDEN_EEE_SET_A_1: &str = "$compyP = @(Get-NetAdapterAdvancedProperty -AllProperties -ErrorAction SilentlyContinue | Where-Object { $_.InstanceID -ceq '{AAAAAAAA-1111-2222-3333-444444444444}::*EEE' }); if ($compyP.Count -eq 1) { Set-NetAdapterAdvancedProperty -InputObject $compyP[0] -RegistryValue '1' -NoRestart -ErrorAction SilentlyContinue }; $null = 0";

    // ── grammar ──

    /// Break: let `nonce_ok` accept upper-case hex, or `plan_guid_ok` use `ps_safe`, and this fails.
    #[test]
    fn every_newtype_accepts_its_grammar_and_refuses_the_rest() {
        for ok in ["381b4222-f694-41f0-9685-ff5bb260df2e", "381B4222-F694-41F0-9685-FF5BB260DF2E"] {
            assert!(PlanGuid::parse(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "{381b4222-f694-41f0-9685-ff5bb260df2e}",
            "381b4222f69441f09685ff5bb260df2e",
            "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
            "381b4222-f694-41f0-9685-ff5bb260df2e ",
            "381b4222-f694-41f0-9685-ff5bb260df2e; calc",
            "SCHEME_CURRENT",
            "381b4222-f694-41f0-9685-ff5bb260df2g",
            "381b4222_f694-41f0-9685-ff5bb260df2e",
        ] {
            assert!(PlanGuid::parse(bad).is_err(), "{bad:?}");
        }
        for ok in [GUID_A, "{2a737441-1930-4402-8d77-b2bebba308a3}"] {
            assert!(NicKey::parse(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "2A737441-1930-4402-8D77-B2BEBBA308A3",
            "{x}",
            "{AAAAAAAA-1111-2222-3333-444444444444}'",
            "{AAAAAAAA-1111-2222-3333-444444444444",
            "{AAAAAAAA-1111-2222-3333-444444444444}}",
            "Ethernet",
            "{AAAAAAAA-1111-2222-3333-44444444444Z}",
        ] {
            assert!(NicKey::parse(bad).is_err(), "{bad:?}");
        }
        assert!(Nonce::parse(N).is_ok());
        for bad in ["", "0123456789ABCDEF0123456789ABCDEF", &N[..31], format!("{N}0").as_str(), "g123456789abcdef0123456789abcdef", "0123456789abcdef'123456789abcdef"] {
            assert!(Nonce::parse(bad).is_err(), "{bad:?}");
        }
        for ok in ["Ethernet [2]", "Bob's NIC", "Énergie", "Energy-Efficient Ethernet"] {
            assert!(SavedText::parse(ok).is_ok(), "{ok}");
        }
        assert!(SavedText::parse(&"x".repeat(256)).is_ok());
        for bad in [String::new(), "x".repeat(257), "a\nb".into(), "a\u{2028}b".into(), "nul\0".into(), "tab\t".into()] {
            assert!(SavedText::parse(&bad).is_err(), "{bad:?}");
        }
        assert!(Percent::parse(0).is_ok() && Percent::parse(100).is_ok());
        assert!(Percent::parse(101).is_err() && Percent::parse(u32::MAX).is_err());
        assert!(PagefileMb::parse(1).is_ok() && PagefileMb::parse(1_048_576).is_ok());
        assert!(PagefileMb::parse(0).is_err() && PagefileMb::parse(1_048_577).is_err());
        assert!(DriveLetter::parse('c').is_ok() && DriveLetter::parse('Z').is_ok());
        for bad in ['1', ':', 'é', ' '] {
            assert!(DriveLetter::parse(bad).is_err(), "{bad:?}");
        }
        // The same checks run inside Deserialize (the helper's own re-check).
        assert!(serde_json::from_str::<PlanGuid>(r#""SCHEME_CURRENT""#).is_err());
        assert!(serde_json::from_str::<NicKey>(r#""Ethernet""#).is_err());
        assert!(serde_json::from_str::<Percent>("101").is_err());
        assert!(serde_json::from_str::<DriveLetter>(r#""cd""#).is_err());
    }

    /// Break: drop "adv-pcie" from GAMING_TIER_IDS, or let `restore_id_ok` accept r32, and this fails.
    #[test]
    fn item_ids_are_the_closed_union_pinned_to_their_sources() {
        for id in crate::history::APPLIABLE_REC_IDS {
            assert!(ItemId::parse(id).is_ok(), "{id}");
        }
        for id in GAMING_TIER_IDS.iter().copied().chain(KnownService::ALL.iter().map(|s| s.name())) {
            assert!(ItemId::parse(id).is_ok(), "{id}");
        }
        for i in 0..MAX_ITEMS {
            assert!(ItemId::parse(&format!("r{i}")).is_ok(), "r{i}");
        }
        for bad in ["", "r32", "r01", "r-1", "R0", "r", "adv-usb ", "sysmain", "power-ultimatex", "'; calc", "core-parking-forced"] {
            assert!(ItemId::parse(bad).is_err(), "{bad:?}");
        }
        // The Gaming Mode lists, pinned to the code that makes them.
        let gaming = include_str!("gaming_orchestrator.rs").replace("\r\n", "\n");
        for line in ["id: \"adv-usb\",", "id: \"adv-pcie\",", "id: svc.name(),", "let id = format!(\"r{i}\");"] {
            assert!(gaming.contains(line), "gaming_orchestrator.rs no longer has {line:?}: update ItemId with it");
        }
        assert_eq!(gaming.matches("tier.push(ElevatedItem {").count(), 3, "a new tier item needs its id in ItemId");
    }

    /// Break: put `#[serde(deny_unknown_fields)]` off `ElevatedOp` (or `RequestItem`) and this fails.
    #[test]
    fn serde_round_trips_the_ops_and_refuses_unknown_ops_and_fields() {
        let samples = [
            r#"{"op":"service-restore","service":"WSearch","startup":"Disabled","start":false}"#,
            r#"{"op":"ultimate-plan-apply"}"#,
            r#"{"op":"core-parking-restore","ac":0,"dc":100,"target":{"kind":"current"}}"#,
            r#"{"op":"pagefile-restore","letter":"D","init_mb":1,"max_mb":1048576}"#,
            r#"{"op":"eee-restore","targets":[{"adapter":"Ethernet [2]","property":"Energy Efficient Ethernet","prior":"Enabled"}]}"#,
        ];
        for s in samples {
            let op: ElevatedOp = serde_json::from_str(s).unwrap_or_else(|e| panic!("{s}: {e}"));
            let back: ElevatedOp = serde_json::from_str(&serde_json::to_string(&op).expect("ser")).expect("de");
            assert_eq!(op, back, "{s}");
        }
        for bad in [
            r#"{"op":"raw","script":"calc"}"#,
            r#"{"op":"run-script","text":"calc"}"#,
            r#"{"op":"ultimate-plan-apply","extra":1}"#,
            r#"{"op":"service-disable","service":"SysMain","script":"calc"}"#,
            r#"{"op":"service-disable","service":"lsass"}"#,
            r#"{"op":"task-disable","task":"WindowsDefender"}"#,
            r#"{"op":"service-restore","service":"SysMain","startup":"AutomaticDelayedStart","start":true}"#,
            r#"{"op":"core-parking-restore","ac":1,"dc":1,"target":{"kind":"current","plan":"x"}}"#,
            r#"{"op":"eee-restore","targets":[{"adapter":"a","property":"b","prior":"c","script":"d"}]}"#,
            r#"{"service":"SysMain"}"#,
        ] {
            assert!(serde_json::from_str::<ElevatedOp>(bad).is_err(), "{bad}");
        }
        let item_extra = request_json("single", r#"{"ops":[{"op":"hags-enable"}],"cmd":"calc"}"#);
        assert!(serde_json::from_str::<ElevatedRequest>(&item_extra).is_err());
        let req_extra = format!(r#"{{"v":1,"nonce":"{N}","wrapper":"single","items":[{{"ops":[{{"op":"hags-enable"}}]}}],"x":1}}"#);
        assert!(serde_json::from_str::<ElevatedRequest>(&req_extra).is_err());
    }

    /// [v2r M4]: priors are the user's own values, any u32. Break: add a range check on `HagsRestore.prior` in
    /// `ElevatedOp::validate` and this fails.
    #[test]
    fn integer_priors_are_not_narrowed() {
        let max = u32::MAX;
        for json in [
            format!(r#"{{"op":"power-setting-off","plan":"381b4222-f694-41f0-9685-ff5bb260df2e","setting":"PcieAspm","prior_ac":{max}}}"#),
            format!(r#"{{"op":"fast-startup-restore","prior":{max}}}"#),
            format!(r#"{{"op":"hags-restore","prior":{max}}}"#),
            format!(r#"{{"op":"mmcss-restore","sr":{max},"nti":{max}}}"#),
            format!(r#"{{"op":"priority-separation-restore","prior":{max}}}"#),
            format!(r#"{{"op":"mpo","value":{max}}}"#),
            format!(r#"{{"op":"nagle-restore","interfaces":[{{"key":"{GUID_A}","ack":{max},"nodelay":{max}}}]}}"#),
        ] {
            let op: ElevatedOp = serde_json::from_str(&json).unwrap_or_else(|e| panic!("{json}: {e}"));
            assert_eq!(op.validate(), Ok(()), "{json}");
            let script = op.script(&Nonce::parse(N).expect("nonce"), &mut Fake::default()).expect("composes");
            assert!(script.contains(&max.to_string()), "{json}");
        }
    }

    // ── the request and the order of effects ──

    /// Every malformed request is refused whole: the request sentinel, no read, no pipe, no run, no app dispatch.
    /// Break: move the pipe `connect` above `parse_request_hex` in `helper_argv_with` (or compose before
    /// validating) and this fails.
    #[test]
    fn a_malformed_request_is_refused_before_any_read_pipe_or_run() {
        let one = r#"{"ops":[{"op":"hags-enable"}]}"#;
        let batch_item = |id: &str| format!(r#"{{"id":"{id}","ops":[{{"op":"hags-enable"}}]}}"#);
        let many: Vec<String> = (0..=MAX_ITEMS).map(|i| batch_item(&format!("r{}", i % MAX_ITEMS))).collect();
        let nine_ops = format!(r#"{{"ops":[{}]}}"#, vec![r#"{"op":"hags-enable"}"#; MAX_OPS_PER_ITEM + 1].join(","));
        let nine_nics = format!(r#"{{"ops":[{{"op":"nagle-disable","interfaces":[{}]}}]}}"#, vec![format!("\"{GUID_A}\""); MAX_TARGETS + 1].join(","));
        let pipe_args = ["--pipe", "compy-test", "--parent-pid", "1"];
        let with_pipe = |h: String| -> Vec<String> { std::iter::once(h).chain(pipe_args.iter().map(|s| s.to_string())).collect() };
        let cases: Vec<(&str, Vec<String>)> = vec![
            ("no argument", vec![]),
            ("not hex", argv(&["zz"])),
            ("odd hex", argv(&["0"])),
            ("not JSON", vec![hex("not json")]),
            ("not UTF-8", vec![actions::to_hex(&[0xff, 0xfe, 0xfd])]),
            ("unknown op", vec![hex(&request_json("single", r#"{"ops":[{"op":"raw","script":"calc"}]}"#))]),
            ("extra field on an op", vec![hex(&request_json("single", r#"{"ops":[{"op":"hags-enable","x":1}]}"#))]),
            ("version 2", vec![hex(&request_json("single", one).replace(r#""v":1"#, r#""v":2"#))]),
            ("no items", vec![hex(&request_json("single", ""))]),
            ("33 items", with_pipe(hex(&request_json("batch", &many.join(","))))),
            ("9 ops", vec![hex(&request_json("single", &nine_ops))]),
            ("9 interfaces", vec![hex(&request_json("single", &nine_nics))]),
            ("duplicate ids", with_pipe(hex(&request_json("batch", &format!("{},{}", batch_item("hags-enable"), batch_item("hags-enable")))))),
            ("single with two ops", vec![hex(&request_json("single", r#"{"ops":[{"op":"hags-enable"},{"op":"hags-enable"}]}"#))]),
            ("single with an id", vec![hex(&request_json("single", &batch_item("hags-enable")))]),
            ("batch item without id", with_pipe(hex(&request_json("batch", one)))),
            ("ultimate in a batch", with_pipe(hex(&request_json("batch", r#"{"id":"power-ultimate","ops":[{"op":"ultimate-plan-apply"}]}"#)))),
            ("combined in a batch", with_pipe(hex(&request_json("batch", r#"{"id":"r0","ops":[{"op":"memory-compression-combined"}]}"#)))),
            ("batch without a pipe", vec![hex(&request_json("batch", &batch_item("hags-enable")))]),
            ("combined without a pipe", vec![hex(&request_json("single", r#"{"ops":[{"op":"memory-compression-combined"}]}"#))]),
            ("bad GUID", vec![hex(&request_json("single", r#"{"ops":[{"op":"ultimate-plan-undo","prior":"SCHEME_CURRENT"}]}"#))]),
            ("upper-case nonce", vec![hex(&request_json("single", one).replace(N, &N.to_uppercase()))]),
            ("pagefile init > max", vec![hex(&request_json("single", r#"{"ops":[{"op":"pagefile-restore","letter":"C","init_mb":4096,"max_mb":1024}]}"#))]),
            ("bad parent pid", argv(&[hex(&request_json("single", one)).as_str(), "--pipe", "n", "--parent-pid", "x"])),
            ("unknown flag", argv(&[hex(&request_json("single", one)).as_str(), "--pid", "n", "--parent-pid", "1"])),
            ("trailing argument", argv(&[hex(&request_json("single", one)).as_str(), "extra"])),
            ("oversize", vec!["00".repeat(MAX_HEX_LEN / 2 + 1)]),
        ];
        for (why, args) in cases {
            actions::reset_elevation_dispatch_count();
            let mut fx = Fake::default();
            let connects = std::cell::Cell::new(0);
            let code = helper_argv_with(&args, &mut fx, &|_, _| {
                connects.set(connects.get() + 1);
                Ok(Box::new(SharedBuf::default()) as PipeOut)
            });
            assert_eq!(code, actions::HELPER_REQUEST_REFUSED, "{why}");
            assert!(fx.events.is_empty(), "{why}: nothing read or run, got {:?}", fx.events);
            assert_eq!(connects.get(), 0, "{why}: the pipe is not touched");
            assert_eq!(actions::elevation_dispatch_count(), 0, "{why}: nothing dispatched");
        }
    }

    /// [v2r S4]: the Ultimate apply (its own exit codes) never rides a batch. Break: return true from
    /// `is_batchable` for every op and this fails.
    #[test]
    fn the_ultimate_apply_never_rides_a_batch() {
        assert!(!ElevatedOp::UltimatePlanApply {}.is_batchable());
        assert!(!ElevatedOp::MemoryCompressionCombined {}.is_batchable());
        let r: ElevatedRequest = serde_json::from_str(&request_json("batch", r#"{"id":"power-ultimate","ops":[{"op":"ultimate-plan-apply"}]}"#)).expect("parses");
        assert_eq!(r.validate(), Err(Refused::Request));
        let single: ElevatedRequest = serde_json::from_str(&request_json("single", r#"{"ops":[{"op":"ultimate-plan-apply"}]}"#)).expect("parses");
        assert_eq!(single.validate(), Ok(()), "alone it is allowed");
    }

    /// A well-formed request runs: the pipe is connected after the request is checked, reads come before the
    /// one run, and a refused pipe runs nothing. Break: call `fx.run` before composing the batch items (or
    /// connect the pipe first) and this fails.
    #[test]
    fn reads_finish_before_the_one_mutating_run_and_a_refused_pipe_runs_nothing() {
        let items = r#"{"id":"eee-disable","ops":[{"op":"eee-disable","targets":[{"adapter":"Ethernet [2]","property":"Energy Efficient Ethernet"}]}]},{"id":"sysmain-disable","ops":[{"op":"service-disable","service":"SysMain"}]}"#;
        let args: Vec<String> = argv(&[hex(&request_json("batch", items)).as_str(), "--pipe", "compy-test", "--parent-pid", "1"]);
        let buf = SharedBuf::default();
        let mut fx = Fake { eee: Some(out(0, &two_adapters())), ..Fake::default() };
        let b2 = buf.clone();
        let code = helper_argv_with(&args, &mut fx, &move |name, pid| {
            assert_eq!((name, pid), ("compy-test", 1));
            Ok(Box::new(b2.clone()) as PipeOut)
        });
        assert_eq!(code, 0);
        assert_eq!((fx.reads(), fx.runs()), (1, 1), "one read, one run: {:?}", fx.events);
        assert_eq!(fx.events[0], "read:EeeListing", "the read comes first");
        assert!(fx.events[1].starts_with("run:$ErrorActionPreference='Stop'; try { $compyP = @(Get-NetAdapterAdvancedProperty"), "{}", fx.events[1]);
        assert!(fx.events[1].contains(&format!("{N}:eee-disable:ok")) && fx.events[1].contains(&format!("{N}:sysmain-disable:ok")));
        assert!(fx.events[1].contains("-ceq '{AAAAAAAA-1111-2222-3333-444444444444}::*EEE'"), "only Ethernet [2]'s object");
        assert!(!fx.events[1].contains("BBBBBBBB"), "never the look-alike adapter");
        assert_eq!(fx.read_scripts, vec![actions::EEE_LISTING_SCRIPT.to_string()], "the read is the constant one");

        let mut fx = Fake { eee: Some(out(0, &two_adapters())), ..Fake::default() };
        let code = helper_argv_with(&args, &mut fx, &|_, _| Err(()));
        assert_eq!(code, actions::HELPER_CHANNEL_REFUSED);
        assert!(fx.events.is_empty(), "a refused pipe reads and runs nothing: {:?}", fx.events);
    }

    /// [v3r C2]: inside a batch a refused item is its own `fail` line, and the other items still run; with every
    /// item refused the helper writes `end` and starts no PowerShell. Break: return `HELPER_REQUEST_REFUSED`
    /// for `Refused::NoMatch` in `run_request`'s batch arm and this fails.
    #[test]
    fn in_a_batch_a_refused_item_is_its_own_fail_line_and_the_rest_run() {
        let eee = r#"{"id":"eee-disable","ops":[{"op":"eee-restore","targets":[{"adapter":"Ethernet 3","property":"Energy Efficient Ethernet","prior":"Enabled"}]}]}"#;
        let svc = r#"{"id":"sysmain-disable","ops":[{"op":"service-disable","service":"SysMain"}]}"#;
        let req = parse_request_hex(&hex(&request_json("batch", &format!("{eee},{svc}")))).expect("valid");
        let buf = SharedBuf::default();
        let mut fx = Fake { eee: Some(out(0, &two_adapters())), ..Fake::default() };
        assert_eq!(run_request(&req, Some(Box::new(buf.clone())), &mut fx), 0);
        let text = buf.text();
        assert!(text.starts_with(&format!("{N}:eee-disable:fail\n")), "{text}");
        assert_eq!(fx.runs(), 1);
        assert!(fx.events.iter().any(|e| e.contains(&format!("{N}:sysmain-disable:ok"))), "the other item ran");
        assert!(!fx.events.iter().any(|e| e.contains("eee-disable:ok")), "the refused item is not in the script");
        let receipts = actions::parse_batch_receipts(&text, N);
        assert_eq!(receipts.get("eee-disable"), Some(&false));

        let only = parse_request_hex(&hex(&request_json("batch", eee))).expect("valid");
        let buf = SharedBuf::default();
        let mut fx = Fake { eee: Some(out(0, &two_adapters())), ..Fake::default() };
        assert_eq!(run_request(&only, Some(Box::new(buf.clone())), &mut fx), 0);
        assert_eq!(buf.text(), format!("{N}:eee-disable:fail\n{N}:end\n"));
        assert_eq!(fx.runs(), 0, "no PowerShell when nothing is left");
    }

    /// [v3r C3]: a single op whose target no longer matches exits with the SAVED-VALUE sentinel (not the request
    /// one) and runs nothing. Break: map `Refused::NoMatch` to `HELPER_REQUEST_REFUSED` and this fails.
    #[test]
    fn a_single_refusal_is_the_saved_value_sentinel_and_nothing_runs() {
        let eee = r#"{"ops":[{"op":"eee-restore","targets":[{"adapter":"Ethernet 3","property":"Energy Efficient Ethernet","prior":"Enabled"}]}]}"#;
        let task = r#"{"ops":[{"op":"task-enable","task":"CeipUsb"}]}"#;
        for (items, fx) in [
            (eee, Fake { eee: Some(out(0, &two_adapters())), ..Fake::default() }),
            (eee, Fake { eee: None, ..Fake::default() }),
            (task, Fake { task: Some(out(0, "Consolidator\r\n")), ..Fake::default() }),
            (task, Fake { task: Some(out(1, "UsbCeip\r\n")), ..Fake::default() }),
        ] {
            let mut fx = fx;
            let req = parse_request_hex(&hex(&request_json("single", items))).expect("valid");
            assert_eq!(run_request(&req, None, &mut fx), actions::HELPER_SAVED_VALUE_NO_MATCH, "{items}");
            assert_eq!((fx.reads(), fx.runs()), (1, 0), "{items}: read, never run");
        }
    }

    // ── helper-side reads ──

    /// The task name is resolved in the helper from the constant folder listing, by today's build-drift rule.
    /// Break: drop the `ps_safe_squoted(&name)` re-check in `resolve_task` and this fails.
    #[test]
    fn the_task_name_is_resolved_in_the_helper_from_a_constant_listing() {
        let task = KnownBloatTask::CompatibilityAppraiser;
        let (path, _) = task.path_and_name();
        let found = |listing: Option<std::process::Output>| {
            let mut fx = Fake { task: listing, ..Fake::default() };
            let r = resolve_task(&task, &mut fx).map(|(_, n)| n);
            assert_eq!(fx.read_scripts, vec![actions::task_listing_script(path)], "a constant read");
            r
        };
        assert_eq!(found(Some(out(0, "Microsoft Compatibility Appraiser\r\nMicrosoft Compatibility Appraiser Exp\r\n"))), Ok("Microsoft Compatibility Appraiser".into()));
        assert_eq!(found(Some(out(0, "ProgramDataUpdater\r\nMicrosoft Compatibility Appraiser Exp\r\n"))), Ok("Microsoft Compatibility Appraiser Exp".into()));
        assert_eq!(found(Some(out(0, "ProgramDataUpdater\r\n"))), Err(Refused::NoMatch), "absent");
        assert_eq!(found(Some(out(0, ""))), Err(Refused::NoMatch), "empty folder");
        assert_eq!(found(Some(out(0, "Microsoft Compatibility Appraiser'; calc; '\r\n"))), Err(Refused::NoMatch), "refused name");
        assert_eq!(found(Some(out(1, "Microsoft Compatibility Appraiser\r\n"))), Err(Refused::NoMatch), "a failed read");
        assert_eq!(found(None), Err(Refused::NoMatch), "a read that did not finish");
        let big = "x".repeat(MAX_READ_BYTES + 1);
        assert_eq!(found(Some(out(0, &big))), Err(Refused::NoMatch), "too large");
    }

    /// [v2r M3] / [v3r C1]: the EEE property is found in Rust by byte-equal names (no wildcard: `Ethernet [2]` is
    /// not `Ethernet 2`), and its value by the index in the driver's parallel lists. Break: compare the adapter
    /// name with `eq_ignore_ascii_case` or `starts_with` in `eee_find` and this fails.
    #[test]
    fn the_eee_match_is_byte_equal_in_rust() {
        let l = listing_of(&two_adapters());
        assert_eq!(eee_pick_restore(&l, &saved("Ethernet [2]", "Enabled")), Ok((GUID_A.into(), "*EEE".into(), "1".into())));
        assert_eq!(eee_pick_restore(&l, &saved("Ethernet 2", "Disabled")), Ok((GUID_B.into(), "*EEE".into(), "0".into())));
        for name in ["Ethernet ?2?", "Ethernet*", "Ethernet [2", "ethernet [2]", "Ethernet [2] ", "Ethernet"] {
            assert_eq!(eee_pick_restore(&l, &saved(name, "Enabled")), Err(Refused::NoMatch), "{name}");
        }
        let target = EeeTarget { adapter: SavedText::parse("Ethernet [2]").expect("a"), property: SavedText::parse("Energy Efficient Ethernet").expect("p") };
        assert_eq!(eee_pick_disable(&l, &target), Ok((GUID_A.into(), "*EEE".into(), "0".into())));

        let one = |prop: String| listing_of(&eee_listing(&prop));
        let a = |kw: &str, dv: &str, rv: &str| eee_prop(GUID_A, "Ethernet [2]", kw, dv, rv);
        // Localized display values: matched as text, never translated.
        let de = one(a("*EEE", r#"["Deaktiviert","Aktiviert"]"#, r#"["0","1"]"#));
        assert_eq!(eee_pick_restore(&de, &saved("Ethernet [2]", "Enabled")), Err(Refused::NoMatch));
        assert_eq!(eee_pick_restore(&de, &saved("Ethernet [2]", "Aktiviert")).map(|t| t.2), Ok("1".into()));
        for (why, l) in [
            ("no registry values", one(a("*EEE", r#"["Disabled","Enabled"]"#, "[]"))),
            ("lists of different lengths", one(a("*EEE", r#"["Disabled","Enabled"]"#, r#"["0"]"#))),
            ("a value that is not an integer", one(a("*EEE", r#"["Disabled","Enabled"]"#, r#"["0","1; calc"]"#))),
            ("a hex value", one(a("*EEE", r#"["Disabled","Enabled"]"#, r#"["0","0x1"]"#))),
            ("a duplicated display value", one(a("*EEE", r#"["Enabled","Enabled"]"#, r#"["0","1"]"#))),
            ("a keyword outside the list", one(a("EnableGreenEthernet", r#"["Disabled","Enabled"]"#, r#"["0","1"]"#))),
            (
                "two properties with one name",
                one(format!("{},{}", a("*EEE", r#"["Disabled","Enabled"]"#, r#"["0","1"]"#), a("EEE", r#"["Disabled","Enabled"]"#, r#"["0","1"]"#))),
            ),
            (
                "an InstanceID keyword that differs",
                one(a("*EEE", r#"["Disabled","Enabled"]"#, r#"["0","1"]"#).replace(r#""k":"*EEE""#, r#""k":"EEE""#)),
            ),
            (
                "an InstanceID GUID that is no adapter",
                one(eee_prop("{CCCCCCCC-1111-2222-3333-444444444444}", "Ethernet [2]", "*EEE", r#"["Disabled","Enabled"]"#, r#"["0","1"]"#)),
            ),
            ("an unbraced InstanceID GUID", one(eee_prop("AAAAAAAA-1111-2222-3333-444444444444", "Ethernet [2]", "*EEE", r#"["Disabled","Enabled"]"#, r#"["0","1"]"#))),
        ] {
            assert_eq!(eee_pick_restore(&l, &saved("Ethernet [2]", "Enabled")), Err(Refused::NoMatch), "{why}");
        }
        // A disconnected or wireless adapter is not an apply target.
        let down = listing_of(&two_adapters().replacen(r#""s":"Up""#, r#""s":"Disconnected""#, 1));
        assert_eq!(eee_pick_disable(&down, &target), Err(Refused::NoMatch));
        // PowerShell 5.1 may unwrap a one-element array or a one-row list.
        let unwrapped = format!(
            r#"{{"a":{{"g":"{GUID_A}","n":"Ethernet [2]","s":"Up","m":"802.3"}},"p":{{"i":"{GUID_A}::*EEE","n":"Ethernet [2]","d":"Energy Efficient Ethernet","k":"*EEE","v":"Enabled","dv":"Enabled","rv":"1"}}}}"#
        );
        assert_eq!(eee_pick_restore(&listing_of(&unwrapped), &saved("Ethernet [2]", "Enabled")).map(|t| t.2), Ok("1".into()));
    }

    /// The EEE read is refused, never guessed, when it did not finish, failed, is too large or not the shape.
    /// Break: accept a non-zero exit in `parse_eee_listing` and this fails.
    #[test]
    fn an_unusable_eee_read_is_no_match() {
        assert_eq!(parse_eee_listing(None), Err(Refused::NoMatch));
        assert_eq!(parse_eee_listing(Some(&out(1, &two_adapters()))), Err(Refused::NoMatch));
        assert_eq!(parse_eee_listing(Some(&out(0, "not json"))), Err(Refused::NoMatch));
        assert_eq!(parse_eee_listing(Some(&out(0, r#"{"a":"x","p":1}"#))), Err(Refused::NoMatch));
        let big = format!("{}{}", two_adapters(), " ".repeat(MAX_READ_BYTES));
        assert_eq!(parse_eee_listing(Some(&out(0, &big))), Err(Refused::NoMatch));
        assert!(parse_eee_listing(Some(&out(0, &format!("\u{feff}{}\r\n", two_adapters())))).is_ok(), "a byte-order mark is tolerated");
    }

    /// The EEE set script, written out, and its builder's refusals. Break: drop the `EEE_KEYWORDS` check in
    /// `build_eee_set_by_instance_script` and this fails.
    #[test]
    fn the_eee_set_script_is_the_golden_and_refuses_outside_its_grammar() {
        assert_eq!(actions::build_eee_set_by_instance_script(&[(GUID_A, "*EEE", "1")]).as_deref(), Ok(GOLDEN_EEE_SET_A_1));
        let l = listing_of(&two_adapters());
        let mut fx = Fake { eee: Some(out(0, &two_adapters())), ..Fake::default() };
        let op = ElevatedOp::EeeRestore { targets: vec![saved("Ethernet [2]", "Enabled")] };
        assert_eq!(op.script(&Nonce::parse(N).expect("n"), &mut fx).as_deref(), Ok(GOLDEN_EEE_SET_A_1));
        assert_eq!(eee_pick_restore(&l, &saved("Ethernet [2]", "Enabled")).map(|t| t.0), Ok(GUID_A.to_string()));
        for (g, k, v) in [
            ("AAAAAAAA-1111-2222-3333-444444444444", "*EEE", "1"),
            ("{AAAAAAAA-1111-2222-3333-444444444444}' ; calc ; '", "*EEE", "1"),
            (GUID_A, "*EEE*", "1"),
            (GUID_A, "Green", "1"),
            (GUID_A, "*EEE", "1'; calc; '"),
            (GUID_A, "*EEE", "0x1"),
            (GUID_A, "*EEE", "12345678901"),
            (GUID_A, "*EEE", ""),
            (GUID_A, "*EEE", "-"),
        ] {
            assert!(actions::build_eee_set_by_instance_script(&[(g, k, v)]).is_err(), "{g} {k} {v}");
        }
        assert!(actions::build_eee_set_by_instance_script(&[]).is_err());
    }

    // ── fuzz [v3r fuzz] ──

    const VALID_BATCH: &str = r#"{"v":1,"nonce":"0123456789abcdef0123456789abcdef","wrapper":"batch","items":[{"id":"sysmain-disable","ops":[{"op":"service-disable","service":"SysMain"}]},{"id":"r3","ops":[{"op":"core-parking-restore","ac":100,"dc":90,"target":{"kind":"plan","plan":"381b4222-f694-41f0-9685-ff5bb260df2e","reactivate":true}}]}]}"#;

    /// Arbitrary bytes, mutated valid requests and hostile strings never panic the request parser, and whatever
    /// it accepts re-validates and round-trips. Break: replace `.ok_or(Refused::Request)?` after `from_hex` in
    /// `parse_request_hex` with `.unwrap()` (or drop the length check) and this panics.
    #[test]
    fn fuzz_the_request_parser_never_panics_and_accepts_only_valid_requests() {
        assert!(parse_request_hex(&hex(VALID_BATCH)).is_ok(), "the seed request is valid");
        for seed in SEEDS {
            let mut rng = Rng::seeded(seed);
            for _ in 0..200 {
                let len = rng.below(96);
                let bytes: Vec<u8> = (0..len).map(|_| (rng.next_u64() & 0xff) as u8).collect();
                for candidate in [actions::to_hex(&bytes), hex(&mutate_text(&mut rng, VALID_BATCH)), hostile_string(&mut rng, 6)] {
                    if let Ok(req) = parse_request_hex(&candidate) {
                        assert_eq!(req.validate(), Ok(()));
                        let again = serde_json::to_string(&req).expect("serializes");
                        assert_eq!(parse_request_hex(&hex(&again)), Ok(req), "a round trip keeps an accepted request");
                    }
                }
            }
        }
    }

    /// Arbitrary bytes and mutated listings never panic the helper's own parsers (EEE JSON, task listing).
    /// Break: index `p.rv[i]` without the length check in `eee_value_at` and this panics.
    #[test]
    fn fuzz_the_helper_read_parsers_never_panic() {
        let base = two_adapters();
        for seed in SEEDS {
            let mut rng = Rng::seeded(seed);
            for _ in 0..200 {
                let len = rng.below(128);
                let bytes: Vec<u8> = (0..len).map(|_| (rng.next_u64() & 0xff) as u8).collect();
                let raw = std::process::Output { status: std::process::ExitStatus::from_raw(0), stdout: bytes, stderr: Vec::new() };
                let _ = parse_eee_listing(Some(&raw));
                let _ = actions::task_name_from_read(Some(&raw), "Consolidator");
                let mutated = mutate_text(&mut rng, &base);
                if let Ok(l) = parse_eee_listing(Some(&out(0, &mutated))) {
                    let _ = eee_pick_restore(&l, &saved("Ethernet [2]", "Enabled"));
                    let target = EeeTarget { adapter: SavedText::parse("Ethernet [2]").expect("a"), property: SavedText::parse("Energy Efficient Ethernet").expect("p") };
                    if let Ok((g, k, v)) = eee_pick_disable(&l, &target) {
                        assert!(actions::build_eee_set_by_instance_script(&[(g.as_str(), k.as_str(), v.as_str())]).is_ok(), "a pick always composes");
                    }
                }
                let hostile = hostile_string(&mut rng, 6);
                let _ = parse_eee_listing(Some(&out(0, &hostile)));
            }
        }
    }

    // ── pins ──

    /// [v3r flag]: a default build has no typed entry. Break: put `elevated-op-entry` in `default = [...]` in
    /// Cargo.toml (or drop the cfg line above main.rs's arm) and this fails.
    #[test]
    fn a_default_build_has_no_typed_entry() {
        const CFG: &str = "#[cfg(feature = \"elevated-op-entry\")]";
        let literal = concat!("\"--run-elevated", "-op\"");
        let main = include_str!("main.rs").replace("\r\n", "\n");
        let lines: Vec<&str> = main.lines().collect();
        let at: Vec<usize> = lines.iter().enumerate().filter(|(_, l)| l.contains(literal)).map(|(i, _)| i).collect();
        assert_eq!(at.len(), 1, "main.rs holds the literal once");
        assert_eq!(lines[at[0] - 1].trim(), CFG, "main.rs's arm is behind the feature");
        let lib = include_str!("lib.rs").replace("\r\n", "\n");
        let lib_lines: Vec<&str> = lib.lines().collect();
        let entry = lib_lines.iter().position(|l| l.starts_with("pub fn run_elevated_op_argv(")).expect("the lib entry");
        assert_eq!(lib_lines[entry - 1].trim(), CFG, "lib.rs's entry is behind the feature");
        // No other Rust source holds the literal outside its tests.
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut stack = vec![dir];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(&d).expect("src dir").flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().is_some_and(|x| x == "rs") && p.file_name().is_some_and(|n| n != "main.rs") {
                    let text = std::fs::read_to_string(&p).expect("read").replace("\r\n", "\n");
                    let shipped = text.split("#[cfg(test)]\nmod tests").next().unwrap_or_default();
                    assert!(!shipped.contains(literal), "{} holds the typed entry's literal outside its tests", p.display());
                }
            }
        }
        // The feature exists, is off by default, and no build names it.
        let cargo = include_str!("../Cargo.toml").replace("\r\n", "\n");
        let code: Vec<&str> = cargo.lines().map(str::trim).filter(|l| !l.starts_with('#')).collect();
        assert!(code.contains(&"default = []"), "no default feature");
        assert!(code.contains(&"elevated-op-entry = []"));
        assert_eq!(code.iter().filter(|l| l.contains("elevated-op-entry")).count(), 1, "nothing enables it");
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let mut builds = vec![root.join("package.json"), root.join("scripts").join("ship-reinstall.ps1"), root.join("src-tauri").join("tauri.conf.json")];
        if let Ok(wf) = std::fs::read_dir(root.join(".github").join("workflows")) {
            builds.extend(wf.flatten().map(|e| e.path()));
        }
        for f in builds {
            let text = std::fs::read_to_string(&f).unwrap_or_else(|e| panic!("{}: {e}", f.display()));
            for word in ["elevated-op-entry", "--features", "--all-features"] {
                assert!(!text.contains(word), "{} names {word}", f.display());
            }
        }
    }

    /// The closed set holds no script text: no `String` in the op enum or the structs it carries. Break: add a
    /// `Raw { script: String }` variant and this fails.
    #[test]
    fn the_closed_set_has_no_script_variant() {
        let src = include_str!("elevated_ops.rs").replace("\r\n", "\n");
        let shipped = src.split("#[cfg(test)]\nmod tests").next().unwrap_or_default();
        for head in [
            "pub(crate) enum ElevatedOp {",
            "pub(crate) struct EeeTarget {",
            "pub(crate) struct EeeSaved {",
            "pub(crate) struct NagleSaved {",
            "pub(crate) enum CoreParkingTarget {",
            "pub(crate) struct RequestItem {",
            "pub(crate) struct ElevatedRequest {",
        ] {
            let at = shipped.find(head).unwrap_or_else(|| panic!("{head}"));
            let body = &shipped[at..at + shipped[at..].find("\n}\n").expect("end")];
            for word in ["String", "Raw", "serde_json::Value", "Box<"] {
                assert!(!body.contains(word), "{head} holds {word}");
            }
        }
    }

    /// [v2r M1] / [v3r C3]: two distinct "nothing ran" sentinels, each with its exact arm, defined once. Break:
    /// remove the `HELPER_SAVED_VALUE_NO_MATCH_MSG` arm from `elevation_error_nothing_ran` and this fails.
    #[test]
    fn the_two_sentinels_are_distinct_and_read_as_nothing_ran() {
        let codes = [
            actions::HELPER_POWERSHELL_NOT_STARTED,
            actions::HELPER_TICKET_REFUSED,
            actions::HELPER_CHANNEL_REFUSED,
            actions::HELPER_REQUEST_REFUSED,
            actions::HELPER_SAVED_VALUE_NO_MATCH,
        ];
        let mut unique = codes.to_vec();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), codes.len(), "every helper code is its own");
        assert_ne!(actions::HELPER_REQUEST_REFUSED_MSG, actions::HELPER_SAVED_VALUE_NO_MATCH_MSG);
        for (code, msg) in [
            (actions::HELPER_REQUEST_REFUSED, actions::HELPER_REQUEST_REFUSED_MSG),
            (actions::HELPER_SAVED_VALUE_NO_MATCH, actions::HELPER_SAVED_VALUE_NO_MATCH_MSG),
        ] {
            let err = actions::elevation_outcome(Ok(std::process::ExitStatus::from_raw(code as u32))).unwrap_err();
            assert_eq!(err, msg);
            assert!(actions::elevation_error_nothing_ran(&err), "{err}");
        }
        let src = include_str!("actions.rs").replace("\r\n", "\n");
        for decl in [
            "pub(crate) const HELPER_REQUEST_REFUSED: i32",
            "pub(crate) const HELPER_REQUEST_REFUSED_MSG: &str",
            "pub(crate) const HELPER_SAVED_VALUE_NO_MATCH: i32",
            "pub(crate) const HELPER_SAVED_VALUE_NO_MATCH_MSG: &str",
        ] {
            assert_eq!(src.matches(decl).count(), 1, "{decl} is defined once");
        }
    }

    /// [v2r M5]: helper-side reads run with the helper's cleared, pinned environment, never the user's (a
    /// user-shaped PSModulePath in an elevated read would be code execution). Break: build the read with
    /// `actions::quiet_command` and this fails.
    #[test]
    fn the_helper_reads_run_with_the_cleared_environment() {
        let src = include_str!("elevated_ops.rs").replace("\r\n", "\n");
        let at = src.find("impl HelperReads for LiveEffects {").expect("live reads");
        let body = &src[at..at + src[at..].find("\n}\n").expect("end")];
        assert!(body.contains("crate::sys_exe::elevated_command(crate::sys_exe::SysTool::PowerShell)"), "{body}");
        assert!(!body.contains("quiet_command") && !body.contains("sys_command"), "{body}");
        let run = src.find("impl HelperEffects for LiveEffects {").expect("live run");
        let run_body = &src[run..run + src[run..].find("\n}\n").expect("end")];
        assert!(run_body.contains("crate::run_helper_script(script, pipe)"), "{run_body}");
    }
}
