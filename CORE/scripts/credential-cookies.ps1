param(
    [ValidateSet('ImportFile', 'ImportStdin', 'Get', 'Status', 'Delete')]
    [string]$Mode = 'Get',
    [string]$InputFile,
    [ValidateSet('GoogleAIStudio', 'OmniProductStudio', 'FlowMusic', 'GoogleLabsFlow', 'Grok')]
    [string]$Service = 'OmniProductStudio'
)

$ErrorActionPreference = 'Stop'
$Prefix = "Codex/$Service/Cookies"
$AllowedDomainPattern = $(if ($Service -eq 'FlowMusic') { '(^|\.)flowmusic\.app$' } elseif ($Service -eq 'GoogleLabsFlow') { '(^|\.)(google\.com(?:\.br)?|labs\.google)$' } elseif ($Service -eq 'Grok') { '(^|\.)(grok\.com|x\.ai)$' } else { '(^|\.)(google\.com(?:\.br)?|aistudio\.google\.com)$' })
$ChunkBytes = 1800

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class GenericCredentialStore
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);

    public static void Write(string target, byte[] secret)
    {
        IntPtr blob = Marshal.AllocCoTaskMem(secret.Length);
        try
        {
            Marshal.Copy(secret, 0, blob, secret.Length);
            var credential = new CREDENTIAL {
                Type = 1,
                TargetName = target,
                CredentialBlobSize = (uint)secret.Length,
                CredentialBlob = blob,
                Persist = 2,
                UserName = "CodexCookieStore"
            };
            if (!CredWrite(ref credential, 0))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        finally { Marshal.FreeCoTaskMem(blob); }
    }

    public static byte[] Read(string target)
    {
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var credential = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            var result = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, result, 0, result.Length);
            return result;
        }
        finally { CredFree(ptr); }
    }

    public static void Delete(string target)
    {
        if (!CredDelete(target, 1, 0)) {
            int error = Marshal.GetLastWin32Error();
            if (error != 1168) throw new System.ComponentModel.Win32Exception(error);
        }
    }
}
'@

function Get-StoredMeta {
    try {
        $bytes = [GenericCredentialStore]::Read("$Prefix/Meta")
        return [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Remove-StoredCookies {
    $meta = Get-StoredMeta
    if ($null -ne $meta) {
        for ($i = 0; $i -lt [int]$meta.chunks; $i++) {
            [GenericCredentialStore]::Delete("$Prefix/$i")
        }
    }
    [GenericCredentialStore]::Delete("$Prefix/Meta")
}

function Test-AllowedCookieDomain([string]$Domain) {
    return -not [string]::IsNullOrWhiteSpace($Domain) -and $Domain -match $AllowedDomainPattern
}

function Import-StoredCookies([array]$Cookies) {
    $filtered = @($Cookies | Where-Object {
        -not [string]::IsNullOrWhiteSpace([string]$_.name) -and
        -not [string]::IsNullOrWhiteSpace([string]$_.value) -and
        (Test-AllowedCookieDomain ([string]$_.domain))
    })
    $requiredNames = if ($Service -eq 'FlowMusic') { @('sb-sb-auth-token.0') } elseif ($Service -eq 'GoogleLabsFlow') { @('__Secure-next-auth.session-token', '__Secure-1PSID') } elseif ($Service -eq 'Grok') { @('sso-rw', 'sso') } else { @('__Secure-1PSID', 'SID') }
    $missingNames = @($requiredNames | Where-Object { $filtered.name -notcontains $_ })
    $validSet = if ($Service -eq 'FlowMusic') {
        $filtered.Count -ge 2 -and ($filtered.name -contains 'sb-sb-auth-token.0')
    } elseif ($Service -eq 'GoogleLabsFlow') {
        $filtered.Count -ge 4 -and ($filtered.name -contains '__Secure-next-auth.session-token') -and ($filtered.name -contains '__Secure-1PSID')
    } elseif ($Service -eq 'Grok') {
        $filtered.Count -ge 1
    } else {
        $filtered.Count -ge 8 -and ($filtered.name -contains '__Secure-1PSID') -and ($filtered.name -contains 'SID')
    }
    if (-not $validSet) {
        $missingSummary = $(if ($missingNames.Count) { $missingNames -join ',' } else { 'minimum-cookie-count' })
        throw "O conjunto não contém cookies suficientes para $Service (recebidos=$($filtered.Count); ausentes=$missingSummary)."
    }

    Remove-StoredCookies
    $jsonBytes = [Text.Encoding]::UTF8.GetBytes(($filtered | ConvertTo-Json -Compress -Depth 5))
    $chunks = [Math]::Ceiling($jsonBytes.Length / $ChunkBytes)
    for ($i = 0; $i -lt $chunks; $i++) {
        $offset = $i * $ChunkBytes
        $length = [Math]::Min($ChunkBytes, $jsonBytes.Length - $offset)
        $part = New-Object byte[] $length
        [Array]::Copy($jsonBytes, $offset, $part, 0, $length)
        [GenericCredentialStore]::Write("$Prefix/$i", $part)
    }
    $metaBytes = [Text.Encoding]::UTF8.GetBytes((@{ schema = 'mkt-videos/credential-cookie-meta@1'; chunks = $chunks; cookies = $filtered.Count; updatedAt = [DateTimeOffset]::UtcNow.ToString('o') } | ConvertTo-Json -Compress))
    [GenericCredentialStore]::Write("$Prefix/Meta", $metaBytes)
    Write-Output "Importados $($filtered.Count) cookies de $Service para o Gerenciador de Credenciais do Windows."
}

if ($Mode -eq 'Delete') {
    Remove-StoredCookies
    Write-Output 'Credenciais do Omni Product Studio removidas.'
    exit 0
}

if ($Mode -eq 'Status') {
    $meta = Get-StoredMeta
    if ($null -eq $meta) {
        @{ schema = 'mkt-videos/credential-cookie-meta@1'; service = $Service; configured = $false } | ConvertTo-Json -Compress
    } else {
        @{ schema = 'mkt-videos/credential-cookie-meta@1'; service = $Service; configured = $true; cookies = [int]$meta.cookies; updatedAt = $meta.updatedAt } | ConvertTo-Json -Compress
    }
    exit 0
}

if ($Mode -eq 'ImportStdin') {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { throw 'ImportStdin não recebeu cookies.' }
    $parsedCookies = $raw | ConvertFrom-Json
    $cookies = @()
    foreach ($cookie in $parsedCookies) { $cookies += $cookie }
    Import-StoredCookies $cookies
    exit 0
}

if ($Mode -eq 'ImportFile') {
    if ([string]::IsNullOrWhiteSpace($InputFile) -or -not (Test-Path -LiteralPath $InputFile)) {
        throw 'Informe um arquivo de cookies existente com -InputFile.'
    }
    $cookies = @()
    foreach ($line in (Get-Content -LiteralPath $InputFile)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $parts = $line.Trim() -split '\s+'
        if ($parts.Count -lt 5) { continue }
        $name, $value, $domain, $cookiePath, $expiresText = $parts[0..4]
        if ([string]::IsNullOrWhiteSpace($name) -or [string]::IsNullOrWhiteSpace($value)) { continue }
        if ($domain -notmatch $AllowedDomainPattern) { continue }

        $tail = @($parts[5..($parts.Count - 1)])
        $checks = @($tail | Where-Object { $_ -eq '✓' }).Count
        $sameSite = @($tail | Where-Object { $_ -in @('Strict', 'Lax', 'None') } | Select-Object -First 1)[0]
        $cookie = [ordered]@{
            name = $name
            value = $value
            domain = $domain
            path = $(if ($cookiePath) { $cookiePath } else { '/' })
            secure = ($name.StartsWith('__Secure-') -or $checks -ge 1)
            httpOnly = ($checks -ge 2)
        }
        try { $cookie.expires = [DateTimeOffset]::Parse($expiresText).ToUnixTimeSeconds() } catch { }
        if ($sameSite) { $cookie.sameSite = $sameSite }
        $cookies += [pscustomobject]$cookie
    }
    Import-StoredCookies $cookies
    exit 0
}

$storedMeta = Get-StoredMeta
if ($null -eq $storedMeta) { throw "Credenciais de $Service não encontradas." }
$memory = New-Object System.IO.MemoryStream
for ($i = 0; $i -lt [int]$storedMeta.chunks; $i++) {
    $part = [GenericCredentialStore]::Read("$Prefix/$i")
    $memory.Write($part, 0, $part.Length)
}
[Convert]::ToBase64String($memory.ToArray())
