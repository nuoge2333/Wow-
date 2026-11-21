# wow 依赖指纹（Windows 用）
# ------------------------------------------------------------
# wow.bat / update.bat 用它判断「core/package.json 的依赖有没有变」。
#
# 为什么需要：这两个脚本都会跳过 node_modules（升级时不覆盖、启动时也不重装），
# 所以 package.json 变了而依赖没跟着变时，启动会直接报 Cannot find module。
# 只比较 dependencies / devDependencies，忽略 version —— 否则每次发版都会
# 误判成「依赖变了」，白白跑一次 npm install。
#
# 输出：64 位十六进制 SHA-256；任何异常都输出空行（调用方按「变了」处理）。
# 兼容：PowerShell 3.0+（Windows 8 及以上）。更老的系统会走空值分支，
#       表现为「每次启动都重装依赖」，功能不受影响。

param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

$ErrorActionPreference = 'Stop'

try {
    $raw = Get-Content -Raw -Path $Path
    $json = ConvertFrom-Json $raw

    $items = New-Object System.Collections.ArrayList

    foreach ($scope in @('dependencies', 'devDependencies')) {
        $block = $json.$scope
        if ($null -eq $block) { continue }
        foreach ($prop in $block.PSObject.Properties) {
            [void]$items.Add(('{0}:{1}={2}' -f $scope, $prop.Name, $prop.Value))
        }
    }

    $arr = $items.ToArray()
    [Array]::Sort($arr)
    $text = ($arr -join ';')

    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $hash = $sha.ComputeHash($bytes)
    $sha.Dispose()

    $hex = ([BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    Write-Output $hex
}
catch {
    Write-Output ''
}
