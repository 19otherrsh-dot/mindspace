<#
.SYNOPSIS
  Feature-level regression test: timers, teachers, and feed hygiene.

.DESCRIPTION
  Covers the things that are easy to break from a distance - the unguided
  timer flowing through the same completion pipeline as guided content, the
  teacher directory, Pro gating on teacher detail, and timers not leaking into
  the browsable feed.

.EXAMPLE
  pnpm api             # in one terminal
  pnpm test:features   # in another
#>

$ErrorActionPreference = 'Stop'
$base = if ($env:SMOKE_BASE_URL) { $env:SMOKE_BASE_URL } else { 'http://localhost:4000' }

$script:failures = 0

function Call($method, $path, $body, $token) {
  $headers = @{}
  if ($token) { $headers['Authorization'] = "Bearer $token" }
  $p = @{ Uri = "$base$path"; Method = $method; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 25 }
  if ($body) { $p['Body'] = ($body | ConvertTo-Json -Compress -Depth 8); $p['ContentType'] = 'application/json' }
  return Invoke-RestMethod @p
}

function Status($method, $path, $body, $token) {
  try { Call $method $path $body $token | Out-Null; return 200 }
  catch { return [int]$_.Exception.Response.StatusCode }
}

function Check($label, $actual, $expected) {
  $ok = "$actual" -eq "$expected"
  if (-not $ok) { $script:failures++ }
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  Write-Output ("  [{0}] {1,-54} got {2}, want {3}" -f $mark, $label, $actual, $expected)
}

function Section($name) { Write-Output "`n== $name ==" }

# ---------------------------------------------------------------------------
$guest = Call 'POST' '/auth/guest' @{ timezone = 'UTC' } $null
$t = $guest.tokens.accessToken

Section 'a silent sit counts like any other session'
$before = Call 'GET' '/stats' $null $t
$timers = Call 'GET' '/content/sessions?format=unguided&limit=10' $null $t
Check 'unguided timers exist in the catalogue' ($timers.items.Count -gt 0) $true

$timer = $timers.items[0]
Check 'the timer is free on every tier' $timer.isPro $false

$done = Call 'POST' '/activity/complete' @{
  sessionId = $timer.id
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  secondsListened = $timer.durationSeconds
  finished = $true
} $t

$after = Call 'GET' '/stats' $null $t
Check 'the streak advances' $after.currentStreak ($before.currentStreak + 1)
Check 'minutes are banked' ($after.totalMinutes -gt $before.totalMinutes) $true
Check 'achievements can unlock from a silent sit' ($done.newAchievements.Count -ge 1) $true

Section 'it appears in history'
$history = Call 'GET' '/activity/history?limit=5' $null $t
Check 'the timer is the most recent entry' $history.items[0].sessionId $timer.id

Section 'timers stay out of the browsable feed'
$feed = Call 'GET' '/home' $null $t
$leaked = 0
foreach ($s in $feed.sections) {
  $leaked += @($s.sessions | Where-Object { $_.format -eq 'unguided' }).Count
}
Check 'no timers in the home feed' $leaked 0
Check 'the daily hero is not a timer' ($feed.daily.format -ne 'unguided') $true

$search = Call 'GET' '/content/sessions?q=timer&limit=20' $null $t
$inSearch = @($search.items | Where-Object { $_.format -eq 'unguided' }).Count
Check 'no timers in open search' $inSearch 0

Section 'teachers directory'
$teachers = Call 'GET' '/content/teachers' $null $t
Check 'teachers are listed' ($teachers.items.Count -gt 0) $true
$complete = @($teachers.items | Where-Object { $_.slug -and $_.tagline }).Count
Check 'every teacher has a slug and a tagline' $complete $teachers.items.Count
# Featured is a filter on the endpoint rather than a field on the row, so it
# is checked by asking for the filtered list.
$featured = Call 'GET' '/content/teachers?featured=true' $null $t
Check 'the featured filter returns teachers' ($featured.items.Count -gt 0) $true
Check 'featured is a strict subset of the directory' ($featured.items.Count -le $teachers.items.Count) $true

Section 'teacher detail gates Pro audio'
$slug = $teachers.items[0].slug
$detail = Call 'GET' "/content/teachers/$slug" $null $t
Check 'the teacher has sessions' ($detail.sessions.Count -gt 0) $true

$proSessions = @($detail.sessions | Where-Object { $_.isPro })
$blanked = @($proSessions | Where-Object { -not $_.streamUrl })
Check 'every Pro stream url is blanked for a free user' $blanked.Count $proSessions.Count

$freeSessions = @($detail.sessions | Where-Object { -not $_.isPro })
$playable = @($freeSessions | Where-Object { $_.streamUrl })
Check 'free stream urls are intact' $playable.Count $freeSessions.Count

Check 'an unknown teacher 404s' (Status 'GET' '/content/teachers/nobody-at-all' $null $t) 404

Section 'collections'
$collections = Call 'GET' '/content/collections' $null $t
Check 'collections are listed' ($collections.items.Count -gt 0) $true
$firstSlug = $collections.items[0].slug
$collection = Call 'GET' "/content/collections/$firstSlug" $null $t
Check 'a collection resolves to sessions' ($collection.sessions.Count -gt 0) $true
$collectionTimers = @($collection.sessions | Where-Object { $_.format -eq 'unguided' }).Count
Check 'no timers inside collections' $collectionTimers 0

# ---------------------------------------------------------------------------
Write-Output ''
if ($script:failures -eq 0) { Write-Output 'FEATURES OK'; exit 0 }
Write-Output "FEATURES FAILED - $($script:failures) check(s) did not pass"
exit 1
