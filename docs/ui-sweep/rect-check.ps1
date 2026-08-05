Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32c {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$p = Get-Process compy -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
foreach ($proc in $p) {
  $r = New-Object Win32c+RECT
  [Win32c]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null
  Write-Output "$($proc.Id): L=$($r.Left) T=$($r.Top) R=$($r.Right) B=$($r.Bottom) W=$($r.Right-$r.Left) H=$($r.Bottom-$r.Top)"
}
