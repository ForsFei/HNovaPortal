$portalUrl = 'http://127.0.0.1:43100'
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri $portalUrl -UseBasicParsing -TimeoutSec 1
        if ($response.StatusCode -eq 200) {
            & explorer.exe $portalUrl
            exit 0
        }
    } catch {
        # Wait for the local server to finish starting.
    }
    Start-Sleep -Milliseconds 500
}
Write-Error "HNova Portal did not become ready at $portalUrl"
exit 1
