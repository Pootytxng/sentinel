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

/// One item of a request: its receipt id and its ops.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RequestItem {
    pub(crate) id: ItemId,
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
        let mut ids: Vec<&str> = self.items.iter().map(|i| i.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        if ids.len() != self.items.len() {
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
                    failed.push(item.id.as_str());
                } else {
                    runnable.push((item.id.as_str().to_string(), scripts));
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
