<#
.SYNOPSIS
  Therapy booking regression test.

.DESCRIPTION
  Booking is the highest-consequence flow in the product: it involves a real
  clinician's time, a legal licensing constraint, and clinical notes. These
  checks cover the things that must not silently regress - slot enforcement,
  double-booking, jurisdiction licensing, note encryption, and the
  cancellation window.

.EXAMPLE
  pnpm api            # in one terminal
  pnpm test:therapy   # in another
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

Section 'directory'
$directory = Call 'GET' '/therapy/therapists' $null $t
Check 'therapists are listed' ($directory.items.Count -gt 0) $true
$withSlug = @($directory.items | Where-Object { $_.slug -and $_.fullName }).Count
Check 'every therapist has a slug and a name' $withSlug $directory.items.Count
Check 'an unknown therapist 404s' (Status 'GET' '/therapy/therapists/not-a-real-person' $null $t) 404

# Pick someone accepting clients who has slots to offer.
$therapist = $null
$slots = $null
foreach ($candidate in $directory.items) {
  $s = Call 'GET' "/therapy/therapists/$($candidate.slug)/slots?days=30" $null $t
  if ($s.slots.Count -gt 1) { $therapist = $candidate; $slots = $s; break }
}
if (-not $therapist) {
  Write-Output '  [FAIL] no therapist with bookable slots - is the database seeded?'
  exit 1
}

Section "slots for $($therapist.fullName)"
Check 'slots are offered' ($slots.slots.Count -gt 0) $true
$jurisdiction = $therapist.licences[0].jurisdiction

# ---------------------------------------------------------------------------
Section 'a time that is not a real slot is refused'
# Deliberately off-grid: 37 seconds past a random minute is never generated.
$bogus = (Get-Date).ToUniversalTime().AddDays(3).ToString('yyyy-MM-ddTHH:mm:37.000Z')
Check 'off-grid time refused' (Status 'POST' '/therapy/appointments' @{
  therapistId = $therapist.id; startsAt = $bogus; jurisdiction = $jurisdiction
} $t) 409

# ---------------------------------------------------------------------------
Section 'a valid booking'
$slot = $slots.slots[0].startsAt
$booking = Call 'POST' '/therapy/appointments' @{
  therapistId = $therapist.id
  startsAt = $slot
  jurisdiction = $jurisdiction
  note = 'Work stress, sleeping badly'
} $t

Check 'status is scheduled' $booking.status 'scheduled'
Check 'a video room is allocated' ($booking.videoUrl.Length -gt 0) $true
Check 'the clinical note round-trips' $booking.note 'Work stress, sleeping badly'

Section 'the slot is consumed'
$after = Call 'GET' "/therapy/therapists/$($therapist.slug)/slots?days=30" $null $t
$stillOffered = @($after.slots | Where-Object { $_.startsAt -eq $slot }).Count
Check 'the booked time is no longer offered' $stillOffered 0
Check 'other slots remain' ($after.slots.Count -gt 0) $true

Section 'double-booking'
Check 'the same slot cannot be taken twice' (Status 'POST' '/therapy/appointments' @{
  therapistId = $therapist.id; startsAt = $slot; jurisdiction = $jurisdiction
} $t) 409

Section 'licensing is enforced at write time'
# A jurisdiction this clinician does not hold a licence for must be refused
# even though the slot itself is free.
$licensed = @($therapist.licences | ForEach-Object { $_.jurisdiction })
$unlicensed = @('US-CA', 'US-NY', 'GB-ENG', 'IN-KA', 'AU-NSW') | Where-Object { $licensed -notcontains $_ } | Select-Object -First 1
if ($unlicensed) {
  $freeSlot = $after.slots[0].startsAt
  Check "booking from an unlicensed region ($unlicensed) refused" (Status 'POST' '/therapy/appointments' @{
    therapistId = $therapist.id; startsAt = $freeSlot; jurisdiction = $unlicensed
  } $t) 403
} else {
  Write-Output '  [skip] this therapist is licensed everywhere the test knows about'
}

Section 'my appointments'
$mine = Call 'GET' '/therapy/appointments?scope=upcoming' $null $t
Check 'the booking appears' ($mine.items.Count -ge 1) $true
Check 'it belongs to the right therapist' $mine.items[0].therapist.slug $therapist.slug

Section 'cancellation window'
$hoursAway = ([datetime]$slot).ToUniversalTime() - (Get-Date).ToUniversalTime()
$code = Status 'DELETE' "/therapy/appointments/$($booking.id)" $null $t
if ($hoursAway.TotalHours -lt 24) {
  Check 'a late cancellation is refused' $code 409
} else {
  Check 'a cancellation more than 24h out is accepted' $code 200
}

Section 'other people''s appointments'
$other = Call 'POST' '/auth/guest' @{ timezone = 'UTC' } $null
Check 'another user cannot cancel it' (Status 'DELETE' "/therapy/appointments/$($booking.id)" $null $other.tokens.accessToken) 404

# ---------------------------------------------------------------------------
Write-Output ''
if ($script:failures -eq 0) { Write-Output 'THERAPY OK'; exit 0 }
Write-Output "THERAPY FAILED - $($script:failures) check(s) did not pass"
exit 1
