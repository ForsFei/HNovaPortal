$portalUrl = 'http://127.0.0.1:43100'
$dataUrl = "$portalUrl/api/data"
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri $dataUrl -UseBasicParsing -TimeoutSec 1
        $data = $response.Content | ConvertFrom-Json
        if ($response.StatusCode -eq 200 -and $null -ne $data.websites -and $null -ne $data.services) {
            & explorer.exe $portalUrl
            exit 0
        }
    } catch {
        # Wait for the local server to finish starting.
    }
    Start-Sleep -Milliseconds 500
}
Write-Error "HNova Portal API did not become ready at $dataUrl"
exit 1
