using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace CompyProbe
{
  public class WinEvent
  {
    public int ms;          // Stopwatch ms on the probe's clock (0 = the poll loop's first sample)
    public int tickMs;      // the event's own GetTickCount stamp, relative to hook start (~16ms grain)
    public string kind;
    public long hwnd;
    public int pid;
    public int tid;
    public int idObject;
    public int idChild;
    public string cls;
    public string title;
    public long root;       // GetAncestor(GA_ROOT): the top-level window this one lives in
    public int rootPid;     // ...and who owns THAT (cross-process parenting shows up here)
    public int fgPid;       // for FOREGROUND: who owns the new foreground window
    // The event process's PARENT, read AT EVENT TIME. This field cannot be reconstructed later: a
    // vitest run's transient console windows belong to processes that are already gone by the time
    // Resolve-Trace runs (recorded 2026-09-07, `proc: null` on every one of them), so the instant the
    // event arrives is the only moment their ancestry exists to be read. It is what lets the guard
    // tell a tooling console apart from the owner's window WITHOUT trusting a window title.
    public int ppid;
  }

  public class EventHook : IDisposable
  {
    delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint tid, uint time);

    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint evMin, uint evMax, IntPtr hmod, WinEventProc proc, uint idProcess, uint idThread, uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x; public int y; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern uint MsgWaitForMultipleObjectsEx(uint count, IntPtr[] handles, uint ms, uint wakeMask, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PROCESS_BASIC_INFORMATION info, int len, out int written);

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_BASIC_INFORMATION
    {
      public IntPtr ExitStatus;
      public IntPtr PebBaseAddress;
      public IntPtr AffinityMask;
      public IntPtr BasePriority;
      public IntPtr UniqueProcessId;
      public IntPtr InheritedFromUniqueProcessId;
    }

    const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    const uint EVENT_SYSTEM_MINIMIZESTART = 0x0016;
    const uint EVENT_SYSTEM_MINIMIZEEND = 0x0017;
    const uint EVENT_OBJECT_CREATE = 0x8000;
    const uint EVENT_OBJECT_SHOW = 0x8002;
    const uint EVENT_OBJECT_FOCUS = 0x8005;
    const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    const uint WINEVENT_SKIPOWNPROCESS = 0x0002;
    const uint GA_ROOT = 2;
    const uint QS_ALLINPUT = 0x04FF;
    const uint MWMO_INPUTAVAILABLE = 0x0004;
    const uint PM_REMOVE = 0x0001;
    // The weakest right that can answer "who is your parent" -- no elevation needed for a process
    // running as the same user, which is every process this probe cares about.
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const int ProcessBasicInformation = 0;

    public readonly List<WinEvent> Events = new List<WinEvent>();
    public int Cap = 6000;
    public int Dropped = 0;
    public readonly Stopwatch Clock = new Stopwatch();
    // Set by the probe once the poll loop starts, so event stamps share the poll's zero.
    public long ZeroMs = 0;

    // pid -> parent pid, memoised so a burst of events from one process costs one syscall. The cache
    // is static, so it lives for the whole PowerShell process (settle, measurement and relaunch),
    // not for one 6-second window. A cached failure (0) is fail-closed: it never matches, so the
    // window is never excluded. A stale non-zero entry after pid reuse could in principle discount
    // an unrelated console (reuse + a console window + a minimise, all inside one run), which the
    // short process lifetime makes unlikely rather than impossible.
    static readonly Dictionary<int, int> _parents = new Dictionary<int, int>();

    WinEventProc _proc;      // held in a field: the GC must not collect the delegate under the hook
    readonly List<IntPtr> _hooks = new List<IntPtr>();
    uint _tick0;

    public void Start()
    {
      Clock.Start();
      _tick0 = unchecked((uint)Environment.TickCount);
      _proc = OnEvent;
      Hook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND);
      Hook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND);
      Hook(EVENT_OBJECT_CREATE, EVENT_OBJECT_SHOW);
      Hook(EVENT_OBJECT_FOCUS, EVENT_OBJECT_FOCUS);
    }

    void Hook(uint min, uint max)
    {
      IntPtr h = SetWinEventHook(min, max, IntPtr.Zero, _proc, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
      if (h == IntPtr.Zero) throw new InvalidOperationException("SetWinEventHook failed for 0x" + min.ToString("X") + "-0x" + max.ToString("X"));
      _hooks.Add(h);
    }

    public int HookCount { get { return _hooks.Count; } }

    // Pump the hook's delivery queue for up to `ms`, waking the moment something arrives. The probe
    // calls this where it used to Start-Sleep, so an event is stamped when it ARRIVES, not at the
    // next 100ms boundary.
    public void Pump(int ms)
    {
      Stopwatch sw = Stopwatch.StartNew();
      while (true)
      {
        MSG msg;
        while (PeekMessage(out msg, IntPtr.Zero, 0, 0, PM_REMOVE))
        {
          TranslateMessage(ref msg);
          DispatchMessage(ref msg);
        }
        long left = ms - sw.ElapsedMilliseconds;
        if (left <= 0) return;
        MsgWaitForMultipleObjectsEx(0, null, (uint)left, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
      }
    }

    void OnEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint tid, uint time)
    {
      if (hwnd == IntPtr.Zero) return;
      // Window-level only for create/show: a Chromium renderer fires one per accessibility object.
      if ((ev == EVENT_OBJECT_CREATE || ev == EVENT_OBJECT_SHOW) && idObject != 0) return;
      if (Events.Count >= Cap) { Dropped++; return; }
      WinEvent e = new WinEvent();
      e.ms = (int)(Clock.ElapsedMilliseconds - ZeroMs);
      e.tickMs = unchecked((int)(time - _tick0));
      e.kind = Name(ev);
      e.hwnd = hwnd.ToInt64();
      uint pid; e.tid = (int)GetWindowThreadProcessId(hwnd, out pid); e.pid = (int)pid;
      e.idObject = idObject; e.idChild = idChild;
      StringBuilder sb = new StringBuilder(128);
      GetClassNameW(hwnd, sb, sb.Capacity); e.cls = sb.ToString();
      sb.Length = 0; GetWindowTextW(hwnd, sb, sb.Capacity); e.title = sb.ToString();
      IntPtr root = GetAncestor(hwnd, GA_ROOT);
      e.root = root.ToInt64();
      uint rootPid = 0; if (root != IntPtr.Zero) GetWindowThreadProcessId(root, out rootPid); e.rootPid = (int)rootPid;
      if (ev == EVENT_SYSTEM_FOREGROUND) { uint fg = 0; GetWindowThreadProcessId(GetForegroundWindow(), out fg); e.fgPid = (int)fg; }
      e.ppid = ParentOf(e.pid);
      Events.Add(e);
    }

    // 0 when the parent cannot be read (the process died, or the query failed). 0 is the FAIL-CLOSED
    // answer: an unresolvable ancestry never matches the runner's tree, so the event is scored as
    // harm rather than discounted. Never throws -- a WinEvent callback that throws takes the probe
    // down and loses the whole measurement.
    public static int ParentOf(int pid)
    {
      if (pid <= 0) return 0;
      lock (_parents)
      {
        int cached;
        if (_parents.TryGetValue(pid, out cached)) return cached;
      }
      int parent = 0;
      IntPtr h = IntPtr.Zero;
      try
      {
        h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)pid);
        if (h != IntPtr.Zero)
        {
          PROCESS_BASIC_INFORMATION info = new PROCESS_BASIC_INFORMATION();
          int written;
          if (NtQueryInformationProcess(h, ProcessBasicInformation, ref info, Marshal.SizeOf(info), out written) == 0)
          {
            long p = info.InheritedFromUniqueProcessId.ToInt64();
            if (p > 0 && p <= int.MaxValue) parent = (int)p;
          }
        }
      }
      catch { parent = 0; }
      finally { if (h != IntPtr.Zero) CloseHandle(h); }
      lock (_parents) { _parents[pid] = parent; }
      return parent;
    }

    static string Name(uint ev)
    {
      switch (ev)
      {
        case EVENT_SYSTEM_FOREGROUND: return "FOREGROUND";
        case EVENT_SYSTEM_MINIMIZESTART: return "MINIMIZESTART";
        case EVENT_SYSTEM_MINIMIZEEND: return "MINIMIZEEND";
        case EVENT_OBJECT_CREATE: return "CREATE";
        case EVENT_OBJECT_SHOW: return "SHOW";
        case EVENT_OBJECT_FOCUS: return "FOCUS";
        default: return "0x" + ev.ToString("X");
      }
    }

    public void Dispose()
    {
      foreach (IntPtr h in _hooks) UnhookWinEvent(h);
      _hooks.Clear();
    }
  }
}
