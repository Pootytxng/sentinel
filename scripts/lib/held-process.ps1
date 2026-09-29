# Test-harness helper: judge, and if need be kill, a process this harness did NOT start itself, by
# HANDLE, never by bare pid (#598).
#
# Windows hands a freed pid to a new process after a few hundred new process/thread ids (measured
# 253 to 1568 on the dev machine, 2026-09-28), and a full-suite gate creates that many within
# seconds. A pid alone therefore names whoever holds it NOW. The tree-kill harness judged "our
# grandchild survived" by pid plus "a node.exe started after the harness", which every vitest worker
# is, and its cleanup then killed whatever held that pid: one gate run reported SURVIVED and lost a
# vitest worker in the same minute.
#
# Resolve-HeldProcessFate opens ONE handle, which pins the pid for as long as it is held, and proves
# identity from the process's own command line, read through that handle: no WMI (hung on the dev
# machine), no snapshot, no recorded parent pid (#559), no clock. Only a process proven to be ours is
# waited on, and only that process is killed.

if (-not ('Compy.HeldProcess' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Compy {
  public static class HeldProcess {
    const uint SYNCHRONIZE = 0x00100000, QUERY_LIMITED = 0x1000, TERMINATE = 0x0001;
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr handle, uint code);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle, int infoClass, IntPtr buffer, int length, out int returned);
    public static int LastOpenError;
    public static IntPtr Open(int pid) {
      IntPtr handle = OpenProcess(SYNCHRONIZE | QUERY_LIMITED | TERMINATE, false, pid);
      LastOpenError = handle == IntPtr.Zero ? Marshal.GetLastWin32Error() : 0;
      return handle;
    }
    // ProcessCommandLineInformation (60): a UNICODE_STRING header followed by the text. Null when unreadable.
    public static string CommandLine(IntPtr handle) {
      int length;
      NtQueryInformationProcess(handle, 60, IntPtr.Zero, 0, out length);
      if (length <= 0) return null;
      IntPtr buffer = Marshal.AllocHGlobal(length);
      try {
        if (NtQueryInformationProcess(handle, 60, buffer, length, out length) != 0) return null;
        int bytes = Marshal.ReadInt16(buffer) & 0xFFFF;
        return Marshal.PtrToStringUni(Marshal.ReadIntPtr(buffer, IntPtr.Size), bytes / 2);
      } finally { Marshal.FreeHGlobal(buffer); }
    }
    public static bool Exited(IntPtr handle, int ms) { return WaitForSingleObject(handle, (uint)ms) == 0; }
    public static bool Kill(IntPtr handle) { return TerminateProcess(handle, 1); }
    public static void Close(IntPtr handle) { CloseHandle(handle); }
  }
}
'@
}

# The fate of the process at $ProcessId, judged through one held handle:
#   gone       no process holds the pid
#   exited     the process at the pid has exited
#   reused     a process that is not ours holds the pid (access refused to a same-user child, or a
#              command line missing any marker), so ours no longer exists; it is left untouched
#   alive      ours, still running after $WaitMs; it has been killed through the held handle
#   unreadable / unopenable-<error>   identity could not be proven either way (fail closed)
function Resolve-HeldProcessFate([int]$ProcessId, [string[]]$Marker, [int]$WaitMs) {
  $handle = [Compy.HeldProcess]::Open($ProcessId)
  if ($handle -eq [IntPtr]::Zero) {
    switch ([Compy.HeldProcess]::LastOpenError) {
      87 { return 'gone' }
      5 { return 'reused' }
      default { return "unopenable-$([Compy.HeldProcess]::LastOpenError)" }
    }
  }
  try {
    if ([Compy.HeldProcess]::Exited($handle, 0)) { return 'exited' }
    $commandLine = [Compy.HeldProcess]::CommandLine($handle)
    if ($null -eq $commandLine) { return 'unreadable' }
    foreach ($m in $Marker) {
      if ($commandLine.IndexOf($m, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return 'reused' }
    }
    if ([Compy.HeldProcess]::Exited($handle, $WaitMs)) { return 'exited' }
    [void][Compy.HeldProcess]::Kill($handle)
    return 'alive'
  } finally {
    [Compy.HeldProcess]::Close($handle)
  }
}
