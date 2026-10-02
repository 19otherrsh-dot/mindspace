<#
.SYNOPSIS
  End-to-end smoke test against a running API.

.DESCRIPTION
  Exercises the paths that are easy to break and expensive to get wrong: the
  core practice loop, the onboarding answers actually taking effect, streak
  insurance, entitlement gating, and the check-ins.

  Lives in the repo rather than a scratch directory because the previous
  version was a temp file and did not survive.

.EXAMPLE
  pnpm api          # in one terminal
  pnpm smoke        # in another
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
  Write-Output ("  [{0}] {1,-52} got {2}, want {3}" -f $mark, $label, $actual, $expected)
}

function Section($name) { Write-Output "`n== $name ==" }

# ---------------------------------------------------------------------------
Section 'health'
$health = Call 'GET' '/health' $null $null
Check 'database reachable' $health.database $true

# ---------------------------------------------------------------------------
Section 'guest signup and the onboarding answers taking effect'
$guest = Call 'POST' '/auth/guest' @{ timezone = 'UTC' } $null
$t = $guest.tokens.accessToken
Check 'reminder starts at the column default' $guest.user.preferences.reminderTime '08:00'

$profiled = Call 'PUT' '/users/me/onboarding' @{
  goals = @('sleep'); experienceLevel = 'new'; sleepQuality = 'poor'
  dailyMinutes = 3; preferredTimeOfDay = 'evening'
} $t
Check 'evening moves the reminder to 20:00' $profiled.preferences.reminderTime '20:00'
Check 'goals come back as a real array' @($profiled.onboarding.goals).Count 1

$feed = Call 'GET' '/home' $null $t
# The hero is the one-tap action from Home, the widget and the reminder, so it
# must be something this account can actually play.
Check 'daily is playable by a free account' $feed.daily.isPro $false
Check 'daily carries a stream url' ($feed.daily.streamUrl.Length -gt 0) $true
$sectionIds = @($feed.sections | ForEach-Object { $_.id })
Check 'poor sleeper sees the sleep row' ($sectionIds -contains 'wind-down') $true
Check 'first-ten-days counter starts at zero' $feed.practiceDays 0

# ---------------------------------------------------------------------------
Section 'the practice loop'
$session = $feed.daily
$completion = Call 'POST' '/activity/complete' @{
  sessionId = $session.id
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  secondsListened = $session.durationSeconds
  finished = $true
} $t
Check 'streak starts at one' $completion.streak 1
Check 'the first session is celebrated' $completion.streakIncreased $true
Check 'rest days are reported' ($null -ne $completion.restDaysRemaining) $true

$replay = Call 'POST' '/activity/complete' @{
  sessionId = $session.id
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  secondsListened = $session.durationSeconds
  finished = $true
} $t
Check 'a replay does not bump the streak again' $replay.streakIncreased $false
Check 'the streak holds at one' $replay.streak 1

# The ten-day milestone is celebrated on the session that earns it, so day one
# must stay quiet. (The tenth-day case is covered by the milestone probe.)
Check 'day one counts as one practice day' $completion.practiceDays 1
Check 'day one does not celebrate ten days' $completion.reachedFirstTenDays $false

$afterFeed = Call 'GET' '/home' $null $t
Check 'first-ten-days counts the day' $afterFeed.practiceDays 1

# ---------------------------------------------------------------------------
Section 'check-ins'
$mood = Call 'POST' '/activity/mood' @{ value = 4; context = 'post_session'; note = 'clearer' } $t
Check 'mood note round-trips' $mood.note 'clearer'

$sleep = Call 'PUT' '/activity/sleep' @{ quality = 2; note = 'restless' } $t
Check 'sleep note round-trips' $sleep.note 'restless'
Call 'PUT' '/activity/sleep' @{ quality = 4 } $t | Out-Null
$sleepList = Call 'GET' '/activity/sleep?days=7' $null $t
Check 'one row per night, corrected in place' $sleepList.items.Count 1
Check 'the correction stuck' $sleepList.items[0].quality 4

# ---------------------------------------------------------------------------
Section 'bedtime channel'
$prefs = Call 'PATCH' '/users/me/preferences' @{ bedtimeEnabled = $true; bedtimeTime = '22:30' } $t
Check 'bedtime can be enabled' $prefs.bedtimeEnabled $true
Check 'bedtime can be moved' $prefs.bedtimeTime '22:30'
Check 'a nonsense bedtime is refused' (Status 'PATCH' '/users/me/preferences' @{ bedtimeTime = '99:99' } $t) 400

# ---------------------------------------------------------------------------
Section 'entitlement'
$all = Call 'GET' '/content/sessions?limit=100' $null $t
$proOne = ($all.items | Where-Object { $_.isPro })[0]
$freeOne = ($all.items | Where-Object { -not $_.isPro })[0]
Check 'pro audio is refused to a free account' (Status 'GET' "/content/sessions/$($proOne.id)/stream" $null $t) 402
Check 'free audio plays' (Status 'GET' "/content/sessions/$($freeOne.id)/stream" $null $t) 200
Check 'pro downloads are refused' (Status 'POST' '/content/downloads' @{ sessionId = $proOne.id } $t) 402
Check 'free downloads are allowed' (Status 'POST' '/content/downloads' @{ sessionId = $freeOne.id } $t) 200

# ---------------------------------------------------------------------------
Section 'stats'
$stats = Call 'GET' '/stats' $null $t
Check 'stats report the streak' $stats.currentStreak 1
Check 'rest-day balance is present' ($null -ne $stats.restDaysRemaining) $true

# ---------------------------------------------------------------------------
Write-Output ''
if ($script:failures -eq 0) {
  Write-Output 'SMOKE OK'
  exit 0
}
Write-Output "SMOKE FAILED - $($script:failures) check(s) did not pass"
exit 1
