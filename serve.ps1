# Tiny local web server for My Budget (no installs needed).
# Browsers only allow "Install app" from http://localhost, not from a file:// page.
# After installing, the app works even when this server is not running.
# Keep the port the same: your data folder permission belongs to this address.
$port = 8765
$root = $PSScriptRoot
$url  = "http://localhost:$port/"

$types = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'
  '.json'='application/json'; '.webmanifest'='application/manifest+json'; '.png'='image/png'
  '.ico'='image/x-icon'; '.svg'='image/svg+xml'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try { $listener.Start() } catch {
  # Already running (e.g. started earlier) - just open the app.
  Start-Process $url; exit
}
Write-Host "My Budget is running at $url  (close this window to stop)"
Start-Process $url

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    # Only serve app files; never the backups folder or anything outside the project.
    $blocked = $path -like 'backups*' -or -not $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
    if (-not $blocked -and (Test-Path $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $res.StatusCode = 404 }
  } catch { $res.StatusCode = 500 }
  $res.Close()
}
