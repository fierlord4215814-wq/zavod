param(
  [Parameter(Mandatory = $true)]
  [string]$BatchPath,
  [ValidateSet('theme', 'viewport-theme')]
  [string]$Grouping = 'theme'
)

Add-Type -AssemblyName System.Drawing

$resolvedBatch = (Resolve-Path -LiteralPath $BatchPath).Path
$outputDirectory = Join-Path $resolvedBatch 'review-contact-sheets'
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

$groups = Get-ChildItem -LiteralPath $resolvedBatch -Filter '*.png' -File | Group-Object {
  $name = $_.BaseName
  $theme = if ($name -match '-(dark|gray|light)-') { $Matches[1] } else { 'unknown' }
  if ($Grouping -eq 'viewport-theme' -and $name -match '^(desktop|360|390|430)-') {
    return "$($Matches[1])-$theme"
  }
  return $theme
}

$tileWidth = 300
$tileHeight = 250
$captionHeight = 34
$columns = 5
$font = [System.Drawing.Font]::new('Segoe UI', 9)
$captionBrush = [System.Drawing.Brushes]::White
$backgroundBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(25, 29, 34))

try {
  foreach ($group in $groups) {
    $files = @($group.Group | Sort-Object Name)
    $rows = [Math]::Ceiling($files.Count / $columns)
    $sheet = [System.Drawing.Bitmap]::new($columns * $tileWidth, $rows * ($tileHeight + $captionHeight))
    $graphics = [System.Drawing.Graphics]::FromImage($sheet)
    try {
      $graphics.FillRectangle($backgroundBrush, 0, 0, $sheet.Width, $sheet.Height)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      for ($index = 0; $index -lt $files.Count; $index += 1) {
        $source = [System.Drawing.Image]::FromFile($files[$index].FullName)
        try {
          $column = $index % $columns
          $row = [Math]::Floor($index / $columns)
          $x = $column * $tileWidth
          $y = $row * ($tileHeight + $captionHeight)
          $scale = [Math]::Min(($tileWidth - 12) / $source.Width, ($tileHeight - 12) / $source.Height)
          $drawWidth = [Math]::Max(1, [int]($source.Width * $scale))
          $drawHeight = [Math]::Max(1, [int]($source.Height * $scale))
          $drawX = $x + [int](($tileWidth - $drawWidth) / 2)
          $drawY = $y + [int](($tileHeight - $drawHeight) / 2)
          $graphics.DrawImage($source, $drawX, $drawY, $drawWidth, $drawHeight)
          $graphics.DrawString($files[$index].BaseName, $font, $captionBrush, $x + 6, $y + $tileHeight + 4)
        } finally {
          $source.Dispose()
        }
      }
      $target = Join-Path $outputDirectory "$($group.Name).png"
      $sheet.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $sheet.Dispose()
    }
  }
} finally {
  $font.Dispose()
  $backgroundBrush.Dispose()
}
