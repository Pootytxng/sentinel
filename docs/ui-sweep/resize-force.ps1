Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32d {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
$p = Get-Process compy -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
foreach ($proc in $p) {
  $h = $proc.MainWindowHandle
  [Win32d]::ShowWindow($h, 6) | Out-Null   # SW_MINIMIZE
  Start-Sleep -Milliseconds 300
  [Win32d]::ShowWindow($h, 9) | Out-Null   # SW_RESTORE
  Start-Sleep -Milliseconds 300
  [Win32d]::SetForegroundWindow($h) | Out-Null
  [Win32d]::MoveWindow($h, 40, 40, 1500, 980, $true) | Out-Null
  # SWP_FRAMECHANGED = 0x0020, SWP_NOZORDER=0x0004
  [Win32d]::SetWindowPos($h, [IntPtr]::Zero, 40, 40, 1500, 980, 0x0024) | Out-Null
  Start-Sleep -Milliseconds 500
  Write-Output "forced resize PID $($proc.Id) handle $h"
}
