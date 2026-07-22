Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$p = Get-Process compy -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
foreach ($proc in $p) {
  [Win32]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
  [Win32]::MoveWindow($proc.MainWindowHandle, 40, 40, 1500, 980, $true) | Out-Null
  Write-Output "resized PID $($proc.Id) handle $($proc.MainWindowHandle)"
}
