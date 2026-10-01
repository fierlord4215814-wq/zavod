$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Desktop = [Environment]::GetFolderPath("Desktop")
$Shell = New-Object -ComObject WScript.Shell
$IconPath = Join-Path $PSScriptRoot "assets\zavod-shortcut.ico"

$Shortcuts = @(
  @{ Name = "Установка Завод"; Target = "Установка Завод.cmd" },
  @{ Name = "Запуск Завод"; Target = "Запуск Завод.cmd" },
  @{ Name = "Остановка Завод"; Target = "Остановка Завод.cmd" },
  @{ Name = "Проверка Завод"; Target = "Проверка Завод.cmd" },
  @{ Name = "Бэкап Завод"; Target = "Бэкап Завод.cmd" },
  @{ Name = "Восстановление Завод"; Target = "Восстановление Завод.cmd" }
)

foreach ($Item in $Shortcuts) {
  $ShortcutPath = Join-Path $Desktop ($Item.Name + ".lnk")
  $TargetPath = Join-Path $Root $Item.Target
  $Shortcut = $Shell.CreateShortcut($ShortcutPath)
  $Shortcut.TargetPath = $TargetPath
  $Shortcut.WorkingDirectory = $Root
  $Shortcut.Description = $Item.Name
  if (Test-Path -LiteralPath $IconPath) {
    $Shortcut.IconLocation = $IconPath
  }
  $Shortcut.Save()
  Write-Host "Создан ярлык: $ShortcutPath"
}
