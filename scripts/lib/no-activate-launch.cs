using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// Launch a GUI process whose FIRST ShowWindow cannot activate it (WORK_TRAIN item FOCUS, 2026-10-24).
//
// Windows applies the launcher's STARTUPINFO to a new process's first ShowWindow call: with
// STARTF_USESHOWWINDOW set, wShowWindow replaces whatever show command the app passed. Start-Process
// and a ShellExecute launch always set it, to SW_SHOWNORMAL (an ACTIVATING show), so Compy's own
// non-activating show (tao turns focus=false into SW_SHOWNOACTIVATE) was overridden, and Windows'
// foreground lock then sometimes let the launch take the owner's foreground. Traces in
// logs/foreground-traces/ show the foreground moving to Compy 1ms after its first SHOW.
//
// .NET cannot express this: ProcessStartInfo.WindowStyle has no no-activate value, and a
// UseShellExecute=false launch leaves wShowWindow unset rather than set to SW_SHOWNOACTIVATE. So this
// calls CreateProcessW directly with STARTF_USESHOWWINDOW and wShowWindow = SW_SHOWNOACTIVATE (4).
// bInheritHandles is FALSE, so the child never holds the caller's stdout/stderr pipes (the same
// property Start-NativeProcess -Detached gets from ShellExecute, issue #60 defect 2).
namespace CompyLaunch
{
  public static class NoActivate
  {
    public const int STARTF_USESHOWWINDOW = 0x00000001;
    public const short SW_SHOWNORMAL = 1;
    public const short SW_SHOWNOACTIVATE = 4;

    // String fields are IntPtr on purpose: marshalled strings in a by-ref struct get freed by the
    // marshaller, which corrupts the heap. All three stay null (zero) here.
    [StructLayout(LayoutKind.Sequential)]
    struct STARTUPINFO
    {
      public int cb;
      public IntPtr lpReserved;
      public IntPtr lpDesktop;
      public IntPtr lpTitle;
      public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute;
      public int dwFlags;
      public short wShowWindow;
      public short cbReserved2;
      public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
      public IntPtr hProcess, hThread;
      public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessW(string lpApplicationName, StringBuilder lpCommandLine, IntPtr lpProcessAttributes,
      IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment,
      string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);

    // `commandLine` is the COMPLETE command line, program first and quoted by the caller.
    // `showWindow` is the wShowWindow value; callers pass SW_SHOWNOACTIVATE.
    public static Process Start(string filePath, string commandLine, string workingDirectory, short showWindow)
    {
      var si = new STARTUPINFO();
      si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
      si.dwFlags = STARTF_USESHOWWINDOW;
      si.wShowWindow = showWindow;
      PROCESS_INFORMATION pi;
      var cmd = new StringBuilder(commandLine);
      string cwd = String.IsNullOrEmpty(workingDirectory) ? null : workingDirectory;
      if (!CreateProcessW(filePath, cmd, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, cwd, ref si, out pi))
      {
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessW failed for " + filePath);
      }
      try
      {
        // Our handle keeps the pid from being reused while .NET opens its own, and touching .Handle
        // pins that one so HasExited / ExitCode / WaitForExit keep working after ours is closed.
        Process p = Process.GetProcessById(pi.dwProcessId);
        IntPtr pinned = p.Handle;
        return p;
      }
      finally
      {
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
      }
    }
  }
}
